#!/usr/bin/env python3
"""确定性后端实体 CRUD 脚手架：在已有 Java 业务模块中一键生成全套分层代码、H2 切片测试与建表 SQL。

默认只读预览（--dry-run），仅在显式传入 --apply 时写入文件。
生成代码严格满足 ArchUnit 架构门禁（VO 与 DO 分离、@PreAuthorize、@Transactional(rollbackFor)、
ServiceExceptionUtil、SLF4J）、Java 增量注释门禁与 UniqueBaseDO 软删除唯一约束契约。

用法：
  python -B -X utf8 scripts/scaffold/new_java_crud.py crm customer --title 客户 --unique-code
  python -B -X utf8 scripts/scaffold/new_java_crud.py --module crm --entity sales-order --title 销售订单 --apply

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
SEGMENT_RE = re.compile(r"^[a-z][a-z0-9]{1,23}$")
ENTITY_RE = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
JAVA_KEYWORDS = frozenset(
    {
        "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char",
        "class", "const", "continue", "default", "do", "double", "else", "enum",
        "extends", "false", "final", "finally", "float", "for", "goto", "if",
        "implements", "import", "instanceof", "int", "interface", "long", "native",
        "new", "null", "package", "private", "protected", "public", "record",
        "return", "short", "static", "strictfp", "super", "switch", "synchronized",
        "this", "throw", "throws", "transient", "true", "try", "var", "void",
        "volatile", "while", "yield",
    }
)


def _escape_java_str(text: str) -> str:
    """转义 Java 字符串字面量中的反斜杠、双引号与换行符。"""
    return text.replace("\\", "\\\\").replace('"', '\\"').replace("\r", "").replace("\n", "")


def _escape_sql_str(text: str) -> str:
    """转义 MySQL 字符串字面量中的单引号与反斜杠。"""
    return text.replace("\\", "\\\\").replace("'", "''").replace("\r", "").replace("\n", "")


@dataclass(frozen=True)
class JavaCrudPlan:
    """描述后端单表 CRUD 实体的生成文件清单与 MySQL DDL 预览。"""

    module: str
    entity: str
    title: str
    table_name: str
    use_unique_base: bool
    created_files: tuple[str, ...]
    ddl_sql: str
    applied: bool
    updated_files: tuple[str, ...] = ()


def _format_java_int(number: int) -> str:
    """将十进制错误码格式化为带下划线分隔的 10 位 Java 整数字面量。"""
    raw = f"{number:010d}"
    return f"{raw[0]}_{raw[1:4]}_{raw[4:7]}_{raw[7:10]}"


def _resolve_module_range(resolved_root: Path, module: str) -> tuple[int, int]:
    """从 ServiceErrorCodeRange.java 解析目标业务模块的 [begin, end) 错误码号段。"""
    range_path = (
        resolved_root
        / "后端代码"
        / "basic-framework-boot"
        / "basic-framework-core"
        / "basic-framework-common"
        / "src/main/java/com/basicframework/framework/common/exception/enums/ServiceErrorCodeRange.java"
    )
    if not range_path.is_file():
        raise ValueError(f"找不到错误码号段注册表：{range_path.relative_to(resolved_root).as_posix()}")
    source = range_path.read_text(encoding="utf-8")
    constants: dict[str, int] = {}
    for match in re.finditer(
        r"public\s+static\s+final\s+int\s+([A-Z0-9_]+)\s*=\s*([0-9_]+)\s*;",
        source,
    ):
        constants[match.group(1)] = int(match.group(2).replace("_", ""))

    for match in re.finditer(
        r'"([a-z0-9_]+)"\s*,\s*new\s+int\[\]\s*\{\s*([A-Z0-9_]+)\s*,\s*([A-Z0-9_]+)\s*\}',
        source,
    ):
        mod_name, begin_const, end_const = match.groups()
        if mod_name == module and begin_const in constants and end_const in constants:
            return constants[begin_const], constants[end_const]
    raise ValueError(f"模块 '{module}' 未在 ServiceErrorCodeRange.MODULE_RANGES 中登记号段")


def _next_unused_code(used_codes: set[int], begin_code: int, end_code: int, preferred: int) -> int:
    """优先取期望编码，否则在模块号段 [begin_code, end_code) 内查找最小可用编码。"""
    if begin_code <= preferred < end_code and preferred not in used_codes:
        return preferred
    for candidate in range(begin_code, end_code):
        if candidate not in used_codes:
            return candidate
    raise ValueError(f"模块号段 [{begin_code}, {end_code}) 已耗尽，无法分配新错误码")


def _allocate_entity_error_block(used_codes: set[int], begin_code: int, end_code: int) -> int:
    """在模块子域号段中分配不冲突的千位起点编码（至少容纳 2 个连续实体错误码）。"""
    for block_start in range(begin_code + 1_000, end_code - 1, 1_000):
        if not any(block_start <= code < block_start + 1_000 for code in used_codes):
            return block_start
    for candidate in range(begin_code, end_code - 1):
        if candidate not in used_codes and (candidate + 1) not in used_codes:
            return candidate
    raise ValueError(f"模块号段 [{begin_code}, {end_code}) 无连续可用错误码空间")


def _prepare_error_code_update(
    resolved_root: Path, module: str, entity: str, clean_title: str
) -> tuple[str, str | None]:
    """检查并准备向模块 ErrorCodeConstants.java 追加实体错误码及 EXPORT_SIZE_EXCEEDED。"""
    error_code_path = (
        resolved_root
        / "后端代码"
        / "basic-framework-boot"
        / f"basic-framework-module-{module}"
        / f"src/main/java/com/basicframework/module/{module}/enums/ErrorCodeConstants.java"
    )
    if not error_code_path.is_file():
        raise ValueError(
            f"目标模块缺少错误码定义文件：{error_code_path.relative_to(resolved_root).as_posix()}"
        )
    rel_path = error_code_path.relative_to(resolved_root).as_posix()
    source = error_code_path.read_text(encoding="utf-8")
    begin_code, end_code = _resolve_module_range(resolved_root, module)

    used_codes = {
        int(raw.replace("_", ""))
        for raw in re.findall(r"new\s+ErrorCode\s*\(\s*([0-9_]+)", source)
    }
    existing_names = set(re.findall(r"\bErrorCode\s+([A-Z0-9_]+)\s*=", source))
    safe_title = _escape_java_str(clean_title)
    entity_upper = entity.replace("-", "_").upper()
    not_exists_name = f"{entity_upper}_NOT_EXISTS"
    duplicate_name = f"{entity_upper}_CODE_DUPLICATE"

    snippets: list[str] = []
    if "EXPORT_SIZE_EXCEEDED" not in existing_names:
        export_code = _next_unused_code(used_codes, begin_code, end_code, begin_code + 999)
        used_codes.add(export_code)
        snippets.append(
            f"    /** 单次导出数据条数上限错误码。 */\n"
            f'    ErrorCode EXPORT_SIZE_EXCEEDED = new ErrorCode({_format_java_int(export_code)}, "单次最多导出 10000 条数据，请缩小查询范围");'
        )

    missing_entity_names = [
        name for name in (not_exists_name, duplicate_name) if name not in existing_names
    ]
    if missing_entity_names:
        block_start = _allocate_entity_error_block(used_codes, begin_code, end_code)
        not_exists_code = block_start
        duplicate_code = block_start + 1
        used_codes.update({not_exists_code, duplicate_code})
        if not_exists_name in missing_entity_names:
            snippets.append(
                f"    /** {safe_title}记录不存在错误码。 */\n"
                f'    ErrorCode {not_exists_name} = new ErrorCode({_format_java_int(not_exists_code)}, "{safe_title}不存在");'
            )
        if duplicate_name in missing_entity_names:
            snippets.append(
                f"    /** {safe_title}编码重复错误码。 */\n"
                f'    ErrorCode {duplicate_name} = new ErrorCode({_format_java_int(duplicate_code)}, "{safe_title}编码已存在");'
            )

    if not snippets:
        return rel_path, None

    closing_index = source.rfind("}")
    if closing_index < 0:
        raise ValueError(f"ErrorCodeConstants.java 缺少类结束大括号：{rel_path}")
    prefix = source[:closing_index].rstrip()
    updated_source = prefix + "\n\n" + "\n\n".join(snippets) + "\n\n}\n"
    return rel_path, updated_source


def _validate_identifier(label: str, value: str) -> str:
    """校验 Java 包段格式，并拒绝 Java 保留关键字。"""
    normalized = value.strip().lower()
    if not SEGMENT_RE.fullmatch(normalized):
        raise ValueError(f"{label} '{value}' 非法：必须以小写字母开头，仅含小写字母和数字，长度 2-24")
    if normalized in JAVA_KEYWORDS:
        raise ValueError(f"{label} '{normalized}' 为 Java 保留关键字，不可作为包名或实体标识")
    return normalized


def _validate_entity_identifier(value: str) -> str:
    """校验实体路径段命名（支持 kebab-case 多词标识，如 sales-order）并拒绝 Java 保留关键字。"""
    normalized = value.strip().lower()
    if not (2 <= len(normalized) <= 32) or not ENTITY_RE.fullmatch(normalized):
        raise ValueError(
            f"实体名 '{value}' 非法：必须以小写字母开头，仅含小写字母、数字和单个连字符，长度 2-32"
        )
    if normalized in JAVA_KEYWORDS or normalized.replace("-", "") in JAVA_KEYWORDS:
        raise ValueError(f"实体名 '{normalized}' 为 Java 保留关键字，不可作为包名或实体标识")
    return normalized


def _entity_names(entity: str) -> tuple[str, str, str, str, str]:
    """将规范化的实体标识拆解为包名、PascalCase、camelCase、snake_case 与 UPPER_CASE。"""
    parts = entity.split("-")
    entity_pkg = "".join(parts)
    entity_pascal = "".join(part.capitalize() for part in parts)
    entity_camel = entity_pascal[:1].lower() + entity_pascal[1:]
    entity_snake = "_".join(parts)
    entity_upper = entity_snake.upper()
    return entity_pkg, entity_pascal, entity_camel, entity_snake, entity_upper


def _render_mysql_ddl(table_name: str, title: str, use_unique_base: bool) -> str:
    """生成与 SchemaDoRbacParityTest 严格对齐的 MySQL 8 建表 DDL。"""
    safe_title = _escape_sql_str(title)
    extra_col = (
        "  `deleted_tag` bigint NOT NULL DEFAULT 0 COMMENT '逻辑删除唯一索引消歧标识（未删除为 0，已删除为 id）',\n"
        if use_unique_base
        else ""
    )
    extra_uk = (
        f"  UNIQUE INDEX `uk_code_deleted_tag`(`code` ASC, `deleted_tag` ASC) USING BTREE,\n"
        if use_unique_base
        else ""
    )
    return f"""-- {safe_title}表结构（可同步并入 数据库文件/basic_framework.sql）
