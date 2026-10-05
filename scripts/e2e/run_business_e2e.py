"""准备隔离 MySQL、种子管理员、真实后端与前端预览，并执行浏览器业务端到端测试。

本入口只使用本次运行自建的随机库、临时目录与独占 Redis 逻辑库：Redis 目标只有在确认
为空并成功写入本次运行的所有权标记后才算取得，回收时再次校验该标记，因此预置的外部数据
和并发运行的数据都不会被清空。退出时按记录的精确 PID 跨平台回收进程并删除本次取得的
资源，不使用按名匹配的进程清理；缺少连接变量、后端、浏览器或构建产物时明确失败，不跳过用例。

运行（仓库根）：

    python -B -X utf8 scripts/e2e/run_business_e2e.py

退出码：0 表示用例真实通过；1 表示用例失败或存在被跳过、依赖重试的用例；2 表示环境准备、
依赖、资源编排失败或本次取得的资源未能完整回收。

连接变量从进程环境读取，凭据不写入仓库文件、日志或命令参数：
AUTH_TEST_MYSQL_URL、AUTH_TEST_MYSQL_USERNAME、AUTH_TEST_MYSQL_PASSWORD、
BF_TEST_REDIS_PORT、BF_TEST_REDIS_PASSWORD、
BF_TEST_S3_ENDPOINT、BF_TEST_S3_ACCESS_KEY、BF_TEST_S3_SECRET_KEY。
可选 BF_TEST_MYSQL_CLIENT 指定 MySQL 客户端入口，未设置时使用 PATH 上的 mysql。
可选 --redis-database 显式指定 Redis 逻辑库；缺省在 1–15 中自动挑选空库。

@author 李杰
"""

from __future__ import annotations

import argparse
import http.client
import json
import mimetypes
import os
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import BinaryIO, Callable

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_ROOT = REPOSITORY_ROOT / "前端代码" / "basic-framework-admin"
BACKEND_ROOT = REPOSITORY_ROOT / "后端代码" / "basic-framework-boot"
DEFAULT_JAR = BACKEND_ROOT / "basic-framework-server" / "target" / "basic-framework-server.jar"
SCHEMA_FILE = REPOSITORY_ROOT / "数据库文件" / "basic_framework.sql"
PLAYWRIGHT_CONFIG = "apps/web-ele/playwright.business.config.ts"

# 运行期配置覆盖：图形验证码需要人工拖动，浏览器自动化无法完成，因此与后端
# BASIC_FRAMEWORK_CAPTCHA_ENABLE=false 同步关闭；覆盖只作用于本次运行的 dist 副本。
CAPTCHA_PATTERN = re.compile(r"(VITE_APP_CAPTCHA_ENABLE\s*:\s*)(['\"])[^'\"]*\2")
CAPTCHA_OVERRIDE = r"\1'false'"

# 后端启动必需、又必须由本次环境显式提供的变量；缺失即失败，不使用仓库默认值。
REQUIRED_MYSQL = ("AUTH_TEST_MYSQL_URL", "AUTH_TEST_MYSQL_USERNAME", "AUTH_TEST_MYSQL_PASSWORD")
REQUIRED_REDIS = ("BF_TEST_REDIS_PORT", "BF_TEST_REDIS_PASSWORD")
REQUIRED_S3 = ("BF_TEST_S3_ENDPOINT", "BF_TEST_S3_ACCESS_KEY", "BF_TEST_S3_SECRET_KEY")
DATABASE_PREFIX = "bf_e2e_"
DATABASE_PATTERN = re.compile(r"bf_e2e_[0-9a-f]{12}")
# Redis 独占所有权：只有标记键的值等于本次运行随机令牌时，才允许清空该逻辑库。
# 标记键带存活时间，异常退出后仍能在有效期内阻止其他运行把该库当成空库复用。
REDIS_LOCK_KEY = "bf-business-e2e:owner"
REDIS_LOCK_VALUE_PREFIX = "bf-business-e2e/v1:"
REDIS_LOCK_TTL_SECONDS = 6 * 3600
# 未显式指定逻辑库时的候选编号；0 号共享库始终排除，超出服务端 databases 的编号会被跳过。
REDIS_DATABASE_CANDIDATES = tuple(range(1, 16))
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade",
}
# 代理转发与健康检查都只访问环回地址，必须绕开机器代理。
NO_PROXY_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class EnvironmentFailure(RuntimeError):
    """本次运行的前置环境或资源编排失败；不代表被测业务用例通过或失败。"""


def log(message: str) -> None:
    """输出本次运行的可核对进度，不包含凭据、令牌或完整环境。

    Args:
        message: 已脱敏的单行进度说明。
    """
    print(f"[业务 e2e] {message}", flush=True)


def parse_jdbc_url(url: str) -> tuple[str, int, str]:
    """从隔离库连接地址取出主机、端口和可选库名。

    Args:
        url: 形如 jdbc:mysql://主机:端口/库名 的连接地址，库名可省略。
    Returns:
        主机、端口与库名；未提供库名时返回空字符串。
    Raises:
        EnvironmentFailure: 协议不符、缺少主机或端口、内嵌凭据或端口越界。
    """
    if not url.startswith("jdbc:mysql://"):
        raise EnvironmentFailure("AUTH_TEST_MYSQL_URL 必须是 jdbc:mysql:// 连接地址")
    remainder = url[len("jdbc:mysql://"):]
    authority, _, path = remainder.partition("/")
    if "@" in authority or not authority:
        raise EnvironmentFailure("AUTH_TEST_MYSQL_URL 不允许内嵌账号密码")
    host, separator, port_text = authority.partition(":")
    if not separator or not host:
        raise EnvironmentFailure("AUTH_TEST_MYSQL_URL 必须显式包含主机与端口")
    if not port_text.isdigit() or not 0 < int(port_text) < 65536:
        raise EnvironmentFailure("AUTH_TEST_MYSQL_URL 的端口不是有效范围")
    database = path.partition("?")[0]
    if database and not re.fullmatch(r"[A-Za-z0-9_]{1,64}", database):
        raise EnvironmentFailure("AUTH_TEST_MYSQL_URL 的库名不是单库普通标识")
    return host, int(port_text), database


def isolated_environment(environment: dict[str, str]) -> dict[str, str]:
    """复制子进程环境并清除机器代理，避免环回请求被代理劫持。

    Args:
        environment: 父进程环境快照。
    Returns:
        删除 HTTP 代理变量并补充环回例外的新环境。
    """
    result = dict(environment)
    bypass = ["127.0.0.1", "localhost", "::1"]
    for key in tuple(result):
        lowered = key.lower()
        if lowered in {"http_proxy", "https_proxy", "all_proxy", "ftp_proxy", "node_use_env_proxy"}:
            del result[key]
        elif lowered == "no_proxy":
            bypass.extend(part.strip() for part in result.pop(key).split(",") if part.strip())
    merged = ",".join(dict.fromkeys(bypass))
    result.update(NO_PROXY=merged, no_proxy=merged)
    return result


def apply_runtime_overrides(source: str) -> str:
    """关闭构建产物中的图形验证码开关，其他运行期配置保持原样。

    Args:
        source: 构建产物 `_app.config.js` 的完整文本。
    Returns:
        只替换验证码开关后的文本。
    Raises:
        EnvironmentFailure: 未找到唯一可替换的验证码开关，避免静默沿用开启状态。
    """
    replaced, count = CAPTCHA_PATTERN.subn(CAPTCHA_OVERRIDE, source)
    if count != 1:
        raise EnvironmentFailure("构建产物的验证码开关不是唯一可覆盖项，拒绝继续")
    return replaced


