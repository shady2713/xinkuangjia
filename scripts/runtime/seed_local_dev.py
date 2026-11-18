#!/usr/bin/env python3
"""本地开发演示种子数据生成与安全灌库助手（严格仅限本机回环地址）。

基线 SQL `数据库文件/basic_framework.sql` 保持生产级最小干净集；
需要本地组织架构与业务管理员演示数据时，由本脚本按幂等 SQL 生成或仅向本机回环 MySQL 导入。

用法：
  python -B -X utf8 scripts/runtime/seed_local_dev.py
  python -B -X utf8 scripts/runtime/seed_local_dev.py --output .local/seed_demo.sql

@author shady2713
"""

from __future__ import annotations

import argparse
import ipaddress
import os
import shutil
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True

LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


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


def render_local_demo_seed_sql() -> str:
    """渲染幂等的本地研发组织架构与业务管理员角色演示 SQL（不含明文密码字面量）。"""
    return """-- 本地研发可选演示种子数据（仅限隔离的本机开发库使用，幂等可重复执行）
REPLACE INTO `system_dept`
    (`id`, `name`, `parent_id`, `sort`, `leader_user_id`, `phone`, `email`, `status`,
     `creator`, `create_time`, `updater`, `update_time`, `deleted`)
VALUES
    (100, '总公司', 0, 0, 1, '', '', 0, 'admin', NOW(), 'admin', NOW(), b'0'),
    (101, '研发中心', 100, 1, 1, '', '', 0, 'admin', NOW(), 'admin', NOW(), b'0'),
    (102, '平台架构组', 101, 1, 1, '', '', 0, 'admin', NOW(), 'admin', NOW(), b'0'),
    (103, '质量保障组', 101, 2, 1, '', '', 0, 'admin', NOW(), 'admin', NOW(), b'0');

REPLACE INTO `system_post`
    (`id`, `code`, `name`, `sort`, `status`, `remark`,
     `creator`, `create_time`, `updater`, `update_time`, `deleted`, `deleted_tag`)
VALUES
    (1, 'arch', '架构师', 1, 0, '本地研发演示岗位', 'admin', NOW(), 'admin', NOW(), b'0', 0),
    (2, 'dev', '研发工程师', 2, 0, '本地研发演示岗位', 'admin', NOW(), 'admin', NOW(), b'0', 0);

REPLACE INTO `system_role`
    (`id`, `name`, `code`, `role_type`, `sort`, `data_scope`, `data_scope_dept_ids`, `status`,
     `type`, `remark`, `creator`, `create_time`, `updater`, `update_time`, `deleted`, `deleted_tag`)
VALUES
    (2, '业务管理员', 'business_admin', 'business_admin', 2, 3, '', 0, 2,
     '本部门数据权限演示角色', 'admin', NOW(), 'admin', NOW(), b'0', 0);
"""


def execute_mysql_seed(
    *, host: str, port: int, user: str, database: str, sql_text: str
) -> int:
    """通过本机 mysql 客户端导入演示数据，密码仅从环境变量 DB_PASSWORD 读取。

    Args:
        host: 已通过回环地址校验的主机名。
        port: 数据库端口。
        user: 数据库用户名。
        database: 目标数据库名。
        sql_text: 待执行的幂等 SQL 文本。
    Returns:
        mysql 进程退出码。
    Raises:
        ValueError: 目标主机不是本机回环地址，或缺少客户端/环境变量时抛出。
    """
    if not is_loopback_host(host):
        raise ValueError(f"安全阻断：seed_local_dev.py 仅允许连接本机回环地址，拒绝主机 '{host}'")
    mysql_bin = shutil.which("mysql") or shutil.which("mysql.exe")
    if mysql_bin is None:
        raise ValueError("未找到 mysql 命令行客户端，请改用 --output 导出 SQL 文件后手动导入")
    env = os.environ.copy()
    db_pass = env.get("DB_PASSWORD", "")
    if db_pass:
        env["MYSQL_PWD"] = db_pass
    completed = subprocess.run(
        [mysql_bin, f"--host={host}", f"--port={port}", f"--user={user}", "--default-character-set=utf8mb4", database],
        input=sql_text,
        text=True,
        encoding="utf-8",
        env=env,
        check=False,
    )
    return completed.returncode


def main(argv: list[str] | None = None) -> int:
    """解析命令行参数并预览、导出或向本机回环数据库导入演示种子。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=None, help="将演示 SQL 写入指定本地文件路径")
    parser.add_argument("--execute", action="store_true", help="通过 mysql 客户端写入本机开发库")
    parser.add_argument("--host", default="127.0.0.1", help="本机数据库地址（仅限回环地址）")
    parser.add_argument("--port", type=int, default=3306, help="本机数据库端口")
    parser.add_argument("--user", default="root", help="本机数据库用户名（密码读取环境变量 DB_PASSWORD）")
    parser.add_argument("--database", default="basic_framework", help="目标本地数据库名")
    args = parser.parse_args(argv)

    if not is_loopback_host(args.host):
        print(
            f"错误：安全阻断——仅允许对本机回环地址执行演示种子，拒绝 '{args.host}'",
            file=sys.stderr,
        )
        return 1

    sql_text = render_local_demo_seed_sql()
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(sql_text, encoding="utf-8", newline="\n")
        print(f"已导出本地演示种子 SQL：{args.output.as_posix()}")
        return 0

    if args.execute:
        try:
            return execute_mysql_seed(
                host=args.host,
                port=args.port,
                user=args.user,
                database=args.database,
                sql_text=sql_text,
            )
        except ValueError as exc:
            print(f"错误：{exc}", file=sys.stderr)
            return 1

    print(sql_text.rstrip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
