"""验证性能预算判定：正常通过，以及超预算、证据不足、版本不符等受控反例必须失败。

从「看起来通过」的两类情形切进去：把预算调紧后仍返回通过，说明阈值比较没有真的生效；
报告缺少样本、请求失败或没有查询数证据时被判为通过，等于把未执行测量当成合规。
构件绑定单独成组：换成可复现的源码身份之后，**测的不是被校准的那份代码仍然必须失败**，
而绑定成立时又不能把别的指标超限混进绑定结论。这些反例同时是 A12 变异对照的判定侧依据。

@author 李杰
"""

from __future__ import annotations

import contextlib
import copy
import io
import json
from pathlib import Path

import pytest

from scripts.perf import perf_budget, merge_reports, source_identity

ROOT = Path(__file__).resolve().parents[2]
BUDGET_FILE = ROOT / "scripts" / "perf" / "budgets" / "baseline-2026-10-07.json"
BUILD = "a" * 64
REVISION = "0123456789abcdef0123456789abcdef01234567"


def binding_block(**overrides: object) -> dict[str, object]:
    """构造预算侧的可复现绑定声明；预算不得再出现构件字节摘要。"""

    document: dict[str, object] = {
        "binding_method": perf_budget.BINDING_METHOD,
        "source_scope": perf_budget.BINDING_SCOPE,
        "git_revision": REVISION,
        "source_sha256": BUILD,
    }
    document.update(overrides)
    return document


def build_block(**overrides: object) -> dict[str, object]:
    """构造报告侧的构件段：绑定证据加一条**不同**的构件字节摘要观测值。

    ``jar_sha256`` 只作「这次跑的到底是哪个 JAR」的记录：与预算不同也不改变判定结果，
    用来钉住绑定依据确实换了，而不是把同一个不可复现的摘要换了个字段名继续用。
    """

    document = binding_block(jar_sha256="f" * 64)
    document.update(overrides)
    return document


def report(**overrides: object) -> dict[str, object]:
    """构造最小可判定报告，场景与预算文件保持同名前缀，便于逐项覆盖。"""

    document: dict[str, object] = {
        "schema": perf_budget.REPORT_SCHEMA,
        "workload": {"id": "w7-baseline-v1", "samples_per_scenario": 5},
        "concurrency": 1,
        "build": build_block(),
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
                       "build": binding_block()},
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


def test_rejects_mismatched_workload_and_concurrency() -> None:
    """负载或并发度不一致时数字不可比，必须失败。"""

    other = report()
    other["workload"] = {"id": "another"}
    other["concurrency"] = 8
    assert {"workload-mismatch", "concurrency-mismatch"} <= kinds(perf_budget.evaluate(other, budget()))


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
    """仓库内提交的受控预算必须可解析、结构完整且标注待授权状态。"""

    document = perf_budget.load_document(BUDGET_FILE, perf_budget.BUDGET_SCHEMA)
    assert document["status"] == "proposed-awaiting-authority"
    assert document["approved_by"] is None
    assert document["applies_to"]["workload"] == "w7-baseline-v1"
    assert document["scenarios"], "预算必须覆盖实际测量的场景"
    for name, limits in document["scenarios"].items():
        assert limits["p95_ms"] >= limits["p50_ms"], f"{name} 的 p95 预算不能低于 p50"
        assert limits["p99_ms"] >= limits["p95_ms"], f"{name} 的 p99 预算不能低于 p95"


