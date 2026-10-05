"""核对性能测量报告是否满足受控预算，并对超预算、未测量和证据不可比分别判定失败。

本模块只消费“实际运行产生的测量报告”和“受版本控制的预算文件”，自身不发请求、
不读环境变量、不联网，因此同一对输入必然得到同一结论。门禁入口与负对照都复用它，
避免判定逻辑与实际执行分叉。

报告结构（perf-report/v1）中的 samples_ms 必须保留全部原始样本，判定只用报告内的
统计量，但保留原始样本使判定可被复核。

预算文件结构（perf-budget/v1）同时表达两类依据：

* 绝对预算：响应分位数与单次请求数据库查询数的上限。
* 回归预算：相对同一负载参考基线的允许增量比例，避免只回答“比上次快”。

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

REPORT_SCHEMA = "perf-report/v1"
BUDGET_SCHEMA = "perf-budget/v1"
CHECK_NAME = "性能预算"

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


def load_document(path: Path, expected_schema: str) -> dict[str, Any]:
    """读取并校验结构版本，缺失、非 JSON 或结构不符都作为配置错误拒绝。

    Args:
        path: 报告或预算文件位置。
        expected_schema: 期望的顶层 schema 标识。
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
    if document.get("schema") != expected_schema:
        raise ValueError(f"{path} 的 schema 必须是 {expected_schema}")
    return document


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
        budget: 已解析的 perf-budget/v1 对象。
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

    # 结果必须对应预算声明的实际构建；构件摘要不同说明报告来自别的版本，数字不可用于判定。
    expected_build = applies.get("build") or {}
    report_build = report.get("build") or {}
    for field in ("jar_sha256", "git_revision"):
        expected = expected_build.get(field)
        if expected and expected != report_build.get(field):
            findings.append(Finding(
                "build-mismatch", "*", field, None, None,
                f"报告构件 {field}={report_build.get(field)!r} 与预算声明的 {expected!r} 不一致",
            ))

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
    """生成结构化结果；checked 取实际参与判定的场景数，不用计划数量代替。"""

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
    """执行预算核对并按结果返回退出码：0 通过、1 超预算、2 输入不可用。

    Args:
        argv: 命令行参数；省略时读取真实进程参数。
    Returns:
        0 表示全部满足；1 表示存在超预算或证据不足；2 表示报告或预算本身不可用。
    """

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", required=True, help="本次实测生成的 perf-report/v1 文件")
    parser.add_argument("--budgets", required=True, help="受版本控制的 perf-budget/v1 文件")
    parser.add_argument("--json", action="store_true", help="输出结构化结果")
    args = parser.parse_args(argv)
    try:
        report = load_document(Path(args.report), REPORT_SCHEMA)
        budget = load_document(Path(args.budgets), BUDGET_SCHEMA)
        findings = evaluate(report, budget)
    except ValueError as error:
        print(f"性能预算核对无法执行：{error}", file=sys.stderr)
        return 2
    result = payload(report, budget, findings)
    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(f"性能预算核对：检查 {result['checked']} 个场景，{len(findings)} 项问题")
        for item in findings:
            print(f"  [{item.kind}] {item.scenario} {item.metric}：{item.message}")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
