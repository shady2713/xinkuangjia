"""用独立源码与覆盖率样本验证逐文件分母、生成来源和最终门槛。

@author OpenAI Codex
"""

from __future__ import annotations

import json
import importlib.util
import os
import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

import pytest

from scripts.workflow import coverage_gate as gate


def java_source(root: Path, name: str = "Value.java", content: str | None = None) -> Path:
    """在测试拥有的真实后端目录布局中写入生产源码。"""
    path = root / gate.BACKEND / "module/src/main/java/demo" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content or "package demo; public class Value { public int value() { return 1; } }", encoding="utf-8")
    return path


def java_report(root: Path, entries: dict[str, tuple[int, int, int, int]]) -> Path:
    """写独立 JaCoCo 结构样本，计数顺序为行未覆盖/覆盖、方法未覆盖/覆盖。"""
    path = root / gate.BACKEND / "module/target/site/jacoco/jacoco.xml"
    path.parent.mkdir(parents=True, exist_ok=True)
    report = ET.Element("report")
    package = ET.SubElement(report, "package", name="demo")
    for name, counters in entries.items():
        node = ET.SubElement(package, "sourcefile", name=name)
        for kind, values in (("LINE", counters[:2]), ("METHOD", counters[2:])):
            ET.SubElement(node, "counter", type=kind, missed=str(values[0]), covered=str(values[1]))
    path.write_bytes(ET.tostring(report))
    return path


def java_pmd(root: Path) -> Path:
    """写一份真实形状的 PMD 报告与绑定配置，满足最终阶段的静态检查证据要求。"""
    ruleset = root / gate.BACKEND / "config/pmd/basic-framework-ruleset.xml"
    ruleset.parent.mkdir(parents=True, exist_ok=True)
    ruleset.write_text('<ruleset name="demo"/>', encoding="utf-8")
    (root / gate.BACKEND / "pom.xml").write_text("<project/>", encoding="utf-8")
    source = root / gate.BACKEND / "module/src/main/java/demo/Value.java"
    path = root / gate.BACKEND / "module/target/pmd.xml"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f'<?xml version="1.0" encoding="UTF-8"?><pmd xmlns="{gate.static_gate.PMD_NAMESPACE}" '
                    f'version="7.17.0" timestamp="2026-10-04T14:58:57.450" '
                    f'data-source="{source}"/>', encoding="utf-8")
    return path


def web_source(root: Path, name: str = "value.ts", content: str | None = None) -> Path:
    """写入应用源码，名字含未导入或 vendored 字样也属于普通生产分母。"""
    path = root / gate.FRONTEND / "apps/demo/src" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content or "export function value() { return 1; }", encoding="utf-8")
    return path


def web_entry(statements: dict[str, int] | None = None, functions: dict[str, int] | None = None) -> dict[str, object]:
    """生成与计数键一一对应的最小 Istanbul 位置映射。"""
    statements = {"0": 1} if statements is None else statements
    functions = {"0": 1} if functions is None else functions
    return {"s": statements, "f": functions,
            "statementMap": {key: {"start": {"line": int(key) + 1, "column": 0}} for key in statements},
            "fnMap": {key: {} for key in functions}}


def web_inputs(root: Path, unverified: list[str] | None = None) -> Path:
    """写出本次测量的输入指纹清单，对应 provider 的正常产物。

    Args:
        root: 测试拥有的仓库根，前端范围固定为门禁的 FRONTEND。
        unverified: 提供者报告的脚本坐标不可信文件清单，缺省为空。
    Returns:
        清单路径；必须早于报告写出，门禁才接受报告绑定到当前测量输入。
    """
    path = root / gate.FRONTEND / "coverage/coverage-inputs.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"schema": gate.WEB_INPUTS_SCHEMA, "inputs": gate.web_coverage_inputs(root),
                    "unverifiedOffsets": unverified or []}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8", newline="\n")
    return path


def web_report(root: Path, entries: dict[Path, dict[str, object]]) -> Path:
    """保存只属于当前反例的 JSON 覆盖率报告，并先写下与其绑定的输入指纹清单。

    门禁要求报告携带本次测量输入指纹：provider 先写清单再写报告，夹具按同一顺序生成，
    因此正常场景不会因缺少指纹被判过期证据。
    """
    web_inputs(root)
    path = root / gate.FRONTEND / "coverage/coverage-final.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({str(key): value for key, value in entries.items()}), encoding="utf-8")
    return path


