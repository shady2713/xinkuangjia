"""在本次自建的隔离环境中真实测量关键链路性能基线，并按预算文件给出判定。

环境编排复用 `scripts/e2e/run_business_e2e.py` 已有的隔离协议：随机单库、空库结构导入、
一次性管理员初始化、按所有权标记取得的 Redis 逻辑库、精确 PID 进程组回收。本工具不新建
隔离设施，也不复用其他脚本留下的服务；任何一步失败都如实退出，不产出估算读数。

测量分两轮，与《性能预算与基线》一致：延迟轮在常规日志级别下运行，查询数轮重启后端并把
MyBatis 日志调到 DEBUG 后按迭代时间窗统计请求线程的语句执行。两轮报告由 `merge_reports.py`
合并，再由 `perf_budget.py` 对照受版本控制的预算文件判定。预算文件里的构件摘要与本次
被测 JAR 不一致时，判定如实返回 `build-mismatch`，本工具不修改预算去迁就结果。

退出码：0 表示测量与判定都完成且未超预算；1 表示超预算或证据不足；2 表示环境编排失败或
资源回收不完整。

运行（仓库根）：

    python -B -X utf8 scripts/perf/run_baseline.py --out-dir <仓库外目录> --password-env <口令变量名>

连接变量与浏览器业务端到端一致：AUTH_TEST_MYSQL_URL、AUTH_TEST_MYSQL_USERNAME、
AUTH_TEST_MYSQL_PASSWORD、BF_TEST_REDIS_PORT、BF_TEST_REDIS_PASSWORD、BF_TEST_S3_ENDPOINT、
BF_TEST_S3_ACCESS_KEY、BF_TEST_S3_SECRET_KEY；可选 BF_TEST_MYSQL_CLIENT 指定 MySQL 客户端入口。
凭据只从进程环境读取，不进入命令行参数、报告或日志。

@author 李杰
"""

from __future__ import annotations

import argparse
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence

if __package__ in (None, ""):  # 直接以脚本路径运行时补上仓库根，便于复用隔离协议模块。
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.e2e import run_business_e2e as isolation  # noqa: E402
from scripts.perf import seed_dataset as seeder  # noqa: E402

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPOSITORY_ROOT / "后端代码" / "basic-framework-boot"
PERF_ROOT = Path(__file__).resolve().parent
DEFAULT_JAR = BACKEND_ROOT / "basic-framework-server" / "target" / "basic-framework-server.jar"
SCHEMA_FILE = REPOSITORY_ROOT / "数据库文件" / "basic_framework.sql"
DEFAULT_BUDGETS = PERF_ROOT / "budgets" / "baseline-w7.json"
DATABASE_PREFIX = "bf_perf_"
DATABASE_PATTERN = re.compile(r"bf_perf_[0-9a-f]{12}")
ADMIN_USERNAME = "perfadmin"
# 上传链路的日额度按业务规模设置；基线要重复上传同一场景，必须显式提高，
# 否则第二轮之后的请求会被真实业务规则拒绝，污染错误率与延迟读数。
UPLOAD_BUDGET_OVERRIDES = {
    "FILE_UPLOAD_DAILY_BYTES": str(64 * 1024 * 1024 * 1024),
    "FILE_UPLOAD_DAILY_REQUESTS": "1000000",
}
# 查询数轮只放开 MyBatis 所在的两个数据访问包，不整体降到 DEBUG。
SQL_DEBUG_VARIABLES = (
    "LOGGING_LEVEL_COM_BASICFRAMEWORK_MODULE_SYSTEM_DAL_MYSQL",
    "LOGGING_LEVEL_COM_BASICFRAMEWORK_MODULE_INFRA_DAL_MYSQL",
)


def log(message: str) -> None:
    """输出可核对的单行进度，不包含凭据、令牌或完整环境。

    Args:
        message: 已脱敏的进度说明。
    """

    print(f"[性能基线环境] {message}", flush=True)


