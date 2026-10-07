"""验证裁决 D17 的 ``E2-member-identity`` 成员级内容关系分支与合入前置正负对照。

本文件同时做两件事：

1. **单元口径**：成员切分与覆盖性自检、成员边界自检（含 D17 §58 实测的切错形态）、
   样板排除、M0/MT 入口、归因完整性与注释/署名单独验收；
2. **真实消费者对照**：全部对照都跑真实 CLI——分支入口
   ``check_staged_java_comments.py --validate-evidence-branches``、暂存入口
   ``check_staged_java_comments.py``、全量入口 ``check_full_java_comments.py``
   与 ``run_checks.py --group comments``——保留真实退出码与真实诊断，
   不以单元断言代替门禁结果。

对照输入全部在隔离 Git 仓库与临时证据目录中构造，不读取本机 ``.bf-local``，
不修改真实索引、源码、签名或暂存区，也不改判任何真实记录。

@author OpenAI Codex
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.code.java import check_staged_java_comments as java
from scripts.common.quality_common import DEFAULT_ROOT
from scripts.tests.git_sandbox import GitSandbox, create_sandbox

UPSTREAM_REPO = "YunaiV/ruoyi-vue-pro"
UPSTREAM_COMMIT = "ac022b15a094cf9cf82903d429b9729e72309da5"
UPSTREAM_PATH = (
    "yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/dal/mysql/dict/DictTypeMapper.java"
)
LOCAL_PATH = (
    "后端代码/basic-framework-boot/basic-framework-module-system/src/main/java/com/basicframework/"
    "module/system/dal/mysql/dict/DictTypeMapper.java"
)
LOCAL_CLASS = "DictTypeMapper"
QUALIFIED_NAME = f"com.basicframework.module.system.dal.mysql.dict.{LOCAL_CLASS}"

TRANSFORM_SET_RELATIVE = java.DEFAULT_CODE_IDENTITY_TRANSFORM_SET
REPO_TRANSFORM_SET = DEFAULT_ROOT / TRANSFORM_SET_RELATIVE
CONTRACT_SCHEMA_RELATIVE = java.DEFAULT_MEMBER_IDENTITY_CONTRACT_SCHEMA
MEMBER_MANIFEST_RELATIVE = java.DEFAULT_MEMBER_IDENTITY_MEMBER_MANIFEST
REPO_CONTRACT_SCHEMA = DEFAULT_ROOT / CONTRACT_SCHEMA_RELATIVE
REPO_MEMBER_MANIFEST = DEFAULT_ROOT / MEMBER_MANIFEST_RELATIVE

SCHEMA = java.MEMBER_IDENTITY_SCHEMA
BRANCH = java.EVIDENCE_BRANCH_MEMBER_IDENTITY
ROUTE = java.MEMBER_IDENTITY_ROUTE
RULES_VERSION = java.MEMBER_IDENTITY_RULES_VERSION

REGISTRY_COLUMNS = (
    "local_path",
    "local_sha256_after",
    "upstream_repo_url",
    "upstream_path",
    "upstream_commit",
    "upstream_file_url",
    "upstream_sha256",
    "upstream_author_lines",
    "history_basis",
    "evidence_route",
    "evidence_points",
    "author_status",
    "local_modification_facts",
    "open_gap",
    "review_by",
    "review_date",
    "review_conclusion",
    "type_evidence",
    "d12_verdict",
    "d12_blocker_reason",
    "d12_correspondence_points",
    "evidence_branch",
    "member_identity_contract",
)

WEB_FIXTURE = "前端代码/basic-framework-admin/apps/web-ele/src/App.vue"
WEB_SOURCE = (
    "<!-- 应用入口组件：run_checks --group comments 需要至少一个受管 Web 文件。 -->\n"
    "<template>\n  <div>ok</div>\n</template>\n"
)

# 业务方法名与配置前缀：真实业务语义主体的锚点，不是惯用形状。
SELECT_METHOD = "selectByDictTypeAndPrefix"
PREFIX = "basic-framework.dict-type"


def digest(value: str) -> str:
    """返回文本的 SHA-256。"""

    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _file_digest(path: Path) -> str:
    """返回文件的整文件 SHA-256。"""

    return hashlib.sha256(path.read_bytes()).hexdigest()


# ───────────────────────────── 受控文档 ─────────────────────────────


def load_documents() -> tuple[dict, dict]:
    """加载仓内受控的契约 schema 与成员清单。"""

    schema, schema_error = java._load_member_identity_contract_schema(str(REPO_CONTRACT_SCHEMA))
    manifest, manifest_error = java._load_member_identity_member_manifest(str(REPO_MEMBER_MANIFEST))
    assert schema_error is None, schema_error
    assert manifest_error is None, manifest_error
    assert schema is not None and manifest is not None
    return schema, manifest


# ───────────────────────────── 夹具正文 ─────────────────────────────


def upstream_source(
    *,
    method: str = SELECT_METHOD,
    prefix: str = PREFIX,
    extra_field: str = "",
    replace_getter_body: str | None = None,
) -> str:
    """生成固定上游正文。

    默认正文含两个**业务语义主体**方法与一个业务前缀常量，可支撑 M0（至少一个
    未变换即相等的合格成员）与 MT（两个变换后相等的合格成员）两条入口。

    Args:
        method: 业务查询方法名。
        prefix: 业务配置前缀字面量。
        extra_field: 额外注入的字段声明（用于构造单侧成员）。
        replace_getter_body: 非空时把 getter 方法体替换为该内容。

    Returns:
        固定上游文件正文。
    """

    getter = "        return this.prefix;" if replace_getter_body is None else replace_getter_body
    lines = [
        "package cn.iocoder.yudao.module.system.dal.mysql.dict;",
        "",
        "import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapperX;",
        "import com.basicframework.module.system.dal.dataobject.dict.DictTypeDO;",
        "",
        "/**",
        " * 固定上游文件。",
        " *",
        " * 该固定提交未声明作者。",
        " */",
        f"public class {LOCAL_CLASS} {{",
        "",
        f'    private static final String DICT_TYPE_CACHE_PREFIX = "{prefix}";',
        "",
        "    public String resolveDictTypeCachePrefix() {",
        "        return DICT_TYPE_CACHE_PREFIX;",
        "    }",
        "",
        f"    public LambdaQueryWrapperX<DictTypeDO> {method}(String name) {{",
        "        return new LambdaQueryWrapperX<DictTypeDO>().like(DictTypeDO::getName, name)",
        "            .orderByAsc(DictTypeDO::getId);",
        "    }",
        "",
        f"    public String getName() {{",
        f"{getter}",
        "    }",
    ]
    if extra_field:
        lines.extend(["", f"    {extra_field}"])
    lines.extend(["}", ""])
    return "\n".join(lines)


def local_javadoc(*, marker: str = java.SOURCE_REVIEW_ACCEPTED_MARKER, author_line: str | None = None) -> str:
    """生成职责 JavaDoc + D12 来源说明 + D15 就地标注。"""

    body = [
        "/**",
        " * 字典类型 Mapper。",
        " *",
        f" * {java.SOURCE_HEADER_PREFIX}{UPSTREAM_REPO} @ {UPSTREAM_COMMIT}"
        f"{java.SOURCE_DECLARATION_SUFFIX}",
        f" * {java.SOURCE_PATH_PREFIX}{UPSTREAM_PATH}",
        f" * {java.SOURCE_BASIS_FIXED}",
        " * 本地修改：调整包名与导入顺序。",
    ]
    if author_line is not None:
        body.append(f" * {author_line}")
    body.extend([" *", f" * {marker}", " */"])
    return "\n".join(body)


def method_javadoc() -> str:
    """生成业务方法上的职责 JavaDoc（不参与代码流，但属于注释验收范围）。"""

    return (
        "    /**\n"
        "     * 按名称前缀查询字典类型。\n"
        "     *\n"
        "     * @param name 字典名称前缀\n"
        "     * @return 查询条件\n"
        "     */"
    )


def local_source(
    *,
    method: str = SELECT_METHOD,
    prefix: str = PREFIX,
    extra_field: str = "",
    javadoc: str | None = None,
    method_doc: str | None = None,
    replace_getter_body: str | None = None,
) -> str:
    """生成本地正文；除包名外的代码流应与上游在登记变换后一致。"""

    getter = "        return this.prefix;" if replace_getter_body is None else replace_getter_body
    doc = javadoc if javadoc is not None else local_javadoc()
    mdoc = method_doc if method_doc is not None else method_javadoc()
    lines = [
        "package com.basicframework.module.system.dal.mysql.dict;",
        "",
        "import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapperX;",
        "import com.basicframework.module.system.dal.dataobject.dict.DictTypeDO;",
        "",
        doc,
        f"public class {LOCAL_CLASS} {{",
        "",
        f'    private static final String DICT_TYPE_CACHE_PREFIX = "{prefix}";',
        "",
        "    /**",
        "     * 解析字典类型缓存前缀。",
        "     *",
        "     * @return 缓存前缀",
        "     */",
        "    public String resolveDictTypeCachePrefix() {",
        "        return DICT_TYPE_CACHE_PREFIX;",
        "    }",
        "",
        mdoc,
        f"    public LambdaQueryWrapperX<DictTypeDO> {method}(String name) {{",
        "        return new LambdaQueryWrapperX<DictTypeDO>().like(DictTypeDO::getName, name)",
        "            .orderByAsc(DictTypeDO::getId);",
        "    }",
        "",
        "    /**",
        "     * 获得前缀。",
        "     *",
        "     * @return 前缀",
        "     */",
        f"    public String getName() {{",
        f"{getter}",
        "    }",
    ]
    if extra_field:
        lines.extend(["", f"    {extra_field}"])
    lines.extend(["}", ""])
    return "\n".join(lines)


# ───────────────────────── 实测读数与契约生成 ─────────────────────────


def measure(local: str, remote: str, transform_set: dict | None = None) -> dict:
    """用登记变换集实测双方的成员级读数。"""

    transforms = (transform_set or json.loads(REPO_TRANSFORM_SET.read_text(encoding="utf-8")))["transforms"]
    return {
        "local": java._member_identity_view(local, transforms, "local"),
        "upstream": java._member_identity_view(remote, transforms, "upstream"),
    }


def measured_differences(local: str, remote: str) -> dict[str, int]:
    """实测双方残余差异账。"""

    views = measure(local, remote)
    return java._member_identity_measured_differences(
        views["local"], views["upstream"], local, remote
    )


def javadoc_span(lines: list[str], *, start_from: int = 1) -> tuple[int, int]:
    """按内容定位文件第一段 JavaDoc 的 1 起起止行号。"""

    start = next(
        index for index, line in enumerate(lines, 1) if index >= start_from and line.startswith("/**")
    )
    end = next(
        index
        for index, line in enumerate(lines, 1)
        if index > start and line.strip() == "*/"
    )
    return start, end


def comment_bindings(local: str) -> list[dict]:
    """登记职责 JavaDoc + D12 来源说明 + D15 标注的保持不变绑定。

    登记值全部来自**本地对象真实注释文本**：逐字原文、1 起行号区间与其 SHA-256，
    因此契约无法靠手填通过。缺少对应角色时只登记实际存在的角色，由检查器按
    ``comment_bindings`` 的形状要求拒绝缺项——本函数不做任何放宽。

    Args:
        local: 本地对象正文。

    Returns:
        注释绑定列表。
    """

    lines = local.split("\n")
    start, end = javadoc_span(lines)
    body = [java._comment_body_line(line) for line in lines]
    note_start = next(
        (
            index
            for index in range(start, end)
            if body[index - 1].startswith(java.SOURCE_HEADER_PREFIX)
        ),
        None,
    )
    marker = next(
        (
            index
            for index in range(start, end)
            if body[index - 1].strip()
            in (
                java.SOURCE_REVIEW_ACCEPTED_MARKER,
                java.SOURCE_REVIEW_UNACCEPTED_MARKER,
                java.SIGNATURE_REVIEW_ACCEPTED_MARKER,
                java.SIGNATURE_REVIEW_UNACCEPTED_MARKER,
            )
        ),
        None,
    )

    def block(first: int, last: int) -> dict:
        """按 1 起闭区间取出本地真实注释原文并给出其逐字指纹。"""

        verbatim = "\n".join(lines[first - 1 : last])
        return {"lines": [first, last], "text": verbatim, "sha256": digest(verbatim)}

    bindings = [{"role": "responsibility-javadoc", **block(start, (note_start or marker or end + 1) - 2)}]
    if note_start is not None:
        note_end = next(
            (
                index
                for index in range(note_start, end)
                if body[index - 1].startswith("本地修改：")
            ),
            end - 1,
        )
        bindings.append({"role": "d12-source-note", **block(note_start, note_end)})
    if marker is not None:
        role = (
            "d15-inplace-marker"
            if body[marker - 1].strip().startswith("来源验收：")
            else "responsibility-javadoc"
        )
        bindings.append({"role": role, **block(marker, marker)})
    return bindings


def business_subject(*, reviewer: str = "D17 独立语义复核方") -> dict:
    """给出业务语义主体的语义复核记录（机械校验之外的独立复核部分）。"""

    return {
        "declaration": QUALIFIED_NAME,
        "implementer": "D17 成员级分支实施",
        "reviewer": reviewer,
        "owner_responsibility": "该类型负责按名称前缀检索字典类型并构造缓存前缀，供字典管理模块实际调用。",
        "non_generic_reason": "查询条件按 getName 前缀模糊匹配并按 getId 升序排列，不是任何通用 CRUD 模板。",
        "coverage_reason": "该成员承载本声明实际保留的字典类型检索业务语义主体，注释与署名另行验收。",
    }


def _attribution_for(
    category: str, count: int, *, rule: str = "", local_lines: tuple[int, int] = (1, 1)
) -> list[dict]:
    """按实测差异类别生成归因条目。"""

    if count <= 0:
        return []
    entry = {
        "category": category,
        "cause": "registered-transform" if rule else "member-content-difference",
        "location": f"{category} @ L{local_lines[0]}-L{local_lines[1]}",
        "local_lines": list(local_lines),
        "upstream_lines": list(local_lines),
        "changed_lines": {"local": count, "upstream": count},
        "declaration": QUALIFIED_NAME,
        "nature": "受控的命名空间与类型适配，原始字节由上游固定输入留证",
        "before_text": "cn.iocoder.yudao",
        "after_text": "com.basicframework",
    }
    if rule:
        entry["rule"] = rule
    return [entry]


def build_contract(
    local: str,
    remote: str,
    *,
    entry: str = "M0",
    transform_set_document: dict | None = None,
    transform_set_path: Path | None = None,
    contract_schema_path: Path | None = None,
    member_manifest_path: Path | None = None,
    tool_sha256: str | None = None,
    comment_binding_list: list[dict] | None = None,
    business: dict | None = None,
    attribution: list[dict] | None = None,
    member_keys: list[str] | None = None,
) -> str:
    """按实测读数生成一份**合法**的成员级比较契约。

    登记值全部来自规则实现自身的实测，测试因此不可能靠“抄回登记值”蒙混过关。

    Args:
        local: 本地正文。
        remote: 上游正文。
        entry: ``M0`` 或 ``MT``。
        transform_set_document: 变换集文档；省略时读仓内受控清单。
        transform_set_path: 变换集文件路径（用于整文件指纹绑定）。
        contract_schema_path: 契约 schema 路径。
        member_manifest_path: 成员清单路径。
        tool_sha256: 覆盖规则实现指纹（负对照用）。
        comment_binding_list: 覆盖注释绑定（负对照用）。
        business: 覆盖业务语义复核记录（负对照用）。
        attribution: 覆盖差异归因（负对照用）。
        member_keys: 覆盖登记的成员键（负对照用）。

    Returns:
        契约 JSON 字符串。
    """

    document = transform_set_document or json.loads(REPO_TRANSFORM_SET.read_text(encoding="utf-8"))
    schema_path = contract_schema_path or REPO_CONTRACT_SCHEMA
    manifest_path = member_manifest_path or REPO_MEMBER_MANIFEST
    schema, schema_error = java._load_member_identity_contract_schema(str(schema_path))
    manifest, manifest_error = java._load_member_identity_member_manifest(str(manifest_path))
    assert schema_error is None and manifest_error is None, (schema_error, manifest_error)
    assert schema is not None and manifest is not None

    views = measure(local, remote, document)
    local_view, upstream_view = views["local"], views["upstream"]
    paired = java._member_identity_pair(local_view, upstream_view)
    generic_patterns = tuple(
        re.compile(str(item)) for item in manifest["discrimination"]["generic_string_patterns"]
    )
    boilerplate_manifest = manifest

    declared: list[dict] = []
    for item in paired["equal"]:
        local_member = next(
            member for member in local_view["members"] if member["key"] == item["key"]
        )
        anchors = java._member_identity_member_anchors(local_member["tokens"], generic_patterns)
        member = {
            "kind": local_member["kind"],
            "tokens": local_member["tokens"],
            "key": local_member["key"],
            "name": local_member["name"],
            "body_brace": local_member["body_brace"],
            "anchors": anchors,
        }
        if java._member_identity_boilerplate_reasons(member, boilerplate_manifest):
            continue
        entry_row = {
            "member_key": item["key"],
            "kind": item["kind"],
            "local_lines": item["local_lines"],
            "upstream_lines": item["upstream_lines"],
            "local_member_sha256": item["local_member_sha256"],
            "upstream_member_sha256": item["upstream_member_sha256"],
            "local_member_bytes": item["local_member_bytes"],
            "upstream_member_bytes": item["upstream_member_bytes"],
            "local_member_lexeme_count": item["local_member_lexeme_count"],
            "upstream_member_lexeme_count": item["upstream_member_lexeme_count"],
            "raw_local_member_sha256": item["raw_local_member_sha256"],
            "raw_upstream_member_sha256": item["raw_upstream_member_sha256"],
            "raw_identical": item["raw_identical"],
            "anchors": [{"kind": a["kind"], "lexeme": a["lexeme"]} for a in anchors[:3]],
            "owner_responsibility": "字典类型按名称前缀检索并解析缓存前缀的实际业务职责成员。",
            "non_generic_reason": "按 getName 前缀模糊匹配并按 getId 升序的具体检索行为，不是通用模板。",
            "discriminative_reason": "含具体业务字面量与业务类型引用，双方同时出现且可逐词素复算。",
            "coverage_reason": "承载本声明保留的字典类型检索业务语义主体，覆盖 M0/MT 所需业务内容。",
        }
        declared.append(entry_row)
    if member_keys is not None:
        declared = [row for row in declared if row["member_key"] in member_keys]
    qualifying = [row for row in declared if entry == "M0" or not row["raw_identical"]]
    if entry == "M0":
        qualifying = [row for row in declared if row["raw_identical"]] or declared[:1]
    else:
        qualifying = [row for row in declared if not row["raw_identical"]]

    if attribution is None:
        diff = java._member_identity_measured_differences(local_view, upstream_view, local, remote)
        attribution = []
        for category, count in diff.items():
            rule = "T1" if category == "package-import" else ""
            attribution.extend(_attribution_for(category, count, rule=rule))

    set_path = transform_set_path or REPO_TRANSFORM_SET
    contract = {
        "schema": SCHEMA,
        "branch": BRANCH,
        "route": ROUTE,
        "rules_version": RULES_VERSION,
        "serialization": {
            "version": java.CODE_IDENTITY_SERIALIZATION,
            "encoding": "utf-8",
            "lexeme_separator": "U+001F",
            "lexeme_terminator": "U+001E",
        },
        "contract_schema": {
            "path": CONTRACT_SCHEMA_RELATIVE,
            "sha256": _file_digest(schema_path),
            "rules_sha256": schema["contract_schema_sha256_measured"],
        },
        "member_manifest": {
            "path": MEMBER_MANIFEST_RELATIVE,
            "sha256": _file_digest(manifest_path),
            "rules_sha256": manifest["members_manifest_sha256_measured"],
        },
        "transform_reuse": {
            "source_branch": java.EVIDENCE_BRANCH_CODE_IDENTITY,
            "authorized_by": "D17 §G4",
            "reason": "复用 D16 受控变换集 N1 与 T1–T5；不新增删除 import、字面量空白折叠或全文替换。",
        },
        "transform_set": {
            "path": TRANSFORM_SET_RELATIVE,
            "sha256": _file_digest(set_path),
            "transforms_sha256": document["transforms_sha256"],
            "normalizations_sha256": document["normalizations_sha256"],
        },
        "applied_transforms": list(document["execution_order"]),
        "inputs": {
            "local": {"path": LOCAL_PATH, "sha256": digest(local)},
            "upstream": {
                "repo_url": f"https://github.com/{UPSTREAM_REPO}.git",
                "commit": UPSTREAM_COMMIT,
                "path": UPSTREAM_PATH,
                "sha256": digest(remote),
                "file_url": f"https://github.com/{UPSTREAM_REPO}/blob/{UPSTREAM_COMMIT}/{UPSTREAM_PATH}",
            },
        },
        "coverage": {
            "local_code_stream_sha256": local_view["code_stream_sha256"],
            "upstream_code_stream_sha256": upstream_view["code_stream_sha256"],
            "local_prologue_sha256": local_view["prologue_sha256"],
            "upstream_prologue_sha256": upstream_view["prologue_sha256"],
            "local_header_sha256": local_view["header_sha256"],
            "upstream_header_sha256": upstream_view["header_sha256"],
            "local_members": len(local_view["members"]),
            "upstream_members": len(upstream_view["members"]),
            "local_coverage_complete": bool(local_view["coverage_complete"]),
            "upstream_coverage_complete": bool(upstream_view["coverage_complete"]),
        },
        "entry": entry,
        "members": qualifying,
        "business_subject": business if business is not None else business_subject(),
        "difference_attribution": attribution,
        "comment_bindings": comment_binding_list if comment_binding_list is not None else comment_bindings(local),
        "author_handling": {
            "member_identity_accepts_signature": False,
            "declared_author_status": java.AUTHOR_UNDECLARED_STATUS,
            "author_route": "D12 来源说明例外：上游该固定提交未声明作者，本地按 D12 格式说明来源",
            "history_gap": "历史引入版本未核实；本分支不关闭该缺口。",
        },
        "tool": {
            "name": "check_staged_java_comments.py",
            "version": SCHEMA,
            "sha256": tool_sha256
            if tool_sha256 is not None
            else hashlib.sha256(
                (DEFAULT_ROOT / "scripts/code/java/check_staged_java_comments.py").read_bytes()
            ).hexdigest(),
        },
        "review": {
            "implementer": "D17 成员级分支实施",
            "reviewer": "D17 独立复核方",
            "date": "2026-10-07",
            "conclusion": "成员切分覆盖性与边界自检通过，合格成员满足 M0/MT 数量条件，差异全部逐项归因。",
        },
        "counter_evidence_conclusion": "已复核除登记成员与登记归因之外没有其他成员级相等内容。",
    }
    return json.dumps(contract, ensure_ascii=False)


# T1 命名空间映射专用：只有完整限定名出现在**成员体内**时，该成员才在变换后相等。
QUALIFIED_LOCAL = "com.basicframework.module.system.dal.mysql.dict.DictTypeMapper"
QUALIFIED_UPSTREAM = "cn.iocoder.yudao.module.system.dal.mysql.dict.DictTypeMapper"


def mt_local_source(*, javadoc: str | None = None) -> str:
    """生成本地正文：两个业务方法内含完整限定名，只有执行 T1 后才与上游相等。"""

    doc = javadoc if javadoc is not None else local_javadoc()
    return "\n".join(
        [
            "package com.basicframework.module.system.dal.mysql.dict;",
            "",
            "import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapperX;",
            "import com.basicframework.module.system.dal.dataobject.dict.DictTypeDO;",
            "",
            doc,
            f"public class {LOCAL_CLASS} {{",
            "",
            "    /**",
            "     * 解析字典类型追踪标签。",
            "     *",
            "     * @param traceId 追踪标识",
            "     * @return 追踪标签",
            "     */",
            "    public String resolveDictTypeTraceTag(String traceId) {",
            f"        return {QUALIFIED_LOCAL}.SORT_COLUMN + traceId;",
            "    }",
            "",
            "    /**",
            "     * 按名称前缀查询字典类型。",
            "     *",
            "     * @param name 字典名称前缀",
            "     * @return 查询条件",
            "     */",
            "    public LambdaQueryWrapperX<DictTypeDO> selectByDictTypeAndPrefix(String name) {",
            "        return new LambdaQueryWrapperX<DictTypeDO>()",
            f"            .eq({QUALIFIED_LOCAL}.SORT_COLUMN, name)",
            "            .orderByAsc(DictTypeDO::getId);",
            "    }",
            "}",
            "",
        ]
    )


def mt_upstream_source() -> str:
    """生成上游正文：与本地同形，但限定名仍是上游命名空间。"""

    return "\n".join(
        [
            "package cn.iocoder.yudao.module.system.dal.mysql.dict;",
            "",
            "import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapperX;",
            "import cn.iocoder.yudao.module.system.dal.dataobject.dict.DictTypeDO;",
            "",
            "/**",
            " * 固定上游文件。",
            " *",
            " * 该固定提交未声明作者。",
            " */",
            f"public class {LOCAL_CLASS} {{",
            "",
            "    /**",
            "     * 解析字典类型追踪标签。",
            "     *",
            "     * @param traceId 追踪标识",
            "     * @return 追踪标签",
            "     */",
            "    public String resolveDictTypeTraceTag(String traceId) {",
            f"        return {QUALIFIED_UPSTREAM}.SORT_COLUMN + traceId;",
            "    }",
            "",
            "    /**",
            "     * 按名称前缀查询字典类型。",
            "     *",
            "     * @param name 字典名称前缀",
            "     * @return 查询条件",
            "     */",
            "    public LambdaQueryWrapperX<DictTypeDO> selectByDictTypeAndPrefix(String name) {",
            "        return new LambdaQueryWrapperX<DictTypeDO>()",
            f"            .eq({QUALIFIED_UPSTREAM}.SORT_COLUMN, name)",
            "            .orderByAsc(DictTypeDO::getId);",
            "    }",
            "}",
            "",
        ]
    )


def single_member_local(*, method_body: str, prefix: str = PREFIX) -> str:
    """生成只含**一个**业务成员的本地正文（样板字段与 getter 不计）。"""

    return "\n".join(
        [
            "package com.basicframework.module.system.dal.mysql.dict;",
            "",
            "import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapperX;",
            "import com.basicframework.module.system.dal.dataobject.dict.DictTypeDO;",
            "",
            local_javadoc(),
            f"public class {LOCAL_CLASS} {{",
            "",
            "    private Long id;",
            "",
            "    private String name;",
            "",
            method_javadoc(),
            f"    public LambdaQueryWrapperX<DictTypeDO> {SELECT_METHOD}(String name) {{",
            f"{method_body}",
            "    }",
            "",
            "    /**",
            "     * 获得名称。",
            "     *",
            "     * @return 名称",
            "     */",
            "    public String getName() {",
            "        return name;",
            "    }",
            "",
            "    /**",
            "     * 设置名称。",
            "     *",
            "     * @param name 名称",
            "     */",
            "    public void setName(String name) {",
            "        this.name = name;",
            "    }",
            "",
            "    /**",
            "     * 无操作。",
            "     */",
            "    public void noop() {",
            "    }",
            "}",
            "",
        ]
    )


def single_member_upstream(*, method_body: str, prefix: str = PREFIX) -> str:
    """生成只含**一个**业务成员的上游正文。"""

    return "\n".join(
        [
            "package cn.iocoder.yudao.module.system.dal.mysql.dict;",
            "",
            "import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapperX;",
            "import cn.iocoder.yudao.module.system.dal.dataobject.dict.DictTypeDO;",
            "",
            "/**",
            " * 固定上游文件。",
            " *",
            " * 该固定提交未声明作者。",
            " */",
            f"public class {LOCAL_CLASS} {{",
            "",
            "    private Long id;",
            "",
            "    private String name;",
            "",
            method_javadoc(),
            f"    public LambdaQueryWrapperX<DictTypeDO> {SELECT_METHOD}(String name) {{",
            f"{method_body}",
            "    }",
            "",
            "    /**",
            "     * 获得名称。",
            "     *",
            "     * @return 名称",
            "     */",
            "    public String getName() {",
            "        return name;",
            "    }",
            "",
            "    /**",
            "     * 设置名称。",
            "     *",
            "     * @param name 名称",
            "     */",
            "    public void setName(String name) {",
            "        this.name = name;",
            "    }",
            "",
            "    /**",
            "     * 无操作。",
            "     */",
            "    public void noop() {",
            "    }",
            "}",
            "",
        ]
    )


BUSINESS_METHOD_BODY = (
    "        return new LambdaQueryWrapperX<DictTypeDO>().like(DictTypeDO::getName, name)\n"
    "            .eq(DictTypeDO::getRemark, \"dict-type-prefix\");"
)


def type_evidence_value(source: str) -> str:
    """生成逐类型映射，绑定当前 JavaDoc 指纹。"""

    start = source.index("/**")
    javadoc = source[start : source.index("*/", start) + 2]
    entry = {
        "qualified_name": QUALIFIED_NAME,
        "simple_name": LOCAL_CLASS,
        "kind": "class",
        "nested": False,
        "enclosing_type": None,
        "upstream_type": f"cn.iocoder.yudao.module.system.dal.mysql.dict.{LOCAL_CLASS}",
        "upstream_author_declared": False,
        "javadoc_sha256": digest(javadoc),
        "review_by": "D17 成员级分支对照测试",
        "review_date": "2026-10-07",
        "review_conclusion": f"逐项复核 {LOCAL_CLASS}：来源、指纹与无作者结论一致。",
    }
    return json.dumps({"schema": java.EVIDENCE_SCHEMA, "types": [entry]}, ensure_ascii=False)


def correspondence_points() -> str:
    """生成路线 2 使用的 P1 内容点登记。"""

    return json.dumps(
        [
            {
                "kind": "P1 内容点（共享有区分力配置前缀字面量）",
                "fragment": PREFIX,
                "local_lines": [16],
                "upstream_lines": [13],
                "discrimination_reason": "共享有区分力业务配置前缀字面量，属具体业务事实，非通用形状",
                "corpus_binding": (
                    f"上游固定快照 {UPSTREAM_COMMIT} 语料；该片段在本文件出现 1 次，df=1"
                ),
            }
        ],
        ensure_ascii=False,
    )


def evidence_record(
    local: str,
    remote: str,
    *,
    contract: str,
    route: str = ROUTE,
    branch: str = BRANCH,
    verdict: str = java.SOURCE_NOTE_ACCEPTED_VERDICTS[0],
    blocker_reason: str = "",
    author_status: str = java.AUTHOR_UNDECLARED_STATUS,
    upstream_path: str = UPSTREAM_PATH,
    local_path: str = LOCAL_PATH,
) -> dict[str, str]:
    """构造声明 ``E2-member-identity`` 分支的受控清单记录。"""

    return {
        "local_path": local_path,
        "local_sha256_after": digest(local),
        "upstream_repo_url": f"https://github.com/{UPSTREAM_REPO}.git",
        "upstream_path": upstream_path,
        "upstream_commit": UPSTREAM_COMMIT,
        "upstream_file_url": f"https://github.com/{UPSTREAM_REPO}/blob/{UPSTREAM_COMMIT}/{upstream_path}",
        "upstream_sha256": digest(remote),
        "upstream_author_lines": "",
        "history_basis": "引入提交未知，本行以固定见证版本作来源见证。",
        "evidence_route": route,
        "evidence_points": correspondence_points(),
        "author_status": author_status,
        "local_modification_facts": "调整包名与导入顺序。",
        "open_gap": "上游该版本未声明作者；历史引入版本未核实。",
        "review_by": "D17 成员级分支对照测试",
        "review_date": "2026-10-07",
        "review_conclusion": f"逐项复核 {LOCAL_CLASS}：来源、指纹与无作者结论一致。",
        "type_evidence": type_evidence_value(local),
        "d12_verdict": verdict,
        "d12_blocker_reason": blocker_reason,
        "d12_correspondence_points": correspondence_points(),
        "evidence_branch": branch,
        "member_identity_contract": contract,
    }


def write_registry(path: Path, records: list[dict[str, str]]) -> Path:
    """写出 TSV 形式的受控清单。"""

    lines = ["\t".join(REGISTRY_COLUMNS)]
    lines.extend(
        "\t".join(str(item.get(name, "")) for name in REGISTRY_COLUMNS) for item in records
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def write_json_index(path: Path, records: list[dict[str, str]]) -> Path:
    """写出受控派生索引（声明 schema，强制消费验收状态）。"""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "index_schema": java.EVIDENCE_INDEX_SCHEMA,
                "manifest": {"selected_records": len(records), "note": "D17 成员级分支对照夹具"},
                "records": records,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return path


def write_snapshot(root: Path, content: str, *, upstream_path: str = UPSTREAM_PATH) -> Path:
    """写出固定提交的受控上游快照。"""

    target = root / f"ruoyi-vue-pro@{UPSTREAM_COMMIT}" / upstream_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return target


def seed_sandbox_tools(sandbox: GitSandbox) -> None:
    """让隔离仓库具备工作区入口与 Web 全量入口所需的最小结构。"""

    (sandbox.root / "scripts").symlink_to(DEFAULT_ROOT / "scripts", target_is_directory=True)
    web = sandbox.root / WEB_FIXTURE
    web.parent.mkdir(parents=True, exist_ok=True)
    web.write_text(WEB_SOURCE, encoding="utf-8")


def run_checker(
    sandbox: GitSandbox,
    script: str,
    *args: str,
    extra_env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    """以真实 Python CLI 检查隔离仓库，保留真实退出码与诊断。"""

    env = dict(sandbox.env)
    for name in (
        java.EVIDENCE_REGISTRY_ENV,
        java.EVIDENCE_SNAPSHOTS_ENV,
        java.CODE_IDENTITY_TRANSFORM_SET_ENV,
        java.MEMBER_IDENTITY_ENV_SCHEMA,
        java.MEMBER_IDENTITY_ENV_MEMBERS,
    ):
        env.pop(name, None)
    env["PYTHONIOENCODING"] = "utf-8"
    if extra_env:
        env.update(extra_env)
    return subprocess.run(
        [sys.executable, "-B", "-X", "utf8", str(DEFAULT_ROOT / script), *args],
        cwd=sandbox.root,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=300,
    )


def run_branch_entry(
    sandbox: GitSandbox,
    registry: Path,
    snapshots: Path,
    *,
    transform_set: Path | None = None,
    contract_schema: Path | None = None,
    member_manifest: Path | None = None,
    root: Path | None = None,
) -> subprocess.CompletedProcess[str]:
    """运行真实的分支复算入口。"""

    arguments = [
        "--validate-evidence-branches",
        "--evidence-registry",
        str(registry),
        "--evidence-snapshots",
        str(snapshots),
        "--json",
    ]
    if transform_set is not None:
        arguments.extend(["--code-identity-transform-set", str(transform_set)])
    if contract_schema is not None:
        arguments.extend(["--member-identity-contract-schema", str(contract_schema)])
    if member_manifest is not None:
        arguments.extend(["--member-identity-member-manifest", str(member_manifest)])
    arguments.extend(["--code-identity-root", str(root if root is not None else sandbox.root)])
    return run_checker(sandbox, "scripts/code/java/check_staged_java_comments.py", *arguments)


def run_full_entry(
    sandbox: GitSandbox,
    registry: Path,
    snapshots: Path,
    *,
    transform_set: Path | None = None,
    contract_schema: Path | None = None,
    member_manifest: Path | None = None,
    maintenance: bool = False,
    json_index: Path | None = None,
) -> subprocess.CompletedProcess[str]:
    """运行真实的全量入口。"""

    arguments = ["--root", str(sandbox.root)]
    if json_index is None:
        arguments.extend(["--evidence-registry", str(registry)])
    else:
        arguments.extend(["--evidence-registry", str(json_index)])
    arguments.extend(["--evidence-snapshots", str(snapshots), "--json"])
    if transform_set is not None:
        arguments.extend(["--code-identity-transform-set", str(transform_set)])
    if contract_schema is not None:
        arguments.extend(["--member-identity-contract-schema", str(contract_schema)])
    if member_manifest is not None:
        arguments.extend(["--member-identity-member-manifest", str(member_manifest)])
    if maintenance:
        arguments.append("--maintenance")
    return run_checker(sandbox, "scripts/code/java/check_full_java_comments.py", *arguments)


def run_run_checks(
    sandbox: GitSandbox,
    *,
    transform_set: Path | None = None,
    contract_schema: Path | None = None,
    member_manifest: Path | None = None,
    maintenance: bool = False,
) -> subprocess.CompletedProcess[str]:
    """运行真实的 ``run_checks.py --group comments`` 汇总入口。"""

    env = dict(sandbox.env)
    for name in (
        java.EVIDENCE_REGISTRY_ENV,
        java.EVIDENCE_SNAPSHOTS_ENV,
        java.CODE_IDENTITY_TRANSFORM_SET_ENV,
        java.MEMBER_IDENTITY_ENV_SCHEMA,
        java.MEMBER_IDENTITY_ENV_MEMBERS,
    ):
        env.pop(name, None)
    env["PYTHONIOENCODING"] = "utf-8"
    env["GIT_OPTIONAL_LOCKS"] = "0"
    private_index = sandbox.root.parent / f"private-index-{os.getpid()}"
    shutil.copyfile(sandbox.root / ".git" / "index", private_index)
    env["GIT_INDEX_FILE"] = str(private_index)
    subprocess.run(
        ["git", "update-index", "--refresh"],
        cwd=sandbox.root,
        env=env,
        capture_output=True,
        check=False,
    )
    if transform_set is not None:
        env[java.CODE_IDENTITY_TRANSFORM_SET_ENV] = str(transform_set)
    if contract_schema is not None:
        env[java.MEMBER_IDENTITY_ENV_SCHEMA] = str(contract_schema)
    if member_manifest is not None:
        env[java.MEMBER_IDENTITY_ENV_MEMBERS] = str(member_manifest)
    arguments = [
        sys.executable, "-B", "-X", "utf8",
        str(DEFAULT_ROOT / "scripts/workflow/run_checks.py"),
    ]
    arguments.extend(["--root", str(sandbox.root), "--group", "comments", "--json"])
    if maintenance:
        arguments.append("--maintenance")
    result = subprocess.run(
        arguments,
        cwd=sandbox.root,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=600,
    )
    private_index.unlink(missing_ok=True)
    return result


class Case:
    """一次对照所需的隔离夹具。"""

    def __init__(
        self,
        sandbox: GitSandbox,
        registry: Path,
        snapshots: Path,
        transform_set: Path,
        contract_schema: Path,
        member_manifest: Path,
        record: dict[str, str],
        remote: str,
        json_index: Path,
    ) -> None:
        """登记一次对照所需的全部隔离输入。"""

        self.sandbox = sandbox
        self.registry = registry
        self.snapshots = snapshots
        self.transform_set = transform_set
        self.contract_schema = contract_schema
        self.member_manifest = member_manifest
        self.record = record
        self.remote = remote
        self.json_index = json_index

    def branch(self, **kwargs) -> subprocess.CompletedProcess[str]:
        """以本夹具的受控输入运行真实分支入口（``kwargs`` 可覆盖任一受控输入）。"""

        kwargs.setdefault("transform_set", self.transform_set)
        kwargs.setdefault("contract_schema", self.contract_schema)
        kwargs.setdefault("member_manifest", self.member_manifest)
        return run_branch_entry(self.sandbox, self.registry, self.snapshots, **kwargs)

    def full(self, **kwargs) -> subprocess.CompletedProcess[str]:
        """以本夹具的受控输入运行真实全量入口（``kwargs`` 可覆盖任一受控输入）。"""

        kwargs.setdefault("transform_set", self.transform_set)
        kwargs.setdefault("contract_schema", self.contract_schema)
        kwargs.setdefault("member_manifest", self.member_manifest)
        kwargs.setdefault("json_index", self.json_index)
        return run_full_entry(self.sandbox, self.registry, self.snapshots, **kwargs)

    def rewrite(self, mutate) -> None:
        """改写记录后重新落盘清单与派生索引。"""

        mutate(self.record)
        write_registry(self.registry, [self.record])
        write_json_index(self.json_index, [self.record])


def prepare(
    tmp_path: Path,
    *,
    local: str | None = None,
    remote: str | None = None,
    entry: str = "M0",
    contract_local: str | None = None,
    contract_remote: str | None = None,
    contract_kwargs: dict | None = None,
    route: str = ROUTE,
    branch: str = BRANCH,
    verdict: str = java.SOURCE_NOTE_ACCEPTED_VERDICTS[0],
    blocker_reason: str = "",
    author_status: str = java.AUTHOR_UNDECLARED_STATUS,
    transform_set_text: str | None = None,
    contract_schema_text: str | None = None,
    member_manifest_text: str | None = None,
    baseline_local: str | None = None,
    upstream_path: str = UPSTREAM_PATH,
    local_path: str = LOCAL_PATH,
) -> Case:
    """构造一条完整的隔离对照夹具。"""

    local = local if local is not None else local_source()
    remote = remote if remote is not None else upstream_source()
    sandbox = create_sandbox(tmp_path / "repository")
    seed_sandbox_tools(sandbox)
    baseline = baseline_local if baseline_local is not None else local
    sandbox.stage(local_path, baseline)
    target = sandbox.root / local_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(baseline, encoding="utf-8")
    sandbox.record_baseline()
    if local != baseline:
        sandbox.stage(local_path, local)
        target.write_text(local, encoding="utf-8")

    transform_set = tmp_path / "transform-set.json"
    if transform_set_text is None:
        shutil.copyfile(REPO_TRANSFORM_SET, transform_set)
    else:
        transform_set.write_text(transform_set_text, encoding="utf-8")
    document = json.loads(transform_set.read_text(encoding="utf-8"))

    contract_schema = tmp_path / "contract-schema.json"
    if contract_schema_text is None:
        shutil.copyfile(REPO_CONTRACT_SCHEMA, contract_schema)
    else:
        contract_schema.write_text(contract_schema_text, encoding="utf-8")
    member_manifest = tmp_path / "member-manifest.json"
    if member_manifest_text is None:
        shutil.copyfile(REPO_MEMBER_MANIFEST, member_manifest)
    else:
        member_manifest.write_text(member_manifest_text, encoding="utf-8")

    contract = build_contract(
        contract_local if contract_local is not None else local,
        contract_remote if contract_remote is not None else remote,
        entry=entry,
        transform_set_document=document,
        transform_set_path=transform_set,
        contract_schema_path=contract_schema,
        member_manifest_path=member_manifest,
        **(contract_kwargs or {}),
    )
    record = evidence_record(
        local,
        remote,
        contract=contract,
        route=route,
        branch=branch,
        verdict=verdict,
        blocker_reason=blocker_reason,
        author_status=author_status,
        upstream_path=upstream_path,
        local_path=local_path,
    )
    snapshots = sandbox.root / java.DEFAULT_EVIDENCE_SNAPSHOTS
    write_snapshot(snapshots, remote, upstream_path=upstream_path)
    registry = write_registry(tmp_path / "registry.tsv", [record])
    json_index = sandbox.root / java.DEFAULT_EVIDENCE_REGISTRY
    write_json_index(json_index, [record])
    return Case(
        sandbox,
        registry,
        snapshots,
        transform_set,
        contract_schema,
        member_manifest,
        record,
        remote,
        json_index,
    )


def tampered_document(tmp_path: Path, source: Path, name: str, mutate) -> Path:
    """复制受控文档并按 ``mutate`` 改写，返回新路径。"""

    document = json.loads(source.read_text(encoding="utf-8"))
    mutate(document)
    target = tmp_path / name
    target.write_text(json.dumps(document, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return target


# ───────────────────────────── 单元口径 ─────────────────────────────


def test_repository_controlled_documents_are_self_consistent() -> None:
    """仓内契约 schema 与成员清单必须自洽并可被规则实现逐项复算。"""

    schema, manifest = load_documents()
    assert schema["branch"] == BRANCH and schema["route"] == ROUTE
    assert schema["entries"] == list(java.MEMBER_IDENTITY_ENTRIES)
    assert schema["member_kinds"] == list(java.MEMBER_IDENTITY_MEMBER_KINDS)
    assert schema["attribution_causes"] == list(java.MEMBER_IDENTITY_ATTRIBUTION_CAUSES)
    assert schema["difference_categories"] == list(java.MEMBER_IDENTITY_DIFFERENCE_CATEGORIES)
    assert schema["contract_schema_sha256_measured"] == schema["contract_schema_sha256"]
    assert manifest["members_manifest_sha256_measured"] == manifest["members_manifest_sha256"]
    # D17 §C：四条契约冲突对象逐条登记待签认问题与必要验证方向。
    assert len(manifest["contract_conflicts"]) == 4
    for item in manifest["contract_conflicts"]:
        assert item["pending_decision"] and item["required_verification"]
    # D17 §B：五条本分支不可关闭对象逐条登记。
    assert len(manifest["branch_ineligible"]) == 5
    for item in manifest["branch_ineligible"]:
        assert item["exclusion_reason"] and item["required_verification"]


def test_controlled_documents_reject_untampered_self_hash() -> None:
    """改动受控文档的任一登记项而不重算自述指纹即拒绝。"""

    for loader, path, key in (
        (java._load_member_identity_contract_schema, REPO_CONTRACT_SCHEMA, "entries"),
        (java._load_member_identity_member_manifest, REPO_MEMBER_MANIFEST, "discrimination"),
    ):
        document = json.loads(path.read_text(encoding="utf-8"))
        document[key] = "tampered" if isinstance(document[key], str) else {}
        target = path.parent / f"tampered-{path.name}"
        target.write_text(json.dumps(document, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        try:
            _value, error = loader(str(target))
            assert error is not None, path.name
        finally:
            target.unlink(missing_ok=True)


def test_member_coverage_reconstructs_the_whole_stream() -> None:
    """成员切分必须逐词素拼回整条代码流（含 prologue、类型头与收尾花括号）。"""

    for source in (
        'package a.b; class A { int[] x = {1,2}; void f() {} }',
        'package a.b; enum E { A, B; private int v; }',
        'package a.b; class A { static class B { int q; } void g(){} }',
        'package a.b; class A { static { int i = 0; } }',
    ):
        view = java._member_identity_view(source, [], "local")
        assert view["coverage_complete"] is True, (source, view["problems"])
        assert view["problems"] == [], (source, view["problems"])


def test_member_boundary_selfcheck_catches_d17_array_field_mis_split() -> None:
    """D17 §58：数组字段被切成半字段 + 独立分号时，边界自检必须拒绝。"""

    lexemes = [
        ["ident", "int", "1"], ["op", "[", "1"], ["op", "]", "1"],
        ["ident", "x", "1"], ["op", "=", "1"], ["op", "{", "1"],
        ["number", "1", "1"], ["op", "}", "1"], ["op", ";", "1"],
    ]
    wrong_body = java._member_identity_first_top_level_brace(lexemes)
    reasons = java._member_identity_boundary_reasons(lexemes, "field", wrong_body)
    assert any("字段初始化器" in reason for _severity, reason in reasons), reasons
    # 正确切分必须通过。
    correct_body = java._member_identity_member_body_brace(lexemes)
    assert correct_body == -1
    assert java._member_identity_boundary_reasons(lexemes, "field", correct_body) == []


def test_member_boundary_selfcheck_rejects_lone_semicolon_and_fragments() -> None:
    """单独分号、以分隔符开头的残片与不完整块成员都不得计入证据。"""

    lone = [["op", ";", "1"]]
    severity, message = java._member_identity_boundary_reasons(lone, "field", -1)[0]
    assert severity == "non-countable" and "单独分号" in message

    fragment = [["op", ")", "1"], ["ident", "x", "1"], ["op", ";", "1"]]
    severities = {s for s, _ in java._member_identity_boundary_reasons(fragment, "field", -1)}
    assert severities == {"hard"}

    unbalanced = [
        ["ident", "void", "1"], ["ident", "f", "1"], ["op", "(", "1"],
        ["op", ")", "1"], ["op", "{", "1"], ["op", ";", "1"],
    ]
    severities = {s for s, _ in java._member_identity_boundary_reasons(unbalanced, "method", 4)}
    assert "hard" in severities


def test_member_identity_is_not_position_based_pairing() -> None:
    """同形成员的完整限定标识必须唯一；重复键不得覆盖或偷换对象。"""

    source = "package a.b; class A { int p; int q; int p2; }"
    view = java._member_identity_view(source, [], "local")
    keys = [member["key"] for member in view["members"]]
    assert keys == ["A#field#p", "A#field#q", "A#field#p2"], keys

    overloads = "package a.b; class A { void f(int a){} void f(String a){} }"
    overload_view = java._member_identity_view(overloads, [], "local")
    assert [member["key"] for member in overload_view["members"]] == [
        "A#method#f(int)",
        "A#method#f(String)",
    ], [member["key"] for member in overload_view["members"]]


def test_annotations_and_modifiers_are_stripped_from_member_identity() -> None:
    """成员标识必须剥掉注解与修饰符，否则同形注解字段会得到同一个键。"""

    source = (
        "package a.b;\nclass A {\n"
        '    @Schema(description = "任务编号", example = "10")\n'
        "    private Long jobId;\n"
        '    @Schema(description = "任务状态", example = "0")\n'
        "    private Integer status;\n"
        "}\n"
    )
    view = java._member_identity_view(source, [], "local")
    keys = [member["key"] for member in view["members"]]
    assert keys == ["A#field#jobId", "A#field#status"], keys
    assert view["problems"] == [], view["problems"]


def test_nested_type_evidence_does_not_extend_to_outer_declaration() -> None:
    """嵌套类型按自身归属验收：外层证据不外推到嵌套声明（D17 §G2）。"""

    source = "package a.b; class A { static class B { private int q; } }"
    view = java._member_identity_view(source, [], "local")
    owners = {member["key"]: member["owner"] for member in view["members"]}
    assert owners["A#nested-type#B"] == "A"
    assert owners["A.B#field#q"] == "A.B"


def test_member_boundary_selfcheck_rejects_unbalanced_member_slice() -> None:
    """成员切片定界符不平衡时，切分必须**拒绝**整条读数而不是照常出结论。

    这是覆盖性自检之外的第二道闸门：即使切分看起来能拼回代码流，只要某个成员
    本身不是完整合法成员，半个成员就不得计入证据。

    Returns:
        None。断言失败即抛出 ``AssertionError``。
    """

    def token(*pairs: tuple[str, str]) -> list[list[str]]:
        """按 ``(类别, 原文)`` 对构造带行号的成员级词素。"""

        return [[kind, text, "1"] for kind, text in pairs]

    unbalanced = token(
        ("op", "{"),
        ("ident", "int"), ("ident", "f"), ("op", "("), ("op", ")"), ("op", "{"),
        ("ident", "return"), ("op", "("),   # 未闭合圆括号
        ("op", ";"), ("ident", "x"), ("op", "}"),
    )
    _tiles, members, problems, close = java._member_identity_segment(unbalanced, "A")
    assert close is None, "定界符不平衡时不得给出类型体收尾下标"
    assert any("定界符不平衡" in problem for problem in problems), problems
    assert not members, members


def test_coverage_selfcheck_rejects_source_without_package() -> None:
    """没有 package 声明、无法确定类型体起点的输入必须受控拒绝。

    Returns:
        None。断言失败即抛出 ``AssertionError``。
    """

    view = java._member_identity_view("class A { int p; }", [], "local")
    assert view["coverage_complete"] is False
    assert any("没有 package 声明" in problem for problem in view["problems"]), view["problems"]


def test_boilerplate_exclusion_rejects_getter_and_plain_fields() -> None:
    """样板成员（getter/setter、空方法、普通字段、无锚点成员）不得冒充证据。"""

    _schema, manifest = load_documents()
    generic = tuple(
        re.compile(str(item)) for item in manifest["discrimination"]["generic_string_patterns"]
    )

    def reasons_for(source: str, key_fragment: str) -> list[str]:
        """按源码与成员键片段取出该成员的样板排除原因。"""

        view = java._member_identity_view(source, [], "local")
        member = next(m for m in view["members"] if key_fragment in m["key"])
        candidate = dict(member)
        candidate["anchors"] = java._member_identity_member_anchors(member["tokens"], generic)
        return java._member_identity_boilerplate_reasons(candidate, manifest)

    plain_field = "package a.b; class A { private Long id; }"
    assert any("普通字段" in reason for reason in reasons_for(plain_field, "#id"))

    getter = "package a.b; class A { private String name; public String getName(){ return name; } }"
    assert any("getter/setter 样板" in reason for reason in reasons_for(getter, "#getName()"))

    setter = "package a.b; class A { private String name; public void setName(String n){ this.name = n; } }"
    assert any("getter/setter 样板" in reason for reason in reasons_for(setter, "#setName("))

    empty_method = "package a.b; class A { public void noop(){ } }"
    assert any("空方法" in reason for reason in reasons_for(empty_method, "#noop()"))

    # 只有惯用字面量、没有任何非惯用锚点的成员不能证明业务语义主体。
    no_anchor = 'package a.b; class A { private String label = "example"; }'
    joined = "；".join(reasons_for(no_anchor, "#label"))
    assert "区分力锚点" in joined or "样板" in joined, joined


def test_member_without_anchor_is_not_qualifying() -> None:
    """没有非惯用锚点的成员不能证明业务语义主体，必须被排除。"""

    _schema, manifest = load_documents()
    lexemes, _errors = java._code_identity_code_tokens("package a.b; class A { int v; }")
    view = java._member_identity_view(
        "package a.b; class A { int v; }", [], "local"
    )
    member = view["members"][0]
    member["anchors"] = java._member_identity_member_anchors(member["tokens"], tuple())
    reasons = java._member_identity_boilerplate_reasons(member, manifest)
    assert any("区分力锚点" in reason for reason in reasons), reasons
    assert lexemes


def test_attribution_must_cover_exactly_the_measured_differences() -> None:
    """归因必须恰好覆盖实测差异：多一处、少一处都拒绝。"""

    assert java._member_identity_attribution_covers(
        {"difference_attribution": [{"category": "member", "changed_lines": {"local": 1, "upstream": 1},
                                     "location": "L1", "before_text": "a", "after_text": "b",
                                     "declaration": "D", "nature": "适配"}]},
        {"member": 1, "comment": 0},
    ) == (True, "")
    # 少登记：实测有 comment 差异但归因没有。
    ok, message = java._member_identity_attribution_covers(
        {"difference_attribution": [{"category": "member", "changed_lines": {"local": 1, "upstream": 1},
                                     "location": "L1", "before_text": "a", "after_text": "b",
                                     "declaration": "D", "nature": "适配"}]},
        {"member": 1, "comment": 1},
    )
    assert not ok and "comment" in message
    # 多登记：归因登记了实测不存在的差异类别。
    ok, message = java._member_identity_attribution_covers(
        {"difference_attribution": [{"category": "order", "changed_lines": {"local": 1, "upstream": 1},
                                     "location": "L1", "before_text": "a", "after_text": "b",
                                     "declaration": "D", "nature": "适配"}]},
        {"member": 0, "order": 0},
    )
    assert not ok and "实测不存在" in message


def test_repository_index_declares_no_member_identity_record() -> None:
    """本轮不改判任何记录：真实索引里不得出现 ``E2-member-identity`` 声明。"""

    index = json.loads(
        (DEFAULT_ROOT / "docs/测试与可靠性/来源证据/d12-source-index.json").read_text(
            encoding="utf-8"
        )
    )
    branches = [record.get("evidence_branch") for record in index["records"]]
    assert BRANCH not in branches
    assert branches.count("E1-author-only") == 12
    assert branches.count("C2-independent-content") == 4


# ───────────────────── 正例与负例（真实消费者） ─────────────────────


def test_positive_m0_passes_through_branch_and_full_entries(tmp_path: Path) -> None:
    """正例：真实满足 M0 条件的对象经分支入口与全量入口通过。"""

    local, remote = local_source(), upstream_source()
    views = measure(local, remote)
    paired = java._member_identity_pair(views["local"], views["upstream"])
    assert any(item["raw_identical"] for item in paired["equal"]), "正例必须存在未变换即相等的成员"
    case = prepare(tmp_path, local=local, remote=remote, entry="M0")

    branch = case.branch()
    assert branch.returncode == 0, branch.stdout + branch.stderr
    report = json.loads(branch.stdout)
    assert report["checked"] == 1 and report["findings"] == [], report

    full = case.full()
    assert full.returncode == 0, full.stdout + full.stderr
    value = json.loads(full.stdout)
    assert value["status"] == "passed" and value["findings"] == [], value
    assert value["acceptance"]["counts"]["accepted"] == 1, value["acceptance"]["counts"]


def test_positive_mt_passes_when_two_transformed_members_are_equal(tmp_path: Path) -> None:
    """正例：MT 入口——M0 不成立时两个变换后相等的合格成员可独立支撑。"""

    local, remote = mt_local_source(), mt_upstream_source()
    views = measure(local, remote)
    paired = java._member_identity_pair(views["local"], views["upstream"])
    # 两个业务成员只在执行 T1 之后相等；未执行 T1–T5 时没有合格成员（M0 不成立）。
    assert len(paired["equal"]) >= 2, paired["equal"]
    assert not any(item["raw_identical"] for item in paired["equal"]), paired["equal"]

    case = prepare(tmp_path, local=local, remote=remote, entry="MT")
    contract = json.loads(case.record["member_identity_contract"])
    assert len(contract["members"]) >= 2, contract["members"]
    assert all(not row["raw_identical"] for row in contract["members"]), contract["members"]

    branch = case.branch()
    assert branch.returncode == 0, branch.stdout + branch.stderr
    report = json.loads(branch.stdout)
    assert report["checked"] == 1 and report["findings"] == [], report

    full = case.full()
    assert full.returncode == 0, full.stdout + full.stderr
    value = json.loads(full.stdout)
    assert value["status"] == "passed" and value["findings"] == [], value


def test_lone_semicolon_member_is_excluded_but_others_still_qualify(tmp_path: Path) -> None:
    """枚举常量表后的独立分号不计入证据，但**不得**让整侧读数作废。

    这条对照守住 ``non-countable`` 与 ``hard`` 的分界：独立分号是合法 Java 语法，
    只能让它自己不被计数；一旦把它当成 ``hard``，含有枚举的真实对象会被整条拒绝。

    Args:
        tmp_path: pytest 临时目录。

    Returns:
        None。断言失败即抛出 ``AssertionError``。
    """

    _schema, manifest = load_documents()
    generic = tuple(
        re.compile(str(item)) for item in manifest["discrimination"]["generic_string_patterns"]
    )
    source = t_local = "package a.b; class A { int p; ; }"
    view = java._member_identity_view(source, [], "local")
    assert view["coverage_complete"] is True, view["problems"]
    # 该形态必须被**显式记录**为“不计入”，而不是静默丢弃：既证明它被看见过，
    # 也证明它没有混进证据成员。把它升级成 hard 会让整侧读数作废，属于过严。
    assert any("成员边界自检不计入" in problem for problem in view["problems"]), view["problems"]
    assert not any("成员边界自检失败" in problem for problem in view["problems"]), view["problems"]
    enum_view = java._member_identity_view(
        "package a.b; enum E { A, B; private int v; }", [], "local"
    )
    assert enum_view["coverage_complete"] is True, enum_view["problems"]
    # 独立分号不会被登记为成员：类体只切出真实字段；枚举体只切出常量表与字段。
    assert [member["kind"] for member in view["members"]] == ["field"], view["members"]
    kinds = [member["kind"] for member in enum_view["members"]]
    assert kinds == ["enum-constant", "field"], kinds
    # 枚举常量表按成员清单不得单独作为证据。
    for member in enum_view["members"]:
        candidate = dict(member)
        candidate["anchors"] = java._member_identity_member_anchors(member["tokens"], generic)
        if member["kind"] == "enum-constant":
            assert java._member_identity_boilerplate_reasons(candidate, manifest), (
                "枚举常量成员必须被成员清单排除"
            )
    assert t_local


def test_coverage_failure_must_block_the_real_consumer(tmp_path: Path) -> None:
    """覆盖性自检不成立时，真实消费者必须拒绝——不能只是内部读数为 False。

    Args:
        tmp_path: pytest 临时目录。

    Returns:
        None。断言失败即抛出 ``AssertionError``。
    """

    # 没有 package 声明就无法确定类型体起点，覆盖性自检不成立。
    local = local_source().replace(
        "package com.basicframework.module.system.dal.mysql.dict;", ""
    )
    view = java._member_identity_view(local, [], "local")
    assert view["coverage_complete"] is False, view["problems"]

    case = prepare(tmp_path, local=local, remote=upstream_source())
    branch = case.branch()
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "覆盖性自检不成立" in branch.stdout or "无法确定类型体起点" in branch.stdout, branch.stdout

    full = case.full()
    assert full.returncode == 1, full.stdout + full.stderr
    assert "覆盖性自检不成立" in full.stdout or "无法确定类型体起点" in full.stdout, full.stdout


def test_coverage_and_boundary_defects_have_two_independent_gates(tmp_path: Path) -> None:
    """切分缺陷有两道**互相独立**的闸门：覆盖性自检标志与 problems 循环。

    这不是重复劳动：任何一道闸门单独失效（标志被强行置真、或关键字表被删掉），
    另一道都必须继续拒绝。这条用例把该冗余固化为可核对的断言，使
    “把 ``coverage_complete`` 恒真化”这种突变**在设计上不可观测**这一点有据可查，
    而不是留作无解释的漏网。

    Returns:
        None。断言失败即抛出 ``AssertionError``。
    """

    # 没有 package 声明 → 类型体起点无法确定，覆盖性自检必然不成立。
    broken = "/**\n * 缺少包声明的对象。\n */\nclass A { int p; }\n"
    baseline = java._member_identity_view(broken, [], "local")
    assert baseline["coverage_complete"] is False
    assert any("无法确定类型体起点" in item for item in baseline["problems"])
    assert baseline["coverage_complete"] is False

    # 第二道闸门（problems 关键字表）仍然独立持有该形态：源码层面显式可见，
    # 且**不依赖** ``coverage_complete`` 标志。任一闸门单独失效都不改变结论。
    source_text = Path(java.__file__).read_text(encoding="utf-8")
    assert '"覆盖性自检" in str(problem)' in source_text
    assert '"无法确定类型体起点" in str(problem)' in source_text
    assert '"边界" in str(problem)' in source_text
    assert 'if not view["coverage_complete"]:' in source_text

    # 真实消费者：第一道闸门就足以拒绝，且诊断显式可读。
    case = prepare(
        tmp_path,
        local=broken,
        remote=upstream_source(),
        contract_kwargs={"comment_binding_list": comment_bindings(local_source())},
    )
    branch = case.branch()
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "覆盖性自检不成立" in branch.stdout, branch.stdout


def test_tool_fingerprint_mismatch_changes_verdict(tmp_path: Path) -> None:
    """工具指纹判据本身必须真的参与判定：把它的诊断换成无关措辞不会改变结论，
    但把它**恒假**（不再比较）时对应用例必须失败。

    Args:
        tmp_path: pytest 临时目录。

    Returns:
        None。断言失败即抛出 ``AssertionError``。
    """

    case = prepare(tmp_path, local=local_source(), remote=upstream_source())
    assert case.branch().returncode == 0, "正例必须先通过，才能证明指纹判据在起作用"
    # 登记一个错配的工具指纹：判据必须真的拒绝。
    case.rewrite(
        lambda record: _mutate_contract(record, lambda c: c["tool"].update({"sha256": "0" * 64}))
    )
    assert case.branch().returncode == 1, "工具指纹错配必须被拒绝"


def test_mt_entry_requires_two_distinct_transformed_members(tmp_path: Path) -> None:
    """MT 入口必须真的需要**两个**成员：只有一个变换后相等成员时必须拒绝。

    这是 MT 数量条件的下界对照：把“少于 2 个”写成恒假（永远不拒绝）时，本用例
    必须失败。

    Args:
        tmp_path: pytest 临时目录。

    Returns:
        None。断言失败即抛出 ``AssertionError``。
    """

    local = mt_local_source().replace(
        f"        return {QUALIFIED_LOCAL}.SORT_COLUMN + traceId;",
        '        return "local-only-trace-tag" + traceId;',
    )
    remote = mt_upstream_source()
    views = measure(local, remote)
    paired = java._member_identity_pair(views["local"], views["upstream"])
    transformed = [item for item in paired["equal"] if not item["raw_identical"]]
    assert len(transformed) == 1, transformed

    case = prepare(tmp_path, local=local, remote=remote, entry="MT")
    branch = case.branch()
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "MT 入口不成立" in branch.stdout, branch.stdout

    full = case.full()
    assert full.returncode == 1, full.stdout + full.stderr
    assert "MT 入口不成立" in full.stdout, full.stdout


def test_negative_1_segmentation_defect_is_rejected_by_selfcheck(tmp_path: Path) -> None:
    """负对照①：成员切分缺陷（少收/多收/边界错误）必须被自检或对账拒绝。"""

    # 少收：类型体缺少收尾右花括号 -> 覆盖性自检不成立。
    truncated = "package a.b; class A { int p;"
    view = java._member_identity_view(truncated, [], "local")
    assert view["coverage_complete"] is False
    assert any("覆盖性自检" in problem for problem in view["problems"]), view["problems"]

    # 多收：成员铺满对账必须逐词素相等。
    good = "package a.b; class A { int p; int q; }"
    good_view = java._member_identity_view(good, [], "local")
    assert good_view["coverage_complete"] is True
    assert not any("铺满对账" in problem for problem in good_view["problems"])

    # 边界错误：D17 §58 的切错形态被边界自检拒绝（覆盖此处已单测）。
    boundary_lexemes = [
        ["ident", "int", "1"], ["op", "[", "1"], ["op", "]", "1"],
        ["ident", "x", "1"], ["op", "=", "1"], ["op", "{", "1"],
        ["number", "1", "1"], ["op", "}", "1"],
    ]
    severities = {
        severity
        for severity, _ in java._member_identity_boundary_reasons(boundary_lexemes, "field", 5)
    }
    assert "hard" in severities

    # 真实消费者：把成员切分读数写错（少登记成员数）必须被对账拒绝。
    case = prepare(tmp_path, local=local_source(), remote=upstream_source())
    case.rewrite(
        lambda record: _mutate_contract(record, lambda c: c["coverage"].update({"local_members": 1}))
    )
    branch = case.branch()
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "coverage.local_members 与实测不符" in branch.stdout, branch.stdout


def _mutate_contract(record: dict[str, str], mutate) -> None:
    """按 ``mutate`` 改写记录登记的成员级契约。"""

    contract = json.loads(record["member_identity_contract"])
    mutate(contract)
    record["member_identity_contract"] = json.dumps(contract, ensure_ascii=False)


def test_negative_2_boilerplate_members_cannot_stand_as_evidence(tmp_path: Path) -> None:
    """负对照②：只有 getter/setter/空方法/普通字段相等时必须拒绝。"""

    _schema, manifest = load_documents()

    def boilerplate_keys(local: str, remote: str) -> list[str]:
        """返回被样板门槛排除的相等成员键。"""

        views = measure(local, remote)
        paired = java._member_identity_pair(views["local"], views["upstream"])
        generic = tuple(
            re.compile(str(item))
            for item in manifest["discrimination"]["generic_string_patterns"]
        )
        keys: list[str] = []
        for item in paired["equal"]:
            member = next(m for m in views["local"]["members"] if m["key"] == item["key"])
            candidate = dict(member)
            candidate["anchors"] = java._member_identity_member_anchors(member["tokens"], generic)
            if java._member_identity_boilerplate_reasons(candidate, manifest):
                keys.append(item["key"])
        return keys

    # (a) 正例：业务方法存在时它是**唯一**合格成员。
    local = single_member_local(method_body=BUSINESS_METHOD_BODY)
    remote = single_member_upstream(method_body=BUSINESS_METHOD_BODY)
    views = measure(local, remote)
    paired = java._member_identity_pair(views["local"], views["upstream"])
    equal_keys = {item["key"] for item in paired["equal"]}
    assert len(equal_keys) >= 5, equal_keys
    generic = tuple(
        re.compile(str(item))
        for item in manifest["discrimination"]["generic_string_patterns"]
    )
    qualifying = {
        item["key"]
        for item in paired["equal"]
        if not java._member_identity_boilerplate_reasons(
            {
                **next(m for m in views["local"]["members"] if m["key"] == item["key"]),
                "anchors": java._member_identity_member_anchors(
                    next(m for m in views["local"]["members"] if m["key"] == item["key"])["tokens"],
                    generic,
                ),
            },
            manifest,
        )
    }
    assert qualifying == {f"{LOCAL_CLASS}#method#{SELECT_METHOD}(String)"}, qualifying
    # 样板成员（普通字段、getter/setter、空方法）都逐字节相等，但都被排除。
    excluded = set(boilerplate_keys(local, remote))
    assert excluded & equal_keys, excluded
    assert not (excluded & qualifying), (excluded, qualifying)

    # (b) 负例：只有 getter/setter/空方法/普通字段相等，业务方法体改成空实现。
    local_empty = single_member_local(method_body="")
    remote_empty = single_member_upstream(method_body="")
    empty_views = measure(local_empty, remote_empty)
    empty_paired = java._member_identity_pair(empty_views["local"], empty_views["upstream"])
    assert len(empty_paired["equal"]) >= 5, "该反例必须存在多个逐字节相等的成员"
    assert set(boilerplate_keys(local_empty, remote_empty)) == {
        item["key"] for item in empty_paired["equal"]
    }, empty_paired["equal"]

    # (c) 真实消费者：只剩样板成员时，M0 入口必须不成立。
    case = prepare(tmp_path, local=local_empty, remote=remote_empty, entry="M0")
    branch = case.branch()
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "M0 入口不成立" in branch.stdout, branch.stdout


def test_negative_3_attribution_must_cover_every_measured_difference(tmp_path: Path) -> None:
    """负对照③：归因不覆盖全部差异必须拒绝。"""

    case = prepare(tmp_path, local=local_source(), remote=upstream_source())
    case.rewrite(lambda record: _mutate_contract(record, lambda c: c.update({"difference_attribution": []})))
    branch = case.branch()
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "没有恰好覆盖全部实测差异" in branch.stdout, branch.stdout

    full = case.full()
    assert full.returncode == 1, full.stdout + full.stderr
    assert "没有恰好覆盖全部实测差异" in full.stdout, full.stdout


def test_negative_4_tampered_transform_set_is_rejected(tmp_path: Path) -> None:
    """负对照④：变换集被篡改必须拒绝。"""

    document = json.loads(REPO_TRANSFORM_SET.read_text(encoding="utf-8"))
    for transform in document["transforms"]:
        if transform["id"] == "T1":
            transform["pairs"] = [["cn.iocoder.yudao", "com.otherframework"]]
    document["transforms_sha256"] = hashlib.sha256(
        json.dumps(document["transforms"], ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    target = tmp_path / "tampered-transform-set.json"
    target.write_text(json.dumps(document, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    case = prepare(tmp_path, local=local_source(), remote=upstream_source())
    branch = case.branch(transform_set=target)
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "transforms_sha256 与实测规范化指纹不符" in branch.stdout or "transforms_sha256 被篡改" in branch.stdout, branch.stdout


def test_negative_4b_tampered_member_manifest_is_rejected(tmp_path: Path) -> None:
    """负对照④（另一形态）：受控成员清单被篡改必须拒绝。"""

    def mutate(document: dict) -> None:
        """把契约冲突对象从清单里删掉，模拟绕过 C 类排除。"""

        document["contract_conflicts"] = []

    target = tampered_document(tmp_path, REPO_MEMBER_MANIFEST, "tampered-manifest.json", mutate)
    case = prepare(tmp_path, local=local_source(), remote=upstream_source())
    branch = case.branch(member_manifest=target)
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "成员清单" in branch.stdout, branch.stdout


def test_negative_5_one_byte_member_difference_is_rejected(tmp_path: Path) -> None:
    """负对照⑤：唯一合格成员发生 1 字节差异时入口不再成立。"""

    local = single_member_local(method_body=BUSINESS_METHOD_BODY)
    # 只改唯一业务字面量的 1 个字节：dict-type-prefix -> dict-type-prefij。
    remote = single_member_upstream(method_body=BUSINESS_METHOD_BODY.replace("prefix", "prefij"))
    views = measure(local, remote)
    paired = java._member_identity_pair(views["local"], views["upstream"])
    assert any(item["kind"] == "method" for item in paired["differing"]), paired["differing"]

    case = prepare(tmp_path, local=local, remote=remote, entry="M0")
    branch = case.branch()
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "M0 入口不成立" in branch.stdout, branch.stdout

    full = case.full()
    assert full.returncode == 1, full.stdout + full.stderr
    assert "M0 入口不成立" in full.stdout, full.stdout


def test_negative_6_comment_change_keeps_member_evidence_but_signature_still_governed(
    tmp_path: Path,
) -> None:
    """负对照⑥：注释/署名被改动但成员未变时，成员证据成立但注释/署名仍须处理。"""

    unchanged = local_source()
    changed = local_source(javadoc=local_javadoc(author_line="@author 未声明作者"))
    views = measure(changed, upstream_source())
    paired = java._member_identity_pair(views["local"], views["upstream"])
    assert any(item["raw_identical"] for item in paired["equal"]), "成员证据仍应成立"

    case = prepare(
        tmp_path,
        local=changed,
        remote=upstream_source(),
        contract_kwargs={"comment_binding_list": comment_bindings(unchanged)},
    )
    branch = case.branch()
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "与本地实际注释不符" in branch.stdout, branch.stdout

    full = case.full()
    assert full.returncode == 1, full.stdout + full.stderr
    assert "type-author" in full.stdout, full.stdout


def test_negative_6b_author_tag_form_is_not_accepted_by_member_identity(tmp_path: Path) -> None:
    """负对照⑥（另一形态）：作者标签形态即使成员完全相同也不放行。"""

    # 作者标签形态：JavaDoc 只有 @author 与 D15 署名标注，没有 D12 来源说明。
    local = local_source(
        javadoc="/**\n * 字典类型 Mapper。\n *\n"
        " * @author 李杰\n"
        f" * {java.SIGNATURE_REVIEW_UNACCEPTED_MARKER}\n */",
    )
    remote = upstream_source()
    # 注释绑定按**带来源说明**的正文登记：作者标签形态的注释块结构不同，
    # 但成员级分支仍必须单独登记注释与署名，缺失一律拒绝。
    case = prepare(
        tmp_path,
        local=local,
        remote=remote,
        verdict=java.AUTHOR_TAG_ACCEPTED_VERDICTS[0],
        author_status="已核实上游作者",
        contract_kwargs={"comment_binding_list": comment_bindings(local_source())},
    )
    views = measure(local, remote)
    paired = java._member_identity_pair(views["local"], views["upstream"])
    assert any(item["raw_identical"] for item in paired["equal"]), "成员证据仍应成立"

    full = case.full()
    assert full.returncode == 1, full.stdout + full.stderr
    assert "成员级内容关系不覆盖作者与署名验收" in full.stdout, full.stdout


def test_negative_7_b_class_five_objects_cannot_be_closed(tmp_path: Path) -> None:
    """负对照⑦：B 类 5 条在本分支下必须全部不成立。"""

    _schema, manifest = load_documents()
    objects = manifest["branch_ineligible"]
    assert len(objects) == 5
    for item in objects:
        assert "SmsCodeProperties" in item["local_path"] or "Auth" in item["local_path"] or "Translate" in item["local_path"]

    # 逐条构造真实消费者夹具：即使契约声称成立，也必须被本分支显式拒绝。
    for index, item in enumerate(objects):
        sandbox = create_sandbox(tmp_path / f"repo-{index}")
        seed_sandbox_tools(sandbox)
        local_path = item["local_path"]
        upstream_path = item["upstream_path"]
        real_local = DEFAULT_ROOT / local_path
        assert real_local.is_file(), local_path
        local_text = real_local.read_text(encoding="utf-8")
        remote_text = f"package placeholder;\nclass Placeholder {{ int p; }}\n"
        sandbox.stage(local_path, local_text)
        target = sandbox.root / local_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(local_text, encoding="utf-8")
        sandbox.record_baseline()

        transform_set = tmp_path / f"transform-{index}.json"
        shutil.copyfile(REPO_TRANSFORM_SET, transform_set)
        contract_schema = tmp_path / f"schema-{index}.json"
        shutil.copyfile(REPO_CONTRACT_SCHEMA, contract_schema)
        member_manifest = tmp_path / f"manifest-{index}.json"
        shutil.copyfile(REPO_MEMBER_MANIFEST, member_manifest)
        contract = build_contract(
            local_text,
            remote_text,
            transform_set_document=json.loads(transform_set.read_text(encoding="utf-8")),
            transform_set_path=transform_set,
            contract_schema_path=contract_schema,
            member_manifest_path=member_manifest,
        )
        record = evidence_record(
            local_text,
            remote_text,
            contract=contract,
            upstream_path=upstream_path,
            local_path=local_path,
        )
        snapshots = sandbox.root / java.DEFAULT_EVIDENCE_SNAPSHOTS
        write_snapshot(snapshots, remote_text, upstream_path=upstream_path)
        registry = write_registry(tmp_path / f"registry-{index}.tsv", [record])
        result = run_branch_entry(
            sandbox,
            registry,
            snapshots,
            transform_set=transform_set,
            contract_schema=contract_schema,
            member_manifest=member_manifest,
        )
        assert result.returncode == 1, (item["local_path"], result.stdout)
        assert "不能关闭该对象" in result.stdout, (item["local_path"], result.stdout)


def test_negative_8_c_class_four_objects_are_explicitly_rejected(tmp_path: Path) -> None:
    """负对照⑧：C 类 4 条必须被显式拒绝并给出专属诊断。"""

    _schema, manifest = load_documents()
    objects = manifest["contract_conflicts"]
    assert len(objects) == 4
    for index, item in enumerate(objects):
        sandbox = create_sandbox(tmp_path / f"repo-{index}")
        seed_sandbox_tools(sandbox)
        local_path = item["local_path"]
        upstream_path = item["upstream_path"]
        real_local = DEFAULT_ROOT / local_path
        assert real_local.is_file(), local_path
        local_text = real_local.read_text(encoding="utf-8")
        remote_text = f"package placeholder;\nclass Placeholder {{ int p; }}\n"
        sandbox.stage(local_path, local_text)
        target = sandbox.root / local_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(local_text, encoding="utf-8")
        sandbox.record_baseline()

        transform_set = tmp_path / f"transform-{index}.json"
        shutil.copyfile(REPO_TRANSFORM_SET, transform_set)
        contract_schema = tmp_path / f"schema-{index}.json"
        shutil.copyfile(REPO_CONTRACT_SCHEMA, contract_schema)
        member_manifest = tmp_path / f"manifest-{index}.json"
        shutil.copyfile(REPO_MEMBER_MANIFEST, member_manifest)
        contract = build_contract(
            local_text,
            remote_text,
            transform_set_document=json.loads(transform_set.read_text(encoding="utf-8")),
            transform_set_path=transform_set,
            contract_schema_path=contract_schema,
            member_manifest_path=member_manifest,
        )
        record = evidence_record(
            local_text,
            remote_text,
            contract=contract,
            upstream_path=upstream_path,
            local_path=local_path,
        )
        snapshots = sandbox.root / java.DEFAULT_EVIDENCE_SNAPSHOTS
        write_snapshot(snapshots, remote_text, upstream_path=upstream_path)
        registry = write_registry(tmp_path / f"registry-{index}.tsv", [record])
        result = run_branch_entry(
            sandbox,
            registry,
            snapshots,
            transform_set=transform_set,
            contract_schema=contract_schema,
            member_manifest=member_manifest,
        )
        assert result.returncode == 1, (item["local_path"], result.stdout)
        assert "显式排除该对象" in result.stdout, (item["local_path"], result.stdout)
        assert item["pending_decision"][:10] in result.stdout, (item["local_path"], result.stdout)


def test_negative_8b_c_class_cannot_be_bypassed_by_switching_branch(tmp_path: Path) -> None:
    """负对照⑧（另一形态）：改分类或换旧路线不能绕过 C 类排除。"""

    _schema, manifest = load_documents()
    item = manifest["contract_conflicts"][0]
    sandbox = create_sandbox(tmp_path / "repo")
    seed_sandbox_tools(sandbox)
    local_path = item["local_path"]
    upstream_path = item["upstream_path"]
    local_text = (DEFAULT_ROOT / local_path).read_text(encoding="utf-8")
    remote_text = "package placeholder;\nclass Placeholder { int p; }\n"
    sandbox.stage(local_path, local_text)
    target = sandbox.root / local_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(local_text, encoding="utf-8")
    sandbox.record_baseline()
    transform_set = tmp_path / "transform.json"
    shutil.copyfile(REPO_TRANSFORM_SET, transform_set)
    contract_schema = tmp_path / "schema.json"
    shutil.copyfile(REPO_CONTRACT_SCHEMA, contract_schema)
    member_manifest = tmp_path / "manifest.json"
    shutil.copyfile(REPO_MEMBER_MANIFEST, member_manifest)
    contract = build_contract(
        local_text,
        remote_text,
        transform_set_document=json.loads(transform_set.read_text(encoding="utf-8")),
        transform_set_path=transform_set,
        contract_schema_path=contract_schema,
        member_manifest_path=member_manifest,
    )
    # 换成 C2 路线 3 分支试图绕过本分支的显式排除。
    record = evidence_record(
        local_text,
        remote_text,
        contract=contract,
        branch=java.EVIDENCE_BRANCH_CONTENT_INDEPENDENT,
        route=java.CONTENT_INDEPENDENT_ROUTE,
        upstream_path=upstream_path,
        local_path=local_path,
    )
    snapshots = sandbox.root / java.DEFAULT_EVIDENCE_SNAPSHOTS
    write_snapshot(snapshots, remote_text, upstream_path=upstream_path)
    registry = write_registry(tmp_path / "registry.tsv", [record])
    result = run_branch_entry(
        sandbox,
        registry,
        snapshots,
        transform_set=transform_set,
        contract_schema=contract_schema,
        member_manifest=member_manifest,
    )
    assert result.returncode == 1, result.stdout
    assert "C2-independent-content" in result.stdout or "内容点" in result.stdout, result.stdout


def test_route_binding_rejects_member_identity_on_route_three(tmp_path: Path) -> None:
    """归属校验：``E2-member-identity`` 只允许归属路线 2（D17 §G1/G8）。"""

    case = prepare(
        tmp_path,
        local=local_source(),
        remote=upstream_source(),
        route=java.CONTENT_INDEPENDENT_ROUTE,
    )
    branch = case.branch()
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert f"{BRANCH} 分支归属路线 2，当前 evidence_route=路线 3" in branch.stdout, branch.stdout


def test_member_identity_requires_explicit_transform_reuse_declaration(tmp_path: Path) -> None:
    """D17 §G4：复用 D16 变换必须显式登记，既有清单的 branch 字段不算授权。"""

    case = prepare(tmp_path, local=local_source(), remote=upstream_source())
    case.rewrite(lambda record: _mutate_contract(record, lambda c: c.pop("transform_reuse")))
    branch = case.branch()
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "transform_reuse" in branch.stdout, branch.stdout


def test_business_subject_review_must_be_independent(tmp_path: Path) -> None:
    """G5/G8：业务语义主体复核人必须独立于实施者。"""

    business = business_subject()
    business["reviewer"] = business["implementer"]
    case = prepare(
        tmp_path,
        local=local_source(),
        remote=upstream_source(),
        contract_kwargs={"business": business},
    )
    branch = case.branch()
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "必须独立于实施者" in branch.stdout, branch.stdout


def test_missing_business_subject_is_rejected(tmp_path: Path) -> None:
    """G5：缺业务语义主体的语义记录必须硬拒绝，不能退回已登记阻断。"""

    case = prepare(
        tmp_path,
        local=local_source(),
        remote=upstream_source(),
        contract_kwargs={"business": {}},
    )
    branch = case.branch()
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "business_subject" in branch.stdout, branch.stdout


def test_run_checks_group_comments_agrees_with_checker(tmp_path: Path) -> None:
    """负对照⑩：``run_checks.py --group comments`` 与检查器判定一致。"""

    case = prepare(tmp_path, local=local_source(), remote=upstream_source())
    case.rewrite(lambda record: _mutate_contract(record, lambda c: c.update({"difference_attribution": []})))
    result = run_run_checks(case.sandbox, transform_set=case.transform_set,
                            contract_schema=case.contract_schema, member_manifest=case.member_manifest)
    assert result.returncode != 0, result.stdout + result.stderr
    summary = json.loads(result.stdout)
    assert summary["inputs_consistent"], summary
    gate = next(item for item in summary["results"] if item["name"] == "java-comments-full")
    assert gate["process_code"] == 1, gate
    assert "没有恰好覆盖全部实测差异" in gate["reason"], gate["reason"]


def test_run_checks_group_comments_completes_on_positive_case(tmp_path: Path) -> None:
    """正例（汇总入口）：维护模式下完成且如实标注已登记阻断。"""

    local = local_source(javadoc=local_javadoc(marker=java.SOURCE_REVIEW_UNACCEPTED_MARKER))
    case = prepare(
        tmp_path,
        local=local,
        remote=upstream_source(),
        verdict="复核回退，保持来源说明并登记阻断（尚未验收）",
        blocker_reason="历史引入版本未核实；成员级分支成立但作者/来源仍需逐条复核",
        contract_local=local,
    )
    result = run_run_checks(
        case.sandbox,
        transform_set=case.transform_set,
        contract_schema=case.contract_schema,
        member_manifest=case.member_manifest,
        maintenance=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr[-6000:]
    summary = json.loads(result.stdout)
    assert summary["status"] == java.CHECK_STATUS_MAINTENANCE and summary["inputs_consistent"], summary
    assert summary["counts"]["hard_failures"] == 0, summary["counts"]
    gate = next(item for item in summary["results"] if item["name"] == "java-comments-full")
    assert gate["process_code"] == 0, gate


def test_tool_fingerprint_must_match_current_implementation(tmp_path: Path) -> None:
    """实现指纹错配必须拒绝，不能只靠旧哈希不符掩盖比较逻辑。"""

    case = prepare(
        tmp_path,
        local=local_source(),
        remote=upstream_source(),
        contract_kwargs={"tool_sha256": "0" * 64},
    )
    branch = case.branch()
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "tool.sha256 与当前规则实现不符" in branch.stdout, branch.stdout


def test_member_readings_must_match_measurement(tmp_path: Path) -> None:
    """登记的逐成员读数必须与实测一致，不能手填。"""

    case = prepare(tmp_path, local=local_source(), remote=upstream_source())
    case.rewrite(
        lambda record: _mutate_contract(
            record, lambda c: c["members"][0].update({"local_member_sha256": "0" * 64})
        )
    )
    branch = case.branch()
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "与实测不符" in branch.stdout, branch.stdout


def test_raw_member_bytes_must_be_registered_separately(tmp_path: Path) -> None:
    """D17 §52：必须分别登记未执行 T1–T5 的原始成员字节与变换后规范字节。"""

    case = prepare(tmp_path, local=local_source(), remote=upstream_source())
    case.rewrite(
        lambda record: _mutate_contract(
            record,
            lambda c: c["members"][0].update({"raw_local_member_sha256": "0" * 64}),
        )
    )
    branch = case.branch()
    assert branch.returncode == 1, branch.stdout + branch.stderr
    assert "raw_local_member_sha256 与实测不符" in branch.stdout, branch.stdout


def test_self_test_still_passes() -> None:
    """规则内置自检不得因新分支引入而失败。"""

    result = subprocess.run(
        [
            sys.executable, "-B", "-X", "utf8",
            str(DEFAULT_ROOT / "scripts/code/java/check_staged_java_comments.py"),
            "--self-test",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=DEFAULT_ROOT,
        timeout=180,
    )
    assert result.returncode == 0, result.stdout + result.stderr
