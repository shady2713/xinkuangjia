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
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

sys.dont_write_bytecode = True

DEFAULT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = Path("后端代码") / "basic-framework-boot"
BUCKET_VAR = "MINIO_BUCKET"
PUBLIC_ACCESS_VAR = "MINIO_PUBLIC_ACCESS"
DEFAULT_BUCKET = "basic-framework"
MINIO_PORT_VAR = "MINIO_API_PORT"
MINIO_ENDPOINT_VAR = "MINIO_ENDPOINT"
MINIO_SECURE_VAR = "MINIO_SECURE"
DEFAULT_MINIO_PORT = "19000"
ENDPOINT_ALIASES = (MINIO_ENDPOINT_VAR, "BASICFRAMEWORK_FILE_MINIO_ENDPOINT", "BASIC_FRAMEWORK_FILE_MINIO_ENDPOINT")
SECURE_ALIASES = (MINIO_SECURE_VAR, "BASICFRAMEWORK_FILE_MINIO_SECURE", "BASIC_FRAMEWORK_FILE_MINIO_SECURE")
BUCKET_ALIASES = (BUCKET_VAR, "BASICFRAMEWORK_FILE_MINIO_BUCKET", "BASIC_FRAMEWORK_FILE_MINIO_BUCKET")
ACCESS_ALIASES = (PUBLIC_ACCESS_VAR, "BASICFRAMEWORK_FILE_MINIO_PUBLICACCESS", "BASICFRAMEWORK_FILE_MINIO_PUBLIC_ACCESS",
                  "BASIC_FRAMEWORK_FILE_MINIO_PUBLICACCESS", "BASIC_FRAMEWORK_FILE_MINIO_PUBLIC_ACCESS")
# 国密 SM2 推荐椭圆曲线阶 n，合法私钥整数须严格落在 [1, SM2_CURVE_ORDER - 1]。
SM2_CURVE_ORDER = int("FFFFFFFEFFFFFFFFFFFFFFFFFFFFFFFF7203DF6B21C6052B53BBF40939D54123", 16)
REQUIRED_TOOLS = ("git", "python", "java", "mvn", "node", "pnpm")
OPTIONAL_TOOLS = ("docker",)
# Compose 使用同一份本地生成的桶策略。该路径不进入版本控制。
MINIO_POLICY_RELATIVE_PATH = Path(".e2e-env") / "minio-bucket-policy.json"

if __package__ in (None, ""):
    sys.path.insert(0, str(DEFAULT_ROOT))

from scripts.runtime.render_minio_bucket_policy import render_policy_json

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
        MINIO_PORT_VAR,
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


def minio_fields(path: Path, *, compose: bool = False) -> dict[str, str]:
    """读取 MinIO 设置的字面量，避免 Compose 与 Spring 使用不同的值。"""
    fields = {}
    direct_properties = {
        re.sub(r"[^a-z]", "", alias.lower())
        for alias in (*BUCKET_ALIASES[1:], *ACCESS_ALIASES[1:], *ENDPOINT_ALIASES[1:], *SECURE_ALIASES[1:])
    }
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.lstrip()
        if not line or line.startswith(("#", "!")):
            continue
        if line.endswith("\\") or (match := re.fullmatch(r"([A-Za-z0-9_.-]+)=(.*)", line)) is None:
            raise ValueError(f"{path.name} 必须使用逐行的 KEY=VALUE 配置")
        key, value = match.groups()
        if re.sub(r"[^a-z]", "", key.lower()) in direct_properties:
            raise ValueError(f"{path.name} 的对象存储设置必须使用 MINIO_* 变量")
        if key not in (BUCKET_VAR, PUBLIC_ACCESS_VAR, MINIO_PORT_VAR, MINIO_ENDPOINT_VAR, MINIO_SECURE_VAR):
            continue
        if key in fields or not value or value != value.strip():
            raise ValueError(f"{path.name} 的 {key} 为空、重复或含空白")
        if compose and value[:1] in ("'", '"') and value[-1:] == value[:1]:
            value = value[1:-1]
        if key == MINIO_ENDPOINT_VAR:
            literal = re.fullmatch(r"[A-Za-z0-9.:/\[\]-]+", value)
        else:
            literal = re.fullmatch(r"[A-Za-z0-9.-]+", value)
        if not literal:
            raise ValueError(f"{path.name} 的 {key} 必须是字面量")
        fields[key] = value
    return fields