@pytest.mark.parametrize("counters", [(1, 10, 0, 2), (0, 10, 1, 2)])
def test_backend_per_file_requires_lines_and_methods(tmp_path: Path, counters: tuple[int, int, int, int]) -> None:
    """总体比例再高也不能掩盖一个文件缺行或缺方法。"""
    java_source(tmp_path)
    java_report(tmp_path, {"Value.java": counters})
    result = gate.backend_report(tmp_path)
    assert gate.conclude(result, "full") == 1
    assert result["files"][0]["status"] == "failed"


def test_audit_does_not_claim_final_pass(tmp_path: Path) -> None:
    """存量审计可完成采集，但包含缺口时不能写成最终门禁通过。"""
    java_source(tmp_path)
    java_report(tmp_path, {"Value.java": (1, 1, 1, 1)})
    result = gate.backend_report(tmp_path)
    assert gate.conclude(result, "audit") == 0
    assert result["status"] == "audit-findings"
    assert result["thresholds"]["lines"] == 100


@pytest.mark.parametrize("with_report", [False, True])
def test_backend_missing_production_source_fails(tmp_path: Path, with_report: bool) -> None:
    """未编译/未报告的生产类不能从分母静默消失。"""
    java_source(tmp_path, "NeverLoaded.java")
    if with_report:
        java_report(tmp_path, {})
    result = gate.backend_report(tmp_path)
    assert gate.conclude(result, "full") == 2
    assert result["problems"]


@pytest.mark.parametrize("kind", ["backend", "web"])
def test_empty_project_is_not_a_passing_gate(tmp_path: Path, kind: str) -> None:
    """全空工程和空覆盖率报告不能签发成功。"""
    result = gate.backend_report(tmp_path) if kind == "backend" else gate.web_report(tmp_path, web_report(tmp_path, {}))
    assert gate.conclude(result, "full") == 1
    assert result["status"] == "not-applicable"


@pytest.mark.parametrize("content,declaration", [
    ("package demo; public interface Value { int value(); }", True),
    ('package demo; public interface Value { int ONE = 1; String NAME = "name"; }', True),
    ("package demo; public interface Value { int RANDOM = Factory.create(); }", False),
    ("package demo; public interface Value { default int value() { return 1; } }", False),
    ('package demo; @Target({ElementType.FIELD}) @Constraint(validatedBy = Validator.class) public @interface Value { Class<?>[] groups() default {}; }', True),
    ('package demo; import lombok.Data; @Data public class Value { private String value; }', True),
    ('package demo; import lombok.Data; @Data public class Value { private String value; public int answer() { return 1; } }', False),
    ('package demo; import lombok.Data; @Data public class Value { private String value = Factory.create(); }', True),
    ('package demo; import fake.Data; @Data public class Value { private String value; }', False),
    ("package demo; public class Value { }", False),
    # 通配导入与逐项导入同源，缺失 lombok 包导入时不得按简单名误判。
    ('package demo; import lombok.*; @Data @EqualsAndHashCode(callSuper = true) public class Value extends Base { private Long id; }', True),
    ('package demo; @Data public class Value { private String value = "token"; }', False),
    # 字段初始化器编译进 Lombok 生成的构造器，与 getter/setter 同属 JaCoCo 过滤范围。
    ('package demo; import lombok.Data; @Data public class Value { private String header = "Authorization"; private List<String> urls = Collections.emptyList(); }', True),
    # 注解实参的等号不是初始化器，不能因此否掉纯字段类型。
    ('package demo; import lombok.Data; import jakarta.validation.constraints.NotEmpty; @Data public class Value { @NotEmpty(message = "不能为空") private String header = "Authorization"; }', True),
    # 以下写法都会让大括号对多于类型声明，属于手写实现，必须留在分母里。
    ('package demo; import lombok.Data; @Data public class Value { private String value; static { init(); } }', False),
    ('package demo; import lombok.Data; @Data public class Value { private int[] size = {1, 2}; }', False),
    ('package demo; import lombok.Data; @Data public class Value { private Runnable task = new Runnable() { public void run() { } }; }', False),
    ('package demo; import lombok.Data; @Data public class Value { private String value; { value = "x"; } }', False),
    ('package demo; import lombok.Data; @Data public class Value { public void go() throws Exception { } }', False),
    ('package demo; import lombok.Data; @Data public class Value { private Runnable task = () -> { }; }', False),
    # 无 Lombok 构造注解时，字段初始化器不足以证明是纯声明。
    ('package demo; @Data public class Value { private String header = "token"; }', False),
    # 嵌套类型同样按类型声明计账，仍然是纯声明。
    ('package demo; import lombok.Data; @Data public class Value { private Long id; @Data public static class UserVO { private Long userId; } }', True),
    ('package demo; import lombok.Data; @Data public class Value { private String code; public interface Group { } }', True),
    ('package demo; import lombok.Data; @Data public class Value { private Runnable task = this::go; }', True),
    # 手写私有构造是防实例化守卫的真实字节码，不能因为"看起来只有常量"就当作声明。
    ('package demo; public final class Value { public static final String TOKEN = "DUMMY"; private Value() { } }', True),
    ('package demo; public final class Value { public static final String TOKEN = "DUMMY"; private Value() { throw new IllegalStateException(); } }', False),
    ('package demo; public final class Value { public static final String TOKEN = "DUMMY"; public static String get() { return TOKEN; } }', False),
    ('package demo; public class Value { public static final String TOKEN = "DUMMY"; private Value() { } }', False),
    ('package demo; public final class Value { public static final String TOKEN = "DUMMY"; static { init(); } private Value() { } }', False),
    ('package demo; public final class Value { public static final String TOKEN = "DUMMY"; private String cache = load(); private Value() { } }', False),
    ('package demo; public final class Value { public static final String TOKEN = build("DUMMY"); private Value() { } }', False),
    ('package demo; public final class Value { public static final String TOKEN = "DUMMY"; public Value() { } }', False),
    ('package demo; public final class Value { static final int MAX = 100; static final boolean ON = true; private Value() { } }', True),
])
def test_zero_java_counts_require_independent_declaration(tmp_path: Path, content: str, declaration: bool) -> None:
    """纯接口是 N/A；默认方法或普通类被过滤为零必须阻断。"""
    java_source(tmp_path, content=content)
    java_report(tmp_path, {"Value.java": (0, 0, 0, 0)})
    result = gate.backend_report(tmp_path)
    assert gate.conclude(result, "full") == (1 if declaration else 2)
    assert result["files"][0]["lines"]["percent"] is None


