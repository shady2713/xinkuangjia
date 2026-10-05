"""验证后端模块边界检查器：合法消费方被接受，违规消费方被拒绝。

所有写入只发生在 pytest 临时目录构造的最小 Maven 工程内，不修改真实仓库。
用例同时覆盖构建期 POM 依赖边与源码期真实 import，并核对检查器不会把零对象
当成通过。

@author DeepSeek
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from scripts.code.java import verify_backend_boundaries as boundaries
from scripts.common.quality_common import DEFAULT_ROOT, CheckError

BACKEND = boundaries.BACKEND


@pytest.fixture(autouse=True)
def isolate_extension_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    """在最小工程用例中清空扩展点登记，避免fixture 缺少真实模块时误报。

    真实登记表的约束由 test_repository_backend_boundaries_pass 与两个扩展点用例覆盖。

    Args:
        monkeypatch: pytest 提供的属性替换入口。
    """
    monkeypatch.setattr(boundaries, "EXTENSION_POINTS", ())


def write(root: Path, relative: str, content: str) -> Path:
    """在临时工程内写入 UTF-8 文件，返回真实路径供检查器读取。

    Args:
        root: 临时工程根目录。
        relative: 相对根目录的 POSIX 路径。
        content: 完整文件内容。
    Returns:
        已写入文件的绝对路径。
    """
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


def module_pom(
    *,
    artifact: str,
    parent: str | None,
    dependencies: tuple[str, ...] = (),
    modules: tuple[str, ...] = (),
) -> str:
    """构造最小可用 POM，只声明内部依赖与聚合关系。

    Args:
        artifact: 模块 artifactId。
        parent: 父模块 artifactId；工程根为 None。
        dependencies: 直接依赖的内部 artifactId。
        modules: 聚合的子模块目录名。
    Returns:
        完整的 POM 文本。
    """
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<project xmlns="http://maven.apache.org/POM/4.0.0">',
        "  <modelVersion>4.0.0</modelVersion>",
    ]
    if parent is not None:
        lines.extend(
            [
                "  <parent>",
                "    <groupId>com.basicframework</groupId>",
                f"    <artifactId>{parent}</artifactId>",
                "    <version>1.0.0</version>",
                "  </parent>",
            ]
        )
    else:
        lines.append("  <groupId>com.basicframework</groupId>")
    lines.append(f"  <artifactId>{artifact}</artifactId>")
    if modules:
        lines.append("  <modules>")
        lines.extend(f"    <module>{name}</module>" for name in modules)
        lines.append("  </modules>")
    if dependencies:
        lines.append("  <dependencies>")
        for dependency in dependencies:
            lines.extend(
                [
                    "    <dependency>",
                    "      <groupId>com.basicframework</groupId>",
                    f"      <artifactId>{dependency}</artifactId>",
                    "    </dependency>",
                ]
            )
        lines.append("  </dependencies>")
    lines.append("</project>")
    return "\n".join(lines) + "\n"


def java_file(
    package: str, name: str, imports: tuple[str, ...] = (), fields: tuple[str, ...] = ()
) -> str:
    """构造一个带真实包名、import 与字段的最小 Java 源文件。

    Args:
        package: 包名。
        name: 类型名。
        imports: 需要声明的全限定导入名。
        fields: 类体内的字段声明行，用于制造真实类型使用。
    Returns:
        完整的 Java 源文本。
    """
    lines = [f"package {package};", ""]
    lines.extend(f"import {symbol};" for symbol in imports)
    if imports:
        lines.append("")
    lines.append(f"public class {name} {{")
    lines.extend(f"    {field}" for field in fields)
    lines.append("}")
    return "\n".join(lines) + "\n"


def build_project(root: Path) -> None:
    """构造一套合法的最小后端工程，覆盖 BOM、core、业务模块与应用装配。

    该骨架对应真实仓库的合法消费方：业务模块引用 core 的通用能力，
    server 装配业务模块与 Web Starter，core 不引用任何业务模块。

    Args:
        root: 临时工程根目录。
    """
    write(
        root,
        f"{BACKEND}/pom.xml",
        module_pom(
            artifact="basic-framework",
            parent=None,
            modules=(
                "basic-framework-dependencies",
                "basic-framework-core",
                "basic-framework-server",
                "basic-framework-module-system",
            ),
        ),
    )
    write(
        root,
        f"{BACKEND}/basic-framework-dependencies/pom.xml",
        module_pom(artifact="basic-framework-dependencies", parent="basic-framework"),
    )
    write(
        root,
        f"{BACKEND}/basic-framework-core/pom.xml",
        module_pom(
            artifact="basic-framework-core",
            parent="basic-framework",
            modules=("basic-framework-common", "basic-framework-spring-boot-starter-web"),
        ),
    )
    write(
        root,
        f"{BACKEND}/basic-framework-core/basic-framework-common/pom.xml",
        module_pom(artifact="basic-framework-common", parent="basic-framework-core"),
    )
    write(
        root,
        f"{BACKEND}/basic-framework-core/basic-framework-spring-boot-starter-web/pom.xml",
        module_pom(
            artifact="basic-framework-spring-boot-starter-web",
            parent="basic-framework-core",
            dependencies=("basic-framework-common",),
        ),
    )
    write(
        root,
        f"{BACKEND}/basic-framework-module-system/pom.xml",
        module_pom(
            artifact="basic-framework-module-system",
            parent="basic-framework",
            dependencies=("basic-framework-common", "basic-framework-spring-boot-starter-web"),
        ),
    )
    write(
        root,
        f"{BACKEND}/basic-framework-server/pom.xml",
        module_pom(
            artifact="basic-framework-server",
            parent="basic-framework",
            dependencies=("basic-framework-module-system", "basic-framework-spring-boot-starter-web"),
        ),
    )
    write(
        root,
        f"{BACKEND}/basic-framework-core/basic-framework-common/src/main/java/com/basicframework/framework/common/pojo/CommonResult.java",
        java_file("com.basicframework.framework.common.pojo", "CommonResult"),
    )
    write(
        root,
        f"{BACKEND}/basic-framework-core/basic-framework-spring-boot-starter-web/src/main/java/com/basicframework/framework/web/config/WebProperties.java",
        java_file(
            "com.basicframework.framework.web.config",
            "WebProperties",
            ("com.basicframework.framework.common.pojo.CommonResult",),
            ("private CommonResult<?> lastResult;",),
        ),
    )
    write(
        root,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/service/UserService.java",
        java_file(
            "com.basicframework.module.system.service",
            "UserService",
            (
                "com.basicframework.framework.common.pojo.CommonResult",
                "com.basicframework.framework.web.config.WebProperties",
            ),
            ("private CommonResult<?> lastResult;", "private WebProperties properties;"),
        ),
    )
    write(
        root,
        f"{BACKEND}/basic-framework-server/src/main/java/com/basicframework/server/Boot.java",
        java_file(
            "com.basicframework.server",
            "Boot",
            ("com.basicframework.module.system.service.UserService",),
            ("private UserService userService;",),
        ),
    )


def test_legal_layout_passes(tmp_path: Path) -> None:
    """合法消费方全部被接受：业务模块引用 core、server 引用业务模块。"""
    build_project(tmp_path)
    checked, findings = boundaries.verify(tmp_path)
    assert checked > 0
    assert findings == []


def test_core_referencing_business_module_is_rejected(tmp_path: Path) -> None:
    """core 源码反向引用业务模块实现时被拒绝，并定位到真实 import 行。"""
    build_project(tmp_path)
    path = write(
        tmp_path,
        f"{BACKEND}/basic-framework-core/basic-framework-spring-boot-starter-web/src/main/java/com/basicframework/framework/web/config/Leak.java",
        java_file(
            "com.basicframework.framework.web.config",
            "Leak",
            ("com.basicframework.module.system.service.UserService",),
        ),
    )
    _, findings = boundaries.verify(tmp_path)
    assert [item.rule for item in findings] == ["source-reverse-dependency"]
    assert findings[0].path.endswith("Leak.java")
    assert findings[0].line == 3
    assert path.is_file()


def test_business_module_referencing_application_is_rejected(tmp_path: Path) -> None:
    """业务模块引用 server 源码时被拒绝，应用装配层不得被反向依赖。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/service/Boot.java",
        java_file(
            "com.basicframework.module.system.service",
            "Boot",
            ("com.basicframework.server.Boot",),
        ),
    )
    _, findings = boundaries.verify(tmp_path)
    assert [item.rule for item in findings] == ["source-reverse-dependency"]


