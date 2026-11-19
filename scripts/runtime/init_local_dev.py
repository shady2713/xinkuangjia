#!/usr/bin/env python3
"""本地开发与 Vibe Coding 环境准备脚本：工具自检、Git 钩子挂载与本地随机密钥生成。

默认只读预览（--dry-run），仅在显式传入 --apply 时写入被 Git 忽略的本地环境文件与 Git 配置；
已存在的环境文件默认保留，传入 --force 才覆盖；任何模式下均不向终端回显生成的密钥明文。

用法：
  python -B -X utf8 scripts/runtime/init_local_dev.py
  python -B -X utf8 scripts/runtime/init_local_dev.py --apply

@author shady2713
"""

from __future__ import annotations

import argparse
import re
import secrets
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

sys.dont_write_bytecode = True

DEFAULT_ROOT = Path(__file__).resolve().parents[2]
# 国密 SM2 推荐椭圆曲线阶 n，合法私钥整数须严格落在 [1, SM2_CURVE_ORDER - 1]。
SM2_CURVE_ORDER = int("FFFFFFFEFFFFFFFFFFFFFFFFFFFFFFFF7203DF6B21C6052B53BBF40939D54123", 16)
REQUIRED_TOOLS = ("git", "python", "java", "mvn", "node", "pnpm")
OPTIONAL_TOOLS = ("docker",)


@dataclass(frozen=True)
class BootstrapPlan:
    """汇总本地开发环境自检与待执行动作的结果快照。"""

    missing_required_tools: tuple[str, ...]
    missing_optional_tools: tuple[str, ...]
    actions: tuple[str, ...]
    applied: bool


def generate_sm2_private_key_hex() -> str:
    """生成位于合法曲线阶区间内的 64 位小写十六进制 SM2 私钥。

    Returns:
        长度为 64 的十六进制私钥字符串。
    """
    scalar = secrets.randbelow(SM2_CURVE_ORDER - 1) + 1
    return f"{scalar:064x}"


def generate_local_secret(byte_length: int = 18) -> str:
    """生成仅含字母数字的本地随机口令，避免连接串与 Shell 转义歧义。

    Args:
        byte_length: 随机字节长度。
    Returns:
        URL 安全的纯字母数字随机字符串。
    """
    alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    return "".join(secrets.choice(alphabet) for _ in range(max(16, byte_length)))


def render_backend_env(template_text: str, values: dict[str, str]) -> str:
    """基于后端 .env.example 渲染本地 .env 内容，仅替换受管键并保留注释。

    Args:
        template_text: 后端模板文本。
        values: 待注入的键值映射。
    Returns:
        使用 LF 结尾的渲染后 .env 文本。
    """
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
    """生成供 docker-compose.dev.yml 读取的根目录 .env.dev 文本。

    Args:
        values: 与后端本地配置一致的中间件凭据映射。
    Returns:
        使用 LF 结尾的 .env.dev 文件内容。
    """
    ordered_keys = (
        "DEV_MYSQL_ROOT_PASSWORD",
        "DB_PORT",
        "DB_NAME",
        "DB_USERNAME",
        "DB_PASSWORD",
        "REDIS_PORT",
        "REDIS_PASSWORD",
        "MINIO_ACCESS_KEY",
        "MINIO_SECRET_KEY",
        "MINIO_BUCKET",
    )
    lines = [
        "# 由 scripts/runtime/init_local_dev.py --apply 生成；已加入 .gitignore，禁止提交。",
        *[f"{key}={values[key]}" for key in ordered_keys],
    ]
    return "\n".join(lines) + "\n"


def check_tools() -> tuple[tuple[str, ...], tuple[str, ...]]:
    """探测本地必需与可选命令行工具是否存在于 PATH 中。

    Returns:
        缺失的必需工具元组与缺失的可选工具元组。
    """
    missing_required: list[str] = []
    for name in REQUIRED_TOOLS:
        if name == "python":
            continue
        if shutil.which(name) is None:
            missing_required.append(name)
    missing_optional = tuple(name for name in OPTIONAL_TOOLS if shutil.which(name) is None)
    return tuple(missing_required), missing_optional


