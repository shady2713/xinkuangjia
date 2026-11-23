#!/usr/bin/env python3
"""本地开发环境初始化脚本：工具检查、本地随机凭据生成与 Git 钩子挂载。

默认只读预览（--dry-run），仅在显式传入 --apply 时写入被 Git 忽略的 .env.dev 与后端 .env；
已存在的环境文件默认保留，传入 --force 才覆盖；任何模式下均不回显生成的密钥明文。

用法：
  python -B -X utf8 scripts/runtime/init_local_dev.py
  python -B -X utf8 scripts/runtime/init_local_dev.py --apply
"""

from __future__ import annotations

import argparse
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

sys.dont_write_bytecode = True

DEFAULT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = Path("后端代码") / "basic-framework-boot"
SM2_CURVE_ORDER = int("FFFFFFFEFFFFFFFFFFFFFFFFFFFFFFFF7203DF6B21C6052B53BBF40939D54123", 16)
REQUIRED_TOOLS = ("git", "java", "mvn", "node", "pnpm")
OPTIONAL_TOOLS = ("docker",)


@dataclass(frozen=True)
class BootstrapPlan:
    """汇总本地环境自检与拟执行动作。"""

    missing_required_tools: tuple[str, ...]
    missing_optional_tools: tuple[str, ...]
    actions: tuple[str, ...]
    applied: bool


def generate_sm2_private_key_hex() -> str:
    """生成位于合法椭圆曲线阶区间内的 64 位小写十六进制 SM2 私钥。"""
    scalar = secrets.randbelow(SM2_CURVE_ORDER - 1) + 1
    return f"{scalar:064x}"


def generate_local_secret(byte_length: int = 20) -> str:
    """生成仅含字母数字的本地随机口令。"""
    alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    return "".join(secrets.choice(alphabet) for _ in range(max(16, byte_length)))


def parse_existing_env(path: Path) -> dict[str, str]:
    """读取已有本地环境文件中的键值对，保留单侧已配置的凭据。"""
    parsed: dict[str, str] = {}
    if not path.is_file():
        return parsed
    for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        parsed[key.strip()] = value.strip().strip('"').strip("'")
    return parsed


def render_backend_env(template_text: str, values: dict[str, str]) -> str:
    """基于后端 .env.example 渲染本地 .env，仅替换受管键并保留注释。"""
    rendered_lines: list[str] = []
    key_pattern = re.compile(r"^([A-Z][A-Z0-9_]*)=(.*)$")
    for raw_line in template_text.splitlines():
        match = key_pattern.match(raw_line)
        if match and match.group(1) in values:
            key = match.group(1)
            rendered_lines.append(f"{key}={values[key]}")
        else:
            rendered_lines.append(raw_line)
    return "\n".join(rendered_lines) + "\n"


def render_compose_env(values: dict[str, str]) -> str:
    """生成供 docker-compose.dev.yml 读取的根目录 .env.dev 文本。"""
    ordered_keys = (
        "DEV_MYSQL_ROOT_PASSWORD",
        "DB_PORT",
        "DB_NAME",
        "DB_USERNAME",
        "DB_PASSWORD",
        "REDIS_PORT",
        "REDIS_PASSWORD",
    )
    lines = [
        "# 由 scripts/runtime/init_local_dev.py --apply 生成；已加入 .gitignore，禁止提交。",
        *[f"{key}={values[key]}" for key in ordered_keys],
    ]
    return "\n".join(lines) + "\n"


def check_tools() -> tuple[tuple[str, ...], tuple[str, ...]]:
    """探测本地必需与可选命令行工具是否存在。"""
    missing_required = tuple(name for name in REQUIRED_TOOLS if shutil.which(name) is None)
    missing_optional = tuple(name for name in OPTIONAL_TOOLS if shutil.which(name) is None)
    return missing_required, missing_optional


def write_local_env(path: Path, content: str, *, force: bool) -> bool:
    """以当前用户独占权限创建本地凭据，强制更新时原子替换旧文件。"""
    if not force:
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            return False
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
                output.write(content)
        except OSError:
            path.unlink(missing_ok=True)
            raise
        return True

    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n",
                                         dir=path.parent, delete=False) as output:
            temporary = Path(output.name)
            output.write(content)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return True


