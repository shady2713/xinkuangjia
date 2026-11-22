"""验证 CI 制品中的受验版本、用例统计及无效证据处理。

@author Claude Code
"""
import importlib.util
import json
from pathlib import Path

import pytest

_PATH = Path(__file__).resolve().parents[1] / "workflow" / "ci_evidence.py"
_SPEC = importlib.util.spec_from_file_location("ci_evidence", _PATH)
ce = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(ce)

HEAD = "a" * 40
BASE = "b" * 40
STAMP = {"sha": HEAD, "run_id": "42", "run_attempt": "1"}


def need(job, *step_ids, **override):
    """生成单个依赖作业的合成输出及步骤记录。"""
    proof = {"job": job, "status": "success", "run_id": "42", "run_attempt": "1", "sha": HEAD,
             "steps": {s: {"outcome": "success", "conclusion": "success", "counts": {"passed": 1}} for s in step_ids}}
    proof.update(override)
    return {"result": "success", "outputs": {"proof": json.dumps(proof)}}


def good_needs(**override):
    """构造可按测试场景覆盖的完整依赖作业结果。"""
    jobs = {"backend": need("backend", "maven_verify"),
            "pytest": need("pytest", "pytest_tests"), "secrets-scan": need("secrets-scan", "scan_history"),
            "frontend": need("frontend", "frontend_gates", "browser_e2e"),
            "docs-comments": need("docs-comments", "docs_checks", "changed_comments")}
    jobs.update(override)
    return jobs


