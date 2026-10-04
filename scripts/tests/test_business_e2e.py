"""验证浏览器业务端到端编排脚本的纯逻辑与真实本地服务，不连接外部环境。

用例覆盖连接地址解析、运行期配置覆盖、代理环境隔离、Redis 命令编码、端口占用判断、
Playwright 报告核对、状态判定，以及静态文件与接口转发服务的真实 HTTP 行为；
不启动 MySQL、后端或浏览器，这些由端到端真跑覆盖。

@author 李杰
"""

from __future__ import annotations

import http.client
import json
import os
import socket
import threading
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
    redis = ("127.0.0.1", 16379, "DUMMY-REDIS-PASSWORD", 5)
    s3 = {"BF_TEST_S3_ENDPOINT": "http://127.0.0.1:19000", "BF_TEST_S3_ACCESS_KEY": "DUMMY-KEY",
          "BF_TEST_S3_SECRET_KEY": "DUMMY-SECRET"}
    log_file = tmp_path / "backend.log"
    environment = harness.backend_environment(mysql, "bf_e2e_0123456789ab", redis, s3, 48099, 4173, log_file)
    assert environment["BASIC_FRAMEWORK_CAPTCHA_ENABLE"] == "false"
    assert environment["SERVER_PORT"] == "48099"
    assert environment["REDIS_DATABASE"] == "5"
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


def test_terminate_process_group_ignores_finished_process() -> None:
    """已结束或未启动的子进程不会被再次回收，也不影响调用方。"""
    harness.terminate_process_group(None, "后端服务")


def test_cleanup_tolerates_missing_resources() -> None:
    """未创建任何资源时清理是幂等的，不抛出异常。"""
    harness.cleanup(harness.RunningEnvironment())


def test_parse_arguments_defaults_use_uncommon_ports() -> None:
    """默认端口避开开发服务，且默认构建当前工作区产物。"""
    arguments = harness.parse_arguments([])
    assert arguments.backend_port == 48099
    assert arguments.preview_port == 4173
    assert arguments.redis_database == 5
    assert arguments.skip_backend_build is False and arguments.skip_frontend_build is False
    assert os.path.basename(arguments.jar) == "basic-framework-server.jar"