@dataclass
class Resources:
    """登记本次运行已经取得的资源；未取得的字段保持 None，回收时跳过。

    Attributes:
        database: 本次创建的隔离库名。
        redis: 已取得独占所有权的 Redis 逻辑库记录。
        backend: 本次启动的后端进程。
        fault_proxy: 负对照轮次的固定延迟转发代理；正常轮次保持 None。
        workspace: 本次临时目录，位于仓库之外。
        keep_workspace: 是否保留临时目录（保留时由调用方负责核对与清理）。
    """

    database: str | None = None
    redis: isolation.RedisOwnership | None = None
    backend: subprocess.Popen | None = None
    fault_proxy: subprocess.Popen | None = None
    workspace: Path | None = None
    keep_workspace: bool = False


@dataclass(frozen=True)
class MySQLTarget:
    """本次使用的 MySQL 客户端入口与连接目标。

    Attributes:
        client: 可执行的 MySQL 客户端入口。
        host: 隔离 MySQL 主机。
        port: 隔离 MySQL 端口。
        user: 隔离账号。
        password: 隔离账号口令，只经进程环境传入子进程。
    """

    client: str
    host: str
    port: str
    user: str
    password: str

    def arguments(self, *extra: str) -> list[str]:
        """构造不含口令的客户端参数。

        Args:
            extra: 追加的真实客户端参数。
        Returns:
            完整参数列表；口令只通过 MYSQL_PWD 环境变量传递。
        """

        return [self.client, f"--host={self.host}", f"--port={self.port}",
                f"--user={self.user}", "--protocol=TCP", *extra]

    def execute(self, *arguments: str, stdin: Path | None = None) -> int:
        """执行一条客户端调用并返回真实退出码，口令只经子进程环境传递。

        Args:
            arguments: 客户端参数。
            stdin: 需要导入的 SQL 文件；为空时不提供标准输入。
        Returns:
            客户端退出码。
        """

        environment = dict(os.environ, MYSQL_PWD=self.password)
        stream = stdin.open("rb") if stdin is not None else subprocess.DEVNULL
        try:
            completed = subprocess.run(self.arguments(*arguments), stdin=stream, env=environment,
                                       capture_output=True, text=True, encoding="utf-8",
                                       errors="replace", timeout=600, check=False)
        finally:
            if stdin is not None:
                stream.close()
        return completed.returncode


