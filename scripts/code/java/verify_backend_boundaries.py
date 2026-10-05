#!/usr/bin/env python3
"""核实 Java 后端的模块边界与依赖方向，拒绝反向依赖、跨模块实现依赖与循环。

检查对象是 `后端代码/basic-framework-boot` 下参与构建的 17 个 Maven 模块：读取每个
`pom.xml` 的真实内部依赖与聚合关系，再按包归属把 `src/main/java` 的 import 语句映射
回模块，从而同时核对**构建期依赖图**和**源码期真实引用**，不把 POM 声明当成实际调用。

规则依据来自仓库既有契约（根 `AGENTS.md`、`docs/架构/03-Java后端.md`）：

1. 依赖方向单向：`dependencies`（BOM）→ `core`（通用能力，业务无关）→ 业务模块 →
   `server`（应用装配）。低层不得依赖高层，`server` 不得被任何模块依赖。
2. 业务模块之间的调用只走 `com.basicframework.framework.common.biz.*` 提供的稳定 API，
   不得 import 另一个业务模块的实现包（controller、service、dal、convert、job、framework）。
3. 源码引用的模块必须经真实声明的依赖（含传递闭包）可达，不能依赖偶然的传递引入。
4. 内部依赖图不得成环。
5. 登记的扩展点必须在**声明它的模块之外**有真实消费方，接口或基类本身不算消费方。

零对象不构成本检查的通过路径：模块清单为空时按不适用报告，不会静默变绿。

用法：
    python -B -X utf8 scripts/code/java/verify_backend_boundaries.py [--root 仓库根] [--json]

@author DeepSeek
"""

from __future__ import annotations

import argparse
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
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

CHECK_NAME = "backend-boundaries"
# 后端工程根；模块发现只依赖真实目录，不顺带扫描其它语言工程。
BACKEND = Path("后端代码") / "basic-framework-boot"
POM_NAMESPACE = {"m": "http://maven.apache.org/POM/4.0.0"}
# 内部坐标统一使用该 groupId，用它区分框架模块与第三方依赖。
INTERNAL_GROUP = "com.basicframework"
# 模块目录、生成物与依赖不作为源码检查对象。
SKIPPED_DIRECTORIES = frozenset({"target", "generated-sources", "generated-test-sources"})
# 层次编号越大越靠近应用；用于判定反向依赖。
LAYERS = {"dependencies": 0, "core": 1, "business": 2, "application": 3, "reactor": 4}
# 跨业务模块调用唯一允许的稳定 API 包前缀。
BUSINESS_API_PREFIX = "com.basicframework.framework.common.biz."


@dataclass(frozen=True)
class Module:
    """记录一个 Maven 模块的坐标、真实目录与内部依赖。

    Attributes:
        artifact: Maven artifactId，模块身份与依赖边两端都用它表示。
        directory: 相对仓库根的 POSIX 目录，用于定位源码与报告问题。
        pom: 相对仓库根的 POSIX `pom.xml` 路径。
        parent: 父模块 artifactId；无父模块时为 None。
        aggregated: `<modules>` 声明的子模块目录名，用于核对聚合完整性。
        dependencies: 直接声明的内部模块 artifactId（保持声明顺序去重）。
        layer: 依据模块角色判定的层次名，取值来自 LAYERS。
    """

    artifact: str
    directory: str
    pom: str
    parent: str | None
    aggregated: tuple[str, ...]
    dependencies: tuple[str, ...]
    layer: str


@dataclass(frozen=True)
class Source:
    """记录一个手写生产 Java 源码文件及其包名与 import 位置。

    Attributes:
        path: 相对仓库根的 POSIX 路径。
        absolute: 绝对路径，供需要二次读取内容的规则使用，不依赖进程工作目录。
        owner: 该文件所属模块的 artifactId。
        package: 文件声明的包名；缺少 package 声明时为 None。
        imports: `(一基行号, 被导入的全限定名)` 列表，静态导入保留 `static` 前缀之外的符号。
    """

    path: str
    absolute: Path
    owner: str
    package: str | None
    imports: tuple[tuple[int, str], ...]


