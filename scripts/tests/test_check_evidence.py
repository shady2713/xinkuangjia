"""验证结构化计数、完整执行集合及工作树证据失效边界。

所有文档和报告写入测试私有目录；不修改真实项目或个人配置。
@author OpenAI Codex
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.common.check_protocol import PROTOCOL
from scripts.common.quality_common import DEFAULT_ROOT, CheckError, ProcessResult
from scripts.workflow import check_evidence, run_checks
from scripts.workflow.run_checks import Gate, Outcome, command_for, execute, parse_result
from scripts.tests.git_sandbox import create_sandbox


def invoke(script: str, root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """在隔离目录调用真实质量 CLI，返回退出码与完整 JSON，不修改用户仓库。"""
    return subprocess.run(
        [sys.executable, "-B", "-X", "utf8", str(DEFAULT_ROOT / "scripts/workflow" / script), "--root", str(root), *args],
        cwd=root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
    )


def write_document(root: Path) -> None:
    """为真实链接检查提供非零对象，中文文件名用于覆盖跨平台编码边界。"""
    root.mkdir()
    (root / "中文 说明.md").write_text("# 有效文档\n\n普通说明。\n", encoding="utf-8")


@pytest.mark.parametrize(
    "body",
    [
        b"check passed",
        b'{}',
        json.dumps({"protocol": PROTOCOL, "check": "test", "checked": True, "findings": [], "status": "passed"}).encode(),
        json.dumps({"protocol": PROTOCOL, "check": "test", "checked": 0, "findings": [], "status": "passed"}).encode(),
    ],
)
def test_protocol_never_accepts_success_text_or_fake_counts(body: bytes) -> None:
    """一句通过、缺失协议、布尔计数和零对象声明成功都不能产生通过状态。"""
    with pytest.raises(CheckError):
        parse_result(Gate("test", "unused", "test"), 0, body)


def test_zero_count_requires_registered_reason() -> None:
    """预期存在对象的门禁拒绝零范围，合法 N/A 必须带登记理由。"""
    body = json.dumps({"protocol": PROTOCOL, "check": "test", "checked": 0, "findings": [], "status": "not-applicable"}).encode()
    assert parse_result(Gate("test", "unused", "test"), 0, body)[0] == "environment-error"
    result = parse_result(Gate("test", "unused", "test", zero_reason="没有此类对象"), 0, body)
    assert result[:3] == ("not-applicable", 0, "没有此类对象")


def test_actual_timeout_and_missing_interpreter_are_distinct(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """真实超时完成进程回收，缺解释器则报告环境错误；两者均不声称已检查对象。"""
    slow = tmp_path / "slow.py"
    slow.write_text("import time\ntime.sleep(30)\n", encoding="utf-8")
    result = execute(Gate("slow", str(slow), "test", root_argument=False), tmp_path, 0.2)
    assert result.status == "timeout" and result.code == 2 and result.checked is None
    assert result.attempted and result.process_code is None
    monkeypatch.setattr(run_checks.sys, "executable", str(tmp_path / "missing-interpreter"))
    result = execute(Gate("missing", str(slow), "test", root_argument=False), tmp_path, 5)
    assert result.status == "environment-error" and result.code == 2 and result.checked is None
    assert result.attempted and result.process_code is None


@pytest.mark.parametrize("change", ["content", "new-file", "deleted-file", "rule"])
def test_real_report_verifies_then_invalidates_on_input_change(tmp_path: Path, change: str) -> None:
    """真实报告可复核，未提交文件内容、清单或规则改变后旧证据失效。"""
    root = tmp_path / "项目"
    write_document(root)
    report = tmp_path / "报告.json"
    run = invoke("run_checks.py", root, "--checks", "md-links", "--report", str(report), "--json")
    assert run.returncode == 0, run.stdout + run.stderr
    initial = invoke("verify_report.py", root, str(report), "--json")
    assert initial.returncode == 0, initial.stdout + initial.stderr
    if change == "content":
        (root / "中文 说明.md").write_text("# 修改后的文档\n", encoding="utf-8")
    elif change == "new-file":
        (root / "新文档.md").write_text("# 新增\n", encoding="utf-8")
    elif change == "deleted-file":
        (root / "中文 说明.md").unlink()
    else:
        rule = root / "scripts/tools/document_rules.py"
        rule.parent.mkdir(parents=True)
        rule.write_text("RULES = {}\n", encoding="utf-8")
    current = invoke("verify_report.py", root, str(report), "--json")
    assert current.returncode == 1, current.stdout + current.stderr
    assert "current-inputs-differ" in json.loads(current.stdout)["reasons"]


@pytest.mark.parametrize("checks", [["md-links"], ["note-format"]])
def test_real_empty_scope_never_reports_overall_pass(tmp_path: Path, checks: list[str]) -> None:
    """空扫描与框架无笔记分别报告环境错误和 N/A，全组均不能输出通过。"""
    result = invoke("run_checks.py", tmp_path, "--checks", *checks, "--json")
    value = json.loads(result.stdout)
    if checks == ["md-links"]:
        assert result.returncode == 2 and value["results"][0]["status"] == "environment-error"
    else:
        assert result.returncode == 1 and value["status"] == "not-verified"
        assert {item["status"] for item in value["results"]} == {"not-applicable"}
        assert all(item["reason"] and item["checked"] == 0 for item in value["results"])
    assert value["status"] != "passed"


def test_inflight_change_invalidates_successful_checks(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """即使子检查返回非零对象成功，执行期间输入变化也不得签发有效成功。"""
    root = tmp_path / "inputs"
    write_document(root)
    tools = tmp_path / "tools"
    tools.mkdir()
    monkeypatch.setattr(run_checks, "DEFAULT_ROOT", tools)
    gate = Gate("md-links", "docs/verify_md_links.py", "docs")

    def changed_schedule(
        gates: list[Gate], folder: Path, jobs: int, timeout: float, **options: object
    ) -> list[Outcome]:
        """模拟检查完成前的并发编辑，保留一条表面成功结果供证据层拒绝。"""
        (folder / "中文 说明.md").write_text("# 并发修改\n", encoding="utf-8")
        return [Outcome(gate.name, "passed", 0, 0, "", checked=1, command=tuple(command_for(gate, folder)), cwd=str(folder))]

    monkeypatch.setattr(run_checks, "schedule", changed_schedule)
    report, outcomes = run_checks.run_with_evidence([gate], root, 1, 30)
    assert outcomes[0].status == "passed"
    assert report["code"] == 2 and report["status"] == "invalid-evidence"
    assert report["evidence_error"] == "inputs-changed-during-checks"


@pytest.mark.parametrize("tamper", ["missing-step", "zero-pass", "command", "invalid-status"])
def test_incomplete_or_inconsistent_execution_manifest_is_rejected(tmp_path: Path, tamper: str) -> None:
    """相同输入不能挽救缺失步骤、零对象成功或与实际注册入口不同的命令。"""
    root = tmp_path / "inputs"
    write_document(root)
    report = tmp_path / "evidence.json"
    result = invoke("run_checks.py", root, "--checks", "md-links", "--report", str(report), "--json")
    assert result.returncode == 0, result.stdout + result.stderr
    value = json.loads(report.read_text(encoding="utf-8"))
    if tamper == "missing-step":
        value["results"] = []
    elif tamper == "zero-pass":
        value["results"][0]["checked"] = 0
    elif tamper == "command":
        value["results"][0]["command"] = ["unexecuted-command"]
    else:
        value["results"][0]["status"] = []
    report.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    verified = invoke("verify_report.py", root, str(report), "--json")
    assert verified.returncode == 1, verified.stdout + verified.stderr
    assert json.loads(verified.stdout)["status"] == "invalid"


def test_report_contains_digests_without_source_or_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """证据保存路径和摘要，但不收集源码正文或继承环境中的凭据值。"""
    root = tmp_path / "inputs"
    write_document(root)
    sample = "unit-" + "a" * 16
    (root / "fixture.txt").write_text(sample, encoding="utf-8")
    monkeypatch.setenv("QUALITY_EVIDENCE_TEST_VALUE", sample)
    report = tmp_path / "evidence.json"
    result = invoke("run_checks.py", root, "--checks", "md-links", "--report", str(report), "--json")
    assert result.returncode == 0, result.stdout + result.stderr
    source = report.read_text(encoding="utf-8")
    assert sample not in source and "QUALITY_EVIDENCE_TEST_VALUE" not in source
    value = json.loads(source)
    assert value["before"]["inputs"]["project"]["files"]["fixture.txt"]["sha256"]
    assert "output" not in value["results"][0]
    assert value["results"][0]["output_sha256"]


def test_report_cannot_overwrite_check_inputs(tmp_path: Path) -> None:
    """显式输出位置位于输入目录时拒绝，避免报告写入制造自失效或覆盖源码。"""
    root = tmp_path / "inputs"
    write_document(root)
    report = root / "report.json"
    with pytest.raises(CheckError, match="保存到"):
        check_evidence.validate_destination(report, root, DEFAULT_ROOT)
    assert not report.exists()


def test_git_index_and_runtime_options_are_bound_without_secret_values(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """工作树不变时仅暂存内容或 Node 解释选项变化，也会改变证据输入摘要。"""
    sandbox = create_sandbox(tmp_path / "repository")
    (sandbox.root / "document.md").write_text("# Working tree\n", encoding="utf-8")
    for key, value in sandbox.env.items():
        if key.startswith("GIT_"):
            monkeypatch.setenv(key, value)
    before = check_evidence.project_snapshot(sandbox.root)
    sandbox.stage("document.md", "# Different staged content\n")
    after = check_evidence.project_snapshot(sandbox.root)
    assert before["files"] == after["files"]
    assert before["git"] != after["git"]
    original = check_evidence.environment_snapshot()
    option = "--stack-trace-limit=19"
    monkeypatch.setenv("NODE_OPTIONS", option)
    changed = check_evidence.environment_snapshot()
    assert changed != original and option not in json.dumps(changed)


def test_failed_dependency_is_saved_as_not_run(tmp_path: Path) -> None:
    """真实分类失败时格式检查保留未运行状态，不能从计划列表推断已经执行。"""
    root = tmp_path / "inputs"
    write_document(root)
    note = root / ".agents/notes/invalid.md"
    note.parent.mkdir(parents=True)
    note.write_text("# Invalid placement\n", encoding="utf-8")
    report = tmp_path / "evidence.json"
    result = invoke("run_checks.py", root, "--checks", "note-format", "--report", str(report), "--json")
    assert result.returncode == 1, result.stdout + result.stderr
    value = json.loads(report.read_text(encoding="utf-8"))
    assert [item["status"] for item in value["results"]] == ["failed", "not-run"]
    assert value["results"][1]["checked"] is None
    assert value["results"][1]["attempted"] is False
    assert value["results"][1]["process_code"] is None


def test_rule_source_and_runtime_versions_affect_evidence(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """业务目录不变时，实际规则源码或运行时版本变化仍使证据指纹变化。"""
    root = tmp_path / "inputs"
    write_document(root)
    tools = tmp_path / "tools"
    rule = tools / "scripts/tools/rules.py"
    rule.parent.mkdir(parents=True)
    rule.write_text("RULE = 1\n", encoding="utf-8")
    monkeypatch.setattr(check_evidence, "runtime_versions", lambda root: {"python": "first"})
    before = check_evidence.snapshot(root, tools)
    rule.write_text("RULE = 2\n", encoding="utf-8")
    changed_rule = check_evidence.snapshot(root, tools)
    assert before["digest"] != changed_rule["digest"]
    assert before["inputs"]["project"] == changed_rule["inputs"]["project"]
    monkeypatch.setattr(check_evidence, "runtime_versions", lambda root: {"python": "second"})
    changed_runtime = check_evidence.snapshot(root, tools)
    assert changed_rule["digest"] != changed_runtime["digest"]


@pytest.mark.parametrize(
    ("check", "path", "source"),
    [
        ("note-classification", ".agents/notes/implemented/testing/2026-10-02-scope.md", "# 活动记录\n"),
        ("mermaid", "diagram.md", "```mermaid\nflowchart LR\n A --> B\n```\n"),
        ("java-comments", "后端代码/basic-framework-boot/module/src/main/java/Demo.java", "class Demo {}\n"),
        ("python-comments", "src/service.py", "def run(): pass\n"),
        ("web-comments", "src/service.ts", "function run() {}\n"),
    ],
)
def test_zero_self_report_cannot_hide_real_objects(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, check: str, path: str, source: str) -> None:
    """真实对象存在时伪造零计数被独立范围清单拒绝，预置 N/A 理由不能成为绕过。"""
    sandbox = create_sandbox(tmp_path / "repository")
    target = sandbox.root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(source, encoding="utf-8")
    body = json.dumps({"protocol": PROTOCOL, "check": check, "checked": 0, "findings": [], "status": "not-applicable"}).encode()
    monkeypatch.setattr(run_checks, "run_process", lambda *args, **kwargs: ProcessResult(0, body, b""))
    gate = next(gate for gate in run_checks.GATES if gate.name == check)
    outcome = execute(gate, sandbox.root, 30)
    assert outcome.status == "environment-error" and outcome.checked == 0
    assert "仍存在适用对象" in outcome.reason


def test_scope_read_failure_is_preserved_as_environment_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """独立范围核对遇到并发删除时仍产生结构化失败，不能丢失其余执行结果。"""
    body = json.dumps({"protocol": PROTOCOL, "check": "notes", "checked": 0, "findings": [], "status": "not-applicable"}).encode()
    monkeypatch.setattr(run_checks, "run_process", lambda *args, **kwargs: ProcessResult(0, body, b""))

    def missing(gate: Gate, root: Path) -> bool:
        """模拟枚举后读取前文件被其他操作删除。"""
        raise FileNotFoundError("disappeared")

    monkeypatch.setattr(run_checks, "zero_scope_confirmed", missing)
    gate = next(gate for gate in run_checks.GATES if gate.name == "note-classification")
    outcome = execute(gate, tmp_path, 30)
    assert outcome.status == "environment-error" and outcome.process_code == 0
