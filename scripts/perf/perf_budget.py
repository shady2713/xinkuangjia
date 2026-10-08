"""核对性能测量报告是否满足受控预算，并对超预算、未测量和证据不可比分别判定失败。

本模块只消费“实际运行产生的测量报告”和“受版本控制的预算文件”，自身不发请求、
不读环境变量、不联网，因此同一对输入必然得到同一结论。门禁入口与负对照都复用它，
避免判定逻辑与实际执行分叉。

报告结构（perf-report/v1）中的 samples_ms 必须保留全部原始样本，判定只用报告内的
统计量，但保留原始样本使判定可被复核。

预算文件结构（perf-budget/v2）同时表达三类依据：

* 绝对预算：响应分位数与单次请求数据库查询数的上限。
* 回归预算：相对同一负载参考基线的允许增量比例，避免只回答“比上次快”。
* 构件绑定：`applies_to.build` 声明本次校准对应的源码身份，被测报告必须给出同一身份。

构件绑定为什么是 Git 修订加源码内容摘要、而不是构件字节摘要：Maven 重建出来的 JAR
不可复现，同一提交在不同机器或不同时刻重建即得到不同 SHA-256，用它绑定会让
`build-mismatch` 在任何一次干净检出的 CI 上必现（同一提交实测 `c0a94da8…` 与
`71371e1b…`）。`perf-budget/v1` 以 `jar_sha256` 绑定的方式因此退役：绑定方式换了不等于
问题消失，本模块对该字段给出配置错误（退出码 2），并在预算未绑定可复现源码身份时同样
拒绝判定，绝不退化为“不再核对构件”。

@author 李杰
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

if __package__ in (None, ""):  # 直接以脚本路径运行时补上仓库根，便于复用同包绑定常量。
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.perf import source_identity  # noqa: E402

REPORT_SCHEMA = "perf-report/v1"
BUDGET_SCHEMA = "perf-budget/v2"
CHECK_NAME = "性能预算"

# 上一版结构以构件字节摘要绑定被测版本；该依据不可复现，已退役。仍然按 v1 提交的预算
# 文件必须被明确拒绝并给出迁移指引，不能被当成“没有绑定要求”而静默放行。
RETIRED_BUDGET_SCHEMA = "perf-budget/v1"
RETIRED_BINDING_FIELD = "jar_sha256"
RETIRED_BUDGET_REASON = (
    "以构件字节摘要绑定被测版本的方式已退役：Maven 重建的 JAR 摘要不可复现，"
    "同一提交在不同环境重建即不同（例如同一提交实测 c0a94da8… 与 71371e1b…），"
    f"用它绑定会让 build-mismatch 在任何一次干净检出的 CI 上必现。请迁移到 {BUDGET_SCHEMA}，"
    f"在 applies_to.build 声明 binding_method={source_identity.METHOD}、source_scope="
    f"{source_identity.SCOPE} 与 git_revision、source_sha256，并在目标环境重新校准。"
)

# 构件绑定的可比字段：方法与范围决定两次测量是否同一口径，提交与内容摘要决定测的是不是
# 被校准的那份代码。四项都只由 `source_identity` 定义，不在本模块另写一份字面量。
BINDING_METHOD = source_identity.METHOD
BINDING_SCOPE = source_identity.SCOPE
BINDING_FIELDS = {"git_revision": 40, "source_sha256": 64}

# 判定使用的分位数与对应预算字段。p99 与 p95 分别核对，任一超限即失败。
PERCENTILES = ((50, "p50_ms"), (95, "p95_ms"), (99, "p99_ms"))
SQL_BUDGET_FIELDS = ("sql_queries_median", "sql_queries_p95")


@dataclass(frozen=True)
class Finding:
    """单条预算判定结果；kind 区分证据缺口与真实超预算。"""

    kind: str
    scenario: str
    metric: str
    observed: float | None
    allowed: float | None
    message: str


def _ratio(observed: float, allowed: float) -> float:
    """返回观测值与允许值的比值，供报告直接显示超出倍数。"""

    return observed / allowed if allowed else float("inf")


def percentile(values: Sequence[float], percent: float) -> float:
    """用线性插值计算分位数，保证同一份原始样本在任何机器上得到相同结果。

    Args:
        values: 已完成排序或未排序的原始样本，单位与调用方约定一致。
        percent: 0 到 100 的分位点。
    Returns:
        对应分位数的插值结果。
    Raises:
        ValueError: 样本为空或分位点越界。
    """

    if not values:
        raise ValueError("分位数计算需要至少一个样本")
    if not 0 <= percent <= 100:
        raise ValueError("分位点必须位于 0 到 100 之间")
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    position = (len(ordered) - 1) * percent / 100
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return float(ordered[lower]) * (1 - weight) + float(ordered[upper]) * weight


def summarize(samples_ms: Sequence[float]) -> dict[str, float]:
    """由原始样本生成判定所需的统计量，避免调用方各自计算导致口径漂移。

    Args:
        samples_ms: 单次请求的端到端毫秒样本。
    Returns:
        中位数、p95、p99、最大值与样本量。
    Raises:
        ValueError: 样本为空。
    """

    if not samples_ms:
        raise ValueError("汇总需要至少一个样本")
    return {
        "samples": len(samples_ms),
        "median_ms": statistics.median(samples_ms),
        "p50_ms": percentile(samples_ms, 50),
        "p95_ms": percentile(samples_ms, 95),
        "p99_ms": percentile(samples_ms, 99),
        "max_ms": max(samples_ms),
        "min_ms": min(samples_ms),
    }


def load_document(path: Path, expected_schema: str,
                  retired: Mapping[str, str] | None = None) -> dict[str, Any]:
    """读取并校验结构版本，缺失、非 JSON 或结构不符都作为配置错误拒绝。

    Args:
        path: 报告或预算文件位置。
        expected_schema: 期望的顶层 schema 标识。
        retired: 已退役结构版本到退役原因的映射；命中时给出可执行的迁移说明而不是
            只说「版本不对」，让操作者能直接知道旧依据为什么不可用。
    Returns:
        解析后的顶层对象。
    Raises:
        ValueError: 文件不可读、不是 JSON 对象或 schema 不匹配。
    """

    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise ValueError(f"无法读取 {path}：{error.strerror or error}") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"{path} 不是合法 JSON：{error}") from error
    if not isinstance(document, dict):
        raise ValueError(f"{path} 的顶层必须是 JSON 对象")
    declared = document.get("schema")
    if declared != expected_schema:
        reason = (retired or {}).get(str(declared))
        if reason:
            raise ValueError(f"{path} 仍是 {declared}：{reason}")
        raise ValueError(f"{path} 的 schema 必须是 {expected_schema}")
    return document


def _hex_text(value: object, length: int) -> str | None:
    """校验十六进制定长文本；不是定长文本时返回 ``None``，布尔等类型自然被排除。"""

    if not isinstance(value, str) or len(value) != length:
        return None
    if any(character not in "0123456789abcdef" for character in value):
        return None
    return value


def binding_expectation(budget: Mapping[str, Any]) -> dict[str, str]:
    """取出预算声明的构件绑定；声明本身不可用时按配置错误拒绝而不是默认放行。

    预算必须声明受支持的绑定方法、范围与两项可复现身份。缺任何一项都意味着「这份预算
    无法证明读数来自被校准的那份代码」，此时若放行等于把绑定判定整体关掉，因此这里一律
    抛配置错误，由入口转成退出码 2。

    Args:
        budget: 已解析的 perf-budget/v2 对象。
    Returns:
        绑定方法、范围与两项身份字段。
    Raises:
        ValueError: 仍按退役的构件字节摘要绑定、方法或范围不支持、或缺少/填错身份字段。
    """

    applies = budget.get("applies_to") or {}
    build = applies.get("build")
    if not isinstance(build, dict):
        raise ValueError("预算文件必须在 applies_to.build 中声明构件绑定")
    if RETIRED_BINDING_FIELD in build:
        raise ValueError(
            f"预算文件仍以 {RETIRED_BINDING_FIELD} 绑定被测版本：{RETIRED_BUDGET_REASON}"
        )
    state = build.get("binding_state")
    method = build.get("binding_method")
    if method != BINDING_METHOD:
        raise ValueError(
            f"预算文件的 binding_method 必须声明为 {BINDING_METHOD}"
            f"（当前 {method!r}，binding_state={state!r}）"
        )
    scope = build.get("source_scope")
    if scope != BINDING_SCOPE:
        raise ValueError(
            f"预算文件的 source_scope 必须声明为 {BINDING_SCOPE}"
            f"（当前 {scope!r}，binding_state={state!r}）"
        )
    expected = {"binding_method": str(method), "source_scope": str(scope)}
    for field, length in BINDING_FIELDS.items():
        value = _hex_text(build.get(field), length)
        if value is None:
            raise ValueError(
                f"预算文件的构件绑定缺少可用的 {field}（binding_state={state!r}）："
                f"必须回填 {length} 位小写十六进制；绑定未回填前本预算不能作为判定依据，"
                "需要在目标环境重新校准"
            )
        expected[field] = value
    return expected


def binding_findings(report: Mapping[str, Any], expected: Mapping[str, str]) -> list[Finding]:
    """核对实测报告是否就是预算所绑定的那份代码，并区分「不符」与「根本没给证据」。

    两类问题的处置不同，因此分成两种 kind：口径不同或身份不符判 ``build-mismatch`` /
    ``build-binding-mismatch``（测的不是被校准的那份代码，数字不可用于判定）；报告完全
    没有给出绑定证据判 ``build-binding-missing``（证据缺口，同样不能算通过）。两者都让
    判定失败，绝不因为换了绑定方式就消失。

    Args:
        report: 已解析的 perf-report/v1 对象。
        expected: 预算声明的绑定。
    Returns:
        绑定不一致或绑定证据缺失的问题；空列表表示实测报告与被校准代码同源。
    """

    build = report.get("build")
    build = build if isinstance(build, dict) else {}
    findings: list[Finding] = []
    for field in ("binding_method", "source_scope"):
        observed = build.get(field)
        if observed != expected[field]:
            findings.append(Finding(
                "build-binding-mismatch", "*", field, None, None,
                f"报告 {field}={observed!r} 与预算声明的 {expected[field]!r} 不一致，"
                "两次测量的绑定口径不可比",
            ))
    for field in BINDING_FIELDS:
        observed = build.get(field)
        if not isinstance(observed, str) or not observed:
            findings.append(Finding(
                "build-binding-missing", "*", field, None, None,
                f"报告没有给出 {field}，无法证明读数来自预算所绑定的源码",
            ))
        elif observed != expected[field]:
            findings.append(Finding(
                "build-mismatch", "*", field, None, None,
                f"报告 {field}={observed} 与预算声明的 {expected[field]} 不一致，"
                "测的不是被校准的那份代码",
            ))
    return findings


def binding_summary(report: Mapping[str, Any], budget: Mapping[str, Any],
                    findings: Sequence[Finding]) -> dict[str, Any]:
    """汇总判定实际使用的绑定，供日志、制品与发布证据核对。

    Args:
        report: 已解析的 perf-report/v1 对象。
        budget: 已解析的 perf-budget/v2 对象。
        findings: 本次判定产生的问题；用于给出绑定是否成立的结论。
    Returns:
        含方法、范围、预算声明值、实测值与是否一致的记录。
    """

    declared_build = (budget.get("applies_to") or {}).get("build")
    declared_build = declared_build if isinstance(declared_build, dict) else {}
    build = report.get("build")
    build = build if isinstance(build, dict) else {}
    observed = {field: build.get(field) for field in ("binding_method", "source_scope",
                                                      *BINDING_FIELDS)}
    matched = not any(item.kind.startswith("build-") for item in findings)
    return {
        "method": BINDING_METHOD,
        "scope": BINDING_SCOPE,
        "declared": {field: declared_build.get(field) for field in ("binding_method",
                                                                     "source_scope",
                                                                     *BINDING_FIELDS)},
        "observed": observed,
        "matched": matched,
    }


def _scenario_samples(scenario: Mapping[str, Any]) -> list[float]:
    """取出场景原始样本并拒绝非数值，避免字符串样本被静默丢弃。"""

    raw = scenario.get("samples_ms")
    if not isinstance(raw, list):
        raise ValueError("场景缺少 samples_ms 原始样本列表")
    samples: list[float] = []
    for item in raw:
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            raise ValueError("samples_ms 只允许数值样本")
        samples.append(float(item))
    return samples


def _resource_findings(report: Mapping[str, Any], budget: Mapping[str, Any]) -> list[Finding]:
    """核对运行期资源上限；缺少资源证据时按证据缺口处理而不是默认通过。

    Args:
        report: 已解析的 perf-report/v1 对象。
        budget: 已解析的 perf-budget/v1 对象。
    Returns:
        资源超限或证据缺失问题。
    Raises:
        ValueError: 资源预算字段不是数值。
    """

    limits = budget.get("resources")
    if limits is None:
        return []
    if not isinstance(limits, dict):
        raise ValueError("resources 预算必须是对象")
    resources = report.get("resources")
    if not isinstance(resources, dict):
        return [Finding("resource-not-measured", "*", "resources", None, None,
                        "预算要求资源证据，但本次报告没有采集资源指标")]

    findings: list[Finding] = []
    peak = resources.get("peak_rss_kb")
    peak_limit = limits.get("peak_rss_kb")
    if peak_limit is not None:
        if not isinstance(peak, (int, float)) or isinstance(peak, bool):
            findings.append(Finding("resource-not-measured", "*", "peak_rss_kb", None,
                                    float(peak_limit), "没有峰值驻留内存证据"))
        elif float(peak) > float(peak_limit):
            findings.append(Finding("over-budget", "*", "peak_rss_kb", float(peak), float(peak_limit),
                                    f"峰值驻留内存 {float(peak) / 1024:.0f} MiB 超过预算"
                                    f" {float(peak_limit) / 1024:.0f} MiB"))

    after = resources.get("after") or {}
    for field in ("threads", "fds"):
        limit = limits.get(field)
        if limit is None:
            continue
        observed = after.get(field)
        if not isinstance(observed, (int, float)) or isinstance(observed, bool):
            findings.append(Finding("resource-not-measured", "*", field, None, float(limit),
                                    f"没有结束时的 {field} 证据"))
        elif float(observed) > float(limit):
            findings.append(Finding("over-budget", "*", field, float(observed), float(limit),
                                    f"结束时 {field}={float(observed):.0f} 超过预算 {float(limit):.0f}"))
    return findings


def _scenario_resource_findings(name: str, scenario: Mapping[str, Any],
                                budget: Mapping[str, Any]) -> list[Finding]:
    """核对单个场景内资源是否随迭代无界增长；未采集时跳过而不报假通过。

    Args:
        name: 场景名。
        scenario: 报告中的单场景结果。
        budget: 已解析的 perf-budget/v1 对象。
    Returns:
        该场景的资源增长问题。
    Raises:
        ValueError: 资源预算字段不是数值。
    """

    limits = budget.get("resources") or {}
    if not isinstance(limits, dict):
        raise ValueError("resources 预算必须是对象")
    if not any(key in limits for key in ("max_thread_growth", "max_fd_growth")):
        return []
    resources = scenario.get("resources")
    if not isinstance(resources, dict):
        return []
    before = resources.get("before") or {}
    after = resources.get("after") or {}
    findings: list[Finding] = []
    for field, limit_key in (("threads", "max_thread_growth"), ("fds", "max_fd_growth")):
        limit = limits.get(limit_key)
        if limit is None:
            continue
        start, end = before.get(field), after.get(field)
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            continue
        growth = float(end) - float(start)
        if growth > float(limit):
            findings.append(Finding(
                "resource-growth", name, field, growth, float(limit),
                f"该场景 {field} 增长 {growth:.0f}，超过允许的 {float(limit):.0f}；"
                f"资源未随迭代释放时不能只报告延迟",
            ))
    return findings


def evaluate(report: Mapping[str, Any], budget: Mapping[str, Any]) -> list[Finding]:
    """按预算逐场景判定，返回全部问题而不是遇到首个问题即停止。

    Args:
        report: 已解析的 perf-report/v1 对象。
        budget: 已解析的 perf-budget/v2 对象。
    Returns:
        所有证据缺口与超预算问题，空列表表示全部满足。
    Raises:
        ValueError: 报告或预算缺少必需结构，属于配置错误而非超预算。
    """

    budget_scenarios = budget.get("scenarios")
    if not isinstance(budget_scenarios, dict) or not budget_scenarios:
        raise ValueError("预算文件必须包含非空的 scenarios 映射")
    report_scenarios = report.get("scenarios")
    if not isinstance(report_scenarios, dict):
        raise ValueError("报告必须包含 scenarios 映射")

    findings: list[Finding] = []

    # 环境与负载必须与预算声明的适用条件一致，否则数字不可比，不能给出通过。
    applies = budget.get("applies_to") or {}
    workload = report.get("workload") or {}
    concurrency = report.get("concurrency")
    if applies.get("workload") and applies.get("workload") != workload.get("id"):
        findings.append(Finding(
            "workload-mismatch", "*", "workload", None, None,
            f"报告负载 {workload.get('id')!r} 与预算适用负载 {applies.get('workload')!r} 不一致",
        ))
    if applies.get("concurrency") is not None and applies.get("concurrency") != concurrency:
        findings.append(Finding(
            "concurrency-mismatch", "*", "concurrency", float(concurrency or 0),
            float(applies.get("concurrency")), "报告并发度与预算适用并发度不一致",
        ))

    # 结果必须对应预算声明的那份源码：读数只对被校准的代码成立，绑定不符时下面各项
    # 指标即使达标也不能算通过。绑定先单独核对，使「测的不是被校准的提交」与「该提交
    # 的某项指标超限」在结论里分列为不同 kind，不混为一类。
    findings.extend(binding_findings(report, binding_expectation(budget)))

    findings.extend(_resource_findings(report, budget))

    for name, limits in budget_scenarios.items():
        if not isinstance(limits, dict):
            raise ValueError(f"场景 {name} 的预算必须是对象")
        scenario = report_scenarios.get(name)
        if not isinstance(scenario, dict):
            findings.append(Finding(
                "scenario-missing", name, "samples", None, None, "报告中没有该场景的测量结果",
            ))
            continue
        errors = scenario.get("errors")
        if not isinstance(errors, int) or errors < 0:
            raise ValueError(f"场景 {name} 的 errors 必须是非负整数")
        if errors:
            findings.append(Finding(
                "request-errors", name, "errors", float(errors), 0.0,
                f"该场景有 {errors} 次请求失败，失败样本不能作为延迟证据",
            ))
        samples = _scenario_samples(scenario)
        if not samples:
            findings.append(Finding(
                "not-measured", name, "samples", 0.0, 1.0, "该场景没有任何有效样本，未执行测量不算通过",
            ))
            continue
        stats = summarize(samples)
        findings.extend(_scenario_resource_findings(name, scenario, budget))

        # 延迟绝对预算：p50/p95/p99 全部分别核对。
        for percent, field in PERCENTILES:
            limit = limits.get(field)
            if limit is None:
                continue
            observed = float(stats[field])
            if observed > float(limit):
                findings.append(Finding(
                    "over-budget", name, field, observed, float(limit),
                    f"p{percent} {observed:.1f} ms 超过预算 {float(limit):.1f} ms"
                    f"（{_ratio(observed, float(limit)):.2f} 倍）",
                ))

        # 并发场景的分位数对排队与调度敏感，吞吐下限是更稳定的判据。
        throughput_floor = limits.get("min_throughput_per_second")
        if throughput_floor is not None:
            observed = scenario.get("throughput_per_second")
            if not isinstance(observed, (int, float)) or isinstance(observed, bool):
                findings.append(Finding(
                    "throughput-not-measured", name, "throughput_per_second", None,
                    float(throughput_floor), "没有取得吞吐证据，缺少该项证据不能判为通过",
                ))
            elif float(observed) < float(throughput_floor):
                findings.append(Finding(
                    "over-budget", name, "throughput_per_second", float(observed),
                    float(throughput_floor),
                    f"吞吐 {float(observed):.1f} 次/秒 低于下限 {float(throughput_floor):.1f} 次/秒",
                ))

        # 数据库查询数：绝对值上限用于识别 N+1 与无界查询。
        for field in SQL_BUDGET_FIELDS:
            limit = limits.get(field)
            if limit is None:
                continue
            sql = scenario.get("sql") or {}
            observed = sql.get(field)
            if not isinstance(observed, (int, float)) or isinstance(observed, bool):
                findings.append(Finding(
                    "sql-not-measured", name, field, None, float(limit),
                    "没有取得数据库查询数，缺少该项证据不能判为通过",
                ))
                continue
            if float(observed) > float(limit):
                findings.append(Finding(
                    "over-budget", name, field, float(observed), float(limit),
                    f"{field} {float(observed):.1f} 超过预算 {float(limit):.1f}",
                ))

        # 噪声下限：预算低于已验证的噪声下限时会在正常波动下误报，属于预算本身不可用。
        reference = limits.get("reference")
        tolerance = limits.get("relative_tolerance")
        noise = budget.get("noise_floor") or {}
        noise_ratio = noise.get("p95_relative") if isinstance(noise, dict) else None
        if isinstance(reference, dict) and isinstance(noise_ratio, (int, float)):
            baseline = reference.get("p95_ms")
            limit = limits.get("p95_ms")
            if isinstance(baseline, (int, float)) and isinstance(limit, (int, float)):
                floor = float(baseline) * (1 + float(noise_ratio))
                if float(limit) < floor:
                    findings.append(Finding(
                        "budget-below-noise-floor", name, "p95_ms", float(limit), floor,
                        f"p95 预算 {float(limit):.1f} ms 低于参考基线 {float(baseline):.1f} ms"
                        f" 加已验证噪声 {float(noise_ratio) * 100:.0f}% 的下限 {floor:.1f} ms",
                    ))

        if isinstance(reference, dict) and isinstance(tolerance, (int, float)):
            for field in ("p95_ms", "p99_ms"):
                baseline = reference.get(field)
                if not isinstance(baseline, (int, float)) or isinstance(baseline, bool):
                    continue
                allowed = float(baseline) * (1 + float(tolerance))
                observed = float(stats[field])
                if observed > allowed:
                    findings.append(Finding(
                        "regression-budget", name, field, observed, allowed,
                        f"{field} {observed:.1f} ms 超过参考基线 {float(baseline):.1f} ms"
                        f" 加 {float(tolerance) * 100:.0f}% 容差后的 {allowed:.1f} ms",
                    ))
    return findings


def payload(report: Mapping[str, Any], budget: Mapping[str, Any], findings: Sequence[Finding]) -> dict[str, object]:
    """生成结构化结果；checked 取实际参与判定的场景数，不用计划数量代替。

    结论必须自带构件绑定的期望值与实测值：绑定是否成立是发布证据链要独立复核的一项，
    只留一个 `build-mismatch` 文字结论会让复核方无从判断「测的是哪份代码」。

    Args:
        report: 已解析的 perf-report/v1 对象。
        budget: 已解析的 perf-budget/v2 对象。
        findings: 本次判定产生的问题。
    Returns:
        可直接写成发布证据的结构化结论。
    """

    budget_scenarios = budget.get("scenarios") or {}
    report_scenarios = report.get("scenarios") or {}
    checked = sum(1 for name in budget_scenarios if name in report_scenarios)
    return {
        "protocol": "quality-check/v1",
        "check": CHECK_NAME,
        "schema": BUDGET_SCHEMA,
        "budget_status": budget.get("status"),
        "workload": (report.get("workload") or {}).get("id"),
        "checked": checked,
        "binding": binding_summary(report, budget, findings),
        "status": "failed" if findings else "passed",
        "findings": [
            {
                "kind": item.kind, "scenario": item.scenario, "metric": item.metric,
                "observed": item.observed, "allowed": item.allowed, "message": item.message,
            }
            for item in findings
        ],
    }


def main(argv: Sequence[str] | None = None) -> int:
    """执行预算核对并按结果返回退出码：0 通过、1 超预算或绑定不符、2 输入不可用。

    Args:
        argv: 命令行参数；省略时读取真实进程参数。
    Returns:
        0 表示全部满足；1 表示存在超预算、证据不足或构件绑定不符；2 表示报告、预算或
        预算声明的构件绑定本身不可用。
    """

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", required=True, help="本次实测生成的 perf-report/v1 文件")
    parser.add_argument("--budgets", required=True,
                        help=f"受版本控制的 {BUDGET_SCHEMA} 文件")
    parser.add_argument("--json", action="store_true", help="输出结构化结果")
    args = parser.parse_args(argv)
    try:
        report = load_document(Path(args.report), REPORT_SCHEMA)
        budget = load_document(Path(args.budgets), BUDGET_SCHEMA,
                               retired={RETIRED_BUDGET_SCHEMA: RETIRED_BUDGET_REASON})
        findings = evaluate(report, budget)
    except ValueError as error:
        print(f"性能预算核对无法执行：{error}", file=sys.stderr)
        return 2
    result = payload(report, budget, findings)
    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        binding = result["binding"]
        print(f"性能预算核对：检查 {result['checked']} 个场景，{len(findings)} 项问题；"
              f"构件绑定 {binding['method']} {'相符' if binding['matched'] else '不相符'}"
              f"（实测修订 {binding['observed']['git_revision']}、"
              f"预算修订 {binding['declared']['git_revision']}）")
        for item in findings:
            print(f"  [{item.kind}] {item.scenario} {item.metric}：{item.message}")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