def effective_bucket(compose: dict[str, str] | None, backend: dict[str, str] | None) -> tuple[str, str]:
    """解析后端和 Compose 的共同桶设置，环境冲突时拒绝继续。"""
    compose_present, backend_present = compose is not None, backend is not None
    compose, backend = compose or {}, backend or {}
    compose_bucket = compose.get(BUCKET_VAR, DEFAULT_BUCKET)
    bucket = backend.get(BUCKET_VAR) if backend_present else compose_bucket
    if not bucket:
        raise ValueError("后端 .env 缺少 MINIO_BUCKET")
    if compose_present and compose_bucket != bucket:
        raise ValueError(".env.dev 与后端 .env 的 MINIO_BUCKET 不一致")
    public = (backend.get(PUBLIC_ACCESS_VAR, "true") if backend_present else compose.get(PUBLIC_ACCESS_VAR, "true")).lower()
    if public not in {"true", "false"}:
        raise ValueError("MINIO_PUBLIC_ACCESS 必须是 true 或 false")
    if PUBLIC_ACCESS_VAR in compose and compose[PUBLIC_ACCESS_VAR].lower() != public:
        raise ValueError(".env.dev 与后端 .env 的 MINIO_PUBLIC_ACCESS 不一致")
    for key in BUCKET_ALIASES:
        if key in os.environ and os.environ[key] != bucket:
            raise ValueError(f"环境变量 {key} 与有效桶名不一致")
    for key in ACCESS_ALIASES:
        if key in os.environ and os.environ[key].lower() != public:
            raise ValueError(f"环境变量 {key} 与有效访问模式不一致")
    return bucket, public


def check_launcher_overrides(args: list[str]) -> None:
    """启动前拒绝 Java 间接选项文件及能覆盖已核验配置的显式参数。"""
    if os.environ.get("SPRING_APPLICATION_JSON"):
        raise ValueError("本地启动入口要求 SPRING_APPLICATION_JSON 为空")
    guarded = {
        "".join(ch for ch in name if ch.isalnum()).upper()
        for name in (*BUCKET_ALIASES, *ACCESS_ALIASES, *ENDPOINT_ALIASES, *SECURE_ALIASES,
                     MINIO_PORT_VAR, "SPRING_APPLICATION_JSON")
    }
    separators = str.maketrans({ch: " " for ch in "\"'=,;|&()<>\x60\\"})
    vm_option_files = ("-XX:VMOptionsFile", "-XX:Flags")
    options = ("JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS", "JAVA_OPTS", "MAVEN_OPTS", "MAVEN_ARGS")
    sources = {key: os.environ.get(key, "") for key in options}
    sources["启动命令"] = " ".join(args)
    for source, text in sources.items():
        if source == "JDK_JAVA_OPTIONS":
            # Java 17 会去掉引号并保留其中的内容；本地入口只核验不带引号的直接参数。
            if '"' in text or "'" in text:
                raise ValueError(f"{source} 仅支持不带引号、以 ASCII 空白分隔的直接参数")
            tokens = [arg.partition("=")[0] for arg in re.findall(r"\S+", text, flags=re.ASCII)]
        else:
            tokens = text.translate(separators).split()
        if any(token.startswith("@") or token in vm_option_files for token in tokens):
            raise ValueError(f"{source} 含间接 Java 参数文件，请直接传入启动选项")
        for index, token in enumerate(tokens):
            if not token.startswith(("-D", "--")):
                continue
            name = token[2:] or (tokens[index + 1] if index + 1 < len(tokens) else "")
            if "".join(ch for ch in name if ch.isalnum()).upper() in guarded:
                raise ValueError(f"{source} 覆盖了 MinIO 配置或 Spring JSON 配置")


def compose_port(compose: Mapping[str, str], env: Mapping[str, str]) -> str:
    """按 Compose 配置取已校验的发布端口，拒绝冲突的进程覆盖值。"""
    file_port = compose.get(MINIO_PORT_VAR)
    process_port = env.get(MINIO_PORT_VAR)
    configured = (port for port in (file_port, process_port) if port is not None)
    if any(not re.fullmatch(r"[0-9]{1,5}", port) or not 1 <= int(port) <= 65535 for port in configured):
        raise ValueError("MINIO_API_PORT 必须为 1 到 65535 之间的十进制端口")
    if file_port is not None and process_port is not None and int(file_port) != int(process_port):
        raise ValueError("环境变量 MINIO_API_PORT 与 .env.dev 不一致")
    return str(int(process_port or file_port or DEFAULT_MINIO_PORT))


def validate_compose_endpoint(port: str, backend_endpoint: str, secure: str, env: Mapping[str, str]) -> str:
    """确认后端文件和调用环境的直连地址指向 Compose 的 HTTP 环回端口。"""
    values = [(MINIO_ENDPOINT_VAR, backend_endpoint)]
    values.extend((key, env[key]) for key in ENDPOINT_ALIASES if key in env)
    for name, value in values:
        match = re.fullmatch(r"(http://)?(?:localhost|127\.0\.0\.1):([0-9]{1,5})/?", value, re.IGNORECASE)
        if match is None or int(match.group(2)) != int(port) or (match.group(1) is None and secure != "false"):
            raise ValueError(f"{name} 的直连地址须与 Compose 发布的 HTTP 环回端口一致")
    return f"http://127.0.0.1:{port}"