def test_pom_dependency_on_higher_layer_is_rejected(tmp_path: Path) -> None:
    """core POM 依赖业务模块时被拒绝，反映构建期真实反向依赖。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-core/basic-framework-spring-boot-starter-web/pom.xml",
        module_pom(
            artifact="basic-framework-spring-boot-starter-web",
            parent="basic-framework-core",
            dependencies=("basic-framework-common", "basic-framework-module-system"),
        ),
    )
    _, findings = boundaries.verify(tmp_path)
    rules = {item.rule for item in findings}
    assert "module-dependency-direction" in rules


def test_pom_dependency_on_application_is_rejected(tmp_path: Path) -> None:
    """任何模块依赖 server 时被拒绝，server 只能处于依赖图末端。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/pom.xml",
        module_pom(
            artifact="basic-framework-module-system",
            parent="basic-framework",
            dependencies=("basic-framework-common", "basic-framework-server"),
        ),
    )
    _, findings = boundaries.verify(tmp_path)
    messages = [item.message for item in findings]
    assert any("basic-framework-server" in message for message in messages)


def test_bom_module_with_dependency_is_rejected(tmp_path: Path) -> None:
    """BOM 模块声明内部依赖时被拒绝，它只能承载依赖版本管理。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-dependencies/pom.xml",
        module_pom(
            artifact="basic-framework-dependencies",
            parent="basic-framework",
            dependencies=("basic-framework-common",),
        ),
    )
    _, findings = boundaries.verify(tmp_path)
    assert [item.rule for item in findings] == ["module-dependency-direction"]


def test_cross_business_module_internal_import_is_rejected(tmp_path: Path) -> None:
    """业务模块直接引用另一个业务模块的实现包时被拒绝。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/service/Mate.java",
        java_file(
            "com.basicframework.module.system.service",
            "Mate",
            ("com.basicframework.module.infra.dal.mysql.file.FileMapper",),
        ),
    )
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-infra/pom.xml",
        module_pom(
            artifact="basic-framework-module-infra",
            parent="basic-framework",
            dependencies=("basic-framework-common",),
        ),
    )
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-infra/src/main/java/com/basicframework/module/infra/dal/mysql/file/FileMapper.java",
        java_file("com.basicframework.module.infra.dal.mysql.file", "FileMapper"),
    )
    _, findings = boundaries.verify(tmp_path)
    assert [item.rule for item in findings] == ["cross-module-internal-import"]
    assert findings[0].path.endswith("Mate.java")


