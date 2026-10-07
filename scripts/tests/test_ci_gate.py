"""验证 CI 证据核对：正常聚合、受控反例失败、报告真伪、发布证据与输出脱敏。

反例重点覆盖上游 $GITHUB_OUTPUT 产生的非字典 outputs、只改阶段标签的发布结论，
以及发布证据里的静态检查段：跳过、零对象、违规、范围缩水与旧配置都必须拒绝。
前者曾抛出未捕获的 AttributeError，中间一项曾在没有任何发布证据时返回 release_verified。

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
from collections.abc import Callable
from fnmatch import fnmatchcase
from functools import lru_cache
from pathlib import Path
from xml.etree import ElementTree as ET

import pytest

from scripts.workflow import ci_gate as gate
from scripts.workflow import static_gate

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


# 受管 Web 文件全量的下限：真实仓库当前为 1530 个，低于该量说明枚举范围被意外缩小。
MINIMUM_MANAGED_WEB_FILES = 1500


@lru_cache(maxsize=None)
def managed_web_files() -> int:
    """独立复算真实仓库的受管 Web 文件数，与发布汇总的 own_count 复算同源。

    下限来自仓库真实规模而不是被测代码的输出：枚举规则一旦被缩小（例如只遍历某个子目录），
    这里和 ci_gate 的复算会一起变小，因此正例夹具必须另有独立下限钉住。
    """
    count = gate.managed_web_files(gate.ROOT)
    assert count >= MINIMUM_MANAGED_WEB_FILES, f"受管 Web 文件数异常缩小：{count}"
    return count


@lru_cache(maxsize=None)
def static_template(kind: str) -> str:
    """按当前仓库真实模块、配置与工具生成静态检查段模板的 JSON 文本。

    夹具必须与被测门禁使用同一套独立枚举：后端模块清单来自生产源码目录，
    配置指纹来自规则集/父 POM 或前端三条规则配置，否则汇总校验会正当地拒绝。
    """
    configs = [{"path": static_gate.repository_path(gate.ROOT, path), "sha256": static_gate.digest(path)}
               for path in (static_gate.backend_configs(gate.ROOT) if kind == "backend"
                            else static_gate.web_configs(gate.ROOT))]
    if kind == "backend":
        modules = []
        for module in static_gate.production_modules(gate.ROOT):
            relative = static_gate.repository_path(gate.ROOT, module)
            modules.append({"module": relative, "report": f"{relative}/target/pmd.xml",
                            "sha256": digest(relative), "sources": len(static_gate.production_sources(module)),
                            "violations": 0, "suppressed": 0, "pmd_version": "7.17.0",
                            "timestamp": "2026-10-04T14:58:57.450"})
        document: dict[str, object] = {
            "schema": static_gate.SCHEMA, "kind": kind, "stage": "release", "status": "passed", "code": 0,
            "executed": True, "skipped": False, "violations": 0, "config": configs,
            "tools": [{"name": "pmd", "version": "7.17.0", "status": "passed",
                       "command": "mvn -B -ntp -Pquality-audit verify", "exit_code": 0}],
            "objects": sum(int(item["sources"]) for item in modules),
            "reports": [{"kind": "pmd", "path": item["report"], "sha256": item["sha256"]} for item in modules],
            "modules": modules,
        }
    else:
        objects = 4096
        document = {
            "schema": static_gate.SCHEMA, "kind": kind, "stage": "release", "status": "passed", "code": 0,
            "executed": True, "skipped": False, "violations": 0, "objects": objects, "config": configs,
            "tools": [{"name": name, "version": "1.0.0", "status": "passed",
                       "command": " ".join(static_gate.WEB_COMMANDS[name]), "exit_code": 0}
                      for name in static_gate.WEB_TOOLS],
            "reports": [{"kind": "eslint", "path": "coverage/eslint-report.json", "sha256": digest("eslint")}],
            "workspace": {"files": objects, "errors": 0, "warnings": 0, "fatal": 0,
                          "unformatted": 0, "stylelint_problems": None},
        }
    return json.dumps(document, ensure_ascii=False)


def static_document(kind: str) -> dict[str, object]:
    """取回一份可独立篡改的静态检查段夹具，避免反例互相污染。"""
    return json.loads(static_template(kind))


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
        "static_analysis": static_document(kind),
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
            # 全量 Web 注释的计数必须等于汇总独立复算出的受管文件数（own_count）。
            {"name": "web-comments-full", "status": "passed", "checked": managed_web_files(),
             "command": "python -B -X utf8 scripts/code/web/check_full_web_comments.py --root . --json"},
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


SOURCE_INDEX_RELATIVE = "docs/测试与可靠性/来源证据/d12-source-index.json"
SOURCE_JAVA_ROOT = (
    "后端代码/basic-framework-boot/basic-framework-core/basic-framework-core/"
    "src/main/java/example"
)
ACCEPTED_VERDICT = "已按 D12 格式写入来源说明并撤回无依据署名"
BLOCKED_VERDICT = "证据不足，保持原状并登记阻断"


def source_document(path: str, verdict: str, *, blocker: str = "") -> dict[str, object]:
    """构造一条受控来源索引记录；未验收记录带完整登记字段。"""

    return {
        "local_path": path,
        "scope": "backend-prod",
        "upstream_repo_url": "https://github.com/YunaiV/ruoyi-vue-pro.git",
        "upstream_commit": "ac022b15a094cf9cf82903d429b9729e72309da5",
        "upstream_sha256": digest(f"upstream:{path}"),
        "author_status": "已核实来源但作者未声明",
        "evidence_route": "路线 3（证据不足，阻断）",
        "evidence_points": "P2 注释点（共享独特注释正文）：来源验收探针 本地 L1 / 上游 L1",
        "open_gap": "①上游该固定版本未声明作者；②历史引入版本仍未核实。",
        "review_by": "CI 规则测试",
        "review_date": "2026-10-06",
        "review_conclusion": f"逐项复核 {Path(path).stem}：按登记结论保持未验收。",
        "type_evidence": json.dumps(
            {
                "schema": "d12-type-evidence/v1",
                "file": {"local_path": path, "local_sha256_final": ""},
                "types": [
                    {
                        "qualified_name": f"example.{Path(path).stem}",
                        "simple_name": Path(path).stem,
                        "kind": "class",
                        "nested": False,
                        "enclosing_type": None,
                        "upstream_type": f"cn.iocoder.yudao.example.{Path(path).stem}",
                        "upstream_author_declared": False,
                    }
                ],
            },
            ensure_ascii=False,
        ),
        "d12_verdict": verdict,
        "d12_blocker_reason": blocker,
    }


def source_tree(root: Path, *, blocked: int = 0) -> Path:
    """写出一棵最小来源树：纳管 Java 文件与受控索引。

    blocked>0 时额外写出若干条未验收记录，用于验证“存在适用阻断时 release 必须
    退出 1 且 release_verified=false”。
    """

    records = []
    for index in range(blocked):
        name = f"Blocked{index}Demo"
        path = f"{SOURCE_JAVA_ROOT}/{name}.java"
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            f"package example;\n\n/** 阻断样本 {index}。 */\npublic class {name} {{\n}}\n",
            encoding="utf-8",
        )
        records.append(source_document(path, BLOCKED_VERDICT, blocker="路线 3 只有 1 个独立定位对应点。"))
    accepted = f"{SOURCE_JAVA_ROOT}/SourceGateDemo.java"
    target = root / accepted
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        "package example;\n\n/** 已验收样本。 */\npublic class SourceGateDemo {\n}\n",
        encoding="utf-8",
    )
    records.append(source_document(accepted, ACCEPTED_VERDICT))
    index = root / SOURCE_INDEX_RELATIVE
    index.parent.mkdir(parents=True, exist_ok=True)
    index.write_text(
        json.dumps({"index_schema": "d12-source-index/v1", "manifest": {}, "records": records},
                   ensure_ascii=False),
        encoding="utf-8",
    )
    return root


def source_report(root: Path, revision: str, *, mode: str = "strict") -> dict[str, object]:
    """按来源树与索引真实生成一份来源验收报告，字段全部由账本与文件复算。"""

    index = (root / SOURCE_INDEX_RELATIVE).read_bytes()
    document = json.loads(index.decode("utf-8"))
    accepted, hard = [], []
    for record in document["records"]:
        path = record["local_path"]
        source = root / path
        verdict = record["d12_verdict"]
        item = {
            "record_id": path,
            "path": path,
            "line": 4,
            "type_name": f"example.{Path(path).stem}",
            "form": "来源说明",
            "classification": "accepted" if verdict == ACCEPTED_VERDICT else "hard-failure",
            "verdict": verdict,
            "blocker_reason": record["d12_blocker_reason"],
            "open_gap": record["open_gap"],
            "local_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        }
        (accepted if verdict == ACCEPTED_VERDICT else hard).append(item)
    scope = sorted(gate.managed_java_files(root))
    scanner = gate.SOURCE_ROOT / "scripts/code/java/check_staged_java_comments.py"
    return {
        "protocol": gate.SOURCE_PROTOCOL,
        "check": "Java 注释（全量）",
        "checked": len(scope),
        "findings": [{"path": item["path"], "line": 4, "rule": "type-author", "detail": "x"}
                     for item in hard],
        "status": "failed" if hard else "passed",
        "evidence": {
            "registry": str(root / SOURCE_INDEX_RELATIVE),
            "registry_sha256": hashlib.sha256(index).hexdigest(),
            "records": len(document["records"]),
        },
        "revision": revision,
        "scanner": {
            "path": "scripts/code/java/check_staged_java_comments.py",
            "sha256": hashlib.sha256(scanner.read_bytes()).hexdigest(),
        },
        "acceptance": {
            "schema": gate.SOURCE_REPORT_SCHEMA,
            "mode": mode,
            "revision": revision,
            "index_schema": "d12-source-index/v1",
            "scanned_files": len(scope),
            "counts": {
                "scanned_files": len(scope),
                "accepted": len(accepted),
                "registered_blockers": 0,
                "hard_failures": len(hard),
                "findings": len(hard),
                "uncovered_records": 0,
            },
            "accepted": accepted,
            "registered_blockers": [],
            "hard_failures": hard,
            "uncovered_records": [],
            "scope": {"files": scope, "count": len(scope)},
        },
    }


def write_source_report(root: Path, revision: str, *, directory: Path | None = None,
                        mode: str = "strict") -> Path:
    """把来源验收报告写到发布证据目录，返回实际路径。"""

    report = source_report(root, revision, mode=mode)
    target = (directory or root) / gate.SOURCE_REPORT_NAME
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")
    return target


@pytest.fixture
def clean_source(tmp_path: Path) -> Path:
    """提供一棵来源零阻断的最小来源树，供不关注来源状态的聚合用例复用。"""

    return source_tree(tmp_path / "clean-source")


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
        # 镜像来源必须经核验而不是靠“变量非空”过关：预检调用 ci_services.py images，
        # 由脚本按 sha256 固定默认值与覆盖值；缺失或未固定时退出 2 红灯。
        assert "ci_services.py images" in section
        assert "--results" in section
        # 失败痕迹与用例摘要都要在失败时也上传，且缺失制品不改变作业结论本身。
        upload = step_named("browser_e2e", "上传浏览器用例摘要与失败痕迹")
        assert "if: always()" in upload and "if-no-files-found: warn" in upload
        assert "business-e2e.json" in upload and "business-e2e-results" in upload
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

    def test_normal_aggregation_reports_counts(self, tmp_path: Path) -> None:
        """全部必需作业成功且来源零阻断时返回阶段、状态与逐作业用例数。"""
        root = source_tree(tmp_path / "clean-source")
        result = gate.aggregate(needs(), "audit", source_root=root)
        assert result == {"schema": "ci-summary/v1", "stage": "audit", "status": "passed",
                          "tests": {"backend": 4, "browser_e2e": 4, "docs_tools": 4, "frontend": 4},
                          "release_verified": False, "release_evidence": None,
                          "source_acceptance": result["source_acceptance"], "exit_code": 0}
        assert result["source_acceptance"]["status"] == "passed"
        assert result["source_acceptance"]["applicable_blockers"] == 0

    def test_existing_blockers_keep_aggregate_red(self, tmp_path: Path) -> None:
        """反例：来源仍有未验收项时，非发布阶段也不能报告通过。"""
        root = source_tree(tmp_path / "blocked-source", blocked=2)
        result = gate.aggregate(needs(), "audit", source_root=root)
        assert result["status"] == "blocked" and result["exit_code"] == 1
        assert result["source_acceptance"]["index_blockers"] == 2
        assert result["release_verified"] is False

    @pytest.mark.parametrize("stage", STAGES)
    def test_release_flag_only_for_verified_release(self, stage: str, tmp_path: Path) -> None:
        """反例：阶段标签本身不构成发布证据；只有真实证据齐备的 release 才标记已验证。"""
        root = source_tree(tmp_path / "clean-source")
        if stage != "release":
            assert gate.aggregate(
                needs(stage), stage, source_root=root
            )["release_verified"] is False
            return
        with pytest.raises(ValueError):
            gate.aggregate(release_needs(), "release")
        directory = evidence_directory(tmp_path)
        write_source_report(root, REVISION, directory=directory)
        result = gate.aggregate(release_needs(), "release", directory, REVISION, source_root=root)
        assert result["release_verified"] is True
        assert result["release_evidence"]["revision"] == REVISION

    def test_release_with_blockers_is_false_even_when_jobs_succeed(self, tmp_path: Path) -> None:
        """反例：四个作业全部 success 且有正计数，来源报告仍有阻断也必须拒绝发布。"""
        root = source_tree(tmp_path / "blocked-source", blocked=1)
        directory = evidence_directory(tmp_path)
        write_source_report(root, REVISION, directory=directory)
        result = gate.aggregate(release_needs(), "release", directory, REVISION, source_root=root)
        assert result["status"] == "blocked"
        assert result["release_verified"] is False
        assert result["exit_code"] == 1
        assert result["source_acceptance"]["counts"]["hard_failures"] == 1
        assert result["source_acceptance"]["hard_failures"][0]["verdict"] == BLOCKED_VERDICT

    def test_release_requires_a_source_report(self, tmp_path: Path) -> None:
        """反例：删掉来源报告后不能用默认 0、空集合或作业成功代替来源验收。"""
        root = source_tree(tmp_path / "clean-source")
        directory = evidence_directory(tmp_path)
        with pytest.raises(ValueError) as failure:
            gate.aggregate(release_needs(), "release", directory, REVISION, source_root=root)
        assert "来源验收报告" in str(failure.value)

    def test_source_report_must_match_current_ledger_and_rules(self, tmp_path: Path) -> None:
        """反例：改计数、减清单、换旧提交或改规则指纹都必须被复核拒绝。"""
        root = source_tree(tmp_path / "source")
        directory = evidence_directory(tmp_path)
        write_source_report(root, REVISION, directory=directory)
        target = directory / gate.SOURCE_REPORT_NAME
        original = json.loads(target.read_text(encoding="utf-8"))

        def rejected(document: dict[str, object], revision: str = REVISION) -> None:
            """写入被篡改的报告并断言发布汇总受控拒绝，随后还原原报告。"""

            target.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
            with pytest.raises(ValueError):
                gate.aggregate(release_needs(), "release", directory, revision, source_root=root)
            target.write_text(json.dumps(original, ensure_ascii=False), encoding="utf-8")

        decremented = json.loads(json.dumps(original))
        decremented["acceptance"]["counts"]["accepted"] = 99
        rejected(decremented)
        removed = json.loads(json.dumps(original))
        removed["acceptance"]["accepted"] = []
        rejected(removed)
        stale = json.loads(json.dumps(original))
        stale["revision"] = "f" * 40
        stale["acceptance"]["revision"] = "f" * 40
        rejected(stale)
        wrong_rules = json.loads(json.dumps(original))
        wrong_rules["scanner"]["sha256"] = "0" * 64
        rejected(wrong_rules)
        wrong_ledger = json.loads(json.dumps(original))
        wrong_ledger["evidence"]["registry_sha256"] = "0" * 64
        rejected(wrong_ledger)

    def test_source_report_with_hidden_blocker_is_rejected(self, tmp_path: Path) -> None:
        """反例：把未验收记录从清单里删掉（少报阻断）必须被独立复算揭穿。"""
        root = source_tree(tmp_path / "blocked-source", blocked=1)
        directory = evidence_directory(tmp_path)
        write_source_report(root, REVISION, directory=directory)
        target = directory / gate.SOURCE_REPORT_NAME
        document = json.loads(target.read_text(encoding="utf-8"))
        document["acceptance"]["hard_failures"] = []
        document["acceptance"]["counts"]["hard_failures"] = 0
        document["acceptance"]["counts"]["findings"] = 0
        document["findings"] = []
        document["status"] = "passed"
        target.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
        with pytest.raises(ValueError) as failure:
            gate.aggregate(release_needs(), "release", directory, REVISION, source_root=root)
        assert "复算不一致" in str(failure.value)

    def test_source_report_missing_index_schema_is_rejected(self, tmp_path: Path) -> None:
        """反例：缺少来源索引 schema 声明的账本不能被当成有效的本次来源验收。"""
        root = source_tree(tmp_path / "source")
        index = root / SOURCE_INDEX_RELATIVE
        document = json.loads(index.read_text(encoding="utf-8"))
        document.pop("index_schema")
        index.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
        directory = evidence_directory(tmp_path)
        write_source_report(root, REVISION, directory=directory)
        with pytest.raises(ValueError) as failure:
            gate.aggregate(release_needs(), "release", directory, REVISION, source_root=root)
        assert "schema" in str(failure.value)

    def test_maintenance_stage_states_blockers_without_passing(self, tmp_path: Path) -> None:
        """反例：维护模式可以让非发布汇总退出 0，但不得被当成通过或发布已验证。"""
        root = source_tree(tmp_path / "blocked-source", blocked=1)
        result = gate.aggregate(
            needs(), "audit", source_root=root, maintenance=True
        )
        assert result["status"] == "completed-with-registered-blockers"
        assert result["exit_code"] == 0
        assert result["release_verified"] is False
        assert result["source_acceptance"]["applicable_blockers"] == 1
        with pytest.raises(ValueError):
            gate.aggregate(release_needs(), "release", None, REVISION,
                           source_root=root, maintenance=True)

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
    def test_non_success_job_rejected(self, result: str, clean_source: Path) -> None:
        """skipped/cancelled/failure 一律不算通过；只有 success 可以。"""
        if result == "success":
            assert gate.aggregate(
                needs(result=result), "audit", source_root=clean_source
            )["status"] == "passed"
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


class TestWebCommentsFullReleaseBinding:
    """Web 全量注释必须自己出现在发布证据里，并由汇总独立复算受管范围。

    此前它只在 docs_tools 作业内真实执行并断言，发布汇总的检查清单里没有这一项：
    四个作业全绿、前端其余检查都在，全库 Web 注释照样可以从缺口中签发发布结论。
    现在 frontend 作业在 release 阶段重新真实执行并把实测对象数写进证据，
    汇总按 own_count 复算受管范围——缩范围、编造数字、缺项或未真实通过都拒绝。
    """

    COUNTS = {"backend": 5, "docs_tools": 7, "frontend": 6}

    def web_check(self, checks: object) -> dict[str, object]:
        """取回前端发布证据里的 Web 全量注释检查项，供逐条篡改。"""
        assert isinstance(checks, list)
        return next(item for item in checks if isinstance(item, dict) and item.get("name") == "web-comments-full")

    def release_frontend(self, tmp_path: Path, mutate: Callable[[list[dict[str, object]]], None]) -> Path:
        """按给定篡改写出前端发布证据，返回可直接交给消费入口的证据目录。"""
        document = manifest("frontend", 6, "coverage-web.json", "web", 4)
        mutate(document["checks"])  # type: ignore[arg-type]
        return evidence_directory(tmp_path, frontend_manifest=document)

    def test_complete_evidence_lists_the_full_web_comment_check(self, tmp_path: Path) -> None:
        """正例：前端证据含该项时发布汇总照常签发，并把检查名写进可公开摘要。"""
        directory = evidence_directory(tmp_path)
        summary = gate.release_evidence(directory, self.COUNTS, REVISION)
        assert "web-comments-full" in summary["jobs"]["frontend"]["checks"]
        document = manifest("frontend", 6, "coverage-web.json", "web", 4)
        assert self.web_check(document["checks"])["checked"] == managed_web_files()

    def test_missing_check_is_rejected(self, tmp_path: Path) -> None:
        """反例：缺项——docs_tools 作业跑过不算发布证据，前端证据里没有就拒绝。"""
        directory = self.release_frontend(tmp_path, lambda checks: checks.pop())
        with pytest.raises(ValueError, match="web-comments-full"):
            gate.release_evidence(directory, self.COUNTS, REVISION)

    @pytest.mark.parametrize("status", [
        "skipped", "failed", "not-applicable", "completed-with-registered-blockers", "passed-with-blockers",
    ])
    def test_status_must_be_passed(self, tmp_path: Path, status: str) -> None:
        """反例：状态非 passed（维护完成态与不适用同样不算）不构成发布证据。"""
        directory = self.release_frontend(
            tmp_path, lambda checks: self.web_check(checks).__setitem__("status", status)
        )
        with pytest.raises(ValueError, match="web-comments-full"):
            gate.release_evidence(directory, self.COUNTS, REVISION)

    @pytest.mark.parametrize("checked", [
        0, -1, "1530", None, True, 1530.0, [],
    ])
    def test_count_must_be_a_real_positive_integer(self, tmp_path: Path, checked: object) -> None:
        """反例：零、负数、文本、null、布尔与浮点都不是实测整数对象数。"""
        directory = self.release_frontend(
            tmp_path, lambda checks: self.web_check(checks).__setitem__("checked", checked)
        )
        with pytest.raises(ValueError, match="web-comments-full"):
            gate.release_evidence(directory, self.COUNTS, REVISION)

    @pytest.mark.parametrize("delta", [-1, 1, -100, 100])
    def test_count_must_match_independently_enumerated_scope(self, tmp_path: Path, delta: int) -> None:
        """反例：与汇总独立复算的受管范围不一致（缩小或凭空放大）一律拒绝。"""
        directory = self.release_frontend(
            tmp_path,
            lambda checks: self.web_check(checks).__setitem__("checked", managed_web_files() + delta),
        )
        with pytest.raises(ValueError, match="web-comments-full"):
            gate.release_evidence(directory, self.COUNTS, REVISION)

    def test_command_must_be_declared(self, tmp_path: Path) -> None:
        """反例：没有可核对命令就无法证明这次执行真的发生过。"""
        directory = self.release_frontend(
            tmp_path, lambda checks: self.web_check(checks).__setitem__("command", "  ")
        )
        with pytest.raises(ValueError, match="web-comments-full"):
            gate.release_evidence(directory, self.COUNTS, REVISION)

    def test_aggregate_consumer_rejects_a_shrunk_web_comment_scope(self, tmp_path: Path) -> None:
        """真实消费入口：release 阶段的发布汇总同样拒绝缩小的全量 Web 注释范围。"""
        root = source_tree(tmp_path / "clean-source")
        directory = self.release_frontend(
            tmp_path,
            lambda checks: self.web_check(checks).__setitem__("checked", managed_web_files() - 1),
        )
        write_source_report(root, REVISION, directory=directory)
        with pytest.raises(ValueError, match="web-comments-full"):
            gate.aggregate(release_needs(), "release", directory, REVISION, source_root=root)

    def test_frontend_job_really_runs_it_and_reports_the_measured_count(self) -> None:
        """真实编排：release 阶段必须重新执行全量入口，并把实测值写进发布证据。"""
        section = job_section("frontend")
        step = step_named("frontend", "Web 全量注释（发布阶段）")
        assert "inputs.stage == 'release'" in step
        assert "scripts/code/web/check_full_web_comments.py --root . --json" in step
        # 不得用管道或 || true 吞掉真实退出码，也不得降级成增量入口。
        assert "continue-on-error:" not in step
        assert "|| true" not in step and "check_worktree_web_comments.py" not in step
        evidence = step_named("frontend", "生成发布阶段前端证据")
        assert '"web-comments-full"' in evidence
        # 计数取自上一步真实执行的 JSON，而不是在证据步骤里写死数字。
        assert '"checked": web_checked' in evidence
        assert "web_comments.get(\"status\") != \"passed\"" in evidence
        assert "python -B -X utf8 scripts/code/web/check_full_web_comments.py --root . --json" in section
        # 该检查必须登记为 own_count：既不是作业用例数，也不是覆盖率实测文件数。
        assert gate.RELEASE_CHECKS["frontend"]["web-comments-full"] == "own_count"


class TestReleaseStaticAnalysis:
    """发布证据必须包含真实静态检查结论：跳过、零对象、违规、范围缩水与旧配置都拒绝。"""

    COUNTS = {"backend": 5, "docs_tools": 7, "frontend": 6}

    def directory(self, tmp_path: Path, kind: str, section: object) -> Path:
        """把指定静态检查段写入某范围的覆盖率证据，返回发布证据目录。"""
        # 覆盖率实测文件数必须与作业清单声明的计数一致，否则会因无关原因被拒绝。
        document = coverage_document(kind, 3 if kind == "backend" else 4)
        if section is None:
            document.pop("static_analysis")
        else:
            document["static_analysis"] = section
        overrides = {"backend_coverage": document} if kind == "backend" else {"web_coverage": document}
        return evidence_directory(tmp_path, **overrides)

    def assert_rejected(self, directory: Path) -> None:
        """断言该证据目录不能签发发布结论。"""
        with pytest.raises(ValueError):
            gate.release_evidence(directory, self.COUNTS, REVISION)

    @pytest.mark.parametrize("kind", ["backend", "web"])
    def test_complete_static_evidence_is_accepted(self, tmp_path: Path, kind: str) -> None:
        """正例：静态检查段与真实仓库模块、配置一致时参与发布结论。"""
        summary = gate.release_evidence(self.directory(tmp_path, kind, static_document(kind)), self.COUNTS, REVISION)
        job = "backend" if kind == "backend" else "frontend"
        assert summary["jobs"][job]["static"]["objects"] > 0
        assert summary["jobs"][job]["static"]["tools"]

    @pytest.mark.parametrize("kind", ["backend", "web"])
    def test_missing_static_section_rejected(self, tmp_path: Path, kind: str) -> None:
        """反例：没有任何静态检查结论的覆盖率证据不能构成发布证据。"""
        self.assert_rejected(self.directory(tmp_path, kind, None))

    @pytest.mark.parametrize("kind", ["backend", "web"])
    @pytest.mark.parametrize("name,mutate", [
        ("schema", lambda section: section.update(schema="static-analysis/v2")),
        ("stage", lambda section: section.update(stage="full")),
        ("kind", lambda section: section.update(kind="other")),
        ("status", lambda section: section.update(status="failed")),
        ("code", lambda section: section.update(code=1)),
        ("executed", lambda section: section.update(executed=False)),
        ("skipped", lambda section: section.update(skipped=True)),
        ("objects-zero", lambda section: section.update(objects=0)),
        ("objects-bool", lambda section: section.update(objects=True)),
        ("objects-text", lambda section: section.update(objects="4096")),
        ("violations", lambda section: section.update(violations=1)),
        ("tools-empty", lambda section: section.update(tools=[])),
        ("tools-missing", lambda section: section["tools"].pop(0)),
        ("tools-duplicate", lambda section: section["tools"].append(dict(section["tools"][0]))),
        ("tools-exit", lambda section: section["tools"][0].update(exit_code=1)),
        ("tools-status", lambda section: section["tools"][0].update(status="skipped")),
        ("tools-version", lambda section: section["tools"][0].update(version="")),
        ("tools-command", lambda section: section["tools"][0].update(command="")),
        ("config-empty", lambda section: section.update(config=[])),
        ("config-digest", lambda section: section["config"][0].update(sha256="0" * 64)),
        ("config-extra", lambda section: section["config"].append({"path": "extra", "sha256": "1" * 64})),
        ("reports-empty", lambda section: section.update(reports=[])),
        ("reports-digest", lambda section: section["reports"][0].update(sha256="xyz")),
    ])
    def test_tampered_static_section_rejected(self, tmp_path: Path, kind: str, name: str,
                                              mutate: object) -> None:
        """反例：跳过、零对象、违规、工具伪造、配置或报告指纹不符都必须拒绝。"""
        section = static_document(kind)
        mutate(section)  # type: ignore[operator]
        self.assert_rejected(self.directory(tmp_path, kind, section))

    @pytest.mark.parametrize("mutate", [
        lambda section: section["modules"].pop(0),
        lambda section: section["modules"].append(dict(section["modules"][0], module="后端代码/其它模块")),
        lambda section: section["modules"][0].update(sources=0),
        lambda section: section["modules"][0].update(violations=1),
        lambda section: section.update(objects=int(section["objects"]) + 1),
        lambda section: section["reports"].pop(0),
    ])
    def test_backend_module_scope_must_match_repository(self, tmp_path: Path, mutate: object) -> None:
        """反例：后端静态检查范围必须覆盖当前全部生产模块，且逐模块结论自洽。"""
        section = static_document("backend")
        mutate(section)  # type: ignore[operator]
        self.assert_rejected(self.directory(tmp_path, "backend", section))

    @pytest.mark.parametrize("mutate", [
        lambda section: section["workspace"].update(files=int(section["objects"]) - 1),
        lambda section: section["workspace"].update(errors=1),
        lambda section: section["workspace"].update(fatal=1),
        lambda section: section.update(objects=2, workspace={"files": 2, "errors": 0, "warnings": 0, "fatal": 0}),
    ])
    def test_web_static_scope_must_cover_production_inventory(self, tmp_path: Path, mutate: object) -> None:
        """反例：前端静态检查范围不得小于生产源码清单，工作区自述必须自洽。"""
        section = static_document("web")
        mutate(section)  # type: ignore[operator]
        self.assert_rejected(self.directory(tmp_path, "web", section))

    def test_cli_rejects_tampered_static_evidence(self, tmp_path: Path) -> None:
        """反例：真实 CLI 遇到被改坏的静态段时受控失败，不输出发布结论。"""
        section = static_document("backend")
        section["violations"] = 1
        directory = self.directory(tmp_path, "backend", section)
        done = subprocess.run(
            [sys.executable, "-B", "-X", "utf8", str(SCRIPT), "aggregate", "--stage", "release",
             "--release-evidence", str(directory), "--revision", REVISION],
            cwd=ROOT, env={"PATH": os.environ.get("PATH", ""), "NEEDS_JSON": json.dumps(release_needs())},
            capture_output=True, text=True, timeout=120, check=False)
        assert done.returncode == 1
        assert done.stdout == ""
        assert "Traceback" not in done.stderr


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
        # 逐作业取回发布证据，另加一份来源验收报告（D15：存在已登记阻断时 release 必须红）。
        # 这里钉住“恰好这么多份、且来源报告必须在场”，多一份少一份都会失败。
        assert "release-evidence-source" in gate_section
        assert gate_section.count("actions/download-artifact@v4") == len(gate.RELEASE_JOBS) + 1
        for spec in gate.RELEASE_JOBS.values():
            assert f'name: {spec["evidence"].replace("release-", "release-evidence-").replace(".json", "")}' in gate_section


class TestRequiredJobConsistency:
    """固定必需作业清单与真实编排必须一致：重命名或增删作业不能只改一边。

    汇总门禁按 ci_gate.JOBS 精确比对 needs 集合，多一个或少一个作业都会被拒绝；
    真实缺陷（云端必需作业全红）说明这类“配置与门禁各说各话”必须先被测试挡住。
    """

    def declared_jobs(self) -> set[str]:
        """取回 ci.yml 中 jobs 段声明的全部作业名（不与 on、env 等顶层键混淆）。"""
        text = WORKFLOW.read_text(encoding="utf-8")
        assert "\njobs:\n" in text, "工作流必须包含 jobs 段"
        jobs_text = text.split("\njobs:\n", 1)[1]
        return set(re.findall(r"^  ([A-Za-z_][\w-]*):\n", jobs_text, re.MULTILINE))

    def gate_needs(self) -> set[str]:
        """取回汇总作业 needs 列表中的作业名，作为门禁实际比对的集合。"""
        needs = re.search(r"^    needs:\n((?:      - [\w-]+\n)+)", job_section("gate"), re.MULTILINE)
        assert needs, "汇总作业必须显式声明 needs"
        return set(re.findall(r"- ([\w-]+)", needs.group(1)))

    def test_required_jobs_match_workflow_jobs(self) -> None:
        """工作流只允许声明必需作业与汇总作业，避免出现没人核对结果的多余作业。"""
        assert self.declared_jobs() == gate.JOBS | {"gate"}

    def test_gate_needs_equals_required_jobs(self) -> None:
        """汇总作业的 needs 必须与 JOBS 完全相等：少一个就会漏判，多一个会永远失败。"""
        assert self.gate_needs() == gate.JOBS

    def test_every_required_job_is_really_defined(self) -> None:
        """JOBS 里每个名字都必须对应真实作业段，防止只改常量造成假门禁。"""
        for name in sorted(gate.JOBS):
            assert job_section(name).strip(), f"{name} 没有可核对的作业内容"


class TestDependencyAndFailureReportWiring:
    """核对作业自己安装锁定依赖，并在失败时也上传真实存在的测试摘要。

    历史缺陷（run 37187078778）：docs_tools 未安装 Python 检查依赖而退出 2；
    frontend 的失败用例写入 runner 临时 JSON 却没上传，云端无法定位真实失败原因。
    """

    REQUIREMENTS = ROOT / "scripts" / "workflow" / "requirements-ci.txt"
    INSTALL = "python -m pip install --require-hashes -r scripts/workflow/requirements-ci.txt"

    def locked_packages(self) -> set[str]:
        """取回锁定文件里的包名，逐个要求固定版本且至少登记一条 sha256 摘要。

        Returns:
            规范化后的包名集合（小写、下划线转连字符）。
        Raises:
            AssertionError: 出现未固定版本、未登记摘要或重复声明的依赖。
        """
        packages: dict[str, int] = {}
        current: str | None = None
        for raw in self.REQUIREMENTS.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            start = re.match(r"^([A-Za-z0-9_.\-]+)==([^\s\\]+)(.*)$", line)
            if start:
                current = start.group(1).lower().replace("_", "-")
                assert current not in packages, f"依赖重复声明：{current}"
                packages[current] = 0
                line = start.group(3)
            assert current, f"依赖续行没有对应声明：{line}"
            packages[current] += len(re.findall(r"--hash=sha256:[0-9a-f]{64}", line))
        assert packages, "锁定依赖文件不能为空"
        for name, hashes in sorted(packages.items()):
            assert hashes, f"依赖缺少 sha256 摘要：{name}"
        return set(packages)

    @pytest.mark.parametrize("name", ["markdown-it-py", "mdurl", "pyyaml"])
    def test_document_checks_dependencies_are_locked(self, name: str) -> None:
        """文档检查实际导入的 Markdown 解析器、其依赖与 PyYAML 都必须在锁定文件中。"""
        assert name in self.locked_packages()

    @pytest.mark.parametrize("job", ["docs_tools", "backend", "browser_e2e"])
    def test_python_consuming_jobs_install_locked_requirements(self, job: str) -> None:
        """凡是执行仓库内 Python 检查的作业都要自己安装同一个锁定文件。"""
        assert self.INSTALL in job_section(job), f"{job} 必须安装锁定依赖"

    def test_document_checks_install_happens_in_the_consuming_job(self) -> None:
        """反例：依赖只能靠 docs_tools 自己安装，不能假定其他作业装过。"""
        docs = job_section("docs_tools")
        install = step_named("docs_tools", "安装固定版本的 CI 工具依赖")
        assert self.INSTALL in install and "if:" not in install
        # 文档检查必须在该安装之后的步骤里运行，避免顺序颠倒成“先检查后装依赖”。
        assert docs.index(self.INSTALL) < docs.index("run_checks.py --group docs")

    @pytest.mark.parametrize("job", ["docs_tools", "frontend", "backend", "browser_e2e"])
    def test_failure_reports_are_uploaded_always(self, job: str) -> None:
        """四个必需作业都必须在失败时也上传真实路径上的测试摘要或报告。"""
        uploads = [part for part in re.split(r"\n      - ", job_section(job))
                   if "actions/upload-artifact@v4" in part and "if: always()" in part]
        assert uploads, f"{job} 缺少 if: always() 的失败报告上传"
        for part in uploads:
            # 上传位置必须指向本次运行真实写出的 runner 临时文件或 Maven 报告目录。
            assert "${{ runner.temp }}" in part or "target/surefire-reports" in part, part
            assert "if-no-files-found: warn" in part, "失败上传不得因缺文件改变作业结论"


class TestWorkflowOutputWiring:
    """对全部作业输出做结构性核对，不只核对历史上出过问题的那两处。

    历史缺陷有两类：引用不存在的步骤（backend 曾绑定 `steps.stage`），以及只声明输出名
    却没人在 `GITHUB_OUTPUT` 里写入同名值。逐条字符串断言只能覆盖已知位置，这里改成
    对整份工作流的引用与写入方逐一比对，防止同类缺陷在别处重新出现。
    """

    def step_blocks(self, job: str) -> dict[str, str]:
        """按 `id` 取回作业内每个步骤的文本块，供核对谁真的写出了该输出。

        Args:
            job: 工作流中两空格缩进的作业名。
        Returns:
            步骤 id 到该步骤文本块（从 `- ` 到下一个步骤之前）的映射。
        Raises:
            AssertionError: 作业不存在，或同一作业内出现重复步骤 id。
        """
        blocks: dict[str, str] = {}
        for part in re.split(r"\n      - ", job_section(job))[1:]:
            found = re.search(r"^\s*id:\s*([A-Za-z_][\w-]*)\s*$", part, re.MULTILINE)
            if found:
                assert found.group(1) not in blocks, f"{job} 出现重复步骤 id：{found.group(1)}"
                blocks[found.group(1)] = part
        return blocks

    def writes_output(self, block: str, name: str) -> bool:
        """判断步骤是否真的把 `name` 写进 `GITHUB_OUTPUT`，含它所调用的仓库脚本。

        Args:
            block: 单个步骤的 YAML 文本块。
            name: 期望写入的输出名。
        Returns:
            shell 的 printf/echo、Python 的 `stream.write`，或该步骤调用的仓库脚本中
            存在同名写入时为 True。
        """
        texts = [block]
        for relative in re.findall(r"scripts/[\w./-]+\.py", block):
            path = ROOT / relative
            if path.is_file():
                texts.append(path.read_text(encoding="utf-8"))
        patterns = (rf"printf\s+['\"]?{re.escape(name)}=", rf"echo\s+['\"]?{re.escape(name)}=",
                    rf"\.write\(\s*f?['\"]{re.escape(name)}=")
        return any(re.search(pattern, text) for text in texts for pattern in patterns)

    @pytest.mark.parametrize("job", ["docs_tools", "frontend", "backend", "browser_e2e", "gate"])
    def test_every_step_output_reference_resolves(self, job: str) -> None:
        """反例：任何 `steps.<id>.outputs.<name>` 的 `<id>` 都必须是本作业真实存在的步骤。"""
        ids = set(self.step_blocks(job))
        references = re.findall(r"steps\.([A-Za-z_][\w-]*)\.outputs\.([A-Za-z_][\w-]*)", job_section(job))
        for step_id, output_name in references:
            assert step_id in ids, f"{job} 引用了不存在的步骤 id：steps.{step_id}.outputs.{output_name}"

    @pytest.mark.parametrize("job", ["docs_tools", "frontend", "backend", "browser_e2e"])
    def test_declared_job_outputs_are_really_written(self, job: str) -> None:
        """作业级输出必须由被引用步骤真实写入同名值，名字不一致或没人写入都失败。"""
        section = job_section(job)
        # 作业级键固定 4 空格缩进，输出项为 6 空格；块内允许注释行，不假设没有注释。
        declared_block = re.search(r"^    outputs:\n(.*?)(?=^    \w|\Z)", section, re.MULTILINE | re.DOTALL)
        assert declared_block, f"{job} 缺少作业级 outputs 声明"
        declared = re.findall(r"^      ([\w-]+):\s*\$\{\{\s*steps\.([\w-]+)\.outputs\.([\w-]+)\s*\}\}\s*$",
                              declared_block.group(1), re.MULTILINE)
        assert declared, f"{job} 的作业级 outputs 必须逐项绑定真实步骤输出"
        blocks = self.step_blocks(job)
        for name, step_id, output_name in declared:
            assert output_name == name, f"{job}.outputs.{name} 绑定了不同名的步骤输出：{output_name}"
            assert step_id in blocks, f"{job}.outputs.{name} 绑定了不存在的步骤：{step_id}"
            assert self.writes_output(blocks[step_id], name), \
                f"{job}.outputs.{name} 没有被 steps.{step_id} 真实写入 GITHUB_OUTPUT"

    def test_frontend_release_runs_static_gate_before_coverage_verdict(self) -> None:
        """发布阶段必须先真实执行前端静态检查，再进入覆盖率裁决。

        覆盖率裁决在最终阶段会复核静态检查证据：缺少这一步时作业会 fail-closed，
        但失败原因会落在覆盖率步骤上，掩盖真正的接线缺失。这里把顺序固定下来。
        """
        section = job_section("frontend")
        names = re.findall(r"^      - name:\s*(.+?)\s*$", section, re.MULTILINE)
        static_step = "完整静态检查（发布阶段）"
        verdict_step = "发布阶段前端覆盖率裁决"
        assert static_step in names, f"前端作业缺少发布阶段静态检查步骤：{static_step}"
        assert verdict_step in names, f"前端作业缺少发布阶段覆盖率裁决步骤：{verdict_step}"
        assert names.index(static_step) < names.index(verdict_step), \
            "发布阶段静态检查必须排在覆盖率裁决之前，否则裁决读不到本次证据"
        static_block = section.split(f"- name: {static_step}", 1)[1].split("\n      - ", 1)[0]
        assert "static_gate.py --kind web --execute" in static_block, \
            "发布阶段静态检查步骤必须真实执行 static_gate.py --kind web --execute"
        assert "inputs.stage == 'release'" in static_block, \
            "发布阶段静态检查步骤必须限定在 release 阶段执行"


class TestCommandLine:
    """CLI 必须在失败时受控退出，且不把上游内容或凭据写进输出。"""

    def run(self, environment: dict[str, str], *arguments: str) -> subprocess.CompletedProcess[str]:
        """以干净环境执行真实 CLI，返回完整输出与退出码。"""
        return subprocess.run([sys.executable, "-B", "-X", "utf8", str(SCRIPT), *arguments],
                              cwd=ROOT, env={"PATH": os.environ.get("PATH", ""), **environment},
                              capture_output=True, text=True, timeout=120, check=False)

    def test_aggregate_success_exits_zero(self, clean_source: Path) -> None:
        """合法 needs 且来源零阻断时输出摘要并返回 0。"""
        done = self.run({"NEEDS_JSON": json.dumps(needs())}, "aggregate", "--stage", "audit",
                        "--source-root", str(clean_source))
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
        """正例：发布证据与来源验收报告都齐备且零阻断时才输出发布结论并返回 0。"""
        directory = evidence_directory(tmp_path)
        root = source_tree(tmp_path / "clean-source")
        report = write_source_report(root, REVISION, directory=directory)
        done = self.run({"NEEDS_JSON": json.dumps(release_needs()), "RELEASE_EVIDENCE": str(directory),
                         "CI_REVISION": REVISION}, "aggregate", "--stage", "release",
                        "--source-root", str(root))
        assert done.returncode == 0, done.stderr
        summary = json.loads(done.stdout)
        assert summary["release_verified"] is True
        assert summary["release_evidence"]["revision"] == REVISION
        assert summary["source_acceptance"]["report"] == str(report)

    def test_release_with_blockers_exits_one_and_outputs_false(self, tmp_path: Path) -> None:
        """反例：作业全绿、来源报告仍有已登记阻断时，汇总必须退出 1 并输出 false。"""
        directory = evidence_directory(tmp_path)
        root = source_tree(tmp_path / "blocked-source", blocked=1)
        write_source_report(root, REVISION, directory=directory)
        done = self.run({"NEEDS_JSON": json.dumps(release_needs()), "RELEASE_EVIDENCE": str(directory),
                         "CI_REVISION": REVISION}, "aggregate", "--stage", "release",
                        "--source-root", str(root))
        assert done.returncode == 1
        summary = json.loads(done.stdout)
        assert summary["status"] == "blocked" and summary["release_verified"] is False
        assert summary["source_acceptance"]["counts"]["hard_failures"] == 1
        assert "Traceback" not in done.stderr

    def test_release_without_source_report_exits_one(self, tmp_path: Path) -> None:
        """反例：删除来源报告后发布汇总受控失败，不输出成功结论。"""
        directory = evidence_directory(tmp_path)
        root = source_tree(tmp_path / "clean-source")
        done = self.run({"NEEDS_JSON": json.dumps(release_needs()), "RELEASE_EVIDENCE": str(directory),
                         "CI_REVISION": REVISION}, "aggregate", "--stage", "release",
                        "--source-root", str(root))
        assert done.returncode == 1
        assert done.stdout == ""
        assert "来源验收报告" in done.stderr and "Traceback" not in done.stderr

    def test_release_flags_accepted_from_cli(self, tmp_path: Path) -> None:
        """正例：目录、提交标识与来源报告也可以由显式参数提供。"""
        directory = evidence_directory(tmp_path)
        root = source_tree(tmp_path / "clean-source")
        report = write_source_report(root, REVISION)
        done = self.run({"NEEDS_JSON": json.dumps(release_needs())}, "aggregate", "--stage", "release",
                        "--release-evidence", str(directory), "--revision", REVISION,
                        "--source-report", str(report), "--source-root", str(root))
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

    def test_extra_output_key_does_not_break_aggregation(self, clean_source: Path) -> None:
        """合法阶段与计数下，上游附带的其他输出键不影响聚合结论。"""
        secret = "DUMMY-ghp-EXTRAKEYVALUE0987654321"
        payload = json.dumps(needs(backend={"stage": "audit", "checked": "1", "token": secret}))
        result = self.run({"NEEDS_JSON": payload}, "aggregate", "--stage", "audit",
                          "--source-root", str(clean_source))
        assert result.returncode == 0, result.stderr
        assert secret not in result.stdout