def test_handwritten_convertimpl_remains_in_denominator(tmp_path: Path) -> None:
    """名字像生成类的手写文件依然按生产代码逐文件要求覆盖。"""
    java_source(tmp_path, "ManualConvertImpl.java")
    java_report(tmp_path, {"ManualConvertImpl.java": (2, 0, 1, 0)})
    result = gate.backend_report(tmp_path)
    assert gate.conclude(result, "full") == 1
    assert not result["generated"]


@pytest.mark.parametrize("origin,marker", [(False, True), (True, False), (True, True)])
def test_generated_partition_requires_source_and_marker(tmp_path: Path, origin: bool, marker: bool) -> None:
    """生成分区同时要求受管 Mapper 来源和真实处理器标记，输出名称不限 ConvertImpl。"""
    java_source(tmp_path, "Mapper.java", "package demo; " + ("import org.mapstruct.Mapper; @Mapper " if origin else "") + "public interface Mapper { int value(); }")
    java_source(tmp_path)
    generated = tmp_path / gate.BACKEND / "module/target/generated-sources/annotations/demo/GeneratedMapping.java"
    generated.parent.mkdir(parents=True)
    generated.write_text('package demo; import javax.annotation.processing.Generated; ' + ('@Generated(value = "org.mapstruct.ap.MappingProcessor") ' if marker else "") + 'public class GeneratedMapping implements Mapper { }', encoding="utf-8")
    java_report(tmp_path, {"Mapper.java": (0, 0, 0, 0), "Value.java": (0, 1, 0, 1), "GeneratedMapping.java": (2, 0, 1, 0)})
    result = gate.backend_report(tmp_path)
    assert gate.conclude(result, "full") == (0 if origin and marker else 2)
    assert len(result["generated"]) == (1 if origin and marker else 0)


