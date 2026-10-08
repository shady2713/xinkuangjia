"""对隔离环境中的真实后端入口施加可复现负载，输出含原始样本的 perf-report/v1 报告。

工具只使用真实 HTTP 入口与真实中间件，不复制产品算法、不注入替身，也不修改被测代码。
每个场景的一次“迭代”对应一个用户动作，可能包含多个 HTTP 请求（例如创建后删除的 CRUD 环），
耗时覆盖该动作的全部请求；数据库查询数按应用日志中同线程的 MyBatis 执行行统计。

报告的 `build` 段同时记录两类证据：被测构件的字节摘要与大小（说明这次跑的到底是哪个
JAR），以及源码身份 `git_revision` 与 `source_sha256`（说明这份 JAR 对应哪份代码）。
预算按源码身份判定：构件字节摘要不可复现，同一提交在不同环境重建即不同，用它绑定会让
判定在任何干净检出的 CI 上恒定红灯。源码身份算不出来时本工具失败退出，不产出没有绑定
的报告——没有绑定的读数不能用于判定。

凭据只从进程环境读取，不进入命令行参数、报告或日志。缺少环境时明确失败，不跳过测量。

@author 李杰
"""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import re
import secrets
import statistics
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Sequence
from urllib.parse import urlencode, urlsplit

if __package__ in (None, ""):  # 直接以脚本路径运行时补上仓库根，便于复用源码身份计算。
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.perf import source_identity  # noqa: E402

ADMIN_PREFIX = "/admin-api"
REPORT_SCHEMA = "perf-report/v1"
TOKEN_HEADER = "Authorization"
# 仓库根：源码身份按仓库内容计算，默认从这里开始枚举。
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
# 应用日志中的应用线程前缀；后台线程（定时任务、异步日志写入）不计入请求查询数。
REQUEST_THREAD_PREFIX = "http-nio-"
# MyBatis 在 DEBUG 级别输出的语句开始标记，出现一次代表一次真实数据库往返。
SQL_MARKER = "==>  Preparing:"

CREDENTIAL_ENV = "BF_PERF_ADMIN_PASSWORD"


class MeasurementFailure(RuntimeError):
    """环境准备、请求执行或证据采集失败；不代表被测性能本身超预算。"""


def log(message: str) -> None:
    """输出可核对的进度，内容不含凭据、令牌或完整环境。"""

    print(f"[性能基线] {message}", flush=True)


@dataclass
class Response:
    """一次 HTTP 调用的状态、正文与端到端耗时。"""

    status: int
    body: bytes
    milliseconds: float


@dataclass
class SqlWindow:
    """一个场景内按迭代时间窗统计到的数据库语句执行情况。"""

    per_iteration: list[int] = field(default_factory=list)
    background: int = 0
    overlapping: bool = False
    total: int = 0

    def counts(self) -> dict[str, Any] | None:
        """返回每次迭代的语句数统计；没有请求线程语句时如实返回 None 而不是零值。

        Returns:
            含中位数、p95、最大值与后台语句数的统计；未采集到请求线程语句时为 None。
            请求互相重叠的场景只给总量与均值，不伪造成逐次分位数。
        """

        if self.overlapping:
            if not self.per_iteration:
                return None
            return {
                "sql_queries_median": None, "sql_queries_p95": None, "sql_queries_max": None,
                "sql_queries_total": float(self.total),
                "sql_queries_mean": float(self.total) / len(self.per_iteration),
                "background_sql_queries": self.background,
                "overlapping_requests": True,
            }
        if not self.per_iteration:
            return None if not self.background else {
                "sql_queries_median": None, "sql_queries_p95": None, "sql_queries_max": None,
                "background_sql_queries": self.background}
        return {
            "sql_queries_median": float(statistics.median(self.per_iteration)),
            "sql_queries_p95": float(_percentile(self.per_iteration, 95)),
            "sql_queries_max": float(max(self.per_iteration)),
            "sql_queries_total": float(sum(self.per_iteration)),
            "background_sql_queries": self.background,
        }