@dataclass(frozen=True)
class ExtensionPoint:
    """登记一个对业务模块公开的扩展点及其保留理由。

    Attributes:
        symbol: 扩展点类型的全限定名，必须与源码中的包名和类型名完全一致。
        owner: 声明该扩展点的模块 artifactId，不能同时充当消费方。
        purpose: 该扩展点向业务方提供的真实能力，供评审判断是否仍需要保留。
    """

    symbol: str
    owner: str
    purpose: str


# 保留的公开扩展点；每一项都必须在其它模块存在真实实现或真实调用，
# 否则“保留扩展点”只是声明，属于未被消费的死接口。
EXTENSION_POINTS = (
    ExtensionPoint(
        symbol="com.basicframework.framework.security.config.AuthorizeRequestsCustomizer",
        owner="basic-framework-spring-boot-starter-security",
        purpose="业务模块通过实现它追加自身匿名放行路径，无需改动安全 Starter。",
    ),
    ExtensionPoint(
        symbol="com.basicframework.framework.quartz.core.handler.JobHandler",
        owner="basic-framework-spring-boot-starter-job",
        purpose="任务模块通过实现它注册可被调度器按 Bean 名触发的手写任务。",
    ),
    ExtensionPoint(
        symbol="com.basicframework.framework.common.biz.infra.logger.ApiAccessLogCommonApi",
        owner="basic-framework-common",
        purpose="Web Starter 在访问日志切面中调用它，避免通用组件依赖 infra 实现。",
    ),
    ExtensionPoint(
        symbol="com.basicframework.framework.common.biz.infra.logger.ApiErrorLogCommonApi",
        owner="basic-framework-common",
        purpose="Web Starter 在异常处理器中调用它记录错误日志。",
    ),
    ExtensionPoint(
        symbol="com.basicframework.framework.common.biz.system.oauth2.OAuth2TokenCommonApi",
        owner="basic-framework-common",
        purpose="Security Starter 通过它校验令牌，不直接依赖 system 模块实现。",
    ),
    ExtensionPoint(
        symbol="com.basicframework.framework.common.biz.system.permission.PermissionCommonApi",
        owner="basic-framework-common",
        purpose="部门数据权限 Starter 通过它取权限与数据范围，不依赖 system 实现。",
    ),
    ExtensionPoint(
        symbol="com.basicframework.framework.common.biz.system.dict.DictDataCommonApi",
        owner="basic-framework-common",
        purpose="Excel Starter 通过它翻译字典值，供导出与导入复用。",
    ),
    ExtensionPoint(
        symbol="com.basicframework.framework.common.biz.system.logger.OperateLogCommonApi",
        owner="basic-framework-common",
        purpose="Web Starter 通过它记录操作日志，避免通用组件依赖 system 实现。",
    ),
)


def element_text(element: ET.Element | None, path: str) -> str | None:
    """读取子元素的去空白文本，用于兼容 POM 的两种坐标写法。

    Args:
        element: 待查询的 XML 元素；为 None 时直接返回 None。
        path: 命名空间前缀下的子元素路径，例如 `m:artifactId`。
    Returns:
        去空白后的文本；元素缺失或文本为空时返回 None。
    """
    if element is None:
        return None
    found = element.find(path, POM_NAMESPACE)
    if found is None or found.text is None:
        return None
    text = found.text.strip()
    return text or None


def classify(artifact: str) -> str:
    """按模块职责判定层次，未知命名视为配置错误。

    Args:
        artifact: Maven artifactId。
    Returns:
        LAYERS 中的层次名。
    Raises:
        CheckError: artifactId 不符合框架既有命名，无法判定层次。
    """
    if artifact == "basic-framework":
        return "reactor"
    if artifact == "basic-framework-dependencies":
        return "dependencies"
    if artifact == "basic-framework-server":
        return "application"
    if artifact.startswith("basic-framework-module-"):
        return "business"
    if artifact in {"basic-framework-core", "basic-framework-common"}:
        return "core"
    if artifact.startswith("basic-framework-spring-boot-starter-"):
        return "core"
    raise CheckError(f"无法判定模块层次：{artifact}")


