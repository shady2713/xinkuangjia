"""验证性能基线编排脚本的纯逻辑：隔离目标构造、进程启动形态、输出目录边界与资源回收。

本文件不启动 MySQL、后端或真实测量：外部依赖通过受控替身验证编排契约，重点是
"隔离资源只回收本次取得的""报告不得落在仓库内""查询数轮必须重启后端并切换 MyBatis 日志"
这些一旦写错就会污染读数的前提。真实测量由 `scripts/perf/run_baseline.py` 整链覆盖。

@author 李杰
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import types
from pathlib import Path

import pytest

from scripts.perf import run_baseline as harness

ROOT = Path(__file__).resolve().parents[2]
# 固定夹具统一带 DUMMY 标记，显式声明为合成值，不指向任何可连接环境的真实凭据。
DUMMY_USER = "DUMMY-user"
DUMMY_PASSWORD = "DUMMY-password"
REDIS = types.SimpleNamespace(host="127.0.0.1", port=6380, password="DUMMY-redis", database=3)
S3 = {
    "BF_TEST_S3_ENDPOINT": "http://127.0.0.1:9000",
    "BF_TEST_S3_ACCESS_KEY": "DUMMY-ak",
    "BF_TEST_S3_SECRET_KEY": "DUMMY-sk",
}
ISOLATED_DATABASE = "bf_perf_0123456789ab"


@pytest.fixture(autouse=True)
def _no_proxy_ambient(monkeypatch: pytest.MonkeyPatch) -> None:
    """清除机器代理，避免环回地址的环境变量影响被测环境构造。"""

    for name in ("http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY",
                 "no_proxy", "NO_PROXY"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture()
def mysqld_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """注入合成连接变量，使入口的隔离校验可以走到目标检查之前。"""

    monkeypatch.setenv("AUTH_TEST_MYSQL_URL", "jdbc:mysql://127.0.0.1:3306/")
    monkeypatch.setenv("AUTH_TEST_MYSQL_USERNAME", DUMMY_USER)
    monkeypatch.setenv("AUTH_TEST_MYSQL_PASSWORD", DUMMY_PASSWORD)


def target() -> harness.MySQLTarget:
    """构造只用于参数断言的合成 MySQL 目标。"""

    return harness.MySQLTarget(client="/tmp/bf-perf-mysql", host="127.0.0.1", port="3306",
                               user=DUMMY_USER, password=DUMMY_PASSWORD)


class RunRecorder:
    """记录 subprocess.run 参数并返回预设退出码的受控替身。"""

    def __init__(self, returncode: int = 0) -> None:
        """保存预设退出码。

        Args:
            returncode: 每次调用返回的退出码。
        """

        self.returncode = returncode
        self.commands: list[list[str]] = []
        self.kwargs: list[dict[str, object]] = []

    def __call__(self, command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        """记录本次调用并返回合成结果。

        Args:
            command: 实际执行的命令行。
            kwargs: 实际传入的关键字参数。
        Returns:
            退出码为预设值的合成结果。
        """

        self.commands.append(list(command))
        self.kwargs.append(kwargs)
        return subprocess.CompletedProcess(command, self.returncode, "", "")


class PopenRecorder:
    """记录 subprocess.Popen 参数的受控替身。"""

    def __init__(self, pid: int = 4321) -> None:
        """保存合成进程号。

        Args:
            pid: 返回给调用方的合成 PID。
        """

        self.pid = pid
        self.commands: list[list[str]] = []
        self.kwargs: list[dict[str, object]] = []

    def __call__(self, command: list[str], **kwargs: object) -> "PopenRecorder":
        """记录本次启动。

        Args:
            command: 实际执行的命令行。
            kwargs: 实际传入的关键字参数。
        Returns:
            本替身自身，充当已启动的进程。
        """

        self.commands.append(list(command))
        self.kwargs.append(kwargs)
        return self


def test_mysql_arguments_never_carry_password() -> None:
    """口令只能经 MYSQL_PWD 传入，命令行参数里不得出现账号口令。"""

    arguments = target().arguments("--execute", "SELECT 1")

    assert arguments[:5] == ["/tmp/bf-perf-mysql", "--host=127.0.0.1", "--port=3306",
                             f"--user={DUMMY_USER}", "--protocol=TCP"]
    assert arguments[5:] == ["--execute", "SELECT 1"]
    assert all(DUMMY_PASSWORD not in item for item in arguments)


def test_mysql_execute_passes_password_through_environment(monkeypatch: pytest.MonkeyPatch,
                                                          tmp_path: Path) -> None:
    """客户端子进程的真实环境必须带上口令，命令行仍不得包含口令。"""

    client = tmp_path / "fake-mysql"
    client.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    client.chmod(0o700)
    recorder = RunRecorder(returncode=0)
    monkeypatch.setattr(harness.subprocess, "run", recorder)
    real_target = harness.MySQLTarget(client=str(client), host="127.0.0.1", port="3306",
                                      user=DUMMY_USER, password=DUMMY_PASSWORD)

    assert real_target.execute("--execute", "SELECT 1") == 0
    assert recorder.commands[0][0] == str(client)
    assert recorder.kwargs[0]["env"]["MYSQL_PWD"] == DUMMY_PASSWORD
    assert all(DUMMY_PASSWORD not in item for item in recorder.commands[0])


def test_mysql_execute_propagates_client_failure(tmp_path: Path, monkeypatch: pytest.MonkeyPatch
                                                 ) -> None:
    """客户端失败必须原样返回非零退出码，供调用方如实判定。"""

    client = tmp_path / "fake-mysql"
    client.write_text("#!/bin/sh\nexit 3\n", encoding="utf-8")
    client.chmod(0o700)
    monkeypatch.setattr(harness.subprocess, "run", RunRecorder(returncode=3))
    real_target = harness.MySQLTarget(client=str(client), host="127.0.0.1", port="3306",
                                      user=DUMMY_USER, password=DUMMY_PASSWORD)

    assert real_target.execute("--execute", "SELECT 1") == 3


def test_backend_environment_pins_isolated_dependencies_and_disables_captcha() -> None:
    """后端环境必须完全来自本次隔离目标，并关闭验证码以便自动化测量。"""

    environment = harness.backend_environment(target(), ISOLATED_DATABASE, REDIS, S3,
                                             48090, Path("/tmp/app.log"), debug_sql=False)

    assert environment["SERVER_PORT"] == "48090"
    assert environment["SPRING_PROFILES_ACTIVE"] == "prod"
    assert environment["DB_NAME"] == ISOLATED_DATABASE
    assert environment["DB_HOST"] == "127.0.0.1"
    assert environment["DB_PASSWORD"] == DUMMY_PASSWORD
    assert environment["REDIS_DATABASE"] == "3"
    assert environment["MINIO_ENDPOINT"] == "http://127.0.0.1:9000"
    assert environment["BASIC_FRAMEWORK_CAPTCHA_ENABLE"] == "false"
    assert environment["LOG_FILE"] == "/tmp/app.log"
    # 上传额度必须提高，否则第二轮之后的请求会被真实业务规则拒绝并污染错误率。
    assert int(environment["FILE_UPLOAD_DAILY_BYTES"]) > 1024 * 1024
    assert int(environment["FILE_UPLOAD_DAILY_REQUESTS"]) > 1000
    for name in harness.SQL_DEBUG_VARIABLES:
        assert name not in environment


def test_backend_environment_debug_flag_only_affects_mappers() -> None:
    """查询数轮只放开 MyBatis 数据访问包，不能整体降到 DEBUG。"""

    environment = harness.backend_environment(target(), ISOLATED_DATABASE, REDIS, S3,
                                             48090, Path("/tmp/app.log"), debug_sql=True)

    for name in harness.SQL_DEBUG_VARIABLES:
        assert environment[name] == "DEBUG"
    assert "LOGGING_LEVEL_ROOT" not in environment
    assert "LOGGING_LEVEL_ORG_SPRINGFRAMEWORK" not in environment


def test_backend_environment_drops_stale_sql_debug_from_parent(monkeypatch: pytest.MonkeyPatch,
                                                                tmp_path: Path) -> None:
    """父进程残留的 DEBUG 变量不得让延迟轮被调试日志污染。"""

    monkeypatch.setenv(harness.SQL_DEBUG_VARIABLES[0], "DEBUG")

    environment = harness.backend_environment(target(), ISOLATED_DATABASE, REDIS, S3,
                                             48090, tmp_path / "app.log", debug_sql=False)

    assert harness.SQL_DEBUG_VARIABLES[0] not in environment


def test_start_backend_passes_heap_and_starts_new_session(monkeypatch: pytest.MonkeyPatch,
                                                          tmp_path: Path) -> None:
    """被测 JVM 的堆参数必须显式传入，进程必须独立成组以便精确回收。"""

    recorder = PopenRecorder()
    monkeypatch.setattr(harness.subprocess, "Popen", recorder)
    jar = tmp_path / "app.jar"
    jar.write_bytes(b"x")

    process = harness.start_backend("/usr/bin/java", jar, {"A": "1"}, tmp_path / "out.log",
                                    ["-Xms512m", "-Xmx1024m"])

    assert process.pid == 4321
    assert recorder.commands[0] == ["/usr/bin/java", "-Xms512m", "-Xmx1024m",
                                    "-Dfile.encoding=UTF-8", "-jar", str(jar)]
    assert recorder.kwargs[0]["start_new_session"] is True
    assert recorder.kwargs[0]["cwd"] == harness.BACKEND_ROOT


def test_stop_backend_is_idempotent_and_absent_process_is_never_killed(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """没有在测进程时不得调用进程组回收，避免误杀其他运行的服务。"""

    calls: list[tuple[object, str]] = []
    monkeypatch.setattr(harness.isolation, "terminate_process_tree",
                        lambda process, name: calls.append((process, name)))
    resources = harness.Resources()

    harness.stop_backend(resources)
    harness.stop_backend(resources)

    assert calls == []


def test_stop_backend_releases_registered_process(monkeypatch: pytest.MonkeyPatch) -> None:
    """在测进程必须按精确 PID 整组回收，并在回收后清空登记。"""

    calls: list[tuple[object, str]] = []
    monkeypatch.setattr(harness.isolation, "terminate_process_tree",
                        lambda process, name: calls.append((process, name)))
    resources = harness.Resources(backend=types.SimpleNamespace(pid=99))

    harness.stop_backend(resources)

    assert [name for _, name in calls] == ["被测后端"]
    assert resources.backend is None


def test_seed_dataset_passes_credentials_without_touching_environment(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """合成数据集必须把已解析凭据直接传下去，不写入 BF_PERF_* 环境变量。"""

    recorded: dict[str, object] = {}

    def fake_seed(client: str, host: str, port: str, database: str, users: int, dicts: int,
                  chunk: int, user_type: str,
                  credentials: tuple[str, str] | None = None) -> tuple[int, int]:
        """记录调用参数后返回写入行数。"""

        recorded.update(client=client, host=host, database=database, users=users, dicts=dicts,
                        user_type=user_type, credentials=credentials)
        return users, dicts

    monkeypatch.setattr(harness.seeder, "seed", fake_seed)
    monkeypatch.delenv("BF_PERF_MYSQL_PASSWORD", raising=False)

    harness.seed_dataset(target(), ISOLATED_DATABASE, 5000, 300)

    assert recorded["credentials"] == (DUMMY_USER, DUMMY_PASSWORD)
    assert recorded["user_type"] == "super_admin"
    assert recorded["users"] == 5000 and recorded["dicts"] == 300
    assert os.environ.get("BF_PERF_MYSQL_PASSWORD") is None


def test_seed_dataset_reports_real_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """数据集写入失败必须转为环境失败，不允许静默继续测量。"""

    def failing_seed(*args: object, **kwargs: object) -> tuple[int, int]:
        """模拟客户端执行失败。"""

        raise harness.seeder.SeedFailure("数据集语句执行失败")

    monkeypatch.setattr(harness.seeder, "seed", failing_seed)

    with pytest.raises(harness.isolation.EnvironmentFailure):
        harness.seed_dataset(target(), ISOLATED_DATABASE, 10, 10)


def test_create_database_rejects_foreign_names(monkeypatch: pytest.MonkeyPatch) -> None:
    """只有符合隔离命名约定的库名才允许创建，避免写到业务库。"""

    recorder = RunRecorder()
    monkeypatch.setattr(harness.subprocess, "run", recorder)

    with pytest.raises(harness.isolation.EnvironmentFailure):
        harness.create_database(target(), "business_production")

    assert recorder.commands == []


def test_create_database_creates_isolated_database(monkeypatch: pytest.MonkeyPatch) -> None:
    """符合约定的库名必须真的下发建库语句。"""

    recorder = RunRecorder()
    monkeypatch.setattr(harness.subprocess, "run", recorder)

    harness.create_database(target(), ISOLATED_DATABASE)

    assert f"CREATE DATABASE `{ISOLATED_DATABASE}`" in recorder.commands[0][-1]


def test_drop_database_rejects_foreign_names(monkeypatch: pytest.MonkeyPatch) -> None:
    """删除只允许本次命名约定的库，其余情况如实说明而不执行。"""

    recorder = RunRecorder()
    monkeypatch.setattr(harness.subprocess, "run", recorder)

    assert harness.drop_database(target(), "business_production") == "跳过删除：库名不是本次运行的隔离库"
    assert recorder.commands == []


def test_drop_database_reports_residual_when_client_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    """删库失败必须留下可核对的残留说明，不能当成已回收。"""

    monkeypatch.setattr(harness.subprocess, "run", RunRecorder(returncode=1))

    assert "残留" in harness.drop_database(target(), ISOLATED_DATABASE)


def test_cleanup_releases_only_acquired_resources(monkeypatch: pytest.MonkeyPatch,
                                                  tmp_path: Path) -> None:
    """回收只作用于本次取得的资源：未取得的库与 Redis 不得被触碰。"""

    events: list[str] = []
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.setattr(harness, "stop_backend",
                        lambda resources: events.append("backend") if resources.backend else None)
    monkeypatch.setattr(harness.isolation, "release_redis_database",
                        lambda ownership: events.append("redis"))
    monkeypatch.setattr(harness, "drop_database",
                        lambda mysql, database: events.append("database") or "")

    assert harness.cleanup(harness.Resources(workspace=workspace), target()) == []
    assert events == []

    resources = harness.Resources(redis=REDIS, database=ISOLATED_DATABASE, workspace=workspace)
    assert harness.cleanup(resources, target()) == []
    assert events == ["redis", "database"]
    assert not workspace.exists()


def test_cleanup_keeps_workspace_when_requested(monkeypatch: pytest.MonkeyPatch,
                                                tmp_path: Path) -> None:
    """--keep 时保留临时目录与隔离资源供人工核对，回收函数不得删除。"""

    monkeypatch.setattr(harness, "stop_backend", lambda resources: None)
    monkeypatch.setattr(harness.isolation, "release_redis_database", lambda ownership: None)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    resources = harness.Resources(redis=REDIS, workspace=workspace, keep_workspace=True)

    assert harness.cleanup(resources, target()) == []
    assert workspace.exists()
    # Redis 所有权仍需释放，否则隔离库会被标记继续占用。
    assert resources.redis is None


def test_cleanup_reports_incomplete_release(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Redis 所有权标记变化导致回收失败时必须如实上报，不能吞掉。"""

    monkeypatch.setattr(harness, "stop_backend", lambda resources: None)

    def refuse(ownership: object) -> None:
        """模拟所有权标记已被其他运行接管。"""

        raise harness.isolation.EnvironmentFailure("标记已变更")

    monkeypatch.setattr(harness.isolation, "release_redis_database", refuse)
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    failures = harness.cleanup(harness.Resources(redis=REDIS, workspace=workspace), None)

    assert failures and "Redis" in failures[0]