def prepare_served_dist(dist_root: Path, target: Path) -> None:
    """复制生产产物到临时目录并写入本次运行的验证码覆盖。

    Args:
        dist_root: 当前生产构建输出目录。
        target: 本次运行专用、由调用者回收的副本目录。
    Raises:
        EnvironmentFailure: 缺少构建产物或运行期配置文件。
    """
    if not (dist_root / "index.html").is_file() or not (dist_root / "_app.config.js").is_file():
        raise EnvironmentFailure("缺少生产构建产物，请先执行 pnpm build:ele")
    shutil.copytree(dist_root, target)
    config = target / "_app.config.js"
    config.write_text(apply_runtime_overrides(config.read_text(encoding="utf-8")), encoding="utf-8")


def encode_resp_command(*parts: str) -> bytes:
    """按 RESP 协议编码命令，用于清理专用 Redis 逻辑库。

    Args:
        parts: 命令名与参数，按顺序发送。
    Returns:
        可直接写入 Redis 连接的字节串。
    """
    encoded = [f"*{len(parts)}\r\n".encode()]
    for part in parts:
        payload = part.encode("utf-8")
        encoded.append(b"$" + str(len(payload)).encode() + b"\r\n" + payload + b"\r\n")
    return b"".join(encoded)


def read_resp_value(stream: BinaryIO) -> str:
    """读取一条 Redis 回复并转换为可直接比较的文本。

    支持状态、整数与批量字符串回复；空批量回复（nil）返回空字符串，便于按值比较所有权标记。

    Args:
        stream: 已连接的 Redis 套接字文件对象。
    Returns:
        状态与整数回复返回去前缀的文本，批量回复返回正文，nil 回复返回空字符串。
    Raises:
        EnvironmentFailure: 连接提前结束、回复格式不受支持或服务端返回错误。
    """
    try:
        line = stream.readline()
    except OSError as error:
        raise EnvironmentFailure("Redis 回复无法读取") from error
    if not line:
        raise EnvironmentFailure("Redis 未返回结果")
    text = line.decode("utf-8", "replace").rstrip("\r\n")
    if not text:
        raise EnvironmentFailure("Redis 返回了空回复行")
    prefix, payload = text[0], text[1:]
    if prefix == "-":
        raise EnvironmentFailure(f"Redis 拒绝了命令：{payload[:80]}")
    if prefix in "+:":
        return payload
    if prefix == "$":
        if payload == "-1":
            return ""
        if not payload.isdigit():
            raise EnvironmentFailure("Redis 批量回复的长度不是数字")
        length = int(payload)
        try:
            data = stream.read(length + 2)
        except OSError as error:
            raise EnvironmentFailure("Redis 批量回复无法读取") from error
        if len(data) != length + 2 or not data.endswith(b"\r\n"):
            raise EnvironmentFailure("Redis 批量回复不完整")
        return data[:-2].decode("utf-8", "replace")
    raise EnvironmentFailure("Redis 回复类型不受支持")


def redis_command(connection: socket.socket, stream: BinaryIO, *parts: str) -> str:
    """在已连接的 Redis 上发送一条命令并返回其文本回复。

    Args:
        connection: 已建立的 Redis 套接字。
        stream: 同一套接字的读取文件对象。
        parts: 命令名与参数，按发送顺序排列。
    Returns:
        回复文本；空批量回复返回空字符串。
    Raises:
        EnvironmentFailure: 命令为空、发送失败、回复不可解析或服务端返回错误。
    副作用:
        向 Redis 写入一条命令，可能修改当前所选逻辑库的状态。
    """
    if not parts or not parts[0]:
        raise EnvironmentFailure("Redis 命令不能为空")
    try:
        connection.sendall(encode_resp_command(*parts))
    except OSError as error:
        raise EnvironmentFailure(f"Redis 命令 {parts[0]} 无法发送") from error
    return read_resp_value(stream)


def connect_redis(host: str, port: int, password: str) -> tuple[socket.socket, BinaryIO]:
    """建立到隔离 Redis 的连接并按需认证，此时尚未选择逻辑库。

    Args:
        host: 隔离 Redis 主机，本次运行只访问环回地址。
        port: Redis 端口。
        password: 本次隔离环境的连接口令；为空时跳过认证。
    Returns:
        已连接的套接字与其二进制读取流；调用方负责关闭两者。
    Raises:
        EnvironmentFailure: 无法建立连接或认证被拒绝。
    副作用:
        打开一条 TCP 连接；认证失败时立即关闭，不留下半开连接。
    """
    try:
        connection = socket.create_connection((host, port), timeout=5)
        stream = connection.makefile("rb")
    except OSError as error:
        raise EnvironmentFailure("Redis 无法连接") from error
    try:
        if password:
            redis_command(connection, stream, "AUTH", password)
    except EnvironmentFailure:
        stream.close()
        connection.close()
        raise
    return connection, stream


@dataclass(frozen=True)
class RedisOwnership:
    """记录本次运行已成功取得的 Redis 逻辑库独占所有权。

    Attributes:
        host: 隔离 Redis 主机。
        port: Redis 端口。
        password: 本次隔离环境的连接口令，只用于回收。
        database: 已取得独占的逻辑库编号。
        token: 写入所有权标记键的本次运行随机令牌，回收时用于确认归属。
    """

    host: str
    port: int
    password: str
    database: int
    token: str


def claim_redis_database(host: str, port: int, password: str,
                         requested: int | None) -> RedisOwnership:
    """在可证明为空的逻辑库写入本次运行的所有权标记，取得该库的独占使用权。

    全过程只读取键数量并写入一个带存活时间的标记键，不清空、不覆盖任何已有键：非空库
    一律跳过（自动模式）或明确失败（显式指定），因此预置的外部数据不会被改动。
    自动模式按候选顺序跳过非空、被占用或服务端不存在的逻辑库，找到第一个可用空库即停。

    Args:
        host: 隔离 Redis 主机。
        port: Redis 端口。
        password: 本次隔离环境的连接口令。
        requested: 命令行显式指定的逻辑库编号；为空时自动挑选候选空库。
    Returns:
        已取得独占的逻辑库编号与本次运行随机令牌。
    Raises:
        EnvironmentFailure: 连接失败、指定 0 号共享库、指定库不可用或非空、
            标记写入失败，以及候选库全部不可用。
    副作用:
        在选中的空库写入所有权标记键（带存活时间），不修改其他键与其他逻辑库。
    """
    if requested == 0:
        raise EnvironmentFailure("拒绝使用共享的 Redis 0 号库，请指定专用逻辑库编号")
    candidates = (requested,) if requested is not None else REDIS_DATABASE_CANDIDATES
    token = REDIS_LOCK_VALUE_PREFIX + secrets.token_hex(16)
    skipped: list[str] = []
    connection, stream = connect_redis(host, port, password)
    try:
        for database in candidates:
            try:
                redis_command(connection, stream, "SELECT", str(database))
            except EnvironmentFailure as error:
                if requested is not None:
                    raise EnvironmentFailure(
                        f"Redis 逻辑库 {database} 不可用：{error}") from error
                skipped.append(f"{database} 号不可用")
                continue
            size = redis_command(connection, stream, "DBSIZE")
            if size != "0":
                # 非空库一律不碰：标记键属于本次协议时说明是并发运行，否则是外部数据。
                holder = redis_command(connection, stream, "GET", REDIS_LOCK_KEY)
                reason = ("已被另一次业务端到端运行占用"
                          if holder.startswith(REDIS_LOCK_VALUE_PREFIX)
                          else f"已有 {size} 个键，不属于本次运行")
                if requested is not None:
                    raise EnvironmentFailure(
                        f"Redis 逻辑库 {database} {reason}，拒绝清理或复用；"
                        "请人工确认后改用其他库")
                skipped.append(f"{database} 号被占用")
                continue
            reply = redis_command(connection, stream, "SET", REDIS_LOCK_KEY, token,
                                  "NX", "EX", str(REDIS_LOCK_TTL_SECONDS))
            if reply.upper() != "OK":
                holder = redis_command(connection, stream, "GET", REDIS_LOCK_KEY)
                owner = "另一次业务端到端运行" if holder.startswith(REDIS_LOCK_VALUE_PREFIX) \
                    else "未知持有者"
                raise EnvironmentFailure(
                    f"Redis 逻辑库 {database} 已被{owner}占用，拒绝复用或清理")
            return RedisOwnership(host, port, password, database, token)
        raise EnvironmentFailure(
            "没有可用的隔离 Redis 逻辑库：" + "、".join(skipped)
            + "；请提供专用实例或人工清理残留标记")
    finally:
        stream.close()
        connection.close()