def relative(root: Path, path: Path) -> str:
    """把模块内路径表示为仓库相对 POSIX 路径，保证报告可复核。

    Args:
        root: 仓库根目录。
        path: 仓库内路径。
    Returns:
        相对根目录的 POSIX 路径。
    Raises:
        CheckError: 路径越过仓库边界。
    """
    resolved = path.resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise CheckError(f"路径越过仓库边界：{path}")
    return resolved.relative_to(root.resolve()).as_posix()


def read_module(root: Path, pom: Path) -> Module:
    """解析单个 `pom.xml`，只保留框架内部依赖与聚合声明。

    Args:
        root: 仓库根目录。
        pom: 已存在的 `pom.xml` 路径。
    Returns:
        模块坐标、目录、内部依赖与层次。
    Raises:
        CheckError: POM 无法解析、缺少 artifactId，或模块不在后端工程内。
    """
    try:
        tree = ET.parse(pom)
    except ET.ParseError as error:
        raise CheckError(f"POM 解析失败：{pom}：{error}") from error
    root_element = tree.getroot()
    artifact = element_text(root_element, "m:artifactId")
    if not artifact:
        raise CheckError(f"POM 缺少 artifactId：{pom}")
    dependencies: list[str] = []
    for dependency in root_element.findall("m:dependencies/m:dependency", POM_NAMESPACE):
        group = element_text(dependency, "m:groupId")
        coordinate = element_text(dependency, "m:artifactId")
        # 只统计框架内部坐标；第三方依赖不参与模块边界判定。
        if coordinate and group == INTERNAL_GROUP and coordinate not in dependencies:
            dependencies.append(coordinate)
    if artifact in dependencies:
        raise CheckError(f"模块不能依赖自身：{pom}")
    aggregated = tuple(
        name
        for name in (
            element_text(module, ".") for module in root_element.findall("m:modules/m:module", POM_NAMESPACE)
        )
        if name
    )
    return Module(
        artifact=artifact,
        directory=relative(root, pom.parent),
        pom=relative(root, pom),
        parent=element_text(root_element.find("m:parent", POM_NAMESPACE), "m:artifactId"),
        aggregated=aggregated,
        dependencies=tuple(dependencies),
        layer=classify(artifact),
    )


def collect_modules(root: Path) -> list[Module]:
    """发现后端工程内的全部 Maven 模块，不做数量假设。

    Args:
        root: 仓库根目录。
        Returns:
        按 artifactId 排序的模块列表；后端工程不存在时返回空列表。
    Raises:
        CheckError: 存在重复 artifactId 或 POM 不可解析。
    """
    backend = root / BACKEND
    if not backend.is_dir():
        return []
    modules: dict[str, Module] = {}
    for pom in sorted(backend.rglob("pom.xml")):
        if any(part in SKIPPED_DIRECTORIES for part in pom.relative_to(backend).parts):
            continue
        module = read_module(root, pom)
        if module.artifact in modules:
            raise CheckError(f"artifactId 重复：{module.artifact}")
        modules[module.artifact] = module
    return [modules[key] for key in sorted(modules)]


def collect_sources(root: Path, modules: list[Module]) -> list[Source]:
    """收集各模块手写生产源码的包名与 import 位置。

    Args:
        root: 仓库根目录。
        modules: 已发现的模块清单。
        Returns:
        按路径排序的源码列表，只包含 `src/main/java` 下的 `.java` 文件。
    Raises:
        CheckError: 源码不可读取或缺少包名。
    """
    sources: list[Source] = []
    for module in modules:
        source_root = root / module.directory / "src" / "main" / "java"
        if not source_root.is_dir():
            continue
        for path in sorted(source_root.rglob("*.java")):
            if any(part in SKIPPED_DIRECTORIES for part in path.parts):
                continue
            text = read_text(path)
            package = None
            imports: list[tuple[int, str]] = []
            for number, line in enumerate(text.splitlines(), start=1):
                stripped = line.strip()
                if package is None and stripped.startswith("package "):
                    package = stripped[len("package ") :].rstrip(";").strip()
                    continue
                if not stripped.startswith("import "):
                    continue
                specifier = stripped[len("import ") :].rstrip(";").strip()
                if specifier.startswith("static "):
                    specifier = specifier[len("static ") :].strip()
                imports.append((number, specifier))
            if package is None:
                raise CheckError(f"Java 源码缺少 package 声明：{relative(root, path)}")
            sources.append(
                Source(
                    path=relative(root, path),
                    absolute=path,
                    owner=module.artifact,
                    package=package,
                    imports=tuple(imports),
                )
            )
    return sources


