"""核对覆盖率报告与源码分母，最终阶段逐文件要求行和方法/函数全部覆盖。

本工具只裁决已有覆盖率数据，不把读取报告视为测试执行成功。最终阶段（full/release）
还要求同范围的静态检查已经有真实执行证据：后端重新核验各模块 PMD 报告，前端复核
static_gate.py 写出的 lint 证据；缺失、旧报告、跳过或违规都会让裁决以 2 退出，
调用方拿不到可用的发布证据。
@author OpenAI Codex
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.code.java.check_staged_java_comments import _mask_java, _matching_delimiters
from scripts.common.quality_common import DEFAULT_ROOT, CheckError, run_process
from scripts.workflow import static_gate

# 只有最终阶段才要求静态检查证据；audit 只报告缺口，不产生发布结论。
FINAL_STAGES = frozenset({"full", "release"})

BACKEND = Path("后端代码/basic-framework-boot")
FRONTEND = Path("前端代码/basic-framework-admin")
WEB_EXTENSIONS = {".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".vue"}
TEST_NAME = re.compile(r"(?:[.-](?:test|spec|bench|benchmark))(?:-d)?\.[cm]?[jt]sx?$")


def backend_inputs(root: Path) -> dict[str, str]:
    """绑定后端源码、测试、配置与覆盖率裁决源码，排除构建输出而不按业务包排除。"""
    result: dict[str, str] = {}
    extensions = {".java", ".xml", ".yaml", ".yml", ".properties", ".sql", ".config"}
    for folder, directories, filenames in os.walk(root / BACKEND, followlinks=False):
        directories[:] = [name for name in directories if name not in {"target", ".git", ".idea"}]
        for filename in filenames:
            path = Path(folder) / filename
            if path.suffix in extensions and not filename.startswith(".flattened-"):
                record = source_record(path, root)
                result[record["path"]] = record["sha256"]
    for relative in ("scripts/workflow/coverage_gate.py", "scripts/code/java/check_staged_java_comments.py"):
        path = root / relative
        if path.exists():
            record = source_record(path, root)
            result[record["path"]] = record["sha256"]
    return result


def prepare_backend(root: Path, module: Path) -> None:
    """为本次质量测试重置模块执行数据并保存输入摘要，禁止复用历史探针命中。

    Args:
        root: 拥有后端源码的仓库根目录。
        module: 后端内存在 POM 的单个 Maven 模块。
    Raises:
        ValueError: 模块或 target 链接越过所属后端/模块。
        OSError: 输入无法读取或本次覆盖率产物无法创建。
    Side effects:
        只替换该模块 target/jacoco.exec 与 target/coverage-inputs.json。
        空 exec 可由 JaCoCo 读取，使没有测试的模块仍报告全部类为未覆盖。
    """
    if not module.is_relative_to(root / BACKEND) or not (module / "pom.xml").is_file():
        raise ValueError("准备范围不是后端 Maven 模块")
    target = module / "target"
    if target.resolve() != target or not target.resolve().is_relative_to(module):
        raise ValueError("target 不得重定向到模块外部")
    baseline = backend_inputs(root)
    target.mkdir(exist_ok=True)
    for filename in ("jacoco.exec", "coverage-inputs.json"):
        if (target / filename).is_symlink():
            raise ValueError("覆盖率产物不得为链接")
    (target / "jacoco.exec").write_bytes(b"")
    (target / "coverage-inputs.json").write_text(
        json.dumps({"schema": "coverage-inputs/v1", "inputs": baseline}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8", newline="\n",
    )


def source_record(path: Path, root: Path) -> dict[str, object]:
    """记录源码相对位置与内容摘要，不将源码或配置正文写入报告。"""
    if not path.resolve().is_relative_to(root):
        raise ValueError("源码链接越过仓库边界")
    return {"path": path.relative_to(root).as_posix(), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def metric(missed: int, covered: int) -> dict[str, object]:
    """表示真实分母；没有可执行对象时使用 null 百分比，不伪造 100%。"""
    if type(missed) is not int or type(covered) is not int or min(missed, covered) < 0:
        raise ValueError("覆盖率计数必须是非负整数")
    total = missed + covered
    return {"missed": missed, "covered": covered, "total": total,
            "percent": 100 * covered / total if total else None}


def xml_metric(node: ET.Element, kind: str) -> dict[str, object]:
    """读取一个 JaCoCo 源文件计数器并拒绝重复或畸形计数。"""
    counters = [item for item in node.findall("counter") if item.get("type") == kind]
    if len(counters) > 1:
        raise ValueError("JaCoCo 计数器重复")
    if not counters:
        return metric(0, 0)
    return metric(int(counters[0].attrib["missed"]), int(counters[0].attrib["covered"]))


def without_java_annotations(masked: str) -> str:
    """剥离真实注解及嵌套参数，保留 @interface 类型声明，防止参数等号被当作初始化。"""
    pairs = _matching_delimiters(masked, "(", ")")
    characters = list(masked)
    for match in re.finditer(r"@(?!interface\b)[\w.]+", masked):
        end = match.end()
        while end < len(masked) and masked[end].isspace():
            end += 1
        if end < len(masked) and masked[end] == "(":
            end = pairs.get(end, end) + 1
        characters[match.start():end] = " " * (end - match.start())
    return "".join(characters)


def lombok_markers(masked: str) -> list[str]:
    """识别来源确为 Lombok 的成员生成注解，元数据不假装知道被 JaCoCo 过滤的方法数量。"""
    generators = ("Data", "Value", "NoArgsConstructor", "AllArgsConstructor", "RequiredArgsConstructor",
                  "Builder", "Getter", "Setter", "ToString", "EqualsAndHashCode", "With")
    # 通配导入同样是真实来源；缺少 lombok 包导入时绝不按简单名误判其它同名注解。
    wildcard = re.search(r"\bimport\s+lombok\.\*\s*;", masked) is not None
    return ["lombok." + name for name in generators if (
        re.search(r"@lombok\." + name + r"\b", masked)
        or (wildcard and re.search(r"@" + name + r"\b", masked))
        or (f"import lombok.{name};" in masked and re.search(r"@" + name + r"\b", masked))
    )]


def lombok_declaration_only(masked: str, text: str) -> bool:
    """确认 Lombok 纯声明类型；字段初始化器与生成成员同属 JaCoCo 过滤范围。

    每对大括号都必须归属于一个类型声明：显式方法、构造器、静态块、实例块、
    数组初始化和匿名类都会多出非类型的大括号，方法体另有独立的签名特征。
    通过后剩余的等号只能是字段初始化器，它编译进 Lombok 生成的构造器，
    和 getter/setter 一样被 JaCoCo 按 Generated 标记过滤，强行要求覆盖会让
    这类文件永远无法达标；字段默认值本身由对应行为测试守护。
    """
    constructors = {"lombok.Data", "lombok.Value", "lombok.NoArgsConstructor", "lombok.AllArgsConstructor", "lombok.RequiredArgsConstructor"}
    if not constructors.intersection(lombok_markers(masked)):
        return False
    if re.search(r"\)\s*(?:throws\s+[\w.,\s]+)?\{", text) or "->" in text:
        return False
    declared_types = len(re.findall(r"\b(?:class|interface|enum|record)\s+\w+", text))
    return declared_types > 0 and declared_types == text.count("{") == text.count("}")


def constant_holder_only(masked: str, text: str) -> bool:
    """确认常量持有类：只有编译期常量字段和空私有构造，没有任何可执行语句。

    JaCoCo 对"仅有一个空私有构造"的类不产出方法计数器，若按实现纳管，
    这类文件永远无法达到逐文件全覆盖，只能靠放宽判据而不是靠测试转正。
    空构造体没有语句，不产生任何业务行为；防实例化契约由对应行为测试守护。
    """
    declarations = re.findall(r"\b(?:class|interface|enum|record)\s+(\w+)", text)
    if len(declarations) != 1 or not re.search(r"\bfinal\s+class\s+\w+", text):
        return False
    name = declarations[0]
    # 只允许一个空私有构造；任何带语句的构造或方法体都必须保留为实现。
    without_empty_constructor = re.sub(rf"private\s+{name}\s*\(\s*\)\s*\{{\s*\}}", "", text)
    if re.search(r"\)\s*(?:throws\s+[\w.,\s]+)?\{", without_empty_constructor) or "->" in without_empty_constructor:
        return False
    if without_empty_constructor.count("{") != 1 or re.search(r"\bstatic\s*\{", text):
        return False
    # 去掉编译期常量后不得残留任何初始化表达式；字符串字面量已被源码掩码清空。
    without_constants = re.sub(
        r"\bstatic\s+final\s+(?:byte|short|int|long|float|double|boolean|char|String)\s+\w+\s*=\s*"
        r"(?:-?\d+(?:\.\d+)?[lLfFdD]?|true|false|\s*)\s*;",
        "", text,
    )
    return "=" not in without_constants


def java_declaration_only(path: Path) -> bool:
    """独立确认接口、注解或 Lombok 纯声明，手写实现不得被零计数掩盖。"""
    masked = _mask_java(path.read_text(encoding="utf-8-sig"))
    text = without_java_annotations(masked)
    if path.name in {"package-info.java", "module-info.java"}:
        return not re.search(r"\b(class|enum|record|interface)\s+\w+", text)
    if lombok_declaration_only(masked, text):
        return True
    if constant_holder_only(masked, text):
        return True
    return bool(re.search(r"\binterface\s+\w+", text)) and not (
        re.search(r"\b(class|enum|record)\s+\w+|\)\s*(?:throws\s+[\w.,\s]+)?\{|->", text)
        or re.search(r"=[^;]*\b(?:new\s|[A-Za-z_$][\w$]*\s*\()", text)
    )


def generated_origin(path: Path, module: Path) -> Path:
    """验证 MapStruct 输出位置、处理器标记及受管 Mapper 来源，拒绝仅按文件名豁免。

    Args:
        path: target/generated-sources/annotations 内的候选 Java 文件。
        module: 生成该文件的 Maven 模块。
    Returns:
        对应 src/main/java 下的原始 Mapper 文件。
    Raises:
        ValueError: 输出没有受支持的生成器标记、声明或原始 Mapper。
    """
    source = path.read_text(encoding="utf-8-sig")
    masked = _mask_java(source)
    marker = re.search(r'@(?:javax\.annotation\.processing\.)?Generated\s*\(\s*value\s*=\s*"org\.mapstruct\.ap\.MappingProcessor"', source)
    package = re.search(r"\bpackage\s+([\w.]+)\s*;", masked)
    declaration = re.search(r"\bclass\s+\w+\s+(?:implements|extends)\s+([\w.]+)\b", masked)
    if not marker or not package or not declaration or masked[marker.start()] != "@":
        raise ValueError("生成源码缺少可验证的 MapStruct 来源")
    if not ("import javax.annotation.processing.Generated;" in masked or "@javax.annotation.processing.Generated" in masked):
        raise ValueError("生成标记不属于 Java 注解处理器")
    qualified = declaration.group(1)
    if "." not in qualified:
        qualified = package.group(1) + "." + qualified
    origin = module / "src/main/java" / (qualified.replace(".", "/") + ".java")
    if not origin.is_file():
        raise ValueError("生成源码引用的 Mapper 不在受管源码中")
    original = _mask_java(origin.read_text(encoding="utf-8-sig"))
    if not re.search(r"@(?:org\.mapstruct\.)?Mapper\b", original):
        raise ValueError("生成源码引用的原始类型没有 Mapper 标记")
    if not ("import org.mapstruct.Mapper;" in original or "@org.mapstruct.Mapper" in original):
        raise ValueError("Mapper 标记不属于 MapStruct")
    if not re.search(r"\b(?:interface|abstract\s+class)\s+" + re.escape(origin.stem) + r"\b", original):
        raise ValueError("Mapper 类型与生成结果引用不一致")
    return origin


def row(path: Path, root: Path, lines: dict[str, object], methods: dict[str, object], declaration: bool) -> dict[str, object]:
    """为单个手写文件计算门禁结果，零对象只能是经确认的声明文件。"""
    status = "passed"
    if lines["missed"] or methods["missed"]:
        status = "failed"
    elif not lines["total"] and not methods["total"]:
        status = "not-applicable" if declaration else "invalid-zero"
    elif not lines["total"] and methods["total"]:
        status = "invalid-zero"
    return {**source_record(path, root), "status": status, "lines": lines, "methods_or_functions": methods,
            "reason": "声明没有可执行体" if status == "not-applicable" else ""}


def backend_report(root: Path, module: Path | None = None, require_prepared: bool = False) -> dict[str, object]:
    """枚举全部生产 Java 源码并逐模块核对 JaCoCo，生成代码保留独立来源和计数。

    Args:
        root: 仓库根目录。
        module: 可选的单个 Maven 模块；省略时检查整个后端。
        require_prepared: 最终 Maven/CI 消费方要求本次测试前存在输入绑定和重置步骤。
    Returns:
        包含手写分母、生成来源、输入摘要和完整性问题的报告。
    Raises:
        OSError: 源码或报告无法读取。
        ValueError: 模块路径越界。
    """
    backend = (root / BACKEND).resolve()
    if module is not None and not module.is_relative_to(backend):
        raise ValueError("模块必须位于后端工程内")
    modules = [module] if module else sorted({p.parent.parent.parent for p in backend.rglob("src/main/java") if p.is_dir() and "target" not in p.relative_to(backend).parts})
    rows: list[dict[str, object]] = []
    generated: list[dict[str, object]] = []
    generated_members: list[dict[str, object]] = []
    problems: list[dict[str, str]] = []
    reports: list[dict[str, object]] = []
    inventory: list[dict[str, object]] = []
    current_inputs = backend_inputs(root)
    for current in modules:
        sources = sorted((current / "src/main/java").rglob("*.java"))
        inventory.extend(source_record(path, root) for path in sources)
        generated_sources = sorted((current / "target/generated-sources/annotations").rglob("*.java"))
        if not sources:
            continue
        report = current / "target/site/jacoco/jacoco.xml"
        if not report.is_file():
            problems.append({"path": report.relative_to(root).as_posix(), "rule": "missing-report"})
            continue
        reports.append(source_record(report, root))
        baseline = current / "target/coverage-inputs.json"
        execution = current / "target/jacoco.exec"
        if baseline.exists():
            try:
                prepared = json.loads(baseline.read_text(encoding="utf-8"))
                if prepared.get("schema") != "coverage-inputs/v1" or prepared.get("inputs") != current_inputs:
                    raise ValueError("测试期间输入发生变化")
                if not execution.is_file() or report.stat().st_mtime_ns < execution.stat().st_mtime_ns:
                    raise ValueError("报告早于本次执行数据")
            except (ValueError, AttributeError):
                problems.append({"path": baseline.relative_to(root).as_posix(), "rule": "coverage-inputs-changed-or-stale"})
        elif require_prepared:
            problems.append({"path": baseline.relative_to(root).as_posix(), "rule": "missing-coverage-preparation"})
        try:
            document = ET.fromstring(report.read_bytes())
            if document.tag != "report":
                raise ValueError("不是 JaCoCo 报告")
            entries: dict[str, ET.Element] = {}
            for package in document.findall("package"):
                for entry in package.findall("sourcefile"):
                    key = package.attrib["name"] + "/" + entry.attrib["name"]
                    key = key.lstrip("/")
                    if key in entries:
                        raise ValueError("JaCoCo 源文件重复")
                    entries[key] = entry
            expected: set[str] = set()
            for path in sources:
                key = path.relative_to(current / "src/main/java").as_posix()
                expected.add(key)
                content = _mask_java(path.read_text(encoding="utf-8-sig"))
                markers = lombok_markers(content)
                if markers:
                    generated_members.append({**source_record(path, root), "generator": "lombok",
                                              "source_markers": markers, "member_counts": None,
                                              "reason": "JaCoCo 过滤带 Generated 字节码标记的成员；XML 不提供其计数，手写实现仍逐文件纳管"})
                if re.search(r"@[\w.]*Generated[\w]*\b", content):
                    problems.append({"path": path.relative_to(root).as_posix(), "rule": "generated-marker-in-handwritten-source"})
                entry = entries.get(key)
                if entry is None:
                    problems.append({"path": path.relative_to(root).as_posix(), "rule": "source-missing-from-report"})
                    continue
                if path.stat().st_mtime_ns > report.stat().st_mtime_ns:
                    problems.append({"path": path.relative_to(root).as_posix(), "rule": "source-newer-than-report"})
                rows.append(row(path, root, xml_metric(entry, "LINE"), xml_metric(entry, "METHOD"), java_declaration_only(path)))
            for path in generated_sources:
                key = path.relative_to(current / "target/generated-sources/annotations").as_posix()
                if key in expected:
                    problems.append({"path": path.relative_to(root).as_posix(), "rule": "generated-source-collides-with-handwritten"})
                expected.add(key)
                try:
                    origin = generated_origin(path, current)
                    if key not in entries:
                        raise ValueError("生成文件没有出现在完整报告中")
                    generated.append({**source_record(path, root), "origin": source_record(origin, root),
                                      "generator": "org.mapstruct.ap.MappingProcessor", "lines": xml_metric(entries[key], "LINE"),
                                      "methods": xml_metric(entries[key], "METHOD")})
                except ValueError:
                    problems.append({"path": path.relative_to(root).as_posix(), "rule": "unverified-generated-origin"})
            for key in sorted(set(entries) - expected):
                problems.append({"path": current.relative_to(root).as_posix() + "/" + key, "rule": "report-source-unmanaged"})
        except (ET.ParseError, ValueError, KeyError):
            problems.append({"path": report.relative_to(root).as_posix(), "rule": "invalid-report"})
    return {"files": rows, "inventory": inventory, "generated": generated, "generated_members": generated_members,
            "problems": problems, "reports": reports}


def web_sources(root: Path) -> tuple[list[Path], list[dict[str, object]]]:
    """枚举应用、共享包及构建工具 src，测试与声明单列且不排除任何 vendored 包。"""
    sources: list[Path] = []
    excluded: list[dict[str, object]] = []
    frontend = root / FRONTEND
    # 必须在下降前剪枝：rglob 无法剪枝，会把 pnpm 的 node_modules 整个走完，
    # 实测仅枚举就要数百秒，门禁在 CI 上根本不可用。
    pruned = {"node_modules", "dist", "coverage", ".turbo", ".cache", ".git"}
    for area in ("apps", "packages", "internal"):
        base = frontend / area
        if not base.is_dir():
            continue
        for folder, directories, filenames in os.walk(base, followlinks=False):
            directories[:] = [name for name in directories if name not in pruned]
            for filename in filenames:
                path = Path(folder) / filename
                parts = path.relative_to(frontend).parts
                if "src" not in parts or path.suffix not in WEB_EXTENSIONS:
                    continue
                reason = "declaration" if re.search(r"\.d\.[cm]?ts$", path.name) else "test" if (TEST_NAME.search(path.name) or any(part in {"__tests__", "e2e"} for part in parts)) else None
                if reason:
                    excluded.append({**source_record(path, root), "reason": reason})
                else:
                    sources.append(path)
    return sorted(sources), excluded


def web_declarations(root: Path, paths: list[Path]) -> set[str]:
    """通过已安装的 TypeScript/Vue 解析器确认零计数文件确无运行时实现。"""
    if not paths:
        return set()
    node = shutil.which("node")
    if not node:
        raise CheckError("确认声明文件需要 Node.js")
    helper = DEFAULT_ROOT / FRONTEND / "scripts/quality/coverage_declarations.mjs"
    result = run_process([node, str(helper)], root, timeout=60,
                         input_bytes=json.dumps(list(map(str, paths))).encode("utf-8"))
    if result.code:
        raise CheckError("声明文件解析失败")
    data = json.loads(result.stdout)
    if not isinstance(data, list) or any(not isinstance(path, str) for path in data):
        raise CheckError("声明文件解析结果无效")
    return set(data)


def istanbul_metrics(entry: dict[str, object]) -> tuple[dict[str, object], dict[str, object]]:
    """按 Istanbul 语句起始行合并行命中并读取函数命中。

    Args:
        entry: 单文件 Istanbul 计数与声明位置映射，不接受布尔值或负命中数。
    Returns:
        行、函数两个计数器；与 Istanbul 一致，同一行取最大语句命中数。
    Raises:
        ValueError: 位置映射与计数不匹配或计数不合法。
        KeyError: 报告缺少所需结构字段。
    """
    statements, statement_map = entry["s"], entry["statementMap"]
    functions, function_map = entry["f"], entry["fnMap"]
    if not all(isinstance(item, dict) for item in (statements, statement_map, functions, function_map)):
        raise ValueError("Istanbul 计数和位置必须为对象")
    if statements.keys() != statement_map.keys() or functions.keys() != function_map.keys():
        raise ValueError("Istanbul 位置与计数不匹配")
    lines: dict[int, int] = {}
    for key, count in statements.items():
        start = statement_map[key]["start"]["line"]
        if type(start) is not int or start < 1 or type(count) is not int or count < 0:
            raise ValueError("Istanbul 行号或计数无效")
        lines[start] = max(lines.get(start, 0), count)
    if any(type(count) is not int or count < 0 for count in functions.values()):
        raise ValueError("Istanbul 函数计数无效")
    return (metric(sum(value == 0 for value in lines.values()), sum(value > 0 for value in lines.values())),
            metric(sum(value == 0 for value in functions.values()), sum(value > 0 for value in functions.values())))


def web_report(root: Path, report: Path) -> dict[str, object]:
    """独立核对 V8/Istanbul 报告与所有生产源码，遗漏未导入文件也必须阻断。

    Args:
        root: 仓库根目录，源码范围固定为前端 apps/packages/internal 的 src。
        report: 本次运行生成的 Istanbul JSON；读取不会替调用者补跑测试。
    Returns:
        手写实现、声明 N/A、测试/声明文件排除清单及报告完整性问题。
    Raises:
        ValueError: JSON、路径、计数或源码链接不合法。
        OSError: 源码或报告无法读取。
        CheckError: Node 声明分析无法完成。
    """
    sources, excluded = web_sources(root)
    data = json.loads(report.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Istanbul 报告必须是对象")
    entries: dict[Path, dict[str, object]] = {}
    frontend = (root / FRONTEND).resolve()
    for filename, entry in data.items():
        path = Path(filename)
        path = (frontend / path).resolve() if not path.is_absolute() else path.resolve()
        if not path.is_relative_to(frontend) or path in entries or not isinstance(entry, dict):
            raise ValueError("Istanbul 源码路径越界、重复或条目无效")
        entries[path] = entry
    rows: list[dict[str, object]] = []
    problems: list[dict[str, str]] = []
    counts: dict[Path, tuple[dict[str, object], dict[str, object]]] = {}
    # V8 对未加载的纯类型文件也可能合成 (empty-report) 函数，必须通过 AST 分清分母。
    declarations = web_declarations(root, sources)
    for path in sources:
        if re.search(r"(?:v8|istanbul|c8)\s+ignore", path.read_text(encoding="utf-8-sig")):
            problems.append({"path": path.relative_to(root).as_posix(), "rule": "unreviewed-coverage-ignore"})
        if path not in entries:
            problems.append({"path": path.relative_to(root).as_posix(), "rule": "source-missing-from-report"})
            continue
        if path.stat().st_mtime_ns > report.stat().st_mtime_ns:
            problems.append({"path": path.relative_to(root).as_posix(), "rule": "source-newer-than-report"})
        counts[path] = istanbul_metrics(entries[path])
    for path, (lines, functions) in counts.items():
        if str(path) in declarations:
            rows.append({**row(path, root, metric(0, 0), metric(0, 0), True),
                         "provider_counts": {"lines": lines, "functions": functions}})
        else:
            rows.append(row(path, root, lines, functions, False))
    for path in sorted(set(entries) - set(sources)):
        problems.append({"path": path.relative_to(root).as_posix(), "rule": "report-source-unmanaged"})
    return {"files": rows, "inventory": [source_record(path, root) for path in sources],
            "generated": [], "excluded": excluded, "problems": problems,
            "reports": [source_record(report, root)] if report.is_relative_to(root) else [{"path": str(report), "sha256": hashlib.sha256(report.read_bytes()).hexdigest()}]}


def conclude(result: dict[str, object], stage: str) -> int:
    """最终阶段执行逐文件 100% 门槛，原地补充报告裁决。

    Args:
        result: 已核对源码分母的结构化覆盖率结果。
        stage: audit 仅报告缺口，full/release 阻断任意文件未覆盖行或方法。
    Returns:
        0 表示当前阶段完成，1 表示最终缺口或无实测对象，2 表示分母或报告无效。
        audit 的 0 可带 audit-findings，不能解读为最终覆盖率通过。
    """
    files = result["files"]
    measured = sum(item["status"] in {"passed", "failed"} for item in files)
    failed = sum(item["status"] == "failed" for item in files)
    invalid = bool(result["problems"]) or any(item["status"] == "invalid-zero" for item in files)
    result.update(schema="coverage-gate/v1", stage=stage, measured_files=measured,
                  failed_files=failed, thresholds={"per_file": True, "lines": 100, "methods_or_functions": 100},
                  validates_test_execution=False)
    if invalid:
        result["status"] = "invalid-evidence"
        return 2
    if not measured:
        result["status"] = "not-applicable"
        return 1
    result["status"] = "audit-findings" if failed and stage == "audit" else "failed" if failed else "passed"
    return 1 if failed and stage != "audit" else 0


def require_static_analysis(root: Path, kind: str, stage: str, module: Path | None,
                            evidence: Path | None, report: Path | None) -> dict[str, object]:
    """最终阶段核验同范围静态检查证据，缺失、旧报告、跳过或违规一律拒绝签发。

    Args:
        root: 仓库根目录。
        kind: backend 或 web。
        stage: full 或 release；audit 不要求静态证据。
        module: 仅后端使用的单模块范围。
        evidence: 仅前端使用的静态检查证据路径。
        report: 仅前端使用的 ESLint JSON 报告路径覆盖。
    Returns:
        通过核验的静态检查证据段，供发布证据文档公开工具、配置指纹与真实报告清单。
    Raises:
        ValueError: 阶段不属于最终阶段，调用方逻辑错误。
        CheckError: 证据缺失、过期、越界或不可核验，对应退出码 2。
        RuntimeError: 存在真实静态违规或检查未执行，对应退出码 1。
    """
    if stage not in FINAL_STAGES:
        raise ValueError("只有最终阶段要求静态检查证据")
    return static_gate.verify_static(root, kind, stage, module, evidence, report)


def main() -> int:
    """解析明确阶段和范围，输出不含源码正文的覆盖率裁决及可核对分母清单。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--kind", required=True, choices=("backend", "web"))
    parser.add_argument("--stage", required=True, choices=("audit", "full", "release"))
    parser.add_argument("--module", type=Path)
    parser.add_argument("--coverage", type=Path)
    parser.add_argument("--prepare", action="store_true", help="只重置指定 Maven 模块的本次覆盖率数据")
    parser.add_argument("--require-prepared", action="store_true", help="要求后端报告绑定本次测试前的输入")
    parser.add_argument("--static-evidence", type=Path, help="前端静态检查证据路径；缺省用仓库默认位置")
    parser.add_argument("--static-report", type=Path, help="前端 ESLint JSON 报告路径；缺省用仓库默认位置")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        if args.module and args.kind != "backend":
            raise ValueError("module 仅适用于后端")
        if args.prepare:
            if args.kind != "backend" or args.module is None:
                raise ValueError("prepare 要求后端模块范围")
            prepare_backend(root, args.module.resolve())
            print("已准备本次模块覆盖率输入；尚未执行测试或覆盖率验收。")
            return 0
        result = backend_report(root, args.module.resolve() if args.module else None, args.require_prepared) if args.kind == "backend" else web_report(root, (args.coverage or root / FRONTEND / "coverage/coverage-final.json").resolve())
        # 只有最终阶段（full/release）要求真实静态检查证据：audit 仍是“只报告缺口”的入口，
        # 官方前端默认入口 run_frontend_tests.py --coverage 走的就是 audit，退出码语义不变。
        if args.stage in FINAL_STAGES:
            try:
                static = require_static_analysis(root, args.kind, args.stage,
                                                 args.module.resolve() if args.module else None,
                                                 args.static_evidence, args.static_report)
            except static_gate.StaticViolationError as error:
                print(f"静态检查未通过：{error}", file=sys.stderr)
                return 1
            except CheckError as error:
                print(f"静态检查证据无法核验：{error}", file=sys.stderr)
                return 2
            result["static_analysis"] = static
        code = conclude(result, args.stage)
        # Maven 聚合 POM 没有生产分母，明确 N/A；最终仓库入口仍拒绝全组零实测。
        if args.module and result["status"] == "not-applicable":
            pom = ET.parse(args.module.resolve() / "pom.xml").getroot()
            packaging = pom.findtext("{*}packaging", default="jar")
            if packaging == "pom" or result["files"]:
                code = 0
        result.update(kind=args.kind, root=str(root), code=code,
                      scope={"module": args.module.resolve().relative_to(root).as_posix() if args.module else None,
                             "production_files": len(result["inventory"]), "generated_files": len(result["generated"])})
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print(f"覆盖率 {args.kind}/{args.stage}: {result['status']}；实测文件 {result['measured_files']}，未达最终门槛 {result['failed_files']}，完整性问题 {len(result['problems'])}")
            for issue in result["problems"]:
                print(f"{issue['path']}: [{issue['rule']}]")
            for item in result["files"]:
                if item["status"] not in {"passed", "not-applicable"}:
                    print(f"{item['path']}: [{item['status']}] line={item['lines']} method/function={item['methods_or_functions']}")
        return code
    except (OSError, ValueError, KeyError, TypeError, CheckError) as error:
        # 只打印类型名会让证据失效无法定位；补上原因，失败必须可诊断。
        detail = str(error).strip() or type(error).__name__
        print(f"覆盖率证据无法核验：{type(error).__name__}: {detail}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