def release_redis_database(ownership: RedisOwnership) -> None:
    """确认所有权标记仍属于本次运行后清空该逻辑库，未确认时拒绝清理。

    标记键与本次运行写入的数据一同被清空，逻辑库恢复到取得所有权之前的空状态。
    只有标记值仍等于本次运行令牌时才执行 FLUSHDB，避免清掉已被其他运行接管的库。

    Args:
        ownership: 本次运行成功取得的所有权记录。
    Raises:
        EnvironmentFailure: 连接失败、所有权标记已变更或清理命令被拒绝。
    副作用:
        仅当标记值等于本次运行令牌时清空该逻辑库，并随 FLUSHDB 删除标记键。
    """
    connection, stream = connect_redis(ownership.host, ownership.port, ownership.password)
    try:
        redis_command(connection, stream, "SELECT", str(ownership.database))
        current = redis_command(connection, stream, "GET", REDIS_LOCK_KEY)
        if current != ownership.token:
            raise EnvironmentFailure(
                f"Redis 逻辑库 {ownership.database} 的所有权标记已变更，"
                "拒绝清理非本次运行的数据")
        redis_command(connection, stream, "FLUSHDB")
    finally:
        stream.close()
        connection.close()


def free_port(port: int) -> bool:
    """判断环回端口当前是否空闲，避免复用陈旧服务。

    Args:
        port: 待检查的 TCP 端口。
    Returns:
        可以立即绑定时为 True。
    """
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def wait_for_http(url: str, timeout: int, process: subprocess.Popen | None = None) -> None:
    """轮询真实 HTTP 探针直到就绪，超时或进程提前退出即失败。

    Args:
        url: 只访问环回地址的就绪探针。
        timeout: 等待秒数上限。
        process: 同一环境的服务进程；提前退出时立即失败。
    Raises:
        EnvironmentFailure: 超时、探针不可达或服务进程提前结束。
    """
    deadline = time.monotonic() + timeout
    last_error = "未发起请求"
    while time.monotonic() < deadline:
        if process is not None and process.poll() is not None:
            raise EnvironmentFailure(f"服务进程提前退出，退出码 {process.returncode}")
        try:
            with NO_PROXY_OPENER.open(url, timeout=5) as response:
                if response.status == 200:
                    return
                last_error = f"探针返回 {response.status}"
        except (OSError, urllib.error.URLError) as error:
            last_error = type(error).__name__
        time.sleep(1)
    raise EnvironmentFailure(f"服务未在 {timeout} 秒内就绪：{last_error}")


def running_on_windows() -> bool:
    """判断当前平台是否为 Windows，用于选择受支持的进程回收分支。

    Returns:
        Windows 上为 True，其他平台为 False。
    """
    return os.name == "nt"


def windows_tree_kill_command(pid: int) -> list[str] | None:
    """构造 Windows 下按精确 PID 回收整棵进程树的 taskkill 命令。

    Args:
        pid: 本次运行启动的根进程 PID；命令只按该 PID 匹配，不按进程名匹配。
    Returns:
        可直接执行的命令数组；系统缺少 taskkill 时返回 None，由调用方回退到按 PID 结束。
    """
    executable = shutil.which("taskkill")
    if not executable:
        candidate = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "taskkill.exe"
        executable = str(candidate) if candidate.is_file() else None
    if not executable:
        return None
    return [executable, "/PID", str(pid), "/T", "/F"]


def _terminate_posix_process(process: subprocess.Popen, pid: int, name: str, grace: int) -> None:
    """在 POSIX 上结束子进程：独立进程组整组回收，否则只结束该 PID。

    Args:
        process: 本次运行启动并持有 PID 的子进程，调用前仍存活。
        pid: 该子进程的 PID，也是它作为组长时的进程组编号。
        name: 回收对象的中文名称，用于输出。
        grace: 每次等待退出的秒数，超时后升级为强制结束。
    Raises:
        EnvironmentFailure: 强制结束后仍未在宽限期内退出。
    副作用:
        先发送 SIGTERM，超时后发送 SIGKILL，并回收退出状态。
    """
    grouped = False
    try:
        grouped = os.getpgid(pid) == pid
    except ProcessLookupError:
        process.wait(timeout=grace)
        return
    except OSError:
        grouped = False  # 无法确认组长身份时退化为只结束该 PID，避免误伤其他进程组。

    def send(signum: int) -> None:
        """向已确认归属的进程组或单个 PID 发送信号，目标已退出时静默返回。"""
        try:
            if grouped:
                os.killpg(pid, signum)
            else:
                process.send_signal(signum)
        except ProcessLookupError:
            return
        except OSError:
            # 组信号不被允许时退回只结束根 PID，避免留下确定的残留进程。
            try:
                process.send_signal(signum)
            except ProcessLookupError:
                return

    send(signal.SIGTERM)
    try:
        process.wait(timeout=grace)
        return
    except subprocess.TimeoutExpired:
        pass
    send(signal.SIGKILL)
    try:
        process.wait(timeout=grace)
    except subprocess.TimeoutExpired as error:
        raise EnvironmentFailure(f"{name}（PID {pid}）在强制结束后仍未退出") from error


def _terminate_windows_process(process: subprocess.Popen, pid: int, name: str, grace: int) -> None:
    """在 Windows 上结束子进程：先按 PID 回收进程树，再按 PID 强杀兜底。

    Args:
        process: 本次运行启动并持有 PID 的子进程，调用前仍存活。
        pid: 该子进程的 PID；taskkill 只按该 PID 匹配。
        name: 回收对象的中文名称，用于输出。
        grace: 每次等待退出的秒数。
    Raises:
        EnvironmentFailure: 强制结束后仍未在宽限期内退出。
    副作用:
        执行 taskkill /PID <pid> /T /F 结束整棵进程树；缺少该命令或执行失败时
        回退到 terminate/kill 精确结束该 PID，并回收退出状态。
    """
    command = windows_tree_kill_command(pid)
    if command is None:
        log(f"{name} 缺少 taskkill，改用按 PID 结束：PID {pid}")
    else:
        try:
            result = subprocess.run(command, capture_output=True, check=False, timeout=grace)
            if result.returncode != 0:
                log(f"{name} 的进程树回收返回 {result.returncode}，改用按 PID 结束")
        except (OSError, subprocess.TimeoutExpired) as error:
            log(f"{name} 的进程树回收无法执行（{type(error).__name__}），改用按 PID 结束")
    try:
        process.wait(timeout=grace)
        return
    except subprocess.TimeoutExpired:
        pass
    process.terminate()
    try:
        process.wait(timeout=grace)
        return
    except subprocess.TimeoutExpired:
        pass
    process.kill()
    try:
        process.wait(timeout=grace)
    except subprocess.TimeoutExpired as error:
        raise EnvironmentFailure(f"{name}（PID {pid}）在强制结束后仍未退出") from error


