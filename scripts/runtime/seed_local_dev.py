#!/usr/bin/env python3
"""本地开发演示种子数据生成与安全灌库助手（严格仅限本机回环地址）。

基线 SQL `数据库文件/basic_framework.sql` 保持生产级最小干净集；
需要本地组织架构、业务管理员演示角色或本地开发管理员初始密码哈希时，
由本脚本按幂等 SQL 预览、导出或仅向本机回环 MySQL 导入。

用法：
  python -B -X utf8 scripts/runtime/seed_local_dev.py
  python -B -X utf8 scripts/runtime/seed_local_dev.py --output .local/seed_demo.sql
  python -B -X utf8 scripts/runtime/seed_local_dev.py --apply

@author shady2713
"""

from __future__ import annotations

import argparse
import ipaddress
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True

DEFAULT_ROOT = Path(__file__).resolve().parents[2]
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
BCRYPT_HASH_RE = re.compile(r"^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$")


def is_loopback_host(host: str) -> bool:
    """校验目标数据库主机是否为严格本机回环地址，防止误连远程或生产数据库。

    Args:
        host: 数据库主机名或 IP 字符串。
    Returns:
        仅在 localhost 或 IPv4/IPv6 回环地址时返回 True。
    """
    cleaned = host.strip().strip("[]").lower()
    if cleaned in LOOPBACK_HOSTS:
        return True
    try:
        return ipaddress.ip_address(cleaned).is_loopback
    except ValueError:
        return False


def load_local_env_defaults(root: Path) -> dict[str, str]:
    """从被 Git 忽略的后端 .env 读取本机连接默认值，不覆盖进程已有环境变量。

    Args:
        root: 仓库根目录。
    Returns:
        解析后的键值对字典；文件不存在时返回空字典。
    """
    env_file = root / "后端代码" / "basic-framework-boot" / ".env"
    if not env_file.is_file():
        return {}
    values: dict[str, str] = {}
    for line in env_file.read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        cleaned = value.strip()
        if cleaned and cleaned[0] in {'"', "'"} and cleaned[-1] == cleaned[0] and len(cleaned) >= 2:
            cleaned = cleaned[1:-1]
        elif " #" in cleaned:
            cleaned = cleaned.split(" #", 1)[0].strip()
        values[key.strip()] = cleaned
    return values


def render_local_demo_seed_sql(
    *,
    admin_password_hash: str | None = None,
    require_password_change: bool = False,
) -> str:
    """渲染幂等的本地研发组织架构与演示角色 SQL（可选写入受控提供的 BCrypt 哈希）。

    Args:
        admin_password_hash: 可选标准 BCrypt 哈希（$2a$/$2b$/$2y$），提供时更新本地 admin 口令。
        require_password_change: 更新本地 admin 口令时是否保留首次强制改密标记。
    Returns:
        可重复执行的幂等 MySQL 8 种子脚本。
    Raises:
        ValueError: 传入的密码哈希不符合标准 BCrypt 格式时抛出。
    """
    sql = """-- 本地研发可选演示种子数据（仅限隔离的本机开发库使用，幂等且不覆盖基线默认组织）
INSERT IGNORE INTO `system_dept`
    (`id`, `name`, `parent_id`, `sort`, `leader_user_id`, `phone`, `email`, `status`,
     `creator`, `create_time`, `updater`, `update_time`, `deleted`, `role_type`)
VALUES
    (900, '本地研发演示部', 100, 90, 1, '', '', 0, 'admin', NOW(), 'admin', NOW(), b'0', 'super_admin'),
    (901, '本地质量保障组', 900, 1, 1, '', '', 0, 'admin', NOW(), 'admin', NOW(), b'0', 'super_admin');

INSERT IGNORE INTO `system_role`
    (`id`, `name`, `code`, `role_type`, `sort`, `data_scope`, `data_scope_dept_ids`, `status`,
     `type`, `remark`, `creator`, `create_time`, `updater`, `update_time`, `deleted`, `deleted_tag`)
VALUES
    (900, '本地演示业务角色', 'demo_business_role', 'business_admin', 90, 3, '', 0, 2,
     '本部门数据权限本地演示角色', 'admin', NOW(), 'admin', NOW(), b'0', 0);
"""
    if admin_password_hash is not None:
        cleaned_hash = admin_password_hash.strip()
        if not BCRYPT_HASH_RE.fullmatch(cleaned_hash):
            raise ValueError("admin_password_hash 必须为标准 60 位 BCrypt 哈希（$2a$/$2b$/$2y$）")
        flag_literal = "b'1'" if require_password_change else "b'0'"
        pwd_col = "`password`"
        sql += (
            "\nUPDATE `system_users`\n"
            f"SET {pwd_col} = '{cleaned_hash}', `password_change_required` = {flag_literal}, `update_time` = NOW()\n"
            "WHERE `id` = 1 AND `username` = 'admin' AND `deleted` = b'0';\n"
        )
    return sql