def test_generated_annotation_on_handwritten_source_is_rejected(tmp_path: Path) -> None:
    """给手写方法/类加 Generated 不能让 JaCoCo 过滤成为零覆盖率通过。"""
    java_source(tmp_path, content="package demo; @Generated public class Value {}")
    java_report(tmp_path, {"Value.java": (0, 0, 0, 0)})
    result = gate.backend_report(tmp_path)
    assert gate.conclude(result, "full") == 2
    assert any(item["rule"] == "generated-marker-in-handwritten-source" for item in result["problems"])


@pytest.mark.parametrize("name", ["unimported.ts", "vendored/editor.ts", "other.mts"])
def test_web_missing_source_is_not_removed_from_denominator(tmp_path: Path, name: str) -> None:
    """从未导入、第三方内拷贝或 MTS 源码漏出报告都必须失败。"""
    path = web_source(tmp_path)
    web_source(tmp_path, name)
    result = gate.web_report(tmp_path, web_report(tmp_path, {path: web_entry()}))
    assert gate.conclude(result, "release") == 2
    assert any(name in item["path"] for item in result["problems"])


@pytest.mark.parametrize("statements,functions", [({"0": 0}, {"0": 1}), ({"0": 1}, {"0": 0})])
def test_web_final_gate_requires_lines_and_functions(tmp_path: Path, statements: dict[str, int], functions: dict[str, int]) -> None:
    """行覆盖与函数覆盖分别阻断最终交付。"""
    path = web_source(tmp_path)
    result = gate.web_report(tmp_path, web_report(tmp_path, {path: web_entry(statements, functions)}))
    assert gate.conclude(result, "release") == 1


def test_web_tests_alone_do_not_prove_production_coverage(tmp_path: Path) -> None:
    """只有测试文件时保留排除理由且整组无实测对象，不能报通过。"""
    web_source(tmp_path, "value.test.ts")
    result = gate.web_report(tmp_path, web_report(tmp_path, {}))
    assert gate.conclude(result, "full") == 1
    assert result["excluded"][0]["reason"] == "test"


def test_web_zero_uses_real_parser_for_type_declaration(tmp_path: Path) -> None:
    """调用真实 TS 解析器区分接口与未统计到的函数实现。"""
    declaration = web_source(tmp_path, "types.ts", "export interface Value { id: string }")
    runtime = web_source(tmp_path)
    result = gate.web_report(tmp_path, web_report(tmp_path, {declaration: web_entry({}, {}), runtime: web_entry({}, {})}))
    assert gate.conclude(result, "full") == 2
    assert {item["status"] for item in result["files"]} == {"not-applicable", "invalid-zero"}


def test_web_sfc_script_lang_decides_parser(tmp_path: Path) -> None:
    """lang="tsx" 的 SFC 必须按 TSX 解析；按纯 TS 解析会让 JSX 语法错误拖垮整个声明核对。"""
    declaration = web_source(tmp_path, "types.vue", '<script lang="tsx">\nexport interface Value { id: string }\n</script>\n')
    render = web_source(tmp_path, "render.vue", '<script lang="tsx">\nexport default () => <div>ok</div>;\n</script>\n')
    runtime = web_source(tmp_path)
    result = gate.web_report(tmp_path, web_report(tmp_path, {
        declaration: web_entry({}, {}), render: web_entry({}, {}), runtime: web_entry({}, {}),
    }))
    statuses = {item["path"].rsplit("/", 1)[-1]: item["status"] for item in result["files"]}
    # 纯声明的 TSX 组件是 N/A；带 JSX 运行时的是实现，零计数必须被阻断而不是被豁免。
    assert statuses["types.vue"] == "not-applicable"
    assert statuses["render.vue"] == "invalid-zero"
    assert not result["problems"]


def test_web_source_enumeration_prunes_dependency_trees(tmp_path: Path) -> None:
    """剪枝不得改变纳管口径：node_modules 与 dist 里的源码始终不进分母。

    性能来自下降前剪枝而不是事后过滤，这两条路径输出相同，因此本用例只锁住口径；
    耗时由真实前端工程的枚举计时单独观察。
    """
    source = web_source(tmp_path)
    nested = tmp_path / gate.FRONTEND / "packages/demo/node_modules/dep/src"
    nested.mkdir(parents=True)
    (nested / "vendored.ts").write_text("export const value = 1;", encoding="utf-8")
    (tmp_path / gate.FRONTEND / "packages/demo/dist/src").mkdir(parents=True)
    (tmp_path / gate.FRONTEND / "packages/demo/dist/src/bundle.ts").write_text("export const v = 1;", encoding="utf-8")
    sources, _ = gate.web_sources(tmp_path)
    assert sources == [source]