def transitive_dependencies(modules: list[Module]) -> dict[str, frozenset[str]]:
    """计算每个模块在框架内部可达的依赖闭包，用于判定 import 是否有声明依据。

    Args:
        modules: 已发现的模块清单。
    Returns:
        artifactId 到“传递可达的内部模块集合”（含自身）的映射。
    Raises:
        CheckError: 依赖指向未发现的模块，说明清单不完整。
    """
    graph = {module.artifact: module.dependencies for module in modules}
    for artifact, dependencies in graph.items():
        for dependency in dependencies:
            if dependency not in graph:
                raise CheckError(f"模块 {artifact} 依赖了不存在的内部模块：{dependency}")
    closure: dict[str, frozenset[str]] = {}
    for artifact in graph:
        reached: set[str] = set()
        pending = [artifact]
        while pending:
            current = pending.pop()
            if current in reached:
                continue
            reached.add(current)
            pending.extend(graph[current])
        closure[artifact] = frozenset(reached)
    return closure


def find_cycles(modules: list[Module]) -> list[tuple[str, ...]]:
    """用深度优先遍历找出内部依赖图中的全部环。

    Args:
        modules: 已发现的模块清单。
    Returns:
        去重后的环路径列表，每个环以自身为起点和终点闭合；无环时为空。
    Raises:
        CheckError: 依赖指向未发现的模块。
    """
    graph = {module.artifact: module.dependencies for module in modules}
    for artifact, dependencies in graph.items():
        for dependency in dependencies:
            if dependency not in graph:
                raise CheckError(f"模块 {artifact} 依赖了不存在的内部模块：{dependency}")
    cycles: list[tuple[str, ...]] = []
    seen: set[tuple[str, ...]] = set()
    state: dict[str, int] = {}
    stack: list[str] = []

    def visit(artifact: str) -> None:
        """递归遍历依赖边，回边出现时记录从栈中截取的环。"""
        state[artifact] = 1
        stack.append(artifact)
        for dependency in graph[artifact]:
            if state.get(dependency, 0) == 1:
                start = stack.index(dependency)
                cycle = tuple(stack[start:] + [dependency])
                canonical = tuple(sorted(cycle[:-1]))
                if canonical not in seen:
                    seen.add(canonical)
                    cycles.append(cycle)
            elif state.get(dependency, 0) == 0:
                visit(dependency)
        stack.pop()
        state[artifact] = 2

    for artifact in sorted(graph):
        if state.get(artifact, 0) == 0:
            visit(artifact)
    return cycles


def package_owners(modules: list[Module], sources: list[Source]) -> dict[str, str]:
    """建立“包名 → 模块”映射，供 import 归属判定使用。

    Args:
        modules: 已发现的模块清单。
        sources: 已收集的源码清单。
    Returns:
        包名到 artifactId 的映射；同一包出现在多个模块时抛出异常。
    Raises:
        CheckError: 同一个包被两个模块声明，归属无法唯一确定。
    """
    owners: dict[str, str] = {}
    for source in sources:
        assert source.package is not None
        existing = owners.get(source.package)
        if existing is not None and existing != source.owner:
            raise CheckError(f"包 {source.package} 同时出现在 {existing} 与 {source.owner}")
        owners[source.package] = source.owner
    return owners


def owner_of(symbol: str, owners: dict[str, str]) -> str | None:
    """按最长包前缀判断符号所属模块，避免把子包误判到父包。

    Args:
        symbol: 被导入的全限定名。
        owners: 包名到 artifactId 的映射。
    Returns:
        所属模块 artifactId；符号不属于任何模块时为 None。
    """
    best_package: str | None = None
    for package in owners:
        if symbol == package or symbol.startswith(package + "."):
            if best_package is None or len(package) > len(best_package):
                best_package = package
    return owners[best_package] if best_package is not None else None


