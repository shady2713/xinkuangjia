"""验证浏览器业务端到端编排脚本的纯逻辑与真实本地服务，不连接外部环境。

用例覆盖连接地址解析、运行期配置覆盖、代理环境隔离、Redis 命令编码、端口占用判断、
Playwright 报告核对、状态判定，以及静态文件与接口转发服务的真实 HTTP 行为；
另用内存 RESP 替身核对 Redis 独占所有权与外部数据保护，用真实子进程核对跨平台
精确 PID 回收、异常路径回收与信号中断；不启动 MySQL、后端或浏览器，这些由端到端真跑覆盖。

@author 李杰
"""

from __future__ import annotations

import http.client
import json
import os
import signal
import socket
import socketserver
import subprocess
import sys
import threading
import time
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from scripts.e2e import run_business_e2e as harness


class FakeBackendHandler(BaseHTTPRequestHandler):
    """受控替身后端：回显方法与路径，用于验证转发语义。"""

    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: object) -> None:
        """抑制替身后端的访问日志，保持测试输出可读。

        Args:
            format: 标准库传入的格式串，本实现不使用。
            args: 标准库传入的格式化参数，本实现不使用。
        """
        return

    def respond(self) -> None:
        """读取请求正文并回显方法与路径，供转发用例断言。"""
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode("utf-8") if length else ""
        payload = json.dumps({"method": self.command, "path": self.path, "body": body}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        """处理替身后端的读取请求。"""
        self.respond()

    def do_POST(self) -> None:
        """处理替身后端的写入请求。"""
        self.respond()


def start_server(handler: type[BaseHTTPRequestHandler]) -> tuple[ThreadingHTTPServer, threading.Thread]:
    """在环回随机端口启动真实 HTTP 服务。

    Args:
        handler: 处理请求的处理器类型。
    Returns:
        已启动的服务器与其服务线程；调用方负责关闭。
    """
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def request(server: ThreadingHTTPServer, method: str, path: str, body: bytes | None = None) -> tuple[int, str]:
    """向真实服务发起一次请求并读取完整响应。

    Args:
        server: 已启动的服务器。
        method: HTTP 方法。
        path: 请求路径，包含查询串。
        body: 可选请求正文。
    Returns:
        状态码与响应正文。
    """
    connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=10)
    try:
        connection.request(method, path, body=body)
        response = connection.getresponse()
        return response.status, response.read().decode("utf-8")
    finally:
        connection.close()


@pytest.fixture(name="preview")
def preview_fixture(tmp_path: Path):
    """搭建真实静态产物副本、替身后端与预览服务，并在用例后回收。

    Args:
        tmp_path: pytest 提供的独立临时目录。
    Yields:
        预览服务、替身后端与产物根目录。
    """
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<div id=\"app\"></div>", encoding="utf-8")
    (dist / "_app.config.js").write_text(
        "window._VBEN_ADMIN_PRO_APP_CONF_ = {\n  VITE_APP_CAPTCHA_ENABLE: 'true',\n};\n",
        encoding="utf-8")
    (dist / "brand-logo.svg").write_text("<svg/>", encoding="utf-8")
    (dist / "js").mkdir()
    (dist / "js" / "app.js").write_text("export default 1;", encoding="utf-8")
    served = tmp_path / "served"
    harness.prepare_served_dist(dist, served)
    backend, backend_thread = start_server(FakeBackendHandler)
    preview_server, preview_thread = harness.start_preview(
        served, 0, ("127.0.0.1", backend.server_address[1]))
    yield preview_server, backend, served
    preview_server.shutdown()
    preview_server.server_close()
    backend.shutdown()
    backend.server_close()
    assert not preview_thread.is_alive() and not backend_thread.is_alive()


def test_parse_jdbc_url_accepts_single_database() -> None:
    """合法连接地址解析出主机、端口与库名，未提供库名时返回空串。"""
    assert harness.parse_jdbc_url("jdbc:mysql://127.0.0.1:13306/basic_framework") == (
        "127.0.0.1", 13306, "basic_framework")
    assert harness.parse_jdbc_url("jdbc:mysql://db.example:3306/") == ("db.example", 3306, "")
    assert harness.parse_jdbc_url(
        "jdbc:mysql://127.0.0.1:3306/bf_test?useSSL=false") == ("127.0.0.1", 3306, "bf_test")


@pytest.mark.parametrize("url", [
    "mysql://127.0.0.1:3306/bf_test",
    # 内嵌账号密码的负例使用仓库约定的合成标记，避免与真实凭据混淆。
    "jdbc:mysql://DUMMY-db-user:CHANGE_ME_DB_PASSWORD@127.0.0.1:3306/bf_test",
    "jdbc:mysql://127.0.0.1/bf_test",
    "jdbc:mysql://127.0.0.1:0/bf_test",
    "jdbc:mysql://127.0.0.1:70000/bf_test",
    "jdbc:mysql://127.0.0.1:3306/bf-test",
])
def test_parse_jdbc_url_rejects_unsafe_targets(url: str) -> None:
    """内嵌凭据、缺端口、越界端口与非法库名都必须受控拒绝。"""
    with pytest.raises(harness.EnvironmentFailure):
        harness.parse_jdbc_url(url)


def test_runtime_override_disables_captcha_once() -> None:
    """运行期配置覆盖只关闭验证码开关，其他字段保持原值。"""
    source = "conf = { VITE_APP_CAPTCHA_ENABLE: 'true', VITE_GLOB_API_URL: '/admin-api' };\n"
    replaced = harness.apply_runtime_overrides(source)
    assert "VITE_APP_CAPTCHA_ENABLE: 'false'" in replaced
    assert "VITE_GLOB_API_URL: '/admin-api'" in replaced
    assert replaced.count("VITE_APP_CAPTCHA_ENABLE") == 1


@pytest.mark.parametrize("source", [
    "conf = { VITE_GLOB_API_URL: '/admin-api' };\n",
    "conf = { VITE_APP_CAPTCHA_ENABLE: 'true', VITE_APP_CAPTCHA_ENABLE: 'true' };\n",
])
def test_runtime_override_requires_exactly_one_switch(source: str) -> None:
    """缺少或重复的验证码开关都必须拒绝，避免静默沿用开启状态。"""
    with pytest.raises(harness.EnvironmentFailure):
        harness.apply_runtime_overrides(source)