def create_database(target: MySQLTarget, database: str) -> None:
    """创建本次运行独占的随机库。

    Args:
        target: 本次使用的 MySQL 目标。
        database: 已按隔离命名约定校验的库名。
    Raises:
        isolation.EnvironmentFailure: 库名不符合约定或创建失败。
    """

    if not DATABASE_PATTERN.fullmatch(database):
        raise isolation.EnvironmentFailure("随机库名不符合隔离约定")
    result = target.execute("--execute", f"CREATE DATABASE `{database}`"
                            " CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
    if result != 0:
        raise isolation.EnvironmentFailure("隔离库创建失败；未输出任何客户端诊断")


def import_schema(target: MySQLTarget, database: str) -> None:
    """把空库结构快照导入隔离库，不触碰任何已有业务库。

    Args:
        target: 本次使用的 MySQL 目标。
        database: 本次运行的隔离库名。
    Raises:
        isolation.EnvironmentFailure: 快照缺失或导入失败。
    """

    if not SCHEMA_FILE.is_file():
        raise isolation.EnvironmentFailure(f"缺少结构快照：{SCHEMA_FILE}")
    result = target.execute(f"--database={database}", "--default-character-set=utf8mb4",
                            stdin=SCHEMA_FILE)
    if result != 0:
        raise isolation.EnvironmentFailure("结构快照导入失败；未输出任何客户端诊断")


def drop_database(target: MySQLTarget, database: str) -> None:
    """删除本次运行创建的隔离库；失败时如实记录残留。

    Args:
        target: 本次使用的 MySQL 目标。
        database: 本次运行的隔离库名。
    Returns:
        成功时为空字符串，失败时为可核对的说明。
    """

    if not DATABASE_PATTERN.fullmatch(database):
        return "跳过删除：库名不是本次运行的隔离库"
    if target.execute("--execute", f"DROP DATABASE IF EXISTS `{database}`") == 0:
        return ""
    return "隔离库删除失败，请人工核对残留"


def seed_dataset(target: MySQLTarget, database: str, users: int, dicts: int) -> None:
    """写入本次测量使用的固定规模合成数据集。

    复用 `seed_dataset.py` 的固定常量生成器，但直接调用其纯逻辑函数，使调用方不必把
    凭据经环境变量转交一次；口径与单独执行该脚本完全一致。

    Args:
        target: 本次使用的 MySQL 目标。
        database: 本次运行的隔离库名。
        users: 合成用户行数。
        dicts: 合成字典类型行数。
    Raises:
        isolation.EnvironmentFailure: 数据集写入失败。
    """

    try:
        seeder.seed(target.client, target.host, target.port, database, users, dicts, 200,
                    "super_admin", (target.user, target.password))
    except seeder.SeedFailure as error:
        raise isolation.EnvironmentFailure(f"合成数据集写入失败：{error}") from error


def backend_environment(target: MySQLTarget, database: str, redis: isolation.RedisOwnership,
                        s3: dict[str, str], port: int, log_file: Path,
                        debug_sql: bool) -> dict[str, str]:
    """构造真实后端的运行环境，关闭验证码并固定本次隔离依赖。

    与浏览器端到端不同，性能测量不对界面负责：使用 prod 配置与常规日志级别，只把端口、
    隔离依赖和上传额度写入本次进程环境；一切配置都来自本次隔离目标，不读取仓库内 .env。

    Args:
        target: 本次使用的 MySQL 目标。
        database: 本次运行的隔离库名。
        redis: 本次已取得独占所有权的 Redis 逻辑库记录。
        s3: 对象存储端点与凭据。
        port: 后端监听端口。
        log_file: 后端文件日志路径，必须位于本次临时目录。
        debug_sql: 是否把 MyBatis 日志调到 DEBUG（查询数轮为真）。
    Returns:
        仅用于本次后端子进程的完整环境。
    """

    environment = isolation.isolated_environment(dict(os.environ))
    environment.update({
        "SERVER_PORT": str(port),
        "SPRING_PROFILES_ACTIVE": "prod",
        "DB_HOST": target.host,
        "DB_PORT": target.port,
        "DB_NAME": database,
        "DB_USERNAME": target.user,
        "DB_PASSWORD": target.password,
        "REDIS_HOST": redis.host,
        "REDIS_PORT": str(redis.port),
        "REDIS_DATABASE": str(redis.database),
        "REDIS_PASSWORD": redis.password,
        "MINIO_ENDPOINT": s3["BF_TEST_S3_ENDPOINT"],
        "MINIO_ACCESS_KEY": s3["BF_TEST_S3_ACCESS_KEY"],
        "MINIO_SECRET_KEY": s3["BF_TEST_S3_SECRET_KEY"],
        "MINIO_BUCKET": "bf-perf-baseline",
        "MINIO_SECURE": "false",
        "MINIO_REGION": "us-east-1",
        "MINIO_PUBLIC_URL": s3["BF_TEST_S3_ENDPOINT"],
        # 图形验证码需要人工拖动，自动化测量无法完成；与既有基线保持同一前提。
        "BASIC_FRAMEWORK_CAPTCHA_ENABLE": "false",
        "LOG_FILE": str(log_file),
    })
    environment.update(UPLOAD_BUDGET_OVERRIDES)
    for name in SQL_DEBUG_VARIABLES:
        environment.pop(name, None)
    if debug_sql:
        environment.update({name: "DEBUG" for name in SQL_DEBUG_VARIABLES})
    return environment


def start_backend(java: str, jar: Path, environment: dict[str, str], stdout_path: Path,
                  heap: Sequence[str]) -> subprocess.Popen:
    """以独立进程组启动真实后端，便于按精确 PID 整组回收。

    Args:
        java: 本次使用的 java 路径。
        jar: 被测后端 JAR。
        environment: 已构造的后端运行环境。
        stdout_path: 后端标准输出与错误输出日志路径。
        heap: 本次 JVM 堆参数，固定传入以保证与预算声明可比。
    Returns:
        已启动的后端进程；调用者负责就绪等待与回收。
    Raises:
        isolation.EnvironmentFailure: 进程无法启动。
    """

    stream = stdout_path.open("wb")
    try:
        return subprocess.Popen([java, *heap, "-Dfile.encoding=UTF-8", "-jar", str(jar)],
                                cwd=BACKEND_ROOT, env=environment, stdout=stream,
                                stderr=subprocess.STDOUT, start_new_session=True)
    except OSError as error:
        stream.close()
        raise isolation.EnvironmentFailure("后端进程无法启动") from error


def stop_backend(resources: Resources) -> None:
    """回收当前被测后端进程组；回收失败如实上报，不静默忽略。"""

    if resources.backend is None:
        return
    isolation.terminate_process_tree(resources.backend, "被测后端")
    resources.backend = None


def stop_fault_proxy(resources: Resources) -> None:
    """回收负对照转发代理；没有启动时不执行任何操作。"""

    if resources.fault_proxy is None:
        return
    isolation.terminate_process_tree(resources.fault_proxy, "负对照转发代理")
    resources.fault_proxy = None


def run_tool(module: str, arguments: Sequence[str], environment: dict[str, str],
             capture: Path | None = None) -> int:
    """以子进程运行本仓库的性能工具并返回其真实退出码。

    Args:
        module: 工具模块名，例如 scripts.perf.measure_endpoints。
        arguments: 传给工具的命令行参数，不含凭据。
        environment: 子进程环境；凭据只经环境注入。
        capture: 需要保存标准输出的文件；为空时继承本进程输出。
    Returns:
        工具退出码。
    """

    command = [sys.executable, "-B", "-X", "utf8", "-m", module, *arguments]
    if capture is None:
        return subprocess.run(command, cwd=REPOSITORY_ROOT, env=environment,
                              check=False).returncode
    with capture.open("wb") as stream:
        return subprocess.run(command, cwd=REPOSITORY_ROOT, env=environment, check=False,
                              stdout=stream).returncode


def parse_arguments(arguments: Sequence[str] | None) -> argparse.Namespace:
    """解析命令行参数。

    Args:
        arguments: 原始命令行参数；为空时读取进程参数。
    Returns:
        已解析的参数。
    """

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, required=True,
                        help="报告输出目录；必须位于仓库之外，本次不删除")
    parser.add_argument("--password-env", default="BF_PERF_ADMIN_PASSWORD",
                        help="存放管理员口令的环境变量名；未设置时本次随机生成")
    parser.add_argument("--jar", type=Path, default=DEFAULT_JAR, help="被测后端 JAR 路径")
    parser.add_argument("--java", help="本次使用的 java 路径；缺省取 JAVA_HOME 或 PATH")
    parser.add_argument("--maven", default="mvn", help="Maven 可执行文件，仅 --build 时使用")
    parser.add_argument("--maven-lock", type=Path,
                        default=Path("/home/weetion/桌面/kuangjia/.bf-local/mvn.lock"),
                        help="Maven 串行锁文件；存在时用 flock 包裹构建")
    parser.add_argument("--build", action="store_true", help="先用 Maven 重新打包再测量")
    parser.add_argument("--backend-port", type=int, default=48090, help="后端监听端口")
    parser.add_argument("--redis-database", type=int,
                        help="显式指定隔离 Redis 逻辑库；缺省自动挑选空库")
    parser.add_argument("--users", type=int, default=5000, help="合成用户行数")
    parser.add_argument("--dicts", type=int, default=300, help="合成字典类型行数")
    parser.add_argument("--samples", type=int, default=120, help="每场景有效样本数")
    parser.add_argument("--warmup", type=int, default=10, help="每场景预热迭代数")
    parser.add_argument("--concurrency-samples", type=int, default=40,
                        help="并发场景每线程样本数")
    parser.add_argument("--heap", default="-Xms512m -Xmx1024m", help="被测后端 JVM 堆参数")
    parser.add_argument("--budgets", type=Path, default=DEFAULT_BUDGETS, help="受版本控制的预算文件")
    parser.add_argument("--workload", default="w7-baseline-v1", help="负载标识")
    parser.add_argument("--ready-timeout", type=int, default=300, help="后端就绪等待秒数上限")
    parser.add_argument("--ready-path", default="/admin-api/system/auth/get-permission-info",
                        help="就绪探针路径；必须是匿名可达且返回 HTTP 200 的真实入口")
    parser.add_argument("--scenarios", nargs="*", help="只测量指定场景名，便于定位单项")
    parser.add_argument("--skip-budget", action="store_true",
                        help="只产出实测报告，不运行预算判定")
    parser.add_argument("--fault-delay-ms", type=int,
                        help="负对照：在环回地址插入固定延迟后测量；仅用于本地变异对照证据，"
                             "禁止用于交付或联调环境")
    parser.add_argument("--fault-port", type=int, default=48091, help="负对照转发代理监听端口")
    parser.add_argument("--keep", action="store_true",
                        help="按 --keep 保留隔离资源与临时目录，结束后打印其位置")
    return parser.parse_args(arguments)


