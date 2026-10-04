"""准备隔离 MySQL、种子管理员、真实后端与前端预览，并执行浏览器业务端到端测试。

本入口只使用本次运行自建的随机库、专用 Redis 逻辑库与临时目录，退出时按记录的精确 PID
回收进程并删除这些资源；缺少连接变量、后端、浏览器或构建产物时明确失败，不跳过用例。

运行（仓库根）：

    python -B -X utf8 scripts/e2e/run_business_e2e.py

退出码：0 表示用例真实通过；1 表示用例失败或存在被跳过、依赖重试的用例；2 表示环境准备、
依赖或资源编排失败。

连接变量从进程环境读取，凭据不写入仓库文件、日志或命令参数：
AUTH_TEST_MYSQL_URL、AUTH_TEST_MYSQL_USERNAME、AUTH_TEST_MYSQL_PASSWORD、
BF_TEST_REDIS_PORT、BF_TEST_REDIS_PASSWORD、
BF_TEST_S3_ENDPOINT、BF_TEST_S3_ACCESS_KEY、BF_TEST_S3_SECRET_KEY。
可选 BF_TEST_MYSQL_CLIENT 指定 MySQL 客户端入口，未设置时使用 PATH 上的 mysql。

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


def read_resp_reply(stream) -> str:
    """读取一条 Redis 简单回复，用于确认清理命令已被执行。

    Args:
        stream: 已连接的 Redis 套接字文件对象。
    Returns:
        去掉行结束符的回复行，以状态前缀开头。
    Raises:
        EnvironmentFailure: 连接提前结束或回复不是简单结果。
    """
    line = stream.readline()
    if not line:
        raise EnvironmentFailure("Redis 未返回清理结果")
    text = line.decode("utf-8", "replace").strip()
    if not text.startswith(("+", "-", ":")):
        raise EnvironmentFailure("Redis 清理回复不是简单结果")
    return text


def flush_redis_database(host: str, port: int, password: str, database: int) -> None:
    """清空本次运行使用的 Redis 逻辑库，不触碰其他库与其他键空间。

    Args:
        host: Redis 主机，仅限本次隔离环境。
        port: Redis 端口。
        password: 本次隔离环境的连接口令。
        database: 本次运行独占的逻辑库编号。
    Raises:
        EnvironmentFailure: 连接失败或命令被拒绝。
    """
    try:
        with socket.create_connection((host, port), timeout=5) as connection:
            with connection.makefile("rb") as stream:
                if password:
                    connection.sendall(encode_resp_command("AUTH", password))
                    if read_resp_reply(stream).startswith("-"):
                        raise EnvironmentFailure("Redis 认证被拒绝")
                connection.sendall(encode_resp_command("SELECT", str(database)))
                if read_resp_reply(stream).startswith("-"):
                    raise EnvironmentFailure("Redis 逻辑库选择被拒绝")
                connection.sendall(encode_resp_command("FLUSHDB"))
                if read_resp_reply(stream).startswith("-"):
                    raise EnvironmentFailure("Redis 逻辑库清理被拒绝")
    except OSError as error:
        raise EnvironmentFailure("Redis 清理无法连接") from error


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


def terminate_process_group(process: subprocess.Popen | None, name: str, grace: int = 15) -> None:
    """按记录的子进程精确回收其进程组，不使用按名匹配的进程清理。

    Args:
        process: 由本次运行启动并持有 PID 的子进程；为空时不做任何操作。
        name: 回收对象的中文名称，用于输出。
        grace: 等待优雅退出的秒数，超时后强制结束同一进程组。
    """
    if process is None or process.poll() is not None:
        return
    pid = process.pid
    try:
        group = os.getpgid(pid)
    except ProcessLookupError:
        return
    # 只有本次创建的独立进程组（组长即该 PID）才允许整组回收，否则只结束该 PID。
    grouped = group == pid
    try:
        os.killpg(group, signal.SIGTERM) if grouped else os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=grace)
        log(f"已结束{name}：PID {pid}")
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(group, signal.SIGKILL) if grouped else os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        return
    process.wait(timeout=grace)
    log(f"已强制结束{name}：PID {pid}")


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
    """记录本次运行创建、必须由本进程回收的资源与精确进程。"""

    database: str = ""
    workspace: Path | None = None
    backend: subprocess.Popen | None = None
    preview: ThreadingHTTPServer | None = None
    preview_thread: threading.Thread | None = None
    admin_password: str = ""
    redis: tuple[str, int, str, int] | None = None
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


def backend_environment(mysql: dict[str, str], database: str, redis: tuple[str, int, str, int],
                        s3: dict[str, str], port: int, preview_port: int,
                        log_file: Path) -> dict[str, str]:
    """构造真实后端的运行环境，关闭验证码并固定本次隔离依赖。

    Args:
        mysql: 已解析的 MySQL 客户端配置。
        database: 本次运行的随机库名。
        redis: Redis 主机、端口、口令与专用逻辑库编号。
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
        "REDIS_HOST": redis[0],
        "REDIS_PORT": str(redis[1]),
        "REDIS_DATABASE": str(redis[3]),
        "REDIS_PASSWORD": redis[2],
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
    """执行浏览器用例并保留真实退出码，超时按精确进程组回收。

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
        terminate_process_group(process, "浏览器测试进程")
        return 124


def cleanup(environment: RunningEnvironment) -> None:
    """按启动顺序回收进程、隔离库、Redis 逻辑库与临时目录。

    Args:
        environment: 本次运行登记的资源；未创建的资源会被跳过。
    """
    terminate_process_group(environment.backend, "后端服务")
    if environment.preview is not None:
        environment.preview.shutdown()
        environment.preview.server_close()
        log("已停止前端预览服务")
    if environment.mysql and environment.database:
        drop_database(environment.mysql, environment.database)
    if environment.redis is not None:
        try:
            flush_redis_database(*environment.redis)
            log("已清空本次专用 Redis 逻辑库")
        except EnvironmentFailure as error:
            log(f"Redis 清理失败：{error}")
    if environment.workspace is not None and environment.workspace.exists():
        shutil.rmtree(environment.workspace, ignore_errors=True)
        log("已删除本次临时目录")


def parse_arguments(arguments: list[str] | None) -> argparse.Namespace:
    """解析命令行参数，默认构建当前工作区产物并使用非常规端口。

    Args:
        arguments: 原始参数列表；为空时读取进程参数。
    Returns:
        已解析的参数对象。
    """
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--backend-port", type=int, default=48099, help="后端监听端口")
    parser.add_argument("--preview-port", type=int, default=4173, help="前端预览端口")
    parser.add_argument("--redis-database", type=int, default=5, help="本次专用 Redis 逻辑库编号")
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
    parser.add_argument("--keep", action="store_true", help="保留进程、隔离库与临时目录供诊断")
    parser.add_argument("--list", action="store_true", help="只列出浏览器用例，不启动任何环境")
    parser.add_argument("extra", nargs="*", help="追加到 Playwright 的额外参数")
    return parser.parse_args(arguments)


def execute(arguments: argparse.Namespace) -> int:
    """按顺序准备隔离环境、执行浏览器用例并回收全部资源。

    Args:
        arguments: 已解析的命令行参数。
    Returns:
        浏览器用例的真实退出码；环境失败返回 2。
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
    redis_port = int(redis_variables["BF_TEST_REDIS_PORT"])
    redis = ("127.0.0.1", redis_port, redis_variables["BF_TEST_REDIS_PASSWORD"], arguments.redis_database)
    if arguments.redis_database == 0:
        raise EnvironmentFailure("拒绝使用共享的 Redis 0 号库，请指定专用逻辑库编号")

    if not re.fullmatch(r"[A-Za-z0-9]{4,30}", arguments.admin_username):
        raise EnvironmentFailure("种子管理员账号名必须为 4-30 位字母或数字")
    java = resolve_java(arguments.java)
    environment = RunningEnvironment(mysql=mysql, redis=redis)
    environment.database = DATABASE_PREFIX + secrets.token_hex(6)
    environment.admin_password = os.environ.get("BF_E2E_ADMIN_PASSWORD") or generate_admin_password()
    environment.workspace = Path(tempfile.mkdtemp(prefix="bf-business-e2e-"))
    environment.backend_log = environment.workspace / "backend.log"
    preview_port = arguments.preview_port
    try:
        for name, busy in (("后端端口", arguments.backend_port), ("前端预览端口", preview_port)):
            if not free_port(busy):
                raise EnvironmentFailure(f"{name} {busy} 已被占用，拒绝复用陈旧服务")
        if not arguments.skip_backend_build:
            build_backend(arguments.maven, java, environment.workspace / "maven-package.log")
        if not arguments.jar.is_file():
            raise EnvironmentFailure(f"缺少后端可执行 JAR：{arguments.jar}，请去掉 --skip-backend-build")
        dist_root = FRONTEND_ROOT / "apps" / "web-ele" / "dist"
        if not arguments.skip_frontend_build:
            build_frontend(arguments.pnpm, environment.workspace / "pnpm-build.log")
        prepare_served_dist(dist_root, environment.workspace / "dist")
        log(f"隔离库 {environment.database} 与种子账号 {arguments.admin_username} 准备中")
        create_database(mysql, environment.database)
        import_schema(mysql, environment.database)
        bootstrap_admin(java, arguments.jar, mysql, environment.database,
                        arguments.admin_username, environment.admin_password,
                        environment.workspace / "bootstrap.log")
        flush_redis_database(*redis)
        backend_env = backend_environment(mysql, environment.database, redis, s3_variables,
                                         arguments.backend_port, preview_port,
                                         environment.backend_log)
        environment.backend = start_backend(java, arguments.jar, backend_env, environment.backend_log)
        log(f"后端已启动：PID {environment.backend.pid}")
        wait_for_http(f"http://127.0.0.1:{arguments.backend_port}/actuator/health",
                      180, environment.backend)
        log(f"后端就绪：http://127.0.0.1:{arguments.backend_port}")
        environment.preview, environment.preview_thread = start_preview(
            environment.workspace / "dist", preview_port, ("127.0.0.1", arguments.backend_port))
        base_url = f"http://127.0.0.1:{preview_port}/admin/"
        wait_for_http(base_url, 30)
        verify_preview_configuration(base_url)
        log(f"前端预览就绪：{base_url}")
        report = environment.workspace / "playwright-report.json"
        # 只传变量名与本次运行生成的种子口令；口令值来自环境对象，不是固定凭据。
        seed_account_variables = {"BF_E2E_ADMIN_USERNAME": arguments.admin_username,
                                  "BF_E2E_ADMIN_PASSWORD": environment.admin_password}
        results = arguments.results or (environment.workspace / "playwright-results")
        code = run_playwright(node, base_url, report, arguments.timeout, arguments.extra,
                              seed_account_variables, results)
        summary = read_playwright_summary(report)
        summary.update({"schema": "business-e2e/v1", "base_url": base_url,
                        "database": environment.database, "results": str(results)})
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
    finally:
        if arguments.keep:
            log(f"按 --keep 保留资源：库 {environment.database}，临时目录 {environment.workspace}，"
                f"后端 PID {environment.backend.pid if environment.backend else '未启动'}，"
                f"前端预览端口 {preview_port}（随本进程结束）")
        else:
            cleanup(environment)


def main(arguments: list[str] | None = None) -> int:
    """执行入口：环境失败返回 2，浏览器用例失败保留真实退出码。

    Args:
        arguments: 原始命令行参数；为空时读取进程参数。
    Returns:
        进程退出码。
    """
    parsed = parse_arguments(arguments)
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