CREATE TABLE `{table_name}` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键编号',
  `code` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '{safe_title}编码',
  `name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '{safe_title}名称',
  `status` tinyint NOT NULL DEFAULT 0 COMMENT '状态（0正常 1停用）',
  `remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '备注',
  `creator` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '创建者',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updater` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '' COMMENT '更新者',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` bit(1) NOT NULL DEFAULT b'0' COMMENT '是否删除',
{extra_col}  PRIMARY KEY (`id`) USING BTREE,
{extra_uk}  INDEX `idx_status`(`status` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '{safe_title}表';
"""


def _render_java_crud_files(
    module: str, entity: str, title: str, use_unique_base: bool
) -> tuple[str, dict[str, str]]:
    """渲染后端实体 CRUD 全套 Java 源文件与 H2 切片测试。"""
    title = _escape_java_str(title)
    entity_pkg, entity_pascal, entity_camel, entity_snake, entity_upper = _entity_names(entity)
    table_name = f"{module}_{entity_snake}"
    perm_prefix = f"{module}:{entity}"
    base_pkg = f"com.basicframework.module.{module}"
    mod_prefix = f"后端代码/basic-framework-boot/basic-framework-module-{module}"
    main_dir = f"{mod_prefix}/src/main/java/com/basicframework/module/{module}"
    test_dir = f"{mod_prefix}/src/test/java/com/basicframework/module/{module}"
    test_res_dir = f"{mod_prefix}/src/test/resources/sql"

    base_do_import = (
        "com.basicframework.framework.mybatis.core.dataobject.UniqueBaseDO"
        if use_unique_base
        else "com.basicframework.framework.mybatis.core.dataobject.BaseDO"
    )
    base_do_name = "UniqueBaseDO" if use_unique_base else "BaseDO"

    do_java = f"""package {base_pkg}.dal.dataobject.{entity_pkg};

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import {base_do_import};
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * {title}持久化数据对象。
 *
 * @author basic-framework
 */
@TableName("{table_name}")
@Data
@EqualsAndHashCode(callSuper = true)
public class {entity_pascal}DO extends {base_do_name} {{

    /** 主键编号。 */
    @TableId
    private Long id;

    /** {title}编码。 */
    private String code;

    /** {title}名称。 */
    private String name;

    /** 状态（0 正常 1 停用）。 */
    private Integer status;

    /** 备注说明。 */
    private String remark;

}}
"""

    mapper_java = f"""package {base_pkg}.dal.mysql.{entity_pkg};

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import {base_pkg}.controller.admin.{entity_pkg}.vo.{entity_pascal}PageReqVO;
import {base_pkg}.dal.dataobject.{entity_pkg}.{entity_pascal}DO;
import org.apache.ibatis.annotations.Mapper;

/**
 * {title} MyBatis-Plus 数据访问接口。
 *
 * @author basic-framework
 */
@Mapper
public interface {entity_pascal}Mapper extends BaseMapperX<{entity_pascal}DO> {{

    /**
     * 按名称、状态与创建时间范围分页查询{title}。
     *
     * @param reqVO 分页筛选条件
     * @return {title}分页数据
     */
    default PageResult<{entity_pascal}DO> selectPage({entity_pascal}PageReqVO reqVO) {{
        return selectPage(reqVO, new LambdaQueryWrapperX<{entity_pascal}DO>()
                .likeIfPresent({entity_pascal}DO::getName, reqVO.getName())
                .eqIfPresent({entity_pascal}DO::getStatus, reqVO.getStatus())
                .betweenIfPresent({entity_pascal}DO::getCreateTime, reqVO.getCreateTime())
                .orderByDesc({entity_pascal}DO::getId));
    }}

    /**
     * 按唯一业务编码查询活跃{title}记录。
     *
     * @param code {title}编码
     * @return 匹配的记录，不存在时返回 null
     */
    default {entity_pascal}DO selectByCode(String code) {{
        return selectOne({entity_pascal}DO::getCode, code);
    }}

}}
"""

    save_req_vo = f"""package {base_pkg}.controller.admin.{entity_pkg}.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * {title}新增与修改请求 VO。
 *
 * @author basic-framework
 */
@Schema(description = "管理后台 - {title}创建/修改 Request VO")
@Data
public class {entity_pascal}SaveReqVO {{

    /** 主键编号（新增为空，修改必填）。 */
    @Schema(description = "主键编号", example = "1024")
    private Long id;

    /** {title}编码。 */
    @Schema(description = "{title}编码", requiredMode = Schema.RequiredMode.REQUIRED, example = "CODE_001")
    @NotBlank(message = "{title}编码不能为空")
    @Size(max = 64, message = "{title}编码长度不能超过 64 个字符")
    private String code;

    /** {title}名称。 */
    @Schema(description = "{title}名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "示例名称")
    @NotBlank(message = "{title}名称不能为空")
    @Size(max = 128, message = "{title}名称长度不能超过 128 个字符")
    private String name;

    /** 状态（0 正常 1 停用）。 */
    @Schema(description = "状态（0正常 1停用）", requiredMode = Schema.RequiredMode.REQUIRED, example = "0")
    @NotNull(message = "状态不能为空")
    private Integer status;

    /** 备注说明。 */
    @Schema(description = "备注", example = "备注信息")
    @Size(max = 500, message = "备注长度不能超过 500 个字符")
    private String remark;

}}
"""

    page_req_vo = f"""package {base_pkg}.controller.admin.{entity_pkg}.vo;

import com.basicframework.framework.common.pojo.PageParam;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;
import org.springframework.format.annotation.DateTimeFormat;

import java.time.LocalDateTime;

import static com.basicframework.framework.common.util.date.DateUtils.FORMAT_YEAR_MONTH_DAY_HOUR_MINUTE_SECOND;

/**
 * {title}分页查询请求 VO。
 *
 * @author basic-framework
 */
@Schema(description = "管理后台 - {title}分页 Request VO")
@Data
@EqualsAndHashCode(callSuper = true)
public class {entity_pascal}PageReqVO extends PageParam {{

    /** {title}名称模糊查询条件。 */
    @Schema(description = "{title}名称", example = "示例")
    private String name;

    /** 状态筛选条件。 */
    @Schema(description = "状态", example = "0")
    private Integer status;

    /** 创建时间范围筛选条件。 */
    @Schema(description = "创建时间范围")
    @DateTimeFormat(pattern = FORMAT_YEAR_MONTH_DAY_HOUR_MINUTE_SECOND)
    private LocalDateTime[] createTime;

}}
"""

    resp_vo = f"""package {base_pkg}.controller.admin.{entity_pkg}.vo;

import cn.idev.excel.annotation.ExcelIgnoreUnannotated;
import cn.idev.excel.annotation.ExcelProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * {title}响应 VO。
 *
 * @author basic-framework
 */
@Schema(description = "管理后台 - {title} Response VO")
@Data
@ExcelIgnoreUnannotated
public class {entity_pascal}RespVO {{

    /** 主键编号。 */
    @Schema(description = "主键编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @ExcelProperty("主键编号")
    private Long id;

    /** {title}编码。 */
    @Schema(description = "{title}编码", requiredMode = Schema.RequiredMode.REQUIRED, example = "CODE_001")
    @ExcelProperty("{title}编码")
    private String code;

    /** {title}名称。 */
    @Schema(description = "{title}名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "示例名称")
    @ExcelProperty("{title}名称")
    private String name;

    /** 状态（0 正常 1 停用）。 */
    @Schema(description = "状态", requiredMode = Schema.RequiredMode.REQUIRED, example = "0")
    @ExcelProperty("状态")
    private Integer status;

    /** 备注说明。 */
    @Schema(description = "备注", example = "备注信息")
    @ExcelProperty("备注")
    private String remark;

    /** 创建时间。 */
    @Schema(description = "创建时间", requiredMode = Schema.RequiredMode.REQUIRED)
    @ExcelProperty("创建时间")
    private LocalDateTime createTime;

}}
"""

    service_java = f"""package {base_pkg}.service.{entity_pkg};

import com.basicframework.framework.common.pojo.PageResult;
import {base_pkg}.controller.admin.{entity_pkg}.vo.{entity_pascal}PageReqVO;
import {base_pkg}.controller.admin.{entity_pkg}.vo.{entity_pascal}SaveReqVO;
import {base_pkg}.dal.dataobject.{entity_pkg}.{entity_pascal}DO;

import java.util.List;

/**
 * {title}业务服务接口。
 *
 * @author basic-framework
 */
public interface {entity_pascal}Service {{

    /**
     * 创建{title}记录。
     *
     * @param createReqVO 创建参数
     * @return 新建主键编号
     */
    Long create{entity_pascal}({entity_pascal}SaveReqVO createReqVO);

    /**
     * 更新{title}记录。
     *
     * @param updateReqVO 更新参数
     */
    void update{entity_pascal}({entity_pascal}SaveReqVO updateReqVO);

    /**
     * 逻辑删除单条{title}记录。
     *
     * @param id 主键编号
     */
    void delete{entity_pascal}(Long id);

    /**
     * 批量逻辑删除{title}记录。
     *
     * @param ids 主键编号列表
     */
    void delete{entity_pascal}List(List<Long> ids);

    /**
     * 按主键查询{title}详情。
     *
     * @param id 主键编号
     * @return {title}数据对象，不存在时返回 null
     */
    {entity_pascal}DO get{entity_pascal}(Long id);

    /**
     * 分页查询{title}列表。
     *
     * @param pageReqVO 分页筛选条件
     * @return {title}分页结果
     */
    PageResult<{entity_pascal}DO> get{entity_pascal}Page({entity_pascal}PageReqVO pageReqVO);

}}
"""

    service_impl = f"""package {base_pkg}.service.{entity_pkg};

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import {base_pkg}.controller.admin.{entity_pkg}.vo.{entity_pascal}PageReqVO;
import {base_pkg}.controller.admin.{entity_pkg}.vo.{entity_pascal}SaveReqVO;
import {base_pkg}.dal.dataobject.{entity_pkg}.{entity_pascal}DO;
import {base_pkg}.dal.mysql.{entity_pkg}.{entity_pascal}Mapper;
import {base_pkg}.enums.ErrorCodeConstants;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Objects;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;

/**
 * {title}业务服务实现类。
 *
 * @author basic-framework
 */
@Service
public class {entity_pascal}ServiceImpl implements {entity_pascal}Service {{

    @Resource
    private {entity_pascal}Mapper {entity_camel}Mapper;

    /**
     * 创建{title}记录并落库。
     *
     * @param createReqVO 创建参数
     * @return 新建主键编号
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public Long create{entity_pascal}({entity_pascal}SaveReqVO createReqVO) {{
        validateCodeUnique(null, createReqVO.getCode());
        {entity_pascal}DO record = BeanUtils.toBean(createReqVO, {entity_pascal}DO.class);
        record.setId(null);
        {entity_camel}Mapper.insert(record);
        return record.getId();
    }}

    /**
     * 校验存在性与编码唯一性后更新{title}记录。
     *
     * @param updateReqVO 更新参数
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public void update{entity_pascal}({entity_pascal}SaveReqVO updateReqVO) {{
        validateExists(updateReqVO.getId());
        validateCodeUnique(updateReqVO.getId(), updateReqVO.getCode());
        {entity_pascal}DO updateObj = BeanUtils.toBean(updateReqVO, {entity_pascal}DO.class);
        {entity_camel}Mapper.updateById(updateObj);
    }}

    /**
     * 校验存在性后逻辑删除单条{title}记录。
     *
     * @param id 主键编号
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public void delete{entity_pascal}(Long id) {{
        validateExists(id);
        {entity_camel}Mapper.deleteById(id);
    }}

    /**
     * 批量逻辑删除{title}记录。
     *
     * @param ids 主键编号列表
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public void delete{entity_pascal}List(List<Long> ids) {{
        {entity_camel}Mapper.deleteByIds(ids);
    }}

    /**
     * 查询单条{title}记录。
     *
     * @param id 主键编号
     * @return {title}持久化对象
     */
    @Override
    public {entity_pascal}DO get{entity_pascal}(Long id) {{
        return {entity_camel}Mapper.selectById(id);
    }}

    /**
     * 分页查询{title}列表。
     *
     * @param pageReqVO 分页筛选条件
     * @return 分页数据结果
     */
    @Override
    public PageResult<{entity_pascal}DO> get{entity_pascal}Page({entity_pascal}PageReqVO pageReqVO) {{
        return {entity_camel}Mapper.selectPage(pageReqVO);
    }}

    /**
     * 校验目标{title}记录存在，不存在时抛出业务异常。
     *
     * @param id 主键编号
     */
    private void validateExists(Long id) {{
        if (id == null || {entity_camel}Mapper.selectById(id) == null) {{
            throw exception(ErrorCodeConstants.{entity_upper}_NOT_EXISTS);
        }}
    }}

    /**
     * 校验活跃记录中{title}编码唯一，避免唯一索引冲突泄漏底层 SQL 异常。
     *
     * @param id   当前记录主键（新增时为空）
     * @param code {title}编码
     */
    private void validateCodeUnique(Long id, String code) {{
        {entity_pascal}DO existing = {entity_camel}Mapper.selectByCode(code);
        if (existing != null && !Objects.equals(existing.getId(), id)) {{
            throw exception(ErrorCodeConstants.{entity_upper}_CODE_DUPLICATE);
        }}
    }}

}}
"""

    controller_java = f"""package {base_pkg}.controller.admin.{entity_pkg};

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.excel.core.util.ExcelUtils;
import {base_pkg}.controller.admin.{entity_pkg}.vo.{entity_pascal}PageReqVO;
import {base_pkg}.controller.admin.{entity_pkg}.vo.{entity_pascal}RespVO;
import {base_pkg}.controller.admin.{entity_pkg}.vo.{entity_pascal}SaveReqVO;
import {base_pkg}.dal.dataobject.{entity_pkg}.{entity_pascal}DO;
import {base_pkg}.enums.ErrorCodeConstants;
import {base_pkg}.service.{entity_pkg}.{entity_pascal}Service;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.util.List;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.framework.common.pojo.CommonResult.success;

/**
 * 管理后台 - {title}管理控制器。
 *
 * @author basic-framework
 */
@Tag(name = "管理后台 - {title}")
@RestController
@RequestMapping("/{module}/{entity}")
@Validated
public class {entity_pascal}Controller {{

    /** 单次 Excel 导出上限，避免无边界加载全部数据。 */
    private static final int MAX_EXPORT_SIZE = 10_000;

    @Resource
    private {entity_pascal}Service {entity_camel}Service;

    /**
     * 创建{title}记录。
     *
     * @param createReqVO 创建参数
     * @return 新建记录编号
     */
    @PostMapping("/create")
    @Operation(summary = "创建{title}")
    @PreAuthorize("@ss.hasPermission('{perm_prefix}:create')")
    public CommonResult<Long> create{entity_pascal}(@Valid @RequestBody {entity_pascal}SaveReqVO createReqVO) {{
        return success({entity_camel}Service.create{entity_pascal}(createReqVO));
    }}

    /**
     * 修改{title}记录。
     *
     * @param updateReqVO 修改参数
     * @return 是否更新成功
     */
    @PutMapping("/update")
    @Operation(summary = "修改{title}")
    @PreAuthorize("@ss.hasPermission('{perm_prefix}:update')")
    public CommonResult<Boolean> update{entity_pascal}(@Valid @RequestBody {entity_pascal}SaveReqVO updateReqVO) {{
        {entity_camel}Service.update{entity_pascal}(updateReqVO);
        return success(true);
    }}

    /**
     * 删除单条{title}记录。
     *
     * @param id 主键编号
     * @return 是否删除成功
     */
    @DeleteMapping("/delete")
    @Operation(summary = "删除{title}")
    @Parameter(name = "id", description = "编号", required = true)
    @PreAuthorize("@ss.hasPermission('{perm_prefix}:delete')")
    public CommonResult<Boolean> delete{entity_pascal}(@RequestParam("id") Long id) {{
        {entity_camel}Service.delete{entity_pascal}(id);
        return success(true);
    }}

    /**
     * 批量删除{title}记录。
     *
     * @param ids 主键编号列表（最多 100 条）
     * @return 是否删除成功
     */
    @DeleteMapping("/delete-list")
    @Operation(summary = "批量删除{title}")
    @PreAuthorize("@ss.hasPermission('{perm_prefix}:delete')")
    public CommonResult<Boolean> delete{entity_pascal}List(
            @RequestParam("ids") @NotEmpty(message = "编号列表不能为空")
            @Size(max = 100, message = "单次最多批量删除 100 条记录") List<Long> ids) {{
        {entity_camel}Service.delete{entity_pascal}List(ids);
        return success(true);
    }}

    /**
     * 查询单条{title}详情。
     *
     * @param id 主键编号
     * @return {title}响应 VO
     */
    @GetMapping("/get")
    @Operation(summary = "获得{title}")
    @Parameter(name = "id", description = "编号", required = true)
    @PreAuthorize("@ss.hasPermission('{perm_prefix}:query')")
    public CommonResult<{entity_pascal}RespVO> get{entity_pascal}(@RequestParam("id") Long id) {{
        {entity_pascal}DO record = {entity_camel}Service.get{entity_pascal}(id);
        return success(BeanUtils.toBean(record, {entity_pascal}RespVO.class));
    }}

    /**
     * 分页查询{title}列表。
     *
     * @param pageReqVO 分页筛选条件
     * @return {title}分页响应
     */
    @GetMapping("/page")
    @Operation(summary = "获得{title}分页")
    @PreAuthorize("@ss.hasPermission('{perm_prefix}:query')")
    public CommonResult<PageResult<{entity_pascal}RespVO>> get{entity_pascal}Page(@Valid {entity_pascal}PageReqVO pageReqVO) {{
        PageResult<{entity_pascal}DO> pageResult = {entity_camel}Service.get{entity_pascal}Page(pageReqVO);
        return success(BeanUtils.toBean(pageResult, {entity_pascal}RespVO.class));
    }}

    /**
     * 导出{title} Excel 文件。
     *
     * @param exportReqVO 筛选条件
     * @param response    HTTP 响应对象
     * @throws IOException 写出 Excel 流失败时抛出
     */
    @GetMapping("/export-excel")
    @Operation(summary = "导出{title} Excel")
    @PreAuthorize("@ss.hasPermission('{perm_prefix}:export')")
    public void export{entity_pascal}Excel(@Valid {entity_pascal}PageReqVO exportReqVO,
                                           HttpServletResponse response) throws IOException {{
        exportReqVO.setPageNo(1);
        exportReqVO.setPageSize(MAX_EXPORT_SIZE);
        PageResult<{entity_pascal}DO> pageResult = {entity_camel}Service.get{entity_pascal}Page(exportReqVO);
        if (pageResult.getTotal() > MAX_EXPORT_SIZE) {{
            throw exception(ErrorCodeConstants.EXPORT_SIZE_EXCEEDED);
        }}
        ExcelUtils.write(response, "{title}.xlsx", "数据", {entity_pascal}RespVO.class,
                BeanUtils.toBean(pageResult.getList(), {entity_pascal}RespVO.class));
    }}

}}
"""

    h2_extra_lines = (
        "    deleted_tag BIGINT NOT NULL DEFAULT 0,\n"
        f"    CONSTRAINT uk_{table_name}_code_deleted_tag UNIQUE (code, deleted_tag)\n"
        if use_unique_base
        else ""
    )
    h2_sql = f"""CREATE TABLE IF NOT EXISTS {table_name} (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(64) NOT NULL DEFAULT '',
    name VARCHAR(128) NOT NULL,
    status INT NOT NULL DEFAULT 0,
    remark VARCHAR(500),
    creator VARCHAR(64) DEFAULT '',
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updater VARCHAR(64) DEFAULT '',
    update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted SMALLINT NOT NULL DEFAULT 0{(',' if use_unique_base else '')}
{h2_extra_lines.rstrip()}
);
"""

    unique_reinsert_block = (
        f"""
            // 软删除后应允许重建同名编码，验证 SoftDeleteUniqueInnerInterceptor 消歧语义
            {entity_pascal}DO recreated = new {entity_pascal}DO();
            recreated.setCode("{entity_upper}_001");
            recreated.setName("重建{title}");
            recreated.setStatus(0);
            mapper.insert(recreated);
            assertNotNull(recreated.getId());
            assertNotNull(mapper.selectByCode("{entity_upper}_001"));
"""
        if use_unique_base
        else ""
    )

    mapper_test_java = f"""package {base_pkg}.dal.mysql.{entity_pkg};

import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.MybatisSqlSessionFactoryBuilder;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.core.toolkit.GlobalConfigUtils;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.basicframework.framework.mybatis.core.interceptor.SoftDeleteUniqueInnerInterceptor;
import {base_pkg}.controller.admin.{entity_pkg}.vo.{entity_pascal}PageReqVO;
import {base_pkg}.dal.dataobject.{entity_pkg}.{entity_pascal}DO;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.h2.Driver;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.SimpleDriverDataSource;
import org.springframework.jdbc.datasource.init.DatabasePopulatorUtils;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import javax.sql.DataSource;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.Statement;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * {title} Mapper H2 MySQL 模式 SQL 切片测试（复用纯 MyBatis-Plus 会话工厂，无 Spring 容器开销）。
 *
 * @author basic-framework
 */
class {entity_pascal}MapperTest {{

    /** 共享内存库的 MyBatis 会话工厂。 */
    private static SqlSessionFactory sqlSessionFactory;

    /** 隔离的 H2 内存数据源。 */
    private static DataSource dataSource;

    /**
     * 初始化 H2 MySQL 兼容模式数据源与 MyBatis-Plus 逻辑删除、软删唯一键消歧及审计填充拦截器。
     */
    @BeforeAll
    static void setUpSessionFactory() {{
        String jdbcUrl = "jdbc:h2:mem:{table_name}_" + UUID.randomUUID()
                + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;NON_KEYWORDS=VALUE,KEY,USER;DB_CLOSE_DELAY=-1";
        dataSource = new SimpleDriverDataSource(new Driver(), jdbcUrl, "sa", "");
        ResourceDatabasePopulator populator = new ResourceDatabasePopulator();
        populator.setSqlScriptEncoding(StandardCharsets.UTF_8.name());
        populator.addScript(new ClassPathResource("sql/{table_name}_schema.sql"));
        DatabasePopulatorUtils.execute(populator, dataSource);

        MybatisConfiguration configuration = new MybatisConfiguration(
                new Environment("test", new JdbcTransactionFactory(), dataSource));
        configuration.setMapUnderscoreToCamelCase(true);

        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
        interceptor.addInnerInterceptor(new SoftDeleteUniqueInnerInterceptor());
        interceptor.addInnerInterceptor(new PaginationInnerInterceptor(DbType.H2));
        configuration.addInterceptor(interceptor);

        GlobalConfig globalConfig = GlobalConfigUtils.defaults();
        globalConfig.setBanner(false);
        globalConfig.setMetaObjectHandler(new DefaultDBFieldHandler());
        GlobalConfig.DbConfig dbConfig = globalConfig.getDbConfig();
        dbConfig.setIdType(IdType.AUTO);
        dbConfig.setLogicDeleteField("deleted");
        dbConfig.setLogicDeleteValue("1");
        dbConfig.setLogicNotDeleteValue("0");
        GlobalConfigUtils.setGlobalConfig(configuration, globalConfig);
        configuration.addMapper({entity_pascal}Mapper.class);

        sqlSessionFactory = new MybatisSqlSessionFactoryBuilder().build(configuration);
    }}

    /**
     * 每个用例前清空数据表，避免用例间数据串扰。
     *
     * @throws Exception 清空表失败时抛出
     */
    @BeforeEach
    void cleanTable() throws Exception {{
        try (Connection connection = dataSource.getConnection();
             Statement statement = connection.createStatement()) {{
            statement.execute("TRUNCATE TABLE {table_name}");
        }}
    }}

    /**
     * 验证插入、分页筛选、逻辑删除后不可查询以及软删唯一键重建语义。
     */
    @Test
    void shouldInsertPageAndSoftDelete() {{
        try (SqlSession session = sqlSessionFactory.openSession(true)) {{
            {entity_pascal}Mapper mapper = session.getMapper({entity_pascal}Mapper.class);
            {entity_pascal}DO entity = new {entity_pascal}DO();
            entity.setCode("{entity_upper}_001");
            entity.setName("示例{title}");
            entity.setStatus(0);
            mapper.insert(entity);
            assertNotNull(entity.getId());

            {entity_pascal}PageReqVO pageReqVO = new {entity_pascal}PageReqVO();
            pageReqVO.setName("示例");
            PageResult<{entity_pascal}DO> page = mapper.selectPage(pageReqVO);
            assertEquals(1L, page.getTotal());

            mapper.deleteById(entity.getId());
            assertNull(mapper.selectById(entity.getId()));{unique_reinsert_block}
        }}
    }}

}}
"""

    files = {
        f"{main_dir}/dal/dataobject/{entity_pkg}/{entity_pascal}DO.java": do_java,
        f"{main_dir}/dal/mysql/{entity_pkg}/{entity_pascal}Mapper.java": mapper_java,
        f"{main_dir}/controller/admin/{entity_pkg}/vo/{entity_pascal}SaveReqVO.java": save_req_vo,
        f"{main_dir}/controller/admin/{entity_pkg}/vo/{entity_pascal}PageReqVO.java": page_req_vo,
        f"{main_dir}/controller/admin/{entity_pkg}/vo/{entity_pascal}RespVO.java": resp_vo,
        f"{main_dir}/service/{entity_pkg}/{entity_pascal}Service.java": service_java,
        f"{main_dir}/service/{entity_pkg}/{entity_pascal}ServiceImpl.java": service_impl,
        f"{main_dir}/controller/admin/{entity_pkg}/{entity_pascal}Controller.java": controller_java,
        f"{test_res_dir}/{table_name}_schema.sql": h2_sql,
        f"{test_dir}/dal/mysql/{entity_pkg}/{entity_pascal}MapperTest.java": mapper_test_java,
    }
    return table_name, files


def scaffold_java_crud(
    root: Path,
    raw_module: str,
    raw_entity: str,
    *,
    title: str,
    use_unique_base: bool = False,
    apply: bool = False,
) -> JavaCrudPlan:
    """在指定 Java 业务模块中生成单表 CRUD 源码、H2 切片测试与建表 SQL。

    Args:
        root: 仓库根目录。
        raw_module: 已有业务模块短名（例如 crm）。
        raw_entity: 实体路径标识（例如 customer、sales-order）。
        title: 中文业务名称（例如 客户）。
        use_unique_base: 为 True 时继承 UniqueBaseDO 并生成含 deleted_tag 的唯一索引。
        apply: 为 True 时实际写入；默认仅预览。
    Returns:
        后端 CRUD 生成计划快照。
    Raises:
        ValueError: 目标模块目录不存在、命名非法或目标文件已存在时抛出。
    """
    module = _validate_identifier("模块名", raw_module)
    entity = _validate_entity_identifier(raw_entity)
    clean_title = title.strip()
    if not clean_title:
        raise ValueError("必须提供非空的中文业务标题 --title")

    resolved_root = root.resolve()
    module_dir = resolved_root / "后端代码" / "basic-framework-boot" / f"basic-framework-module-{module}"
    if not module_dir.is_dir():
        raise ValueError(
            f"目标模块目录不存在：{module_dir.relative_to(resolved_root).as_posix()}，"
            f"请先运行 new_java_module.py {module} --apply"
        )

    table_name, files = _render_java_crud_files(module, entity, clean_title, use_unique_base)
    ddl_sql = _render_mysql_ddl(table_name, clean_title, use_unique_base)
    error_code_rel, updated_error_code = _prepare_error_code_update(
        resolved_root, module, entity, clean_title
    )

    for rel_path in files:
        if (resolved_root / rel_path).exists():
            raise ValueError(f"目标文件已存在，拒绝覆盖：{rel_path}")

    updated_files = (error_code_rel,) if updated_error_code is not None else ()
    if apply:
        for rel_path, content in files.items():
            target = resolved_root / rel_path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8", newline="\n")
        if updated_error_code is not None:
            (resolved_root / error_code_rel).write_text(
                updated_error_code, encoding="utf-8", newline="\n"
            )

    return JavaCrudPlan(
        module=module,
        entity=entity,
        title=clean_title,
        table_name=table_name,
        use_unique_base=use_unique_base,
        created_files=tuple(sorted(files)),
        ddl_sql=ddl_sql,
        applied=apply,
        updated_files=updated_files,
    )


def main(argv: list[str] | None = None) -> int:
    """解析命令行参数并执行后端实体 CRUD 脚手架。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("module", nargs="?", default=None, help="已有业务模块短名（如 crm）")
    parser.add_argument("entity", nargs="?", default=None, help="实体路径标识（如 customer、sales-order）")
    parser.add_argument("--module", dest="module_opt", default=None, help="已有业务模块短名（命名参数形式）")
    parser.add_argument("--entity", dest="entity_opt", default=None, help="实体路径标识（命名参数形式）")
    parser.add_argument("--title", required=True, help="实体中文名称（如 客户）")
    parser.add_argument(
        "--unique-code",
        action="store_true",
        help="继承 UniqueBaseDO 并生成含 deleted_tag 的唯一编码索引",
    )
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="仓库根目录")
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument(
        "--dry-run",
        action="store_true",
        help="只读预览拟生成文件与建表 DDL，不写入磁盘（默认）",
    )
    mode_group.add_argument("--apply", action="store_true", help="实际写入文件（默认仅预览）")
    args = parser.parse_args(argv)

    raw_module = args.module_opt or args.module
    raw_entity = args.entity_opt or args.entity
    if not raw_module or not raw_entity:
        parser.error("必须提供模块名与实体名（如 crm customer 或 --module crm --entity customer）")

    try:
        plan = scaffold_java_crud(
            args.root,
            raw_module,
            raw_entity,
            title=args.title,
            use_unique_base=args.unique_code,
            apply=args.apply,
        )
    except ValueError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1

    mode_label = "已写入" if plan.applied else "预览（未写入，传入 --apply 落盘）"
    print(f"[{mode_label}] 后端 CRUD：{plan.module}/{plan.entity}（表 `{plan.table_name}`）")
    for path in plan.created_files:
        print(f"  + {path}")
    for path in plan.updated_files:
        print(f"  ~ {path}")
    print("\n-- 配套 MySQL 建表 DDL 预览 --")
    print(plan.ddl_sql.rstrip())
    print("\n-- 后续收口步骤 --")
    print("1. 将上方建表 DDL 合入 数据库文件/basic_framework.sql")
    print(
        f"2. 运行 python -B -X utf8 scripts/scaffold/new_web_crud.py {plan.module} {plan.entity} "
        f"--title {plan.title} --apply 并将输出菜单 SQL 合入 数据库文件/basic_framework.sql"
    )
    print(
        "3. 运行 cd 后端代码/basic-framework-boot && mvn -B -ntp -pl basic-framework-server -am "
        "-Dtest=SchemaDoRbacParityTest,OpenApiContractSnapshotTest "
        "-Dsurefire.failIfNoSpecifiedTests=false -Dopenapi.update=true test"
    )
    print("4. 运行 cd 前端代码/basic-framework-admin && pnpm api:gen")
    print("5. 运行 python -B -X utf8 scripts/workflow/verify_slice.py --base main")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