def build_backend(arguments: argparse.Namespace, java: str, log_path: Path) -> None:
    """用 Maven 串行锁重新打包当前工作区的后端 JAR。

    Args:
        arguments: 已解析的命令行参数。
        java: 本次使用的 java 路径，用于推导 JAVA_HOME。
        log_path: 构建输出日志路径。
    Raises:
        isolation.EnvironmentFailure: Maven 不存在或构建失败。
    """

    maven = arguments.maven
    if not shutil.which(maven) and not Path(maven).is_file():
        raise isolation.EnvironmentFailure(f"未找到 Maven：{maven}")
    environment = isolation.isolated_environment(dict(os.environ))
    environment["JAVA_HOME"] = str(Path(java).resolve().parent.parent)
    log(f"打包后端（日志：{log_path}）")
    command = [maven, "-B", "-ntp", "-DskipTests", "package"]
    if arguments.maven_lock.is_file():
        command = ["flock", str(arguments.maven_lock), *command]
    with log_path.open("wb") as stream:
        result = subprocess.run(command, cwd=BACKEND_ROOT, env=environment, stdout=stream,
                                stderr=subprocess.STDOUT, check=False)
    if result.returncode != 0:
        raise isolation.EnvironmentFailure(f"后端打包失败，退出码 {result.returncode}，详见 {log_path}")