def check_direction(modules: list[Module]) -> list[Finding]:
    """核对构建期依赖方向：低层不得依赖高层，应用层不得被依赖。

    Args:
        modules: 已发现的模块清单。
    Returns:
        违反方向的依赖边诊断。
    """
    findings: list[Finding] = []
    by_artifact = {module.artifact: module for module in modules}
    for module in modules:
        for dependency in module.dependencies:
            target = by_artifact.get(dependency)
            if target is None:
                continue
            violation: str | None = None
            if LAYERS[target.layer] > LAYERS[module.layer]:
                violation = (
                    f"{module.layer} 模块 {module.artifact} 不能依赖更高层 "
                    f"{target.layer} 模块 {dependency}"
                )
            elif target.layer in {"application", "reactor"}:
                violation = f"{target.layer} 层模块 {dependency} 不能被 {module.artifact} 依赖"
            elif module.layer == "dependencies":
                violation = f"BOM 模块 {module.artifact} 不能依赖 {dependency}"
            if violation is not None:
                findings.append(
                    Finding(
                        path=module.pom,
                        line=1,
                        rule="module-dependency-direction",
                        message=violation,
                    )
                )
    return findings


def check_source_direction(sources: list[Source], owners: dict[str, str], modules: list[Module]) -> list[Finding]:
    """核对源码引用方向：低层源码不得 import 高层模块的包。

    Args:
        sources: 已收集的源码清单。
        owners: 包名到 artifactId 的映射。
        modules: 已发现的模块清单。
    Returns:
        反向引用诊断，精确定位到 import 行。
    """
    by_artifact = {module.artifact: module for module in modules}
    findings: list[Finding] = []
    for source in sources:
        source_layer = LAYERS[by_artifact[source.owner].layer]
        for line, symbol in source.imports:
            target = owner_of(symbol, owners)
            if target is None or target == source.owner:
                continue
            if LAYERS[by_artifact[target].layer] > source_layer:
                findings.append(
                    Finding(
                        path=source.path,
                        line=line,
                        rule="source-reverse-dependency",
                        message=(
                            f"{source.owner}（{by_artifact[source.owner].layer}）反向引用了 "
                            f"{target}（{by_artifact[target].layer}）的 {symbol}"
                        ),
                    )
                )
    return findings


def check_cross_module_internal(sources: list[Source], owners: dict[str, str], modules: list[Module]) -> list[Finding]:
    """拒绝业务模块之间直接引用对方实现包，只允许稳定的 biz API。

    Args:
        sources: 已收集的源码清单。
        owners: 包名到 artifactId 的映射。
        modules: 已发现的模块清单。
    Returns:
        跨业务模块实现依赖诊断。
    """
    business = {module.artifact for module in modules if module.layer == "business"}
    findings: list[Finding] = []
    for source in sources:
        if source.owner not in business:
            continue
        for line, symbol in source.imports:
            target = owner_of(symbol, owners)
            if target is None or target == source.owner or target not in business:
                continue
            if symbol.startswith(BUSINESS_API_PREFIX):
                continue
            findings.append(
                Finding(
                    path=source.path,
                    line=line,
                    rule="cross-module-internal-import",
                    message=(
                        f"业务模块 {source.owner} 不能直接引用 {target} 的实现 {symbol}；"
                        f"跨模块契约请使用 {BUSINESS_API_PREFIX}*"
                    ),
                )
            )
    return findings


def reported_by_other_rule(source_layer: str, target_layer: str) -> bool:
    """判断一条跨模块引用是否已由方向类规则报告，避免同一缺陷重复计数。

    Args:
        source_layer: 引用方模块层次名。
        target_layer: 被引用模块层次名。
    Returns:
        反向依赖或跨业务模块实现依赖已覆盖该引用时为 True。
    """
    if LAYERS[target_layer] > LAYERS[source_layer]:
        return True
    return source_layer == "business" and target_layer == "business"


