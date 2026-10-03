"""验证 CI 证据核对：正常聚合、受控反例失败、报告真伪与输出脱敏。

反例重点覆盖上游 $GITHUB_OUTPUT 产生的非字典 outputs：它曾抛出未捕获的
AttributeError，使门禁以 traceback 而非受控失败退出。

@author OpenAI Codex
"""

from __future__ import annotations

import json
import os
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


def needs(stage: str = "audit", result: str = "success", **outputs: object) -> dict[str, object]:
    """构造固定三作业的 needs 上下文；额外关键字参数按作业名覆盖 outputs。"""
    context: dict[str, object] = {}
    for name in sorted(gate.JOBS):
        context[name] = {"result": result, "outputs": {"stage": stage, "checked": "4"}}
    for name, value in outputs.items():
        context[name] = {"result": result, "outputs": value}
    return context


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


class TestBackendWorkflow:
    """核对真实 backend 命令的测试选择，防止报告门禁之外漏跑集成或普通单测。"""

    def patterns(self) -> list[str]:
        """提取 backend 的 Surefire 选择参数；缺省时按其四种单测命名判断覆盖。"""
        backend = WORKFLOW.read_text(encoding="utf-8").split("\n  backend:", 1)[1].split("\n  gate:", 1)[0]
        commands = [shlex.split(line.strip()[5:]) for line in backend.splitlines()
                    if line.strip().startswith("run: mvn ")]
        assert len(commands) == 1, "backend 必须有唯一可核对的 Maven 测试命令"
        command = commands[0]
        assert command[-1] == "test", "backend 命令必须实际执行测试阶段"
        selection = next((item.removeprefix("-Dtest=") for item in command if item.startswith("-Dtest=")),
                         "Test*,*Test,*Tests,*TestCase")
        return selection.split(",")

    def test_every_integration_class_is_selected(self) -> None:
        """所有现存 *IT 必须被真实命令选中，新增集成类也不能被默认 Surefire 范围漏掉。"""
        classes = sorted(path.stem for path in (ROOT / "后端代码" / "basic-framework-boot").glob("**/src/test/java/**/*IT.java"))
        assert classes, "集成测试来源为空，无法证明执行范围"
        patterns = self.patterns()
        missing = [name for name in classes if not any(fnmatchcase(name, pattern) for pattern in patterns)]
        assert not missing, f"backend 漏选集成测试：{missing}"

    @pytest.mark.parametrize("classname", ["TestLegacy", "LegacyTest", "LegacyTests", "LegacyTestCase"])
    def test_default_unit_test_names_remain_selected(self, classname: str) -> None:
        """加入 *IT 后仍须保留 Surefire 默认四种单测命名，不能以专项替换普通回归。"""
        assert any(fnmatchcase(classname, pattern) for pattern in self.patterns())


class TestAggregate:
    """固定作业必须真实成功、有正整数计数且阶段一致才允许通过。"""

    def test_normal_aggregation_reports_counts(self) -> None:
        """三个作业全部成功时返回阶段、状态与逐作业用例数。"""
        result = gate.aggregate(needs(), "audit")
        assert result == {"schema": "ci-summary/v1", "stage": "audit", "status": "passed",
                          "tests": {"backend": 4, "docs_tools": 4, "frontend": 4},
                          "release_verified": False}

    @pytest.mark.parametrize("stage", STAGES)
    def test_release_flag_only_for_release(self, stage: str) -> None:
        """只有 release 阶段才允许标记发布已验证，审计通过不能顶替发布。"""
        assert gate.aggregate(needs(stage), stage)["release_verified"] is (stage == "release")

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
        secret = "ghp-SUPERSECRETTOKENVALUE1234567890"
        # checked 非正整数使聚合必然失败，同时保留一个真实令牌字段作为泄漏源。
        payload = json.dumps(needs(backend={"stage": "audit", "checked": "0", "token": secret}))
        result = self.run({"NEEDS_JSON": payload}, "aggregate", "--stage", "audit")
        assert result.returncode == 1
        assert secret not in result.stdout and secret not in result.stderr
        assert "Traceback" not in result.stderr

    def test_extra_output_key_does_not_break_aggregation(self) -> None:
        """合法阶段与计数下，上游附带的其他输出键不影响聚合结论。"""
        secret = "ghp-EXTRAKEYVALUE0987654321"
        payload = json.dumps(needs(backend={"stage": "audit", "checked": "1", "token": secret}))
        result = self.run({"NEEDS_JSON": payload}, "aggregate", "--stage", "audit")
        assert result.returncode == 0, result.stderr
        assert secret not in result.stdout
