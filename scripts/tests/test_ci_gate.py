"""验证 CI 证据核对：正常聚合、受控反例失败、报告真伪、发布证据与输出脱敏。

反例重点覆盖上游 $GITHUB_OUTPUT 产生的非字典 outputs 和只改阶段标签的发布结论：
前者曾抛出未捕获的 AttributeError，后者曾在没有任何发布证据时返回 release_verified。

@author OpenAI Codex
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
from fnmatch import fnmatchcase
from pathlib import Path
from xml.etree import ElementTree as ET

import pytest

from scripts.workflow import ci_gate as gate

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "workflow" / "ci_gate.py"
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"
STAGES = ("functional", "audit", "release")
REVISION = "0123456789abcdef0123456789abcdef01234567"
EVIDENCE_FILES = ("coverage-backend.json", "coverage-web.json", "release-backend.json", "release-frontend.json")


def needs(stage: str = "audit", result: str = "success", **outputs: object) -> dict[str, object]:
    """构造固定必需作业的 needs 上下文；额外关键字参数按作业名覆盖 outputs。"""
    context: dict[str, object] = {}
    for name in sorted(gate.JOBS):
        context[name] = {"result": result, "outputs": {"stage": stage, "checked": "4"}}
    for name, value in outputs.items():
        context[name] = {"result": result, "outputs": value}
    return context


def release_needs(counts: dict[str, int] | None = None, stage: str = "release") -> dict[str, object]:
    """构造发布阶段的 needs 上下文，逐作业用例数与发布证据声明的计数对应。"""
    values = {"backend": 5, "browser_e2e": 2, "docs_tools": 7, "frontend": 6, **(counts or {})}
    return {name: {"result": "success", "outputs": {"stage": stage, "checked": str(value)}}
            for name, value in values.items()}


def suite(cases: list[tuple[str, str, str]], tests: int | None = None,
          skipped: int = 0, failures: int = 0) -> ET.Element:
    """写一个结构合法的 testsuite；汇总值默认与真实用例数一致。"""
    element = ET.Element("testsuite", name="demo", tests=str(len(cases) if tests is None else tests),
                         failures=str(failures), errors="0", skipped=str(skipped))
    for classname, name, _ in cases:
        ET.SubElement(element, "testcase", classname=classname, name=name)
    return element


def write(path: Path, element: ET.Element) -> Path:
    """把构造好的报告根节点写成文件。"""
    path.write_bytes(ET.tostring(element))
    return path


def digest(seed: object) -> str:
    """生成稳定的内容指纹文本，用于代替真实报告的 sha256 字段。"""
    return hashlib.sha256(str(seed).encode("utf-8")).hexdigest()


def coverage_document(kind: str, measured: int = 3) -> dict[str, object]:
    """构造发布阶段覆盖率裁决夹具，结构与 coverage_gate.py 的真实 JSON 输出一致。"""
    document: dict[str, object] = {
        "schema": "coverage-gate/v1", "kind": kind, "stage": "release", "status": "passed", "code": 0,
        "measured_files": measured, "failed_files": 0, "problems": [],
        "thresholds": {"per_file": True, "lines": 100, "methods_or_functions": 100},
        "validates_test_execution": False,
        "files": [{"path": f"src/file{index}.source", "sha256": digest(index), "status": "passed"}
                  for index in range(measured)],
        "inventory": [{"path": f"src/file{index}.source", "sha256": digest(f"inv{index}")}
                      for index in range(measured)],
        "reports": [{"path": "coverage/report.json", "sha256": digest("report")}],
    }
    return document


def manifest(job: str, cases: int, coverage_file: str, kind: str, measured: int,
             **overrides: object) -> dict[str, object]:
    """构造某作业的发布证据清单，检查名与 ci_gate.RELEASE_CHECKS 的必需集合一致。"""
    checks = {
        "backend": [
            {"name": "backend-tests-and-integration", "status": "passed", "checked": cases,
             "command": "mvn -B -ntp -Pquality-audit -Dtest=<全部单测与集成测试命名> verify"},
            {"name": "backend-release-coverage", "status": "passed", "checked": measured,
             "command": "coverage_gate.py --kind backend --stage release --require-prepared"},
        ],
        "frontend": [
            {"name": "frontend-unit-tests", "status": "passed", "checked": cases,
             "command": "pnpm test:coverage -- --reporter=json"},
            {"name": "frontend-release-coverage", "status": "passed", "checked": measured,
             "command": "coverage_gate.py --kind web --stage release"},
            {"name": "frontend-typecheck", "status": "passed", "checked": None, "command": "pnpm check:type"},
            {"name": "frontend-production-build", "status": "passed", "checked": None, "command": "pnpm build:ele"},
            {"name": "frontend-production-scan", "status": "passed", "checked": None,
             "command": "pnpm quality:prod-scan"},
        ],
    }[job]
    document: dict[str, object] = {
        "schema": "ci-release-evidence/v1", "job": job, "stage": "release", "revision": REVISION,
        "checks": checks,
        "coverage": {"kind": kind, "evidence": coverage_file, "stage": "release",
                     "measured_files": measured, "failed_files": 0},
    }
    document.update(overrides)
    return document


def evidence_directory(tmp_path: Path, *, cases: dict[str, int] | None = None,
                       backend_coverage: dict[str, object] | None = None,
                       web_coverage: dict[str, object] | None = None,
                       backend_manifest: dict[str, object] | None = None,
                       frontend_manifest: dict[str, object] | None = None) -> Path:
    """把两份覆盖率裁决与两份作业证据写入独立目录；覆盖项用于构造受控反例。"""
    counts = {"backend": 5, "frontend": 6, **(cases or {})}
    directory = tmp_path / "release-evidence"
    directory.mkdir(parents=True, exist_ok=True)
    documents = {
        "coverage-backend.json": coverage_document("backend", 3) if backend_coverage is None else backend_coverage,
        "coverage-web.json": coverage_document("web", 4) if web_coverage is None else web_coverage,
        "release-backend.json": manifest("backend", counts["backend"], "coverage-backend.json", "backend", 3)
        if backend_manifest is None else backend_manifest,
        "release-frontend.json": manifest("frontend", counts["frontend"], "coverage-web.json", "web", 4)
        if frontend_manifest is None else frontend_manifest,
    }
    for name, document in documents.items():
        (directory / name).write_text(json.dumps(document, ensure_ascii=False) + "\n", encoding="utf-8")
    return directory


def job_section(name: str) -> str:
    """按两空格作业缩进取回单个作业的 YAML 文本块，用于核对真实编排。"""
    text = WORKFLOW.read_text(encoding="utf-8")
    match = re.search(rf"^  {name}:\n(.*?)(?=^  \w+:\n|\Z)", text, re.MULTILINE | re.DOTALL)
    assert match, f"工作流缺少作业：{name}"
    return match.group(1)


def step_named(job: str, name: str) -> str:
    """按完整步骤名取回单步文本块；步骤名必须唯一，避免前缀或重复造成误判。"""
    parts = re.split(r"\n      - ", job_section(job))
    matches = [part for part in parts
               if part.startswith(f"name: {name}\n") or f"\n        name: {name}\n" in part]
    assert len(matches) == 1, f"{job} 中必须恰好有一个步骤名为：{name}"
    return matches[0]


class TestBackendWorkflow:
    """核对真实 backend 命令的测试选择，防止报告门禁之外漏跑集成或普通单测。"""

    def selections(self) -> list[list[str]]:
        """逐条 Maven 命令提取 Surefire 选择模式，任何一条都不允许漏掉真实测试类。"""
        commands = [shlex.split(line.strip()[5:]) for line in job_section("backend").splitlines()
                    if line.strip().startswith("run: mvn ")]
        assert commands, "backend 必须有可核对的 Maven 测试命令"
        selections: list[list[str]] = []
        for command in commands:
            assert command[-1] in {"test", "verify"}, "backend 命令必须实际执行测试阶段"
            selection = next((item.removeprefix("-Dtest=") for item in command if item.startswith("-Dtest=")),
                             "Test*,*Test,*Tests,*TestCase")
            selections.append(selection.split(","))
        return selections

    def test_every_integration_class_is_selected(self) -> None:
        """所有现存 *IT 必须被每一条真实命令选中，新增集成类也不能被默认 Surefire 范围漏掉。"""
        classes = sorted(path.stem for path in (ROOT / "后端代码" / "basic-framework-boot").glob("**/src/test/java/**/*IT.java"))
        assert classes, "集成测试来源为空，无法证明执行范围"
        for patterns in self.selections():
            missing = [name for name in classes if not any(fnmatchcase(name, pattern) for pattern in patterns)]
            assert not missing, f"backend 漏选集成测试：{missing}"

    @pytest.mark.parametrize("classname", ["TestLegacy", "LegacyTest", "LegacyTests", "LegacyTestCase"])
    def test_default_unit_test_names_remain_selected(self, classname: str) -> None:
        """加入 *IT 后仍须保留 Surefire 默认四种单测命名，不能以专项替换普通回归。"""
        for patterns in self.selections():
            assert any(fnmatchcase(classname, pattern) for pattern in patterns)

    def test_every_stage_runs_a_real_test_command(self) -> None:
        """functional/audit 与 release 都必须真实执行 Maven 测试，不能只更换阶段标签。"""
        normal = step_named("backend", "运行后端测试")
        release = step_named("backend", "运行后端测试并采集覆盖率（发布阶段）")
        assert "inputs.stage != 'release'" in normal
        assert "inputs.stage == 'release'" in release
        # 发布阶段必须采集覆盖率证据，而不是复用不产出 JaCoCo 数据的普通测试。
        assert "-Pquality-audit" in release and release.rstrip().endswith("verify")


class TestBrowserE2EWorkflow:
    """核对浏览器业务端到端作业：必需作业、无跳过分支、真实用例计数与容器清理。"""

    def test_required_job_is_wired_into_gate(self) -> None:
        """browser_e2e 必须是必需作业，并出现在汇总作业的 needs 中。"""
        assert "browser_e2e" in gate.JOBS
        section = job_section("browser_e2e")
        assert "stage: ${{ steps.count.outputs.stage }}" in section
        assert "checked: ${{ steps.count.outputs.checked }}" in section
        assert "\n      - browser_e2e\n" in job_section("gate")

    def test_job_runs_real_environment_without_skip(self) -> None:
        """作业必须真实启动依赖、安装浏览器并执行环境脚本，且没有任何跳过或忽略条件。"""
        section = job_section("browser_e2e")
        for forbidden in ("if: false", "continue-on-error", "test.skip"):
            assert forbidden not in section, f"浏览器业务作业不得包含 {forbidden}"
        assert "scripts/e2e/run_business_e2e.py --summary" in section
        assert "ci_services.py start" in section
        assert "playwright install --with-deps chromium" in section
        # 缺少镜像来源与缺少浏览器都必须失败，不能降级或跳过。
        assert "BF_CI_IMAGE_MINIO" in section and "未配置 BF_CI_IMAGE_MINIO" in section
        assert "--results" in section
        # 失败痕迹只在失败时上传，且缺失痕迹不阻断结论本身。
        upload = step_named("browser_e2e", "上传失败痕迹")
        assert "if: failure()" in upload and "if-no-files-found: ignore" in upload
        stop = step_named("browser_e2e", "停止真实服务")
        assert "if: always()" in stop

    def test_count_step_requires_real_cases(self) -> None:
        """用例数只能来自真实摘要：零用例、失败、跳过与重试通过都必须失败。"""
        section = job_section("browser_e2e")
        assert section.count('os.environ.get("GITHUB_OUTPUT")') == 1
        assert "缺少 GITHUB_OUTPUT" in section
        for key in ("total", "failed", "skipped", "flaky"):
            assert f'summary.get("{key}", 0)' in section, f"汇总缺少 {key} 核对"
        # 计数与阶段必须写进 runner 注入的输出文件，且阶段取自本次输入。
        assert 'with open(output, "a", encoding="utf-8") as stream:' in section
        assert 'stream.write(f"checked={total}\\n")' in section
        assert 'stage={os.environ[\'STAGE\']}' in section


class TestAggregate:
    """固定作业必须真实成功、有正整数计数且阶段一致才允许通过。"""

    def test_normal_aggregation_reports_counts(self) -> None:
        """全部必需作业成功时返回阶段、状态与逐作业用例数，非发布阶段不带发布证据。"""
        result = gate.aggregate(needs(), "audit")
        assert result == {"schema": "ci-summary/v1", "stage": "audit", "status": "passed",
                          "tests": {"backend": 4, "browser_e2e": 4, "docs_tools": 4, "frontend": 4},
                          "release_verified": False, "release_evidence": None}

    @pytest.mark.parametrize("stage", STAGES)
    def test_release_flag_only_for_verified_release(self, stage: str, tmp_path: Path) -> None:
        """反例：阶段标签本身不构成发布证据；只有真实证据齐备的 release 才标记已验证。"""
        if stage != "release":
            assert gate.aggregate(needs(stage), stage)["release_verified"] is False
            return
        with pytest.raises(ValueError):
            gate.aggregate(release_needs(), "release")
        directory = evidence_directory(tmp_path)
        result = gate.aggregate(release_needs(), "release", directory, REVISION)
        assert result["release_verified"] is True
        assert result["release_evidence"]["revision"] == REVISION

    @pytest.mark.parametrize("broken", [
        ["not", "a", "dict"], "checked=4", 7, None, True,
    ])
    def test_non_dict_outputs_fail_controlled(self, broken: object) -> None:
        """反例：outputs 非字典必须抛 ValueError，而不是未捕获的 AttributeError。"""
        with pytest.raises(ValueError) as failure:
            gate.aggregate(needs(backend=broken), "audit")
        assert "backend" in str(failure.value)
        assert "AttributeError" not in type(failure.value).__name__

    def test_non_dict_outputs_for_every_job(self) -> None:
        """任一作业的 outputs 退化为非字典都不能通过聚合。"""
        for name in sorted(gate.JOBS):
            with pytest.raises(ValueError):
                gate.aggregate(needs(**{name: []}), "audit")

    @pytest.mark.parametrize("result", ["skipped", "cancelled", "failure", "success"])
    def test_non_success_job_rejected(self, result: str) -> None:
        """skipped/cancelled/failure 一律不算通过；只有 success 可以。"""
        if result == "success":
            assert gate.aggregate(needs(result=result), "audit")["status"] == "passed"
            return
        with pytest.raises(ValueError):
            gate.aggregate(needs(result=result), "audit")

    @pytest.mark.parametrize("count", ["0", "00", "-1", "1.0", "", "abc", " 4", None, 4])
    def test_count_must_be_positive_integer_text(self, count: object) -> None:
        """零计数与非正整数文本都不构成真实执行证据。"""
        with pytest.raises(ValueError):
            gate.aggregate(needs(backend={"stage": "audit", "checked": count}), "audit")

    def test_stage_cannot_cross_substitute(self) -> None:
        """反例：审计阶段的输出不能冒充发布阶段。"""
        with pytest.raises(ValueError):
            gate.aggregate(needs("functional"), "release")

    @pytest.mark.parametrize("mutate", [
        lambda c: c.pop("backend"),
        lambda c: c.update(extra={"result": "success"}),
        lambda c: {**c, "backend": []},
    ])
    def test_job_set_must_match_exactly(self, mutate: object) -> None:
        """缺作业、多作业或作业值不是对象都要失败。"""
        with pytest.raises(ValueError):
            gate.aggregate(mutate(needs()), "audit")

    @pytest.mark.parametrize("needs_value", [None, [], "text", 3])
    def test_non_dict_needs_rejected(self, needs_value: object) -> None:
        """非字典 needs 在遍历前就被拒绝。"""
        with pytest.raises(ValueError):
            gate.aggregate(needs_value, "audit")  # type: ignore[arg-type]

    def test_invalid_stage_rejected(self) -> None:
        """阶段只接受固定三个值。"""
        with pytest.raises(ValueError):
            gate.aggregate(needs(), "pre-release")  # type: ignore[arg-type]


class TestReleaseEvidence:
    """发布结论必须引用真实发布的覆盖率裁决与作业检查证据，缺一即拒绝。"""

    def test_complete_evidence_accepted(self, tmp_path: Path) -> None:
        """正例：两个作业的覆盖率裁决与检查清单齐备且计数一致时才给出发布结论。"""
        directory = evidence_directory(tmp_path)
        summary = gate.release_evidence(directory, {"backend": 5, "docs_tools": 7, "frontend": 6}, REVISION)
        assert summary["revision"] == REVISION
        assert set(summary["jobs"]) == set(gate.RELEASE_JOBS)
        assert summary["jobs"]["backend"]["measured_files"] == 3

    @pytest.mark.parametrize("value", [None, "release-evidence"])
    def test_directory_missing_rejected(self, tmp_path: Path, value: object) -> None:
        """反例：没有证据目录、或只给了字符串路径都不能通过。"""
        with pytest.raises(ValueError):
            gate.release_evidence(value, {"backend": 5, "docs_tools": 7, "frontend": 6}, REVISION)  # type: ignore[arg-type]

    def test_missing_evidence_file_rejected(self, tmp_path: Path) -> None:
        """反例：发布证据目录里少任何一份真实文件都必须拒绝。"""
        for name in EVIDENCE_FILES:
            directory = evidence_directory(tmp_path / name)
            (directory / name).unlink()
            with pytest.raises(ValueError) as failure:
                gate.release_evidence(directory, {"backend": 5, "docs_tools": 7, "frontend": 6}, REVISION)
            assert name in str(failure.value)

    @pytest.mark.parametrize("content", ["not json", "[1, 2]", "\"text\""])
    def test_unreadable_evidence_rejected(self, tmp_path: Path, content: str) -> None:
        """反例：证据不是 JSON 对象时受控失败，不依赖调用方解析。"""
        directory = evidence_directory(tmp_path)
        (directory / "coverage-web.json").write_text(content, encoding="utf-8")
        with pytest.raises(ValueError):
            gate.release_evidence(directory, {"backend": 5, "docs_tools": 7, "frontend": 6}, REVISION)

    @pytest.mark.parametrize("overrides", [
        {"stage": "audit"},
        {"kind": "web"},
        {"status": "audit-findings"},
        {"code": 1},
        {"status": "failed"},
        {"measured_files": 0},
        {"failed_files": 1},
        {"problems": [{"path": "src/a.ts", "rule": "source-missing-from-report"}]},
        {"thresholds": {"per_file": True, "lines": 90, "methods_or_functions": 100}},
        {"validates_test_execution": True},
        {"files": []},
        {"inventory": []},
        {"reports": []},
        {"reports": [{"path": "coverage/report.json", "sha256": "xyz"}]},
        {"files": [{"path": "src/a.ts", "sha256": digest(1), "status": "failed"}]},
        {"measured_files": True},
    ])
    def test_coverage_evidence_must_prove_release_gate(self, tmp_path: Path, overrides: dict[str, object]) -> None:
        """反例：审计结论、零对象、缺口、放宽阈值与伪造指纹都不构成发布证据。"""
        document = coverage_document("backend", 3)
        document.update(overrides)
        directory = evidence_directory(tmp_path, backend_coverage=document)
        with pytest.raises(ValueError):
            gate.release_evidence(directory, {"backend": 5, "docs_tools": 7, "frontend": 6}, REVISION)

    @pytest.mark.parametrize("overrides", [
        {"schema": "ci-release-evidence/v2"},
        {"stage": "audit"},
        {"job": "docs_tools"},
        {"revision": "0123456789abcdef0123456789abcdef0123456"},
        {"revision": None},
        {"checks": []},
        {"checks": "frontend-unit-tests"},
        {"coverage": None},
        {"coverage": {"kind": "backend", "evidence": "coverage-web.json", "stage": "release",
                      "measured_files": 3, "failed_files": 0}},
        {"coverage": {"kind": "web", "evidence": "coverage-backend.json", "stage": "release",
                      "measured_files": 3, "failed_files": 0}},
        {"coverage": {"kind": "backend", "evidence": "coverage-backend.json", "stage": "release",
                      "measured_files": 4, "failed_files": 0}},
        {"coverage": {"kind": "backend", "evidence": "coverage-backend.json", "stage": "release",
                      "measured_files": 3, "failed_files": 1}},
    ])
    def test_manifest_structure_rejected(self, tmp_path: Path, overrides: dict[str, object]) -> None:
        """反例：作业清单的阶段、作业名、提交绑定和覆盖率声明都必须与真实裁决一致。"""
        document = manifest("backend", 5, "coverage-backend.json", "backend", 3)
        document.update(overrides)
        directory = evidence_directory(tmp_path, backend_manifest=document)
        with pytest.raises(ValueError):
            gate.release_evidence(directory, {"backend": 5, "docs_tools": 7, "frontend": 6}, REVISION)

    @pytest.mark.parametrize("mutate", [
        lambda checks: checks.pop(1),
        lambda checks: checks.append(dict(checks[0])),
        lambda checks: checks.__setitem__(0, {**checks[0], "status": "skipped"}),
        lambda checks: checks.__setitem__(0, {**checks[0], "checked": 0}),
        lambda checks: checks.__setitem__(0, {**checks[0], "checked": "6"}),
        lambda checks: checks.__setitem__(0, {**checks[0], "checked": 7}),
        lambda checks: checks.__setitem__(0, {**checks[0], "command": ""}),
        lambda checks: checks.__setitem__(0, {**checks[0], "name": ""}),
        lambda checks: checks.__setitem__(2, {**checks[0]}),
        lambda checks: checks.__setitem__(0, "not-an-object"),
    ])
    def test_check_entries_must_be_real(self, tmp_path: Path, mutate: object) -> None:
        """反例：检查缺失、重复、未通过、零对象或计数与真实结果不符都不算发布证据。"""
        document = manifest("frontend", 6, "coverage-web.json", "web", 4)
        mutate(document["checks"])  # type: ignore[arg-type]
        directory = evidence_directory(tmp_path, frontend_manifest=document)
        with pytest.raises(ValueError):
            gate.release_evidence(directory, {"backend": 5, "docs_tools": 7, "frontend": 6}, REVISION)

    @pytest.mark.parametrize("checked", [12, 0, "3", True])
    def test_count_less_checks_cannot_declare_counts(self, tmp_path: Path, checked: object) -> None:
        """反例：类型检查与生产构建没有机器可读计数，不得编造数字。"""
        document = manifest("frontend", 6, "coverage-web.json", "web", 4)
        document["checks"][2]["checked"] = checked  # type: ignore[index]
        directory = evidence_directory(tmp_path, frontend_manifest=document)
        with pytest.raises(ValueError):
            gate.release_evidence(directory, {"backend": 5, "docs_tools": 7, "frontend": 6}, REVISION)

    @pytest.mark.parametrize("counts", [
        {"backend": 6},
        {"frontend": 7},
    ])
    def test_counts_must_match_job_outputs(self, tmp_path: Path, counts: dict[str, int]) -> None:
        """反例：证据声明的用例数必须与聚合门禁独立核对的作业计数一致。"""
        directory = evidence_directory(tmp_path)
        with pytest.raises(ValueError):
            gate.release_evidence(directory, {"backend": 5, "docs_tools": 7, "frontend": 6, **counts}, REVISION)

    def test_measured_files_must_match_declaration(self, tmp_path: Path) -> None:
        """反例：覆盖率实测文件数必须与检查清单声明一致，不能只改一边。"""
        directory = evidence_directory(tmp_path, web_coverage=coverage_document("web", 9))
        # 覆盖率证据实测 9 个文件，前端清单仍声明 4 个：必须拒绝。
        with pytest.raises(ValueError):
            gate.release_evidence(directory, {"backend": 5, "docs_tools": 7, "frontend": 6}, REVISION)

    @pytest.mark.parametrize("revision", [None, "", "abc", REVISION.upper(), "f" * 39])
    def test_revision_must_be_bound(self, tmp_path: Path, revision: object) -> None:
        """反例：发布结论必须绑定 40 位小写提交标识，缺失或格式不符即拒绝。"""
        directory = evidence_directory(tmp_path)
        with pytest.raises(ValueError):
            gate.release_evidence(directory, {"backend": 5, "docs_tools": 7, "frontend": 6}, revision)  # type: ignore[arg-type]

    def test_revision_mismatch_rejected(self, tmp_path: Path) -> None:
        """反例：证据绑定的是别的提交时不能用于本次发布结论。"""
        directory = evidence_directory(tmp_path)
        with pytest.raises(ValueError):
            gate.release_evidence(directory, {"backend": 5, "docs_tools": 7, "frontend": 6}, "f" * 40)


class TestReports:
    """JUnit 报告必须与声明计数一致，且包含必需的真实集成测试类。"""

    def test_valid_report_accepted(self, tmp_path: Path) -> None:
        """四个必需类都真实执行时返回实际用例数，机器专项也是必需证据。"""
        cases = [(f"demo.{name}", f"test{name}", "") for name in
                 ("AuthenticationSessionMySqlIT", "PermissionObjectMySqlIT", "FileUploadMySqlS3IT",
                  "OAuth2MachinePrincipalHttpMySqlIT")]
        path = write(tmp_path / "TEST-demo.xml", suite(cases))
        result = gate.reports([path], gate.BACKEND_REQUIRED)
        assert result["checked"] == 4
        assert result["status"] == "passed"

    def test_missing_required_class_rejected(self, tmp_path: Path) -> None:
        """反例：缺少必需集成测试类即视为覆盖不足，不得通过。"""
        path = write(tmp_path / "TEST-demo.xml", suite([("demo.PermissionObjectMySqlIT", "testA", "")]))
        with pytest.raises(ValueError):
            gate.reports([path], gate.BACKEND_REQUIRED)

    @pytest.mark.parametrize("failing", ["failure", "error", "skipped"])
    def test_case_with_problem_child_rejected(self, tmp_path: Path, failing: str) -> None:
        """反例：任何失败、错误或跳过标记都必须阻断。"""
        element = suite([("demo.PermissionObjectMySqlIT", "testA", "")])
        ET.SubElement(element.findall("testcase")[0], failing, message="boom")
        with pytest.raises(ValueError):
            gate.reports([write(tmp_path / "TEST-demo.xml", element)], {"PermissionObjectMySqlIT"})

    def test_zero_case_report_rejected(self, tmp_path: Path) -> None:
        """反例：空报告不算通过。"""
        element = ET.Element("testsuite", name="demo", tests="0", failures="0", errors="0", skipped="0")
        with pytest.raises(ValueError):
            gate.reports([write(tmp_path / "TEST-demo.xml", element)], {"PermissionObjectMySqlIT"})

    @pytest.mark.parametrize("declared", ["3", "0", "x", ""])
    def test_declared_count_must_match(self, tmp_path: Path, declared: str) -> None:
        """反例：声明计数与真实用例不符即失败。"""
        element = suite([("demo.PermissionObjectMySqlIT", "testA", "")], tests=int(declared) if declared.isdigit() else None)
        element.set("tests", declared)
        with pytest.raises(ValueError):
            gate.reports([write(tmp_path / "TEST-demo.xml", element)], {"PermissionObjectMySqlIT"})

    def test_skipped_summary_count_rejected(self, tmp_path: Path) -> None:
        """反例：汇总里出现跳过计数即失败。"""
        element = suite([("demo.PermissionObjectMySqlIT", "testA", "")], skipped=1)
        with pytest.raises(ValueError):
            gate.reports([write(tmp_path / "TEST-demo.xml", element)], {"PermissionObjectMySqlIT"})

    def test_duplicate_case_rejected(self, tmp_path: Path) -> None:
        """反例：同名用例重复出现说明报告被拼接或覆盖。"""
        element = suite([("demo.PermissionObjectMySqlIT", "testA", ""),
                         ("demo.PermissionObjectMySqlIT", "testA", "")])
        with pytest.raises(ValueError):
            gate.reports([write(tmp_path / "TEST-demo.xml", element)], {"PermissionObjectMySqlIT"})

    def test_malformed_xml_rejected(self, tmp_path: Path) -> None:
        """反例：非 XML 报告立即失败。"""
        path = tmp_path / "TEST-demo.xml"
        path.write_bytes(b"<testsuite>")
        with pytest.raises(ValueError):
            gate.reports([path], {"PermissionObjectMySqlIT"})

    def test_empty_and_duplicate_paths_rejected(self, tmp_path: Path) -> None:
        """空报告列表或重复路径都不接受。"""
        with pytest.raises(ValueError):
            gate.reports([], set())
        path = write(tmp_path / "TEST-demo.xml", suite([("demo.A", "testA", "")]))
        with pytest.raises(ValueError):
            gate.reports([path, path], set())


class TestWorkflowWiring:
    """核对真实编排：输出文件、backend 阶段绑定与各阶段实际执行的检查。"""

    def test_no_nonexistent_github_output_context(self) -> None:
        """反例：不存在的 ${{ github.output }} 会解析为空文件名，必须改用 GITHUB_OUTPUT。"""
        text = WORKFLOW.read_text(encoding="utf-8")
        assert not re.search(r"github\.output\b", text), "不得使用不存在的 github.output context"
        assert not re.search(r"\bOUTPUT:\s*\$\{\{", text), "输出文件不得绑定到任意 context"
        assert "GITHUB_OUTPUT" in text

    @pytest.mark.parametrize("job", ["docs_tools", "frontend"])
    def test_count_steps_require_github_output(self, job: str) -> None:
        """汇总步骤必须从 GITHUB_OUTPUT 取文件，并在变量缺失时如实失败。"""
        section = job_section(job)
        assert section.count('os.environ.get("GITHUB_OUTPUT")') == 1
        assert "缺少 GITHUB_OUTPUT" in section
        assert '>> "$GITHUB_OUTPUT"' in section

    def test_backend_outputs_bind_to_the_step_that_writes_them(self) -> None:
        """反例：backend 没有 steps.stage，阶段输出必须取自 reports 步骤。"""
        section = job_section("backend")
        assert "stage: ${{ steps.reports.outputs.stage }}" in section
        assert "checked: ${{ steps.reports.outputs.checked }}" in section
        assert "steps.stage." not in section
        reports = step_named("backend", "校验真实集成测试证据")
        assert "id: reports" in reports
        assert 'stage=%s' in reports and '>> "$GITHUB_OUTPUT"' in reports

    def test_release_wires_real_coverage_and_frontend_checks(self) -> None:
        """release 必须接上覆盖率裁决与完整前端验证，且都只在发布阶段执行。"""
        backend = job_section("backend")
        frontend = job_section("frontend")
        backend_coverage = step_named("backend", "发布阶段后端覆盖率裁决")
        web_coverage = step_named("frontend", "发布阶段前端覆盖率裁决")
        assert "coverage_gate.py --kind backend --stage release --require-prepared" in backend_coverage
        assert "coverage_gate.py --kind web --stage release" in web_coverage
        for name in ("类型检查（发布阶段）", "生产构建（发布阶段）", "生产产物配置扫描（发布阶段）"):
            step = step_named("frontend", name)
            assert "inputs.stage == 'release'" in step
        assert "pnpm check:type" in frontend
        assert "pnpm build:ele" in frontend
        assert "pnpm quality:prod-scan" in frontend
        assert "-Pquality-audit" in backend and " verify" in backend
        # 覆盖率裁决必须先按可读方式裁决，只有通过才产出机器证据。
        assert "--json" in backend_coverage and "--json" in web_coverage

    def test_release_evidence_matches_gate_requirements(self) -> None:
        """编排产出的证据文件名与检查名必须与门禁固定要求一一对应。"""
        text = WORKFLOW.read_text(encoding="utf-8")
        for spec in gate.RELEASE_JOBS.values():
            assert spec["evidence"] in text
            assert spec["coverage_file"] in text
        for job, checks in gate.RELEASE_CHECKS.items():
            for check in checks:
                assert f'"{check}"' in text, f"{job} 的发布证据缺少检查：{check}"
        assert "upload-artifact" in text and "download-artifact" in text
        assert "if-no-files-found: error" in text

    def test_gate_downloads_and_binds_evidence_to_revision(self) -> None:
        """汇总作业必须取回证据、传入目录并把结论绑定到本次提交。"""
        gate_section = job_section("gate")
        assert "RELEASE_EVIDENCE" in gate_section
        assert "CI_REVISION" in gate_section
        assert gate_section.count("actions/download-artifact@v4") == len(gate.RELEASE_JOBS)
        for spec in gate.RELEASE_JOBS.values():
            assert f'name: {spec["evidence"].replace("release-", "release-evidence-").replace(".json", "")}' in gate_section


class TestCommandLine:
    """CLI 必须在失败时受控退出，且不把上游内容或凭据写进输出。"""

    def run(self, environment: dict[str, str], *arguments: str) -> subprocess.CompletedProcess[str]:
        """以干净环境执行真实 CLI，返回完整输出与退出码。"""
        return subprocess.run([sys.executable, "-B", "-X", "utf8", str(SCRIPT), *arguments],
                              cwd=ROOT, env={"PATH": os.environ.get("PATH", ""), **environment},
                              capture_output=True, text=True, timeout=120, check=False)

    def test_aggregate_success_exits_zero(self) -> None:
        """合法 needs 输出摘要并返回 0。"""
        done = self.run({"NEEDS_JSON": json.dumps(needs())}, "aggregate", "--stage", "audit")
        assert done.returncode == 0, done.stderr
        assert json.loads(done.stdout)["status"] == "passed"

    def test_backend_without_machine_report_exits_one(self, tmp_path: Path) -> None:
        """旧三类全通过仍不能代替机器专项，真实 reports CLI 必须受控拒绝缺失证据。"""
        reports_directory = tmp_path / "module" / "target" / "surefire-reports"
        reports_directory.mkdir(parents=True)
        for classname in ("AuthenticationSessionMySqlIT", "PermissionObjectMySqlIT", "FileUploadMySqlS3IT"):
            write(reports_directory / f"TEST-{classname}.xml", suite([(f"demo.{classname}", "testContract", "")]))
        result = self.run({}, "reports", "--backend", str(tmp_path))
        assert result.returncode == 1
        assert result.stdout == ""
        assert "CI 证据核对失败" in result.stderr
        assert "Traceback" not in result.stderr

    def test_release_without_evidence_exits_one(self) -> None:
        """反例：只把阶段改成 release 不再能通过真实 CLI。"""
        done = self.run({"NEEDS_JSON": json.dumps(release_needs()), "CI_REVISION": REVISION},
                        "aggregate", "--stage", "release")
        assert done.returncode == 1
        assert done.stdout == ""
        assert "Traceback" not in done.stderr

    def test_release_without_revision_exits_one(self, tmp_path: Path) -> None:
        """反例：没有本次提交标识时不能给出发布结论。"""
        directory = evidence_directory(tmp_path)
        done = self.run({"NEEDS_JSON": json.dumps(release_needs()), "RELEASE_EVIDENCE": str(directory)},
                        "aggregate", "--stage", "release")
        assert done.returncode == 1
        assert done.stdout == ""
        assert "Traceback" not in done.stderr

    def test_release_with_real_evidence_exits_zero(self, tmp_path: Path) -> None:
        """正例：取回的证据与作业计数一致时输出发布结论并返回 0。"""
        directory = evidence_directory(tmp_path)
        done = self.run({"NEEDS_JSON": json.dumps(release_needs()), "RELEASE_EVIDENCE": str(directory),
                         "CI_REVISION": REVISION}, "aggregate", "--stage", "release")
        assert done.returncode == 0, done.stderr
        summary = json.loads(done.stdout)
        assert summary["release_verified"] is True
        assert summary["release_evidence"]["revision"] == REVISION

    def test_release_flags_accepted_from_cli(self, tmp_path: Path) -> None:
        """正例：目录与提交标识也可以由显式参数提供，行为与取环境一致。"""
        directory = evidence_directory(tmp_path)
        done = self.run({"NEEDS_JSON": json.dumps(release_needs())}, "aggregate", "--stage", "release",
                        "--release-evidence", str(directory), "--revision", REVISION)
        assert done.returncode == 0, done.stderr
        assert json.loads(done.stdout)["release_verified"] is True

    def test_release_with_audit_stage_evidence_exits_one(self, tmp_path: Path) -> None:
        """反例：审计阶段的覆盖率结论不能顶替发布证据。"""
        document = coverage_document("backend", 3)
        document["stage"] = "audit"
        directory = evidence_directory(tmp_path, backend_coverage=document)
        done = self.run({"NEEDS_JSON": json.dumps(release_needs()), "RELEASE_EVIDENCE": str(directory),
                         "CI_REVISION": REVISION}, "aggregate", "--stage", "release")
        assert done.returncode == 1
        assert "Traceback" not in done.stderr

    def test_non_dict_outputs_exit_one_without_traceback(self) -> None:
        """反例：CLI 对非字典 outputs 返回 1，且不出现 traceback 或 AttributeError。"""
        payload = json.dumps(needs(backend=["x"]))
        done = self.run({"NEEDS_JSON": payload}, "aggregate", "--stage", "audit")
        assert done.returncode == 1
        assert "Traceback" not in done.stderr
        assert "AttributeError" not in done.stderr
        assert "AttributeError" not in done.stdout
        assert done.stdout == ""

    def test_invalid_json_exits_one_without_traceback(self) -> None:
        """反例：非法 JSON 同样是受控失败。"""
        done = self.run({"NEEDS_JSON": "{not json"}, "aggregate", "--stage", "audit")
        assert done.returncode == 1
        assert "Traceback" not in done.stderr

    def test_secret_in_needs_never_echoed(self) -> None:
        """反例：失败路径的 needs 即使携带令牌，也不得出现在标准输出或错误输出。"""
        secret = "DUMMY-ghp-SUPERSECRETTOKENVALUE1234567890"
        # checked 非正整数使聚合必然失败，同时保留一个令牌形态字段作为泄漏来源。
        payload = json.dumps(needs(backend={"stage": "audit", "checked": "0", "token": secret}))
        result = self.run({"NEEDS_JSON": payload}, "aggregate", "--stage", "audit")
        assert result.returncode == 1
        assert secret not in result.stdout and secret not in result.stderr
        assert "Traceback" not in result.stderr

    def test_extra_output_key_does_not_break_aggregation(self) -> None:
        """合法阶段与计数下，上游附带的其他输出键不影响聚合结论。"""
        secret = "DUMMY-ghp-EXTRAKEYVALUE0987654321"
        payload = json.dumps(needs(backend={"stage": "audit", "checked": "1", "token": secret}))
        result = self.run({"NEEDS_JSON": payload}, "aggregate", "--stage", "audit")
        assert result.returncode == 0, result.stderr
        assert secret not in result.stdout