def execute_mysql_seed(
    *,
    host: str,
    port: int,
    user: str,
    database: str,
    sql_text: str,
    password: str | None = None,
    default_port: int = 3306,
) -> int:
    """通过本机 mysql 客户端导入演示数据，密码仅从参数或环境受控传递。

    Args:
        host: 已通过回环地址校验的主机名。
        port: 数据库端口。
        user: 数据库用户名。
        database: 目标数据库名。
        sql_text: 待执行的幂等 SQL 文本。
        password: 数据库密码（不写入命令行参数，仅通过 MYSQL_PWD 环境变量传递）。
        default_port: Docker Compose MySQL 默认暴露端口，用于识别非默认端口并拒绝静默误连。
    Returns:
        mysql 进程退出码。
    Raises:
        ValueError: 目标主机不是本机回环地址、Docker 回退模式传入非匹配端口或缺少客户端时抛出。
    """
    if not is_loopback_host(host):
        raise ValueError(f"安全阻断：seed_local_dev.py 仅允许连接本机回环地址，拒绝主机 '{host}'")
    mysql_bin = shutil.which("mysql") or shutil.which("mysql.exe")
    env = os.environ.copy()
    db_pass = env.get("DB_PASSWORD", "") if password is None else password
    if mysql_bin is not None:
        if db_pass:
            env["MYSQL_PWD"] = db_pass
        cmd = [
            mysql_bin,
            f"--host={host}",
            f"--port={port}",
            f"--user={user}",
            "--default-character-set=utf8mb4",
            database,
        ]
    else:
        normalized_host = host.strip().strip("[]").lower()
        if normalized_host not in LOOPBACK_HOSTS or port != default_port:
            raise ValueError(
                "未找到本机 mysql 客户端，Docker Compose 回退路径仅支持默认回环容器端口 "
                f"({default_port})，拒绝目标 '{host}:{port}'"
            )
        docker_bin = shutil.which("docker") or shutil.which("docker.exe")
        compose_file = DEFAULT_ROOT / "docker-compose.dev.yml"
        if docker_bin is None or not compose_file.is_file():
            raise ValueError("未找到 mysql 或 docker 命令行客户端，请改用 --output 导出 SQL 文件后手动导入")
        if db_pass:
            env["MYSQL_PWD"] = db_pass
        env_dev_file = DEFAULT_ROOT / ".env.dev"
        env_file_args = ["--env-file", str(env_dev_file)] if env_dev_file.is_file() else []
        env_pass_args = ["-e", "MYSQL_PWD"] if db_pass else []
        cmd = [
            docker_bin,
            "compose",
            *env_file_args,
            "-f",
            str(compose_file),
            "exec",
            "-T",
            *env_pass_args,
            "mysql",
            "mysql",
            f"--user={user}",
            "--default-character-set=utf8mb4",
            database,
        ]
    completed = subprocess.run(
        cmd,
        input=sql_text,
        text=True,
        encoding="utf-8",
        env=env,
        check=False,
        timeout=60,
    )
    return completed.returncode


def main(argv: list[str] | None = None) -> int:
    """解析命令行参数并预览、导出或向本机回环数据库导入演示种子。"""
    local_env = load_local_env_defaults(DEFAULT_ROOT)
    default_host = os.environ.get("DB_HOST") or local_env.get("DB_HOST") or "127.0.0.1"
    default_port = int(os.environ.get("DB_PORT") or local_env.get("DB_PORT") or "3306")
    default_user = os.environ.get("DB_USERNAME") or local_env.get("DB_USERNAME") or "basic_dev"
    default_db = os.environ.get("DB_NAME") or local_env.get("DB_NAME") or "basic_framework"
    default_pass = os.environ.get("DB_PASSWORD") or local_env.get("DB_PASSWORD") or ""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=None, help="将演示 SQL 写入指定本地文件路径")
    parser.add_argument(
        "--apply",
        "--execute",
        dest="apply",
        action="store_true",
        help="通过本机 mysql 客户端写入回环开发库（--execute 为兼容别名）",
    )
    parser.add_argument("--host", default=default_host, help="本机数据库地址（仅限回环地址）")
    parser.add_argument("--port", type=int, default=default_port, help="本机数据库端口")
    parser.add_argument(
        "--user",
        default=default_user,
        help="本机数据库用户名（默认读取 DB_USERNAME 或 .env，回退 basic_dev）",
    )
    parser.add_argument("--database", default=default_db, help="目标本地数据库名")
    parser.add_argument(
        "--admin-password-hash",
        default=os.environ.get("SEED_ADMIN_PASSWORD_HASH") or None,
        help="可选 60 位 BCrypt 哈希（也可通过 SEED_ADMIN_PASSWORD_HASH 注入），用于初始化本地 admin 登录口令",
    )
    parser.add_argument(
        "--require-password-change",
        action="store_true",
        help="初始化本地 admin 口令后仍保留首次登录强制改密标记",
    )
    args = parser.parse_args(argv)

    if not is_loopback_host(args.host):
        print(
            f"错误：安全阻断——仅允许对本机回环地址执行演示种子，拒绝 '{args.host}'",
            file=sys.stderr,
        )
        return 1

    try:
        sql_text = render_local_demo_seed_sql(
            admin_password_hash=args.admin_password_hash,
            require_password_change=args.require_password_change,
        )
    except ValueError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1

    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(sql_text, encoding="utf-8", newline="\n")
        print(f"已导出本地演示种子 SQL：{args.output.as_posix()}")
        return 0

    if args.apply:
        try:
            effective_pass = default_pass if args.user == default_user else os.environ.get("MYSQL_PWD", "")
            code = execute_mysql_seed(
                host=args.host,
                port=args.port,
                user=args.user,
                database=args.database,
                sql_text=sql_text,
                password=effective_pass,
                default_port=default_port,
            )
            if code == 0 and args.admin_password_hash is None:
                print(
                    "提示：未传入 --admin-password-hash 或 SEED_ADMIN_PASSWORD_HASH，"
                    "基线 SQL 中 admin 密码为空，登录前请按 docs/开发指南/SM2密码传输与密码策略.md 写入 BCrypt 哈希。"
                )
            return code
        except ValueError as exc:
            print(f"错误：{exc}", file=sys.stderr)
            return 1

    print(sql_text.rstrip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