def test_cross_business_module_biz_api_import_is_accepted(tmp_path: Path) -> None:
    """业务模块之间通过 common 的 biz API 调用属于合法消费方，必须被接受。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-infra/pom.xml",
        module_pom(
            artifact="basic-framework-module-infra",
            parent="basic-framework",
            dependencies=("basic-framework-common",),
        ),
    )
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-core/basic-framework-common/src/main/java/com/basicframework/framework/common/biz/system/permission/PermissionCommonApi.java",
        java_file("com.basicframework.framework.common.biz.system.permission", "PermissionCommonApi"),
    )
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-infra/src/main/java/com/basicframework/module/infra/service/permission/PermissionConsumer.java",
        java_file(
            "com.basicframework.module.infra.service.permission",
            "PermissionConsumer",
            ("com.basicframework.framework.common.biz.system.permission.PermissionCommonApi",),
            ("private PermissionCommonApi permissionCommonApi;",),
        ),
    )
    _, findings = boundaries.verify(tmp_path)
    assert [item.rule for item in findings] == []


def test_internal_dependency_cycle_is_rejected(tmp_path: Path) -> None:
    """内部依赖成环时被拒绝，环路径必须完整出现在诊断里。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-infra/pom.xml",
        module_pom(
            artifact="basic-framework-module-infra",
            parent="basic-framework",
            dependencies=("basic-framework-module-system",),
        ),
    )
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/pom.xml",
        module_pom(
            artifact="basic-framework-module-system",
            parent="basic-framework",
            dependencies=("basic-framework-module-infra",),
        ),
    )
    _, findings = boundaries.verify(tmp_path)
    cycles = [item for item in findings if item.rule == "module-dependency-cycle"]
    assert len(cycles) == 1
    assert "basic-framework-module-infra" in cycles[0].message
    assert "basic-framework-module-system" in cycles[0].message