@pytest.mark.parametrize("count", [-1, True, "1"])
def test_malformed_istanbul_counts_are_rejected(count: object) -> None:
    """无效计数不能被 truthiness 或整数转换吞掉。"""
    with pytest.raises(ValueError):
        gate.istanbul_metrics(web_entry({"0": count}))


def test_real_cli_fails_on_uncovered_unicode_path(tmp_path: Path) -> None:
    """真实入口消费含中文路径的独立报告并保留最终门禁失败退出码。"""
    root = tmp_path / "中文工程"
    java_source(root)
    java_report(root, {"Value.java": (1, 0, 1, 0)})
    java_pmd(root)
    result = subprocess.run([sys.executable, "-B", "-X", "utf8", str(Path(gate.__file__)), "--root", str(root), "--kind", "backend", "--stage", "full", "--json"], capture_output=True, timeout=30)
    assert result.returncode == 1
    data = json.loads(result.stdout)
    assert data["failed_files"] == 1
    assert data["validates_test_execution"] is False
    # 最终阶段的发布证据必须同时带真实静态检查结论。
    assert data["static_analysis"]["status"] == "passed"


def test_audit_stage_cli_does_not_require_static_evidence(tmp_path: Path) -> None:
    """回归反例：audit 阶段只报告缺口，不得要求发布阶段的静态检查证据。"""
    source = web_source(tmp_path)
    report = web_report(tmp_path, {source: web_entry({"0": 0}, {"0": 0})})
    result = subprocess.run(
        [sys.executable, "-B", "-X", "utf8", str(Path(gate.__file__)), "--root", str(tmp_path),
         "--kind", "web", "--coverage", str(report), "--stage", "audit", "--json"],
        capture_output=True, timeout=60)
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)
    assert data["status"] == "audit-findings"
    assert "static_analysis" not in data


def test_web_report_without_inputs_manifest_is_rejected(tmp_path: Path) -> None:
    """回归反例：计数再全，缺少输入指纹清单的报告仍是过期证据，不能被当次测量接受。"""
    source = web_source(tmp_path)
    report = web_report(tmp_path, {source: web_entry()})
    (report.parent / "coverage-inputs.json").unlink()
    result = gate.web_report(tmp_path, report)
    assert gate.conclude(result, "audit") == 2
    assert result["status"] == "invalid-evidence"
    assert [item["rule"] for item in result["problems"]] == ["missing-coverage-inputs"]