def check_undeclared_import(
    sources: list[Source],
    owners: dict[str, str],
    closure: dict[str, frozenset[str]],
    layers: dict[str, str],
) -> list[Finding]:
    """拒绝引用未通过已声明依赖可达的模块，避免依赖偶然的传递引入。

    反向依赖与跨业务模块实现依赖由各自规则报告，这里不重复输出同一处引用。

    Args:
        sources: 已收集的源码清单。
        owners: 包名到 artifactId 的映射。
        closure: 各模块内部依赖传递闭包。
        layers: artifactId 到层次名的映射。
    Returns:
        未声明依赖诊断。
    """
    findings: list[Finding] = []
    for source in sources:
        reachable = closure.get(source.owner)
        if reachable is None:
            continue
        for line, symbol in source.imports:
            target = owner_of(symbol, owners)
            if target is None or target == source.owner or target in reachable:
                continue
            if reported_by_other_rule(layers[source.owner], layers[target]):
                continue
            findings.append(
                Finding(
                    path=source.path,
                    line=line,
                    rule="undeclared-module-import",
                    message=(
                        f"{source.owner} 引用了 {target} 的 {symbol}，但该模块不在其声明的依赖闭包内"
                    ),
                )
            )
    return findings


def check_extension_points(sources: list[Source]) -> list[Finding]:
    """核实登记的扩展点在其它模块存在真实消费方，而不是只有声明。

    Args:
        sources: 已收集的源码清单。
    Returns:
        缺少真实消费方或被重复声明的扩展点诊断。
    """
    by_symbol: dict[str, list[Source]] = {}
    for source in sources:
        assert source.package is not None
        for _, symbol in source.imports:
            by_symbol.setdefault(symbol, []).append(source)
    findings: list[Finding] = []
    for point in EXTENSION_POINTS:
        simple = point.symbol.rsplit(".", 1)[1]
        declaring_package = point.symbol.rsplit(".", 1)[0]
        declarations = [
            source
            for source in sources
            if source.owner == point.owner
            and source.package == declaring_package
            and Path(source.path).stem == simple
        ]
        if not declarations:
            findings.append(
                Finding(
                    path=BACKEND.as_posix(),
                    line=1,
                    rule="extension-point-missing",
                    message=f"登记的扩展点 {point.symbol} 在模块 {point.owner} 中不存在声明",
                )
            )
            continue
        consumers = [
            source
            for source in by_symbol.get(point.symbol, [])
            if source.owner != point.owner and references_type(source, simple)
        ]
        if not consumers:
            findings.append(
                Finding(
                    path=declarations[0].path,
                    line=1,
                    rule="extension-point-without-consumer",
                    message=(
                        f"扩展点 {point.symbol}（{point.purpose}）在 {point.owner} 之外没有真实消费方"
                    ),
                )
            )
    return findings


def references_type(source: Source, simple: str) -> bool:
    """判断源码是否在 import 语句之外真实使用了该类型名。

    Args:
        source: 待判断的源码。
        simple: 不含包名的类型名。
    Returns:
        非 import 行出现该标识符时为 True。
    """
    text = read_text(source.absolute)
    body = "\n".join(
        line for line in text.splitlines() if not line.strip().startswith("import ")
    )
    return simple in body


def verify(root: Path) -> tuple[int, list[Finding]]:
    """执行全部后端边界规则并返回检查对象数与诊断。

    Args:
        root: 仓库根目录。
        Returns:
        `(检查对象数, 诊断列表)`；对象数为模块、手写源码与扩展点之和。
    Raises:
        CheckError: 模块清单、源码或依赖声明不完整，检查无法给出可信结论。
    """
    modules = collect_modules(root)
    if not modules:
        return 0, []
    sources = collect_sources(root, modules)
    owners = package_owners(modules, sources)
    closure = transitive_dependencies(modules)
    findings: list[Finding] = []
    for cycle in find_cycles(modules):
        findings.append(
            Finding(
                path=BACKEND.as_posix(),
                line=1,
                rule="module-dependency-cycle",
                message="内部依赖成环：" + " → ".join(cycle),
            )
        )
    findings.extend(check_direction(modules))
    findings.extend(check_source_direction(sources, owners, modules))
    findings.extend(check_cross_module_internal(sources, owners, modules))
    findings.extend(
        check_undeclared_import(
            sources, owners, closure, {module.artifact: module.layer for module in modules}
        )
    )
    findings.extend(check_extension_points(sources))
    return len(modules) + len(sources) + len(EXTENSION_POINTS), findings


def main() -> int:
    """解析参数并输出后端边界检查结果。

    Returns:
        存在违规时为 1，无违规为 0，环境或输入错误为 2。
    """
    description = "核实 Java 后端模块边界与依赖方向"
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