def test_import_without_declared_dependency_is_rejected(tmp_path: Path) -> None:
    """引用未在依赖闭包内的模块时被拒绝，避免依赖偶然的传递引入。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/service/Sneak.java",
        java_file(
            "com.basicframework.module.system.service",
            "Sneak",
            ("com.basicframework.framework.ip.core.Area",),
        ),
    )
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-core/basic-framework-spring-boot-starter-biz-ip/pom.xml",
        module_pom(
            artifact="basic-framework-spring-boot-starter-biz-ip",
            parent="basic-framework-core",
            dependencies=("basic-framework-common",),
        ),
    )
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-core/basic-framework-spring-boot-starter-biz-ip/src/main/java/com/basicframework/framework/ip/core/Area.java",
        java_file("com.basicframework.framework.ip.core", "Area"),
    )
    _, findings = boundaries.verify(tmp_path)
    assert [item.rule for item in findings] == ["undeclared-module-import"]


def test_transitive_dependency_is_accepted(tmp_path: Path) -> None:
    """经已声明依赖传递可达的模块属于合法引用，不产生未声明依赖诊断。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/service/Transitive.java",
        java_file(
            "com.basicframework.module.system.service",
            "Transitive",
            ("com.basicframework.framework.web.config.WebProperties",),
        ),
    )
    _, findings = boundaries.verify(tmp_path)
    assert findings == []


def test_extension_point_without_consumer_is_rejected(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """登记的扩展点没有跨模块真实消费方时被拒绝，只有声明不算消费。"""
    build_project(tmp_path)
    monkeypatch.setattr(
        boundaries,
        "EXTENSION_POINTS",
        (
            boundaries.ExtensionPoint(
                symbol="com.basicframework.framework.common.pojo.CommonResult",
                owner="basic-framework-common",
                purpose="测试用扩展点",
            ),
        ),
    )
    _, findings = boundaries.verify(tmp_path)
    # CommonResult 被其它模块引用，属于真实消费方，不应报告。
    assert findings == []
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-core/basic-framework-spring-boot-starter-web/src/main/java/com/basicframework/framework/web/config/OrphanHook.java",
        java_file("com.basicframework.framework.web.config", "OrphanHook"),
    )
    monkeypatch.setattr(
        boundaries,
        "EXTENSION_POINTS",
        (
            boundaries.ExtensionPoint(
                symbol="com.basicframework.framework.web.config.OrphanHook",
                owner="basic-framework-spring-boot-starter-web",
                purpose="只在自身模块内出现的类型",
            ),
        ),
    )
    _, findings = boundaries.verify(tmp_path)
    assert [item.rule for item in findings] == ["extension-point-without-consumer"]


