#!/usr/bin/env python3
"""确定性后端业务模块脚手架：一键生成 basic-framework-module-<name> 并注册 Maven、Swagger 与错误码号段。

默认只读预览（--dry-run），仅在显式传入 --apply 时写入文件。
自动分配不重叠的 1_SSS_000_000 错误码区间，注册根 pom.xml、dependencies、server 与 ServiceErrorCodeRange（Map.ofEntries）。

用法：
  python -B -X utf8 scripts/scaffold/new_java_module.py crm
  python -B -X utf8 scripts/scaffold/new_java_module.py --name crm --apply

@author shady2713
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

sys.dont_write_bytecode = True

DEFAULT_ROOT = Path(__file__).resolve().parents[2]
MODULE_NAME_RE = re.compile(r"^[a-z][a-z0-9]{1,23}$")
RESERVED_NAMES = frozenset(
    {
        "common",
        "core",
        "dependencies",
        "framework",
        "infra",
        "server",
        "system",
    }
)
JAVA_KEYWORDS = frozenset(
    {
        "abstract",
        "assert",
        "boolean",
        "break",
        "byte",
        "case",
        "catch",
        "char",
        "class",
        "const",
        "continue",
        "default",
        "do",
        "double",
        "else",
        "enum",
        "exports",
        "extends",
        "false",
        "final",
        "finally",
        "float",
        "for",
        "goto",
        "if",
        "implements",
        "import",
        "instanceof",
        "int",
        "interface",
        "long",
        "module",
        "native",
        "new",
        "null",
        "open",
        "opens",
        "package",
        "permits",
        "private",
        "protected",
        "provides",
        "public",
        "record",
        "requires",
        "return",
        "sealed",
        "short",
        "static",
        "strictfp",
        "super",
        "switch",
        "synchronized",
        "this",
        "throw",
        "throws",
        "to",
        "transient",
        "transitive",
        "true",
        "try",
        "uses",
        "var",
        "void",
        "volatile",
        "when",
        "while",
        "with",
        "yield",
    }
)
STEP_SIZE = 1_000_000


@dataclass(frozen=True)
class ModuleScaffoldPlan:
    """描述待生成的 Java 业务模块路径、号段分配与待修改文件清单。"""

    module_name: str
    artifact_id: str
    begin_code: int
    end_code: int
    created_files: tuple[str, ...]
    updated_files: tuple[str, ...]
    applied: bool


def _validate_module_name(raw_name: str) -> str:
    """校验模块短名格式、框架保留名与 Java 关键字冲突。

    Args:
        raw_name: 用户输入的模块短名（不含 basic-framework-module- 前缀）。
    Returns:
        归一化的小写模块名。
    Raises:
        ValueError: 名称不符合小写字母数字规则、命中框架保留名或 Java 关键字时抛出。
    """
    name = raw_name.strip().lower()
    if not MODULE_NAME_RE.fullmatch(name):
        raise ValueError(
            f"模块名 '{raw_name}' 非法：必须以小写字母开头，仅含小写字母和数字，长度 2-24"
        )
    if name in RESERVED_NAMES:
        raise ValueError(f"模块名 '{name}' 为框架核心保留名称，请换用具体业务域名")
    if name in JAVA_KEYWORDS:
        raise ValueError(f"模块名 '{name}' 为 Java 语言保留关键字，不能作为包名段")
    return name


def _format_java_int(number: int) -> str:
    """将十进制错误码格式化为带下划线分隔的 Java 整数字面量。"""
    raw = f"{number:010d}"
    return f"{raw[0]}_{raw[1:4]}_{raw[4:7]}_{raw[7:10]}"


def _parse_existing_ranges(range_source: str) -> dict[str, tuple[int, int]]:
    """解析 ServiceErrorCodeRange.java 中已登记的模块号段区间（兼容 Map.ofEntries 与 Map.of）。

    Args:
        range_source: ServiceErrorCodeRange.java 源码文本。
    Returns:
        模块名到 (begin, end) 元组的映射。
    """
    constants: dict[str, int] = {}
    for match in re.finditer(
        r"public\s+static\s+final\s+int\s+([A-Z0-9_]+)\s*=\s*([0-9_]+)\s*;",
        range_source,
    ):
        constants[match.group(1)] = int(match.group(2).replace("_", ""))

    ranges: dict[str, tuple[int, int]] = {}
    for match in re.finditer(
        r'"([a-z0-9_]+)"\s*,\s*new\s+int\[\]\s*\{\s*([A-Z0-9_]+)\s*,\s*([A-Z0-9_]+)\s*\}',
        range_source,
    ):
        mod_name, begin_const, end_const = match.groups()
        if begin_const in constants and end_const in constants:
            ranges[mod_name] = (constants[begin_const], constants[end_const])
    return ranges


def _allocate_range(
    existing: dict[str, tuple[int, int]], requested_begin: int | None
) -> tuple[int, int]:
    """分配下一个不冲突的百万级业务错误码区间。

    Args:
        existing: 已存在的模块错误码区间映射。
        requested_begin: 可选显式指定的起始错误码。
    Returns:
        新模块的 (begin, end) 半开区间。
    Raises:
        ValueError: 指定号段越界或与现有号段重叠时抛出。
    """
    if requested_begin is not None:
        if requested_begin < 1_003_000_000 or requested_begin % STEP_SIZE != 0:
            raise ValueError("自定义起始错误码必须 >= 1_003_000_000 且为 1_000_000 的整数倍")
        candidate = (requested_begin, requested_begin + STEP_SIZE)
    else:
        highest_end = max((end for _, end in existing.values()), default=1_003_000_000)
        start = max(1_003_000_000, highest_end)
        candidate = (start, start + STEP_SIZE)

    for other_name, (other_begin, other_end) in existing.items():
        if candidate[0] < other_end and candidate[1] > other_begin:
            raise ValueError(
                f"错误码区间 [{candidate[0]}, {candidate[1]}) 与已登记模块 '{other_name}' 重叠"
            )
    return candidate


def _update_service_error_code_range(
    source: str, module_name: str, begin_code: int, end_code: int
) -> str:
    """在 ServiceErrorCodeRange.java 中追加新模块常量与 MODULE_RANGES 映射条目。"""
    upper = module_name.upper()
    begin_literal = _format_java_int(begin_code)
    end_literal = _format_java_int(end_code)
    constant_block = (
        f"    /** 业务模块 {{@code module-{module_name}}} 起始错误码（含）。 */\n"
        f"    public static final int {upper}_BEGIN = {begin_literal};\n"
        f"    /** 业务模块 {{@code module-{module_name}}} 结束错误码（不含）。 */\n"
        f"    public static final int {upper}_END = {end_literal};\n\n"
    )
    anchor = "    /** 模块名称到半开区间"
    if anchor not in source:
        raise ValueError("ServiceErrorCodeRange.java 结构不符合预期，缺少 MODULE_RANGES 注释锚点")
    updated = source.replace(anchor, constant_block + anchor, 1)

    entries_pattern = re.compile(
        r"(public\s+static\s+final\s+Map<String,\s*int\[\]>\s+MODULE_RANGES\s*=\s*Map\.ofEntries\(\n)"
        r"([\s\S]*?)"
        r"(\n\s*\);)"
    )
    match = entries_pattern.search(updated)
    if match is not None:
        body = match.group(2).rstrip()
        if not body.endswith(","):
            body += ","
        new_entry = (
            f'{body}\n            Map.entry("{module_name}", new int[]{{{upper}_BEGIN, {upper}_END}})'
        )
        return (
            updated[: match.start()]
            + match.group(1)
            + new_entry
            + match.group(3)
            + updated[match.end() :]
        )

    legacy_pattern = re.compile(
        r"(public\s+static\s+final\s+Map<String,\s*int\[\]>\s+MODULE_RANGES\s*=\s*Map\.of\(\n)"
        r"([\s\S]*?)"
        r"(\n\s*\);)"
    )
    legacy_match = legacy_pattern.search(updated)
    if legacy_match is None:
        raise ValueError("ServiceErrorCodeRange.java 中的 MODULE_RANGES 声明无法解析")
    converted_lines = [
        re.sub(
            r'^\s*"([a-z0-9_]+)"\s*,\s*(new\s+int\[\]\{[^}]+\}),?\s*$',
            r'            Map.entry("\1", \2),',
            line,
        )
        for line in legacy_match.group(2).splitlines()
        if line.strip()
    ]
    converted_lines.append(
        f'            Map.entry("{module_name}", new int[]{{{upper}_BEGIN, {upper}_END}})'
    )
    return (
        updated[: legacy_match.start()]
        + "public static final Map<String, int[]> MODULE_RANGES = Map.ofEntries(\n"
        + "\n".join(converted_lines)
        + legacy_match.group(3)
        + updated[legacy_match.end() :]
    )


def _insert_before_closing_tag(xml_text: str, closing_tag: str, snippet: str) -> str:
    """在指定 XML 闭合标签前插入片段，保持统一缩进。"""
    index = xml_text.find(closing_tag)
    if index < 0:
        raise ValueError(f"POM 文件缺少预期的标签：{closing_tag}")
    return xml_text[:index] + snippet + xml_text[index:]


def _render_module_files(
    module_name: str, artifact_id: str, begin_code: int, end_code: int
) -> dict[str, str]:
    """渲染新业务模块的标准文件集合（含 OpenAPI 分组配置与号段单测）。"""
    upper = module_name.upper()
    title_name = module_name.capitalize()
    export_code = f"{begin_code + 999:010d}"
    export_literal = f"{export_code[0]}_{export_code[1:4]}_{export_code[4:7]}_{export_code[7:10]}"
    sample_code = f"{begin_code + 1_000:010d}"
    sample_literal = f"{sample_code[0]}_{sample_code[1:4]}_{sample_code[4:7]}_{sample_code[7:10]}"
    base_pkg_dir = f"src/main/java/com/basicframework/module/{module_name}"
    test_pkg_dir = f"src/test/java/com/basicframework/module/{module_name}"

    pom_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <parent>
        <groupId>com.basicframework</groupId>
        <artifactId>basic-framework</artifactId>
        <version>${{revision}}</version>
    </parent>
    <modelVersion>4.0.0</modelVersion>
    <artifactId>{artifact_id}</artifactId>
    <packaging>jar</packaging>

    <name>${{project.artifactId}}</name>
    <description>{module_name} 业务模块</description>

    <dependencies>
        <dependency>
            <groupId>com.basicframework</groupId>
            <artifactId>basic-framework-spring-boot-starter-security</artifactId>
        </dependency>
        <dependency>
            <groupId>com.basicframework</groupId>
            <artifactId>basic-framework-spring-boot-starter-mybatis</artifactId>
        </dependency>
        <dependency>
            <groupId>com.basicframework</groupId>
            <artifactId>basic-framework-spring-boot-starter-excel</artifactId>
        </dependency>
        <dependency>
            <groupId>org.mapstruct</groupId>
            <artifactId>mapstruct</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>com.h2database</groupId>
            <artifactId>h2</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>
</project>
"""

    readme_md = f"""---
description: '说明 {artifact_id} 业务模块的职责边界、号段范围与验证命令。'
kind: package-library
---

# {artifact_id}

## 摘要

承载 `{module_name}` 业务域的后台接口、应用服务与数据访问实现，错误码区间为 `[{_format_java_int(begin_code)}, {_format_java_int(end_code)})`。

## 目录

- [模块结构](#模块结构)
- [已知限制与暂缓工作](#已知限制与暂缓工作)

## 模块结构

- [ErrorCodeConstants.java]({base_pkg_dir}/enums/ErrorCodeConstants.java)：模块业务错误码常量定义。
- [{title_name}WebConfiguration.java]({base_pkg_dir}/framework/web/config/{title_name}WebConfiguration.java)：注册模块 OpenAPI 分组。

## 已知限制与暂缓工作

新增持久化实体时须同步在 `数据库文件/basic_framework.sql` 维护表结构与菜单权限，并通过 `SchemaDoRbacParityTest` 与 `OpenApiContractSnapshotTest` 校验。
"""

    error_codes_java = f"""package com.basicframework.module.{module_name}.enums;

import com.basicframework.framework.common.exception.ErrorCode;

/**
 * {title_name} 业务模块错误码常量定义，占用区间 [{_format_java_int(begin_code)}, {_format_java_int(end_code)})。
 *
 * @author basic-framework
 */
public interface ErrorCodeConstants {{

    /** 单次导出数据条数上限错误码。 */
    ErrorCode EXPORT_SIZE_EXCEEDED = new ErrorCode({export_literal}, "单次最多导出 10000 条数据，请缩小查询范围");

    /** 示例记录不存在错误码，首个真实实体落地后可按业务子域扩展或替换。 */
    ErrorCode {upper}_RECORD_NOT_EXISTS = new ErrorCode({sample_literal}, "{module_name} 记录不存在");

}}
"""

    web_config_java = f"""package com.basicframework.module.{module_name}.framework.web.config;

import com.basicframework.framework.swagger.config.BasicFrameworkSwaggerAutoConfiguration;
import org.springdoc.core.models.GroupedOpenApi;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * {module_name} 模块 Web 配置类，注册独立的 OpenAPI 接口分组。
 *
 * @author basic-framework
 */
@Configuration(proxyBeanMethods = false)
public class {title_name}WebConfiguration {{

    /**
     * 注册 {module_name} 模块的 OpenAPI 接口文档分组。
     *
     * @return {module_name} 模块 OpenAPI 分组
     */
    @Bean
    public GroupedOpenApi {module_name}GroupedOpenApi() {{
        return BasicFrameworkSwaggerAutoConfiguration.buildGroupedOpenApi("{module_name}");
    }}

}}
"""

    error_codes_test = f"""package com.basicframework.module.{module_name}.enums;

import com.basicframework.framework.common.exception.enums.ServiceErrorCodeRange;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {title_name} 模块错误码区间归属单元测试。
 *
 * @author basic-framework
 */
class ErrorCodeConstantsTest {{

    /**
     * 验证模块示例错误码严格落在 ServiceErrorCodeRange 登记的半开区间内。
     */
    @Test
    void shouldStayWithinRegisteredErrorCodeRange() {{
        int[] range = ServiceErrorCodeRange.MODULE_RANGES.get("{module_name}");
        assertNotNull(range);
        int code = ErrorCodeConstants.{upper}_RECORD_NOT_EXISTS.getCode();
        assertTrue(code >= range[0] && code < range[1]);
    }}

}}
"""

    files = {
        "pom.xml": pom_xml,
        "README.md": readme_md,
        f"{base_pkg_dir}/enums/ErrorCodeConstants.java": error_codes_java,
        f"{base_pkg_dir}/framework/web/config/{title_name}WebConfiguration.java": web_config_java,
        f"{test_pkg_dir}/enums/ErrorCodeConstantsTest.java": error_codes_test,
    }
    for subpkg, desc in (
        ("controller/admin", "管理端 HTTP 控制器与请求响应 VO"),
        ("dal/dataobject", "MyBatis-Plus 持久化数据对象（DO）"),
        ("dal/mysql", "MyBatis-Plus Mapper 接口与查询封装"),
        ("service", "领域业务服务接口与实现"),
    ):
        java_pkg = subpkg.replace("/", ".")
        files[f"{base_pkg_dir}/{subpkg}/package-info.java"] = (
            f"/**\n * {module_name} 模块：{desc}。\n *\n * @author basic-framework\n */\n"
            f"package com.basicframework.module.{module_name}.{java_pkg};\n"
        )
    return files