def terminate_process_tree(process: subprocess.Popen | None, name: str, grace: int = 15) -> None:
    """按精确 PID 回收本次运行启动的子进程及其后代，不使用按名匹配的进程清理。

    POSIX 上只在该 PID 是自己创建的进程组组长时整组回收，否则仅结束该 PID；
    Windows 上使用 taskkill 按 PID 回收进程树，不可用时回退到按 PID 结束。

    Args:
        process: 由本次运行启动并持有 PID 的子进程；为空或已结束时不做任何操作。
        name: 回收对象的中文名称，用于输出。
        grace: 每次等待退出的秒数，超时后升级为强制结束。
    Raises:
        EnvironmentFailure: 强制结束后仍未退出，或无法确认进程已结束。
    副作用:
        向目标进程或进程组发送终止信号/执行进程树回收命令，并回收退出状态。
    """
    if process is None or process.poll() is not None:
        return
    pid = process.pid
    if running_on_windows():
        _terminate_windows_process(process, pid, name, grace)
    else:
        _terminate_posix_process(process, pid, name, grace)
    log(f"已结束{name}：PID {pid}")


class PreviewHandler(BaseHTTPRequestHandler):
    """提供本次构建产物副本，并把 /admin-api 转发到本次后端。"""

    server_version = "BusinessE2EPreview/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: object) -> None:
        """抑制逐请求访问日志，保留失败诊断由调用方输出。

        Args:
            format: 标准库传入的格式串，本实现不使用。
            args: 标准库传入的格式化参数，本实现不使用。
        """
        return

    def do_GET(self) -> None:
        """处理浏览器静态资源与接口读取请求。"""
        self.dispatch()

    def do_HEAD(self) -> None:
        """处理浏览器与就绪探针的无正文请求。"""
        self.dispatch()

    def do_POST(self) -> None:
        """处理登录与新增等写请求。"""
        self.dispatch()

    def do_PUT(self) -> None:
        """处理修改等写请求。"""
        self.dispatch()

    def do_PATCH(self) -> None:
        """处理局部更新请求。"""
        self.dispatch()

    def do_DELETE(self) -> None:
        """处理删除请求。"""
        self.dispatch()

    def do_OPTIONS(self) -> None:
        """处理预检请求，仅返回允许的固定方法。"""
        self.send_response(204)
        self.send_header("Allow", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def dispatch(self) -> None:
        """按路径把请求交给接口转发或静态文件处理。"""
        if self.path == "/admin-api" or self.path.startswith("/admin-api/"):
            self.forward_to_backend()
        else:
            self.serve_build_artifact()

    def forward_to_backend(self) -> None:
        """把接口请求原样转发到本次后端，并回写完整响应。

        副作用：建立一条到本次后端的短连接；不修改请求体与业务语义。
        """
        host, port = self.server.backend_address  # type: ignore[attr-defined]
        length = self.headers.get("Content-Length")
        if length is not None and not length.isdigit():
            self.send_error(400, "Content-Length invalid")
            return
        if length is None and self.headers.get("Transfer-Encoding", "").lower() == "chunked":
            # 浏览器 JSON 请求始终带长度；未知分帧必须显式失败而不是转发残缺正文。
            self.send_error(502, "chunked request body unsupported")
            return
        body = self.rfile.read(int(length)) if length else None
        headers = {key: value for key, value in self.headers.items() if key.lower() not in HOP_BY_HOP}
        headers["Host"] = f"{host}:{port}"
        connection = http.client.HTTPConnection(host, port, timeout=60)
        try:
            connection.request(self.command, self.path, body=body, headers=headers)
            response = connection.getresponse()
            payload = response.read()
        except OSError:
            self.send_error(502, "backend unreachable")
            return
        finally:
            connection.close()
        self.send_response(response.status)
        for key, value in response.getheaders():
            if key.lower() not in HOP_BY_HOP and key.lower() not in {"content-length", "date", "server"}:
                self.send_header(key, value)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def serve_build_artifact(self) -> None:
        """按构建产物的公共路径返回文件，缺失时返回 404。"""
        root: Path = self.server.dist_root  # type: ignore[attr-defined]
        relative = self.path.split("?", 1)[0].split("#", 1)[0]
        if relative == "/admin" or relative == "/admin/":
            relative = "/index.html"
        elif relative.startswith("/admin/"):
            relative = relative[len("/admin"):]
        candidate = (root / relative.lstrip("/")).resolve()
        if not candidate.is_relative_to(root.resolve()) or candidate.is_dir():
            self.send_error(404, "not found")
            return
        if not candidate.is_file():
            self.send_error(404, "not found")
            return
        payload = candidate.read_bytes()
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)


@dataclass
class RunningEnvironment:
    """记录本次运行已成功取得、必须由本进程回收的资源与精确进程。

    未成功取得的资源保持默认值；清理只依据这些字段，不依据运行前登记的候选目标，
    因此预检或启动失败时不会去清理从未属于本次运行的对象。
    """

    database: str = ""
    workspace: Path | None = None
    backend: subprocess.Popen | None = None
    preview: ThreadingHTTPServer | None = None
    preview_thread: threading.Thread | None = None
    admin_password: str = ""
    redis: RedisOwnership | None = None
    mysql: dict[str, str] = field(default_factory=dict)
    backend_log: Path | None = None