def current_hooks_path(root: Path) -> str | None:
    """读取当前仓库的 core.hooksPath 配置值。"""
    if not (root / ".git").exists():
        return None
    completed = subprocess.run(
        ["git", "-C", str(root), "config", "--get", "core.hooksPath"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
        timeout=10,
    )
    return completed.stdout.strip() if completed.returncode == 0 else None


def bootstrap(root: Path, *, apply: bool = False, force: bool = False) -> BootstrapPlan:
    """预览或执行本地开发环境初始化。"""
    resolved_root = root.resolve()
    backend_dir = resolved_root / BACKEND_DIR
    template_path = backend_dir / ".env.example"
    if not template_path.is_file():
        raise FileNotFoundError(f"未找到后端环境模板：{template_path.as_posix()}")

    missing_required, missing_optional = check_tools()
    compose_env_path = resolved_root / ".env.dev"
    backend_env_path = backend_dir / ".env"
    actions: list[str] = []

    existing: dict[str, str] = {}
    if not force:
        existing.update(parse_existing_env(compose_env_path))
        existing.update(parse_existing_env(backend_env_path))

    db_password = existing.get("DB_PASSWORD") or generate_local_secret(20)
    redis_password = existing.get("REDIS_PASSWORD") or generate_local_secret(20)
    values = {
        "SPRING_PROFILES_ACTIVE": existing.get("SPRING_PROFILES_ACTIVE") or "local",
        "DEV_MYSQL_ROOT_PASSWORD": existing.get("DEV_MYSQL_ROOT_PASSWORD") or generate_local_secret(20),
        "DB_HOST": existing.get("DB_HOST") or "127.0.0.1",
        "DB_PORT": existing.get("DB_PORT") or "3306",
        "DB_NAME": existing.get("DB_NAME") or "basic_framework",
        "DB_USERNAME": existing.get("DB_USERNAME") or "basic_dev",
        "DB_PASSWORD": db_password,
        "REDIS_HOST": existing.get("REDIS_HOST") or "127.0.0.1",
        "REDIS_PORT": existing.get("REDIS_PORT") or "6379",
        "REDIS_PASSWORD": redis_password,
        "SM2_PRIVATE_KEY": existing.get("SM2_PRIVATE_KEY") or generate_sm2_private_key_hex(),
    }

    if not compose_env_path.exists() or force:
        verb = "写入" if apply else "将写入"
        actions.append(f"{verb} .env.dev（本地 MySQL/Redis 凭据，已脱敏）")
        if apply and not write_local_env(compose_env_path, render_compose_env(values), force=force):
            actions[-1] = "保留同时创建的 .env.dev"
    else:
        actions.append("保留已有 .env.dev（未传 --force 不覆盖）")

    if not backend_env_path.exists() or force:
        verb = "写入" if apply else "将写入"
        actions.append(f"{verb} 后端代码/basic-framework-boot/.env（含随机 SM2 私钥与本地连接配置）")
        if apply:
            template_text = template_path.read_text(encoding="utf-8")
            if not write_local_env(backend_env_path, render_backend_env(template_text, values), force=force):
                actions[-1] = "保留同时创建的后端 .env"
    else:
        actions.append("保留已有 后端代码/basic-framework-boot/.env（未传 --force 不覆盖）")

    if (resolved_root / ".git").exists():
        hooks_path = current_hooks_path(resolved_root)
        if hooks_path is None:
            verb = "配置" if apply else "将配置"
            actions.append(f"{verb} git core.hooksPath = .githooks")
            if apply:
                subprocess.run(
                    ["git", "-C", str(resolved_root), "config", "--local", "core.hooksPath", ".githooks"],
                    check=True,
                    capture_output=True,
                    timeout=10,
                )
        elif hooks_path == ".githooks":
            actions.append("git core.hooksPath 已指向 .githooks")
        else:
            actions.append("保留已有自定义 Git 钩子路径")

    return BootstrapPlan(
        missing_required_tools=missing_required,
        missing_optional_tools=missing_optional,
        actions=tuple(actions),
        applied=apply,
    )


def build_arg_parser() -> argparse.ArgumentParser:
    """构造命令行参数解析器。"""
    parser = argparse.ArgumentParser(description="本地开发环境自检及初始化工具")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="仓库根目录")
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument("--dry-run", action="store_true", help="只读预览（默认）")
    mode_group.add_argument("--apply", action="store_true", help="写入本地环境文件并挂载 .githooks")
    parser.add_argument("--force", action="store_true", help="与 --apply 联用时覆盖已有本地环境文件")
    return parser


def main(argv: list[str] | None = None) -> int:
    """命令行主入口。"""
    args = build_arg_parser().parse_args(argv)
    if args.force and not args.apply:
        print("参数错误：--force 必须与 --apply 同时传入。", file=sys.stderr)
        return 2
    try:
        plan = bootstrap(args.root, apply=args.apply, force=args.force)
    except (OSError, ValueError) as error:
        print(f"本地配置初始化失败：{error}", file=sys.stderr)
        return 1

    mode_label = "已执行初始化（--apply）" if plan.applied else "只读预览（默认 --dry-run，传入 --apply 生效）"
    print(f"模式：{mode_label}")
    if plan.missing_required_tools:
        print(f"缺失必需工具：{', '.join(plan.missing_required_tools)}")
    else:
        print("必需命令行工具检查通过（git / java / mvn / node / pnpm）。")
    if plan.missing_optional_tools:
        print(f"提示：未检测到可选容器工具 {', '.join(plan.missing_optional_tools)}。")
    for item in plan.actions:
        print(f"- {item}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