class Target:
    """持有目标地址与访问令牌的 HTTP 会话，按线程复用连接以贴近浏览器长连接行为。"""

    def __init__(self, base_url: str, timeout: float) -> None:
        """解析目标地址并准备连接池。

        Args:
            base_url: 形如 http://127.0.0.1:48090 的服务地址。
            timeout: 单次请求超时秒数。
        Raises:
            MeasurementFailure: 地址协议或主机不合法。
        """

        parts = urlsplit(base_url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise MeasurementFailure("目标地址必须是 http(s) 且包含主机")
        self.scheme = parts.scheme
        self.host = parts.hostname
        self.port = parts.port or (443 if parts.scheme == "https" else 80)
        self.timeout = timeout
        self.token = ""
        self._local = threading.local()

    def _connection(self) -> http.client.HTTPConnection:
        """返回当前线程的连接，失效时重建，不跨线程共享。"""

        connection = getattr(self._local, "connection", None)
        if connection is None:
            connection = http.client.HTTPConnection(self.host, self.port, timeout=self.timeout)
            self._local.connection = connection
        return connection

    def call(self, method: str, path: str, *, body: bytes | None = None,
             headers: dict[str, str] | None = None, authorized: bool = True) -> Response:
        """执行一次真实请求并校验业务结果。

        Args:
            method: HTTP 方法。
            path: 以 /admin-api 开头的完整路径。
            body: 请求体字节；None 表示无正文。
            headers: 附加请求头。
            authorized: 是否携带访问令牌。
        Returns:
            响应状态、正文与端到端毫秒。
        Raises:
            MeasurementFailure: 连接失败或响应不是合法 JSON。
        """

        request_headers = dict(headers or {})
        if authorized and self.token:
            request_headers[TOKEN_HEADER] = f"Bearer {self.token}"
        started = time.perf_counter()
        try:
            connection = self._connection()
            connection.request(method, path, body=body, headers=request_headers)
            response = connection.getresponse()
            payload = response.read()
        except (OSError, http.client.HTTPException):
            # 复用连接可能被服务端关闭，重连一次并重新计时，避免把握手故障算作延迟样本。
            self._local.connection = None
            started = time.perf_counter()
            try:
                connection = self._connection()
                connection.request(method, path, body=body, headers=request_headers)
                response = connection.getresponse()
                payload = response.read()
            except (OSError, http.client.HTTPException) as retry_error:
                raise MeasurementFailure(f"请求 {method} {path} 失败：{type(retry_error).__name__}") from retry_error
        elapsed = (time.perf_counter() - started) * 1000
        return Response(response.status, payload, elapsed)

    def json_call(self, method: str, path: str, payload: dict[str, Any] | None = None,
                  *, headers: dict[str, str] | None = None, authorized: bool = True) -> tuple[dict[str, Any], float]:
        """发送 JSON 请求并要求业务成功码，返回解析结果与毫秒耗时。

        Args:
            method: HTTP 方法。
            path: 请求路径。
            payload: 请求体对象；None 表示无正文。
            headers: 附加请求头。
            authorized: 是否携带访问令牌。
        Returns:
            业务数据对象与端到端毫秒。
        Raises:
            MeasurementFailure: 状态码非 2xx、正文不是 JSON 或业务码非 0。
        """

        body = None if payload is None else json.dumps(payload).encode("utf-8")
        merged = {"Content-Type": "application/json"}
        merged.update(headers or {})
        response = self.call(method, path, body=body, headers=merged, authorized=authorized)
        if not 200 <= response.status < 300:
            raise MeasurementFailure(f"{method} {path} 返回状态 {response.status}")
        try:
            document = json.loads(response.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise MeasurementFailure(f"{method} {path} 的响应不是 JSON") from error
        if document.get("code") != 0:
            raise MeasurementFailure(f"{method} {path} 业务码 {document.get('code')}：{document.get('msg')}")
        return document.get("data"), response.milliseconds


def login(target: Target, username: str, password: str) -> None:
    """执行一次超管平台登录，令牌写入会话供后续场景复用。

    Args:
        target: 目标会话。
        username: 管理员账号。
        password: 明文口令；仅在本进程内换算为登录协议要求的摘要。
    Raises:
        MeasurementFailure: 登录失败或响应缺少访问令牌。
    """

    # 前端在提交前对明文口令做小写 MD5，服务端按该协议比对，这里必须复现同一协议。
    digest = hashlib.md5(password.encode("utf-8")).hexdigest()
    data, _ = target.json_call(
        "POST", f"{ADMIN_PREFIX}/system/auth/super-admin-login",
        {"username": username, "password": digest}, authorized=False)
    token = (data or {}).get("accessToken")
    if not isinstance(token, str) or not token:
        raise MeasurementFailure("登录响应没有访问令牌")
    target.token = token


class SqlLogCollector:
    """增量读取应用日志，按时间窗口与线程归属统计 MyBatis 语句执行次数。"""

    LINE_PATTERN = re.compile(
        r"^(?P<stamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[(?P<thread>[^\]]+)\].*?"
        + re.escape(SQL_MARKER))

    def __init__(self, path: Path) -> None:
        """记录日志位置并定位到当前末尾，只统计本次运行新产生的行。

        Args:
            path: 应用日志文件；不存在时视为未提供查询数证据。
        Raises:
            MeasurementFailure: 路径存在但不是普通文件。
        """

        self.path = path
        self.offset = 0
        if path.exists():
            if not path.is_file():
                raise MeasurementFailure("应用日志路径不是普通文件")
            self.offset = path.stat().st_size
        self._events: list[tuple[float, str]] = []
        self._json_lines = 0
        self._plain_lines = 0

    def enabled(self) -> bool:
        """返回是否具备日志文件，不具备时调用方必须如实报告缺少查询数证据。"""

        return self.path.is_file()

    def formats(self) -> dict[str, int]:
        """返回本文件实际解析到的日志格式计数，供调用方核对解析是否真的命中。"""

        return {"json_lines": self._json_lines, "plain_lines": self._plain_lines}

    def _parse_line(self, line: str) -> tuple[float, str] | None:
        """解析一行日志的时间与线程；不是语句行时返回 None。

        local/dev 使用纯文本模板，prod 使用 JSON 模板，两种都要能解析，
        否则切换运行环境会让查询数证据静默变成零。

        Args:
            line: 单行日志文本。
        Returns:
            (epoch 秒, 线程名)；该行不是 MyBatis 语句行时为 None。
        """

        if line.startswith("{"):
            try:
                document = json.loads(line)
            except json.JSONDecodeError:
                return None
            message = document.get("message")
            stamp = document.get("timestamp")
            thread = document.get("thread")
            if not isinstance(message, str) or not message.startswith(SQL_MARKER):
                return None
            if not isinstance(stamp, str) or not isinstance(thread, str):
                return None
            try:
                # 必须用 datetime 解析以保留毫秒：time.strptime 返回 struct_time，
                # %f 会被丢弃，秒级精度不足以把语句归属到几十毫秒级的单次迭代。
                parsed = datetime.strptime(stamp[:23], "%Y-%m-%dT%H:%M:%S.%f").timestamp()
            except ValueError:
                return None
            self._json_lines += 1
            return parsed, thread
        match = self.LINE_PATTERN.match(line)
        if match is None:
            return None
        self._plain_lines += 1
        try:
            parsed = datetime.strptime(match.group("stamp"), "%Y-%m-%d %H:%M:%S.%f").timestamp()
        except ValueError:
            return None
        return parsed, match.group("thread")

    def _read_new_lines(self) -> list[str]:
        """从上次偏移继续读取完整行，不重复统计已消费内容。"""

        if not self.enabled():
            return []
        with self.path.open("r", encoding="utf-8", errors="replace") as stream:
            stream.seek(self.offset)
            data = stream.read()
            self.offset = stream.tell()
        if not data:
            return []
        lines = data.splitlines()
        if data.endswith("\n"):
            return lines
        # 末尾可能是不完整行，回退该行长度以便下次重新读取。
        self.offset -= len(lines[-1].encode("utf-8"))
        return lines[:-1]

    def drain(self) -> None:
        """把新产生的语句事件并入本次运行的窗口集合。"""

        for line in self._read_new_lines():
            event = self._parse_line(line)
            if event is not None:
                self._events.append(event)

    def drain_until_quiet(self, timeout: float) -> int:
        """反复读取直到连续两次没有新语句，等待异步文件 appender 落盘。

        Args:
            timeout: 最长等待秒数，超时后按已取得的事件继续判定并在报告中如实标注。
        Returns:
            本次等待新增的事件数量。
        """

        initial = len(self._events)
        deadline = time.monotonic() + timeout
        quiet = 0
        previous = initial
        while time.monotonic() < deadline and quiet < 2:
            self.drain()
            if len(self._events) == previous:
                quiet += 1
            else:
                quiet = 0
                previous = len(self._events)
            time.sleep(0.2)
        return len(self._events) - initial

    def attribute(self, entries: Sequence[tuple[str, Sequence[tuple[float, float]], bool]]
                  ) -> dict[str, SqlWindow]:
        """一次消费全部事件，按场景与迭代时间窗归属语句执行。

        必须在全部场景结束后统一归属：日志文件appender 是异步的，语句行可能在对应
        场景判定之后才落盘，逐场景即时归属会把迟到行错算到后续场景。

        Args:
            entries: 按执行顺序排列的 (场景名, 每次迭代时间窗, 请求是否互相重叠)。
        Returns:
            场景名到语句统计的映射；请求重叠的场景只保留总语句数。
        """

        remaining = list(self._events)
        results: dict[str, SqlWindow] = {}
        for name, windows, overlapping in entries:
            if overlapping and windows:
                merged = [(min(item[0] for item in windows), max(item[1] for item in windows))]
            else:
                merged = list(windows)
            window = SqlWindow(overlapping=overlapping)
            for started, finished in merged:
                inside = [item for item in remaining if started <= item[0] <= finished]
                remaining = [item for item in remaining if not started <= item[0] <= finished]
                request_thread = [item for item in inside if item[1].startswith(REQUEST_THREAD_PREFIX)]
                window.background += len(inside) - len(request_thread)
                window.total += len(request_thread)
                if not overlapping:
                    window.per_iteration.append(len(request_thread))
            if overlapping:
                window.per_iteration = [0] * max(1, len(windows))
            results[name] = window
        # 未被任何窗口覆盖的后台语句只报告总数，避免把它当成请求成本。
        results["__unattributed__"] = SqlWindow(background=sum(
            1 for item in remaining if not item[1].startswith(REQUEST_THREAD_PREFIX)))
        return results


class ResourceSampler:
    """采样被测进程的驻留内存、线程数与文件描述符，观察资源是否随迭代增长。"""

    def __init__(self, pid: int, interval: float = 0.05) -> None:
        """记录目标进程并准备采样线程。

        Args:
            pid: 被测 JVM 的进程号。
            interval: 采样间隔秒数。
        """

        self.pid = pid
        self.interval = interval
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.peak_rss_kb = 0
        self._first: dict[str, float] | None = None

    def snapshot(self) -> dict[str, float]:
        """读取当前进程的 RSS、线程数与文件描述符数量，供场景边界对照。

        Returns:
            可用的指标子集；进程已退出时返回空映射而不是伪造零值。
        """

        return self._snapshot()

    def _snapshot(self) -> dict[str, float]:
        """读取当前进程的 RSS、线程数与文件描述符数量。"""

        try:
            status = Path(f"/proc/{self.pid}/status").read_text(encoding="utf-8")
        except OSError:
            return {}
        values: dict[str, float] = {}
        for line in status.splitlines():
            if line.startswith("VmRSS:"):
                values["rss_kb"] = float(line.split()[1])
            elif line.startswith("Threads:"):
                values["threads"] = float(line.split()[1])
        try:
            values["fds"] = float(len(list(Path(f"/proc/{self.pid}/fd").iterdir())))
        except OSError:
            pass
        return values

    def _loop(self) -> None:
        """按间隔持续采样，记录峰值驻留内存。"""

        while not self._stop.is_set():
            snapshot = self._snapshot()
            self.peak_rss_kb = max(self.peak_rss_kb, int(snapshot.get("rss_kb", 0)))
            self._stop.wait(self.interval)

    def start(self) -> None:
        """开始后台采样。"""

        self._first = self._snapshot()
        self._thread = threading.Thread(target=self._loop, name="perf-resource", daemon=True)
        self._thread.start()

    def stop(self) -> dict[str, Any]:
        """停止采样并返回前后快照与峰值。"""

        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        last = self._snapshot()
        return {"before": self._first or {}, "after": last, "peak_rss_kb": self.peak_rss_kb}


def run_scenario(target: Target, name: str, iteration: Callable[[Target], None],
                 samples: int, warmup: int) -> tuple[dict[str, Any], list[tuple[float, float]]]:
    """按预热加采样执行一个场景，返回原始样本、统计量与查询数证据。

    Args:
        target: 目标会话。
        name: 场景名，必须与预算文件中的键一致。
        iteration: 一次用户动作；内部完成该动作的全部请求。
        samples: 计入统计的有效样本数。
        warmup: 统计前丢弃的预热次数，用于排除首次连接与缓存冷态。
    Returns:
        (含 samples_ms 与统计量的场景结果, 每次迭代的 (起始, 结束) epoch 秒)。
    Raises:
        MeasurementFailure: 预热或采样期间出现请求失败。
    """

    for _ in range(warmup):
        iteration(target)
    raw: list[float] = []
    windows: list[tuple[float, float]] = []
    errors = 0
    for _ in range(samples):
        before = time.time()
        try:
            iteration(target)
        except MeasurementFailure:
            errors += 1
            raise
        after = time.time()
        windows.append((before, after))
        raw.append(max(0.0, (after - before) * 1000))
    result: dict[str, Any] = {
        "samples_ms": [round(value, 3) for value in raw],
        "errors": errors,
    }
    if raw:
        result.update({
            "p50_ms": round(_percentile(raw, 50), 3),
            "p95_ms": round(_percentile(raw, 95), 3),
            "p99_ms": round(_percentile(raw, 99), 3),
            "max_ms": round(max(raw), 3),
            "min_ms": round(min(raw), 3),
            "median_ms": round(statistics.median(raw), 3),
        })
    return result, windows


def _percentile(values: Sequence[float], percent: float) -> float:
    """使用线性插值计算分位数，与预算核对模块保持同一口径。"""

    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    position = (len(ordered) - 1) * percent / 100
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return float(ordered[lower]) * (1 - weight) + float(ordered[upper]) * weight


def concurrent_run(target: Target, iteration: Callable[[Target], None],
                   workers: int, per_worker: int) -> list[float]:
    """以固定并发度执行同一动作，返回所有成功迭代的端到端耗时。

    Args:
        target: 目标会话。
        iteration: 一次用户动作。
        workers: 并发线程数。
        per_worker: 每个线程的迭代次数。
    Returns:
        全部成功样本的毫秒耗时，按完成顺序排列。
    Raises:
        MeasurementFailure: 任一并发请求失败。
    """

    results: list[float] = []
    lock = threading.Lock()
    failures: list[BaseException] = []

    def worker() -> None:
        """在线程内串行执行分配到的迭代并记录耗时。"""

        local: list[float] = []
        for _ in range(per_worker):
            started = time.time()
            try:
                iteration(target)
            except BaseException as error:  # noqa: BLE001 - 汇总后统一抛出，避免线程静默失败
                with lock:
                    failures.append(error)
                return
            local.append((time.time() - started) * 1000)
        with lock:
            results.extend(local)

    threads = [threading.Thread(target=worker, name=f"perf-conc-{index}") for index in range(workers)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    if failures:
        raise MeasurementFailure(f"并发场景出现 {len(failures)} 次失败") from failures[0]
    return results


def warmup_pass(target: Target, catalog: Sequence[tuple[str, str, Callable[[Target], None]]],
                samples: int, warmup: int) -> None:
    """执行一整轮不计入报告的预热，使后续测量在稳定 JIT 状态下进行。

    Args:
        target: 目标会话。
        catalog: 本次要测量的场景清单，与正式测量保持一致。
        samples: 每个场景的正式样本数。
        warmup: 每个场景的正式预热次数。
    """

    for _, _, iteration in catalog:
        for _ in range(max(0, warmup) + samples):
            iteration(target)


def _multipart(field: str, filename: str, content_type: str, payload: bytes,
               extra: dict[str, str] | None = None) -> tuple[bytes, str]:
    """构造服务端上传所需的多部分正文，避免依赖第三方 HTTP 客户端。

    Args:
        field: 文件字段名。
        filename: 原始文件名。
        content_type: 文件内容类型。
        payload: 文件字节内容。
        extra: 额外的普通表单字段。
    Returns:
        正文与 Content-Type 头值。
    """

    boundary = "----w7perf" + hashlib.sha256(os.urandom(16)).hexdigest()[:24]
    chunks: list[bytes] = []
    for name, value in (extra or {}).items():
        chunks.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode("utf-8"))
    chunks.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{filename}\"\r\n"
        f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"))
    chunks.append(payload)
    chunks.append(f"\r\n--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def _upload(target: Target, size_bytes: int) -> None:
    """上传固定大小的合成文件，走真实服务端上传链路。

    Args:
        target: 目标会话。
        size_bytes: 合成内容字节数，内容为固定常量，不含任何真实材料。
    Raises:
        MeasurementFailure: 上传未返回成功。
    """

    # 固定常量内容，便于复现字节数维度；不使用任何真实文件或私有材料。
    payload = (b"basic-framework-perf-probe\n" * (size_bytes // 28 + 1))[:size_bytes]
    body, content_type = _multipart("file", "perf-probe.bin", "application/octet-stream", payload)
    target.call("POST", f"{ADMIN_PREFIX}/infra/file/upload", body=body,
                headers={"Content-Type": content_type, "Content-Length": str(len(body))})


class Scenarios:
    """按名称构造一次用户动作，所有动作只使用真实 HTTP 入口。"""

    def __init__(self, username: str, password: str) -> None:
        """保存登录凭据与自增序号，序号用于生成不重复的业务编码。

        Args:
            username: 管理员账号。
            password: 明文口令，只在登录时换算摘要。
        """

        self.username = username
        self.password = password
        self.counter = 0
        # 用户名与字典编码是软删除后仍被唯一约束占用的业务键，本次运行必须使用独立前缀，
        # 否则同一目标上的第二次测量会因“数据已存在”失败，而不是被测性能问题。
        self.run_tag = secrets.token_hex(3)
        self._lock = threading.Lock()

    def _next(self) -> int:
        """返回本次运行内单调递增的序号，避免并发创建同名对象。"""

        with self._lock:
            self.counter += 1
            return self.counter

    def auth_login(self, target: Target) -> None:
        """完成一次账号密码登录，包含令牌签发与登录日志写入。"""

        login(target, self.username, self.password)

    def permission_info(self, target: Target) -> None:
        """读取当前用户的角色与可用菜单，对应登录后的权限加载动作。"""

        target.json_call("GET", f"{ADMIN_PREFIX}/system/auth/get-permission-info")

    @staticmethod
    def user_page_shallow(target: Target) -> None:
        """读取第一页用户列表，覆盖典型管理后台首屏查询。"""

        target.json_call("GET", f"{ADMIN_PREFIX}/system/user/page?{urlencode({'pageNo': 1, 'pageSize': 10})}")

    @staticmethod
    def user_page_deep(target: Target) -> None:
        """读取第 500 页用户列表，用偏移量维度暴露深分页成本。"""

        target.json_call("GET", f"{ADMIN_PREFIX}/system/user/page?{urlencode({'pageNo': 500, 'pageSize': 10})}")

    @staticmethod
    def dict_type_page(target: Target) -> None:
        """读取第一页字典类型，覆盖配置类分页查询。"""

        target.json_call("GET", f"{ADMIN_PREFIX}/system/dict-type/page?{urlencode({'pageNo': 1, 'pageSize': 10})}")

    def dict_type_crud(self, target: Target) -> None:
        """完成一次字典类型新增、修改、读取与删除，覆盖完整写链路。"""

        index = self._next()
        code = f"w7_perf_{self.run_tag}_{index:08d}"
        data, _ = target.json_call("POST", f"{ADMIN_PREFIX}/system/dict-type/create",
                                   {"name": "性能探针", "type": code, "status": 0, "remark": "perf"})
        identity = int(data)
        target.json_call("PUT", f"{ADMIN_PREFIX}/system/dict-type/update",
                         {"id": identity, "name": "性能探针改", "type": code, "status": 0})
        target.json_call("GET", f"{ADMIN_PREFIX}/system/dict-type/get?{urlencode({'id': identity})}")
        target.json_call("DELETE", f"{ADMIN_PREFIX}/system/dict-type/delete?{urlencode({'id': identity})}")

    def user_crud(self, target: Target) -> None:
        """完成一次业务用户新增、读取与删除，覆盖用户写链路与关联清理。"""

        index = self._next()
        username = f"w7probe{self.run_tag}{index:08d}"
        data, _ = target.json_call("POST", f"{ADMIN_PREFIX}/system/user/create", {
            "username": username,
            "nickname": "性能探针",
            "password": hashlib.md5(username.encode("utf-8")).hexdigest(),
            "status": 0,
            "remark": "perf",
        })
        identity = int(data)
        target.json_call("GET", f"{ADMIN_PREFIX}/system/user/get?{urlencode({'id': identity})}")
        target.json_call("DELETE", f"{ADMIN_PREFIX}/system/user/delete?{urlencode({'id': identity})}")

    def file_upload_small(self, target: Target) -> None:
        """上传 64 KiB 文件，对应常见表单附件体量。"""

        _upload(target, 64 * 1024)

    def file_upload_large(self, target: Target) -> None:
        """上传 1 MiB 文件，用字节数维度观察上传成本变化。"""

        _upload(target, 1024 * 1024)


def build_report(arguments: argparse.Namespace, target: Target) -> dict[str, Any]:
    """按固定顺序测量全部场景并组装报告，任一场景失败都会终止而不是跳过。

    Args:
        arguments: 已解析的命令行参数。
        target: 已完成登录的目标会话。
    Returns:
        perf-report/v1 报告对象。
    Raises:
        MeasurementFailure: 环境、请求或证据采集失败。
    """

    scenarios = Scenarios(arguments.username, arguments.password)
    catalog: list[tuple[str, str, Callable[[Target], None]]] = [
        ("auth-login", "账号密码登录：POST /system/auth/super-admin-login", scenarios.auth_login),
        ("permission-info", "权限加载：GET /system/auth/get-permission-info", scenarios.permission_info),
        ("user-page-shallow", "用户分页首屏：GET /system/user/page pageNo=1", scenarios.user_page_shallow),
        ("user-page-deep", "用户分页深页：GET /system/user/page pageNo=500", scenarios.user_page_deep),
        ("dict-type-page", "字典类型分页：GET /system/dict-type/page pageNo=1", scenarios.dict_type_page),
        ("dict-type-crud", "字典类型 CRUD：create+update+get+delete", scenarios.dict_type_crud),
        ("user-crud", "业务用户 CRUD：create+get+delete", scenarios.user_crud),
        ("file-upload-64k", "文件上传：POST /infra/file/upload 64 KiB", scenarios.file_upload_small),
        ("file-upload-1m", "文件上传：POST /infra/file/upload 1 MiB", scenarios.file_upload_large),
    ]
    if arguments.scenarios:
        wanted = set(arguments.scenarios)
        catalog = [item for item in catalog if item[0] in wanted]
        missing = wanted - {item[0] for item in catalog}
        if missing:
            raise MeasurementFailure(f"未知场景：{sorted(missing)}")

    collector: SqlLogCollector | None = None
    if arguments.app_log:
        collector = SqlLogCollector(Path(arguments.app_log))
        if not collector.enabled():
            log(f"应用日志 {arguments.app_log} 不存在，本次不报告数据库查询数")
            collector = None

    sampler: ResourceSampler | None = None
    if arguments.app_pid:
        sampler = ResourceSampler(arguments.app_pid)
        sampler.start()

    for pass_index in range(max(0, arguments.warmup_passes)):
        log(f"预热轮 {pass_index + 1}/{arguments.warmup_passes}：结果丢弃，只用于消除冷 JIT 成本")
        warmup_pass(target, catalog, arguments.samples, arguments.warmup)

    results: dict[str, Any] = {}
    # 语句归属在全部场景结束后统一进行，避免异步日志落盘迟于场景判定导致归因错位。
    windows_by_scenario: list[tuple[str, list[tuple[float, float]], bool]] = []
    for name, description, iteration in catalog:
        log(f"测量 {name}：{arguments.samples} 次（预热 {arguments.warmup} 次）")
        boundary_before = sampler.snapshot() if sampler is not None else None
        outcome, scenario_windows = run_scenario(target, name, iteration,
                                                 arguments.samples, arguments.warmup)
        windows_by_scenario.append((name, scenario_windows, False))
        outcome["description"] = description
        if boundary_before is not None and sampler is not None:
            # 场景边界快照用于观察资源是否随迭代增长并在结束后回落，峰值单独记录。
            outcome["resources"] = {"before": boundary_before, "after": sampler.snapshot(),
                                    "peak_rss_kb": sampler.peak_rss_kb}
        results[name] = outcome

    if arguments.concurrency > 1:
        name = f"user-page-shallow-concurrent-{arguments.concurrency}"
        log(f"测量 {name}：{arguments.concurrency} 并发 × {arguments.concurrency_samples} 次")
        started = time.time()
        samples = concurrent_run(target, scenarios.user_page_shallow,
                                 arguments.concurrency, arguments.concurrency_samples)
        finished = time.time()
        boundary_before = sampler.snapshot() if sampler is not None else None
        outcome = {"samples_ms": [round(value, 3) for value in samples], "errors": 0,
                   "description": f"用户分页并发：{arguments.concurrency} 并发线程同时读取首屏",
                   "p50_ms": round(_percentile(samples, 50), 3),
                   "p95_ms": round(_percentile(samples, 95), 3),
                   "p99_ms": round(_percentile(samples, 99), 3),
                   "max_ms": round(max(samples), 3),
                   "min_ms": round(min(samples), 3),
                   "median_ms": round(statistics.median(samples), 3),
                   "concurrency": arguments.concurrency,
                   # 并发场景的分位数对排队与调度敏感，吞吐是更稳定的判据，两者都保留。
                   "throughput_per_second": round(len(samples) / max(1e-6, finished - started), 2),
                   "wall_seconds": round(finished - started, 3)}
        # 并发请求互相重叠，单条语句无法归属到某一次迭代，只登记窗口不登记逐次样本。
        windows_by_scenario.append((name, [(started, finished)], True))
        if boundary_before is not None and sampler is not None:
            outcome["resources"] = {"before": boundary_before, "after": sampler.snapshot(),
                                    "peak_rss_kb": sampler.peak_rss_kb}
        results[name] = outcome

    if collector is not None:
        collector.drain_until_quiet(arguments.settle)
        attributed = collector.attribute(windows_by_scenario)
        for name, window in attributed.items():
            if name == "__unattributed__":
                continue
            counts = window.counts()
            if counts is not None:
                results[name]["sql"] = counts

    resources = sampler.stop() if sampler is not None else None
    report: dict[str, Any] = {
        "schema": REPORT_SCHEMA,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "target": {"base_url": arguments.base_url, "server_port": target.port},
        "build": {
            "jar_sha256": arguments.jar_sha256,
            "jar_bytes": arguments.jar_bytes,
            "app_version": arguments.app_version,
            # 构件字节摘要只作为「这次跑的是哪个 JAR」的观测值，不作为判定依据；预算按
            # 下面两项可复现的源码身份绑定被测版本。
            "binding_method": arguments.binding_method,
            "source_scope": arguments.source_scope,
            "git_revision": arguments.git_revision,
            "source_sha256": arguments.source_sha256,
            "source_files": arguments.source_files,
            "source_worktree": arguments.source_worktree,
        },
        "workload": {"id": arguments.workload,
                     "samples_per_scenario": arguments.samples,
                     "warmup_per_scenario": arguments.warmup,
                     "sql_counter": "app-log-mapper-statements" if collector is not None else None,
                     "sql_log_parse": collector.formats() if collector is not None else None},
        # 顶层并发度描述基础负载：除显式并发场景外全部迭代串行执行。
        # 并发场景自身的并发度记录在对应场景条目里，不能与基础负载混为一个字段。
        "concurrency": 1,
        "environment": {
            "profile": arguments.profile,
            "host": os.uname().nodename,
            "platform": f"{os.uname().sysname} {os.uname().machine}",
            "cpu_count": os.cpu_count(),
        },
        "scenarios": results,
    }
    if resources is not None:
        report["resources"] = resources
    return report


def _positive(value: str) -> int:
    """解析正整数参数并在越界时拒绝。"""

    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("必须是正整数")
    return number


def sha256_of(path: Path) -> tuple[str, int]:
    """计算构件摘要与字节数，用于把结果绑定到实际构建版本。

    Args:
        path: 待摘要的构件文件。
    Returns:
        十六进制摘要与字节数。
    Raises:
        MeasurementFailure: 文件不存在。
    """

    if not path.is_file():
        raise MeasurementFailure(f"构件不存在：{path}")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest(), path.stat().st_size


def resolve_source_identity(root: Path, revision: str) -> dict[str, Any]:
    """计算本次报告使用的源码身份；算不出来就让测量失败而不是产出没有绑定的读数。

    修订可以由调用方显式给出（CI 从 checkout 取 `git rev-parse HEAD` 传入），但源码内容
    摘要必须现场计算：它才覆盖未提交改动，也才在不同机器上可复现。

    Args:
        root: 仓库根目录。
        revision: 调用方声明的提交标识；为空时现场读取 HEAD。
    Returns:
        含方法、范围、修订、摘要、文件数与工作区状态的记录。
    Raises:
        MeasurementFailure: Git 检出不可用或源码范围缺失。
    """

    try:
        document = source_identity.identity(root)
    except source_identity.IdentityFailure as error:
        raise MeasurementFailure(f"源码身份无法计算：{error}") from error
    if revision:
        document["git_revision"] = revision
    return document


def warn_if_artifact_predates_source(jar: Path | None, root: Path) -> None:
    """被测 JAR 早于源码最新修改时间时给出提示；该提示不改写结论，只避免误读绑定。

    构件是否真的由这份源码构建无法从字节反推，这里只把「时间上对不上」这一事实说出来，
    真正的处置（重新 `--build` 或换构件）由操作者与编排流程决定。

    Args:
        jar: 被测后端 JAR；为空表示本次没有登记构件。
        root: 仓库根目录。
    """

    if jar is None:
        return
    try:
        if jar.stat().st_mtime < source_identity.newest_source_mtime(root):
            log(f"提示：被测 JAR {jar.name} 的修改时间早于源码范围内最新的修改时间，"
                "报告登记的源码身份可能与该 JAR 不对应；请用同一份源码重新打包")
    except (OSError, source_identity.IdentityFailure) as error:
        log(f"提示：无法比较被测构件与源码的时间先后（{error}）；不影响本次测量")


def main(argv: Sequence[str] | None = None) -> int:
    """执行测量并写出报告；退出 0 表示测量完成，2 表示环境或证据准备失败。

    Args:
        argv: 命令行参数；省略时读取真实进程参数。
    Returns:
        0 表示报告已生成；2 表示缺少凭据、目标不可达、源码身份不可得或任一场景失败。
    """

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:48090")
    parser.add_argument("--username", required=True)
    parser.add_argument("--out", required=True, help="报告输出路径")
    parser.add_argument("--jar", help="被测后端 JAR，用于记录构件摘要")
    parser.add_argument("--app-log", help="应用日志路径，用于统计数据库语句执行次数")
    parser.add_argument("--app-pid", type=_positive, help="被测 JVM 进程号，用于采集资源")
    parser.add_argument("--samples", type=_positive, default=120)
    parser.add_argument("--warmup", type=int, default=10)
    # 首次完整遍历在冷 JIT 下明显偏慢，必须整轮丢弃后再测量，否则报告会把编译成本算作业务延迟。
    parser.add_argument("--warmup-passes", type=int, default=1,
                        help="测量前完整丢弃的整轮遍历次数，用于排除冷 JIT")
    parser.add_argument("--settle", type=float, default=1.5, help="等待异步日志落盘的秒数")
    parser.add_argument("--concurrency", type=_positive, default=8)
    parser.add_argument("--concurrency-samples", type=_positive, default=40)
    parser.add_argument("--workload", default="w7-baseline-v1")
    parser.add_argument("--profile", default="prod")
    parser.add_argument("--app-version", default="")
    parser.add_argument("--git-revision", default="",
                        help="被测提交标识；为空时按 --source-root 现场读取 HEAD")
    parser.add_argument("--source-root", default=str(REPOSITORY_ROOT),
                        help="计算源码内容摘要的仓库根目录")
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--scenarios", nargs="*", help="只测量指定场景名，便于定位单项")
    arguments = parser.parse_args(argv)

    password = os.environ.get(CREDENTIAL_ENV, "")
    if not password:
        print(f"缺少凭据：请通过环境变量 {CREDENTIAL_ENV} 注入管理员口令", file=sys.stderr)
        return 2
    arguments.password = password

    source_root = Path(arguments.source_root).resolve()
    try:
        identity = resolve_source_identity(source_root, arguments.git_revision)
    except MeasurementFailure as error:
        print(str(error), file=sys.stderr)
        return 2
    arguments.binding_method = identity["method"]
    arguments.source_scope = identity["scope"]
    arguments.git_revision = identity["git_revision"]
    arguments.source_sha256 = identity["source_sha256"]
    arguments.source_files = identity["source_files"]
    arguments.source_worktree = identity["source_worktree"]
    log(f"源码身份：修订 {arguments.git_revision}、工作区 {arguments.source_worktree}、"
        f"摘要 {arguments.source_sha256}")

    jar_path = Path(arguments.jar) if arguments.jar else None
    jar_sha256, jar_bytes = ("", 0)
    if jar_path is not None:
        try:
            jar_sha256, jar_bytes = sha256_of(jar_path)
        except MeasurementFailure as error:
            print(str(error), file=sys.stderr)
            return 2
    arguments.jar_sha256 = jar_sha256
    arguments.jar_bytes = jar_bytes
    warn_if_artifact_predates_source(jar_path, source_root)

    target = Target(arguments.base_url, arguments.timeout)
    try:
        login(target, arguments.username, password)
        report = build_report(arguments, target)
    except MeasurementFailure as error:
        print(f"性能测量无法完成：{error}", file=sys.stderr)
        return 2
    out = Path(arguments.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log(f"报告已写入 {out}，共 {len(report['scenarios'])} 个场景")
    return 0


if __name__ == "__main__":
    sys.exit(main())