def test_prepare_served_dist_requires_build_output(tmp_path: Path) -> None:
    """缺少生产产物或运行期配置时拒绝继续，不产生半成品目录。"""
    empty = tmp_path / "empty"
    empty.mkdir()
    with pytest.raises(harness.EnvironmentFailure):
        harness.prepare_served_dist(empty, tmp_path / "served")


def test_resp_command_encoding_matches_protocol() -> None:
    """RESP 编码按长度前缀组织命令，凭据只出现在正文中。"""
    encoded = harness.encode_resp_command("AUTH", "secret")
    assert encoded == b"*2\r\n$4\r\nAUTH\r\n$6\r\nsecret\r\n"


def test_isolated_environment_removes_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    """代理环境被清除并补充环回例外，其他变量保持原值。"""
    environment = {"HTTP_PROXY": "http://proxy:8080", "NO_PROXY": "example.test",
                   "PATH": "/usr/bin", "BF_TEST_REDIS_PORT": "16379"}
    result = harness.isolated_environment(environment)
    assert "HTTP_PROXY" not in result and "http_proxy" not in result
    assert result["PATH"] == "/usr/bin" and result["BF_TEST_REDIS_PORT"] == "16379"
    assert "127.0.0.1" in result["NO_PROXY"] and "example.test" in result["NO_PROXY"]


def test_require_environment_reports_all_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    """缺失变量一次性报告全部变量名，不打印任何值。"""
    monkeypatch.delenv("BF_TEST_S3_ENDPOINT", raising=False)
    monkeypatch.setenv("BF_TEST_S3_ACCESS_KEY", "DUMMY-ACCESS")
    with pytest.raises(harness.EnvironmentFailure) as failure:
        harness.require_environment(("BF_TEST_S3_ENDPOINT", "BF_TEST_S3_ACCESS_KEY"))
    assert "BF_TEST_S3_ENDPOINT" in str(failure.value)
    assert "DUMMY-ACCESS" not in str(failure.value)


def test_generated_password_satisfies_bootstrap_policy() -> None:
    """随机口令满足长度与字符类别要求，且两次生成互不相同。"""
    first = harness.generate_admin_password()
    second = harness.generate_admin_password()
    assert first != second and 12 <= len(first) <= 128
    classes = sum([
        any(character.isupper() for character in first),
        any(character.islower() for character in first),
        any(character.isdigit() for character in first),
        any(not character.isalnum() for character in first),
    ])
    assert classes >= 3
    assert first == first.strip()


def test_free_port_reflects_real_binding() -> None:
    """端口占用判断与实际绑定一致。"""
    with socket.socket() as holder:
        holder.bind(("127.0.0.1", 0))
        holder.listen(1)
        busy = holder.getsockname()[1]
        assert harness.free_port(busy) is False
    assert harness.free_port(busy) is True


def test_create_database_rejects_foreign_name(monkeypatch: pytest.MonkeyPatch) -> None:
    """非本次约定的库名必须在执行任何 SQL 之前被拒绝。"""

    def forbidden(*args: object, **kwargs: object) -> None:
        """记录意外调用；本用例不允许执行真实客户端。"""
        raise AssertionError("不得对非隔离库名执行 SQL")

    monkeypatch.setattr(harness, "run_mysql", forbidden)
    with pytest.raises(harness.EnvironmentFailure):
        harness.create_database({"client": "mysql"}, "basic_framework")


def test_backend_environment_disables_captcha_and_isolates(tmp_path: Path) -> None:
    """后端环境关闭验证码、声明精确来源、隔离 Redis 逻辑库并限制日志位置。"""
    mysql = {"client": "mysql", "host": "127.0.0.1", "port": "13306",
             "user": "root", "password": "DUMMY-DB-PASSWORD"}
    redis = harness.RedisOwnership("127.0.0.1", 16379, "DUMMY-REDIS-PASSWORD", 5, "token-5")
    s3 = {"BF_TEST_S3_ENDPOINT": "http://127.0.0.1:19000", "BF_TEST_S3_ACCESS_KEY": "DUMMY-KEY",
          "BF_TEST_S3_SECRET_KEY": "DUMMY-SECRET"}
    log_file = tmp_path / "backend.log"
    environment = harness.backend_environment(mysql, "bf_e2e_0123456789ab", redis, s3, 48099, 4173, log_file)
    assert environment["BASIC_FRAMEWORK_CAPTCHA_ENABLE"] == "false"
    assert environment["SERVER_PORT"] == "48099"
    assert environment["REDIS_DATABASE"] == "5"
    assert environment["REDIS_HOST"] == "127.0.0.1" and environment["REDIS_PORT"] == "16379"
    assert environment["CORS_ALLOWED_ORIGIN"] == "http://127.0.0.1:4173"
    assert environment["LOG_FILE"] == str(log_file)
    assert environment["DB_NAME"] == "bf_e2e_0123456789ab"
    assert "PROXY" not in " ".join(key.upper() for key in environment if "proxy" in key.lower()
                                   and key.lower() != "no_proxy")


def test_read_playwright_summary_counts_real_cases(tmp_path: Path) -> None:
    """真实报告解析出用例计数与标题，缺少统计或零用例必须失败。"""
    report = tmp_path / "report.json"
    report.write_text(json.dumps({
        "stats": {"expected": 2, "unexpected": 0, "skipped": 0, "flaky": 0},
        "suites": [{"specs": [{"title": "完整流程"}, {"title": "失败路径"}], "suites": []}],
    }, ensure_ascii=False), encoding="utf-8")
    summary = harness.read_playwright_summary(report)
    assert summary["total"] == 2 and summary["passed"] == 2
    assert summary["specs"] == ["失败路径", "完整流程"]


@pytest.mark.parametrize("document", [
    {"stats": {"expected": 0, "unexpected": 0, "skipped": 0, "flaky": 0}, "suites": []},
    {"stats": {"expected": 1, "unexpected": 0, "skipped": 0, "flaky": 0}, "suites": []},
    {"suites": [{"specs": [{"title": "只有标题"}]}]},
])
def test_read_playwright_summary_rejects_empty_evidence(tmp_path: Path, document: dict[str, object]) -> None:
    """零用例、缺少统计或没有用例标题的报告不能作为执行证据。"""
    report = tmp_path / "report.json"
    report.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(harness.EnvironmentFailure):
        harness.read_playwright_summary(report)