@pytest.fixture
def env(tmp_path, monkeypatch):
    """初始化确定的运行标识和原生格式切片计划。"""
    monkeypatch.setattr(ce, "git", lambda *args: HEAD)
    for key, value in {"GITHUB_RUN_ID": "42", "GITHUB_RUN_ATTEMPT": "1", "GITHUB_EVENT_NAME": "push"}.items():
        monkeypatch.setenv(key, value)
    for key in ("GITHUB_REPOSITORY", "GITHUB_WORKFLOW_REF", "GITHUB_EVENT_PATH"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.delenv("GITHUB_SHA", raising=False)  # runner-provided values must not leak in
    plan = tmp_path / "plan.json"
    plan.write_text(json.dumps({"base": BASE, "effective_base": "e" * 40, "changed_files": ["backend/App.java", "misc/blob.bin"],
                                "unmatched_files": ["misc/blob.bin"], "skipped_steps": [{"name": "x", "reason": "y"}],
                                "steps": [{"name": "maven_verify", "cwd": "/runner/w", "command": ["mvn", "-q"]}]}))
    return tmp_path, plan


def assemble(env, monkeypatch, jobs):
    """校验实际受验版本和运行身份，生成验收及技能制品。"""
    tmp, plan = env
    monkeypatch.setenv("CI_NEEDS_JSON", json.dumps(jobs))
    code = ce.main(["assemble", "--plan", str(plan), "--output", str(tmp / "out")])
    acceptance = json.loads((tmp / "out" / "acceptance.json").read_text())
    skill = tmp / "out" / "skill-outcomes.json"
    return code, acceptance, json.loads(skill.read_text()) if skill.exists() else None


@pytest.mark.parametrize("stale", [{"run_id": "41"}, {"run_attempt": "2"}, {"sha": "c" * 40}])
def test_stale_run_or_checkout_proof_fails_and_drops_skill_outcomes(env, monkeypatch, stale):
    """拒收来自其他运行或提交的步骤记录，同时保留有效作业证据。"""
    (env[0] / "out").mkdir()
    (env[0] / "out" / "skill-outcomes.json").write_text("{}")
    jobs = good_needs(backend=need("backend", "maven_verify", **stale))
    code, acceptance, skill = assemble(env, monkeypatch, jobs)
    assert code == 1 and acceptance["ok"] is False and "docs-comments/docs_checks" in skill["steps"]
    assert acceptance["reasons"][0] == f"backend: proof {next(iter(stale))} mismatch"
    assert "backend/maven_verify" not in acceptance["steps"]


def test_missing_plan_fails(env, monkeypatch):
    """计划文件缺失时不生成技能通过证据。"""
    env[1].unlink()
    code, acceptance, skill = assemble(env, monkeypatch, good_needs())
    assert code == 1 and skill is None and acceptance["plan"] is None
    assert acceptance["reasons"] == ["slice plan missing or malformed"]


def test_native_plan_and_failed_or_missing_jobs_keep_valid_outcomes(env, monkeypatch):
    """校验混合文件计划及失败和缺失作业的记录。"""
    bad = {"frontend_gates": {"outcome": "failure", "conclusion": "failure", "counts": {"failed": 1}}}
    jobs = good_needs(frontend=dict(need("frontend", steps=bad, status="failure"), result="failure"))
    del jobs["secrets-scan"]
    code, acceptance, skill = assemble(env, monkeypatch, jobs)
    assert code == 1 and set(acceptance["reasons"]) == {
        "frontend: required job failure", "frontend/frontend_gates: required step did not succeed",
        "frontend/browser_e2e: outcome missing",
        "secrets-scan: proof missing or malformed", "secrets-scan/scan_history: outcome missing"}
    assert acceptance["plan"] == {"base": BASE, "effective_base": "e" * 40, "changed_files": ["backend/App.java", "misc/blob.bin"],
                                  "unmatched_files": ["misc/blob.bin"], "steps": ["maven_verify"],
                                  "skipped_steps": [{"name": "x", "reason": "y"}]}
    assert skill == {"tested_sha": HEAD, "run_id": "42", "run_attempt": "1", "event_name": "push", "steps": {
        "backend/maven_verify": {"outcome": "success", **STAMP},
        "frontend/frontend_gates": {"outcome": "failure", **STAMP},
        "docs-comments/docs_checks": {"outcome": "success", **STAMP},
        "docs-comments/changed_comments": {"outcome": "success", **STAMP},
        "acceptance/slice_plan": {"outcome": "success", **STAMP}}}


def test_valid_pull_request_merge_identity_and_github_sha(env, monkeypatch):
    """校验 PR head、base、受验合并提交以及 GitHub 的 SHA 一致。"""
    pr_head = "d" * 40
    (env[0] / "event.json").write_text(json.dumps({"pull_request": {"number": 7, "base": {"sha": BASE}, "head": {"sha": pr_head}}}))
    for key, value in {"GITHUB_EVENT_NAME": "pull_request", "GITHUB_EVENT_PATH": str(env[0] / "event.json"),
                       "GITHUB_SHA": HEAD, "GITHUB_REPOSITORY": "fixture/example",
                       "GITHUB_WORKFLOW_REF": "fixture/example/.github/workflows/ci.yml@refs/pull/7/merge"}.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(ce, "git", lambda *args: f"{HEAD} {BASE} {pr_head}" if args[0] == "rev-list" else HEAD)
    jobs = good_needs(**{"docs-comments": need("docs-comments", "docs_checks", "changed_comments", "pr_size_guard")})
    code, acceptance, skill = assemble(env, monkeypatch, jobs)
    assert code == 0, acceptance["reasons"]
    assert acceptance["pr_number"] == skill["pr_number"] == 7
    assert acceptance["repository"] == skill["repository"] == "fixture/example"
    assert acceptance["workflow_ref"] == skill["workflow_ref"]
    assert (acceptance["tested_sha"], acceptance["pr_base_sha"], acceptance["pr_head_sha"]) == (HEAD, BASE, pr_head)
    assert set(skill["steps"]) == {*ce.SKILL_IDS, "acceptance/slice_plan"}
    monkeypatch.setenv("GITHUB_SHA", pr_head)
    code, acceptance, skill = assemble(env, monkeypatch, good_needs())
    assert code == 1 and skill is None and acceptance["reasons"][0] == "checkout does not match GITHUB_SHA"


def test_record_counts_reports_and_missing_reason(tmp_path, monkeypatch):
    """校验计数来自真实报告格式，并记录缺失报告原因。"""
    monkeypatch.setattr(ce, "git", lambda *args: HEAD)
    (tmp_path / "TEST-a.xml").write_text('<testsuite><testcase name="ok"/><testcase name="bad"><failure/>'
                                         '</testcase><testcase name="skip"><skipped/></testcase></testsuite>')
    log = tmp_path / "vitest.log"
    log.write_text(" \x1b[2mTests\x1b[22m  \x1b[32m3 passed\x1b[39m\n Test Files  2 passed (2)\n"
                   "      Tests  7 passed | 2 skipped (9)\n")
    out = tmp_path / "github_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    monkeypatch.setenv("CI_STEPS_JSON", json.dumps(
        {"maven_verify": {"outcome": "failure", "conclusion": "failure", "outputs": {"note": "synthetic"}}}))
    assert ce.main(["record", "backend", "--junit", str(tmp_path / "*.xml"), "--vitest-log", str(log),
                    "--playwright", str(tmp_path / "absent.json")]) == 0
    line = out.read_text()
    assert line.startswith("proof=") and line.count("\n") == 1
    steps = json.loads(line[len("proof="):])["steps"]
    assert steps["maven_verify"] == {"outcome": "failure", "conclusion": "failure",
                               "counts": {"passed": 1, "failed": 1, "skipped": 1}}
    assert steps["frontend_gates"]["counts"] == {"passed": 7, "failed": 0, "skipped": 2}
    assert steps["browser_e2e"] == {"outcome": None, "conclusion": None, "reason": "step missing",
                                    "counts": None, "counts_reason": "playwright report missing"}