def orchestrate(arguments: argparse.Namespace, resources: Resources, target: MySQLTarget,
                 s3: dict[str, str], java: str, jar: Path) -> int:
    """完成两轮测量、合并与判定，返回测量与判定侧的真实退出码。

    Args:
        arguments: 已解析的命令行参数。
        resources: 本次运行登记的资源。
        target: 本次使用的 MySQL 目标。
        s3: 对象存储端点与凭据。
        java: 本次使用的 java 路径。
        jar: 被测后端 JAR。
    Returns:
        0 表示未超预算；1 表示超预算或证据不足；2 表示测量本身不可用。
    Raises:
        isolation.EnvironmentFailure: 环境或测量失败，由 main 统一转为退出码 2。
    """

    workspace = resources.workspace
    if workspace is None:
        raise isolation.EnvironmentFailure("临时目录未创建")
    output = arguments.out_dir
    output.mkdir(parents=True, exist_ok=True)
    password = os.environ.get(arguments.password_env) or f"Perf-{secrets.token_hex(10)}"
    database = DATABASE_PREFIX + uuid.uuid4().hex[:12]
    create_database(target, database)
    resources.database = database
    import_schema(target, database)
    isolation.bootstrap_admin(java, jar, {"client": target.client, "host": target.host,
                                         "port": target.port, "user": target.user,
                                         "password": target.password},
                              database, ADMIN_USERNAME, password, workspace / "bootstrap.log")
    seed_dataset(target, database, arguments.users, arguments.dicts)
    log(f"隔离环境就绪：库 {database}、用户 {arguments.users} 行、字典类型 {arguments.dicts} 行")

    base_url = f"http://127.0.0.1:{arguments.backend_port}"
    measurement = isolation.isolated_environment(dict(os.environ))
    measurement["BF_PERF_ADMIN_PASSWORD"] = password
    heap = arguments.heap.split()
    # 负对照只在环回地址插入延迟并把测量指向代理；交付与联调环境禁止使用该选项。
    measured_url = base_url
    if arguments.fault_delay_ms is not None:
        measured_url = f"http://127.0.0.1:{arguments.fault_port}"
    identity = ["--base-url", measured_url, "--username", ADMIN_USERNAME, "--jar", str(jar),
                "--workload", arguments.workload, "--profile", "prod"]

    def start(tag: str, debug_sql: bool) -> int:
        """启动一次被测后端并返回其 PID；就绪失败如实抛错。"""

        environment = backend_environment(target, database, resources.redis, s3,
                                          arguments.backend_port, workspace / f"app-{tag}.log",
                                          debug_sql)
        process = start_backend(java, jar, environment, workspace / f"stdout-{tag}.log", heap)
        resources.backend = process
        isolation.wait_for_http(base_url + arguments.ready_path, arguments.ready_timeout, process)
        log(f"后端就绪（{tag}）：PID {process.pid}")
        return process.pid

    def start_fault_proxy() -> None:
        """在环回地址启动固定延迟转发代理，仅用于本地负对照。"""

        proxy_log = (workspace / "fault-proxy.log").open("wb")
        try:
            resources.fault_proxy = subprocess.Popen(
                [sys.executable, "-B", "-X", "utf8", str(PERF_ROOT / "fault_proxy.py"),
                 "--listen-port", str(arguments.fault_port), "--upstream-port",
                 str(arguments.backend_port), "--delay-ms", str(arguments.fault_delay_ms)],
                cwd=REPOSITORY_ROOT,
                env=isolation.isolated_environment(dict(os.environ)),
                stdout=proxy_log, stderr=subprocess.STDOUT, start_new_session=True)
        except OSError as error:
            proxy_log.close()
            raise isolation.EnvironmentFailure("负对照转发代理无法启动") from error
        isolation.wait_for_http(measured_url + arguments.ready_path, arguments.ready_timeout,
                                resources.fault_proxy)
        log(f"负对照转发代理就绪：端口 {arguments.fault_port}，延迟 {arguments.fault_delay_ms} ms")

    try:
        latency_pid = start("latency", False)
        # 代理必须后端就绪之后再起：它转发到后端，先起代理会永远探测不到就绪。
        if arguments.fault_delay_ms is not None:
            start_fault_proxy()
        latency = [*identity, "--samples", str(arguments.samples),
                   "--warmup", str(arguments.warmup), "--warmup-passes", "1",
                   "--concurrency", "8",
                   "--concurrency-samples", str(arguments.concurrency_samples),
                   "--app-pid", str(latency_pid), "--out", str(output / "latency.json")]
        if arguments.scenarios:
            latency += ["--scenarios", *arguments.scenarios]
        if run_tool("scripts.perf.measure_endpoints", latency, measurement) != 0:
            raise isolation.EnvironmentFailure("延迟轮测量失败，未生成可用报告")
        stop_backend(resources)

        sql_pid = start("sql", True)
        sql = [*identity, "--samples", str(arguments.samples),
               "--warmup", str(arguments.warmup), "--concurrency", "1",
               "--app-log", str(workspace / "app-sql.log"),
               "--app-pid", str(sql_pid), "--out", str(output / "sql.json")]
        if arguments.scenarios:
            sql += ["--scenarios", *arguments.scenarios]
        if run_tool("scripts.perf.measure_endpoints", sql, measurement) != 0:
            raise isolation.EnvironmentFailure("查询数轮测量失败，未生成可用报告")
        stop_backend(resources)

        merged = output / "merged.json"
        if run_tool("scripts.perf.merge_reports",
                    ["--latency", str(output / "latency.json"), "--sql", str(output / "sql.json"),
                     "--out", str(merged)], measurement) != 0:
            raise isolation.EnvironmentFailure("两轮报告不可比，合并失败")
        if arguments.skip_budget:
            log(f"按 --skip-budget 跳过判定；合并报告在 {merged}")
            return 0
        verdict = run_tool("scripts.perf.perf_budget",
                           ["--report", str(merged), "--budgets", str(arguments.budgets),
                            "--json"], measurement, capture=output / "verdict.json")
        log(f"判定退出码 {verdict}；报告目录 {output}")
        return 0 if verdict == 0 else 1
    finally:
        stop_backend(resources)
        stop_fault_proxy(resources)