def test_read_playwright_summary_requires_report(tmp_path: Path) -> None:
    """报告文件缺失时受控失败，而不是按零用例通过。"""
    with pytest.raises(harness.EnvironmentFailure):
        harness.read_playwright_summary(tmp_path / "missing.json")


@pytest.mark.parametrize("code,expected", [
    (0, "passed"), (1, "failed"), (124, "failed"),
])
def test_run_status_requires_clean_exit(code: int, expected: str) -> None:
    """只有退出码为 0 且无失败、跳过、重试通过时才判定通过。"""
    summary = {"failed": 0, "skipped": 0, "flaky": 0}
    assert harness.run_status(code, summary) == expected


@pytest.mark.parametrize("field", ["failed", "skipped", "flaky"])
def test_run_status_rejects_dirty_counts(field: str) -> None:
    """失败、跳过与重试通过都会让本次结论为失败，即使退出码为 0。"""
    summary = {"failed": 0, "skipped": 0, "flaky": 0}
    summary[field] = 1
    assert harness.run_status(0, summary) == "failed"


def test_playwright_command_requires_installed_cli(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """前端依赖缺少 Playwright 时明确失败，不尝试隐式安装。"""
    monkeypatch.setattr(harness, "FRONTEND_ROOT", tmp_path)
    with pytest.raises(harness.EnvironmentFailure):
        harness.playwright_command("node", [])


def test_preview_serves_artifacts_and_forwards_api(preview) -> None:
    """预览服务真实提供构建产物、运行期配置，并把 /admin-api 转发到后端。"""
    server, _, served = preview
    status, body = request(server, "GET", "/admin/")
    assert status == 200 and 'id="app"' in body
    status, body = request(server, "GET", "/admin/_app.config.js")
    assert status == 200 and "VITE_APP_CAPTCHA_ENABLE: 'false'" in body
    status, body = request(server, "GET", "/admin/js/app.js")
    assert status == 200 and "export default" in body
    status, body = request(server, "GET", "/brand-logo.svg")
    assert status == 200 and "<svg/>" in body
    status, body = request(server, "POST", "/admin-api/system/auth/super-admin-login",
                           b'{"username":"demo"}')
    assert status == 200
    forwarded = json.loads(body)
    assert forwarded["path"] == "/admin-api/system/auth/super-admin-login"
    assert forwarded["method"] == "POST" and forwarded["body"] == '{"username":"demo"}'
    assert (served / "_app.config.js").is_file()


def test_preview_rejects_path_escape(preview) -> None:
    """越过产物根的路径必须返回 404，不读取仓库其他文件。"""
    server, _, _ = preview
    status, _ = request(server, "GET", "/admin/../../etc/passwd")
    assert status == 404


def test_preview_reports_backend_failure(preview, monkeypatch: pytest.MonkeyPatch) -> None:
    """后端不可达时接口转发返回 502，而不是空 200 冒充成功。"""
    server, backend, _ = preview
    port = backend.server_address[1]
    backend.shutdown()
    backend.server_close()
    server.backend_address = ("127.0.0.1", port)
    status, _ = request(server, "GET", "/admin-api/actuator/health")
    assert status == 502


def test_start_preview_refuses_busy_port(tmp_path: Path) -> None:
    """端口被占用时拒绝复用陈旧服务。"""
    dist = tmp_path / "dist"
    dist.mkdir()
    with socket.socket() as holder:
        holder.bind(("127.0.0.1", 0))
        holder.listen(1)
        with pytest.raises(harness.EnvironmentFailure):
            harness.start_preview(dist, holder.getsockname()[1], ("127.0.0.1", 1))


def test_terminate_process_tree_ignores_finished_process() -> None:
    """已结束或未启动的子进程不会被再次回收，也不影响调用方。"""
    harness.terminate_process_tree(None, "后端服务")


def test_cleanup_tolerates_missing_resources() -> None:
    """未创建任何资源时清理是幂等的，不抛出异常也不报告失败。"""
    assert harness.cleanup(harness.RunningEnvironment()) == []


def test_parse_arguments_defaults_use_uncommon_ports() -> None:
    """默认端口避开开发服务，默认构建产物且不写死 Redis 逻辑库编号。"""
    arguments = harness.parse_arguments([])
    assert arguments.backend_port == 48099
    assert arguments.preview_port == 4173
    assert arguments.redis_database is None
    assert arguments.skip_backend_build is False and arguments.skip_frontend_build is False
    assert os.path.basename(arguments.jar) == "basic-framework-server.jar"


# ---------------------------------------------------------------------------
# Redis 独占所有权：用真实 TCP 的内存替身核对协议交互，不连接任何外部服务。
# ---------------------------------------------------------------------------


class FakeRedisHandler(socketserver.StreamRequestHandler):
    """解析 RESP 请求并回写回复，按连接保存 SELECT 选中的逻辑库。"""

    def handle(self) -> None:
        """逐条读取命令并回写回复，直到客户端关闭连接。"""
        database = 0
        while True:
            parts = self.read_command()
            if parts is None:
                return
            database, reply = self.server.dispatch(parts, database)  # type: ignore[attr-defined]
            try:
                self.wfile.write(reply)
                self.wfile.flush()
            except OSError:
                return

    def read_command(self) -> list[str] | None:
        """读取一条 RESP 数组命令；连接结束或格式不符时返回空值。

        Returns:
            命令名与参数的文本列表；无法解析或对端关闭时为空值。
        """
        line = self.rfile.readline()
        if not line or not line.startswith(b"*"):
            return None
        try:
            count = int(line[1:].strip())
            parts: list[str] = []
            for _ in range(count):
                header = self.rfile.readline()
                if not header.startswith(b"$"):
                    return None
                payload = self.rfile.read(int(header[1:].strip()))
                self.rfile.read(2)
                parts.append(payload.decode("utf-8"))
        except (ValueError, UnicodeError):
            return None
        return parts


class FakeRedisServer(socketserver.ThreadingTCPServer):
    """记录命令并维护内存键空间的真实 TCP Redis 替身，不连接任何外部服务。

    Attributes:
        databases: 逻辑库编号到键值映射的存储。
        commands: 按顺序记录收到的全部命令，用于断言是否发生过清理。
        database_count: 服务端允许选择的逻辑库数量，超出的 SELECT 返回范围错误。
        password: 非空时要求 AUTH 口令一致。
    """

    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, password: str | None = None, database_count: int = 16) -> None:
        """绑定环回随机端口并初始化空键空间。

        Args:
            password: 可选连接口令；为空时接受任意客户端。
            database_count: 允许选择的逻辑库数量上限。
        """
        super().__init__(("127.0.0.1", 0), FakeRedisHandler)
        self.databases: dict[int, dict[str, str]] = {}
        self.commands: list[tuple[str, ...]] = []
        self.database_count = database_count
        self.password = password
        self.lock = threading.Lock()

    @property
    def port(self) -> int:
        """返回实际绑定到的环回端口。"""
        return int(self.server_address[1])

    def keys_of(self, database: int) -> dict[str, str]:
        """返回指定逻辑库的键值副本，供用例断言外部数据是否保持原样。

        Args:
            database: 逻辑库编号。
        Returns:
            该库当前键值映射的浅拷贝。
        """
        with self.lock:
            return dict(self.databases.get(database, {}))

    def set_key(self, database: int, key: str, value: str) -> None:
        """在指定逻辑库预置一个键，用于构造外部数据或并发运行的标记。

        Args:
            database: 逻辑库编号。
            key: 键名。
            value: 键值。
        副作用:
            直接写入内存键空间，不记录为客户端命令。
        """
        with self.lock:
            self.databases.setdefault(database, {})[key] = value

    def flush_count(self) -> int:
        """返回替身收到的 FLUSHDB 命令次数。"""
        with self.lock:
            return sum(1 for command in self.commands if command[0].upper() == "FLUSHDB")

    def recorded(self, name: str) -> list[tuple[str, ...]]:
        """返回指定命令名的全部记录，便于断言命令序列。

        Args:
            name: 命令名，大小写不敏感。
        Returns:
            匹配的命令元组列表。
        """
        with self.lock:
            return [command for command in self.commands if command[0].upper() == name.upper()]

    def dispatch(self, parts: list[str], database: int) -> tuple[int, bytes]:
        """执行一条命令并返回新的连接库编号与 RESP 回复。

        Args:
            parts: 命令名与参数。
            database: 该连接当前选中的逻辑库编号。
        Returns:
            更新后的逻辑库编号与要回写的 RESP 字节串。
        副作用:
            记录命令；写入类命令会修改内存键空间。
        """
        with self.lock:
            self.commands.append(tuple(parts))
            name = parts[0].upper() if parts else ""
            if name == "AUTH":
                if self.password is not None and parts[1] != self.password:
                    return database, b"-ERR invalid password\r\n"
                return database, b"+OK\r\n"
            if name == "SELECT":
                number = int(parts[1])
                if number < 0 or number >= self.database_count:
                    return database, b"-ERR DB index is out of range\r\n"
                return number, b"+OK\r\n"
            if name == "DBSIZE":
                return database, f":{len(self.databases.get(database, {}))}\r\n".encode()
            if name == "SET":
                key, value = parts[1], parts[2]
                options = {part.upper() for part in parts[3:]}
                if "NX" in options and key in self.databases.get(database, {}):
                    return database, b"$-1\r\n"
                self.databases.setdefault(database, {})[key] = value
                return database, b"+OK\r\n"
            if name == "GET":
                value = self.databases.get(database, {}).get(parts[1])
                if value is None:
                    return database, b"$-1\r\n"
                payload = value.encode("utf-8")
                return database, b"$" + str(len(payload)).encode() + b"\r\n" + payload + b"\r\n"
            if name == "DEL":
                removed = self.databases.setdefault(database, {}).pop(parts[1], None)
                return database, f":{1 if removed is not None else 0}\r\n".encode()
            if name == "FLUSHDB":
                self.databases[database] = {}
                return database, b"+OK\r\n"
            return database, f"-ERR unknown command '{parts[0]}'\r\n".encode()