def run_mysql(mysql: dict[str, str], arguments: list[str], *, stdin: Path | None = None,
              timeout: int = 600) -> subprocess.CompletedProcess[str]:
    """调用隔离环境提供的 MySQL 客户端，口令只经子进程环境传入。

    Args:
        mysql: 已解析的客户端入口、主机、端口、账号与口令。
        arguments: 客户端参数，不接受口令等敏感值。
        stdin: 需要导入的 SQL 文件；为空时不提供标准输入。
        timeout: 命令秒数上限。
    Returns:
        已完成进程的结果，供调用者核对退出码。
    Raises:
        EnvironmentFailure: 客户端无法启动或超时。
    """
    command = [mysql["client"], f"--host={mysql['host']}", f"--port={mysql['port']}",
               f"--user={mysql['user']}", "--protocol=TCP", *arguments]
    environment = dict(os.environ, MYSQL_PWD=mysql["password"])
    stream = stdin.open("rb") if stdin is not None else subprocess.DEVNULL
    try:
        return subprocess.run(command, stdin=stream, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", env=environment,
                              timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise EnvironmentFailure("MySQL 客户端无法启动或执行超时") from error
    finally:
        if stdin is not None:
            stream.close()


def require_environment(names: tuple[str, ...]) -> dict[str, str]:
    """读取必需连接变量，缺失时一次性报告变量名。

    Args:
        names: 本次步骤必需的变量名。
    Returns:
        变量名到实际值的映射。
    Raises:
        EnvironmentFailure: 存在缺失或空值变量。
    """
    missing = [name for name in names if not os.environ.get(name)]
    if missing:
        raise EnvironmentFailure("缺少连接变量：" + "、".join(missing))
    return {name: os.environ[name] for name in names}


def resolve_java(explicit: str | None) -> str:
    """确定本次运行使用的 java 可执行文件。

    Args:
        explicit: 命令行显式指定的 java 路径，可为空。
    Returns:
        实际可执行的 java 路径。
    Raises:
        EnvironmentFailure: 未找到可用的 java。
    """
    candidate = explicit or (Path(os.environ["JAVA_HOME"]) / "bin" / "java"
                             if os.environ.get("JAVA_HOME") else None)
    if candidate is not None and Path(candidate).is_file():
        return str(candidate)
    found = shutil.which("java")
    if not found:
        raise EnvironmentFailure("未找到 java，请安装 JDK 17 或设置 JAVA_HOME")
    return found


def build_backend(maven: str, java: str, log_path: Path) -> None:
    """打包当前工作区的后端可执行 JAR，跳过测试以缩短本次环境准备。

    Args:
        maven: Maven 可执行文件。
        java: 本次使用的 java 路径，用于推导 JAVA_HOME。
        log_path: 构建输出日志路径，失败时保留供诊断。
    Raises:
        EnvironmentFailure: Maven 不存在或构建失败。
    """
    if not shutil.which(maven) and not Path(maven).is_file():
        raise EnvironmentFailure(f"未找到 Maven：{maven}")
    environment = isolated_environment(dict(os.environ))
    environment["JAVA_HOME"] = str(Path(java).resolve().parent.parent)
    log(f"打包后端（日志：{log_path}）")
    with log_path.open("wb") as stream:
        result = subprocess.run([maven, "-B", "-ntp", "-DskipTests", "package"],
                                cwd=BACKEND_ROOT, env=environment, stdout=stream,
                                stderr=subprocess.STDOUT, check=False)
    if result.returncode != 0:
        raise EnvironmentFailure(f"后端打包失败，退出码 {result.returncode}，详见 {log_path}")


def build_frontend(pnpm: str, log_path: Path) -> None:
    """构建当前工作区的前端生产产物。

    Args:
        pnpm: pnpm 可执行文件。
        log_path: 构建输出日志路径，失败时保留供诊断。
    Raises:
        EnvironmentFailure: pnpm 不存在或构建失败。
    """
    if not shutil.which(pnpm):
        raise EnvironmentFailure(f"未找到 pnpm：{pnpm}")
    if not (FRONTEND_ROOT / "node_modules").is_dir():
        raise EnvironmentFailure("前端依赖未安装，请先执行 pnpm install --frozen-lockfile")
    log(f"构建前端生产产物（日志：{log_path}）")
    with log_path.open("wb") as stream:
        result = subprocess.run([pnpm, "build:ele"], cwd=FRONTEND_ROOT,
                                env=isolated_environment(dict(os.environ)),
                                stdout=stream, stderr=subprocess.STDOUT, check=False)
    if result.returncode != 0:
        raise EnvironmentFailure(f"前端构建失败，退出码 {result.returncode}，详见 {log_path}")


def create_database(mysql: dict[str, str], database: str) -> None:
    """创建本次运行独占的随机库，字符集与快照一致。

    Args:
        mysql: 已解析的 MySQL 客户端配置。
        database: 已校验的随机库名。
    Raises:
        EnvironmentFailure: 库名不符合约定或创建失败。
    """
    if not DATABASE_PATTERN.fullmatch(database):
        raise EnvironmentFailure("随机库名不符合隔离约定")
    result = run_mysql(mysql, ["--execute",
                               f"CREATE DATABASE `{database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"])
    if result.returncode != 0:
        raise EnvironmentFailure("隔离库创建失败；未输出任何客户端诊断")


def import_schema(mysql: dict[str, str], database: str) -> None:
    """把空库结构快照导入隔离库，不触碰任何已有业务库。

    Args:
        mysql: 已解析的 MySQL 客户端配置。
        database: 本次运行的随机库名。
    Raises:
        EnvironmentFailure: 快照缺失或导入失败。
    """
    if not SCHEMA_FILE.is_file():
        raise EnvironmentFailure(f"缺少结构快照：{SCHEMA_FILE}")
    result = run_mysql(mysql, [f"--database={database}", "--default-character-set=utf8mb4"],
                       stdin=SCHEMA_FILE)
    if result.returncode != 0:
        raise EnvironmentFailure("结构快照导入失败；未输出任何客户端诊断")


def drop_database(mysql: dict[str, str], database: str) -> None:
    """删除本次运行创建的随机库；失败时明确报告残留。

    Args:
        mysql: 已解析的 MySQL 客户端配置。
        database: 本次运行的随机库名。
    """
    if not DATABASE_PATTERN.fullmatch(database):
        log("跳过删除：库名不是本次运行的隔离库")
        return
    result = run_mysql(mysql, ["--execute", f"DROP DATABASE IF EXISTS `{database}`"])
    log("已删除隔离库" if result.returncode == 0 else "隔离库删除失败，请人工核对残留")


def bootstrap_admin(java: str, jar: Path, mysql: dict[str, str], database: str,
                    username: str, password: str, log_path: Path) -> None:
    """用官方一次性入口在空身份库创建可登录的超级管理员账号。

    Args:
        java: 本次使用的 java 路径。
        jar: 本次构建的应用 JAR。
        mysql: 已解析的 MySQL 客户端配置。
        database: 本次运行的随机库名。
        username: 初始化账号名，必须符合账号协议。
        password: 本次运行随机生成的管理员明文口令，只注入子进程环境。
        log_path: 初始化输出日志路径，只保留固定分类，不含凭据。
    Raises:
        EnvironmentFailure: 入口失败，或输出未确认账号创建。
    """
    environment = isolated_environment(dict(os.environ))
    environment.update({
        "BOOTSTRAP_JDBC_URL": f"jdbc:mysql://{mysql['host']}:{mysql['port']}/{database}"
                              "?useSSL=false&serverTimezone=Asia/Shanghai&allowPublicKeyRetrieval=true",
        "BOOTSTRAP_CONFIRM_DATABASE": database,
        "BOOTSTRAP_ADMIN_USERNAME": username,
        "BOOTSTRAP_ADMIN_PASSWORD": password,
        "DB_USERNAME": mysql["user"],
        "DB_PASSWORD": mysql["password"],
    })
    command = [java, "-Dloader.main=com.basicframework.module.system.bootstrap.AdminBootstrapMain",
               "-cp", str(jar), "org.springframework.boot.loader.launch.PropertiesLauncher"]
    result = subprocess.run(command, cwd=REPOSITORY_ROOT, env=environment, capture_output=True,
                            text=True, encoding="utf-8", errors="replace", check=False, timeout=180)
    log_path.write_text(result.stdout + result.stderr, encoding="utf-8")
    if result.returncode != 0 or "BOOTSTRAP_CREATED" not in result.stdout:
        raise EnvironmentFailure(f"种子管理员创建失败，退出码 {result.returncode}；详见 {log_path}")


def generate_admin_password() -> str:
    """生成满足初始化策略的一次性口令，不使用固定凭据。

    Returns:
        含大小写、数字与符号的随机口令；只在本次运行内存中存在。
    """
    return f"E2e-{secrets.token_hex(10)}"


def backend_environment(mysql: dict[str, str], database: str, redis: RedisOwnership,
                        s3: dict[str, str], port: int, preview_port: int,
                        log_file: Path) -> dict[str, str]:
    """构造真实后端的运行环境，关闭验证码并固定本次隔离依赖。

    Args:
        mysql: 已解析的 MySQL 客户端配置。
        database: 本次运行的随机库名。
        redis: 本次已取得独占所有权的 Redis 逻辑库记录。
        s3: 对象存储端点与凭据，来自本次隔离环境。
        port: 后端监听端口，使用非常规端口避免与开发服务冲突。
        preview_port: 前端预览端口，用于声明精确的同源白名单。
        log_file: 后端文件日志路径，禁止落在仓库内。
    Returns:
        仅用于本次后端子进程的完整环境。
    """
    environment = isolated_environment(dict(os.environ))
    preview_origin = f"http://127.0.0.1:{preview_port}"
    environment.update({
        "SERVER_PORT": str(port),
        "SPRING_PROFILES_ACTIVE": "local",
        # 浏览器对所有 POST 都带 Origin；按部署约定声明精确来源，不使用通配符。
        "CORS_ALLOWED_ORIGIN": preview_origin,
        "ADMIN_UI_URL": f"{preview_origin}/admin/",
        "DB_HOST": mysql["host"],
        "DB_PORT": mysql["port"],
        "DB_NAME": database,
        "DB_USERNAME": mysql["user"],
        "DB_PASSWORD": mysql["password"],
        "REDIS_HOST": redis.host,
        "REDIS_PORT": str(redis.port),
        "REDIS_DATABASE": str(redis.database),
        "REDIS_PASSWORD": redis.password,
        "MINIO_ENDPOINT": s3["BF_TEST_S3_ENDPOINT"],
        "MINIO_ACCESS_KEY": s3["BF_TEST_S3_ACCESS_KEY"],
        "MINIO_SECRET_KEY": s3["BF_TEST_S3_SECRET_KEY"],
        "MINIO_BUCKET": "bf-e2e-business",
        "MINIO_SECURE": "false",
        "MINIO_REGION": "us-east-1",
        "MINIO_PUBLIC_URL": s3["BF_TEST_S3_ENDPOINT"],
        # 图形验证码需要人工拖动，本次自动化与前端运行期配置同步关闭。
        "BASIC_FRAMEWORK_CAPTCHA_ENABLE": "false",
        "LOG_FILE": str(log_file),
    })
    return environment


def start_backend(java: str, jar: Path, environment: dict[str, str], log_path: Path) -> subprocess.Popen:
    """以独立进程组启动真实后端，便于按精确 PID 整组回收。

    Args:
        java: 本次使用的 java 路径。
        jar: 本次构建的应用 JAR。
        environment: 已构造的后端运行环境。
        log_path: 后端标准输出与错误输出日志路径。
    Returns:
        已启动的后端进程；调用者负责就绪等待与回收。
    Raises:
        EnvironmentFailure: 进程无法启动。
    """
    stream = log_path.open("wb")
    try:
        return subprocess.Popen([java, "-Dfile.encoding=UTF-8", "-jar", str(jar)],
                                cwd=BACKEND_ROOT, env=environment, stdout=stream,
                                stderr=subprocess.STDOUT, start_new_session=True)
    except OSError as error:
        stream.close()
        raise EnvironmentFailure("后端进程无法启动") from error


def start_preview(dist_root: Path, port: int, backend: tuple[str, int]) -> tuple[ThreadingHTTPServer, threading.Thread]:
    """在本次进程内启动静态资源与接口代理服务，随本进程一起结束。

    Args:
        dist_root: 本次运行专用、已写入验证码覆盖的产物副本。
        port: 前端预览端口。
        backend: 后端主机与端口，用于转发 /admin-api。
    Returns:
        已启动的服务器与其服务线程。
    Raises:
        EnvironmentFailure: 端口被占用或无法绑定。
    """
    if not free_port(port):
        raise EnvironmentFailure(f"前端预览端口 {port} 已被占用，拒绝复用陈旧服务")
    server = ThreadingHTTPServer(("127.0.0.1", port), PreviewHandler)
    server.daemon_threads = True
    server.dist_root = dist_root  # type: ignore[attr-defined]
    server.backend_address = backend  # type: ignore[attr-defined]
    thread = threading.Thread(target=server.serve_forever, name="business-e2e-preview", daemon=True)
    thread.start()
    return server, thread


def verify_preview_configuration(base_url: str) -> None:
    """核对本次预览真正提供关闭验证码的运行期配置。

    Args:
        base_url: 本次预览服务的访问地址。
    Raises:
        EnvironmentFailure: 运行期配置不可读或验证码仍为开启，避免用例在验证码处卡住。
    """
    try:
        with NO_PROXY_OPENER.open(f"{base_url}_app.config.js", timeout=10) as response:
            source = response.read().decode("utf-8")
    except (OSError, urllib.error.URLError, UnicodeError) as error:
        raise EnvironmentFailure("无法读取本次预览的运行期配置") from error
    if not CAPTCHA_PATTERN.search(source):
        raise EnvironmentFailure("运行期配置缺少验证码开关")
    if not re.search(r"VITE_APP_CAPTCHA_ENABLE\s*:\s*'false'", source):
        raise EnvironmentFailure("运行期配置的验证码开关未关闭，拒绝执行浏览器用例")


def playwright_command(node: str, arguments: list[str]) -> list[str]:
    """组装锁定版本的 Playwright 入口命令。

    Args:
        node: Node.js 可执行文件。
        arguments: 追加到 test 子命令之后的参数。
    Returns:
        可直接执行的命令数组。
    Raises:
        EnvironmentFailure: 前端依赖中缺少 Playwright。
    """
    cli = FRONTEND_ROOT / "node_modules" / "@playwright" / "test" / "cli.js"
    if not cli.is_file():
        raise EnvironmentFailure("缺少 Playwright，请先执行 pnpm install --frozen-lockfile")
    return [node, str(cli), "test", "--config", PLAYWRIGHT_CONFIG, *arguments]


def read_playwright_summary(report: Path) -> dict[str, object]:
    """从 Playwright JSON 报告核对真实用例计数与跳过状态。

    Args:
        report: 本次运行写出的 JSON 报告。
    Returns:
        含总数、通过、失败、跳过与用例标题的可核对摘要。
    Raises:
        EnvironmentFailure: 报告缺失、不可解析或没有任何真实用例。
    """
    if not report.is_file():
        raise EnvironmentFailure("Playwright 未产出 JSON 报告，无法核对真实用例")
    document = json.loads(report.read_text(encoding="utf-8"))
    stats = document.get("stats")
    if not isinstance(stats, dict):
        raise EnvironmentFailure("Playwright JSON 报告缺少统计信息")
    titles: list[str] = []

    def walk(suites: object) -> None:
        """收集套件树中的真实用例标题，不修改报告内容。

        Args:
            suites: 报告中的套件数组或空值。
        """
        if not isinstance(suites, list):
            return
        for suite in suites:
            if not isinstance(suite, dict):
                continue
            for spec in suite.get("specs", []) or []:
                if isinstance(spec, dict) and isinstance(spec.get("title"), str):
                    titles.append(spec["title"])
            walk(suite.get("suites"))

    walk(document.get("suites"))
    total = int(stats.get("expected", 0)) + int(stats.get("unexpected", 0)) \
        + int(stats.get("skipped", 0)) + int(stats.get("flaky", 0))
    if total <= 0 or not titles:
        raise EnvironmentFailure("本次浏览器测试没有任何真实用例")
    return {
        "total": total,
        "passed": int(stats.get("expected", 0)),
        "failed": int(stats.get("unexpected", 0)),
        "skipped": int(stats.get("skipped", 0)),
        "flaky": int(stats.get("flaky", 0)),
        "specs": sorted(titles),
    }


def run_status(code: int, summary: dict[str, object]) -> str:
    """按真实退出码与用例统计判定本次浏览器业务端到端状态。

    Args:
        code: Playwright 的真实退出码。
        summary: 已解析的用例统计，含 failed、skipped 与 flaky 计数。
    Returns:
        只有退出码为 0 且没有失败、跳过和重试通过时才是 passed。
    """
    counts = [int(summary.get(name, 0)) for name in ("failed", "skipped", "flaky")]
    return "passed" if code == 0 and not any(counts) else "failed"


def run_playwright(node: str, base_url: str, report: Path, timeout: int,
                   extra: list[str], seed_environment: dict[str, str] | None = None,
                   results: Path | None = None) -> int:
    """执行浏览器用例并保留真实退出码，超时按精确 PID 回收其进程树。

    Args:
        node: Node.js 可执行文件。
        base_url: 本次预览服务的访问地址。
        report: Playwright JSON 报告输出路径。
        timeout: 整组用例的秒数上限。
        extra: 追加到 Playwright 的额外参数。
        seed_environment: 只注入测试子进程的种子账号变量名与本次生成的值；为空时不注入。
        results: 失败痕迹目录；为空时使用 Playwright 默认目录。
    Returns:
        用例退出码；超时返回 124。
    Raises:
        EnvironmentFailure: Playwright 进程无法启动。
    """
    environment = isolated_environment(dict(os.environ))
    environment.update(BF_E2E_BASE_URL=base_url, PLAYWRIGHT_JSON_OUTPUT_NAME=str(report))
    if results is not None:
        results.mkdir(parents=True, exist_ok=True)
        environment["BF_E2E_OUTPUT_DIR"] = str(results)
    if seed_environment:
        environment.update(seed_environment)
    command = playwright_command(node, ["--reporter=list", "--reporter=json", *extra])
    process = subprocess.Popen(command, cwd=FRONTEND_ROOT, env=environment, start_new_session=True)
    try:
        return process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        terminate_process_tree(process, "浏览器测试进程")
        return 124


def reclaim_redis_database(ownership: RedisOwnership) -> None:
    """清空本次运行独占的 Redis 逻辑库并输出可核对结果。

    Args:
        ownership: 本次运行成功取得的所有权记录。
    Raises:
        EnvironmentFailure: 所有权标记已变更、连接失败或清理被拒绝。
    副作用:
        仅当标记仍属于本次运行时清空该逻辑库，并输出一条不含凭据的进度说明。
    """
    release_redis_database(ownership)
    log(f"已清空本次独占的 Redis 逻辑库 {ownership.database}")


def stop_preview(server: ThreadingHTTPServer | None) -> None:
    """停止本次运行启动的前端预览服务。

    Args:
        server: 已启动的预览服务；为空时不做任何操作。
    副作用:
        停止服务循环并关闭监听套接字。
    """
    if server is None:
        return
    server.shutdown()
    server.server_close()
    log("已停止前端预览服务")


def close_process_stream(process: subprocess.Popen | None) -> None:
    """关闭子进程在父进程中保留的标准输出文件对象，释放日志文件句柄。

    Windows 上未关闭的句柄会阻止临时目录删除，因此必须在删除目录之前调用。

    Args:
        process: 本次运行启动的子进程；为空或未重定向输出时不做任何操作。
    副作用:
        关闭父进程侧的文件对象；已关闭时忽略。
    """
    if process is None or process.stdout is None:
        return
    try:
        process.stdout.close()
    except OSError:
        return


def remove_workspace(workspace: Path | None) -> None:
    """删除本次运行创建的临时目录。

    Args:
        workspace: 已创建的临时目录；为空或已不存在时不做任何操作。
    副作用:
        递归删除该目录及其内容，不触碰其他路径。
    """
    if workspace is None or not workspace.exists():
        return
    shutil.rmtree(workspace, ignore_errors=True)
    log("已删除本次临时目录")


def cleanup(environment: RunningEnvironment) -> list[str]:
    """按启动顺序回收本次运行已成功取得的资源，单项失败不中断其余回收。

    Args:
        environment: 本次运行登记的资源；未成功取得的字段保持默认值并被跳过。
    Returns:
        回收失败的中文说明列表；全部成功时为空列表，由调用方报告残留。
    副作用:
        结束子进程、停止预览服务、删除隔离库、清空已独占的 Redis 逻辑库并删除临时目录；
        任一步骤失败只记录并继续，不抛出异常，避免覆盖运行本身的失败原因。
    """
    actions: list[tuple[str, Callable[[], None]]] = [
        ("后端服务", lambda: terminate_process_tree(environment.backend, "后端服务")),
        ("后端日志句柄", lambda: close_process_stream(environment.backend)),
        ("前端预览服务", lambda: stop_preview(environment.preview)),
    ]
    if environment.database:
        actions.append(("隔离库", lambda: drop_database(environment.mysql, environment.database)))
    if environment.redis is not None:
        actions.append(("Redis 逻辑库", lambda: reclaim_redis_database(environment.redis)))
    actions.append(("临时目录", lambda: remove_workspace(environment.workspace)))

    failures: list[str] = []
    for description, action in actions:
        try:
            action()
        except Exception as error:  # noqa: BLE001 - 逐项隔离失败，保证后续资源仍被回收。
            failures.append(f"{description}回收失败：{error}")
            log(f"{description}回收失败：{error}")
    return failures


def parse_arguments(arguments: list[str] | None) -> argparse.Namespace:
    """解析命令行参数，默认构建当前工作区产物、使用非常规端口并自动挑选空 Redis 逻辑库。

    Args:
        arguments: 原始参数列表；为空时读取进程参数。
    Returns:
        已解析的参数对象；`redis_database` 为空表示自动挑选空库。
    """
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--backend-port", type=int, default=48099, help="后端监听端口")
    parser.add_argument("--preview-port", type=int, default=4173, help="前端预览端口")
    parser.add_argument("--redis-database", type=int,
                        help="显式指定本次专用的 Redis 逻辑库编号；缺省自动挑选空库")
    parser.add_argument("--admin-username", default="e2eadmin", help="种子管理员账号名，4-30 位字母或数字")
    parser.add_argument("--java", help="本次使用的 java 路径；缺省取 JAVA_HOME 或 PATH")
    parser.add_argument("--maven", default="mvn", help="Maven 可执行文件")
    parser.add_argument("--pnpm", default="pnpm", help="pnpm 可执行文件")
    parser.add_argument("--node", help="Node.js 路径；缺省取 PATH 上的 node")
    parser.add_argument("--jar", type=Path, default=DEFAULT_JAR, help="后端可执行 JAR 路径")
    parser.add_argument("--skip-backend-build", action="store_true", help="复用已有 JAR，不重新打包")
    parser.add_argument("--skip-frontend-build", action="store_true", help="复用已有 dist，不重新构建")
    parser.add_argument("--timeout", type=int, default=600, help="浏览器用例整组秒数上限")
    parser.add_argument("--summary", type=Path, help="写出本次真实用例摘要 JSON 的路径")
    parser.add_argument("--results", type=Path, help="失败痕迹目录；缺省落在本次临时目录内")
    parser.add_argument("--keep", action="store_true",
                        help="保留进程、隔离库、Redis 独占逻辑库与临时目录供诊断")
    parser.add_argument("--list", action="store_true", help="只列出浏览器用例，不启动任何环境")
    parser.add_argument("extra", nargs="*", help="追加到 Playwright 的额外参数")
    return parser.parse_args(arguments)


def install_termination_handlers() -> None:
    """把可捕获的终止信号转换为中断，使异常退出时仍走统一资源回收路径。

    只注册当前平台存在的信号：SIGTERM 让外部停止请求与 CI 取消不会绕过回收，
    SIGBREAK 覆盖 Windows 控制台关闭事件。重复调用覆盖为同一处理器。

    副作用:
        在进程范围注册信号处理器；`signal.signal` 只能由主线程调用。
    """

    def interrupt(signum: int, frame: object) -> None:
        """把收到的终止信号转换为 KeyboardInterrupt，交由统一回收路径处理。"""
        raise KeyboardInterrupt

    for name in ("SIGTERM", "SIGBREAK"):
        number = getattr(signal, name, None)
        if number is None:
            continue
        try:
            signal.signal(number, interrupt)
        except (OSError, ValueError):
            continue


def orchestrate(arguments: argparse.Namespace, environment: RunningEnvironment, node: str,
                java: str, redis_credentials: tuple[str, int, str],
                s3_variables: dict[str, str]) -> int:
    """按顺序执行预检、构建、隔离资源取得与浏览器用例。

    只有真正成功的步骤才把资源登记到 environment：端口预检通过前不取得 Redis 所有权，
    隔离库创建成功后才登记库名，因此失败路径不会留下可被误清理的对象。

    Args:
        arguments: 已解析的命令行参数。
        environment: 本次运行的资源登记对象；已创建临时目录并配置好 MySQL 客户端。
        node: 已确认存在的 Node.js 可执行文件。
        java: 已确认可用的 java 可执行文件。
        redis_credentials: 隔离 Redis 的主机、端口与口令。
        s3_variables: 本次隔离对象存储的端点与凭据。
    Returns:
        浏览器用例的真实退出码；存在被跳过或依赖重试的用例时返回 1。
    Raises:
        EnvironmentFailure: 端口预检、构建、资源取得、就绪探针或用例报告核对失败。
    副作用:
        构建前后端产物、创建隔离库与种子账号、取得 Redis 独占所有权、启动后端与预览服务、
        执行浏览器用例，并写出可选的用例摘要文件。
    """
    mysql = environment.mysql
    workspace = environment.workspace
    backend_log = environment.backend_log
    if workspace is None or backend_log is None:
        raise EnvironmentFailure("缺少本次运行的临时目录或后端日志路径")
    preview_port = arguments.preview_port
    for name, busy in (("后端端口", arguments.backend_port), ("前端预览端口", preview_port)):
        if not free_port(busy):
            raise EnvironmentFailure(f"{name} {busy} 已被占用，拒绝复用陈旧服务")
    # 端口预检通过后才取得 Redis 所有权；此前失败不会登记也不会回收任何 Redis 资源。
    environment.redis = claim_redis_database(*redis_credentials, arguments.redis_database)
    log(f"已取得 Redis 逻辑库 {environment.redis.database} 的独占所有权")
    if not arguments.skip_backend_build:
        build_backend(arguments.maven, java, workspace / "maven-package.log")
    if not arguments.jar.is_file():
        raise EnvironmentFailure(f"缺少后端可执行 JAR：{arguments.jar}，请去掉 --skip-backend-build")
    dist_root = FRONTEND_ROOT / "apps" / "web-ele" / "dist"
    if not arguments.skip_frontend_build:
        build_frontend(arguments.pnpm, workspace / "pnpm-build.log")
    prepare_served_dist(dist_root, workspace / "dist")
    database = DATABASE_PREFIX + secrets.token_hex(6)
    log(f"隔离库 {database} 与种子账号 {arguments.admin_username} 准备中")
    create_database(mysql, database)
    environment.database = database  # 创建成功后才登记为本次运行可回收的资源。
    import_schema(mysql, database)
    bootstrap_admin(java, arguments.jar, mysql, database, arguments.admin_username,
                    environment.admin_password, workspace / "bootstrap.log")
    backend_env = backend_environment(mysql, database, environment.redis, s3_variables,
                                     arguments.backend_port, preview_port, backend_log)
    environment.backend = start_backend(java, arguments.jar, backend_env, backend_log)
    log(f"后端已启动：PID {environment.backend.pid}")
    wait_for_http(f"http://127.0.0.1:{arguments.backend_port}/actuator/health",
                  180, environment.backend)
    log(f"后端就绪：http://127.0.0.1:{arguments.backend_port}")
    environment.preview, environment.preview_thread = start_preview(
        workspace / "dist", preview_port, ("127.0.0.1", arguments.backend_port))
    base_url = f"http://127.0.0.1:{preview_port}/admin/"
    wait_for_http(base_url, 30)
    verify_preview_configuration(base_url)
    log(f"前端预览就绪：{base_url}")
    report = workspace / "playwright-report.json"
    # 只传变量名与本次运行生成的种子口令；口令值来自环境对象，不是固定凭据。
    seed_account_variables = {"BF_E2E_ADMIN_USERNAME": arguments.admin_username,
                              "BF_E2E_ADMIN_PASSWORD": environment.admin_password}
    results = arguments.results or (workspace / "playwright-results")
    code = run_playwright(node, base_url, report, arguments.timeout, arguments.extra,
                          seed_account_variables, results)
    summary = read_playwright_summary(report)
    summary.update({"schema": "business-e2e/v1", "base_url": base_url,
                    "database": database, "results": str(results)})
    summary["status"] = run_status(code, summary)
    if arguments.summary:
        arguments.summary.parent.mkdir(parents=True, exist_ok=True)
        arguments.summary.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
                                     encoding="utf-8")
    log(f"用例统计：共 {summary['total']} 项，通过 {summary['passed']}，失败 {summary['failed']}，"
        f"跳过 {summary['skipped']}，重试通过 {summary['flaky']}")
    if summary["skipped"] or summary["flaky"]:
        # 跳过与依赖重试的用例不构成浏览器业务证据，按用例失败而不是环境失败处理。
        print("存在被跳过或依赖重试的用例，本次不计为通过。", file=sys.stderr)
        return 1
    if code != 0 or summary["failed"]:
        return code or 1
    return 0