@pytest.mark.parametrize("patch", [
    {"counts": None},
    {"counts": {}},
    {"counts": {"passed": 0, "failed": 0, "skipped": 3}},
    {"counts": {"passed": 1, "failed": 1}},
    {"counts": {"passed": True}},
    {"outcome": "failure"},
    {"outcome": "skipped"},
    {"conclusion": "skipped"},
    {"conclusion": "cancelled"},
])
def test_required_steps_fail_without_execution_evidence(env, monkeypatch, patch):
    """缺失、空或全跳过的报告与异常步骤都不能生成成功验收。"""
    step = {"outcome": "success", "conclusion": "success", "counts": {"passed": 1, "failed": 0}}
    step.update(patch)
    code, acceptance, _ = assemble(env, monkeypatch, good_needs(
        pytest=need("pytest", steps={"pytest_tests": step})))
    assert code == 1 and acceptance["ok"] is False
    assert any(reason.startswith("pytest/pytest_tests:") or reason.startswith("pytest:") for reason in acceptance["reasons"])


def test_optional_skipped_step_keeps_reason_when_required_steps_run(env, monkeypatch):
    """push 允许跳过 PR 专用步骤，证据仍记录跳过原因。"""
    steps = {sid: {"outcome": "success", "conclusion": "success"}
             for sid in ("docs_checks", "changed_comments")}
    steps["pr_size_guard"] = {"outcome": "skipped", "conclusion": "skipped",
                              "reason": "PR-only step on push"}
    code, acceptance, _ = assemble(env, monkeypatch, good_needs(
        **{"docs-comments": need("docs-comments", steps=steps)}))
    assert code == 0 and acceptance["ok"] is True
    assert acceptance["steps"]["docs-comments/pr_size_guard"] == steps["pr_size_guard"]


@pytest.mark.parametrize("report", [
    "<testsuite/>",
    "<testsuite><testcase name='skipped'><skipped/></testcase></testsuite>",
    "<malformed",
])
def test_junit_without_executed_cases_cannot_pass(env, monkeypatch, report):
    """通过实际报告解析及归集验证零执行或无效报告都使门禁失败。"""
    path = env[0] / "pytest.xml"
    path.write_text(report, encoding="utf-8")
    counts, _ = ce.junit_counts(str(path))
    steps = {"pytest_tests": {"outcome": "success", "conclusion": "success", "counts": counts}}
    code, acceptance, _ = assemble(env, monkeypatch, good_needs(pytest=need("pytest", steps=steps)))
    assert code == 1 and acceptance["ok"] is False