@pytest.fixture(name="fake_redis")
def fake_redis_fixture():
    """启动真实 TCP 的内存 Redis 替身并在用例后关闭。

    Yields:
        已监听环回端口的替身服务器。
    """
    server = FakeRedisServer()
    thread = threading.Thread(target=server.serve_forever, name="fake-redis", daemon=True)
    thread.start()
    yield server
    server.shutdown()
    server.server_close()
    assert not thread.is_alive()


def test_claim_redis_database_skips_foreign_data_and_never_flushes(fake_redis: FakeRedisServer) -> None:
    """自动挑选跳过已有数据的逻辑库，外部数据保持原样且不发生任何清理。"""
    fake_redis.set_key(1, "someone-else:key", "value")
    ownership = harness.claim_redis_database("127.0.0.1", fake_redis.port, "", None)
    assert ownership.database == 2
    assert fake_redis.keys_of(1) == {"someone-else:key": "value"}
    assert fake_redis.keys_of(2) == {harness.REDIS_LOCK_KEY: ownership.token}
    assert fake_redis.flush_count() == 0


def test_claim_redis_database_auto_selection_keeps_concurrent_runs_apart(
        fake_redis: FakeRedisServer) -> None:
    """两次并发取得会落到不同逻辑库，后一次不触碰前一次已独占的库。"""
    first = harness.claim_redis_database("127.0.0.1", fake_redis.port, "", None)
    second = harness.claim_redis_database("127.0.0.1", fake_redis.port, "", None)
    assert first.database != second.database
    assert fake_redis.keys_of(first.database) == {harness.REDIS_LOCK_KEY: first.token}
    assert fake_redis.keys_of(second.database) == {harness.REDIS_LOCK_KEY: second.token}
    assert fake_redis.flush_count() == 0


def test_claim_redis_database_refuses_requested_library_with_foreign_data(
        fake_redis: FakeRedisServer) -> None:
    """显式指定已有外部数据的逻辑库必须拒绝，且不读取后清理。"""
    fake_redis.set_key(5, "someone-else:key", "value")
    with pytest.raises(harness.EnvironmentFailure) as failure:
        harness.claim_redis_database("127.0.0.1", fake_redis.port, "", 5)
    assert "拒绝清理或复用" in str(failure.value)
    assert fake_redis.keys_of(5) == {"someone-else:key": "value"}
    assert fake_redis.flush_count() == 0


