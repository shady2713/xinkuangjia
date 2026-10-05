"""验证性能预算判定：正常通过，以及超预算、证据不足、版本不符等受控反例必须失败。

反例覆盖两类容易“看起来通过”的情形：一类是把预算调紧后仍返回通过，说明阈值比较没有真的生效；
另一类是报告缺少样本、请求失败或没有查询数证据时被判为通过，等于把未执行测量当成合规。
这些反例同时是 A12 变异对照的判定侧依据。

@author 李杰
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from scripts.perf import perf_budget, merge_reports

ROOT = Path(__file__).resolve().parents[2]
BUDGET_FILE = ROOT / "scripts" / "perf" / "budgets" / "baseline-w7.json"
BUILD = "a" * 64


def report(**overrides: object) -> dict[str, object]:
    """构造最小可判定报告，场景与预算文件保持同名前缀，便于逐项覆盖。"""

    document: dict[str, object] = {
        "schema": perf_budget.REPORT_SCHEMA,
        "workload": {"id": "w7-baseline-v1", "samples_per_scenario": 5},
        "concurrency": 1,
        "build": {"jar_sha256": BUILD, "git_revision": "0123456789abcdef0123456789abcdef01234567"},
        "resources": {"before": {"threads": 100, "fds": 50, "rss_kb": 1000},
                      "after": {"threads": 105, "fds": 50, "rss_kb": 1200},
                      "peak_rss_kb": 1500},
        "scenarios": {
            "auth-login": {"samples_ms": [10.0, 11.0, 12.0, 13.0, 14.0], "errors": 0,
                           "sql": {"sql_queries_median": 8.0, "sql_queries_p95": 9.0}},
        },
    }
    document.update(overrides)
    return document


def budget(**overrides: object) -> dict[str, object]:
    """构造单场景预算，默认值与报告样本一致。"""

    document: dict[str, object] = {
        "schema": perf_budget.BUDGET_SCHEMA,
        "status": "test",
        "applies_to": {"workload": "w7-baseline-v1", "concurrency": 1,
                       "build": {"jar_sha256": BUILD,
                                 "git_revision": "0123456789abcdef0123456789abcdef01234567"}},
        "resources": {"peak_rss_kb": 4096, "threads": 300, "fds": 300,
                      "max_thread_growth": 32, "max_fd_growth": 0},
        "scenarios": {"auth-login": {"p50_ms": 100.0, "p95_ms": 100.0, "p99_ms": 100.0,
                                     "sql_queries_median": 20, "sql_queries_p95": 20,
                                     "reference": {"p95_ms": 14.0, "p99_ms": 14.0},
                                     "relative_tolerance": 0.35}},
    }
    document.update(overrides)
    return document


def kinds(findings: list[perf_budget.Finding]) -> set[str]:
    """提取问题类型集合，便于断言而不是匹配中文文案。"""

    return {item.kind for item in findings}


def test_accepts_reports_inside_every_budget() -> None:
    """全部指标在预算内时必须给出空问题列表。"""

    assert perf_budget.evaluate(report(), budget()) == []


def test_rejects_tightened_budget_that_the_baseline_exceeds() -> None:
    """调紧预算后同一份实测必须失败，证明阈值比较真的参与判定。"""

    tight = budget()
    tight["scenarios"]["auth-login"].update({"p50_ms": 11.0, "p95_ms": 12.0, "p99_ms": 12.0})
    findings = perf_budget.evaluate(report(), tight)
    assert "over-budget" in kinds(findings)
    assert {item.metric for item in findings if item.kind == "over-budget"} == {"p50_ms", "p95_ms", "p99_ms"}


def test_rejects_regression_beyond_reference_tolerance() -> None:
    """超过参考基线加容差时必须失败，避免只用“比上次快”判断。"""

    document = budget()
    document["scenarios"]["auth-login"]["reference"] = {"p95_ms": 5.0, "p99_ms": 5.0}
    findings = perf_budget.evaluate(report(), document)
    assert "regression-budget" in kinds(findings)


def test_rejects_budget_below_verified_noise_floor() -> None:
    """预算低于已验证噪声下限时属于预算不可用，必须失败。"""

    document = budget()
    document["noise_floor"] = {"p95_relative": 0.20}
    document["scenarios"]["auth-login"]["p95_ms"] = 15.0
    document["scenarios"]["auth-login"]["reference"] = {"p95_ms": 14.0, "p99_ms": 14.0}
    findings = perf_budget.evaluate(report(), document)
    assert "budget-below-noise-floor" in kinds(findings)


def test_rejects_empty_samples() -> None:
    """没有样本时不能算通过，必须报告未执行测量。"""

    document = report()
    document["scenarios"]["auth-login"]["samples_ms"] = []
    assert "not-measured" in kinds(perf_budget.evaluate(document, budget()))


def test_rejects_missing_scenario() -> None:
    """预算声明的场景没有出现在报告里时必须失败。"""

    document = report()
    document["scenarios"] = {}
    assert "scenario-missing" in kinds(perf_budget.evaluate(document, budget()))


def test_rejects_request_errors() -> None:
    """存在失败请求时不能只用成功样本给出通过。"""

    document = report()
    document["scenarios"]["auth-login"]["errors"] = 3
    assert "request-errors" in kinds(perf_budget.evaluate(document, budget()))


def test_rejects_missing_sql_evidence() -> None:
    """预算要求查询数而报告没有该证据时必须失败。"""

    document = report()
    document["scenarios"]["auth-login"].pop("sql")
    assert "sql-not-measured" in kinds(perf_budget.evaluate(document, budget()))


def test_rejects_sql_query_regression() -> None:
    """每次动作的语句数超过绝对上限时必须失败，用于识别 N+1 与无界查询。"""

    document = report()
    document["scenarios"]["auth-login"]["sql"] = {"sql_queries_median": 60.0, "sql_queries_p95": 60.0}
    assert "over-budget" in kinds(perf_budget.evaluate(document, budget()))


def test_rejects_mismatched_build_and_workload() -> None:
    """构件摘要、修订、负载或并发度不一致时数字不可比，必须失败。"""

    other = report(build={"jar_sha256": "b" * 64, "git_revision": "f" * 40})
    other["workload"] = {"id": "another"}
    other["concurrency"] = 8
    findings = kinds(perf_budget.evaluate(other, budget()))
    assert {"build-mismatch", "workload-mismatch", "concurrency-mismatch"} <= findings


def test_rejects_resource_excess_and_growth() -> None:
    """资源超限或场景内资源无界增长时必须失败。"""

    document = report()
    document["resources"]["peak_rss_kb"] = 8192
    document["resources"]["after"]["threads"] = 500
    document["scenarios"]["auth-login"]["resources"] = {"before": {"threads": 100, "fds": 10},
                                                        "after": {"threads": 200, "fds": 10}}
    findings = kinds(perf_budget.evaluate(document, budget()))
    assert {"over-budget", "resource-growth"} <= findings


def test_rejects_missing_resource_evidence() -> None:
    """预算要求资源证据而报告缺失时必须失败。"""

    document = report()
    document.pop("resources")
    assert "resource-not-measured" in kinds(perf_budget.evaluate(document, budget()))


def test_rejects_missing_throughput_evidence() -> None:
    """并发场景声明吞吐下限时，没有吞吐证据不能判为通过。"""

    document = budget()
    document["scenarios"]["auth-login"]["min_throughput_per_second"] = 100.0
    assert "throughput-not-measured" in kinds(perf_budget.evaluate(report(), document))


def test_shipped_budget_file_parses_and_matches_its_declared_schema() -> None:
    """仓库内提交的预算文件必须可解析、结构完整且标注待授权状态。"""

    document = perf_budget.load_document(BUDGET_FILE, perf_budget.BUDGET_SCHEMA)
    assert document["status"] == "proposed-awaiting-authority"
    assert document["approved_by"] is None
    assert document["applies_to"]["workload"] == "w7-baseline-v1"
    assert document["scenarios"], "预算必须覆盖实际测量的场景"
    for name, limits in document["scenarios"].items():
        assert limits["p95_ms"] >= limits["p50_ms"], f"{name} 的 p95 预算不能低于 p50"
        assert limits["p99_ms"] >= limits["p95_ms"], f"{name} 的 p99 预算不能低于 p95"


def test_percentile_matches_linear_interpolation() -> None:
    """分位数口径固定，避免同一份样本在不同实现下给出不同预算判定。"""

    assert perf_budget.percentile([1.0, 2.0, 3.0, 4.0, 5.0], 95) == pytest.approx(4.8)
    assert perf_budget.summarize([2.0, 4.0])["median_ms"] == 3.0


def test_merge_requires_comparable_reports() -> None:
    """两份报告的条件不一致时拒绝合并，避免把不同环境的数字拼在一起。"""

    latency = report()
    latency["scenarios"]["auth-login"].pop("sql")
    sql = report()
    merged = merge_reports.merge(latency, sql)
    assert merged["scenarios"]["auth-login"]["sql"]["sql_queries_median"] == 8.0

    divergent = copy.deepcopy(sql)
    divergent["build"]["jar_sha256"] = "c" * 64
    with pytest.raises(merge_reports.MergeFailure):
        merge_reports.merge(latency, divergent)


def test_cli_exit_codes_distinguish_violation_from_unusable_input(tmp_path: Path) -> None:
    """超预算返回 1，输入不可用返回 2；两者都不能被当成通过。"""

    report_path = tmp_path / "report.json"
    budget_path = tmp_path / "budget.json"
    report_path.write_text(json.dumps(report()), encoding="utf-8")

    passing = budget()
    budget_path.write_text(json.dumps(passing), encoding="utf-8")
    assert perf_budget.main(["--report", str(report_path), "--budgets", str(budget_path)]) == 0

    passing["scenarios"]["auth-login"]["p95_ms"] = 5.0
    passing["scenarios"]["auth-login"]["p50_ms"] = 5.0
    passing["scenarios"]["auth-login"]["p99_ms"] = 5.0
    budget_path.write_text(json.dumps(passing), encoding="utf-8")
    assert perf_budget.main(["--report", str(report_path), "--budgets", str(budget_path)]) == 1

    budget_path.write_text("{not json", encoding="utf-8")
    assert perf_budget.main(["--report", str(report_path), "--budgets", str(budget_path)]) == 2