def execute(arguments: argparse.Namespace) -> int:
    """准备隔离环境、执行浏览器用例，并保证只回收本次成功取得的资源。

    Args:
        arguments: 已解析的命令行参数。
    Returns:
        浏览器用例的真实退出码；环境失败或资源回收不完整时返回 2。
    Raises:
        EnvironmentFailure: 连接变量缺失或前置解析失败，由 main 统一转为退出码 2。
        BaseException: 运行期异常与键盘中断在完成资源回收后原样抛出。
    """
    node = arguments.node or shutil.which("node")
    if not node:
        raise EnvironmentFailure("未找到 Node.js")
    if arguments.list:
        # 只列出用例：不启动后端与预览，也不产生任何隔离资源。
        return run_playwright(node, "http://127.0.0.1:4173/admin/",
                              Path(os.devnull), 120, ["--list", *arguments.extra])

    mysql_variables = require_environment(REQUIRED_MYSQL)
    redis_variables = require_environment(REQUIRED_REDIS)
    s3_variables = require_environment(REQUIRED_S3)
    host, port, _ = parse_jdbc_url(mysql_variables["AUTH_TEST_MYSQL_URL"])
    mysql_client = os.environ.get("BF_TEST_MYSQL_CLIENT") or shutil.which("mysql")
    if not mysql_client:
        raise EnvironmentFailure("未找到 MySQL 客户端，请设置 BF_TEST_MYSQL_CLIENT 或安装 mysql")
    mysql = {"client": mysql_client, "host": host, "port": str(port),
             "user": mysql_variables["AUTH_TEST_MYSQL_USERNAME"],
             "password": mysql_variables["AUTH_TEST_MYSQL_PASSWORD"]}
    if arguments.redis_database == 0:
        raise EnvironmentFailure("拒绝使用共享的 Redis 0 号库，请指定专用逻辑库编号")
    if not re.fullmatch(r"[A-Za-z0-9]{4,30}", arguments.admin_username):
        raise EnvironmentFailure("种子管理员账号名必须为 4-30 位字母或数字")
    java = resolve_java(arguments.java)
    redis_credentials = ("127.0.0.1", int(redis_variables["BF_TEST_REDIS_PORT"]),
                         redis_variables["BF_TEST_REDIS_PASSWORD"])
    environment = RunningEnvironment(mysql=mysql)
    environment.admin_password = os.environ.get("BF_E2E_ADMIN_PASSWORD") or generate_admin_password()
    # 临时目录一经创建即归本次运行所有并必须回收；其他资源在真正取得后才登记。
    environment.workspace = Path(tempfile.mkdtemp(prefix="bf-business-e2e-"))
    environment.backend_log = environment.workspace / "backend.log"

    pending: BaseException | None = None
    result = 2
    try:
        result = orchestrate(arguments, environment, node, java, redis_credentials, s3_variables)
    except BaseException as error:  # 运行期异常与中断都先完成回收，再原样抛出。
        pending = error
    cleanup_failures: list[str] = []
    if arguments.keep:
        log(f"按 --keep 保留资源：库 {environment.database or '未创建'}，"
            f"Redis 逻辑库 {environment.redis.database if environment.redis else '未取得'}，"
            f"临时目录 {environment.workspace}，"
            f"后端 PID {environment.backend.pid if environment.backend else '未启动'}，"
            f"前端预览端口 {arguments.preview_port}（随本进程结束）")
    else:
        cleanup_failures = cleanup(environment)
    if pending is not None:
        raise pending
    for failure in cleanup_failures:
        print(f"资源回收未完整：{failure}", file=sys.stderr)
    return 2 if cleanup_failures else result


def main(arguments: list[str] | None = None) -> int:
    """执行入口：环境失败返回 2，浏览器用例失败保留真实退出码。

    Args:
        arguments: 原始命令行参数；为空时读取进程参数。
    Returns:
        进程退出码；被中断或收到终止信号时返回 130。
    """
    parsed = parse_arguments(arguments)
    install_termination_handlers()
    try:
        return execute(parsed)
    except EnvironmentFailure as error:
        print(f"业务端到端环境失败：{error}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("业务端到端被中断。", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