@pytest.mark.parametrize("tamper", ["schema", "inputs", "newer-than-report"])
def test_web_report_with_tampered_inputs_manifest_is_rejected(tmp_path: Path, tamper: str) -> None:
    """回归反例：清单结构、内容或时序与本次测量不符时必须判过期，不得沿用旧计数。"""
    source = web_source(tmp_path)
    report = web_report(tmp_path, {source: web_entry()})
    baseline = report.parent / "coverage-inputs.json"
    prepared = json.loads(baseline.read_text(encoding="utf-8"))
    if tamper == "schema":
        prepared["schema"] = "web-coverage-inputs/v0"
    elif tamper == "inputs":
        prepared["inputs"]["version:vitest"] = "0.0.0"
    baseline.write_text(json.dumps(prepared, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if tamper == "newer-than-report":
        os.utime(baseline, ns=(report.stat().st_mtime_ns + 1_000_000_000,) * 2)
    result = gate.web_report(tmp_path, report)
    assert gate.conclude(result, "audit") == 2
    assert result["status"] == "invalid-evidence"
    assert [item["rule"] for item in result["problems"]] == ["coverage-inputs-changed-or-stale"]


def test_frontend_runner_default_stage_stays_audit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """官方前端默认入口必须以 audit 调用门禁：不要求静态证据，退出码原样传播。"""
    runner = frontend_runner()
    frontend = tmp_path / gate.FRONTEND
    frontend.mkdir(parents=True)
    monkeypatch.setattr(runner, "__file__", str(frontend / "scripts/quality/run_frontend_tests.py"))
    monkeypatch.setattr(sys, "argv", ["runner", "--coverage"])
    monkeypatch.setattr(runner.shutil, "which", lambda name: "node")
    monkeypatch.setattr(runner, "coverage_inputs", lambda root: {"source": "unchanged"})
    commands: list[list[str]] = []

    def execute(command: list[str], *arguments: object) -> int:
        """第一次调用写出新报告，第二次调用是被测门禁且返回通过。"""
        commands.append(command)
        if len(commands) == 1:
            report = frontend / "coverage/coverage-final.json"
            report.parent.mkdir()
            report.write_text("{}", encoding="utf-8")
        return 0

    monkeypatch.setattr(runner, "run_process", execute)
    assert runner.main() == 0
    assert commands[-1][-2:] == ["--stage", "audit"]


def test_frontend_runner_audit_path_runs_real_gate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """官方入口的 audit 参数必须真能被门禁接受：用真实子进程执行改写 --root 的等价入口。"""
    source = web_source(tmp_path)
    report = web_report(tmp_path, {source: web_entry({"0": 0}, {"0": 0})})
    payload = report.read_text(encoding="utf-8")
    report.unlink()
    runner = frontend_runner()
    frontend = tmp_path / gate.FRONTEND
    # 真实 runner 以 root.parents[1] 定位仓库脚本；这里放置只补充 --root 的等价入口。
    wrapper = tmp_path / "scripts/workflow/coverage_gate.py"
    wrapper.parent.mkdir(parents=True)
    wrapper.write_text(
        "import subprocess, sys\n"
        f"sys.exit(subprocess.run([sys.executable, '-B', '-X', 'utf8', {str(Path(gate.__file__))!r},"
        f" '--root', {str(tmp_path)!r}, *sys.argv[1:]]).returncode)\n",
        encoding="utf-8")
    monkeypatch.setattr(runner, "__file__", str(frontend / "scripts/quality/run_frontend_tests.py"))
    monkeypatch.setattr(sys, "argv", ["runner", "--coverage"])
    monkeypatch.setattr(runner.shutil, "which", lambda name: "node")
    monkeypatch.setattr(runner, "coverage_inputs", lambda root: {"source": "unchanged"})
    commands: list[list[str]] = []

    def execute(command: list[str], root: Path, environment: dict[str, str], timeout: int) -> int:
        """第一次调用写出新报告，第二次调用用真实子进程运行改写 root 的门禁。"""
        commands.append(command)
        if len(commands) == 1:
            # 真实 provider 先写输入指纹清单再写报告；这里按同一顺序补上，否则门禁会拒绝无指纹报告。
            web_inputs(tmp_path)
            report.parent.mkdir(parents=True, exist_ok=True)
            report.write_text(payload, encoding="utf-8")
            return 0
        return subprocess.run(command, cwd=root, env=environment, timeout=timeout, check=False).returncode

    monkeypatch.setattr(runner, "run_process", execute)
    assert runner.main() == 0
    assert commands[-1][-2:] == ["--stage", "audit"]


def test_provider_empty_placeholder_does_not_make_types_executable(tmp_path: Path) -> None:
    """Vitest 3.2 对未加载纯类型文件的占位行/函数保留原数值，但纳管分母为 N/A。"""
    declaration = web_source(tmp_path, "types.ts", "export interface Value { id: string }")
    runtime = web_source(tmp_path)
    result = gate.web_report(tmp_path, web_report(tmp_path, {declaration: web_entry({"0": 0}, {"0": 0}), runtime: web_entry()}))
    assert gate.conclude(result, "full") == 0
    item = next(item for item in result["files"] if item["path"].endswith("types.ts"))
    assert item["status"] == "not-applicable"
    assert item["provider_counts"]["functions"]["missed"] == 1


def test_internal_and_shared_vendor_sources_are_in_scope(tmp_path: Path) -> None:
    """构建工具实现及拷入共享包的源文件不能靠所属目录获得排除。"""
    for relative in ("internal/tool/src/tool.ts", "packages/vendor/src/source.ts"):
        path = tmp_path / gate.FRONTEND / relative
        path.parent.mkdir(parents=True)
        path.write_text("export const value = 1;", encoding="utf-8")
    result = gate.web_report(tmp_path, web_report(tmp_path, {}))
    assert gate.conclude(result, "full") == 2
    assert len(result["inventory"]) == 2


@pytest.mark.parametrize("kind", ["backend", "web"])
def test_newer_source_invalidates_old_report(tmp_path: Path, kind: str) -> None:
    """报告之后修改源码不能继续接受旧计数。"""
    source = java_source(tmp_path) if kind == "backend" else web_source(tmp_path)
    report = java_report(tmp_path, {"Value.java": (0, 1, 0, 1)}) if kind == "backend" else web_report(tmp_path, {source: web_entry()})
    os.utime(source, ns=(report.stat().st_mtime_ns + 1_000_000_000,) * 2)
    result = gate.backend_report(tmp_path) if kind == "backend" else gate.web_report(tmp_path, report)
    assert gate.conclude(result, "full") == 2
    assert any(item["rule"] == "source-newer-than-report" for item in result["problems"])


def frontend_runner() -> object:
    """加载真实前端包装器，测试阶段传播时不启动全仓业务测试。"""
    path = gate.DEFAULT_ROOT / gate.FRONTEND / "scripts/quality/run_frontend_tests.py"
    spec = importlib.util.spec_from_file_location("coverage_frontend_runner", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("test_code,gate_code", [(0, 0), (0, 1), (0, 2), (9, 0)])
def test_frontend_runner_preserves_actual_test_and_gate_status(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, test_code: int, gate_code: int
) -> None:
    """真实测试先失败时不能被覆盖率盖掉，测试通过后继续传播最终门禁状态。"""
    runner = frontend_runner()
    frontend = tmp_path / gate.FRONTEND
    frontend.mkdir(parents=True)
    monkeypatch.setattr(runner, "__file__", str(frontend / "scripts/quality/run_frontend_tests.py"))
    monkeypatch.setattr(sys, "argv", ["runner", "--coverage", "--coverage-stage", "release"])
    monkeypatch.setattr(runner.shutil, "which", lambda name: "node")
    monkeypatch.setattr(runner, "coverage_inputs", lambda root: {"source": "unchanged"})
    commands: list[list[str]] = []

    def execute(command: list[str], *arguments: object) -> int:
        """模拟当前调用确实新写报告，第二次调用返回门禁结果。"""
        commands.append(command)
        if len(commands) == 1:
            report = frontend / "coverage/coverage-final.json"
            report.parent.mkdir()
            report.write_text("{}", encoding="utf-8")
            return test_code
        return gate_code

    monkeypatch.setattr(runner, "run_process", execute)
    assert runner.main() == (test_code or gate_code)
    assert len(commands) == (1 if test_code else 2)
    if not test_code:
        assert commands[-1][-2:] == ["--stage", "release"]


@pytest.mark.parametrize("failure", ["missing", "stale", "changed"])
def test_frontend_runner_rejects_unbound_report(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, failure: str
) -> None:
    """没有新报告、旧文件或测试期间修改输入均不得启动成功裁决。"""
    runner = frontend_runner()
    frontend = tmp_path / gate.FRONTEND
    frontend.mkdir(parents=True)
    report = frontend / "coverage/coverage-final.json"
    if failure == "stale":
        report.parent.mkdir()
        report.write_text("{}", encoding="utf-8")
        os.utime(report, ns=(1, 1))
    monkeypatch.setattr(runner, "__file__", str(frontend / "scripts/quality/run_frontend_tests.py"))
    monkeypatch.setattr(sys, "argv", ["runner", "--coverage"])
    monkeypatch.setattr(runner.shutil, "which", lambda name: "node")
    snapshots = iter([{"input": "before"}, {"input": "after"}])
    monkeypatch.setattr(runner, "coverage_inputs", lambda root: next(snapshots))

    def execute(*arguments: object) -> int:
        """仅变更场景输出新报告，另外两种场景保留其缺失或旧状态。"""
        if failure == "changed":
            report.parent.mkdir()
            report.write_text("{}", encoding="utf-8")
        return 0

    monkeypatch.setattr(runner, "run_process", execute)
    assert runner.main() == 2


def test_prepare_clears_old_execution_and_binds_inputs(tmp_path: Path) -> None:
    """准备只重置测试拥有的模块覆盖率文件，旧命中消失且后续改动会使报告失效。"""
    source = java_source(tmp_path)
    module = tmp_path / gate.BACKEND / "module"
    (module / "pom.xml").write_text("<project/>", encoding="utf-8")
    target = module / "target"
    target.mkdir()
    (target / "jacoco.exec").write_bytes(b"old coverage")
    gate.prepare_backend(tmp_path, module)
    assert (target / "jacoco.exec").read_bytes() == b""
    java_report(tmp_path, {"Value.java": (0, 1, 0, 1)})
    assert gate.conclude(gate.backend_report(tmp_path, module, True), "full") == 0
    source.write_text(source.read_text(encoding="utf-8") + "\n// changed\n", encoding="utf-8")
    result = gate.backend_report(tmp_path, module, True)
    assert gate.conclude(result, "full") == 2
    assert any(item["rule"] == "coverage-inputs-changed-or-stale" for item in result["problems"])


def test_final_consumer_requires_preparation(tmp_path: Path) -> None:
    """即使覆盖率计数全满，严格消费入口没有测试前绑定仍需拒绝。"""
    java_source(tmp_path)
    java_report(tmp_path, {"Value.java": (0, 1, 0, 1)})
    result = gate.backend_report(tmp_path, require_prepared=True)
    assert gate.conclude(result, "full") == 2
    assert result["problems"][0]["rule"] == "missing-coverage-preparation"


def surefire_report(module: Path, name: str, text: str = "<testsuite tests='1'/>") -> Path:
    """在模块 target 下写一份 Surefire XML 报告，返回其真实路径。

    Args:
        module: 拥有 target 产物的 Maven 模块目录。
        name: 报告文件名，用于区分同一模块内的不同测试类。
        text: 报告正文，缺省为最小套件形状。
    Returns:
        写出的报告路径，调用方可用 os.utime 伪造其时间戳。
    """
    path = module / "target" / "surefire-reports" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def test_prepare_removes_reports_of_earlier_run(tmp_path: Path) -> None:
    """准备必须整目录清除上一轮测试报告，surefire 只覆盖本轮执行过的测试类。"""
    module = tmp_path / gate.BACKEND / "module"
    (module / "target").mkdir(parents=True)
    (module / "pom.xml").write_text("<project/>", encoding="utf-8")
    stale = surefire_report(module, "TEST-NotSelectedThisRun.xml")
    java_source(tmp_path)
    gate.prepare_backend(tmp_path, module)
    assert not stale.exists()
    assert not (module / "target" / "surefire-reports").exists()


def test_final_consumer_rejects_report_of_earlier_run(tmp_path: Path) -> None:
    """上一轮遗留的测试报告属于无效证据：拒绝签发，而不是继续用它凑读数。"""
    module = tmp_path / gate.BACKEND / "module"
    (module / "target").mkdir(parents=True)
    (module / "pom.xml").write_text("<project/>", encoding="utf-8")
    java_source(tmp_path)
    gate.prepare_backend(tmp_path, module)
    java_report(tmp_path, {"Value.java": (0, 1, 0, 1)})
    inherited = surefire_report(module, "TEST-com.demo.NotSelectedThisRun.xml")
    os.utime(inherited, ns=(1, 1))
    result = gate.backend_report(tmp_path, module, True)
    assert gate.conclude(result, "full") == 2
    assert [item["rule"] for item in result["problems"]] == ["test-report-outside-run"]


def test_run_identity_is_required_for_final_consumer(tmp_path: Path) -> None:
    """没有可核验的运行标识就无法证明产物属于本次运行，最终消费方必须拒绝。"""
    module = tmp_path / gate.BACKEND / "module"
    (module / "target").mkdir(parents=True)
    (module / "pom.xml").write_text("<project/>", encoding="utf-8")
    java_source(tmp_path)
    gate.prepare_backend(tmp_path, module)
    java_report(tmp_path, {"Value.java": (0, 1, 0, 1)})
    baseline = module / "target" / "coverage-inputs.json"
    prepared = json.loads(baseline.read_text(encoding="utf-8"))
    prepared["run"] = {"id": "不是本次运行的标识"}
    baseline.write_text(json.dumps(prepared, ensure_ascii=False), encoding="utf-8")
    result = gate.backend_report(tmp_path, module, True)
    assert gate.conclude(result, "full") == 2
    assert any(item["rule"] == "coverage-inputs-changed-or-stale" for item in result["problems"])


def test_prepare_does_not_allow_arbitrary_directory(tmp_path: Path) -> None:
    """重置操作必须限定到后端且具备 POM，不能把用户给的任意目录当构建输出。"""
    with pytest.raises(ValueError):
        gate.prepare_backend(tmp_path, tmp_path)
    assert not (tmp_path / "target").exists()