def test_controlled_budget_never_claims_an_unverified_binding() -> None:
    """受控预算要么声明完整的可复现源码身份，要么显式声明绑定尚未回填。

    两种状态都不得被当作「无需核对构件」：绑定未回填时 perf_budget 以退出码 2 拒绝
    判定，等于强制重新校准，而不是把绑定判定悄悄关掉。
    """

    document = perf_budget.load_document(BUDGET_FILE, perf_budget.BUDGET_SCHEMA)
    build = document["applies_to"]["build"]
    assert build["binding_method"] == perf_budget.BINDING_METHOD
    assert build["source_scope"] == perf_budget.BINDING_SCOPE
    bound = all(perf_budget._hex_text(build.get(field), length)
                for field, length in perf_budget.BINDING_FIELDS.items())
    assert bound or build.get("binding_state") == "unbound-pending-recalibration"
    assert "retired_binding" in build, "旧绑定方式必须留档，不得无声消失"
    if not bound:
        with pytest.raises(ValueError, match="构件绑定缺少可用的 git_revision"):
            perf_budget.binding_expectation(document)


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

    # 源码身份不同才不可比：同一份源码重建出的 JAR 字节不同，合并仍然成立。
    rebuilt = copy.deepcopy(sql)
    rebuilt["build"]["jar_sha256"] = "c" * 64
    assert merge_reports.merge(latency, rebuilt)["scenarios"]["auth-login"]["sql"]

    divergent = copy.deepcopy(sql)
    divergent["build"]["source_sha256"] = "e" * 64
    with pytest.raises(merge_reports.MergeFailure):
        merge_reports.merge(latency, divergent)


def test_binding_mismatch_still_fails_and_is_reported_as_binding() -> None:
    """核心回归：绑定方式换过之后，「测的不是被校准的那份代码」仍然是失败项。

    提交或源码摘要任一不同都必须报 ``build-mismatch``；只改构件字节摘要则不影响判定，
    证明它确实不再是绑定依据而不是被换了个名字。
    """

    other_revision = report(build=build_block(git_revision="f" * 40))
    other_source = report(build=build_block(source_sha256="b" * 64))
    other_scope = report(build=build_block(source_scope="other-scope/v1"))
    for document in (other_revision, other_source, other_scope):
        found = kinds(perf_budget.evaluate(document, budget()))
        assert found & {"build-mismatch", "build-binding-mismatch"}, found

    rebuilt = report(build=build_block(jar_sha256="c" * 64))
    assert perf_budget.evaluate(rebuilt, budget()) == []


def test_missing_binding_evidence_fails_as_evidence_gap() -> None:
    """报告没有给出绑定证据时判证据缺口，不得因为「没说不符」而算通过。"""

    for field in ("git_revision", "source_sha256"):
        block = build_block()
        block.pop(field)
        findings = perf_budget.evaluate(report(build=block), budget())
        assert [item.kind for item in findings] == ["build-binding-missing"]
        assert findings[0].metric == field


def test_binding_ok_with_over_budget_metric_reports_only_that_metric() -> None:
    """绑定成立但别的指标超限时，只报那条指标，不把结论混成绑定问题。"""

    tight = budget()
    tight["scenarios"]["auth-login"].update({"p50_ms": 11.0, "p95_ms": 12.0, "p99_ms": 12.0})
    findings = perf_budget.evaluate(report(), tight)
    assert kinds(findings) == {"over-budget"}
    assert {item.metric for item in findings} == {"p50_ms", "p95_ms", "p99_ms"}


@pytest.mark.parametrize("mutation,pattern", [
    ("jar_sha256", "仍以 jar_sha256 绑定被测版本"),
    ("missing_binding", "binding_method 必须声明为 git-source-id/v1"),
    ("blank_revision", "构件绑定缺少可用的 git_revision"),
    ("short_revision", "构件绑定缺少可用的 git_revision"),
])
def test_unusable_budget_binding_is_a_configuration_error(mutation: str,
                                                           pattern: str) -> None:
    """预算自身声明不出可复现的绑定时按配置错误拒绝，绝不放行成「无需核对构件」。"""

    document = budget()
    build = document["applies_to"]["build"]
    if mutation == "jar_sha256":
        build["jar_sha256"] = "c" * 64
    elif mutation == "missing_binding":
        build["binding_method"] = "jar-sha256/v1"
    elif mutation == "blank_revision":
        build["git_revision"] = ""
    else:
        build["git_revision"] = "abc"
    with pytest.raises(ValueError, match=pattern):
        perf_budget.binding_expectation(document)