def verify_bucket_policy(root: Path, snapshot: Path) -> tuple[str, str, str, str]:
    """核对后端直连地址、桶和策略，并写入本次启动的策略快照。"""
    compose = minio_fields(root / ".env.dev", compose=True)
    backend = minio_fields(root / BACKEND_DIR / ".env")
    bucket, public = effective_bucket(compose, backend)
    port = compose_port(compose, os.environ)
    secure = backend.get(MINIO_SECURE_VAR, "false").lower()
    # Spring 的直接绑定高于占位符，同值的别名可以并存。
    secure_values = {os.environ[name].lower() for name in SECURE_ALIASES if name in os.environ}
    if not {secure, *secure_values} <= {"true", "false"} or len(secure_values) > 1:
        raise ValueError("MINIO_SECURE 的设置无效或不一致")
    effective_secure = next(iter(secure_values), secure)
    endpoint = validate_compose_endpoint(port, backend.get(MINIO_ENDPOINT_VAR, ""), effective_secure, os.environ)
    policy_text = render_policy_json(bucket, "mixed" if public == "true" else "private")
    policy_path = root / MINIO_POLICY_RELATIVE_PATH
    try:
        matches = json.loads(policy_path.read_text(encoding="utf-8")) == json.loads(policy_text)
    except (OSError, ValueError):
        matches = False
    if not matches:
        raise ValueError("MinIO 桶策略与有效配置不一致，请重新运行初始化")
    snapshot.write_text(policy_text, encoding="utf-8", newline="\n")
    return bucket, public, endpoint, port


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
    backend_dir = resolved_root / BACKEND_DIR
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

    active_compose = compose_env_path if not force and compose_env_path.exists() else None
    active_backend = backend_env_path if not force and backend_env_path.exists() else None
    compose_values = minio_fields(active_compose, compose=True) if active_compose else None
    backend_values = minio_fields(active_backend) if active_backend else None
    bucket, public_access = effective_bucket(compose_values, backend_values)
    minio_port = compose_port(compose_values or {}, os.environ)
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
        MINIO_PORT_VAR: minio_port,
        MINIO_ENDPOINT_VAR: f"http://127.0.0.1:{minio_port}",
        "MINIO_PUBLIC_URL": existing_vals.get("MINIO_PUBLIC_URL") or f"http://127.0.0.1:{minio_port}",
        "MINIO_ACCESS_KEY": minio_access,
        "MINIO_SECRET_KEY": minio_secret,
        BUCKET_VAR: bucket,
        PUBLIC_ACCESS_VAR: public_access,
        "MINIO_SIGNING_ENDPOINT": existing_vals.get("MINIO_SIGNING_ENDPOINT", ""),
    }

    minio_mode = "mixed" if public_access == "true" else "private"
    policy_text = render_policy_json(bucket, minio_mode)

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

    # 重新生成策略并保留已有凭据文件，便于同步公开访问配置。
    verb = "写入" if apply else "将写入"
    actions.append(f"{verb} {MINIO_POLICY_RELATIVE_PATH.as_posix()}（MinIO 桶策略，模式 {minio_mode}）")
    if apply:
        policy_path = resolved_root / MINIO_POLICY_RELATIVE_PATH
        policy_path.parent.mkdir(parents=True, exist_ok=True)
        policy_path.write_text(policy_text, encoding="utf-8", newline="\n")

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
    mode_group.add_argument("--check-bucket-policy", metavar="SNAPSHOT", type=Path,
                            help="核对本地桶配置并为 Compose 生成本次启动的策略快照")
    parser.add_argument("--force", action="store_true", help="与 --apply 联用时覆盖已有本地环境文件")
    parser.add_argument("command", nargs=argparse.REMAINDER, help=argparse.SUPPRESS)
    return parser


def main(argv: list[str] | None = None) -> int:
    """命令行主入口：输出工具检查与执行动作摘要，不输出任何密钥值。"""
    args = build_arg_parser().parse_args(argv)
    if args.force and not args.apply:
        print("参数错误：--force 必须与 --apply 同时传入。", file=sys.stderr)
        return 2
    try:
        if args.check_bucket_policy is not None:
            check_launcher_overrides(args.command)
            print(*verify_bucket_policy(args.root, args.check_bucket_policy))
            return 0
        if args.command:
            raise ValueError("启动命令仅适用于 --check-bucket-policy")
        plan = bootstrap(args.root, apply=args.apply, force=args.force)
    except (OSError, ValueError) as error:
        print(f"本地配置校验失败：{error}", file=sys.stderr)
        return 1
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