def cleanup(resources: Resources, target: MySQLTarget | None) -> list[str]:
    """只回收本次运行已成功取得的资源，未取得的字段不做任何操作。

    Args:
        resources: 本次运行登记的资源。
        target: 本次使用的 MySQL 目标；为空时跳过删库。
    Returns:
        回收过程中的失败说明；为空表示回收完整。
    """

    failures: list[str] = []
    try:
        stop_backend(resources)
    except Exception as error:  # noqa: BLE001 - 回收失败必须如实上报，不得吞掉
        failures.append(f"被测后端回收失败：{error}")
    try:
        stop_fault_proxy(resources)
    except Exception as error:  # noqa: BLE001 - 同上
        failures.append(f"负对照转发代理回收失败：{error}")
    if resources.redis is not None:
        try:
            isolation.release_redis_database(resources.redis)
        except Exception as error:  # noqa: BLE001 - 同上
            failures.append(f"Redis 逻辑库回收失败：{error}")
        resources.redis = None
    if resources.database and target is not None:
        try:
            residual = drop_database(target, resources.database)
        except Exception as error:  # noqa: BLE001 - 同上
            residual = f"隔离库回收失败：{error}"
        if residual:
            failures.append(residual)
        resources.database = None
    if resources.workspace is not None and not resources.keep_workspace:
        shutil.rmtree(resources.workspace, ignore_errors=True)
    return failures