def test_verdict_reports_declared_and_observed_binding(tmp_path: Path,
                                                        capsys: pytest.CaptureFixture[str]) -> None:
    """结论必须自带绑定期望值与实测值，供日志、制品与发布证据链独立复核。"""

    report_path = tmp_path / "report.json"
    budget_path = tmp_path / "budget.json"
    report_path.write_text(json.dumps(report()), encoding="utf-8")
    budget_path.write_text(json.dumps(budget()), encoding="utf-8")
    assert perf_budget.main(["--report", str(report_path), "--budgets", str(budget_path),
                             "--json"]) == 0
    verdict = json.loads(capsys.readouterr().out)
    assert verdict["binding"]["method"] == perf_budget.BINDING_METHOD
    assert verdict["binding"]["observed"]["git_revision"] == REVISION
    assert verdict["binding"]["matched"] is True

    report_path.write_text(json.dumps(report(build=build_block(git_revision="f" * 40))),
                           encoding="utf-8")
    assert perf_budget.main(["--report", str(report_path), "--budgets", str(budget_path),
                             "--json"]) == 1
    verdict = json.loads(capsys.readouterr().out)
    assert verdict["binding"]["matched"] is False
    assert {item["kind"] for item in verdict["findings"]} == {"build-mismatch"}


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


def test_retired_schema_budget_is_rejected_with_migration_reason(tmp_path: Path) -> None:
    """仍按 perf-budget/v1 提交的文件必须被拒绝，并说明旧绑定为什么不可用。"""

    legacy = budget()
    legacy["schema"] = perf_budget.RETIRED_BUDGET_SCHEMA
    legacy["applies_to"]["build"] = {"jar_sha256": BUILD}
    budget_path = tmp_path / "legacy.json"
    budget_path.write_text(json.dumps(legacy), encoding="utf-8")
    report_path = tmp_path / "report.json"
    report_path.write_text(json.dumps(report()), encoding="utf-8")
    assert perf_budget.main(["--report", str(report_path), "--budgets", str(budget_path)]) == 2


def test_controlled_budget_file_is_not_usable_as_a_gate_until_recalibrated(
        tmp_path: Path) -> None:
    """真实受控预算当前未回填绑定：判定必须失败，且原因指向绑定而不是任何阈值。"""

    report_path = tmp_path / "report.json"
    report_path.write_text(json.dumps(report()), encoding="utf-8")
    assert perf_budget.main(["--report", str(report_path), "--budgets", str(BUDGET_FILE)]) == 2


def unavailable_verdict(tmp_path: Path, report_document: object,
                        budget_document: object) -> tuple[int, dict[str, object], str]:
    """真实跑一次 CLI，把退出码、写入标准输出的结论文档与标准错误话术一起取回。

    Args:
        tmp_path: 本次用例的临时目录。
        report_document: 报告文件内容；不是字符串时按 JSON 写出。
        budget_document: 预算文件内容；不是字符串时按 JSON 写出。
    Returns:
        真实退出码、解析后的结论文档与标准错误输出。
    """

    report_path = tmp_path / "report.json"
    budget_path = tmp_path / "budget.json"
    for path, document in ((report_path, report_document), (budget_path, budget_document)):
        if isinstance(document, str):
            path.write_text(document, encoding="utf-8")
        else:
            path.write_text(json.dumps(document), encoding="utf-8")
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = perf_budget.main(["--report", str(report_path), "--budgets", str(budget_path),
                                 "--json"])
    return code, json.loads(out.getvalue()), err.getvalue()


def unbound_budget() -> dict[str, object]:
    """构造一份声明不出可复现绑定的预算：正是受控文件当前的状态。"""

    document = budget()
    block = binding_block(git_revision=None, source_sha256=None)
    block["binding_state"] = "unbound-pending-recalibration"
    document["applies_to"]["build"] = block
    return document