def current_hooks_path(root: Path) -> str:
    """读取当前仓库的 core.hooksPath 配置值；未配置或非 Git 目录时返回空串。"""
    if not (root / ".git").exists():
        return ""
    completed = subprocess.run(
        ["git", "-C", str(root), "config", "--local", "--get", "core.hooksPath"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
        timeout=10,
    )
    return completed.stdout.strip() if completed.returncode == 0 else ""


def bootstrap(root: Path, *, apply: bool = False, force: bool = False) -> BootstrapPlan:
    """执行或预览本地开发环境初始化，保证幂等且不泄露随机凭据。

    Args:
        root: 仓库根目录。
        apply: 为 True 时实际写入缺失配置并设置 Git 钩子目录。
        force: 与 apply 联用时覆盖已存在的本地 .env.dev 和后端 .env。
    Returns:
        本次自检及处理动作的结构化汇总。
    """
    resolved_root = root.resolve()
    backend_dir = resolved_root / "后端代码" / "basic-framework-boot"
    template_path = backend_dir / ".env.example"
    if not template_path.is_file():
        raise FileNotFoundError(f"未找到后端环境模板：{template_path.as_posix()}")

    missing_required, missing_optional = check_tools()
    compose_env_path = resolved_root / ".env.dev"
    backend_env_path = backend_dir / ".env"
    actions: list[str] = []

    def _parse_existing_env(path: Path) -> dict[str, str]:
        """读取已有本地环境文件中的键值对，用于在单侧文件缺失时保持双边凭据一致。"""
        parsed: dict[str, str] = {}
        if not path.is_file():
            return parsed
        for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            parsed[k.strip()] = v.strip().strip('"').strip("'")
        return parsed

    existing_vals: dict[str, str] = {}
    if not force:
        if compose_env_path.exists():
            existing_vals.update(_parse_existing_env(compose_env_path))
        if backend_env_path.exists():
            existing_vals.update(_parse_existing_env(backend_env_path))

    db_password = existing_vals.get("DB_PASSWORD") or generate_local_secret(20)
    redis_password = existing_vals.get("REDIS_PASSWORD") or generate_local_secret(20)
    minio_access = existing_vals.get("MINIO_ACCESS_KEY") or generate_local_secret(16)
    minio_secret = existing_vals.get("MINIO_SECRET_KEY") or generate_local_secret(24)
    generated_values = {
        "DEV_MYSQL_ROOT_PASSWORD": existing_vals.get("DEV_MYSQL_ROOT_PASSWORD") or generate_local_secret(20),
        "DB_HOST": existing_vals.get("DB_HOST") or "127.0.0.1",
        "DB_PORT": existing_vals.get("DB_PORT") or "3306",
        "DB_NAME": existing_vals.get("DB_NAME") or "basic_framework",
        "DB_USERNAME": existing_vals.get("DB_USERNAME") or "basic_dev",
        "DB_PASSWORD": db_password,
        "DB_SLAVE_HOST": existing_vals.get("DB_SLAVE_HOST") or "127.0.0.1",
        "DB_SLAVE_PORT": existing_vals.get("DB_SLAVE_PORT") or "3306",
        "DB_SLAVE_NAME": existing_vals.get("DB_SLAVE_NAME") or "basic_framework",
        "DB_SLAVE_USERNAME": existing_vals.get("DB_SLAVE_USERNAME") or "basic_dev",
        "DB_SLAVE_PASSWORD": db_password,
        "REDIS_HOST": existing_vals.get("REDIS_HOST") or "127.0.0.1",
        "REDIS_PORT": existing_vals.get("REDIS_PORT") or "6379",
        "REDIS_PASSWORD": redis_password,
        "SM2_PRIVATE_KEY": existing_vals.get("SM2_PRIVATE_KEY") or generate_sm2_private_key_hex(),
        "MINIO_ENDPOINT": existing_vals.get("MINIO_ENDPOINT") or "http://127.0.0.1:19000",
        "MINIO_PUBLIC_URL": existing_vals.get("MINIO_PUBLIC_URL") or "http://127.0.0.1:19000",
        "MINIO_ACCESS_KEY": minio_access,
        "MINIO_SECRET_KEY": minio_secret,
        "MINIO_BUCKET": existing_vals.get("MINIO_BUCKET") or "basic-framework",
    }

    if not compose_env_path.exists() or force:
        verb = "写入" if apply else "将写入"
        actions.append(f"{verb} .env.dev（本地容器中间件凭据，已脱敏）")
        if apply:
            compose_env_path.write_text(
                render_compose_env(generated_values), encoding="utf-8", newline="\n"
            )
    else:
        actions.append("保留已有 .env.dev（未传 --force 不覆盖）")

    if not backend_env_path.exists() or force:
        verb = "写入" if apply else "将写入"
        actions.append(f"{verb} 后端代码/basic-framework-boot/.env（含随机 SM2 私钥与本地连接串）")
        if apply:
            template_text = template_path.read_text(encoding="utf-8")
            backend_env_path.write_text(
                render_backend_env(template_text, generated_values),
                encoding="utf-8",
                newline="\n",
            )
    else:
        actions.append("保留已有 后端代码/basic-framework-boot/.env（未传 --force 不覆盖）")

    hooks_value = current_hooks_path(resolved_root)
    if (resolved_root / ".git").exists():
        if hooks_value != ".githooks":
            verb = "配置" if apply else "将配置"
            actions.append(f"{verb} git core.hooksPath = .githooks")
            if apply:
                subprocess.run(
                    ["git", "-C", str(resolved_root), "config", "--local", "core.hooksPath", ".githooks"],
                    check=True,
                    capture_output=True,
                    timeout=10,
                )
        else:
            actions.append("git core.hooksPath 已指向 .githooks")

    return BootstrapPlan(
        missing_required_tools=missing_required,
        missing_optional_tools=missing_optional,
        actions=tuple(actions),
        applied=apply,
    )


def build_arg_parser() -> argparse.ArgumentParser:
    """构造命令行参数解析器。"""
    parser = argparse.ArgumentParser(description="本地开发与 Vibe Coding 环境自检及初始化工具")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="仓库根目录")
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument(
        "--dry-run",
        action="store_true",
        help="只读预览自检与拟写入动作，不写入本地文件（默认）",
    )
    mode_group.add_argument("--apply", action="store_true", help="实际写入本地忽略环境文件并挂载 .githooks")
    parser.add_argument("--force", action="store_true", help="与 --apply 联用时覆盖已有本地环境文件")
    return parser


def main(argv: list[str] | None = None) -> int:
    """命令行主入口：输出工具检查与执行动作摘要，不输出任何密钥值。"""
    args = build_arg_parser().parse_args(argv)
    if args.force and not args.apply:
        print("参数错误：--force 必须与 --apply 同时传入。", file=sys.stderr)
        return 2
    plan = bootstrap(args.root, apply=args.apply, force=args.force)
    mode_label = "已执行初始化（--apply）" if plan.applied else "只读预览（默认 --dry-run，传入 --apply 实际生效）"
    print(f"模式：{mode_label}")
    if plan.missing_required_tools:
        print(f"缺失必需工具：{', '.join(plan.missing_required_tools)}")
    else:
        print("必需命令行工具检查通过（git / python / java / mvn / node / pnpm）。")
    if plan.missing_optional_tools:
        print(f"提示：未检测到可选容器工具 {', '.join(plan.missing_optional_tools)}（使用本机已有中间件时可忽略）。")
    for item in plan.actions:
        print(f"- {item}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