def build_arguments(tmp_path: Path, lock: Path) -> harness.argparse.Namespace:
    """构造指向真实存在的 Maven 替身与指定锁文件的参数。"""

    maven = tmp_path / "mvn"
    maven.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    maven.chmod(0o700)
    return harness.parse_arguments(["--out-dir", str(tmp_path / "out"), "--maven", str(maven),
                                    "--maven-lock", str(lock)])


def test_build_backend_wraps_maven_with_lock(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """存在锁文件时 Maven 必须串行执行，避免与其他构建互相污染仓库。"""

    recorder = RunRecorder()
    monkeypatch.setattr(harness.subprocess, "run", recorder)
    lock = tmp_path / "mvn.lock"
    lock.write_text("")
    arguments = build_arguments(tmp_path, lock)
    maven = arguments.maven

    harness.build_backend(arguments, "/opt/jdk17/bin/java", tmp_path / "maven.log")

    command = recorder.commands[0]
    assert command[:3] == ["flock", str(lock), maven]
    assert command[3:] == ["-B", "-ntp", "-DskipTests", "package"]
    assert recorder.kwargs[0]["cwd"] == harness.BACKEND_ROOT
    assert recorder.kwargs[0]["env"]["JAVA_HOME"] == "/opt/jdk17"


def test_build_backend_without_lock_runs_maven_directly(monkeypatch: pytest.MonkeyPatch,
                                                        tmp_path: Path) -> None:
    """没有锁文件时直接执行 Maven，不得凭空引用不存在的锁。"""

    recorder = RunRecorder()
    monkeypatch.setattr(harness.subprocess, "run", recorder)
    arguments = build_arguments(tmp_path, tmp_path / "absent.lock")

    harness.build_backend(arguments, "/opt/jdk17/bin/java", tmp_path / "maven.log")

    assert recorder.commands[0][0] == str(arguments.maven)


def test_build_backend_reports_missing_maven(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """Maven 不存在时如实退出 2，不得继续测量未更新的构件。"""

    monkeypatch.setattr(harness.subprocess, "run", RunRecorder())
    arguments = harness.parse_arguments(["--out-dir", str(tmp_path / "out"), "--maven",
                                         str(tmp_path / "absent-mvn"),
                                         "--maven-lock", str(tmp_path / "absent.lock")])

    with pytest.raises(harness.isolation.EnvironmentFailure):
        harness.build_backend(arguments, "/opt/jdk17/bin/java", tmp_path / "maven.log")


def test_build_backend_reports_failure(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """构建失败必须以环境失败结束，不得继续测量未更新的构件。"""

    monkeypatch.setattr(harness.subprocess, "run", RunRecorder(returncode=1))
    arguments = build_arguments(tmp_path, tmp_path / "absent.lock")

    with pytest.raises(harness.isolation.EnvironmentFailure):
        harness.build_backend(arguments, "/opt/jdk17/bin/java", tmp_path / "maven.log")


def test_output_directory_inside_repository_is_rejected(mysqld_environment: None) -> None:
    """报告落在仓库内会把实测证据混进版本控制范围，必须拒绝并返回 2。"""

    assert harness.main(["--out-dir", str(ROOT / ".cache" / "perf")]) == 2


def test_output_directory_at_repository_root_is_rejected(mysqld_environment: None) -> None:
    """输出目录等于仓库根同样属于仓库内，必须拒绝。"""

    assert harness.main(["--out-dir", str(ROOT)]) == 2


def test_missing_jar_is_reported_before_touching_services(tmp_path: Path,
                                                         mysqld_environment: None) -> None:
    """缺少被测构件时如实退出 2，不创建隔离库也不占用 Redis 逻辑库。"""

    assert harness.main(["--out-dir", str(tmp_path / "out"), "--jar", str(tmp_path / "absent.jar")]) == 2


def test_entry_without_any_target_is_rejected() -> None:
    """没有盘点目标时入口必须拒绝，不能产出空清单冒充已盘点。"""

    assert harness.main(["--out-dir", "/tmp/bf-perf-unused"]) == 2


def test_missing_connection_variables_are_reported_by_name(tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
                                                           mysqld_environment: None) -> None:
    """缺少连接变量时如实退出 2，不猜测默认值。"""

    monkeypatch.delenv("BF_TEST_REDIS_PORT", raising=False)

    assert harness.main(["--out-dir", str(tmp_path / "out")]) == 2


def test_run_tool_propagates_exit_code(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """测量工具的非零退出码必须原样上抛，不能被吞成成功。"""

    monkeypatch.setattr(harness.subprocess, "run", RunRecorder(returncode=2))
    capture = tmp_path / "tool.log"

    assert harness.run_tool("scripts.perf.measure_endpoints", ["--out", "x"], {},
                            capture=capture) == 2
    assert capture.exists()


def test_measurement_tools_are_invoked_with_utf8_bytecode_flags(monkeypatch: pytest.MonkeyPatch,
                                                                tmp_path: Path) -> None:
    """测量子进程必须沿用仓库统一的 -B -X utf8 调用方式，避免缓存与编码差异。"""

    recorder = RunRecorder()
    monkeypatch.setattr(harness.subprocess, "run", recorder)

    harness.run_tool("scripts.perf.merge_reports", ["--out", "x"], {"K": "V"})

    command = recorder.commands[0]
    assert command[:5] == [sys.executable, "-B", "-X", "utf8", "-m"]
    assert command[5] == "scripts.perf.merge_reports"
    assert recorder.kwargs[0]["env"] == {"K": "V"}
    assert recorder.kwargs[0]["cwd"] == harness.REPOSITORY_ROOT


def test_isolated_database_name_matches_cleanup_pattern() -> None:
    """回收依赖命名约定，建库与删库必须使用同一前缀。"""

    assert harness.DATABASE_PREFIX == "bf_perf_"
    assert harness.DATABASE_PATTERN.fullmatch("bf_perf_" + "0" * 12)
    assert not harness.DATABASE_PATTERN.fullmatch("bf_e2e_" + "0" * 12)


def test_cli_help_exits_zero() -> None:
    """命令行帮助是运维核对入口，必须可用。"""

    with pytest.raises(SystemExit) as captured:
        harness.parse_arguments(["--help"])

    assert captured.value.code == 0


def write_verdict(path: Path, document: object) -> Path:
    """把一份 perf_budget.py 真实结构的结论写进指定文件，供回显用例消费。

    Args:
        path: 结论文件路径。
        document: 顶层对象；允许非对象以覆盖结构损坏的情形。
    Returns:
        写入后的结论文件路径。
    """

    path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
    return path


def test_verdict_findings_are_echoed_to_stdout(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """核心回归（run 37739234202）：逐条 findings 必须回到 stdout，不能只留在临时目录。

    真实缺陷是判定子进程的 stdout 被 capture 进 verdict.json，而父进程只打印
    「判定退出码 1」；作业判红后临时目录不再保留，事后无法判断失败类别。本用例钉住
    kind、场景、实测值与预算值四处都能在进程标准输出里读到。
    """

    path = write_verdict(tmp_path / "verdict.json", {
        "protocol": "quality-check/v1", "check": "性能预算", "schema": "perf-budget/v2",
        "status": "failed", "checked": 9, "workload": "w7-baseline-v1",
        "binding": {"method": "git-source-id/v1", "scope": "backend-build-inputs/v1",
                    "matched": False,
                    "declared": {"git_revision": "a" * 40, "source_sha256": "b" * 64},
                    "observed": {"git_revision": "c" * 40, "source_sha256": "d" * 64}},
        "findings": [
            {"kind": "over-budget", "scenario": "auth-login", "metric": "p95_ms",
             "observed": 900.0, "allowed": 170.0, "message": "p95 900.0 ms 超过预算 170.0 ms"},
            {"kind": "scenario-missing", "scenario": "dict-type-page", "metric": "samples",
             "observed": None, "allowed": None, "message": "报告中没有该场景的测量结果"},
            {"kind": "build-mismatch", "scenario": "*", "metric": "source_sha256",
             "observed": None, "allowed": None,
             "message": "报告源码摘要与预算声明不一致，测的不是被校准的那份代码"},
        ],
    })

    harness.print_verdict(path, 1)

    out = capsys.readouterr().out
    assert "[over-budget]" in out and "auth-login" in out and "p95_ms" in out
    assert "900.0" in out and "170.0" in out
    assert "[scenario-missing]" in out and "dict-type-page" in out
    assert "[build-mismatch]" in out and "source_sha256" in out
    # 绑定结论必须单独回显：换了绑定方式之后，「测的是不是被校准的那份代码」不能只
    # 藏在某个 finding 文字里。
    assert "构件绑定 git-source-id/v1：不相符" in out
    assert "c" * 40 in out and "a" * 40 in out
    assert "状态 failed" in out and "实际核对场景 9 个" in out


def test_verdict_echo_never_changes_the_verdict(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """回显只是展示：结论文件缺失或损坏时如实报告，不抛错也不替换判定进程的退出码。"""

    missing = tmp_path / "not-exists.json"
    broken = write_verdict(tmp_path / "broken.json", {"status": "failed"})
    not_object = write_verdict(tmp_path / "list.json", ["不是对象"])
    item_broken = write_verdict(tmp_path / "item.json", {"status": "failed", "findings": ["裸字符串"]})

    harness.print_verdict(missing, 1)
    harness.print_verdict(broken, 1)
    harness.print_verdict(not_object, 2)
    harness.print_verdict(item_broken, 1)

    out = capsys.readouterr().out
    assert "无法读取" in out and "原样保留" in out
    assert "缺少 findings 列表" in out
    assert "顶层不是对象" in out
    assert "结论条目不是对象" in out


def test_failed_verdict_without_findings_is_still_reported(tmp_path: Path,
                                                           capsys: pytest.CaptureFixture[str]) -> None:
    """判定未通过却没有任何 finding 时必须说出来，不能让失败在日志里静默。"""

    path = write_verdict(tmp_path / "verdict.json", {
        "status": "failed", "checked": 10, "workload": "w7-baseline-v1", "findings": []})

    harness.print_verdict(path, 1)

    assert "没有任何 finding" in capsys.readouterr().out


def test_orchestrate_maps_verdict_exit_code_without_swallowing(tmp_path: Path,
                                                              monkeypatch: pytest.MonkeyPatch) -> None:
    """退出码仍按判定进程的真实结果传递：0 → 0、1 → 1、2 → 2。

    2 表示「报告或预算本身不可用」（例如预算未回填可复现的源码身份），与「测了但没
    达标」是两类问题；把它折叠成 1 会让预算不可用看起来像一次普通超标。
    """

    arguments = harness.parse_arguments(["--out-dir", str(tmp_path / "out")])
    resources = harness.Resources(workspace=tmp_path)
    resources.database = ISOLATED_DATABASE
    resources.redis = REDIS
    monkeypatch.setattr(harness, "create_database", lambda *_: None)
    monkeypatch.setattr(harness, "import_schema", lambda *_: None)
    monkeypatch.setattr(harness, "seed_dataset", lambda *_: None)
    monkeypatch.setattr(harness.isolation, "bootstrap_admin", lambda *_: None)
    monkeypatch.setattr(harness.isolation, "wait_for_http", lambda *_: True)
    monkeypatch.setattr(harness, "start_backend", lambda *_: PopenRecorder())
    monkeypatch.setattr(harness, "stop_backend", lambda *_: None)
    monkeypatch.setattr(harness.seeder, "seed", lambda *_, **__: None)
    monkeypatch.setattr(harness, "log", lambda message: None)

    def install_verdict(code: int) -> None:
        """让编排走到判定并返回指定退出码，同时写出与真实结构一致的结论文件。"""

        def fake_run_tool(module: str, arguments_: list[str], environment: dict[str, str],
                          capture: Path | None = None) -> int:
            """只让判定这一步返回指定退出码，其余测量步骤始终成功。

            Args:
                module: 被调用的工具模块名。
                arguments_: 该次调用的真实命令行参数。
                environment: 该次调用的子进程环境。
                capture: 需要写出的结论文件；为空表示不落盘。
            Returns:
                判定步骤返回给定退出码，测量与合并返回 0。
            """

            # 只有判定这一步返回指定退出码；测量与合并始终成功，让用例能走到判定。
            if module != "scripts.perf.perf_budget":
                return 0
            if capture is not None:
                write_verdict(capture, {"status": "failed" if code else "passed", "checked": 10,
                                        "workload": "w7-baseline-v1",
                                        "findings": [] if code == 0 else
                                        [{"kind": "over-budget", "scenario": "auth-login",
                                          "metric": "p95_ms", "observed": 1.0, "allowed": 2.0,
                                          "message": "超预算"}]})
            return code

        monkeypatch.setattr(harness, "run_tool", fake_run_tool)

    mysql_target = target()
    install_verdict(0)
    assert harness.orchestrate(arguments, resources, mysql_target, S3, "java",
                               harness.DEFAULT_JAR) == 0
    install_verdict(1)
    assert harness.orchestrate(arguments, resources, mysql_target, S3, "java",
                               harness.DEFAULT_JAR) == 1
    install_verdict(2)
    assert harness.orchestrate(arguments, resources, mysql_target, S3, "java",
                               harness.DEFAULT_JAR) == 2


def test_measurement_rounds_receive_the_reproducible_binding_arguments(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """两轮测量都必须带上构件绑定所需的两项参数：修订与源码根。

    绑定退化成空值等于关掉构件核对，因此这里钉住参数确实出现在真实命令行里，而不是
    依赖测量工具的默认值在某个环境下恰好可用。
    """

    recorded: list[list[str]] = []
    arguments = harness.parse_arguments(["--out-dir", str(tmp_path / "out"),
                                        "--git-revision", "0" * 40,
                                        "--source-root", str(tmp_path / "source")])
    resources = harness.Resources(workspace=tmp_path)
    resources.database = ISOLATED_DATABASE
    resources.redis = REDIS
    monkeypatch.setattr(harness, "create_database", lambda *_: None)
    monkeypatch.setattr(harness, "import_schema", lambda *_: None)
    monkeypatch.setattr(harness, "seed_dataset", lambda *_: None)
    monkeypatch.setattr(harness.isolation, "bootstrap_admin", lambda *_: None)
    monkeypatch.setattr(harness.isolation, "wait_for_http", lambda *_: True)
    monkeypatch.setattr(harness, "start_backend", lambda *_: PopenRecorder())
    monkeypatch.setattr(harness, "stop_backend", lambda *_: None)
    monkeypatch.setattr(harness.seeder, "seed", lambda *_, **__: None)
    monkeypatch.setattr(harness, "log", lambda message: None)

    def recording_run_tool(module: str, arguments_: list[str], environment: dict[str, str],
                           capture: Path | None = None) -> int:
        """记录测量轮的真实命令行，并让判定写出空结论以便流程走完。"""

        if module == "scripts.perf.measure_endpoints":
            recorded.append(list(arguments_))
            return 0
        if capture is not None:
            write_verdict(capture, {"status": "failed", "checked": 0,
                                    "workload": "w7-baseline-v1", "findings": []})
        return 0

    monkeypatch.setattr(harness, "run_tool", recording_run_tool)
    harness.orchestrate(arguments, resources, target(), S3, "java", harness.DEFAULT_JAR)

    assert len(recorded) == 2, recorded
    for command in recorded:
        assert command[command.index("--git-revision") + 1] == "0" * 40
        assert command[command.index("--source-root") + 1] == str(tmp_path / "source")