def test_exit_two_still_writes_a_verdict_document(tmp_path: Path) -> None:
    """核心回归（run 37777276336）：退出码 2 必须产出结论文档，不能只留一个退出码。

    真实缺陷是判定以 2 结束时标准输出为空，被 capture 成 verdict.json 后得到 0 字节
    文件：上传的制品里没有判定结论，日志里只剩「无法读取」和退出码。
    """

    code, verdict, noise = unavailable_verdict(tmp_path, report(), unbound_budget())

    assert code == 2, "退出码 2 不得被改写成 0 或 1"
    assert verdict["status"] == "unavailable"
    assert verdict["protocol"] == "quality-check/v1"
    assert verdict["check"] == perf_budget.CHECK_NAME
    assert verdict["schema"] == perf_budget.BUDGET_SCHEMA
    assert verdict["exit_code"] == 2
    # 一次也没有判定：实际核对场景数必须是 0，不能拿预算声明的场景数充数。
    assert verdict["checked"] == 0
    assert verdict["findings"] == []
    assert verdict["unavailable"]["action"]
    # 绑定从未比较过，不得凭空写成「相符」。
    assert verdict["binding"]["matched"] is None
    assert verdict["binding"]["compared"] is False
    assert noise, "标准错误必须写明原因，不能只有退出码"


def test_unavailable_verdicts_separate_the_three_causes(tmp_path: Path) -> None:
    """三类输入不可用必须各有各的类别与说法，不能合成一句「无法读取」。"""

    unsupported = budget()
    unsupported["schema"] = "perf-budget/v9"

    cases = {
        perf_budget.CATEGORY_BINDING_UNBOUND: (report(), unbound_budget(),
                                               "unbound-pending-recalibration", "重新校准"),
        perf_budget.CATEGORY_REPORT_INVALID: ("{不是 JSON", budget(), None, "不是合法 JSON"),
        perf_budget.CATEGORY_BUDGET_INVALID: (report(), unsupported, None, "perf-budget/v9"),
    }

    for category, (report_document, budget_document, state, expected) in cases.items():
        directory = tmp_path / category
        directory.mkdir()
        code, verdict, noise = unavailable_verdict(directory, report_document, budget_document)
        assert code == 2, category
        assert verdict["unavailable"]["category"] == category, verdict["unavailable"]
        assert verdict["unavailable"]["kind"] in perf_budget.UNAVAILABLE_GUIDE
        assert expected in noise, f"{category} 的标准错误必须写明原因：{noise}"
        assert verdict["unavailable"]["binding_state"] == state


def test_unsupported_budget_schema_names_the_offending_schema(tmp_path: Path) -> None:
    """预算 schema 不受支持时，结论必须写明具体是哪个 schema 以及迁移方向。"""

    document = budget()
    document["schema"] = "perf-budget/v9"
    code, verdict, _ = unavailable_verdict(tmp_path, report(), document)

    assert code == 2
    assert verdict["unavailable"]["kind"] == "budget-schema-unsupported"
    assert verdict["unavailable"]["subject"] == "budget"
    assert "perf-budget/v9" in verdict["unavailable"]["detail"]
    assert perf_budget.BUDGET_SCHEMA in verdict["unavailable"]["action"]


def test_retired_schema_budget_verdict_keeps_the_migration_reason(tmp_path: Path) -> None:
    """退役 schema 的迁移说明必须进结论文件，不能只留在已经滚走的日志里。"""

    legacy = budget()
    legacy["schema"] = perf_budget.RETIRED_BUDGET_SCHEMA
    legacy["applies_to"]["build"] = {"jar_sha256": BUILD}
    code, verdict, _ = unavailable_verdict(tmp_path, report(), legacy)

    assert code == 2
    assert verdict["unavailable"]["category"] == perf_budget.CATEGORY_BUDGET_INVALID
    assert verdict["unavailable"]["kind"] == "budget-schema-unsupported"
    assert perf_budget.RETIRED_BUDGET_SCHEMA in verdict["unavailable"]["detail"]
    assert "已退役" in verdict["unavailable"]["detail"]