def main(arguments: Sequence[str] | None = None) -> int:
    """执行入口：环境或回收失败返回 2，测量与判定保留真实退出码。

    Args:
        arguments: 原始命令行参数；为空时读取进程参数。
    Returns:
        进程退出码；被中断时返回 130。
    """

    parsed = parse_arguments(arguments)
    isolation.install_termination_handlers()
    resources = Resources(keep_workspace=parsed.keep)
    target: MySQLTarget | None = None
    result = 2
    try:
        resolved_output = str(parsed.out_dir.resolve())
        if resolved_output == str(REPOSITORY_ROOT) or resolved_output.startswith(
                str(REPOSITORY_ROOT) + os.sep):
            raise isolation.EnvironmentFailure("报告输出目录必须位于仓库之外")
        if not parsed.jar.is_file():
            raise isolation.EnvironmentFailure(f"缺少被测 JAR：{parsed.jar}")
        mysql_variables = isolation.require_environment(isolation.REQUIRED_MYSQL)
        redis_variables = isolation.require_environment(isolation.REQUIRED_REDIS)
        s3 = isolation.require_environment(isolation.REQUIRED_S3)
        host, port, _ = isolation.parse_jdbc_url(mysql_variables["AUTH_TEST_MYSQL_URL"])
        client = os.environ.get("BF_TEST_MYSQL_CLIENT") or shutil.which("mysql")
        if not client:
            raise isolation.EnvironmentFailure(
                "未找到 MySQL 客户端，请设置 BF_TEST_MYSQL_CLIENT 或安装 mysql")
        target = MySQLTarget(client=client, host=host, port=str(port),
                             user=mysql_variables["AUTH_TEST_MYSQL_USERNAME"],
                             password=mysql_variables["AUTH_TEST_MYSQL_PASSWORD"])
        resources.redis = isolation.claim_redis_database(
            "127.0.0.1", int(redis_variables["BF_TEST_REDIS_PORT"]),
            redis_variables["BF_TEST_REDIS_PASSWORD"], parsed.redis_database)
        resources.workspace = Path(tempfile.mkdtemp(prefix="bf-perf-baseline-"))
        java = isolation.resolve_java(parsed.java)
        if parsed.build:
            build_backend(parsed, java, resources.workspace / "maven.log")
        started = time.monotonic()
        result = orchestrate(parsed, resources, target, s3, java, parsed.jar)
        log(f"本次测量耗时 {time.monotonic() - started:.1f}s")
    except isolation.EnvironmentFailure as error:
        print(f"性能基线环境失败：{error}", file=sys.stderr)
        result = 2
    except KeyboardInterrupt:
        result = 130
    finally:
        failures = cleanup(resources, target)
        if parsed.keep and resources.workspace is not None:
            log(f"按 --keep 保留：库 {resources.database or '未创建'}、"
                f"Redis 逻辑库 {resources.redis.database if resources.redis else '未取得'}、"
                f"临时目录 {resources.workspace}、后端 PID "
                f"{resources.backend.pid if resources.backend else '已回收'}")
        for failure in failures:
            print(f"资源回收未完整：{failure}", file=sys.stderr)
        if failures:
            result = 2
    return result


if __name__ == "__main__":
    raise SystemExit(main())