def test_claim_redis_database_reports_concurrent_owner(fake_redis: FakeRedisServer) -> None:
    """显式指定已被其他运行独占的逻辑库时拒绝，并保留对方的标记键。"""
    # 合成标记值代表另一次运行写入的所有权标记，不是凭据。
    competing_mark = harness.REDIS_LOCK_VALUE_PREFIX + "another-run"
    fake_redis.set_key(5, harness.REDIS_LOCK_KEY, competing_mark)
    with pytest.raises(harness.EnvironmentFailure) as failure:
        harness.claim_redis_database("127.0.0.1", fake_redis.port, "", 5)
    assert "业务端到端运行占用" in str(failure.value)
    assert fake_redis.keys_of(5) == {harness.REDIS_LOCK_KEY: competing_mark}
    assert fake_redis.flush_count() == 0


def test_claim_redis_database_rejects_shared_library_zero(fake_redis: FakeRedisServer) -> None:
    """0 号共享库在任何连接之前就被拒绝。"""
    with pytest.raises(harness.EnvironmentFailure) as failure:
        harness.claim_redis_database("127.0.0.1", fake_redis.port, "", 0)
    assert "0 号库" in str(failure.value)
    assert fake_redis.commands == []


def test_claim_redis_database_skips_unavailable_library_numbers() -> None:
    """服务端逻辑库数量较小时跳过越界编号，显式指定越界编号则明确失败。"""
    server = FakeRedisServer(database_count=4)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        server.set_key(1, "someone-else:key", "value")
        ownership = harness.claim_redis_database("127.0.0.1", server.port, "", None)
        assert ownership.database == 2
        with pytest.raises(harness.EnvironmentFailure) as failure:
            harness.claim_redis_database("127.0.0.1", server.port, "", 9)
        assert "不可用" in str(failure.value)
        assert server.keys_of(1) == {"someone-else:key": "value"}
    finally:
        server.shutdown()
        server.server_close()
        assert not thread.is_alive()


def test_claim_redis_database_authenticates_with_isolated_password() -> None:
    """配置口令时先完成认证，口令错误必须受控失败。"""
    server = FakeRedisServer(password="DUMMY-REDIS-PASSWORD")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        ownership = harness.claim_redis_database("127.0.0.1", server.port, "DUMMY-REDIS-PASSWORD", None)
        assert ownership.database == 1
        assert server.recorded("AUTH")[0] == ("AUTH", "DUMMY-REDIS-PASSWORD")
        with pytest.raises(harness.EnvironmentFailure):
            harness.claim_redis_database("127.0.0.1", server.port, "DUMMY-WRONG-PASSWORD", None)
        assert server.flush_count() == 0
    finally:
        server.shutdown()
        server.server_close()
        assert not thread.is_alive()


def test_release_redis_database_clears_only_owned_library(fake_redis: FakeRedisServer) -> None:
    """回收只在所有权标记匹配时清空该库，业务键随本次运行一起被清理。"""
    ownership = harness.claim_redis_database("127.0.0.1", fake_redis.port, "", 5)
    fake_redis.set_key(5, "business:key", "value")
    harness.release_redis_database(ownership)
    assert fake_redis.keys_of(5) == {}
    assert fake_redis.flush_count() == 1
    assert fake_redis.recorded("SELECT")[-1] == ("SELECT", "5")


def test_release_redis_database_refuses_changed_owner(fake_redis: FakeRedisServer) -> None:
    """所有权标记已被替换时拒绝清理，库中数据保持原样。"""
    ownership = harness.claim_redis_database("127.0.0.1", fake_redis.port, "", 5)
    fake_redis.set_key(5, harness.REDIS_LOCK_KEY, harness.REDIS_LOCK_VALUE_PREFIX + "taken-over")
    fake_redis.set_key(5, "business:key", "value")
    with pytest.raises(harness.EnvironmentFailure) as failure:
        harness.release_redis_database(ownership)
    assert "所有权标记已变更" in str(failure.value)
    assert fake_redis.keys_of(5)["business:key"] == "value"
    assert fake_redis.flush_count() == 0


def test_release_redis_database_keeps_foreign_library_intact(fake_redis: FakeRedisServer) -> None:
    """伪造的所有权记录指向他人数据时，清理被拒绝且数据不受影响。"""
    fake_redis.set_key(9, "someone-else:key", "value")
    forged = harness.RedisOwnership("127.0.0.1", fake_redis.port, "", 9, "forged-token")
    with pytest.raises(harness.EnvironmentFailure):
        harness.release_redis_database(forged)
    assert fake_redis.keys_of(9) == {"someone-else:key": "value"}
    assert fake_redis.flush_count() == 0


# ---------------------------------------------------------------------------
# 精确 PID 进程回收：真实子进程验证，Windows 分支用可替换的回收命令等价核对。
# ---------------------------------------------------------------------------