def test_passing_and_failing_verdicts_keep_their_original_shape(tmp_path: Path) -> None:
    """退出码 0 与 1 的结论必须逐字保持原样：不得混进 unavailable 段或 exit_code。"""

    report_path = tmp_path / "report.json"
    budget_path = tmp_path / "budget.json"
    report_path.write_text(json.dumps(report()), encoding="utf-8")
    budget_path.write_text(json.dumps(budget()), encoding="utf-8")

    captured = io.StringIO()
    with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
        assert perf_budget.main(["--report", str(report_path), "--budgets", str(budget_path),
                                 "--json"]) == 0
    passed = json.loads(captured.getvalue())
    assert set(passed) == {"protocol", "check", "schema", "budget_status", "workload",
                           "checked", "binding", "status", "findings"}
    assert passed["status"] == "passed" and passed["findings"] == []

    tight = budget()
    tight["scenarios"]["auth-login"].update({"p50_ms": 11.0, "p95_ms": 12.0, "p99_ms": 12.0})
    budget_path.write_text(json.dumps(tight), encoding="utf-8")
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
        assert perf_budget.main(["--report", str(report_path), "--budgets", str(budget_path),
                                 "--json"]) == 1
    failed = json.loads(captured.getvalue())
    assert set(failed) == set(passed)
    assert failed["status"] == "failed"
    assert {item["kind"] for item in failed["findings"]} == {"over-budget"}


def test_unavailable_verdict_is_not_accepted_as_release_evidence(tmp_path: Path) -> None:
    """退出码 2 的结论绝不能被当成发布证据：状态与场景数都必须挡住。"""

    code, verdict, _ = unavailable_verdict(tmp_path, report(), unbound_budget())

    assert code == 2
    assert verdict["status"] != "passed"
    assert type(verdict["checked"]) is int and verdict["checked"] <= 0


def source_tree(root: Path) -> Path:
    """在被测范围内的仓库里准备一棵最小源码树，返回一个源文件路径。

    Args:
        root: 临时仓库根目录。
    Returns:
        被写入内容的源文件路径。
    """

    directory = root / source_identity.SOURCE_ROOTS[0] / "module" / "src"
    directory.mkdir(parents=True)
    target = directory / "Sample.java"
    target.write_text("class Sample {}\n", encoding="utf-8")
    return target


def test_source_digest_is_reproducible_and_changes_with_content(tmp_path: Path) -> None:
    """绑定必须是真绑定：同一内容两次计算相同，改一个字节立即不同。

    这条性质是「可复现绑定」的全部含义——重建产物、打乱遍历顺序都不得改变结果，
    而任何源码改动都必须改变结果，否则绑定就退化成常量。
    """

    target = source_tree(tmp_path)
    digest, count = source_identity.source_digest(tmp_path)
    assert count == 1
    assert source_identity.source_digest(tmp_path)[0] == digest

    target.write_text("class Sample { }\n", encoding="utf-8")
    assert source_identity.source_digest(tmp_path)[0] != digest

    target.write_text("class Sample {}\n", encoding="utf-8")
    assert source_identity.source_digest(tmp_path)[0] == digest


def test_source_digest_ignores_build_output_and_logs(tmp_path: Path) -> None:
    """构建产物与日志不参与摘要：重新打包不得让绑定失效。"""

    source_tree(tmp_path)
    digest, _ = source_identity.source_digest(tmp_path)
    output = tmp_path / source_identity.SOURCE_ROOTS[0] / "module" / "target" / "classes"
    output.mkdir(parents=True)
    (output / "Sample.class").write_bytes(b"\x00\x01\x02")
    logs = tmp_path / source_identity.SOURCE_ROOTS[0] / "logs"
    logs.mkdir()
    (logs / "app.log").write_text("启动一次\n", encoding="utf-8")

    assert source_identity.source_digest(tmp_path)[0] == digest


def test_source_digest_follows_file_renames(tmp_path: Path) -> None:
    """同内容改名也是构建输入变化，摘要必须跟着变。"""

    source = source_tree(tmp_path)
    digest, _ = source_identity.source_digest(tmp_path)
    source.rename(source.with_name("Renamed.java"))

    assert source_identity.source_digest(tmp_path)[0] != digest