def test_extension_point_missing_declaration_is_rejected(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """登记的扩展点在所属模块内不存在时被拒绝，登记表不能指向不存在的类型。"""
    build_project(tmp_path)
    monkeypatch.setattr(
        boundaries,
        "EXTENSION_POINTS",
        (
            boundaries.ExtensionPoint(
                symbol="com.basicframework.framework.common.pojo.MissingApi",
                owner="basic-framework-common",
                purpose="不存在的扩展点",
            ),
        ),
    )
    _, findings = boundaries.verify(tmp_path)
    assert [item.rule for item in findings] == ["extension-point-missing"]


def test_import_only_without_usage_is_not_a_consumer(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """仅 import 而未在正文使用类型时不算真实消费方。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/src/main/java/com/basicframework/module/system/service/IdleImport.java",
        "package com.basicframework.module.system.service;\n\n"
        "import com.basicframework.framework.web.config.WebProperties;\n\n"
        "public class IdleImport {\n}\n",
    )
    monkeypatch.setattr(
        boundaries,
        "EXTENSION_POINTS",
        (
            boundaries.ExtensionPoint(
                symbol="com.basicframework.framework.web.config.OrphanHook",
                owner="basic-framework-spring-boot-starter-web",
                purpose="测试用扩展点",
            ),
        ),
    )
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-core/basic-framework-spring-boot-starter-web/src/main/java/com/basicframework/framework/web/config/OrphanHook.java",
        java_file("com.basicframework.framework.web.config", "OrphanHook"),
    )
    _, findings = boundaries.verify(tmp_path)
    assert [item.rule for item in findings] == ["extension-point-without-consumer"]


def test_empty_backend_is_not_a_pass(tmp_path: Path) -> None:
    """后端工程不存在时返回零对象，由调用方按不适用处理，不能算通过。"""
    checked, findings = boundaries.verify(tmp_path)
    assert (checked, findings) == (0, [])


def test_duplicate_artifact_is_rejected(tmp_path: Path) -> None:
    """两个模块使用同一 artifactId 时归属无法确定，直接报检查未完成。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-module-system/nested/pom.xml",
        module_pom(artifact="basic-framework-module-system", parent="basic-framework"),
    )
    with pytest.raises(CheckError, match="artifactId 重复"):
        boundaries.verify(tmp_path)


def test_unknown_module_name_is_rejected(tmp_path: Path) -> None:
    """模块命名不符合既有分层时无法判定边界，直接报检查未完成。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{BACKEND}/basic-framework-something/pom.xml",
        module_pom(artifact="basic-framework-something", parent="basic-framework"),
    )
    with pytest.raises(CheckError, match="无法判定模块层次"):
        boundaries.verify(tmp_path)


@pytest.mark.skipif(not (DEFAULT_ROOT / BACKEND).is_dir(), reason="仓库内不存在后端工程")
def test_repository_backend_boundaries_pass() -> None:
    """真实仓库的合法消费方全部被接受，且检查对象覆盖全部模块与手写源码。"""
    checked, findings = boundaries.verify(DEFAULT_ROOT)
    assert findings == []
    modules = boundaries.collect_modules(DEFAULT_ROOT)
    assert len(modules) == 17
    assert checked > len(modules)


@pytest.mark.skipif(
    not (DEFAULT_ROOT / BACKEND).is_dir() or shutil.which("git") is None,
    reason="仓库内不存在后端工程或缺少 Git",
)
def test_repository_sources_are_actually_read() -> None:
    """真实仓库必须真的读到包名与 import，避免空扫描伪装成通过。"""
    modules = boundaries.collect_modules(DEFAULT_ROOT)
    sources = boundaries.collect_sources(DEFAULT_ROOT, modules)
    assert len(sources) > 200
    assert all(source.package for source in sources)
    assert sum(len(source.imports) for source in sources) > 1000
    owners = boundaries.package_owners(modules, sources)
    assert boundaries.owner_of("com.basicframework.module.system.service.user.AdminUserService", owners) == (
        "basic-framework-module-system"
    )
    assert boundaries.owner_of("com.basicframework.framework.common.pojo.CommonResult", owners) == (
        "basic-framework-common"
    )
    assert boundaries.owner_of("com.example.outside.Type", owners) is None