def wait_for_port_state(port: int, *, busy: bool, timeout: float = 15.0) -> bool:
    """轮询等待端口进入被占用或空闲状态。

    Args:
        port: 待观察的环回端口。
        busy: True 表示等待端口被占用，False 表示等待端口可再次绑定。
        timeout: 等待秒数上限。
    Returns:
        在超时前进入目标状态时为 True。
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        probe = socket.socket()
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", port))
            available = True
        except OSError:
            available = False
        finally:
            probe.close()
        if available is not busy:
            return True
        time.sleep(0.2)
    return False


GRANDCHILD_LISTENER = (
    "import socket, sys, time\n"
    "listener = socket.socket()\n"
    "listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)\n"
    "listener.bind(('127.0.0.1', int(sys.argv[1])))\n"
    "listener.listen(1)\n"
    "time.sleep(120)\n"
)

GROUP_LEADER = (
    "import subprocess, sys, time\n"
    "subprocess.Popen([sys.executable, '-c', sys.argv[2], sys.argv[1]])\n"
    "time.sleep(120)\n"
)


def free_loopback_port() -> int:
    """取得一个当前空闲的环回端口编号，供真实子进程占用。

    Returns:
        刚释放的端口编号；调用方需自行承担被其他进程抢占的极小概率。
    """
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = int(probe.getsockname()[1])
    probe.close()
    return port


def test_terminate_process_tree_reaps_real_child_process() -> None:
    """真实子进程被按精确 PID 回收，回收后进程状态确实为已退出。"""
    process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"],
                               start_new_session=True)
    try:
        assert process.poll() is None
        harness.terminate_process_tree(process, "测试子进程", grace=10)
        assert process.poll() is not None
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)


def test_terminate_process_tree_reaps_descendant_process_group() -> None:
    """独立进程组中的孙进程随组长一起回收：它占用的端口可以重新绑定。"""
    port = free_loopback_port()
    process = subprocess.Popen([sys.executable, "-c", GROUP_LEADER, str(port), GRANDCHILD_LISTENER],
                               start_new_session=True)
    try:
        assert wait_for_port_state(port, busy=True), "孙进程未按预期占用端口"
        harness.terminate_process_tree(process, "测试进程组", grace=10)
        assert process.poll() is not None
        assert wait_for_port_state(port, busy=False), "孙进程仍占用端口，说明未被整组回收"
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)


def test_windows_tree_kill_command_targets_exact_pid(monkeypatch: pytest.MonkeyPatch,
                                                     tmp_path: Path) -> None:
    """Windows 分支按精确 PID 构造 taskkill 命令，不按进程名匹配。"""
    executable = tmp_path / "taskkill.exe"
    executable.write_bytes(b"")
    monkeypatch.setattr(harness.shutil, "which",
                        lambda name: str(executable) if name == "taskkill" else None)
    assert harness.windows_tree_kill_command(4321) == [str(executable), "/PID", "4321", "/T", "/F"]


def test_windows_tree_kill_command_uses_system_root_fallback(monkeypatch: pytest.MonkeyPatch,
                                                             tmp_path: Path) -> None:
    """PATH 上没有 taskkill 时使用 SystemRoot 下的固定位置。"""
    system32 = tmp_path / "System32"
    system32.mkdir()
    (system32 / "taskkill.exe").write_bytes(b"")
    monkeypatch.setattr(harness.shutil, "which", lambda name: None)
    monkeypatch.setenv("SystemRoot", str(tmp_path))
    assert harness.windows_tree_kill_command(7) == [str(system32 / "taskkill.exe"),
                                                    "/PID", "7", "/T", "/F"]


def test_windows_tree_kill_command_returns_none_without_taskkill(monkeypatch: pytest.MonkeyPatch,
                                                                 tmp_path: Path) -> None:
    """系统确实没有 taskkill 时返回空值，由调用方回退到按 PID 结束。"""
    monkeypatch.setattr(harness.shutil, "which", lambda name: None)
    monkeypatch.setenv("SystemRoot", str(tmp_path))
    assert harness.windows_tree_kill_command(7) is None


def test_terminate_process_tree_uses_windows_branch(monkeypatch: pytest.MonkeyPatch) -> None:
    """平台分支切到 Windows 时仍能真实回收进程，不依赖 os.getpgid 等 POSIX 接口。"""
    process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"],
                               start_new_session=True)
    on_windows = harness.running_on_windows()
    command_holder: list[list[str]] = []
    real_run = subprocess.run

    def tree_command(pid: int) -> list[str]:
        """替身：在当前平台构造等价于 taskkill /T /F 的整树结束命令。"""
        if on_windows:
            real = harness.windows_tree_kill_command(pid)
            assert real is not None
            return real
        return [sys.executable, "-c",
                "import os, signal, sys; os.kill(int(sys.argv[1]), signal.SIGKILL)", str(pid)]

    def record_run(command: list[str], **kwargs: object):
        """替身：记录进程树结束命令后交给真实实现执行。"""
        command_holder.append(list(command))
        return real_run(command, capture_output=True, check=False)

    monkeypatch.setattr(harness, "running_on_windows", lambda: True)
    monkeypatch.setattr(harness, "windows_tree_kill_command", tree_command)
    monkeypatch.setattr(harness.subprocess, "run", record_run)
    try:
        harness.terminate_process_tree(process, "替身 Windows 进程", grace=10)
        assert process.poll() is not None
        assert len(command_holder) == 1
        assert command_holder[0][-1] == str(process.pid)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)


def test_terminate_windows_branch_falls_back_when_tree_command_fails(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """进程树回收命令失败时改用按 PID 结束，进程仍然被回收。"""
    process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"],
                               start_new_session=True)
    monkeypatch.setattr(harness, "running_on_windows", lambda: True)
    monkeypatch.setattr(harness, "windows_tree_kill_command",
                        lambda pid: [sys.executable, "-c", "import sys; sys.exit(1)"])
    try:
        harness.terminate_process_tree(process, "替身 Windows 进程", grace=10)
        assert process.poll() is not None
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)


def test_remove_workspace_deletes_only_given_directory(tmp_path: Path) -> None:
    """临时目录被递归删除，未登记时不做任何操作。"""
    workspace = tmp_path / "workspace"
    (workspace / "nested").mkdir(parents=True)
    (workspace / "nested" / "file.txt").write_text("data", encoding="utf-8")
    neighbour = tmp_path / "keep.txt"
    neighbour.write_text("keep", encoding="utf-8")
    harness.remove_workspace(workspace)
    harness.remove_workspace(None)
    assert not workspace.exists() and neighbour.read_text(encoding="utf-8") == "keep"


def test_install_termination_handlers_converts_sigterm() -> None:
    """安装后终止信号被转换为 KeyboardInterrupt，使回收路径得以执行。"""
    original = signal.getsignal(signal.SIGTERM)
    try:
        harness.install_termination_handlers()
        handler = signal.getsignal(signal.SIGTERM)
        assert callable(handler) and handler is not signal.SIG_DFL
        with pytest.raises(KeyboardInterrupt):
            handler(signal.SIGTERM, None)
    finally:
        signal.signal(signal.SIGTERM, original)


@pytest.mark.skipif(os.name == "nt", reason="Windows 上 os.kill 不支持向自身投递可捕获的 SIGTERM")
def test_termination_signal_reaches_real_cleanup(tmp_path: Path) -> None:
    """真实子进程收到 SIGTERM 后执行回收并返回中断退出码。"""
    repository_root = Path(harness.__file__).resolve().parents[2]
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    marker = tmp_path / "cleaned.marker"
    script = (
        "import os, signal, sys\n"
        "sys.path.insert(0, sys.argv[1])\n"
        "from scripts.e2e import run_business_e2e as harness\n"
        "harness.install_termination_handlers()\n"
        "try:\n"
        "    os.kill(os.getpid(), signal.SIGTERM)\n"
        "except KeyboardInterrupt:\n"
        "    harness.remove_workspace(__import__('pathlib').Path(sys.argv[3]))\n"
        "    open(sys.argv[2], 'w', encoding='utf-8').write('cleaned')\n"
        "    raise SystemExit(130)\n"
        "raise SystemExit(0)\n"
    )
    result = subprocess.run([sys.executable, "-B", "-X", "utf8", "-c", script,
                             str(repository_root), str(marker), str(workspace)],
                            capture_output=True, timeout=60, check=False)
    assert result.returncode == 130, result.stderr.decode("utf-8", "replace")
    assert marker.read_text(encoding="utf-8") == "cleaned"
    assert not workspace.exists()


# ---------------------------------------------------------------------------
# 资源登记与回收路径：用替身记录副作用，核对只有本次取得的资源被回收。
# ---------------------------------------------------------------------------


def new_run_records() -> dict[str, list]:
    """创建一次替身运行的调用记录容器。

    Returns:
        含 claims、releases、drops、created、started、terminated 六个列表的字典。
    """
    return {"claims": [], "releases": [], "drops": [], "created": [], "started": [], "terminated": []}


def prepare_run(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, records: dict[str, list],
                *, ports_free: bool = True, start_error: BaseException | None = None,
                release_error: BaseException | None = None,
                drop_error: BaseException | None = None,
                keep: bool = False) -> argparse.Namespace:
    """把 execute 的外部依赖替换为受控替身，返回本次运行的命令行参数。

    替身只记录调用并按需抛出受控异常，不连接 MySQL、Redis、后端、浏览器或网络服务。

    Args:
        monkeypatch: pytest 提供的替换工具。
        tmp_path: 独立临时目录，用于放置替身 JAR。
        records: 由本函数填充的调用记录容器。
        ports_free: 端口预检结果；False 用于复现预检失败路径。
        start_error: 后端启动替身抛出的异常；为空时返回替身进程对象。
        release_error: Redis 回收替身抛出的异常；为空时只记录。
        drop_error: 隔离库删除替身抛出的异常；为空时只记录。
        keep: 是否按 --keep 保留资源。
    Returns:
        可直接交给 execute 的参数对象。
    """
    jar = tmp_path / "backend.jar"
    jar.write_bytes(b"placeholder")
    workspace = tmp_path / "run-workspace"
    for name, value in (
        ("AUTH_TEST_MYSQL_URL", "jdbc:mysql://127.0.0.1:13306/bf_placeholder"),
        ("AUTH_TEST_MYSQL_USERNAME", "DUMMY-USER"),
        ("AUTH_TEST_MYSQL_PASSWORD", "DUMMY-DB-PASSWORD"),
        ("BF_TEST_REDIS_PORT", "16399"),
        ("BF_TEST_REDIS_PASSWORD", "DUMMY-REDIS-PASSWORD"),
        ("BF_TEST_S3_ENDPOINT", "http://127.0.0.1:19000"),
        ("BF_TEST_S3_ACCESS_KEY", "DUMMY-KEY"),
        ("BF_TEST_S3_SECRET_KEY", "DUMMY-SECRET"),
        ("BF_TEST_MYSQL_CLIENT", sys.executable),
    ):
        monkeypatch.setenv(name, value)

    def fake_claim(host: str, port: int, password: str, requested: int | None) -> harness.RedisOwnership:
        """替身：记录所有权请求并返回固定逻辑库，不连接真实 Redis。"""
        records["claims"].append((host, port, requested))
        return harness.RedisOwnership(host, port, password, 7, "token-7")

    def fake_release(ownership: harness.RedisOwnership) -> None:
        """替身：记录回收请求，必要时抛出受控失败。"""
        records["releases"].append(ownership)
        if release_error is not None:
            raise release_error

    def fake_drop(mysql: dict[str, str], database: str) -> None:
        """替身：记录删库请求，必要时抛出受控失败。"""
        records["drops"].append(database)
        if drop_error is not None:
            raise drop_error

    def fake_start(java: str, jar_path: Path, environment: dict[str, str], log_path: Path):
        """替身：记录后端启动请求，必要时抛出受控异常，否则返回替身进程。"""
        records["started"].append(str(jar_path))
        if start_error is not None:
            raise start_error
        return types.SimpleNamespace(pid=4321, stdout=None)

    def fake_wait_for_http(url: str, timeout: int, process: object = None) -> None:
        """替身：跳过真实就绪探针，不发起网络请求。"""

    def fake_start_preview(dist_root: Path, port: int, backend: tuple[str, int]):
        """替身：不启动真实预览服务，返回空服务与空线程。"""
        return None, None

    def fake_terminate(process: object, name: str, grace: int = 15) -> None:
        """替身：记录进程回收请求，不向真实进程发送信号。"""
        records["terminated"].append(name)

    def fake_mkdtemp(prefix: str = "") -> str:
        """替身：在 pytest 临时目录下建工作目录，避免污染系统临时目录。"""
        workspace.mkdir(parents=True, exist_ok=True)
        return str(workspace)

    monkeypatch.setattr(harness.tempfile, "mkdtemp", fake_mkdtemp)
    monkeypatch.setattr(harness, "free_port", lambda port: ports_free)
    monkeypatch.setattr(harness, "resolve_java", lambda explicit: sys.executable)
    monkeypatch.setattr(harness, "claim_redis_database", fake_claim)
    monkeypatch.setattr(harness, "release_redis_database", fake_release)
    monkeypatch.setattr(harness, "drop_database", fake_drop)
    monkeypatch.setattr(harness, "create_database",
                        lambda mysql, database: records["created"].append(database))
    monkeypatch.setattr(harness, "import_schema", lambda mysql, database: None)
    monkeypatch.setattr(harness, "bootstrap_admin", lambda *args: None)
    monkeypatch.setattr(harness, "prepare_served_dist", lambda dist_root, target: None)
    monkeypatch.setattr(harness, "start_backend", fake_start)
    monkeypatch.setattr(harness, "wait_for_http", fake_wait_for_http)
    monkeypatch.setattr(harness, "start_preview", fake_start_preview)
    monkeypatch.setattr(harness, "verify_preview_configuration", lambda base_url: None)
    monkeypatch.setattr(harness, "terminate_process_tree", fake_terminate)
    monkeypatch.setattr(harness, "run_playwright", lambda *args, **kwargs: 0)
    monkeypatch.setattr(harness, "read_playwright_summary",
                        lambda report: {"total": 1, "passed": 1, "failed": 0,
                                        "skipped": 0, "flaky": 0})
    arguments = harness.parse_arguments(["--skip-backend-build", "--skip-frontend-build",
                                         "--jar", str(jar)])
    arguments.keep = keep
    return arguments


def test_execute_preflight_failure_never_claims_or_cleans_redis(monkeypatch: pytest.MonkeyPatch,
                                                               tmp_path: Path) -> None:
    """端口预检失败时不取得也不回收 Redis 与隔离库，运行以环境失败结束。"""
    records = new_run_records()
    arguments = prepare_run(monkeypatch, tmp_path, records, ports_free=False)
    with pytest.raises(harness.EnvironmentFailure) as failure:
        harness.execute(arguments)
    assert "已被占用" in str(failure.value)
    assert records["claims"] == [] and records["releases"] == []
    assert records["created"] == [] and records["drops"] == []
    assert not (tmp_path / "run-workspace").exists(), "预检失败后临时目录仍应被回收"


def test_execute_startup_failure_releases_only_claimed_resources(monkeypatch: pytest.MonkeyPatch,
                                                                 tmp_path: Path) -> None:
    """预检通过后取得所有权；启动失败时只回收已取得的 Redis 与隔离库。"""
    records = new_run_records()
    arguments = prepare_run(monkeypatch, tmp_path, records,
                            start_error=harness.EnvironmentFailure("后端进程无法启动"))
    with pytest.raises(harness.EnvironmentFailure) as failure:
        harness.execute(arguments)
    assert str(failure.value) == "后端进程无法启动"
    assert [item[2] for item in records["claims"]] == [None]
    assert len(records["releases"]) == 1 and records["releases"][0].database == 7
    assert len(records["created"]) == 1 and records["drops"] == records["created"]
    assert harness.DATABASE_PATTERN.fullmatch(records["drops"][0])
    assert not (tmp_path / "run-workspace").exists(), "启动失败后临时目录仍应被回收"


def test_execute_interrupt_reclaims_before_reraising(monkeypatch: pytest.MonkeyPatch,
                                                     tmp_path: Path) -> None:
    """键盘中断在向外抛出之前完成回收，不遗留已取得的资源。"""
    records = new_run_records()
    arguments = prepare_run(monkeypatch, tmp_path, records, start_error=KeyboardInterrupt())
    with pytest.raises(KeyboardInterrupt):
        harness.execute(arguments)
    assert len(records["releases"]) == 1 and len(records["drops"]) == 1


def test_execute_keep_preserves_claimed_resources(monkeypatch: pytest.MonkeyPatch,
                                                  tmp_path: Path) -> None:
    """--keep 时不回收任何已取得资源，交由人工诊断。"""
    records = new_run_records()
    arguments = prepare_run(monkeypatch, tmp_path, records, keep=True,
                            start_error=harness.EnvironmentFailure("后端进程无法启动"))
    with pytest.raises(harness.EnvironmentFailure):
        harness.execute(arguments)
    assert records["releases"] == [] and records["drops"] == []
    assert (tmp_path / "run-workspace").is_dir(), "--keep 应保留临时目录供诊断"


def test_execute_success_path_releases_claimed_resources(monkeypatch: pytest.MonkeyPatch,
                                                         tmp_path: Path,
                                                         capsys: pytest.CaptureFixture) -> None:
    """完整成功路径回收本次独占的 Redis、隔离库与后端进程，并返回用例退出码。"""
    records = new_run_records()
    arguments = prepare_run(monkeypatch, tmp_path, records)
    assert harness.execute(arguments) == 0
    assert len(records["releases"]) == 1 and len(records["drops"]) == 1
    assert records["terminated"] == ["后端服务"]
    assert len(records["created"]) == 1 and records["started"]
    assert not (tmp_path / "run-workspace").exists(), "成功路径也应删除临时目录"
    assert capsys.readouterr().err == ""


def test_execute_reports_incomplete_cleanup(monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
                                            capsys: pytest.CaptureFixture) -> None:
    """用例成功但回收不完整时返回 2 并在标准错误逐条报告残留。"""
    records = new_run_records()
    arguments = prepare_run(monkeypatch, tmp_path, records,
                            release_error=harness.EnvironmentFailure("所有权标记已变更"),
                            drop_error=harness.EnvironmentFailure("隔离库删除失败"))
    assert harness.execute(arguments) == 2
    errors = capsys.readouterr().err
    assert "Redis 逻辑库回收失败" in errors and "隔离库回收失败" in errors


def test_cleanup_reports_each_failure_and_continues(monkeypatch: pytest.MonkeyPatch) -> None:
    """单项回收失败不中断其余步骤，失败项逐条返回。"""
    environment = harness.RunningEnvironment(
        database="bf_e2e_0123456789ab", mysql={"client": "mysql"},
        redis=harness.RedisOwnership("127.0.0.1", 16399, "DUMMY-REDIS-PASSWORD", 5, "token"))
    order: list[str] = []

    def failing_drop(mysql: dict[str, str], database: str) -> None:
        """替身：删库失败，用于验证后续步骤仍会执行。"""
        raise harness.EnvironmentFailure("隔离库删除失败")

    def failing_release(ownership: harness.RedisOwnership) -> None:
        """替身：Redis 回收失败，用于验证失败被记录而不是中断清理。"""
        raise harness.EnvironmentFailure("所有权标记已变更")

    monkeypatch.setattr(harness, "terminate_process_tree",
                        lambda process, name, grace=15: order.append("backend"))
    monkeypatch.setattr(harness, "drop_database", failing_drop)
    monkeypatch.setattr(harness, "release_redis_database", failing_release)
    monkeypatch.setattr(harness, "remove_workspace", lambda workspace: order.append("workspace"))
    failures = harness.cleanup(environment)
    assert order == ["backend", "workspace"]
    assert len(failures) == 2
    assert any("隔离库回收失败" in item for item in failures)
    assert any("Redis 逻辑库回收失败" in item for item in failures)
