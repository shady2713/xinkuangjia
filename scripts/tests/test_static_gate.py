"""验证静态检查门禁：真实 PMD 报告核验、前端 lint 证据复核与缺失/旧报告/跳过反例。

反例覆盖复审报告指出的发布缺口：只生成报告不绑定 check、缺少报告、报告早于源码、
检查被跳过或零检查对象时，发布阶段必须拿不到可用证据。

@author DeepSeek
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

import pytest

from scripts.workflow import static_gate as gate

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "workflow" / "static_gate.py"
BACKEND = gate.BACKEND
FRONTEND = gate.FRONTEND


def backend_source(root: Path, name: str = "Value.java", module: str = "module") -> Path:
    """在独立后端工程内写入一份真实生产源码。"""
    path = root / BACKEND / module / "src/main/java/demo" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("package demo; public class Value { public int value() { return 1; } }", encoding="utf-8")
    return path


def pmd_report(root: Path, module: str = "module", *, version: str = "7.17.0",
               timestamp: str = "2026-10-04T14:58:57.450", violations: int = 0,
               foreign: bool = False, write: bool = True, newer_than_source: bool = True) -> Path:
    """写一份真实形状的 PMD XML 报告，可按需注入违规、越界引用或陈旧时间。"""
    path = root / BACKEND / module / "target/pmd.xml"
    path.parent.mkdir(parents=True, exist_ok=True)
    target = root / BACKEND / "outside/Other.java" if foreign else root / BACKEND / module / "src/main/java/demo/Value.java"
    body = "".join(f'<file name="{target}"><violation beginline="7" rule="UnusedPrivateField"/></file>'
                   for _ in range(violations))
    suppressed = f'<suppressedviolation filename="{target}" suppressiontype="@suppresswarnings" msg="demo"/>' if foreign else ""
    attributes = " ".join(f'{key}="{value}"' for key, value in
                          (("version", version), ("timestamp", timestamp)) if value)
    if write:
        path.write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n'
                        f'<pmd xmlns="{gate.PMD_NAMESPACE}" {attributes}>{suppressed}{body}</pmd>\n', encoding="utf-8")
        if not newer_than_source:
            os.utime(path, ns=(1, 1))
    return path


def backend_configs(root: Path, module: str = "module") -> None:
    """写入 PMD 规则集与父 POM，作为报告来源的绑定配置。"""
    ruleset = root / gate.PMD_RULESET
    ruleset.parent.mkdir(parents=True, exist_ok=True)
    ruleset.write_text('<ruleset name="demo"><rule ref="rulesets/java/maven-pmd-plugin-default.xml"/></ruleset>',
                       encoding="utf-8")
    (root / BACKEND / "pom.xml").write_text("<project><artifactId>demo</artifactId></project>", encoding="utf-8")


def backend_tree(root: Path, modules: tuple[str, ...] = ("module",), **kwargs: object) -> None:
    """搭建含生产源码、PMD 报告与绑定配置的独立后端工程。"""
    for module in modules:
        backend_source(root, module=module)
    backend_configs(root)
    for module in modules:
        pmd_report(root, module, **kwargs)  # type: ignore[arg-type]


def frontend_tree(root: Path, **overrides: object) -> dict[str, object]:
    """搭建独立前端工作区并写出一份自述证据，返回可继续篡改的证据对象。"""
    frontend = root / FRONTEND
    frontend.mkdir(parents=True, exist_ok=True)
    (frontend / "package.json").write_text('{"name": "demo"}\n', encoding="utf-8")
    for name in gate.WEB_CONFIG_FILES:
        (frontend / name).write_text("# demo config\n", encoding="utf-8")
    config_dir = frontend / "internal/lint-configs/eslint-config/src"
    config_dir.mkdir(parents=True, exist_ok=True)
    (config_dir / "index.ts").write_text("export const demo = 1;\n", encoding="utf-8")
    report = frontend / "coverage/eslint-report.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps([{"filePath": str(frontend / "apps/demo/src/value.ts"), "messages": [],
                                   "errorCount": 0, "warningCount": 2, "fatalErrorCount": 0}]), encoding="utf-8")
    configs = [{"path": gate.repository_path(root, path), "sha256": gate.digest(path)}
               for path in gate.web_configs(root)]
    document: dict[str, object] = {
        "schema": gate.SCHEMA, "kind": "web", "stage": "release", "status": "passed", "code": 0,
        "executed": True, "skipped": False, "objects": 1, "violations": 0,
        "tools": [{"name": name, "version": "1.0.0", "status": "passed",
                   "command": " ".join(gate.WEB_COMMANDS[name]), "exit_code": 0} for name in gate.WEB_TOOLS],
        "config": configs,
        "reports": [{"kind": "eslint", "path": str(report), "sha256": gate.digest(report)}],
        "workspace": {"files": 1, "errors": 0, "warnings": 2, "fatal": 0,
                      "unformatted": 0, "stylelint_problems": None},
    }
    document.update(overrides)
    evidence = frontend / gate.DEFAULT_WEB_EVIDENCE.relative_to(FRONTEND)
    evidence.parent.mkdir(parents=True, exist_ok=True)
    evidence.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
    return document


class TestBackendReports:
    """后端证据必须来自真实 PMD 报告，且报告晚于源码、只覆盖本模块。"""

    def test_fresh_violation_free_reports_pass(self, tmp_path: Path) -> None:
        """正例：报告存在、无违规、版本一致且晚于源码时给出真实检查对象数。"""
        backend_tree(tmp_path)
        section = gate.verify_backend(tmp_path, "release")
        assert section["status"] == "passed" and section["objects"] == 1
        assert section["tools"][0]["name"] == "pmd" and section["tools"][0]["exit_code"] == 0
        assert section["reports"][0]["kind"] == "pmd"
        assert len(section["config"]) == 2

    def test_injected_violation_is_rejected(self, tmp_path: Path) -> None:
        """反例：真实注入一项 PMD 违规后，静态证据必须拒绝签发并给可定位诊断。"""
        backend_tree(tmp_path, violations=1)
        with pytest.raises(gate.StaticViolationError) as failure:
            gate.verify_backend(tmp_path, "release")
        message = str(failure.value)
        # PMD 7 报告里规则名是违规节点属性、文件名在父 <file> 节点，诊断必须两者都给。
        assert "UnusedPrivateField" in message and "Value.java" in message

    def test_missing_report_is_rejected(self, tmp_path: Path) -> None:
        """反例：PMD 报告被删除时不能凭自述通过。"""
        backend_tree(tmp_path, write=False)
        with pytest.raises(gate.StaticEvidenceError):
            gate.verify_backend(tmp_path, "release")

    def test_stale_report_is_rejected(self, tmp_path: Path) -> None:
        """反例：报告早于生产源码属于旧报告，不能计入本次发布。"""
        backend_tree(tmp_path, newer_than_source=False)
        with pytest.raises(gate.StaticEvidenceError):
            gate.verify_backend(tmp_path, "release")

    def test_foreign_reference_is_rejected(self, tmp_path: Path) -> None:
        """反例：报告引用本模块源码之外的文件说明范围不符或报告被拼装。"""
        backend_tree(tmp_path, foreign=True)
        with pytest.raises(gate.StaticEvidenceError):
            gate.verify_backend(tmp_path, "release")

    @pytest.mark.parametrize("kwargs", [{"version": ""}, {"timestamp": ""}])
    def test_missing_execution_metadata_is_rejected(self, tmp_path: Path, kwargs: dict[str, str]) -> None:
        """反例：缺少工具版本或执行时间的报告无法证明真实执行。"""
        backend_tree(tmp_path, **kwargs)
        with pytest.raises(gate.StaticEvidenceError):
            gate.verify_backend(tmp_path, "release")

    def test_mixed_tool_versions_are_rejected(self, tmp_path: Path) -> None:
        """反例：同一范围出现不同 PMD 版本说明报告并非同一次真实执行。"""
        backend_tree(tmp_path, modules=("module",))
        backend_source(tmp_path, module="other")
        pmd_report(tmp_path, "other", version="7.18.0")
        with pytest.raises(gate.StaticEvidenceError):
            gate.verify_backend(tmp_path, "release")

    def test_ruleset_binding_is_required(self, tmp_path: Path) -> None:
        """反例：缺少规则集或父 POM 时无法解释报告来源。"""
        backend_tree(tmp_path)
        (tmp_path / gate.BACKEND / "pom.xml").unlink()
        with pytest.raises(gate.StaticEvidenceError):
            gate.verify_backend(tmp_path, "release")

    def test_module_without_sources_is_not_a_pass(self, tmp_path: Path) -> None:
        """反例：无生产源码的模块范围只能报 not-applicable，不能算通过。"""
        module = tmp_path / BACKEND / "aggregator"
        module.mkdir(parents=True)
        section = gate.verify_backend(tmp_path, "release", module)
        assert section["status"] == "not-applicable" and section["objects"] == 0


class TestWebEvidence:
    """前端证据必须真实执行、零违规，并与当前配置和原始报告一致。"""

    def test_real_evidence_is_accepted(self, tmp_path: Path) -> None:
        """正例：证据、配置指纹与 ESLint 报告计数一致时通过复核。"""
        frontend_tree(tmp_path)
        section = gate.verify_web(tmp_path, "release", tmp_path / FRONTEND / gate.DEFAULT_WEB_EVIDENCE.relative_to(FRONTEND))
        assert section["objects"] == 1 and len(section["tools"]) == 3

    def test_missing_evidence_is_rejected(self, tmp_path: Path) -> None:
        """反例：没有执行证据时不能凭阶段标签通过。"""
        frontend_tree(tmp_path)
        with pytest.raises(gate.StaticEvidenceError):
            gate.verify_web(tmp_path, "release", tmp_path / "missing.json")

    def test_missing_raw_report_is_rejected(self, tmp_path: Path) -> None:
        """反例：删掉 ESLint 原始报告后只留自述证据也必须拒绝。"""
        frontend_tree(tmp_path)
        (tmp_path / FRONTEND / "coverage/eslint-report.json").unlink()
        with pytest.raises(gate.StaticEvidenceError):
            gate.verify_web(tmp_path, "release", tmp_path / FRONTEND / gate.DEFAULT_WEB_EVIDENCE.relative_to(FRONTEND))

    @pytest.mark.parametrize("overrides", [
        {"stage": "full"},
        {"schema": "static-analysis/v2"},
        {"kind": "backend"},
        {"status": "skipped"},
        {"code": 1},
        {"executed": False},
        {"skipped": True},
        {"objects": 0},
        {"objects": True},
        {"violations": 1},
        {"tools": []},
        {"tools": "eslint"},
        {"config": []},
        {"reports": []},
    ])
    def test_forged_or_skipped_evidence_is_rejected(self, tmp_path: Path, overrides: dict[str, object]) -> None:
        """反例：跳过、零对象、结构伪造或范围不符的证据一律拒绝。"""
        frontend_tree(tmp_path, **overrides)
        with pytest.raises(gate.StaticEvidenceError):
            gate.verify_web(tmp_path, "release", tmp_path / FRONTEND / gate.DEFAULT_WEB_EVIDENCE.relative_to(FRONTEND))

    @pytest.mark.parametrize("mutate", [
        lambda document: document["tools"].pop(0),
        lambda document: document["tools"][0].update(exit_code=1),
        lambda document: document["tools"][0].update(status="skipped"),
        lambda document: document["tools"][0].update(version=""),
        lambda document: document["tools"][0].update(command=""),
        lambda document: document["workspace"].update(errors=1),
        lambda document: document["workspace"].update(files=9),
        lambda document: document["reports"][0].update(sha256="0" * 64),
        lambda document: document["config"][0].update(sha256="1" * 64),
        lambda document: document["config"].append({"path": "extra", "sha256": "2" * 64}),
    ])
    def test_tool_and_binding_mismatch_is_rejected(self, tmp_path: Path, mutate: object) -> None:
        """反例：工具未通过、计数不符、报告指纹或配置指纹不符都必须拒绝。"""
        document = frontend_tree(tmp_path)
        mutate(document)  # type: ignore[operator]
        evidence = tmp_path / FRONTEND / gate.DEFAULT_WEB_EVIDENCE.relative_to(FRONTEND)
        evidence.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
        with pytest.raises(gate.StaticEvidenceError):
            gate.verify_web(tmp_path, "release", evidence)

    def test_execute_web_rejects_tool_failure(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """反例：真实命令退出非零时不写出任何通过证据。"""
        frontend_tree(tmp_path)
        results = iter([
            {"name": "eslint", "command": "eslint", "version": "9", "exit_code": 1,
             "stdout_sha256": "a" * 64, "stderr_sha256": "b" * 64, "stdout": "", "stderr": ""},
            {"name": "prettier", "command": "prettier", "version": "3", "exit_code": 0,
             "stdout_sha256": "c" * 64, "stderr_sha256": "d" * 64, "stdout": "", "stderr": ""},
            {"name": "stylelint", "command": "stylelint", "version": "16", "exit_code": 0,
             "stdout_sha256": "e" * 64, "stderr_sha256": "f" * 64, "stdout": "", "stderr": ""},
        ])
        monkeypatch.setattr(gate, "run_web_tool", lambda *arguments: next(results))
        evidence = tmp_path / FRONTEND / ".cache/quality-static/executed-web.json"
        with pytest.raises(gate.StaticViolationError):
            gate.execute_web(tmp_path, "release", tmp_path / FRONTEND / "coverage/eslint-report.json", evidence)
        assert not evidence.exists()


class TestEslintReport:
    """ESLint 报告解析必须拒绝越界路径与非法计数。"""

    def test_counts_are_read_from_real_report(self, tmp_path: Path) -> None:
        """正例：按文件汇总错误、警告与致命错误。"""
        frontend = tmp_path / FRONTEND
        report = frontend / "coverage/eslint-report.json"
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(json.dumps([
            {"filePath": str(frontend / "a.ts"), "errorCount": 0, "warningCount": 1, "fatalErrorCount": 0},
            {"filePath": str(frontend / "b.ts"), "errorCount": 2, "warningCount": 0, "fatalErrorCount": 1},
        ]), encoding="utf-8")
        assert gate.parse_eslint_report(report, frontend) == {"files": 2, "errors": 2, "warnings": 1, "fatal": 1}

    @pytest.mark.parametrize("payload", [
        "{}", "[]", "not json", '[{"filePath": "/etc/passwd", "errorCount": 0}]',
        '[{"filePath": "a.ts", "errorCount": -1}]', '[{"filePath": "a.ts", "errorCount": true}]',
        '[{"errorCount": 0}]',
    ])
    def test_malformed_reports_are_rejected(self, tmp_path: Path, payload: str) -> None:
        """反例：空报告、越界路径与非法计数都不能被当作通过。"""
        frontend = tmp_path / FRONTEND
        report = frontend / "coverage/eslint-report.json"
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(payload, encoding="utf-8")
        with pytest.raises(gate.StaticEvidenceError):
            gate.parse_eslint_report(report, frontend)


class TestCommandLine:
    """真实 CLI 必须以 0/1/2 区分通过、违规与证据无效。"""

    def run(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        """在仓库根执行真实 CLI，返回完整输出与退出码。"""
        return subprocess.run([sys.executable, "-B", "-X", "utf8", str(SCRIPT), *arguments],
                              capture_output=True, text=True, timeout=120, check=False)

    def test_backend_positive_exit_zero(self, tmp_path: Path) -> None:
        """正例：报告齐备时输出通过结论并返回 0。"""
        backend_tree(tmp_path)
        done = self.run("--root", str(tmp_path), "--kind", "backend", "--json")
        assert done.returncode == 0, done.stderr
        assert json.loads(done.stdout)["status"] == "passed"

    def test_backend_violation_exit_one(self, tmp_path: Path) -> None:
        """反例：注入违规时返回 1，且不输出任何通过结论。"""
        backend_tree(tmp_path, violations=1)
        done = self.run("--root", str(tmp_path), "--kind", "backend")
        assert done.returncode == 1 and done.stdout == ""
        assert "静态检查未通过" in done.stderr and "Traceback" not in done.stderr

    def test_backend_missing_report_exit_two(self, tmp_path: Path) -> None:
        """反例：报告缺失时返回 2，不出现未捕获异常。"""
        backend_tree(tmp_path, write=False)
        done = self.run("--root", str(tmp_path), "--kind", "backend")
        assert done.returncode == 2 and done.stdout == ""
        assert "Traceback" not in done.stderr

    def test_web_requires_existing_evidence(self, tmp_path: Path) -> None:
        """反例：只给阶段、没有任何前端证据时返回 2。"""
        frontend_tree(tmp_path)
        done = self.run("--root", str(tmp_path), "--kind", "web", "--evidence", str(tmp_path / "none.json"))
        assert done.returncode == 2 and done.stdout == ""

    def test_backend_execute_is_rejected(self, tmp_path: Path) -> None:
        """反例：后端 PMD 只能由 Maven 执行，本工具不能伪造执行。"""
        done = self.run("--root", str(tmp_path), "--kind", "backend", "--execute")
        assert done.returncode == 2


def test_reports_are_hashed_not_embedded(tmp_path: Path) -> None:
    """证据只公开报告路径与指纹，不复制源码或报告正文。"""
    backend_tree(tmp_path)
    section = gate.verify_backend(tmp_path, "release")
    text = json.dumps(section, ensure_ascii=False)
    assert "public class Value" not in text
    assert section["reports"][0]["sha256"] == gate.digest(tmp_path / BACKEND / "module/target/pmd.xml")


def test_verify_static_rejects_unknown_scope(tmp_path: Path) -> None:
    """范围与阶段只接受固定值，避免出现无人核对的阶段。"""
    with pytest.raises(ValueError):
        gate.verify_static(tmp_path, "java", "release")
    with pytest.raises(ValueError):
        gate.verify_static(tmp_path, "web", "audit")


def test_evidence_written_with_lf_and_utf8(tmp_path: Path) -> None:
    """证据文件按 UTF-8 与 LF 写出，便于跨平台核对指纹。"""
    frontend_tree(tmp_path)
    evidence = tmp_path / FRONTEND / gate.DEFAULT_WEB_EVIDENCE.relative_to(FRONTEND)
    raw = evidence.read_bytes()
    assert b"\r\n" not in raw
    assert json.loads(raw.decode("utf-8"))["schema"] == gate.SCHEMA
    assert ET.fromstring("<pmd/>") is not None


def test_web_configs_excludes_generated_artifacts(tmp_path: Path) -> None:
    """前端配置枚举必须剪掉生成产物，否则 release 证据在独立检出上无法复核。

    `os.walk` 的剪枝依赖调用方原地修改 `directories`；一旦用 `sorted()` 包裹生成器，整个遍历
    会被先消费完，剪枝对已产出的目录不再生效，`dist` 与 `node_modules/.cache` 会被当成"决定
    lint 结论的配置"。这些文件由构建生成、字节随环境与时机变化，而汇总作业是独立检出（不跑
    `pnpm install`），指纹必然不一致，release 阶段的静态证据会因此被判"配置与当前仓库不一致"。
    """
    frontend_tree(tmp_path)
    frontend = tmp_path / FRONTEND
    generated = [
        frontend / "internal/lint-configs/eslint-config/dist/index.mjs",
        frontend / "internal/lint-configs/eslint-config/dist/index.d.ts",
        frontend / "internal/lint-configs/eslint-config/node_modules/.cache/jiti/config.mjs",
        frontend / "internal/lint-configs/eslint-config/.turbo/cache.mjs",
    ]
    for path in generated:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("export const generated = 1;\n", encoding="utf-8")
    listed = {gate.repository_path(tmp_path, path) for path in gate.web_configs(tmp_path)}
    for path in generated:
        assert gate.repository_path(tmp_path, path) not in listed, f"生成产物不得进入配置枚举：{path}"
    # 负对照一：真实共享规则源码仍必须被枚举，剪枝不能把配置一起剪掉。
    assert gate.repository_path(tmp_path, frontend / "internal/lint-configs/eslint-config/src/index.ts") in listed
    # 负对照二：真实配置内容变化仍必须改变指纹，判定没有被放宽。
    shared = frontend / "internal/lint-configs/eslint-config/src/index.ts"
    before = gate.digest(shared)
    shared.write_text("export const demo = 2;\n", encoding="utf-8")
    assert gate.digest(shared) != before
    assert len(gate.web_configs(tmp_path)) == len(listed)
