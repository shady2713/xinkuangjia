#!/usr/bin/env python3
"""核实管理前端工作区的分层与依赖方向，拒绝反向依赖、跨层引用与循环。

检查对象是 `前端代码/basic-framework-admin` 的 pnpm 工作区：按 `pnpm-workspace.yaml`
的真实 glob 展开出全部 workspace 包，再解析源码中的别名导入、相对导入与动态
`import()`，据此建立“来源包 → 目标包”的真实引用图。只读声明不够——`package.json`
写了依赖但没有引用、或引用了却没写依赖，都会被本检查区分出来。

分层依据来自仓库既有契约（根 `AGENTS.md`、`docs/架构/01-管理前端.md`）：

1. 方向单向：`packages/@core/base`（最底层）→ `packages/@core` → `packages/*`
   （共享能力）→ `packages/effects`（业务无关的通用特性）→ `apps/*`（应用装配）。
   低层不得引用高层，`apps/*` 不得被任何共享包或工具包引用。
2. 真实引用图不得成环。
3. 运行时代码（包内 `src/**`）引用其它 workspace 包时必须在自身 `package.json`
   声明该依赖，不能依赖工作区提升带来的偶然可见性。
4. 包根构建配置（`*.config.mjs`、`tsconfig.json` 的 `extends` 等）引用的构建配置包
   由工作区根统一声明；根未声明同样是配置漂移。
5. `#/*` 等路径别名只在声明它的包内有效，且解析结果不得逃出别名根目录。

零对象不构成本检查的通过路径：包清单为空时按不适用报告。

用法：
    python -B -X utf8 scripts/code/web/verify_workspace_layering.py [--root 仓库根] [--json]

@author DeepSeek
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scripts.common.quality_common import (
    DEFAULT_ROOT,
    CheckError,
    Finding,
    entry,
    read_text,
    report,
)

CHECK_NAME = "workspace-layering"
# 前端工程根；工作区 manifest 与全部 workspace 包都在其下。
FRONTEND = Path("前端代码") / "basic-framework-admin"
WORKSPACE_MANIFEST = "pnpm-workspace.yaml"
# 参与依赖方向判定的源码扩展名；类型声明文件不产生运行时依赖。
SOURCE_SUFFIXES = frozenset({".ts", ".tsx", ".vue", ".mjs", ".cjs", ".js", ".jsx"})
# 依赖、生成物与缓存不作为检查对象。
SKIPPED_DIRECTORIES = frozenset(
    {"node_modules", "dist", "coverage", ".cache", ".turbo", "target", ".git", ".changeset"}
)
# 层次秩：数值越小越底层；tooling 用 -1 表示与业务分层正交的构建工具链。
LAYER_RANK = {"tooling": -1, "core-base": 0, "core": 1, "shared": 2, "effects": 3, "application": 4}
# 工具包允许引用的层次；它们不参与应用运行时分层。
TOOLING_TARGETS = frozenset({"tooling", "core-base", "core", "shared"})
# 依赖声明字段；任一字段声明即视为已声明。
DECLARATION_FIELDS = ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies")
# 覆盖式匹配 import / export ... from 与动态 import()，同时识别 `import type`。
IMPORT_PATTERN = re.compile(
    r"(?:^|\n)\s*(?:import|export)\s+(type\s+)?[\s\S]*?\s*from\s*['\"]([^'\"]+)['\"]"
    r"|import\s*\(\s*['\"]([^'\"]+)['\"]\s*\)"
    r"|(?:^|\n)\s*import\s*['\"]([^'\"]+)['\"]"
)


@dataclass
class Package:
    """记录一个 workspace 包的身份、目录与依赖声明。

    Attributes:
        name: `package.json` 的包名，跨包引用按它判定目标。
        directory: 相对仓库根的 POSIX 目录。
        layer: 依据目录归属判定的层次名，取值来自 LAYER_RANK。
        declared: 已声明的 workspace 包名到声明字段的映射。
        aliases: 该包 `tsconfig.json` 的 paths 映射，值为相对包目录的 POSIX 前缀。
    """

    name: str
    directory: str
    layer: str
    declared: dict[str, str] = field(default_factory=dict)
    aliases: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Reference:
    """记录一条已解析的跨包引用。

    Args:
        path: 引用方文件的仓库相对 POSIX 路径。
        line: 一基行号。
        source: 引用方包名。
        target: 被引用包名。
        specifier: 原始导入说明符，用于定位真实写法。
        kind: `alias`、`relative` 或 `dynamic`，区分别名、相对路径与动态导入。
        runtime: 引用文件是否位于包的 `src/**` 运行时代码范围内。
    """

    path: str
    line: int
    source: str
    target: str
    specifier: str
    kind: str
    runtime: bool


def parse_workspace_patterns(text: str) -> list[str]:
    """从 pnpm 工作区清单中提取 `packages:` 下的 glob 列表。

    Args:
        text: `pnpm-workspace.yaml` 的完整文本。
    Returns:
        按出现顺序排列的 glob 模式。
    Raises:
        CheckError: 缺少 `packages:` 段或该段为空。
    """
    patterns: list[str] = []
    inside = False
    for raw in text.splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if not raw[:1].isspace():
            inside = stripped.startswith("packages:")
            continue
        if not inside:
            continue
        if stripped.startswith("- "):
            value = stripped[2:].strip().strip("'\"")
            if value:
                patterns.append(value)
    if not patterns:
        raise CheckError(f"{WORKSPACE_MANIFEST} 没有声明任何 workspace 包")
    return patterns


def expand_pattern(project: Path, pattern: str) -> list[Path]:
    """展开只含末段通配的工作区模式，返回真实存在的包目录。

    Args:
        project: 前端工程根目录。
        pattern: 形如 `packages/@core/base/*` 的工作区模式。
    Returns:
        含 `package.json` 的目录列表；模式不含通配时按原样判断。
    """
    if "*" not in pattern:
        candidate = project / pattern
        return [candidate] if (candidate / "package.json").is_file() else []
    parent = project / pattern.rsplit("/", 1)[0]
    if not parent.is_dir():
        return []
    return sorted(
        child for child in parent.iterdir() if child.is_dir() and (child / "package.json").is_file()
    )


def classify(directory: str) -> str:
    """按工作区目录归属判定包层次。

    Args:
        directory: 仓库相对 POSIX 目录。
    Returns:
        LAYER_RANK 中的层次名。
    Raises:
        CheckError: 目录不在既有分层内，无法判定边界。
    """
    if directory.startswith("apps/"):
        return "application"
    if directory.startswith("packages/@core/base/"):
        return "core-base"
    if directory.startswith("packages/@core/"):
        return "core"
    if directory.startswith("packages/effects/"):
        return "effects"
    if directory.startswith("packages/"):
        return "shared"
    if directory.startswith("internal/") or directory.startswith("scripts/"):
        return "tooling"
    raise CheckError(f"无法判定 workspace 包层次：{directory}")


def strip_json_comments(text: str) -> str:
    """剔除 JSONC 注释，同时保留字符串内的 `//`（例如 https 地址）。

    Args:
        text: 可能含行注释或块注释的 JSON 文本。
    Returns:
        注释被替换为空白、字符串字面量保持原样的文本。
    """
    result: list[str] = []
    index = 0
    in_string = False
    escaped = False
    while index < len(text):
        character = text[index]
        if in_string:
            result.append(character)
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
            index += 1
            continue
        if character == '"':
            in_string = True
            result.append(character)
            index += 1
            continue
        if character == "/" and index + 1 < len(text) and text[index + 1] == "/":
            while index < len(text) and text[index] != "\n":
                index += 1
            continue
        if character == "/" and index + 1 < len(text) and text[index + 1] == "*":
            index += 2
            while index + 1 < len(text) and not (text[index] == "*" and text[index + 1] == "/"):
                index += 1
            index = min(index + 2, len(text))
            continue
        result.append(character)
        index += 1
    return "".join(result)


def read_aliases(package_root: Path) -> dict[str, str]:
    """读取包内 `tsconfig.json` 的 paths 映射，得到真实别名根。

    Args:
        package_root: 包目录的绝对路径。
    Returns:
        别名模式到目标前缀的映射；无 tsconfig 或非法 JSON 时为空映射。
    """
    manifest = package_root / "tsconfig.json"
    if not manifest.is_file():
        return {}
    try:
        value = json.loads(strip_json_comments(read_text(manifest)))
    except ValueError:
        return {}
    if not isinstance(value, dict):
        return {}
    options = value.get("compilerOptions")
    if not isinstance(options, dict):
        return {}
    paths = options.get("paths")
    if not isinstance(paths, dict):
        return {}
    aliases: dict[str, str] = {}
    for key, targets in paths.items():
        if isinstance(targets, list) and targets and isinstance(targets[0], str):
            aliases[str(key)] = targets[0].lstrip("./")
    return aliases


def collect_root_declarations(root: Path) -> frozenset[str]:
    """读取工作区根 `package.json` 声明的依赖名，作为构建配置包的统一归属。

    Args:
        root: 仓库根目录。
        Returns:
        根工作区已声明的全部依赖名；根清单缺失或非法时为空集合。
    """
    manifest = root / FRONTEND / "package.json"
    if not manifest.is_file():
        return frozenset()
    try:
        value = json.loads(strip_json_comments(read_text(manifest)))
    except ValueError:
        return frozenset()
    if not isinstance(value, dict):
        return frozenset()
    declared: set[str] = set()
    for key in DECLARATION_FIELDS:
        section = value.get(key)
        if isinstance(section, dict):
            declared.update(str(name) for name in section)
    return frozenset(declared)


def collect_packages(root: Path) -> list[Package]:
    """发现工作区内全部包及其依赖声明与别名。

    Args:
        root: 仓库根目录。
        Returns:
        按包名排序的包列表；前端工程不存在时返回空列表。
    Raises:
        CheckError: 工作区清单缺失、包名重复或包名缺失。
    """
    project = root / FRONTEND
    manifest = project / WORKSPACE_MANIFEST
    if not manifest.is_file():
        return []
    packages: dict[str, Package] = {}
    for pattern in parse_workspace_patterns(read_text(manifest)):
        for directory in expand_pattern(project, pattern):
            data = json.loads(read_text(directory / "package.json"))
            if not isinstance(data, dict) or not isinstance(data.get("name"), str):
                raise CheckError(f"package.json 缺少包名：{directory}")
            name = data["name"]
            if name in packages:
                raise CheckError(f"workspace 包名重复：{name}")
            declared: dict[str, str] = {}
            for key in DECLARATION_FIELDS:
                section = data.get(key)
                if isinstance(section, dict):
                    for dependency in section:
                        declared.setdefault(str(dependency), key)
            relative = directory.relative_to(root).as_posix()
            packages[name] = Package(
                name=name,
                directory=relative,
                layer=classify(directory.relative_to(project).as_posix()),
                declared=declared,
                aliases=read_aliases(directory),
            )
    return [packages[key] for key in sorted(packages)]


def package_files(root: Path, package: Package) -> list[Path]:
    """列出一个包内全部可检查的源码与包根配置文件。

    Args:
        root: 仓库根目录。
        package: 已发现的包。
        Returns:
        按路径排序的文件列表，跳过依赖、生成物与缓存目录。
    """
    base = root / package.directory
    files: list[Path] = []
    for path in sorted(base.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in SOURCE_SUFFIXES:
            continue
        relative = path.relative_to(base)
        if any(part in SKIPPED_DIRECTORIES for part in relative.parts):
            continue
        if path.stem.endswith(".d"):
            continue
        files.append(path)
    return files


def owner_of_path(packages: list[Package], relative: str) -> Package | None:
    """按最长目录前缀判断文件属于哪个包。

    Args:
        packages: 已发现的包列表。
        relative: 文件的仓库相对 POSIX 路径。
    Returns:
        所属包；不属于任何包时为 None。
    """
    matched: Package | None = None
    for package in packages:
        prefix = package.directory + "/"
        if relative == package.directory or relative.startswith(prefix):
            if matched is None or len(package.directory) > len(matched.directory):
                matched = package
    return matched


def resolve_specifier(
    root: Path,
    packages: list[Package],
    by_name: dict[str, Package],
    package: Package,
    path: Path,
    specifier: str,
    runtime: bool,
) -> tuple[Package | None, str | None]:
    """把导入说明符解析为目标包，并识别别名越界。

    Args:
        root: 仓库根目录。
        packages: 已发现的包列表。
        by_name: 包名到包的映射。
        package: 引用方包。
        path: 引用文件的绝对路径。
        specifier: 原始导入说明符。
        runtime: 引用文件是否位于 `src/**`。
    Returns:
        `(目标包, 越界说明)`；同包引用返回 `(None, None)`，别名越界时目标为空并给出原因。
    Raises:
        CheckError: 说明符无法解析到确定的目标，检查不能给出可信结论。
    """
    if specifier.startswith("#"):
        alias_root = package.aliases.get("#/*")
        if alias_root is None:
            raise CheckError(f"{package.directory} 未声明 #/* 别名却使用了 {specifier}")
        if not runtime and not specifier.startswith("#/"):
            return None, None
        resolved = (root / package.directory / alias_root / specifier[len("#/") :]).resolve()
        package_root = (root / package.directory).resolve()
        if not resolved.is_relative_to(package_root):
            return None, f"别名 {specifier} 解析到包外路径 {resolved}"
        return None, None
    if specifier.startswith("."):
        resolved = (path.parent / specifier).resolve()
        relative = resolved.relative_to(root.resolve()).as_posix() if resolved.is_relative_to(root.resolve()) else ""
        target = owner_of_path(packages, relative) if relative else None
        if target is None or target.name == package.name:
            return None, None
        return target, None
    head = "/".join(specifier.split("/")[:2]) if specifier.startswith("@") else specifier.split("/")[0]
    target = by_name.get(head)
    if target is None:
        return None, None
    if target.name == package.name:
        return None, None
    return target, None


def collect_references(root: Path, packages: list[Package]) -> tuple[list[Reference], list[Finding], int]:
    """扫描全部包源码，建立真实跨包引用并顺带报告别名越界。

    Args:
        root: 仓库根目录。
        packages: 已发现的包列表。
        Returns:
        `(引用列表, 别名越界诊断, 检查文件数)`。
    Raises:
        CheckError: 说明符无法解析到确定目标。
    """
    by_name = {package.name: package for package in packages}
    references: list[Reference] = []
    findings: list[Finding] = []
    file_count = 0
    for package in packages:
        for path in package_files(root, package):
            file_count += 1
            relative = path.relative_to(root).as_posix()
            remainder = path.relative_to(root / package.directory).as_posix()
            runtime = remainder.startswith("src/")
            text = read_text(path)
            for match in IMPORT_PATTERN.finditer(text):
                specifier = match.group(2) or match.group(3) or match.group(4) or ""
                if not specifier:
                    continue
                line = text[: match.start()].count("\n") + 1
                target, escape = resolve_specifier(
                    root, packages, by_name, package, path, specifier, runtime
                )
                if escape is not None:
                    findings.append(
                        Finding(path=relative, line=line, rule="alias-escape", message=escape)
                    )
                    continue
                if target is None:
                    continue
                if match.group(3):
                    kind = "dynamic"
                elif specifier.startswith("."):
                    kind = "relative"
                else:
                    kind = "alias"
                references.append(
                    Reference(
                        path=relative,
                        line=line,
                        source=package.name,
                        target=target.name,
                        specifier=specifier,
                        kind=kind,
                        runtime=runtime,
                    )
                )
    return references, findings, file_count


def check_layers(packages: list[Package], references: list[Reference]) -> list[Finding]:
    """核对包间引用方向：低层不得引用高层，应用层不得被共享包引用。

    Args:
        packages: 已发现的包列表。
        references: 已解析的真实跨包引用。
        Returns:
        反向或跨层引用诊断。
    """
    rank = {package.name: LAYER_RANK[package.layer] for package in packages}
    layer = {package.name: package.layer for package in packages}
    findings: list[Finding] = []
    reported: set[tuple[str, str]] = set()
    for reference in references:
        source_layer = layer[reference.source]
        target_layer = layer[reference.target]
        if source_layer == "application":
            continue
        violation: str | None = None
        if target_layer == "application":
            violation = f"{source_layer} 包 {reference.source} 反向依赖应用 {reference.target}"
            rule = "reverse-dependency"
        elif source_layer == "tooling":
            if target_layer not in TOOLING_TARGETS:
                violation = (
                    f"工具包 {reference.source} 不能引用 {target_layer} 包 {reference.target}"
                )
            rule = "cross-layer-dependency"
        elif rank[reference.target] > rank[reference.source]:
            violation = (
                f"{source_layer} 包 {reference.source} 不能引用更高层 {target_layer} 包 {reference.target}"
            )
            rule = "cross-layer-dependency"
        else:
            rule = "cross-layer-dependency"
        # 别名与相对路径都按包级去重，避免同一处结构被重复计为多条问题。
        key = (reference.source, reference.target)
        if violation is not None and key not in reported:
            reported.add(key)
            findings.append(
                Finding(path=reference.path, line=reference.line, rule=rule, message=violation)
            )
    return findings


def check_declarations(
    packages: list[Package],
    references: list[Reference],
    root_files: list[Reference],
    root_declared: frozenset[str],
) -> list[Finding]:
    """核对运行时代码与包根配置引用的包是否已声明依赖。

    运行时代码必须在自身 `package.json` 声明；包根构建配置引用的构建配置包由工作区根
    统一声明——本仓库的 `@vben/tsconfig`、`@vben/prettier-config`、`@vben/tailwind-config`
    都只出现在根 `devDependencies`，这是既有的构建配置归属约定，不是遗漏。

    Args:
        packages: 已发现的包列表。
        references: 运行时代码的真实跨包引用。
        root_files: 包根构建配置文件的真实跨包引用。
        root_declared: 工作区根已声明的依赖名。
        Returns:
        未声明依赖诊断，精确到首次出现的真实引用位置。
    """
    by_name = {package.name: package for package in packages}
    findings: list[Finding] = []
    reported: set[tuple[str, str, bool]] = set()
    for reference in references:
        package = by_name[reference.source]
        target = by_name[reference.target]
        if target.name in package.declared:
            continue
        key = (reference.source, reference.target, True)
        if key in reported:
            continue
        reported.add(key)
        findings.append(
            Finding(
                path=reference.path,
                line=reference.line,
                rule="undeclared-workspace-dependency",
                message=(
                    f"{reference.source} 在 src 运行时代码引用 {reference.target}"
                    f"（{reference.specifier}），但 package.json 未声明该依赖"
                ),
            )
        )
    for reference in root_files:
        package = by_name[reference.source]
        target = by_name[reference.target]
        if target.layer != "tooling" or target.name in package.declared:
            continue
        if target.name in root_declared:
            continue
        key = (reference.source, reference.target, False)
        if key in reported:
            continue
        reported.add(key)
        findings.append(
            Finding(
                path=reference.path,
                line=reference.line,
                rule="undeclared-build-config-dependency",
                message=(
                    f"{reference.source} 的包根构建配置引用构建配置包 {reference.target}"
                    f"（{reference.specifier}），但 package.json 未声明该依赖"
                ),
            )
        )
    return findings


def find_cycles(references: list[Reference]) -> list[tuple[str, ...]]:
    """在真实引用图上查找包级环。

    Args:
        references: 已解析的真实跨包引用。
        Returns:
        去重后的环路径列表，每个环闭合；无环时为空。
    """
    graph: dict[str, set[str]] = {}
    for reference in references:
        graph.setdefault(reference.source, set()).add(reference.target)
        graph.setdefault(reference.target, set())
    cycles: list[tuple[str, ...]] = []
    seen: set[tuple[str, ...]] = set()
    state: dict[str, int] = {}
    stack: list[str] = []

    def visit(node: str) -> None:
        """递归遍历引用边，回边出现时记录从栈中截取的环。"""
        state[node] = 1
        stack.append(node)
        for target in sorted(graph[node]):
            if state.get(target, 0) == 1:
                start = stack.index(target)
                cycle = tuple(stack[start:] + [target])
                canonical = tuple(sorted(cycle[:-1]))
                if canonical not in seen:
                    seen.add(canonical)
                    cycles.append(cycle)
            elif state.get(target, 0) == 0:
                visit(target)
        stack.pop()
        state[node] = 2

    for node in sorted(graph):
        if state.get(node, 0) == 0:
            visit(node)
    return cycles


def verify(root: Path) -> tuple[int, list[Finding]]:
    """执行全部工作区分层规则并返回检查对象数与诊断。

    Args:
        root: 仓库根目录。
        Returns:
        `(检查对象数, 诊断列表)`；对象数为包数与被扫描文件数之和。
    Raises:
        CheckError: 工作区清单、包名或导入说明符无法解析。
    """
    packages = collect_packages(root)
    if not packages:
        return 0, []
    references, findings, file_count = collect_references(root, packages)
    runtime = [item for item in references if item.runtime]
    root_files = [item for item in references if not item.runtime]
    findings.extend(check_layers(packages, references))
    findings.extend(check_declarations(packages, runtime, root_files, collect_root_declarations(root)))
    directory = FRONTEND.as_posix()
    for cycle in find_cycles(references):
        findings.append(
            Finding(
                path=directory,
                line=1,
                rule="workspace-dependency-cycle",
                message="workspace 包引用成环：" + " → ".join(cycle),
            )
        )
    findings.sort(key=lambda item: (item.path, item.line, item.rule, item.message))
    return len(packages) + file_count, findings


def main() -> int:
    """解析参数并输出工作区分层检查结果。

    Returns:
        存在违规时为 1，无违规为 0，环境或输入错误为 2。
    """
    description = "核实前端工作区分层与依赖方向"
    command = argparse.ArgumentParser(description=description)
    command.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="待检查仓库根目录")
    command.add_argument("--json", action="store_true", help="输出结构化 JSON")

    def action() -> int:
        """执行检查并按诊断数量决定退出码。"""
        arguments = command.parse_args()
        checked, findings = verify(arguments.root.resolve())
        return report(CHECK_NAME, checked, findings, as_json=arguments.json)

    return entry(action)


if __name__ == "__main__":
    raise SystemExit(main())
