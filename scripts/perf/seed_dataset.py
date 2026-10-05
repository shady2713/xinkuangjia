"""向显式指定的隔离库写入可复现的合成数据集，供性能基线在固定数据规模下重复测量。

工具只接受明确的单库目标和再次确认的同名库，拒绝把数据集写入未确认的库；数据集由固定
常量与序号生成，不含任何真实用户、凭据或私有材料。写入是幂等的：先按前缀删除上次的
合成行，再重新插入，因此重复执行不会累积。

连接凭据从进程环境读取；MySQL 客户端路径取自 BF_PERF_MYSQL_CLIENT，与仓库既有测试
约定一致，未提供时明确失败而不猜测本机客户端位置。

@author 李杰
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from typing import Sequence

USER_PREFIX = "perf_user_"
DICT_PREFIX = "perf_dict_"
# 合成用户的 BCrypt 口令占位：口令本身不是本工具的输入，只保证列结构可用。
SYNTHETIC_PASSWORD = "$2a$10$0123456789012345678901uJZ0kQ0Z8pXkQ0m7x0Y0r0m7x0Y0r0m7x"
CLIENT_ENV = "BF_PERF_MYSQL_CLIENT"


class SeedFailure(RuntimeError):
    """环境或目标确认失败；不代表数据集已写入。"""


def _client() -> str:
    """返回显式配置的 MySQL 客户端入口。"""

    client = os.environ.get(CLIENT_ENV, "")
    if not client or not os.path.isfile(client):
        raise SeedFailure(f"缺少可执行的 MySQL 客户端：请设置 {CLIENT_ENV} 指向实际客户端")
    return client


def _execute(client: str, host: str, port: str, database: str, statement: str) -> None:
    """在已确认的目标库执行一条语句，失败时保留数据库返回的真实原因。

    Args:
        client: MySQL 客户端可执行文件路径。
        host: 数据库主机。
        port: 数据库端口。
        database: 已确认的单库名。
        statement: 待执行语句；不包含凭据。
    Raises:
        SeedFailure: 客户端缺失凭据或执行失败。
    """

    password = os.environ.get("BF_PERF_MYSQL_PASSWORD", "")
    user = os.environ.get("BF_PERF_MYSQL_USERNAME", "")
    if not user or not password:
        raise SeedFailure("缺少数据库凭据：请注入 BF_PERF_MYSQL_USERNAME 与 BF_PERF_MYSQL_PASSWORD")
    environment = dict(os.environ)
    environment["MYSQL_PWD"] = password
    command = [client, "--protocol=TCP", f"--host={host}", f"--port={port}",
               f"--user={user}", f"--database={database}", "--default-character-set=utf8mb4",
               "--batch", "--skip-column-names", "--execute", statement]
    completed = subprocess.run(command, env=environment, capture_output=True, text=True, timeout=300)
    if completed.returncode != 0:
        raise SeedFailure(f"数据集语句执行失败：{completed.stderr.strip()[:400]}")


def _insert_users(count: int, chunk: int, user_type: str) -> list[str]:
    """生成按序号命名的合成用户插入语句，覆盖固定数据规模维度。

    Args:
        count: 目标用户行数。
        chunk: 单条语句插入的行数，避免单次语句过大。
        user_type: 合成用户的平台类型；必须与测量所用登录入口的平台一致，
            否则分页查询会按平台过滤掉全部合成行，数据规模维度失去意义。
    Returns:
        可直接执行的语句列表。
    """

    statements = []
    for start in range(1, count + 1, chunk):
        end = min(start + chunk - 1, count)
        values = ",".join(
            "('{prefix}{index:06d}','{password}','性能用户{index}',0,'{user_type}','perf-dataset',"
            "'1',NOW(),'1',NOW(),b'0')".format(prefix=USER_PREFIX, index=index,
                                               password=SYNTHETIC_PASSWORD, user_type=user_type)
            for index in range(start, end + 1))
        statements.append(
            "INSERT INTO system_users (username, password, nickname, status, user_type, remark,"
            " creator, create_time, updater, update_time, deleted) VALUES " + values)
    return statements


def _insert_dict_types(count: int, chunk: int) -> list[str]:
    """生成按序号命名的合成字典类型插入语句，使配置类分页查询具有真实表规模。"""

    statements = []
    for start in range(1, count + 1, chunk):
        end = min(start + chunk - 1, count)
        values = ",".join(
            "('性能字典{index}','{prefix}{index:06d}',0,'perf-dataset','1',NOW(),'1',NOW(),b'0')".format(
                prefix=DICT_PREFIX, index=index)
            for index in range(start, end + 1))
        statements.append(
            "INSERT INTO system_dict_type (name, type, status, remark, creator, create_time,"
            " updater, update_time, deleted) VALUES " + values)
    return statements


def seed(client: str, host: str, port: str, database: str, users: int, dicts: int, chunk: int,
         user_type: str) -> tuple[int, int]:
    """重建合成数据集并返回实际写入的行数。

    Args:
        client: MySQL 客户端路径。
        host: 数据库主机。
        port: 数据库端口。
        database: 已确认的单库名。
        users: 合成用户行数。
        dicts: 合成字典类型行数。
        chunk: 单条插入语句的行数。
        user_type: 合成用户的平台类型。
    Returns:
        实际写入的用户行数与字典类型行数。
    Raises:
        SeedFailure: 目标确认不一致或任一步执行失败。
    """

    # 只删除本工具与测量探针前缀的合成行，不动任何真实数据；逻辑删除语义保持原样。
    # 用户名与字典编码受唯一约束约束（软删除行仍占用），重建前必须清除上一轮探针行。
    _execute(client, host, port, database,
             f"DELETE FROM system_users WHERE username LIKE '{USER_PREFIX}%'"
             " OR username LIKE 'w7probe%'")
    _execute(client, host, port, database,
             f"DELETE FROM system_dict_type WHERE type LIKE '{DICT_PREFIX}%'"
             " OR type LIKE 'w7\\_perf\\_%'")
    for statement in _insert_users(users, chunk, user_type):
        _execute(client, host, port, database, statement)
    for statement in _insert_dict_types(dicts, chunk):
        _execute(client, host, port, database, statement)
    return users, dicts


def main(argv: Sequence[str] | None = None) -> int:
    """校验目标库并写入合成数据集；退出 0 表示写入完成，2 表示环境或目标不可用。

    Args:
        argv: 命令行参数；省略时读取真实进程参数。
    Returns:
        0 表示数据集已就绪；2 表示目标未确认或执行失败。
    """

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, help="本次写入的单库名")
    parser.add_argument("--confirm-database", required=True, help="必须与 --database 完全一致")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default="3306")
    parser.add_argument("--users", type=int, default=5000)
    parser.add_argument("--dicts", type=int, default=300)
    parser.add_argument("--chunk", type=int, default=200)
    parser.add_argument("--user-type", default="super_admin",
                        help="合成用户平台类型，必须与测量登录入口的平台一致")
    args = parser.parse_args(argv)
    if args.database != args.confirm_database:
        print("目标库确认不一致，拒绝写入", file=sys.stderr)
        return 2
    if args.users < 0 or args.dicts < 0 or args.chunk <= 0:
        print("行数与分块大小必须是非负数与正整数", file=sys.stderr)
        return 2
    try:
        client = _client()
        users, dicts = seed(client, args.host, args.port, args.database, args.users, args.dicts,
                            args.chunk, args.user_type)
    except SeedFailure as error:
        print(f"数据集准备失败：{error}", file=sys.stderr)
        return 2
    print(f"合成数据集已就绪：{args.database} 用户 {users} 行、字典类型 {dicts} 行")
    return 0


if __name__ == "__main__":
    sys.exit(main())