def scaffold_java_module(
    root: Path,
    raw_name: str,
    *,
    code_begin: int | None = None,
    apply: bool = False,
) -> ModuleScaffoldPlan:
    """构建或写入新 Java 业务模块骨架与父工程注册配置。

    Args:
        root: 仓库根目录。
        raw_name: 模块短名（例如 crm）。
        code_begin: 可选显式起始错误码。
        apply: 为 True 时实际落盘写入；默认只生成预览计划。
    Returns:
        模块生成与注册计划快照。
    Raises:
        ValueError: 模块已存在、名称非法或 POM 结构不匹配时抛出。
    """
    module_name = _validate_module_name(raw_name)
    artifact_id = f"basic-framework-module-{module_name}"
    boot_root = root.resolve() / "后端代码" / "basic-framework-boot"
    module_dir = boot_root / artifact_id
    if module_dir.exists():
        raise ValueError(f"目标模块目录已存在：{module_dir.relative_to(root).as_posix()}")

    root_pom_path = boot_root / "pom.xml"
    deps_pom_path = boot_root / "basic-framework-dependencies" / "pom.xml"
    server_pom_path = boot_root / "basic-framework-server" / "pom.xml"
    range_path = (
        boot_root
        / "basic-framework-core"
        / "basic-framework-common"
        / "src/main/java/com/basicframework/framework/common/exception/enums/ServiceErrorCodeRange.java"
    )

    range_source = range_path.read_text(encoding="utf-8")
    existing_ranges = _parse_existing_ranges(range_source)
    if module_name in existing_ranges:
        raise ValueError(f"模块 '{module_name}' 已在 ServiceErrorCodeRange 中登记")
    begin_code, end_code = _allocate_range(existing_ranges, code_begin)
    updated_range_source = _update_service_error_code_range(
        range_source, module_name, begin_code, end_code
    )

    root_pom = root_pom_path.read_text(encoding="utf-8")
    if f"<module>{artifact_id}</module>" in root_pom:
        raise ValueError(f"根 pom.xml 已包含 {artifact_id}")
    updated_root_pom = _insert_before_closing_tag(
        root_pom,
        "    </modules>",
        f"        <module>{artifact_id}</module>\n",
    )

    deps_pom = deps_pom_path.read_text(encoding="utf-8")
    dep_managed_snippet = (
        "            <dependency>\n"
        "                <groupId>com.basicframework</groupId>\n"
        f"                <artifactId>{artifact_id}</artifactId>\n"
        "                <version>${revision}</version>\n"
        "            </dependency>\n"
    )
    updated_deps_pom = _insert_before_closing_tag(
        deps_pom,
        "        </dependencies>\n    </dependencyManagement>",
        dep_managed_snippet,
    )

    server_pom = server_pom_path.read_text(encoding="utf-8")
    server_dep_snippet = (
        "        <dependency>\n"
        "            <groupId>com.basicframework</groupId>\n"
        f"            <artifactId>{artifact_id}</artifactId>\n"
        "            <version>${revision}</version>\n"
        "        </dependency>\n"
    )
    if "\n        <!-- 测试基础能力 -->" in server_pom:
        updated_server_pom = _insert_before_closing_tag(
            server_pom,
            "\n        <!-- 测试基础能力 -->",
            "\n" + server_dep_snippet.rstrip("\n"),
        )
    else:
        updated_server_pom = _insert_before_closing_tag(
            server_pom,
            "    </dependencies>",
            server_dep_snippet,
        )

    rendered_files = _render_module_files(module_name, artifact_id, begin_code, end_code)
    created_rel = tuple(
        sorted((module_dir / rel).relative_to(root.resolve()).as_posix() for rel in rendered_files)
    )
    updated_rel = tuple(
        path.relative_to(root.resolve()).as_posix()
        for path in (root_pom_path, deps_pom_path, server_pom_path, range_path)
    )

    if apply:
        for rel, content in rendered_files.items():
            target = module_dir / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8", newline="\n")
        root_pom_path.write_text(updated_root_pom, encoding="utf-8", newline="\n")
        deps_pom_path.write_text(updated_deps_pom, encoding="utf-8", newline="\n")
        server_pom_path.write_text(updated_server_pom, encoding="utf-8", newline="\n")
        range_path.write_text(updated_range_source, encoding="utf-8", newline="\n")

    return ModuleScaffoldPlan(
        module_name=module_name,
        artifact_id=artifact_id,
        begin_code=begin_code,
        end_code=end_code,
        created_files=created_rel,
        updated_files=updated_rel,
        applied=apply,
    )


def main(argv: list[str] | None = None) -> int:
    """解析命令行参数并执行后端业务模块脚手架（同时兼容位置参数与 --name 选项）。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("name", nargs="?", default=None, help="新业务模块短名（例如 crm、order）")
    parser.add_argument("--name", dest="name_opt", default=None, help="新业务模块短名（可选命名参数形式）")
    parser.add_argument("--code-begin", type=int, default=None, help="自定义起始错误码（可选）")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="仓库根目录")
    parser.add_argument("--apply", action="store_true", help="实际写入文件（默认仅预览）")
    args = parser.parse_args(argv)

    raw_name = args.name_opt or args.name
    if not raw_name:
        parser.error("必须提供新业务模块短名（例如 crm 或 --name crm）")

    try:
        plan = scaffold_java_module(
            args.root, raw_name, code_begin=args.code_begin, apply=args.apply
        )
    except ValueError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1

    mode_label = "已写入" if plan.applied else "预览（未写入，传入 --apply 落盘）"
    print(f"[{mode_label}] 模块：{plan.artifact_id}，错误码区间：[{plan.begin_code}, {plan.end_code})")
    for path in plan.created_files:
        print(f"  + {path}")
    for path in plan.updated_files:
        print(f"  ~ {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
