#!/usr/bin/env python3
"""生成 D16 逐条复核材料包与通配符导入扩展材料（实施方材料，不含任何判定）。

本工具只**准备材料**：它把裁决 D16 §114 授权的逐条复核所需的全部可复算读数、
逐行差异归因、注释逐字原文与指纹、作者与来源事实、契约影响标记、复现命令和
未解决问题整理成机器可读 JSON 与人读 Markdown。工具**不判定**任何条目：
`reviewer_verdict` / `reviewer` / `review_date` / `review_reason` 一律写 ``null``，
由独立复核方填写，实施方不得代填，也不得改判索引记录。

严格比较读数一律调用规则实现 `scripts/code/java/check_staged_java_comments.py`
自身的词法、变换、序列化与差异行统计函数，不在本工具内另写一套比较逻辑。

用法::

    python3 -B -X utf8 scripts/tools/build_d16_review_package.py --build
    python3 -B -X utf8 scripts/tools/build_d16_review_package.py --verify-item \
        com.basicframework.framework.common.exception.ErrorCode --json
    python3 -B -X utf8 scripts/tools/build_d16_review_package.py --verify-wildcard --json

@author OpenAI Codex
"""

from __future__ import annotations

import argparse
import difflib
import functools
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ElementTree
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
EVIDENCE_DIR = REPO_ROOT / "docs/测试与可靠性/来源证据"
QUEUE_PATH = EVIDENCE_DIR / "代码同一性复核队列.json"
INDEX_PATH = EVIDENCE_DIR / "d12-source-index.json"
SNAPSHOT_DIR = EVIDENCE_DIR / "上游快照"
MANIFEST_PATH = SNAPSHOT_DIR / "上游快照清单.json"
CHECKER_PATH = REPO_ROOT / "scripts/code/java/check_staged_java_comments.py"
TRANSFORM_SET_PATH = EVIDENCE_DIR / "代码同一性变换集.json"
JAVA_WORKSPACE = REPO_ROOT / "后端代码/basic-framework-boot"
JDK_HOME = Path(os.environ.get("JAVA_HOME") or "/home/weetion/tools/jdk17/jdk-17.0.20.1+1")
JDK_SRC_ZIP = JDK_HOME / "lib/src.zip"
_JDK_INDEX: dict[str, Any] = {"value": None}

REVIEW_JSON = EVIDENCE_DIR / "代码同一性逐条复核材料.json"
REVIEW_MD = EVIDENCE_DIR / "代码同一性逐条复核材料.md"
WILDCARD_JSON = EVIDENCE_DIR / "代码同一性通配符导入扩展材料.json"
WILDCARD_MD = EVIDENCE_DIR / "代码同一性通配符导入扩展材料.md"

SCHEMA_REVIEW = "d16-code-identity-review-materials/v1"
SCHEMA_WILDCARD = "d16-wildcard-import-extension-materials/v1"

GENERATOR_RELATIVE = "scripts/tools/build_d16_review_package.py"
IMPLEMENTER = "D16 复核材料实施方（scripts/tools/build_d16_review_package.py）"

HEADER_NOTICE = (
    "本文件由实施方生成，判定列留空待独立复核方填写；实施方不得自行填写。"
    "本文件不含任何验收结论，也不改判索引中的任何记录："
    "d12_verdict / evidence_branch / evidence_route 一律保持原值。"
)

# 已确认契约的机械标记表：只登记**位置**，不作“是否影响契约”的结论。
CONTRACTS: tuple[dict[str, Any], ...] = (
    {
        "id": "auth",
        "name": "认证策略",
        "authority": "docs/测试与可靠性/整改交接-20261004/已确认的认证策略.txt："
        "关闭开放注册与分享登录；个人改密、管理员重置、短信找回均撤销全部旧会话并要求重新登录",
        "markers": (
            "SecurityContextHolder",
            "@PreAuthorize",
            "AccessToken",
            "RefreshToken",
            "AuthLogin",
            "OAuth2",
            "LoginResultEnum",
            "password",
        ),
        "verify_command": "python3 -B -X utf8 scripts/code/java/verify_api_contracts.py",
    },
    {
        "id": "rate-limit",
        "name": "限流",
        "authority": "裁决 D16 变换集 T4 登记的 basic-framework 限流/幂等配置前缀；"
        "限流注解与 KeyResolver 的登记点在 docs/测试与可靠性/测试策略.md",
        "markers": ("RateLimiter", "KeyResolver", "@Idempotent", "Idempotent"),
        "verify_command": "grep -nE 'RateLimiter|KeyResolver|Idempotent' <文件路径>",
    },
    {
        "id": "crypto",
        "name": "加密",
        "authority": "docs/测试与可靠性/R01-R17-验收矩阵.md R08/R10 登记的接口加密与分布式锁边界",
        "markers": ("ApiEncrypt", "Lock4j", "encrypt", "decrypt", "Encrypt"),
        "verify_command": "grep -nE 'ApiEncrypt|Lock4j|[Ee]ncrypt|[Dd]ecrypt' <文件路径>",
    },
    {
        "id": "lifecycle",
        "name": "异常与资源生命周期",
        "authority": "docs/测试与可靠性/整改审查与接续.md：保留现有权限、数据范围及资源生命周期保护",
        "markers": (
            "ServiceException",
            "GlobalExceptionHandler",
            "throws ",
            "try (",
            ".close()",
            "ErrorCode",
            "assert",
        ),
        "verify_command": "grep -nE 'ServiceException|throws |try \\(|\\.close\\(\\)|ErrorCode' <文件路径>",
    },
    {
        "id": "sensitive",
        "name": "敏感字段输出",
        "authority": "scripts/code/java/verify_api_contracts.py 的 sensitive-field-in-response 规则"
        "与 R08 验收矩阵",
        "markers": (
            "@JsonIgnore",
            "StringDesensitizeSerializer",
            "password",
            "secret",
            "apiSecret",
            "accessToken",
            "refreshToken",
            "mobile",
        ),
        "verify_command": "python3 -B -X utf8 scripts/code/java/verify_api_contracts.py --json",
    },
    {
        "id": "direction",
        "name": "模块依赖方向",
        "authority": "scripts/code/java/verify_backend_boundaries.py 的 LAYERS 层次与方向规则",
        "markers": (),
        "verify_command": "python3 -B -X utf8 scripts/code/java/verify_backend_boundaries.py --json",
    },
)

AUTHOR_TOKEN_PATTERN = re.compile(r"@author|作者\s*[:：]|\bauthor\s*:", re.IGNORECASE)
LICENSE_PATTERN = re.compile(
    r"copyright|spdx-license-id|@license\b|licensed under|all rights reserved"
    r"|\bmit license\b|\bapache license\b|\bgnu general public\b",
    re.IGNORECASE,
)
SOURCE_NOTE_PREFIXES = ("来源：", "上游文件：", "上游文件续：", "来源依据：", "本地修改：")
REVIEW_MARKERS = (
    "来源验收：尚未验收",
    "来源验收：已验收",
    "署名验收：尚未验收",
    "署名验收：已验收",
)


# --------------------------------------------------------------------------
# 基础工具
# --------------------------------------------------------------------------


def sha256_bytes(raw: bytes) -> str:
    """返回字节串的 SHA-256 十六进制指纹。"""

    return hashlib.sha256(raw).hexdigest()


def sha256_text(text: str) -> str:
    """返回 UTF-8 文本的 SHA-256 十六进制指纹。"""

    return sha256_bytes(text.encode("utf-8"))


def git(*arguments: str) -> str:
    """在仓库根执行只读 git 命令并返回去除行尾换行的输出。"""

    result = subprocess.run(
        ("git",) + arguments,
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def load_checker() -> Any:
    """按文件路径加载规则实现模块，避免依赖调用者的当前目录。"""

    sys.dont_write_bytecode = True
    specification = importlib.util.spec_from_file_location("d16_rule_implementation", CHECKER_PATH)
    if specification is None or specification.loader is None:  # pragma: no cover - 防御
        raise RuntimeError(f"无法加载规则实现：{CHECKER_PATH}")
    module = importlib.util.module_from_spec(specification)
    sys.modules["d16_rule_implementation"] = module
    specification.loader.exec_module(module)
    return module


def relative(path: Path) -> str:
    """把绝对路径转换为相对仓库根的展示路径。"""

    return path.resolve().relative_to(REPO_ROOT).as_posix()


def read_json(path: Path) -> dict[str, Any]:
    """读取 UTF-8 JSON 对象。"""

    return json.loads(path.read_text(encoding="utf-8"))


def reproduction_preamble() -> str:
    """返回复核方在本机复算时需要的环境前缀。"""

    return (
        "cd /home/weetion/桌面/kuangjia/repo && "
        "export PATH=/home/weetion/.nvm/versions/node/v24.15.0/bin:$PATH && "
    )


def resolve_transform_set(checker: Any) -> dict[str, Any]:
    """按受控路径解析变换集清单，失败即受控失败。

    Args:
        checker: 规则实现模块。

    Returns:
        已通过规则实现逐项校验的变换集文档。

    Raises:
        RuntimeError: 清单不可用时抛出，不退回宽松比较。

    """

    resolved = checker._code_identity_resolve_transform_set(TRANSFORM_SET_PATH)
    document = resolved[0] if isinstance(resolved, tuple) else resolved
    if document is None:  # pragma: no cover - 防御
        raise RuntimeError("代码同一性变换集不可用")
    return document


def ordered_transforms(document: dict[str, Any]) -> list[dict[str, Any]]:
    """按清单登记的执行顺序返回变换列表。"""

    order = [str(item) for item in document.get("execution_order") or []]
    return sorted(document["transforms"], key=lambda item: order.index(str(item["id"])))


# --------------------------------------------------------------------------
# 严格比较读数（全部调用规则实现自身函数）
# --------------------------------------------------------------------------


def join_import_parts(parts: list[str]) -> str:
    """把 import 语句的 token 拼回规范文本（分号前不留空格）。"""

    return " ".join(parts).replace(" ;", ";")


def import_entries(tokens: list[list[str]]) -> list[str]:
    """从代码 token 流还原 import 语句原文序列（保留全部条目）。"""

    entries: list[str] = []
    index = 0
    total = len(tokens)
    while index < total:
        kind, text, _ = tokens[index]
        previous_is_dot = index > 0 and tokens[index - 1][0] == "op" and tokens[index - 1][1] == "."
        if kind == "ident" and text == "import" and not previous_is_dot:
            parts: list[str] = []
            cursor = index
            while cursor < total:
                if tokens[cursor][0] == "op" and tokens[cursor][1] == ";":
                    parts.append(";")
                    cursor += 1
                    break
                parts.append(tokens[cursor][1])
                cursor += 1
            entries.append(join_import_parts(parts))
            index = cursor
            continue
        index += 1
    return entries


def transform_occurrences(
    checker: Any, source: str, transforms: list[dict[str, Any]], side: str
) -> list[dict[str, Any]]:
    """逐条登记每条变换在本侧代码流上的**实际发生点**与前后原文。

    T5 只做组内确定性排序，位置会整体平移，因此按序列化字节的前后对照登记，
    不把排序位移误报成 token 改写。

    Args:
        checker: 规则实现模块。
        source: 单侧源码原文。
        transforms: 按执行顺序排列的已登记变换。
        side: ``local`` 或 ``upstream``。

    Returns:
        每条变换一条读数，含应用标记、改写 token 数与发生点。

    """

    tokens, _ = checker._code_identity_code_tokens(source)
    readings: list[dict[str, Any]] = []
    current = tokens
    for transform in transforms:
        direction = str(transform.get("direction"))
        applies = direction == "both" or side == "upstream"
        reading: dict[str, Any] = {
            "rule": str(transform.get("id")),
            "name": str(transform.get("name")),
            "operation": str(transform.get("operation")),
            "direction": direction,
            "applied_on_this_side": applies,
            "pairs_registered": len(transform.get("pairs") or []),
        }
        if not applies:
            reading.update(
                {"rewritten_token_count": 0, "points": [], "note": "方向不适用于本侧，未执行"}
            )
            readings.append(reading)
            continue
        after = checker._code_identity_apply_transform(current, transform)
        if str(transform.get("operation")) == "import-group-canonical-sort":
            before_bytes = checker._code_identity_serialize(current)
            after_bytes = checker._code_identity_serialize(after)
            reading.update(
                {
                    "rewritten_token_count": 0,
                    "stream_reordered": before_bytes != after_bytes,
                    "import_entries_before": import_entries(current),
                    "import_entries_after": import_entries(after),
                    "points": [],
                }
            )
        else:
            points: list[dict[str, Any]] = []
            for position, (before, later) in enumerate(zip(current, after)):
                if before[1] != later[1]:
                    points.append(
                        {
                            "token_index": position + 1,
                            "token_kind": later[0],
                            "line": int(later[2]),
                            "before": before[1],
                            "after": later[1],
                        }
                    )
            reading.update(
                {
                    "rewritten_token_count": len(points),
                    "points": points,
                    "token_count_before": len(current),
                    "token_count_after": len(after),
                }
            )
        current = after
        readings.append(reading)
    return readings


def comment_role_of(line: str) -> tuple[str, bool]:
    """判定单行注释的角色与是否为作者标签行。

    Args:
        line: 原始源码行。

    Returns:
        ``(角色, 是否作者标签行)``；角色取 ``d12-source-note``、``d15-inplace-marker``
        或 ``responsibility-javadoc``。

    """

    body = line.strip()
    if body.startswith("/**"):
        body = body[3:]
    if body.endswith("*/"):
        body = body[:-2]
    body = body.strip()
    if body.startswith("*"):
        body = body[1:]
        if body.startswith(" "):
            body = body[1:]
    if any(body.startswith(prefix) for prefix in SOURCE_NOTE_PREFIXES):
        return "d12-source-note", False
    if body in REVIEW_MARKERS:
        return "d15-inplace-marker", False
    if body.startswith("@author"):
        return "responsibility-javadoc", True
    return "responsibility-javadoc", False


def registered_line_mapping(upstream_line: str, transforms: list[dict[str, Any]]) -> str:
    """把上游单行按登记变换做行级映射（仅用于归因提示，不是权威比较）。

    权威判定始终是规则实现的 token 级比较；这里的行级映射只用来告诉复核方
    “这一行差异落在哪条已登记规则上”，映射关系逐条取自受控变换集清单。

    Args:
        upstream_line: 上游单行原文。
        transforms: 按执行顺序排列的已登记变换。

    Returns:
        映射后的单行文本。

    """

    text = upstream_line
    for transform in transforms:
        operation = str(transform.get("operation"))
        if operation == "exact-string-literal-map":
            for source, target in transform.get("pairs") or []:
                text = text.replace(str(source), str(target))
            continue
        for source, target in transform.get("pairs") or []:
            source_text = str(source)
            target_text = str(target)
            if operation == "qualified-name-prefix-map":
                text = re.sub(
                    r"(?<![\w.])" + re.escape(source_text) + r"(?=\.|$)", target_text, text
                )
            elif operation == "exact-simple-name-map":
                text = re.sub(
                    r"(?<![\w.$])" + re.escape(source_text) + r"(?![\w$])", target_text, text
                )
            elif operation == "exact-name-map":
                text = re.sub(
                    r"(?<![\w.$])" + re.escape(source_text) + r"(?![\w$])", target_text, text
                )
    return text


def reverse_registered_line_mapping(local_line: str, transforms: list[dict[str, Any]]) -> str:
    """把本地单行按登记变换做反向（本地→上游）行级映射。

    结果只作为跨块对应索引的**候选键**使用，随后仍用
    :func:`registered_line_mapping` 正向复算验证，不直接作为归因依据。

    Args:
        local_line: 本地单行原文。
        transforms: 按执行顺序排列的已登记变换。

    Returns:
        反向映射后的单行文本。

    """

    text = local_line
    for transform in reversed(transforms):
        operation = str(transform.get("operation"))
        for source, target in reversed(transform.get("pairs") or []):
            source_text = str(target)
            target_text = str(source)
            if operation == "exact-string-literal-map":
                text = text.replace(source_text, target_text)
            elif operation == "qualified-name-prefix-map":
                text = re.sub(
                    r"(?<![\w.])" + re.escape(source_text) + r"(?=\.|$)", target_text, text
                )
            else:
                text = re.sub(
                    r"(?<![\w.$])" + re.escape(source_text) + r"(?![\w$])", target_text, text
                )
    return text


def line_comment_tokens(checker: Any, line: str) -> list[str]:
    """返回单行源码中的注释 token 原文（空列表表示该行没有注释）。"""

    tokens, _ = checker._code_identity_tokenize(line)
    return [token[1] for token in tokens if token[0] == "comment"]


def classify_line_pair(
    checker: Any, transforms: list[dict[str, Any]], local_line: str, upstream_line: str
) -> tuple[str, str, str]:
    """判定单行差异的原因类别、规则标识与理由。

    判定完全建立在规则实现的词法与变换函数之上：先看注释角色，再逐条尝试已登记
    变换，最后才看空白。不使用“看起来像”的字符串猜测。

    Args:
        checker: 规则实现模块。
        transforms: 按执行顺序排列的已登记变换。
        local_line: 本地行原文（可为空字符串，表示该侧没有对应行）。
        upstream_line: 上游行原文（可为空字符串）。

    Returns:
        ``(cause, rule, 理由)``；无法解释时 ``cause`` 为 ``unexplained``。

    """

    local_comments = line_comment_tokens(checker, local_line)
    upstream_comments = line_comment_tokens(checker, upstream_line)
    local_blank = not local_line.strip()
    upstream_blank = not upstream_line.strip()

    if local_line.strip().startswith(("//", "/*", "*")):
        role, is_author = comment_role_of(local_line)
        if LICENSE_PATTERN.search(local_line):
            role = "license-or-copyright"
        cause = {
            "d12-source-note": "d12-source-note",
            "d15-inplace-marker": "d15-inplace-marker",
            "license-or-copyright": "license-or-copyright",
        }.get(role, "local-responsibility-javadoc")
        reason = (
            "本地侧是注释行，注释不进入代码流，按 D16 §66 单独核对；"
            + (
                "该行含作者标签，另按 D16 §67 单独验收作者与来源。"
                if is_author
                else "属本地注释正文。"
            )
        )
        return cause, "D16 §66 注释排除但须另行核对", reason
    if upstream_comments or (upstream_line.strip().startswith(("//", "/*", "*")) and not local_line.strip()):
        if not local_line.strip():
            return (
                "comment-difference",
                "D16 §66 注释排除但须另行核对",
                "上游侧该行是注释，本地没有对应行；注释不进入代码流，但原文差异如实登记。",
            )

    local_tokens, _ = checker._code_identity_code_tokens(local_line)
    upstream_tokens, _ = checker._code_identity_code_tokens(upstream_line)
    local_serialized = checker._code_identity_serialize(local_tokens)
    upstream_serialized = checker._code_identity_serialize(upstream_tokens)
    comments_differ = local_comments != upstream_comments
    applicable = [
        transform
        for transform in transforms
        if str(transform.get("operation")) != "import-group-canonical-sort"
    ]
    if comments_differ:
        combined = upstream_tokens
        for transform in applicable:
            combined = checker._code_identity_apply_transform(combined, transform)
        if checker._code_identity_serialize(combined) == local_serialized:
            return (
                "comment-difference",
                "D16 §66 注释排除但须另行核对",
                "双方代码 token 在登记变换后相同，差异只在行内注释："
                f"本地 {local_comments or '无'}，上游 {upstream_comments or '无'}。",
            )
    for transform in applicable:
        mapped = checker._code_identity_apply_transform(upstream_tokens, transform)
        if (
            checker._code_identity_serialize(mapped) == local_serialized
            and checker._code_identity_serialize(mapped) != upstream_serialized
        ):
            if comments_differ:
                return (
                    "comment-difference",
                    "D16 §66 注释排除但须另行核对",
                    "双方代码 token 在登记变换后相同，差异只在行内注释："
                    f"本地 {local_comments or '无'}，上游 {upstream_comments or '无'}。",
                )
            return (
                "registered-transform",
                str(transform.get("id")),
                f"上游行的代码 token 经已登记规则 {transform.get('id')}（{transform.get('name')}）"
                "映射后与本地行逐字节相同。",
            )
    combined = upstream_tokens
    applied_rules: list[str] = []
    for transform in applicable:
        following = checker._code_identity_apply_transform(combined, transform)
        if checker._code_identity_serialize(following) != checker._code_identity_serialize(
            combined
        ):
            applied_rules.append(str(transform.get("id")))
        combined = following
    if (
        applied_rules
        and checker._code_identity_serialize(combined) == local_serialized
        and not comments_differ
    ):
        return (
            "registered-transform",
            "+".join(applied_rules),
            f"上游行的代码 token 需要按 {'、'.join(applied_rules)} 依次映射后才与本地行逐字节相同。",
        )
    if upstream_serialized == local_serialized:
        if comments_differ:
            return (
                "comment-difference",
                "D16 §66 注释排除但须另行核对",
                "双方代码 token 相同，差异只在行内注释："
                f"本地 {local_comments or '无'}，上游 {upstream_comments or '无'}。",
            )
        if local_blank and upstream_blank:
            return (
                "code-outside-whitespace",
                "N1 代码 token 之间空白规范化",
                "双方都是代码外的空行，不产生任何代码 token。",
            )
        return (
            "code-outside-whitespace",
            "N1 代码 token 之间空白规范化",
            "双方代码 token 逐字节相同，差异只在代码之外的空白。",
        )
    return (
        "unexplained",
        "",
        "该行差异未能由任何已登记变换、空白规范化或注释差异解释，必须由复核方人工判定。",
    )


def build_attribution(
    checker: Any, local_text: str, upstream_text: str, transforms: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """按双方原始行序列计算逐处差异归因。

    归因块取自与规则实现相同的 ``difflib.SequenceMatcher`` 对齐；块内再按“可解释即配对”
    的贪心规则重排，因此 import 组顺序不同、注释只在单侧存在、行尾空白等情形都能落到
    唯一的、可复算的归因上。``changed_lines`` 合计因此必然等于规则实现实测的差异行数。

    Args:
        checker: 规则实现模块。
        local_text: 本地原文。
        upstream_text: 上游原文。
        transforms: 按执行顺序排列的已登记变换。

    Returns:
        ``(归因列表, 覆盖统计)``。

    """

    local_lines = local_text.split("\n")
    upstream_lines = upstream_text.split("\n")
    # 跨块对应索引：import 组顺序不同会把同一条 import 拆到两个差异块，行尾注释也会
    # 让同一条代码落到不同块。这里预先登记“映射后逐字相同”与“代码 token 相同”的跨块
    # 对应关系，只用于**改写归因说明**，不改变任何一行的计数（覆盖仍由各块自身的原始
    # 行数决定）。

    def code_key(checker: Any, line: str, apply_mapping: bool) -> str | None:
        """返回一行的规范代码 token 串；空行或纯注释行返回 ``None``。"""

        if not line.strip() or line.strip().startswith(("//", "/*", "*")):
            return None
        tokens, _ = checker._code_identity_code_tokens(line)
        if apply_mapping:
            for transform in transforms:
                if str(transform.get("operation")) == "import-group-canonical-sort":
                    continue
                tokens = checker._code_identity_apply_transform(tokens, transform)
        return checker._code_identity_serialize(tokens).decode("utf-8")

    local_text_index: dict[str, list[int]] = {}
    local_token_index: dict[str, list[int]] = {}
    for index, line in enumerate(local_lines):
        if not line.strip() or line.strip().startswith(("//", "/*", "*")):
            continue
        local_text_index.setdefault(line, []).append(index)
        key = code_key(checker, line, False)
        if key:
            local_token_index.setdefault(key, []).append(index)
    upstream_text_index: dict[str, list[int]] = {}
    upstream_token_index: dict[str, list[int]] = {}
    for index, line in enumerate(upstream_lines):
        if not line.strip() or line.strip().startswith(("//", "/*", "*")):
            continue
        upstream_text_index.setdefault(registered_line_mapping(line, transforms), []).append(index)
        key = code_key(checker, line, True)
        if key:
            upstream_token_index.setdefault(key, []).append(index)

    def cross_block_reason(local_line: str, upstream_line: str, side: str) -> tuple[str, str, str] | None:
        """在另一侧全文中查找能证明对应的行；找到则返回归因三元组，否则返回 ``None``。"""

        if side == "local":
            matches = upstream_text_index.get(local_line, [])
            if matches:
                return (
                    "registered-transform",
                    "import 组内顺序差异（条目集合相同）",
                    f"该行在对方文件第 {matches[0] + 1} 行有经登记变换后逐字相同的对应行"
                    f"（`{upstream_lines[matches[0]].strip()}`）；"
                    "差异来自双方 import 组内顺序不同，条目集合相同",
                )
            key = code_key(checker, local_line, False)
            matches = upstream_token_index.get(key or "", [])
            if matches:
                return (
                    "comment-difference",
                    "D16 §66 注释排除但须另行核对",
                    f"该行在对方文件第 {matches[0] + 1} 行有代码 token 逐字节相同的对应行"
                    f"（`{upstream_lines[matches[0]].strip()}`）；差异只是行内注释的有无",
                )
            return None
        mapped_text = registered_line_mapping(upstream_line, transforms)
        matches = local_text_index.get(mapped_text, [])
        if matches:
            return (
                "registered-transform",
                "import 组内顺序差异（条目集合相同）",
                f"该行在对方文件第 {matches[0] + 1} 行有经登记变换后逐字相同的对应行"
                f"（`{local_lines[matches[0]].strip()}`）；"
                "差异来自双方 import 组内顺序不同，条目集合相同",
            )
        key = code_key(checker, upstream_line, True)
        matches = local_token_index.get(key or "", [])
        if matches:
            return (
                "comment-difference",
                "D16 §66 注释排除但须另行核对",
                f"该行在对方文件第 {matches[0] + 1} 行有代码 token 逐字节相同的对应行"
                f"（`{local_lines[matches[0]].strip()}`）；差异只是行内注释的有无",
            )
        return None

    entries: list[dict[str, Any]] = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(
        None, local_lines, upstream_lines, autojunk=False
    ).get_opcodes():
        if tag == "equal":
            continue
        left = local_lines[i1:i2]
        right = upstream_lines[j1:j2]
        used: set[int] = set()
        pairs: list[tuple[int | None, int | None, str, str, str]] = []
        for local_index, local_line in enumerate(left):
            chosen: tuple[int, str, str, str] | None = None
            for upstream_index, upstream_line in enumerate(right):
                if upstream_index in used:
                    continue
                cause, rule, reason = classify_line_pair(
                    checker, transforms, local_line, upstream_line
                )
                if cause != "unexplained":
                    chosen = (upstream_index, cause, rule, reason)
                    break
            if chosen is not None:
                used.add(chosen[0])
                pairs.append((local_index, chosen[0], chosen[1], chosen[2], chosen[3]))
            else:
                cause, rule, reason = classify_line_pair(checker, transforms, local_line, "")
                if cause == "unexplained":
                    cross = cross_block_reason(local_line, "", "local")
                    if cross is not None:
                        cause, rule, reason = cross
                pairs.append((local_index, None, cause, rule, reason))
        for upstream_index, upstream_line in enumerate(right):
            if upstream_index in used:
                continue
            cause, rule, reason = classify_line_pair(checker, transforms, "", upstream_line)
            if cause == "unexplained":
                cross = cross_block_reason("", upstream_line, "upstream")
                if cross is not None:
                    cause, rule, reason = cross
            pairs.append((None, upstream_index, cause, rule, reason))
        groups: dict[tuple[str, str], list[tuple[int | None, int | None, str]]] = {}
        for local_index, upstream_index, cause, rule, reason in pairs:
            groups.setdefault((cause, rule), []).append((local_index, upstream_index, reason))
        for (cause, rule), members in groups.items():
            first = members[0]
            local_positions = [index for index, _, _ in members if index is not None]
            upstream_positions = [index for _, index, _ in members if index is not None]
            entries.append(
                {
                    "cause": cause,
                    "rule": rule,
                    "diff_tag": tag,
                    "local_lines": [
                        i1 + local_positions[0] + 1 if local_positions else None,
                        i1 + local_positions[-1] + 1 if local_positions else None,
                    ],
                    "upstream_lines": [
                        j1 + upstream_positions[0] + 1 if upstream_positions else None,
                        j1 + upstream_positions[-1] + 1 if upstream_positions else None,
                    ],
                    "changed_lines": {
                        "local": len(local_positions),
                        "upstream": len(upstream_positions),
                    },
                    "local_text": " ⏎ ".join(
                        left[index].strip() for index in local_positions if index < len(left)
                    )
                    or "（无）",
                    "upstream_text": " ⏎ ".join(
                        right[index].strip()
                        for index in upstream_positions
                        if index < len(right)
                    )
                    or "（无）",
                    "line_by_line": [
                        {
                            "local_line": i1 + local_index + 1 if local_index is not None else None,
                            "upstream_line": j1 + upstream_index + 1
                            if upstream_index is not None
                            else None,
                            "local_text": left[local_index] if local_index is not None else "",
                            "upstream_text": right[upstream_index]
                            if upstream_index is not None
                            else "",
                            "reason": reason,
                        }
                        for local_index, upstream_index, reason in members
                    ],
                }
            )
    measured_local, measured_upstream = _measured_diff_lines(local_text, upstream_text)
    attributed_local = sum(entry["changed_lines"]["local"] for entry in entries)
    attributed_upstream = sum(entry["changed_lines"]["upstream"] for entry in entries)
    coverage = {
        "measured_local_lines": measured_local,
        "measured_upstream_lines": measured_upstream,
        "attributed_local_lines": attributed_local,
        "attributed_upstream_lines": attributed_upstream,
        "covers_exactly": attributed_local == measured_local
        and attributed_upstream == measured_upstream,
        "attribution_block_count": len(entries),
        "unexplained_blocks": sum(1 for entry in entries if entry["cause"] == "unexplained"),
        "cause_histogram": _histogram(entry["cause"] for entry in entries),
    }
    return entries, coverage
def _measured_diff_lines(local_text: str, upstream_text: str) -> tuple[int, int]:
    """按规则实现的差异行统计口径复算实测差异行数。"""

    left = right = 0
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(
        None, local_text.split("\n"), upstream_text.split("\n"), autojunk=False
    ).get_opcodes():
        if tag == "equal":
            continue
        left += i2 - i1
        right += j2 - j1
    return left, right


def _histogram(values: Any) -> dict[str, int]:
    """统计可迭代对象中每个取值的出现次数。"""

    counts: dict[str, int] = {}
    for value in values:
        counts[str(value)] = counts.get(str(value), 0) + 1
    return dict(sorted(counts.items()))


# --------------------------------------------------------------------------
# 注释绑定、作者事实与契约影响
# --------------------------------------------------------------------------


def javadoc_blocks(
    local_text: str, start: int, end: int
) -> list[dict[str, Any]]:
    """把一段类型 JavaDoc 按注释角色切成连续块。

    Args:
        local_text: 本地文件原文。
        start: JavaDoc 起始行号（1 起，含 ``/**``）。
        end: JavaDoc 结束行号（1 起，含 ``*/``）。

    Returns:
        连续角色块列表，每块含角色、行区间、逐字原文与指纹。

    """

    lines = local_text.split("\n")
    blocks: list[dict[str, Any]] = []
    for number in range(start, end + 1):
        raw = lines[number - 1]
        role, is_author = comment_role_of(raw)
        stripped = raw.strip()
        if stripped in {"/**", "*/"}:
            role = "responsibility-javadoc"
            is_author = False
        if blocks and blocks[-1]["role"] == role:
            blocks[-1]["lines"][1] = number
            blocks[-1]["author_tag_lines"].extend([number] if is_author else [])
            continue
        blocks.append(
            {
                "role": role,
                "lines": [number, number],
                "author_tag_lines": [number] if is_author else [],
            }
        )
    for block in blocks:
        verbatim = "\n".join(lines[block["lines"][0] - 1 : block["lines"][1]])
        block["text"] = verbatim
        block["sha256"] = sha256_text(verbatim)
    return blocks


def upstream_author_scan(upstream_text: str) -> dict[str, Any]:
    """对上游固定提交的文件原文实测作者声明命中。

    Args:
        upstream_text: 上游文件原文。

    Returns:
        命中行、模式与是否声明作者的读数；扫描只针对作者身份声明关键字。

    """

    hits: list[dict[str, Any]] = []
    for number, line in enumerate(upstream_text.split("\n"), 1):
        if AUTHOR_TOKEN_PATTERN.search(line):
            hits.append({"line": number, "text": line.strip()})
    return {
        "scan_pattern": AUTHOR_TOKEN_PATTERN.pattern,
        "scan_scope": "上游固定提交文件全文逐行（不区分注释/代码/字面量，宁可多报）",
        "hit_count": len(hits),
        "hits": hits,
        "author_declared": bool(hits),
    }


def local_license_scan(local_text: str, upstream_text: str) -> dict[str, Any]:
    """实测本地与上游是否存在版权/许可证声明行。"""

    def scan(text: str) -> list[dict[str, Any]]:
        """逐行扫描一份源码，返回命中版权/许可证关键字的行。"""

        return [
            {"line": number, "text": line.strip()}
            for number, line in enumerate(text.split("\n"), 1)
            if LICENSE_PATTERN.search(line)
        ]

    local_hits = scan(local_text)
    upstream_hits = scan(upstream_text)
    return {
        "scan_pattern": LICENSE_PATTERN.pattern,
        "local_hits": local_hits,
        "upstream_hits": upstream_hits,
        "present_locally": bool(local_hits),
        "present_upstream": bool(upstream_hits),
        "note": "copyright/MIT/Apache/SPDX/license 关键字逐行实测；命中 0 表示该对象没有版权或许可证头。",
    }


def module_index() -> dict[str, Any]:
    """从 Maven 反应堆 POM 复算模块、包根与层次映射。

    Returns:
        模块列表与“包前缀 → 模块”的索引，供模块依赖方向标记使用。

    """

    namespace = "{http://maven.apache.org/POM/4.0.0}"
    modules: list[dict[str, Any]] = []

    def parse(pom: Path) -> dict[str, Any]:
        """解析单个 POM，取出坐标与包根等模块事实。"""

        tree = ElementTree.parse(pom)
        root = tree.getroot()
        artifact = root.findtext(f"{namespace}artifactId") or ""
        packaging = root.findtext(f"{namespace}packaging") or "jar"
        source = pom.parent / "src/main/java"
        package_root = ""
        if source.is_dir():
            for child in sorted(source.iterdir()):
                if child.is_dir() and (child / "module-info.java").exists():
                    continue
            first_package = next(
                (
                    directory.relative_to(source).as_posix().replace("/", ".")
                    for directory in sorted(source.glob("*"))
                    if directory.is_dir()
                ),
                "",
            )
            package_root = first_package
        return {
            "pom": relative(pom),
            "pom_sha256": sha256_bytes(pom.read_bytes()),
            "artifact_id": artifact,
            "packaging": packaging,
            "package_root": package_root,
        }

    modules.append(parse(JAVA_WORKSPACE / "pom.xml"))
    for pom in sorted(JAVA_WORKSPACE.glob("*/pom.xml")):
        modules.append(parse(pom))
    return {
        "modules": modules,
        "package_owners": {
            module["package_root"]: module["artifact_id"]
            for module in modules
            if module["package_root"]
        },
    }


def module_of_path(local_path: str, modules: dict[str, Any]) -> dict[str, Any]:
    """按最长目录前缀推导本地对象所属的 Maven 模块与包根。"""

    best: dict[str, Any] | None = None
    best_length = -1
    for module in modules["modules"]:
        directory = str(Path(module["pom"]).parent)
        if local_path.startswith(f"{directory}/") and len(directory) > best_length:
            best = module
            best_length = len(directory)
    if best is not None:
        return best
    return {"pom": "", "pom_sha256": "", "artifact_id": "", "packaging": "", "package_root": ""}


def contract_impact(
    local_path: str,
    local_text: str,
    modules: dict[str, Any],
) -> list[dict[str, Any]]:
    """逐条给出六个已确认契约的机械命中位置（不作结论）。

    Args:
        local_path: 本地对象路径。
        local_text: 本地对象原文。
        modules: 模块与包根索引。

    Returns:
        每条契约一条读数：命中标记、具体行号与权威核对命令。

    """

    lines = local_text.split("\n")
    own_module = module_of_path(local_path, modules)
    findings: list[dict[str, Any]] = []
    for contract in CONTRACTS:
        if contract["id"] == "direction":
            owners = modules["package_owners"]
            keys = sorted(owners, key=len, reverse=True)
            cross: list[dict[str, Any]] = []
            for number, line in enumerate(lines, 1):
                match = re.match(r"\s*import\s+(static\s+)?([\w.]+)\s*;", line)
                if not match:
                    continue
                package = match.group(2)
                owner = next((owners[key] for key in keys if package.startswith(key)), None)
                if owner and own_module["artifact_id"] and owner != own_module["artifact_id"]:
                    cross.append(
                        {
                            "line": number,
                            "import": match.group(0).strip(),
                            "target_module": owner,
                        }
                    )
            findings.append(
                {
                    "contract_id": contract["id"],
                    "contract": contract["name"],
                    "authority": contract["authority"],
                    "hit": bool(cross),
                    "own_module": own_module["artifact_id"],
                    "markers": [],
                    "cross_module_imports": cross,
                    "detail": (
                        "该文件的 import 未越过其他 Maven 模块的包根。"
                        if not cross
                        else "该文件 import 了其他 Maven 模块的包："
                        + "；".join(f"第 {item['line']} 行 → {item['target_module']}" for item in cross)
                    ),
                    "verify_command": contract["verify_command"],
                    "method": "按 POM 包根索引实测归属，不替代 verify_backend_boundaries.py 的判定",
                }
            )
            continue
        hits: list[dict[str, Any]] = []
        for number, line in enumerate(lines, 1):
            for marker in contract["markers"]:
                if marker in line:
                    hits.append({"line": number, "marker": marker, "text": line.strip()[:160]})
                    break
        findings.append(
            {
                "contract_id": contract["id"],
                "contract": contract["name"],
                "authority": contract["authority"],
                "hit": bool(hits),
                "own_module": own_module["artifact_id"],
                "markers": hits[:40],
                "marker_hit_count": len(hits),
                "detail": (
                    "按登记标记表在本文件内未命中；这不等于“确认无影响”，"
                    "仍需复核方结合该契约的实际运行面判断。"
                    if not hits
                    else "按登记标记表在本文件内命中 "
                    + str(len(hits))
                    + " 行，逐行列于 markers。"
                ),
                "verify_command": contract["verify_command"],
                "method": "固定标记表的逐行文本命中；标记表见 scripts/tools/build_d16_review_package.py 的 CONTRACTS",
            }
        )
    return findings


# --------------------------------------------------------------------------
# 单条候选材料
# --------------------------------------------------------------------------


def line_number_of(starts: list[int], offset: int) -> int:
    """把字符偏移换算成 1 起始行号（复用规则实现的行首表）。"""

    index = 0
    for position, start in enumerate(starts):
        if start > offset:
            break
        index = position
    return index + 1


def declaration_javadoc(
    checker: Any, source: str, declaration: str
) -> dict[str, Any] | None:
    """按规则实现自身的口径取出某个类型的声明位置与紧邻 JavaDoc。

    受控索引 ``type_evidence.javadoc_sha256`` 的指纹口径是 ``_attached_javadoc``
    返回的**偏移区间文本**（首行不含缩进、其余行保留原文），不是“按行号 join”的结果；
    嵌套类型尤其如此。本函数直接复用规则实现，保证材料里的逐类型绑定与门禁口径一致。

    Args:
        checker: 规则实现模块。
        source: 本地文件原文。
        declaration: 目标类型的限定名。

    Returns:
        含声明偏移/行号、JavaDoc 文本、行区间与指纹的字典；找不到时返回 ``None``。

    """

    simple_name = declaration.split(".")[-1]
    masked = checker._mask_java(source)
    declarations = checker._type_declarations(
        masked,
        checker._depths(masked, "{", "}"),
        checker._matching_delimiters(masked, "{", "}"),
    )
    starts = checker._line_starts(source)
    candidates = [item for item in declarations if item.name == simple_name]
    if not candidates:
        return None
    if "." in declaration:
        depth = declaration.count(".") - source.split("package ", 1)[-1].split(";", 1)[0].count(".")
        candidates.sort(key=lambda item: item.open_brace)
        chosen = candidates[-1] if depth > 0 else candidates[0]
    else:
        chosen = min(candidates, key=lambda item: item.open_brace)
    javadoc = checker._attached_javadoc(source, chosen.declaration_offset)
    span = checker._attached_javadoc_span(source, chosen.declaration_offset)
    if javadoc is None or span is None:
        return None
    start_line = line_number_of(starts, span[0])
    end_line = line_number_of(starts, max(span[1] - 1, span[0]))
    return {
        "kind": chosen.kind,
        "public": chosen.public,
        "declaration_offset": chosen.declaration_offset,
        "declaration_line": line_number_of(starts, chosen.declaration_offset),
        "name_offset": chosen.name_offset,
        "open_brace_line": line_number_of(starts, chosen.open_brace),
        "javadoc": javadoc,
        "javadoc_sha256": sha256_text(javadoc),
        "javadoc_lines": [start_line, end_line],
        "javadoc_span": [span[0], span[1]],
    }


def item_materials(
    checker: Any,
    queue_item: dict[str, Any],
    record: dict[str, Any],
    registry: Any,
    transforms: list[dict[str, Any]],
    transform_set: dict[str, Any],
    modules: dict[str, Any],
    item_id: str,
) -> dict[str, Any]:
    """为一条严格比较成立的候选组装完整复核材料。

    Args:
        checker: 规则实现模块。
        queue_item: 复核队列中的该条记录。
        record: 受控来源索引中对应记录。
        registry: 已加载的受控证据登记。
        transforms: 按执行顺序排列的已登记变换。
        transform_set: 受控变换集清单（含自述指纹）。
        modules: 模块与包根索引。
        item_id: 材料包内的条目编号。

    Returns:
        单条材料字典；不含任何判定字段。

    """

    local_path = str(queue_item["local_path"])
    declaration = str(queue_item["declaration"])
    local_raw = (REPO_ROOT / local_path).read_bytes()
    local_text = local_raw.decode("utf-8")
    upstream_raw, upstream_error = checker._upstream_bytes_for_contract(registry, record)
    problems: list[str] = []
    if upstream_error or upstream_raw is None:
        raise RuntimeError(f"{declaration}：上游比较输入不可得：{upstream_error}")
    upstream_text = upstream_raw.decode("utf-8-sig", errors="replace")

    local_stream = checker._code_identity_stream(local_text, transforms, "local")
    upstream_stream = checker._code_identity_stream(upstream_text, transforms, "upstream")
    equal = local_stream["serialized"] == upstream_stream["serialized"]

    local_tokens, _ = checker._code_identity_code_tokens(local_text)
    upstream_tokens, _ = checker._code_identity_code_tokens(upstream_text)

    attribution, coverage = build_attribution(checker, local_text, upstream_text, transforms)

    type_evidence = json.loads(str(record.get("type_evidence") or "{}"))
    types = type_evidence.get("types") or []
    type_entry = next(
        (entry for entry in types if str(entry.get("qualified_name")) == declaration),
        None,
    )
    if type_entry is None:
        problems.append(
            f"受控索引的逐类型映射中没有 {declaration} 的条目，无法取得逐类型绑定"
        )

    bindings: list[dict[str, Any]] = []
    binding_status: list[dict[str, Any]] = []
    resolved_type = declaration_javadoc(checker, local_text, declaration)
    if resolved_type is None:
        problems.append(
            f"{declaration}：按规则实现口径在该文件中找不到声明及其紧邻 JavaDoc，无法绑定逐类型 JavaDoc"
        )
    if type_entry is not None:
        start, end = (
            resolved_type["javadoc_lines"]
            if resolved_type is not None
            else (int(type_entry["javadoc_start_line"]), int(type_entry["javadoc_end_line"]))
        )
        declared_javadoc_sha = str(type_entry.get("javadoc_sha256") or "").lower()
        whole_javadoc = (
            resolved_type["javadoc"]
            if resolved_type is not None
            else "\n".join(local_text.split("\n")[start - 1 : end])
        )
        measured_javadoc_sha = (
            resolved_type["javadoc_sha256"] if resolved_type is not None else sha256_text(whole_javadoc)
        )
        javadoc_match = measured_javadoc_sha == declared_javadoc_sha
        if not javadoc_match:
            problems.append(
                f"{declaration}：受控索引登记的 javadoc_sha256 与本地实测不符"
                f"（记录 {declared_javadoc_sha}，实测 {measured_javadoc_sha}）"
            )
        if resolved_type is not None and [
            int(type_entry.get("javadoc_start_line") or 0),
            int(type_entry.get("javadoc_end_line") or 0),
        ] != [start, end]:
            problems.append(
                f"{declaration}：受控索引登记的 JavaDoc 行区间 "
                f"{[type_entry.get('javadoc_start_line'), type_entry.get('javadoc_end_line')]} "
                f"与规则实现口径实测 {resolved_type['javadoc_lines']} 不一致"
            )
        notes, note_errors = checker._parse_source_notes(whole_javadoc)
        for block in javadoc_blocks(local_text, start, end):
            role = block["role"]
            bindings.append(
                {
                    "role": role,
                    "lines": block["lines"],
                    "text": block["text"],
                    "sha256": block["sha256"],
                    "declaration": declaration,
                    "author_tag_lines": block["author_tag_lines"],
                }
            )
        binding_status = [
            {
                "role": "responsibility-javadoc",
                "present": True,
                "acceptance_beyond_code_identity": "未验收：代码同一只覆盖代码流；职责、参数、业务约束"
                "与生成器指令等注释的实际消费仍须复核方逐条核对（D16 §66）",
                "lines": [start, end],
            },
            {
                "role": "d12-source-note",
                "present": bool(notes),
                "acceptance_beyond_code_identity": (
                    f"未验收：索引当前判词为「{record.get('d12_verdict')}」；"
                    "来源说明本身的格式解析错误 " + (str(note_errors) if note_errors else "无")
                ),
                "parsed_notes": [
                    {
                        "repository": note.repository,
                        "commit": note.commit,
                        "upstream_path": note.upstream_path,
                        "basis": note.basis,
                        "local_modification": note.local_modification,
                        "javadoc_body_line": note.line,
                    }
                    for note in notes
                ],
            },
            {
                "role": "d15-inplace-marker",
                "present": any(
                    marker in whole_javadoc
                    for marker in (
                        checker.SOURCE_REVIEW_UNACCEPTED_MARKER,
                        checker.SOURCE_REVIEW_ACCEPTED_MARKER,
                        checker.SIGNATURE_REVIEW_UNACCEPTED_MARKER,
                        checker.SIGNATURE_REVIEW_ACCEPTED_MARKER,
                    )
                ),
                "acceptance_beyond_code_identity": "未验收：就地标注是验收状态的登记表字段，"
                "代码同一不改变其状态（D16 §86、D15）",
                "markers": [
                    marker
                    for marker in (
                        checker.SOURCE_REVIEW_UNACCEPTED_MARKER,
                        checker.SOURCE_REVIEW_ACCEPTED_MARKER,
                        checker.SIGNATURE_REVIEW_UNACCEPTED_MARKER,
                        checker.SIGNATURE_REVIEW_ACCEPTED_MARKER,
                    )
                    if marker in whole_javadoc
                ],
            },
        ]
    license_scan = local_license_scan(local_text, upstream_text)
    binding_status.append(
        {
            "role": "license-or-copyright",
            "present": license_scan["present_locally"] or license_scan["present_upstream"],
            "acceptance_beyond_code_identity": (
                "不适用：实测本地与上游都没有版权/许可证声明行；许可关联按索引登记的 LICENSE 指纹核对"
                f"（license_sha256={record.get('license_sha256')}，版权声明={record.get('license_copyright')}）"
            ),
            "scan": license_scan,
        }
    )

    author_scan = upstream_author_scan(upstream_text)
    form = str(queue_item.get("acceptance_form") or "")
    author_tag_lines = [
        {"line": number, "text": line.strip()}
        for number, line in enumerate(local_text.split("\n"), 1)
        if AUTHOR_TOKEN_PATTERN.search(line)
    ]

    open_questions = [
        f"受控索引登记的历史依据为「{record.get('history_basis')}」——历史引入版本仍属未核实，"
        "本材料只固定见证版本，不推断引入时间。",
        "上游固定提交之外的其他版本是否声明作者、是否存在其他贡献者：未核实"
        "（本材料只对快照内该固定提交的逐字节副本实测）。",
        f"索引 `open_gap` 原文登记的剩余缺口：{record.get('open_gap')}",
        "本条尚无独立复核方结论：D16 §114 要求由实施者之外的负责方逐条复核，"
        "本材料不代替该复核，也不改判任何字段。",
    ]
    if type_entry is not None and not bool(type_entry.get("upstream_author_declared")):
        if author_scan["author_declared"]:
            open_questions.append(
                "受控索引的逐类型映射登记 `upstream_author_declared=false`，但本材料对该固定提交文件的"
                "实测扫描命中作者声明，必须由复核方裁定登记值与实测的关系。"
            )
    if coverage["unexplained_blocks"]:
        open_questions.append(
            f"存在 {coverage['unexplained_blocks']} 处未能由已登记变换、空白或注释差异解释的差异块，"
            "在复核方判定前不得按“代码同一”处理。"
        )

    recorded = {
        "local_code_stream_sha256": str(queue_item.get("local_code_stream_sha256")),
        "upstream_code_stream_sha256": str(queue_item.get("upstream_code_stream_sha256")),
        "local_token_count": queue_item.get("local_token_count"),
        "upstream_token_count": queue_item.get("upstream_token_count"),
        "import_count_local": queue_item.get("import_count_local"),
        "import_count_upstream": queue_item.get("import_count_upstream"),
        "local_sha256": str(queue_item.get("local_sha256")),
        "upstream_sha256": str(queue_item.get("upstream_sha256")),
    }
    measured = {
        "local_code_stream_sha256": local_stream["sha256"],
        "upstream_code_stream_sha256": upstream_stream["sha256"],
        "local_token_count": local_stream["token_count"],
        "upstream_token_count": upstream_stream["token_count"],
        "import_count_local": local_stream["import_count"],
        "import_count_upstream": upstream_stream["import_count"],
        "local_sha256": sha256_bytes(local_raw),
        "upstream_sha256": sha256_bytes(upstream_raw),
    }
    drift = sorted(key for key in measured if recorded[key] != measured[key])
    if drift:
        problems.append(
            "复核队列登记读数与本轮实测不符：" + "、".join(f"{key}（登记 {recorded[key]}／实测 {measured[key]}）" for key in drift)
        )

    return {
        "item_id": item_id,
        "object": {
            "local_path": local_path,
            "declaration": declaration,
            "kind": (resolved_type or {}).get("kind") or (type_entry or {}).get("kind"),
            "public": (resolved_type or {}).get("public"),
            "nested": bool((type_entry or {}).get("nested")),
            "enclosing_type": (type_entry or {}).get("enclosing_type"),
            "declaration_line": (resolved_type or {}).get("declaration_line")
            or (type_entry or {}).get("declaration_line"),
            "open_brace_line": (resolved_type or {}).get("open_brace_line"),
            "javadoc_span_offsets": (resolved_type or {}).get("javadoc_span"),
            "javadoc_lines": [
                (resolved_type or {}).get("javadoc_lines", [None, None])[0]
                if resolved_type is not None
                else (type_entry or {}).get("javadoc_start_line"),
                (resolved_type or {}).get("javadoc_lines", [None, None])[1]
                if resolved_type is not None
                else (type_entry or {}).get("javadoc_end_line"),
            ],
            "javadoc_sha256_registered": (type_entry or {}).get("javadoc_sha256"),
            "javadoc_sha256_measured": measured_javadoc_sha if type_entry is not None else None,
            "javadoc_sha256_matches": javadoc_match if type_entry is not None else None,
            "javadoc_fingerprint_basis": "check_staged_java_comments._attached_javadoc 返回的偏移区间文本"
            "（首行不含缩进，其余行保留原文）；注释绑定的逐字原文另按行区间 join，供门禁逐字比对。",
            "public_type_count_in_file": record.get("public_type_count"),
            "module": module_of_path(local_path, modules),
            "types_in_file": [
                {
                    "qualified_name": entry.get("qualified_name"),
                    "kind": entry.get("kind"),
                    "nested": entry.get("nested"),
                    "enclosing_type": entry.get("enclosing_type"),
                    "upstream_type": entry.get("upstream_type"),
                    "mapping_basis": entry.get("mapping_basis"),
                }
                for entry in types
            ],
            "upstream": {
                "repo_url": record.get("upstream_repo_url"),
                "repo_id": record.get("upstream_repo_id"),
                "commit": record.get("upstream_commit"),
                "path": record.get("upstream_path"),
                "file_url": record.get("upstream_file_url"),
                "sha256": record.get("upstream_sha256"),
                "sha256_measured": sha256_bytes(upstream_raw),
                "snapshot_relative": str(
                    Path(
                        f"ruoyi-vue-pro@{record.get('upstream_commit')}",
                        str(record.get("upstream_path")),
                    ).as_posix()
                ),
            },
        },
        "index_current_state": {
            "note": "本条在受控索引中的**当前**判词字段，只抄录、不修改；材料生成后复核方可核对索引是否被改写。",
            "d12_verdict": record.get("d12_verdict"),
            "evidence_branch": record.get("evidence_branch"),
            "evidence_route": record.get("evidence_route"),
            "author_status": record.get("author_status"),
            "queue_current_d12_verdict": queue_item.get("current_d12_verdict"),
            "queue_current_evidence_branch": queue_item.get("current_evidence_branch"),
            "queue_review_status": queue_item.get("review_status"),
            "queue_verdict": queue_item.get("verdict"),
        },
        "strict_comparison": {
            "transform_set": {
                "path": relative(TRANSFORM_SET_PATH),
                "sha256": transform_set.get("file_sha256"),
                "transforms_sha256": transform_set.get("transforms_sha256"),
                "normalizations_sha256": transform_set.get("normalizations_sha256"),
                "rules_version": str(transform_set.get("rules_version")),
                "serialization": str(transform_set.get("serialization")),
                "definitions_ref": "#/inputs/transform_set（该处登记 N1 与 T1–T5 的逐字定义、适用范围与 pairs）",
            },
            "comparison_order": [str(item) for item in transform_set.get("comparison_order") or []],
            "applied_transforms": [str(item) for item in transform_set.get("execution_order") or []],
            "local_code_stream_sha256": local_stream["sha256"],
            "upstream_code_stream_sha256": upstream_stream["sha256"],
            "local_code_bytes": local_stream["bytes"],
            "upstream_code_bytes": upstream_stream["bytes"],
            "local_token_count": local_stream["token_count"],
            "upstream_token_count": upstream_stream["token_count"],
            "import_count_local": local_stream["import_count"],
            "import_count_upstream": upstream_stream["import_count"],
            "import_entries_local": import_entries(local_tokens),
            "import_entries_upstream": import_entries(upstream_tokens),
            "local_stream_errors": local_stream["errors"],
            "upstream_stream_errors": upstream_stream["errors"],
            "equal": bool(equal),
            "diff_count": 0 if equal else 1,
            "transform_occurrences_local": transform_occurrences(
                checker, local_text, transforms, "local"
            ),
            "transform_occurrences_upstream": transform_occurrences(
                checker, upstream_text, transforms, "upstream"
            ),
            "queue_reading_consistency": {
                "recorded": recorded,
                "measured": measured,
                "drift_fields": drift,
                "consistent": not drift,
            },
            "authority": "严格比较读数由 scripts/code/java/check_staged_java_comments.py 的 "
            "_code_identity_stream/_code_identity_code_tokens/_code_identity_serialize 产出，"
            "本工具不另写比较实现。",
        },
        "difference_attribution": attribution,
        "attribution_coverage": coverage,
        "comment_bindings": bindings,
        "comment_roles_acceptance": binding_status,
        "authorship": {
            "form": form,
            "form_meaning": {
                "作者标签": "本地 JavaDoc 保留 `@author` 姓名形态；上游是否声明作者需另行核实",
                "来源说明": "本地 JavaDoc 以 D12 格式写来源说明，不声称个人作者",
            }.get(form, "未知形态"),
            "index_author_status": record.get("author_status"),
            "index_author_reason": record.get("author_reason"),
            "index_upstream_author_lines": record.get("upstream_author_lines"),
            "index_upstream_author_scan_text": record.get("upstream_author_scan"),
            "local_author_tag_lines": author_tag_lines,
            "upstream_fixed_version": {
                "author_declared": author_scan["author_declared"],
                "measured": author_scan,
                "file_sha256": sha256_bytes(upstream_raw),
                "recompute_command": (
                    "python3 -B -X utf8 -c \"import re,hashlib,pathlib;"
                    f"p=pathlib.Path('{'docs/测试与可靠性/来源证据/上游快照/ruoyi-vue-pro@' + str(record.get('upstream_commit')) + '/' + str(record.get('upstream_path'))}');"
                    "t=p.read_text(encoding='utf-8');"
                    "print(hashlib.sha256(p.read_bytes()).hexdigest());"
                    "print([ (i,l.strip()) for i,l in enumerate(t.split(chr(10)),1)"
                    " if re.search(r'@author|作者\\s*[:：]|\\bauthor\\s*:', l, re.I) ])\""
                ),
                "conclusion": "已实测（快照内该固定提交的逐字节副本全文扫描）"
                if not author_scan["author_declared"]
                else "已实测：该固定提交文件内存在作者声明行，逐行见 measured.hits",
            },
            "upstream_other_versions": "未核实：本材料不对固定提交之外的任何上游版本作作者声明判断",
            "author_handling_draft": {
                "code_identity_accepts_signature": False,
                "declared_author_status": record.get("author_status"),
                "author_route": (
                    "作者标签形态：代码同一不验收现存姓名，须按 D10/D12 各自条件判定署名是否成立"
                    if form == "作者标签"
                    else "来源说明形态：须完整满足 D12 来源例外（上游该固定版本未声明作者 + D13 格式）"
                ),
                "note": "本字段为草案，未写入受控索引；实施方不得据此改判署名。",
            },
        },
        "contract_impact": contract_impact(local_path, local_text, modules),
        "reproduction": {
            "item_command": (
                reproduction_preamble()
                + f"python3 -B -X utf8 {GENERATOR_RELATIVE} --verify-item '{declaration}' --json"
            ),
            "gates": [
                reproduction_preamble()
                + "python3 -B -X utf8 scripts/code/java/check_staged_java_comments.py "
                "--validate-evidence-branches --json",
                reproduction_preamble()
                + "python3 -B -X utf8 scripts/code/java/check_full_java_comments.py --json",
                reproduction_preamble()
                + "python3 -B -X utf8 scripts/code/java/check_full_java_comments.py "
                "--maintenance --json",
            ],
            "note": "全部命令只读仓内快照与工作树，断网可跑；--verify-item 逐项复算本条并与本材料比对，"
            "任一读数不符即退出非零。",
        },
        "open_questions": open_questions,
        "material_problems": problems,
        "reviewer_decision": {
            "reviewer_verdict": None,
            "reviewer": None,
            "review_date": None,
            "review_reason": None,
        },
        "proposed_contract_draft": {
            "status": "草案：未写入受控索引，未改判任何字段；review.* 由复核方填写后才有意义",
            "schema": checker.CODE_IDENTITY_SCHEMA,
            "branch": checker.EVIDENCE_BRANCH_CODE_IDENTITY,
            "route": checker.CODE_IDENTITY_ROUTE,
            "rules_version": checker.CODE_IDENTITY_RULES_VERSION,
            "serialization": {
                "version": checker.CODE_IDENTITY_SERIALIZATION,
                "encoding": "utf-8",
                "token_separator": "U+001F",
                "token_terminator": "U+001E",
            },
            "transform_set": {
                "path": relative(TRANSFORM_SET_PATH),
                "sha256": transform_set.get("file_sha256"),
                "transforms_sha256": transform_set.get("transforms_sha256"),
                "normalizations_sha256": transform_set.get("normalizations_sha256"),
            },
            "applied_transforms": [str(item) for item in transform_set.get("execution_order") or []],
            "inputs": {
                "local": {"path": local_path, "sha256": sha256_bytes(local_raw)},
                "upstream": {
                    "repo_url": record.get("upstream_repo_url"),
                    "commit": record.get("upstream_commit"),
                    "path": record.get("upstream_path"),
                    "sha256": record.get("upstream_sha256"),
                    "file_url": record.get("upstream_file_url"),
                },
            },
            "comparison": {
                "equal": bool(equal),
                "diff_count": 0 if equal else 1,
                "local_code_stream_sha256": local_stream["sha256"],
                "upstream_code_stream_sha256": upstream_stream["sha256"],
                "local_code_bytes": local_stream["bytes"],
                "upstream_code_bytes": upstream_stream["bytes"],
                "local_token_count": local_stream["token_count"],
                "upstream_token_count": upstream_stream["token_count"],
                "import_count_local": local_stream["import_count"],
                "import_count_upstream": upstream_stream["import_count"],
            },
            "difference_attribution": [
                {
                    "cause": entry["cause"],
                    "rule": entry["rule"],
                    "local_lines": entry["local_lines"],
                    "upstream_lines": entry["upstream_lines"],
                    "changed_lines": entry["changed_lines"],
                }
                for entry in attribution
            ],
            "comment_bindings": [
                {
                    "role": entry["role"],
                    "lines": entry["lines"],
                    "text": entry["text"],
                    "sha256": entry["sha256"],
                }
                for entry in bindings
            ],
            "author_handling": {
                "code_identity_accepts_signature": False,
                "declared_author_status": record.get("author_status"),
                "author_route": (
                    "作者标签形态：代码同一不验收现存姓名，须按 D10/D12 各自条件判定"
                    if form == "作者标签"
                    else "来源说明形态：须完整满足 D12 来源例外与 D13 格式"
                ),
            },
            "tool": {
                "name": "check_staged_java_comments.py",
                "version": checker.CODE_IDENTITY_SCHEMA,
                "sha256": sha256_bytes(CHECKER_PATH.read_bytes()),
            },
            "review": {
                "implementer": IMPLEMENTER,
                "reviewer": None,
                "date": None,
                "conclusion": None,
            },
            "counter_evidence_conclusion": None,
        },
    }


# --------------------------------------------------------------------------
# 材料包（任务 1）
# --------------------------------------------------------------------------


def build_review_package() -> dict[str, Any]:
    """组装 42 条严格比较成立候选的逐条复核材料包。"""

    checker = load_checker()
    queue = read_json(QUEUE_PATH)
    index = read_json(INDEX_PATH)
    records = {str(record.get("local_path")): record for record in index["records"]}
    registry = checker.load_evidence_registry(INDEX_PATH, SNAPSHOT_DIR)
    transform_set = resolve_transform_set(checker)
    transforms = ordered_transforms(transform_set)
    modules = module_index()

    items: list[dict[str, Any]] = []
    for number, queue_item in enumerate(
        [item for item in queue["items"] if item.get("strict_compare_equal") is True], 1
    ):
        record = records.get(str(queue_item["local_path"]))
        if record is None:
            raise RuntimeError(f"受控索引没有记录：{queue_item['local_path']}")
        items.append(
            item_materials(
                checker,
                queue_item,
                record,
                registry,
                transforms,
                transform_set,
                modules,
                f"E1CI-{number:02d}",
            )
        )

    snapshot_summary = registry.snapshot_manifest or {}
    return {
        "schema": SCHEMA_REVIEW,
        "title": "D16 §114 逐条复核材料包（E1-code-identity 严格比较成立候选）",
        "notice": HEADER_NOTICE,
        "scope": {
            "queue": "docs/测试与可靠性/来源证据/代码同一性复核队列.json",
            "selected": "队列中 strict_compare_equal=true 的 42 条候选",
            "excluded": "队列中 strict_compare_equal=false 的 3 条（通配符导入 vs 显式导入）"
            "另见 docs/测试与可靠性/来源证据/代码同一性通配符导入扩展材料.md",
            "judgements_made": 0,
        },
        "generated_by": GENERATOR_RELATIVE,
        "generation_note": "本 JSON 不写入生成时间戳：材料必须能按整文件 SHA-256 逐次复算；"
        "生成时间记录在同名 Markdown 的首段。",
        "repository": {
            "root": str(REPO_ROOT),
            "head": git("rev-parse", "HEAD"),
            "branch": git("branch", "--show-current"),
            "python": sys.version.split()[0],
        },
        "inputs": {
            "queue": {
                "path": relative(QUEUE_PATH),
                "sha256": sha256_bytes(QUEUE_PATH.read_bytes()),
            },
            "source_index": {
                "path": relative(INDEX_PATH),
                "sha256": sha256_bytes(INDEX_PATH.read_bytes()),
                "records_sha256": str(index["manifest"].get("records_sha256")),
            },
            "transform_set": {
                "path": relative(TRANSFORM_SET_PATH),
                "sha256": transform_set.get("file_sha256"),
                "transforms_sha256": transform_set.get("transforms_sha256"),
                "normalizations_sha256": transform_set.get("normalizations_sha256"),
                "schema": str(transform_set.get("schema")),
                "branch": str(transform_set.get("branch")),
                "route": str(transform_set.get("route")),
                "rules_version": str(transform_set.get("rules_version")),
                "serialization": str(transform_set.get("serialization")),
                "execution_order": [str(item) for item in transform_set.get("execution_order") or []],
                "comparison_order": [str(item) for item in transform_set.get("comparison_order") or []],
                "normalizations": transform_set.get("normalizations"),
                "transforms": transform_set.get("transforms"),
            },
            "rule_implementation": {
                "path": relative(CHECKER_PATH),
                "sha256": sha256_bytes(CHECKER_PATH.read_bytes()),
            },
            "upstream_snapshot": {
                "root": relative(SNAPSHOT_DIR),
                "manifest_sha256": snapshot_summary.get("manifest_sha256"),
                "files": snapshot_summary.get("files"),
                "bytes": snapshot_summary.get("bytes"),
                "licenses": snapshot_summary.get("licenses"),
                "note": "清单逐条复算由规则实现的 verify_snapshot_manifest 完成；任一条不符即抛 EvidenceError。",
            },
            "maven_modules": modules,
        },
        "reproduction": {
            "gates": [
                reproduction_preamble() + "python3 -B -X utf8 -m pytest scripts/tests -q",
                reproduction_preamble()
                + "python3 -B -X utf8 scripts/workflow/run_checks.py --group docs --json",
                reproduction_preamble()
                + "python3 -B -X utf8 scripts/workflow/run_checks.py --group boundaries --json",
                reproduction_preamble()
                + "python3 -B -X utf8 scripts/code/java/check_staged_java_comments.py "
                "--validate-evidence-branches --json",
                reproduction_preamble()
                + "python3 -B -X utf8 scripts/code/java/check_full_java_comments.py --json",
                reproduction_preamble()
                + "python3 -B -X utf8 scripts/code/java/check_full_java_comments.py --maintenance --json",
            ],
            "item_command_template": reproduction_preamble()
            + f"python3 -B -X utf8 {GENERATOR_RELATIVE} --verify-item <限定名> --json",
            "snapshot_command": reproduction_preamble()
            + "python3 -B -X utf8 -c \"import sys;sys.path.insert(0,'scripts/code/java');"
            "import check_staged_java_comments as m;from pathlib import Path;"
            "p=Path('docs/测试与可靠性/来源证据/上游快照');"
            "print(m.verify_snapshot_manifest(p, m._load_snapshot_manifest(p)))\"",
        },
        "review_decision_table": {
            "notice": HEADER_NOTICE,
            "columns": [
                "item_id",
                "declaration",
                "local_path",
                "reviewer_verdict",
                "reviewer",
                "review_date",
                "review_reason",
            ],
            "allowed_verdicts": ["accept", "reject", "need-more"],
            "rows": [
                {
                    "item_id": item["item_id"],
                    "declaration": item["object"]["declaration"],
                    "local_path": item["object"]["local_path"],
                    "reviewer_verdict": None,
                    "reviewer": None,
                    "review_date": None,
                    "review_reason": None,
                }
                for item in items
            ],
        },
        "counts": {
            "items": len(items),
            "files": len({item["object"]["local_path"] for item in items}),
            "author_label_form": sum(1 for item in items if item["authorship"]["form"] == "作者标签"),
            "source_note_form": sum(1 for item in items if item["authorship"]["form"] == "来源说明"),
            "strict_equal": sum(1 for item in items if item["strict_comparison"]["equal"]),
            "attribution_covers_exactly": sum(
                1 for item in items if item["attribution_coverage"]["covers_exactly"]
            ),
            "unexplained_blocks": sum(
                item["attribution_coverage"]["unexplained_blocks"] for item in items
            ),
            "queue_reading_drift": sum(
                1 for item in items if not item["strict_comparison"]["queue_reading_consistency"]["consistent"]
            ),
            "material_problems": sum(1 for item in items if item["material_problems"]),
            "upstream_author_declared_in_fixed_version": sum(
                1 for item in items if item["authorship"]["upstream_fixed_version"]["author_declared"]
            ),
            "verdicts_filled_by_implementer": 0,
        },
        "items": items,
    }


# --------------------------------------------------------------------------
# 通配符导入扩展材料（任务 2）
# --------------------------------------------------------------------------


def compiler_configuration() -> dict[str, Any]:
    """从 POM 实际配置取证 Java 版本与编译器设置。

    Returns:
        根 POM 与各模块 POM 的指纹、`java.version`／`maven.compiler.release`／
        `maven-compiler-plugin` 版本的实际取值与固定方式。

    """

    namespace = "{http://maven.apache.org/POM/4.0.0}"
    poms: list[dict[str, Any]] = []

    def read(pom: Path) -> dict[str, Any]:
        """解析并登记一个 POM 的编译相关配置。"""

        raw = pom.read_bytes()
        root = ElementTree.fromstring(raw)
        properties = root.find(f"{namespace}properties")
        values: dict[str, str] = {}
        if properties is not None:
            for child in properties:
                values[child.tag.replace(namespace, "")] = (child.text or "").strip()
        compiler_plugin = root.find(
            f"{namespace}build/{namespace}plugins/{namespace}plugin[maven-compiler-plugin]"
        )
        plugin: dict[str, Any] = {}
        if compiler_plugin is not None:
            plugin = {
                "declared_in_pom": True,
                "group_id": (compiler_plugin.findtext(f"{namespace}groupId") or "").strip(),
                "artifact_id": (compiler_plugin.findtext(f"{namespace}artifactId") or "").strip(),
                "version": (compiler_plugin.findtext(f"{namespace}version") or "").strip(),
                "configuration": {
                    child.tag.replace(namespace, ""): (child.text or "").strip()
                    for child in compiler_plugin.find(f"{namespace}configuration") or []
                },
            }
        poms.append(
            {
                "path": relative(pom),
                "sha256": sha256_bytes(raw),
                "artifact_id": (root.findtext(f"{namespace}artifactId") or "").strip(),
                "packaging": (root.findtext(f"{namespace}packaging") or "jar").strip(),
                "properties": {
                    key: values[key]
                    for key in (
                        "java.version",
                        "maven.compiler.release",
                        "maven.compiler.source",
                        "maven.compiler.target",
                        "maven-compiler-plugin.version",
                        "maven-enforcer-plugin.version",
                    )
                    if key in values
                },
                "maven_compiler_plugin": plugin,
            }
        )
        return poms[-1]

    read(JAVA_WORKSPACE / "pom.xml")
    for pom in sorted(JAVA_WORKSPACE.glob("*/pom.xml")):
        read(pom)
    root_properties = poms[0]["properties"]
    return {
        "workspace": relative(JAVA_WORKSPACE),
        "poms": poms,
        "measured": {
            "java_version_property": root_properties.get("java.version"),
            "maven_compiler_release": root_properties.get("maven.compiler.release"),
            "maven_compiler_source": root_properties.get("maven.compiler.source"),
            "maven_compiler_target": root_properties.get("maven.compiler.target"),
            "maven_compiler_plugin_version": root_properties.get("maven-compiler-plugin.version"),
            "poms_overriding_compiler_settings": [
                item["path"]
                for item in poms[1:]
                if any(
                    key in item["properties"]
                    for key in ("java.version", "maven.compiler.release", "maven.compiler.source", "maven.compiler.target")
                )
            ],
        },
        "how_to_pin": [
            "固定方式 1（逐字节）：以本节每个 POM 的 path + sha256 为准，任何 POM 改动都会使本材料失效，"
            "复核方应重跑本工具而不是沿用本节读数。",
            "固定方式 2（属性口径）：根 POM 的 java.version 与 maven.compiler.release 属性逐字见 measured；"
            "maven-compiler-plugin 的版本与 configuration 见各条 maven_compiler_plugin。",
            "固定方式 3（实跑口径）：flock 串行执行 "
            + reproduction_preamble()
            + "cd 后端代码/basic-framework-boot && mvn -B -ntp -o help:evaluate "
            "-Dexpression=maven.compiler.release -q -DforceStdout；本轮是否实跑见 measured_runtime。",
        ],
        "measured_runtime": {
            "status": "未运行",
            "reason": "本轮未实跑 Maven；判定一律以 POM 逐字节指纹与属性取值为准，不以推测代替实测。",
            "command": "flock /home/weetion/桌面/kuangjia/.bf-local/mvn.lock bash -lc "
            "\"cd 后端代码/basic-framework-boot && mvn -B -ntp -o help:evaluate "
            "-Dexpression=maven.compiler.release -q -DforceStdout\"",
        },
    }


def jdk_type_index() -> dict[str, Any]:
    """从 JDK ``lib/src.zip`` 复算“包 → 顶层类型简单名”索引（离线证据）。

    通配符导入到底覆盖哪些类型，只有在固定了 JDK 版本之后才谈得上“等价”；本索引
    让“通配符实际可绑定的类型集合”成为**可复算**的事实，而不是推测。

    Returns:
        含包索引、``src.zip`` 指纹与条目数的字典；进程内缓存。

    """

    if _JDK_INDEX["value"] is not None:
        return _JDK_INDEX["value"]
    archive_path = JDK_SRC_ZIP
    packages: dict[str, set[str]] = {}
    total = 0
    with zipfile.ZipFile(archive_path) as archive:
        for name in archive.namelist():
            if not name.endswith(".java"):
                continue
            total += 1
            parts = name.split("/")
            if len(parts) < 2:
                continue
            package = ".".join(parts[1:-1])
            simple = parts[-1][: -len(".java")]
            packages.setdefault(package, set()).add(simple)
    index = {
        "source": str(archive_path),
        "source_sha256": sha256_bytes(archive_path.read_bytes()),
        "java_source_entries": total,
        "packages": len(packages),
        "index": {package: sorted(names) for package, names in packages.items()},
    }
    _JDK_INDEX["value"] = index
    return index


def jdk_package_types(package: str) -> list[str]:
    """返回某个 JDK 包在 ``src.zip`` 中登记的顶层类型简单名。"""

    return list(jdk_type_index()["index"].get(package, []))


def import_entries_with_lines(checker: Any, text: str) -> list[dict[str, Any]]:
    """从源码还原 import 条目及其行号、通配符形态与包名。"""

    tokens, _ = checker._code_identity_code_tokens(text)
    result: list[dict[str, Any]] = []
    index = 0
    total = len(tokens)
    while index < total:
        kind, token_text, line = tokens[index]
        previous_is_dot = index > 0 and tokens[index - 1][0] == "op" and tokens[index - 1][1] == "."
        if kind == "ident" and token_text == "import" and not previous_is_dot:
            parts: list[str] = []
            cursor = index
            static = False
            while cursor < total:
                if tokens[cursor][0] == "op" and tokens[cursor][1] == ";":
                    parts.append(";")
                    cursor += 1
                    break
                if tokens[cursor][1] == "static":
                    static = True
                parts.append(tokens[cursor][1])
                cursor += 1
            statement = join_import_parts(parts)
            payload = statement[len("import ") :].rstrip(";")
            result.append(
                {
                    "statement": statement,
                    "line": int(line),
                    "static": static,
                    "wildcard": payload.endswith(".*"),
                    "package": "" if static else payload.rsplit(".", 1)[0],
                    "simple_name": payload.rsplit(".", 1)[-1],
                }
            )
            index = cursor
            continue
        index += 1
    return result


def body_type_names(checker: Any, text: str) -> dict[str, list[int]]:
    """收集正文（非 import 语句）中出现的类型样简单名及行号。

    限定名 token 会按段拆开，使 ``ElementType.TYPE`` 同时贡献 ``ElementType``。
    该函数只做词法层统计，不做语义解析，能力边界在材料中如实说明。

    """

    tokens, _ = checker._code_identity_code_tokens(text)
    spans = checker._code_identity_import_spans(tokens)
    names: dict[str, list[int]] = {}
    for position, token in enumerate(tokens):
        if any(start <= position < end for start, end in spans):
            continue
        if token[0] == "ident":
            names.setdefault(token[1], []).append(int(token[2]))
        elif token[0] == "name":
            for segment in token[1].split("."):
                names.setdefault(segment, []).append(int(token[2]))
    return names


def import_correspondence(
    checker: Any, local_text: str, upstream_text: str, transforms: list[dict[str, Any]]
) -> dict[str, Any]:
    """逐条给出通配符导入与显式导入的对应关系，并用 JDK 类型索引核对集合。

    对每个上游通配符导入，按 JDK ``src.zip`` 列出该包真实存在的类型，取“正文实际
    使用且该包确实存在”的交集，得到通配符**实际可绑定**的类型集合，再与本地同包
    显式导入集合比较。这是集合层面的证据，**不是**编译器解析绑定证明。

    """

    local_entries = import_entries_with_lines(checker, local_text)
    upstream_entries = import_entries_with_lines(checker, upstream_text)
    local_names = body_type_names(checker, local_text)
    upstream_names = body_type_names(checker, upstream_text)
    local_packages = {
        item["package"] for item in local_entries if not item["static"] and not item["wildcard"]
    }
    rows: list[dict[str, Any]] = []
    for item in upstream_entries:
        mapped_statement = registered_line_mapping(item["statement"], transforms)
        if not item["wildcard"]:
            counterpart = next(
                (
                    candidate
                    for candidate in local_entries
                    if candidate["statement"] == item["statement"]
                ),
                None,
            )
            mapped_counterpart = next(
                (
                    candidate
                    for candidate in local_entries
                    if candidate["statement"] == mapped_statement
                ),
                None,
            )
            rows.append(
                {
                    "upstream": item,
                    "kind": "显式导入",
                    "upstream_statement_after_registered_mapping": mapped_statement,
                    "local_counterpart": counterpart,
                    "local_counterpart_mapped": mapped_counterpart,
                    "equivalent": counterpart is not None,
                    "equivalent_after_registered_mapping": mapped_counterpart is not None,
                    "note": "双方逐字相同的显式导入条目"
                    if counterpart is not None
                    else (
                        "上游条目按登记变换映射后与本地某条显式导入逐字相同"
                        if mapped_counterpart is not None
                        else "本地没有对应条目"
                    ),
                }
            )
            continue
        package = item["package"]
        package_types = set(jdk_package_types(package))
        package_in_index = bool(package_types)
        used_after = sorted(
            name
            for name, positions in upstream_names.items()
            if name[:1].isupper() and any(position > item["line"] for position in positions)
        )
        bound = sorted(set(used_after) & package_types) if package_in_index else []
        fabricated = sorted(set(used_after) - package_types) if package_in_index else []
        explicit_same_package = sorted(
            candidate["simple_name"]
            for candidate in local_entries
            if candidate["package"] == package
        )
        equivalent: bool | None
        if package_in_index:
            equivalent = set(bound) == set(explicit_same_package)
            equivalence_basis = (
                "通配符实际可绑定类型集合（正文使用的首字母大写简单名 ∩ 固定 JDK src.zip 中该包的顶层类型）"
                "与本地同包显式导入简单名集合逐项比较"
            )
        else:
            equivalent = None
            equivalence_basis = (
                "该通配符包不属于固定 JDK 的包索引（项目自身包），仓内上游快照只收录 186 个文件、"
                "不足以复算整包类型集合，因此集合等价性**未核实**，不做判定"
            )
        rows.append(
            {
                "upstream": item,
                "kind": "通配符导入",
                "package": package,
                "package_in_fixed_jdk_index": package_in_index,
                "jdk_package_type_count": len(package_types),
                "jdk_package_types": sorted(package_types),
                "upstream_body_names_after_import": used_after,
                "wildcard_actually_binds": bound,
                "body_names_not_in_that_package": fabricated,
                "local_explicit_same_package": explicit_same_package,
                "local_imports_from_package": [
                    candidate["statement"]
                    for candidate in local_entries
                    if candidate["package"] == package
                ],
                "bound_missing_on_local_side": sorted(set(bound) - set(explicit_same_package)),
                "local_explicit_not_bound_upstream": sorted(set(explicit_same_package) - set(bound)),
                "set_equivalent": equivalent,
                "equivalence_basis": equivalence_basis,
                "import_forms_identical": False,
            }
        )
    return {
        "jdk_index_evidence": {
            "source": jdk_type_index()["source"],
            "source_sha256": jdk_type_index()["source_sha256"],
            "java_source_entries": jdk_type_index()["java_source_entries"],
            "packages": jdk_type_index()["packages"],
        },
        "local_import_entries": local_entries,
        "upstream_import_entries": upstream_entries,
        "local_import_count": len(local_entries),
        "upstream_import_count": len(upstream_entries),
        "local_body_type_names": sorted(local_names),
        "upstream_body_type_names": sorted(upstream_names),
        "local_packages": sorted(local_packages),
        "rows": rows,
        "method": "词法还原 import 条目；通配符可绑定集合 = 正文使用的首字母大写简单名 ∩ JDK src.zip 中该包的顶层类型；"
        "与本地同包显式导入集合比较。该比较不解析类路径与静态成员绑定，也不替代 D16 §84 要求的解析绑定证明。",
    }


def candidate_rule_probe(
    checker: Any, local_text: str, upstream_text: str
) -> dict[str, Any]:
    """评估“把通配符归一化为显式导入”这条候选规则的三个变体。

    本函数**只用于评估候选规则**，其展开逻辑没有被登记进受控变换集，也没有任何门禁
    入口调用；它存在的唯一目的，是给出反例上各变体的可复算读数。

    Args:
        checker: 规则实现模块（只复用其词法与序列化函数）。
        local_text: 本地源码。
        upstream_text: 上游源码。

    Returns:
        三个变体的相等读数、展开结果与“虚构类型”证据。

    """

    def view(text: str) -> dict[str, Any]:
        """返回一侧的导入条目、正文简单名与展开结果。"""

        entries = import_entries_with_lines(checker, text)
        names = body_type_names(checker, text)
        uppercase = sorted(name for name in names if name[:1].isupper())
        expanded: list[dict[str, Any]] = []
        for entry in entries:
            if entry["wildcard"]:
                package_types = set(jdk_package_types(entry["package"]))
                expanded.append(
                    {
                        "from_wildcard": entry["package"],
                        "jdk_confirmed": sorted(set(uppercase) & package_types),
                        "assumed": uppercase,
                        "not_in_that_package": sorted(set(uppercase) - package_types),
                    }
                )
            else:
                expanded.append(
                    {
                        "explicit": entry["statement"],
                        "package": entry["package"],
                        "simple_name": entry["simple_name"],
                        "static": entry["static"],
                        "used_in_body": entry["simple_name"] in names,
                    }
                )
        return {"entries": entries, "uppercase_body_names": uppercase, "expanded": expanded}

    local_view = view(local_text)
    upstream_view = view(upstream_text)

    def qualified_set(view_result: dict[str, Any], drop_unused: bool) -> list[str]:
        """按“包 + 简单名”展开成集合；``drop_unused`` 打开时丢弃未使用的显式导入。"""

        result: list[str] = []
        for item in view_result["expanded"]:
            if "explicit" in item:
                if drop_unused and not item["used_in_body"]:
                    continue
                result.append(f"{item['package']}.{item['simple_name']}")
            else:
                result.extend(f"{item['from_wildcard']}.{name}" for name in item["jdk_confirmed"])
        return sorted(result)

    def simple_set(view_result: dict[str, Any], drop_unused: bool) -> list[str]:
        """只按简单名展开成集合（最宽松的变体）。"""

        result: list[str] = []
        for item in view_result["expanded"]:
            if "explicit" in item:
                if drop_unused and not item["used_in_body"]:
                    continue
                result.append(item["simple_name"])
            else:
                result.extend(item["assumed"])
        return sorted(result)

    local_stream = checker._code_identity_stream(local_text, [], "local")
    upstream_stream = checker._code_identity_stream(upstream_text, [], "upstream")
    fabrications = [
        {
            "side": side,
            "package": item["from_wildcard"],
            "assumed_types": item["not_in_that_package"],
        }
        for side, view_result in (("本地", local_view), ("上游", upstream_view))
        for item in view_result["expanded"]
        if "from_wildcard" in item and item["not_in_that_package"]
    ]
    return {
        "current_rule_equal": local_stream["serialized"] == upstream_stream["serialized"],
        "local_qualified_expanded": qualified_set(local_view, False),
        "upstream_qualified_expanded": qualified_set(upstream_view, False),
        "variant_expand_compare_qualified_equal": qualified_set(local_view, False)
        == qualified_set(upstream_view, False),
        "variant_expand_compare_simple_name_equal": simple_set(local_view, False)
        == simple_set(upstream_view, False),
        "variant_drop_unused_compare_qualified_equal": qualified_set(local_view, True)
        == qualified_set(upstream_view, True),
        "fabricated_imports": fabrications,
        "views": {"local": local_view, "upstream": upstream_view},
    }


def counter_examples(checker: Any) -> list[dict[str, Any]]:
    """构造“通配符归一化为显式导入”会放过哪些真实差异的反例。

    每个反例都给出最小 Java 源码，并同时给出**当前规则实现**与**候选规则三个变体**
    的实测读数。夹具不被任何门禁消费，也不改动任何真实源码。

    """

    fixtures: list[dict[str, Any]] = [
        {
            "id": "CE-1",
            "category": "未使用的导入",
            "name": "本地存在上游从未绑定的未使用显式导入",
            "question": "把通配符展开、并丢弃未使用导入之后，两侧会被判为相等吗？",
            "local": (
                "package p;\n\n"
                "import java.lang.annotation.Documented;\n"
                "import java.lang.annotation.Inherited;\n"
                "import java.lang.annotation.Retention;\n\n"
                "/** 本地：多出一条从未使用的导入。 */\n"
                "@Documented\n"
                "@Retention\n"
                "public class Demo {\n"
                "}\n"
            ),
            "upstream": (
                "package p;\n\n"
                "import java.lang.annotation.*;\n\n"
                "/** 上游：通配符，正文只用两种注解。 */\n"
                "@Documented\n"
                "@Retention\n"
                "public class Demo {\n"
                "}\n"
            ),
            "real_difference": "本地多出 `import java.lang.annotation.Inherited;` 且从未使用；"
            "上游的通配符并不绑定 `Inherited`（正文没有引用它）。"
            "“丢弃未使用导入后再比较”的变体会把这一真实文件差异判为相等。",
        },
        {
            "id": "CE-2",
            "category": "同名类型来自不同 import",
            "name": "双方简单名相同、限定包完全不同的显式导入",
            "question": "只按简单名集合比较的变体会不会放过这个差异？",
            "local": (
                "package p;\n\n"
                "import java.util.List;\n\n"
                "public class Demo {\n"
                "    List<String> value;\n"
                "}\n"
            ),
            "upstream": (
                "package p;\n\n"
                "import java.awt.List;\n\n"
                "public class Demo {\n"
                "    List<String> value;\n"
                "}\n"
            ),
            "real_difference": "`java.util.List` 与 `java.awt.List` 是两个不同的 JDK 类型（两者都真实存在）。"
            "只比较简单名 `List` 的变体会判为相等，从而丢掉“同名类型来自不同 import”这一真实差异；"
            "D16 §98 明确要求这类差异必须保留并拒绝。",
        },
        {
            "id": "CE-3",
            "category": "通配符集不等价",
            "name": "上游通配符声明的绑定面大于本地显式导入集合",
            "question": "展开后被判为相等，是否等于双方导入集合真的等价？",
            "local": (
                "package p;\n\n"
                "import java.lang.annotation.Documented;\n\n"
                "/** 本地：只绑定一种注解。 */\n"
                "@Documented\n"
                "public class Demo {\n"
                "}\n"
            ),
            "upstream": (
                "package p;\n\n"
                "import java.lang.annotation.*;\n\n"
                "/** 上游：通配符，声明了整包绑定面。 */\n"
                "@Documented\n"
                "public class Demo {\n"
                "}\n"
            ),
            "real_difference": "上游声明的是整包绑定面，本地只绑定一种类型；"
            "两者后续任何一方新增一个 `@Retention` 都会改变行为，但被归一化后的比较看不出这个差别。"
            "D16 §84 与 §98 都要求“通配符集不等即拒绝”，而不是展开后判等。",
        },
        {
            "id": "CE-4",
            "category": "展开会虚构不存在的类型",
            "name": "多个通配符导入会让“按正文简单名展开”生成不存在的类型",
            "question": "展开结果里有没有 JDK 中并不存在的类型？",
            "local": (
                "package p;\n\n"
                "import java.util.List;\n\n"
                "public class Demo {\n"
                "    List<String> value;\n"
                "}\n"
            ),
            "upstream": (
                "package p;\n\n"
                "import java.lang.annotation.*;\n"
                "import java.util.*;\n\n"
                "/** 上游：两个通配符。 */\n"
                "@Documented\n"
                "public class Demo {\n"
                "    List<String> value;\n"
                "}\n"
            ),
            "real_difference": "按“正文用到的每个大写简单名”展开 `java.lang.annotation.*` 会生成 "
            "`import java.lang.annotation.List;`——该类型在固定 JDK 的 `src.zip` 中并不存在。"
            "展开规则因此会**虚构**出无法解析的绑定，而 JDK 类型索引能把这一点机械证伪。",
        },
        {
            "id": "CE-5",
            "category": "静态成员导入",
            "name": "一侧静态成员导入、另一侧全限定名调用",
            "question": "各变体是否都保留这条差异？",
            "local": (
                "package p;\n\n"
                "import static java.util.Collections.emptyList;\n\n"
                "public class Demo {\n"
                "    java.util.List<String> value = emptyList();\n"
                "}\n"
            ),
            "upstream": (
                "package p;\n\n"
                "public class Demo {\n"
                "    java.util.List<String> value = java.util.Collections.emptyList();\n"
                "}\n"
            ),
            "real_difference": "D16 §T5 要求“静态属性、完整限定名和条目集合必须一致”。"
            "本反例用于确认：一旦任何变体选择忽略静态成员导入，这条差异就会被放过；"
            "当前规则与三个变体在本夹具上都保留该差异，可作为正向对照。",
        },
    ]
    results: list[dict[str, Any]] = []
    for fixture in fixtures:
        probe = candidate_rule_probe(checker, fixture["local"], fixture["upstream"])
        wrongly_accepting = [
            name
            for name, key in (
                ("展开后按限定名比较", "variant_expand_compare_qualified_equal"),
                ("展开后只按简单名比较", "variant_expand_compare_simple_name_equal"),
                ("丢弃未使用导入后按限定名比较", "variant_drop_unused_compare_qualified_equal"),
            )
            if probe[key]
        ]
        results.append(
            {
                "id": fixture["id"],
                "category": fixture["category"],
                "name": fixture["name"],
                "question": fixture["question"],
                "local_source": fixture["local"],
                "upstream_source": fixture["upstream"],
                "current_rule": {
                    "equal": probe["current_rule_equal"],
                    "note": "当前规则实现保留全部 import 条目并逐字节比较，形态不同即拒绝",
                },
                "candidate_variants": {
                    "expand_compare_qualified_equal": probe[
                        "variant_expand_compare_qualified_equal"
                    ],
                    "expand_compare_simple_name_equal": probe[
                        "variant_expand_compare_simple_name_equal"
                    ],
                    "drop_unused_compare_qualified_equal": probe[
                        "variant_drop_unused_compare_qualified_equal"
                    ],
                },
                "wrongly_accepting_variants": wrongly_accepting,
                "fabricated_imports": probe["fabricated_imports"],
                "real_difference": fixture["real_difference"],
                "conclusion": (
                    f"当前规则拒绝；候选变体「{'、'.join(wrongly_accepting)}」会放行"
                    if wrongly_accepting
                    else "当前规则与三个候选变体都保留该差异（可作为正向对照）"
                ),
            }
        )
    return results
def build_wildcard_package() -> dict[str, Any]:
    """组装 3 条通配符导入候选的 D16 §84 扩展材料。"""

    checker = load_checker()
    queue = read_json(QUEUE_PATH)
    index = read_json(INDEX_PATH)
    records = {str(record.get("local_path")): record for record in index["records"]}
    registry = checker.load_evidence_registry(INDEX_PATH, SNAPSHOT_DIR)
    transform_set = resolve_transform_set(checker)
    transforms = ordered_transforms(transform_set)

    rejected = list(queue.get("strict_compare_rejected_declarations") or [])
    items: list[dict[str, Any]] = []
    for number, entry in enumerate(rejected, 1):
        local_path = str(entry["local_path"])
        record = records.get(local_path)
        if record is None:
            raise RuntimeError(f"受控索引没有记录：{local_path}")
        local_text = (REPO_ROOT / local_path).read_text(encoding="utf-8")
        upstream_raw, upstream_error = checker._upstream_bytes_for_contract(registry, record)
        if upstream_error or upstream_raw is None:  # pragma: no cover - 防御
            raise RuntimeError(f"{local_path}：上游比较输入不可得：{upstream_error}")
        upstream_text = upstream_raw.decode("utf-8-sig", errors="replace")
        correspondence = import_correspondence(checker, local_text, upstream_text, transforms)
        probe = candidate_rule_probe(checker, local_text, upstream_text)
        local_stream = checker._code_identity_stream(local_text, transforms, "local")
        upstream_stream = checker._code_identity_stream(upstream_text, transforms, "upstream")
        wildcard_rows = [row for row in correspondence["rows"] if row["kind"] == "通配符导入"]
        items.append(
            {
                "item_id": f"WC-{number:02d}",
                "declaration": str(entry["declaration"]),
                "local_path": local_path,
                "upstream_path": record.get("upstream_path"),
                "upstream_sha256": record.get("upstream_sha256"),
                "index_d12_verdict": record.get("d12_verdict"),
                "current_rule_result": {
                    "equal": local_stream["serialized"] == upstream_stream["serialized"],
                    "first_difference": str(entry.get("first_difference")),
                    "local_import_count": local_stream["import_count"],
                    "upstream_import_count": upstream_stream["import_count"],
                    "local_code_stream_sha256": local_stream["sha256"],
                    "upstream_code_stream_sha256": upstream_stream["sha256"],
                },
                "import_correspondence": correspondence,
                "wildcard_rows": wildcard_rows,
                "sets_equivalent": (
                    None
                    if any(row.get("set_equivalent") is None for row in wildcard_rows)
                    else all(bool(row.get("set_equivalent")) for row in wildcard_rows)
                ),
                "import_forms_identical": False,
                "equivalence_note": "等价性按“通配符实际可绑定类型集合（正文使用的首字母大写简单名 ∩ JDK "
                "src.zip 中该包的顶层类型）vs 本地同包显式导入集合”机械比较；"
                "这是集合层面的证据，不等于双方解析到同一目标类型，"
                "D16 §84 要求的是逐类型解析绑定证明，本材料不提供该证明。",
                "candidate_rule_probe_on_this_item": {
                    key: probe[key]
                    for key in (
                        "variant_expand_compare_qualified_equal",
                        "variant_expand_compare_simple_name_equal",
                        "variant_drop_unused_compare_qualified_equal",
                    )
                },
                "candidate_rule_probe_qualified_sets": {
                    "local": probe["local_qualified_expanded"],
                    "upstream": probe["upstream_qualified_expanded"],
                },
                "fabricated_imports": probe["fabricated_imports"],
                "reproduction": {
                    "item_command": reproduction_preamble()
                    + f"python3 -B -X utf8 {GENERATOR_RELATIVE} --verify-wildcard --item "
                    f"'{entry['declaration']}' --json",
                    "gate_command": reproduction_preamble()
                    + "python3 -B -X utf8 scripts/code/java/check_full_java_comments.py --json",
                },
                "reviewer_decision": {
                    "reviewer_verdict": None,
                    "reviewer": None,
                    "review_date": None,
                    "review_reason": None,
                },
            }
        )

    examples = counter_examples(checker)
    return {
        "schema": SCHEMA_WILDCARD,
        "title": "D16 §84 通配符导入扩展材料（3 条严格比较拒绝对象）",
        "notice": HEADER_NOTICE
        + " 本文件只准备扩展路线所需的材料并提出**候选规则草案**，草案未实施、未登记进受控变换集，"
        "待裁决。",
        "ruling_reference": "裁决 D16 §84：本轮不批准“剥离全部 import”作为新分支规则；"
        "通配符与显式导入不能按当前 T5 直接同一化；若确需这种扩展，须另行固定 Java 版本和完整编译依赖，"
        "证明全部实际类型与静态成员引用的解析绑定对应，并提供未使用、冲突和同名类型反例，再形成明确的比较契约。",
        "generated_by": GENERATOR_RELATIVE,
        "generation_note": "本 JSON 不写入生成时间戳：材料必须能按整文件 SHA-256 逐次复算；"
        "生成时间记录在同名 Markdown 的首段。",
        "repository": {
            "root": str(REPO_ROOT),
            "head": git("rev-parse", "HEAD"),
            "branch": git("branch", "--show-current"),
        },
        "java_version_and_dependencies": compiler_configuration(),
        "items": items,
        "counter_examples": examples,
        "candidate_rule_draft": {
            "id": "T5-IMPORT-RESOLUTION-draft-1",
            "status": "待裁决（草案不实施）",
            "name": "导入解析绑定对应（候选扩展）",
            "direction": "both",
            "operation": "import-resolution-binding-map",
            "definition": (
                "仅当满足全部前置条件时，才允许把双方的 import 语句组替换为**逐类型解析绑定等价**的规范形式再比较："
                "(1) 双方 Java 版本与完整编译依赖已按本文件 `java_version_and_dependencies` 逐字节固定；"
                "(2) 对双方每个实际被引用的简单名，分别给出解析到的全限定名（类型引用与静态成员引用分别登记）；"
                "(3) 解析结果按登记的 T1/T2/T3 映射逐条对应，任何一方解析失败、未解析、"
                "依赖同包同名类型或依赖 import 顺序的情形一律拒绝；"
                "(4) 替换后双方仍必须保留各自全部 import 条目，并在比较报告中登记替换前后原文与发生点；"
                "(5) 规范形式只是比较的中间表示，双方各自仍要独立登记 import 条目集合与静态成员导入。"
            ),
            "scope": (
                "代码流中的 import 语句组与静态成员导入；不删除条目、不合并包、不放宽 T2/T3 的逐条登记要求。"
            ),
            "preconditions": [
                "D16 §84 的三项前置：固定 Java 版本与完整编译依赖、证明解析绑定对应、提供未使用/冲突/同名类型反例。",
                "反例矩阵必须先以真实 CLI 跑通：合法正例通过，CE-1 至 CE-4 各自失败。",
                "受控变换集必须新增并登记该操作，同时同步 transforms_sha256 与记录侧绑定。",
            ],
            "risks": [
                {
                    "id": "R1",
                    "risk": "解析绑定依赖编译器与类路径，单凭文本分析无法证明；本文件的集合等价比较只覆盖简单名层面。",
                    "evidence": "items[].equivalence_note",
                },
                {
                    "id": "R2",
                    "risk": "展开通配符会抹平“未使用导入”“同名不同包”“静态成员导入 vs 全限定名”三类真实差异。",
                    "evidence": "counter_examples CE-1、CE-2、CE-4 的 candidate_rule_probe.equal=true",
                },
                {
                    "id": "R3",
                    "risk": "平台迁移（javax→jakarta）在通配符形态下没有逐类型绑定，可能把未登记的迁移当作合法适配。",
                    "evidence": "counter_examples CE-3",
                },
                {
                    "id": "R4",
                    "risk": "Java 版本或依赖变化会让解析结果改变，而材料本身不随 POM 自动失效，除非绑定 POM 指纹。",
                    "evidence": "java_version_and_dependencies.how_to_pin",
                },
                {
                    "id": "R5",
                    "risk": "即便解析绑定等价，import 形态差异本身仍可能承载作者风格差异；放宽比较范围需要独立裁决。",
                    "evidence": "裁决 D16 §84「单独编译成功不证明双方解析到同一目标」",
                },
            ],
            "decision_columns": {
                "reviewer_verdict": None,
                "reviewer": None,
                "review_date": None,
                "review_reason": None,
            },
        },
        "counts": {
            "items": len(items),
            "sets_equivalent": sum(1 for item in items if item["sets_equivalent"] is True),
            "sets_equivalence_unknown": sum(
                1 for item in items if item["sets_equivalent"] is None
            ),
            "import_forms_identical": 0,
            "counter_examples": len(examples),
            "counter_examples_accepted_by_a_candidate_variant": sum(
                1 for item in examples if item["wrongly_accepting_variants"]
            ),
            "fabricated_imports_detected": sum(
                len(item["fabricated_imports"]) for item in examples
            ),
        },
        "open_questions": [
            "三条对象的实际解析绑定证明尚未取得：需要固定类路径并逐类型给出解析目标，"
            "本轮未实跑 javac 解析（java_version_and_dependencies.measured_runtime.status="
            + str(compiler_configuration()["measured_runtime"]["status"])
            + "），因此本材料只给集合层面的机械证据。",
            f"D16 §84 要求的“未使用／冲突／同名类型反例”已构造 {len(examples)} 条最小夹具："
            f"当前规则实现对 {len(examples)} 条全部拒绝，其中 "
            f"{sum(1 for example in examples if example['wrongly_accepting_variants'])} 条会被至少一个"
            "候选变体放行、"
            f"{sum(len(example['fabricated_imports']) for example in examples)} 处展开会虚构出 JDK 中"
            "并不存在的类型；是否据此裁决该扩展仍属有权者事项。",
            "BasicFrameworkRateLimiterConfiguration 的通配符包是项目自身包（"
            "cn.iocoder.yudao.framework.ratelimiter.core.keyresolver.impl），"
            "仓内上游快照只收录 186 个文件，不足以复算整包类型集合，其集合等价性记为未核实；"
            "要闭合该缺口需要补齐上游该包的文件或改用编译期解析证据。",
            "候选规则未登记进受控变换集，也没有任何门禁入口消费；三个 Java 源文件内容未改动。",
        ],
        "review_decision_table": {
            "notice": HEADER_NOTICE,
            "columns": [
                "item_id",
                "declaration",
                "sets_equivalent",
                "reviewer_verdict",
                "reviewer",
                "review_date",
                "review_reason",
            ],
            "allowed_verdicts": ["accept", "reject", "need-more"],
            "rows": [
                {
                    "item_id": item["item_id"],
                    "declaration": item["declaration"],
                    "sets_equivalent": item["sets_equivalent"],
                    "reviewer_verdict": None,
                    "reviewer": None,
                    "review_date": None,
                    "review_reason": None,
                }
                for item in items
            ],
        },
    }


# --------------------------------------------------------------------------
# 人读 Markdown
# --------------------------------------------------------------------------


def render_review_markdown(package: dict[str, Any]) -> str:
    """把复核材料包渲染成人读 Markdown。"""

    lines: list[str] = []
    lines.append("---")
    description = (
        "D16 §114 逐条复核材料包：42 条严格比较成立候选的对象标识、严格比较读数、"
        "逐行差异归因、注释逐字原文与指纹、作者与来源事实、契约影响标记、"
        "复现命令与未解决问题；判定列留空待独立复核方填写。"
    )
    lines.append(f'description: "{description}"')
    lines.append("kind: package-reference")
    lines.append("---")
    lines.append("")
    lines.append("# D16 §114 逐条复核材料包（E1-code-identity 严格比较成立候选）")
    lines.append("")
    lines.append("## 摘要")
    lines.append("")
    lines.append(
        f"> **{package['notice']}**"
    )
    lines.append("")
    lines.append(
        f"生成时间（UTC）：{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}；"
        f"生成器 `{GENERATOR_RELATIVE}`；仓库 HEAD `{package['repository']['head']}`。"
    )
    lines.append("")
    counts = package["counts"]
    lines.append(
        f"本包覆盖复核队列中严格比较成立的 **{counts['items']}** 条候选"
        f"（{counts['files']} 个文件），其中作者标签形态 {counts['author_label_form']} 条、"
        f"来源说明形态 {counts['source_note_form']} 条。逐条差异归因**恰好覆盖**实测差异行的条目为 "
        f"{counts['attribution_covers_exactly']} 条；未能解释的差异块合计 "
        f"{counts['unexplained_blocks']} 处；复核队列登记读数与本轮实测不一致的条目 "
        f"{counts['queue_reading_drift']} 条；实施方填写的判定数 **0**。"
    )
    lines.append("")
    lines.append("机器可读版本：[代码同一性逐条复核材料.json](代码同一性逐条复核材料.json)。")
    lines.append("")
    lines.append("## 目录")
    lines.append("")
    lines.append("- [共同输入与固定值](#共同输入与固定值)")
    lines.append("- [复现命令](#复现命令)")
    lines.append("- [逐条材料](#逐条材料)")
    lines.append("- [复核判定表（留空）](#复核判定表留空)")
    lines.append("")
    lines.append("## 共同输入与固定值")
    lines.append("")
    lines.append("| 输入 | 路径 | 指纹 |")
    lines.append("| --- | --- | --- |")
    inputs = package["inputs"]
    lines.append(f"| 复核队列 | `{inputs['queue']['path']}` | `{inputs['queue']['sha256']}` |")
    lines.append(
        f"| 受控来源索引 | `{inputs['source_index']['path']}` | `{inputs['source_index']['sha256']}` |"
    )
    transform_set = inputs["transform_set"]
    lines.append(
        f"| 代码同一性变换集 | `{transform_set['path']}` | 整文件 `{transform_set['sha256']}`；"
        f"transforms `{transform_set['transforms_sha256']}`；normalizations `{transform_set['normalizations_sha256']}` |"
    )
    lines.append(
        f"| 规则实现 | `{inputs['rule_implementation']['path']}` | "
        f"`{inputs['rule_implementation']['sha256']}` |"
    )
    snapshot = inputs["upstream_snapshot"]
    lines.append(
        f"| 上游快照清单 | `{inputs['upstream_snapshot']['root']}/上游快照清单.json` | "
        f"`{snapshot['manifest_sha256']}`；{snapshot['files']} 条 / {snapshot['bytes']} 字节 / "
        f"{snapshot['licenses']} 份许可证 |"
    )
    lines.append("")
    lines.append(
        f"规则版本 `{transform_set['rules_version']}`，规范序列化 `{transform_set['serialization']}`，"
        f"比较顺序 `{' → '.join(transform_set['comparison_order'])}`。"
    )
    lines.append("")
    lines.append("### 变换集精确定义（N1 + T1–T5）")
    lines.append("")
    for normalization in transform_set["normalizations"] or []:
        lines.append(
            f"- **{normalization['id']} {normalization['name']}**（方向 {normalization['direction']}）："
            f"{normalization['definition']} 适用范围：{normalization['scope']}"
        )
    for transform in transform_set["transforms"] or []:
        lines.append(
            f"- **{transform['id']} {transform['name']}**（方向 {transform['direction']}，"
            f"操作 `{transform['operation']}`，登记 {len(transform.get('pairs') or [])} 对）："
            f"{transform['definition']} 适用范围：{transform['scope']}"
        )
        for pair in transform.get("pairs") or []:
            lines.append(f"  - `{pair[0]}` → `{pair[1]}`")
    lines.append("")
    lines.append("## 复现命令")
    lines.append("")
    lines.append("以下命令全部只读仓内快照与工作树，断网可跑：")
    lines.append("")
    lines.append("```bash")
    for command in package["reproduction"]["gates"]:
        lines.append(command)
        lines.append("echo \"exit=$?\"")
    lines.append(package["reproduction"]["item_command_template"])
    lines.append(package["reproduction"]["snapshot_command"])
    lines.append("```")
    lines.append("")
    lines.append("## 逐条材料")
    lines.append("")
    for item in package["items"]:
        obj = item["object"]
        strict = item["strict_comparison"]
        lines.append(f"### {item['item_id']} {obj['declaration']}")
        lines.append("")
        lines.append("**1. 对象标识**")
        lines.append("")
        lines.append(f"- 本地文件：`{obj['local_path']}`")
        module = obj["module"]
        lines.append(
            f"- 类型：`{obj['declaration']}`（{obj['kind']}，"
            f"嵌套类型：{'是，外层 ' + str(obj['enclosing_type']) if obj['nested'] else '否'}），"
            f"声明第 {obj['declaration_line']} 行，JavaDoc 第 {obj['javadoc_lines'][0]}–{obj['javadoc_lines'][1]} 行"
        )
        lines.append(
            f"- 所属模块：`{module.get('artifact_id')}`（POM `{module.get('pom')}`，"
            f"POM SHA-256 `{module.get('pom_sha256')}`）"
        )
        lines.append(
            f"- 同文件声明类型：{'；'.join(str(entry['qualified_name']) for entry in obj['types_in_file'])}"
        )
        lines.append(
            f"- 上游固定输入：`{obj['upstream']['repo_id']}@{obj['upstream']['commit']}` 的 "
            f"`{obj['upstream']['path']}`，登记指纹 `{obj['upstream']['sha256']}`，"
            f"本轮实测 `{obj['upstream']['sha256_measured']}`"
        )
        lines.append(
            f"- 逐类型 JavaDoc 指纹：登记 `{obj['javadoc_sha256_registered']}`，"
            f"实测 `{obj['javadoc_sha256_measured']}`，一致：{obj['javadoc_sha256_matches']}"
        )
        lines.append("")
        lines.append("**2. 严格比较证据**")
        lines.append("")
        lines.append(
            f"- 变换集：`{strict['transform_set']['path']}`，规则版本 "
            f"`{strict['transform_set']['rules_version']}`，序列化 `{strict['transform_set']['serialization']}`"
        )
        lines.append(
            f"- 三项指纹：整文件 `{strict['transform_set']['sha256']}`；transforms "
            f"`{strict['transform_set']['transforms_sha256']}`；normalizations "
            f"`{strict['transform_set']['normalizations_sha256']}`"
        )
        lines.append(f"- 定义位置：`{strict['transform_set']['definitions_ref']}`")
        lines.append(f"- 执行顺序：`{' → '.join(strict['applied_transforms'])}`")
        lines.append(
            f"- 本地代码流 SHA-256 `{strict['local_code_stream_sha256']}`"
            f"（{strict['local_code_bytes']} 字节 / {strict['local_token_count']} token / "
            f"{strict['import_count_local']} 条 import）"
        )
        lines.append(
            f"- 上游代码流 SHA-256 `{strict['upstream_code_stream_sha256']}`"
            f"（{strict['upstream_code_bytes']} 字节 / {strict['upstream_token_count']} token / "
            f"{strict['import_count_upstream']} 条 import）"
        )
        lines.append(f"- 比较结果：{'相等' if strict['equal'] else '不相等'}，diff_count={strict['diff_count']}")
        lines.append(
            "- 队列登记读数与本轮实测一致："
            f"{strict['queue_reading_consistency']['consistent']}"
            + (
                "（不符字段：" + "、".join(strict["queue_reading_consistency"]["drift_fields"]) + "）"
                if strict["queue_reading_consistency"]["drift_fields"]
                else ""
            )
        )
        lines.append("- 变换实际发生点：")
        for side_key, side_label in (
            ("transform_occurrences_local", "本地"),
            ("transform_occurrences_upstream", "上游"),
        ):
            for occurrence in strict[side_key]:
                if not occurrence["applied_on_this_side"]:
                    lines.append(f"  - {side_label} {occurrence['rule']}：方向不适用，未执行")
                elif occurrence["operation"] == "import-group-canonical-sort":
                    lines.append(
                        f"  - {side_label} {occurrence['rule']}：确定性排序，字节序变化="
                        f"{occurrence['stream_reordered']}，条目数 {len(occurrence['import_entries_before'])} → "
                        f"{len(occurrence['import_entries_after'])}"
                    )
                else:
                    points = occurrence["points"]
                    preview = "；".join(
                        f"第 {point['token_index']} token（第 {point['line']} 行）`{point['before']}`→`{point['after']}`"
                        for point in points[:6]
                    )
                    lines.append(
                        f"  - {side_label} {occurrence['rule']}：改写 {occurrence['rewritten_token_count']} 个 token"
                        + (f"（{preview}{'…' if len(points) > 6 else ''}）" if points else "")
                    )
        lines.append("")
        coverage = item["attribution_coverage"]
        lines.append("**3. 原始差异逐行归因**")
        lines.append("")
        lines.append(
            f"实测差异行：本地 {coverage['measured_local_lines']} 行 / 上游 "
            f"{coverage['measured_upstream_lines']} 行；归因合计：本地 "
            f"{coverage['attributed_local_lines']} 行 / 上游 {coverage['attributed_upstream_lines']} 行；"
            f"恰好覆盖：{coverage['covers_exactly']}；归因块 {coverage['attribution_block_count']} 处，"
            f"其中未能解释 {coverage['unexplained_blocks']} 处。"
        )
        lines.append("")
        lines.append("| # | cause | rule | 本地行 | 上游行 | 本地原文 | 上游原文 |")
        lines.append("| --- | --- | --- | --- | --- | --- | --- |")
        for number, entry in enumerate(item["difference_attribution"], 1):
            lines.append(
                f"| {number} | {entry['cause']} | {entry['rule']} | "
                f"{entry['local_lines'][0]}–{entry['local_lines'][1]} | "
                f"{entry['upstream_lines'][0]}–{entry['upstream_lines'][1]} | "
                f"{entry['local_text'].replace('|', '\\|')} | {entry['upstream_text'].replace('|', '\\|')} |"
            )
        lines.append("")
        lines.append("**4. 注释绑定证据（逐字原文与指纹）**")
        lines.append("")
        for binding in item["comment_bindings"]:
            lines.append(
                f"- `{binding['role']}` 第 {binding['lines'][0]}–{binding['lines'][1]} 行，"
                f"SHA-256 `{binding['sha256']}`"
                + (f"，作者标签行 {binding['author_tag_lines']}" if binding["author_tag_lines"] else "")
            )
            lines.append("")
            lines.append("```java")
            lines.append(binding["text"])
            lines.append("```")
        for status in item["comment_roles_acceptance"]:
            lines.append(
                f"- 角色 `{status['role']}`：存在={status['present']}；"
                f"“代码同一”之外的验收状态：{status['acceptance_beyond_code_identity']}"
            )
        lines.append("")
        authorship = item["authorship"]
        lines.append("**5. 署名与作者处理**")
        lines.append("")
        lines.append(f"- 形态：**{authorship['form']}**（{authorship['form_meaning']}）")
        lines.append(f"- 索引登记 `author_status`：`{authorship['index_author_status']}`")
        lines.append(f"- 索引登记 `author_reason`：{authorship['index_author_reason']}")
        lines.append(
            f"- 索引登记 `upstream_author_lines`：`{authorship['index_upstream_author_lines']}`"
        )
        lines.append(
            f"- 上游固定版本是否声明作者：**"
            f"{'是' if authorship['upstream_fixed_version']['author_declared'] else '否'}**；"
            f"{authorship['upstream_fixed_version']['conclusion']}；扫描命中 "
            f"{authorship['upstream_fixed_version']['measured']['hit_count']} 行"
        )
        if authorship["upstream_fixed_version"]["measured"]["hits"]:
            for hit in authorship["upstream_fixed_version"]["measured"]["hits"]:
                lines.append(f"  - 第 {hit['line']} 行：`{hit['text']}`")
        lines.append(f"- 上游其他版本：**{authorship['upstream_other_versions']}**")
        lines.append(
            f"- 本地作者标签行：" + (
                "；".join(f"第 {line['line']} 行 `{line['text']}`" for line in authorship["local_author_tag_lines"])
                or "无"
            )
        )
        lines.append(
            f"- `author_handling` 草案：`code_identity_accepts_signature="
            f"{str(authorship['author_handling_draft']['code_identity_accepts_signature']).lower()}`，"
            f"`declared_author_status={authorship['author_handling_draft']['declared_author_status']}`，"
            f"`author_route={authorship['author_handling_draft']['author_route']}`"
        )
        lines.append("")
        lines.append("**6. 契约影响评估（机械命中位置，非结论）**")
        lines.append("")
        lines.append("| 契约 | 命中 | 具体位置 | 权威核对命令 |")
        lines.append("| --- | --- | --- | --- |")
        for entry in item["contract_impact"]:
            if entry["contract_id"] == "direction":
                positions = "；".join(
                    f"第 {hit['line']} 行 {hit['import']} → {hit['target_module']}"
                    for hit in entry["cross_module_imports"]
                )
            else:
                positions = "；".join(
                    f"第 {hit['line']} 行 `{hit['marker']}` {hit['text']}" for hit in entry["markers"][:6]
                )
                if entry["marker_hit_count"] > 6:
                    positions += f"…（共 {entry['marker_hit_count']} 处）"
            lines.append(
                f"| {entry['contract']} | {'是' if entry['hit'] else '否'} | "
                f"{positions or entry['detail']} | `{entry['verify_command']}` |"
            )
        lines.append("")
        lines.append("**7. 可供判定的复现命令**")
        lines.append("")
        lines.append("```bash")
        lines.append(item["reproduction"]["item_command"])
        lines.append("```")
        lines.append("")
        lines.append("**8. 未解决问题**")
        lines.append("")
        for question in item["open_questions"]:
            lines.append(f"- {question}")
        if item["material_problems"]:
            for problem in item["material_problems"]:
                lines.append(f"- **材料自身问题**：{problem}")
        lines.append("")
        lines.append(
            f"**复核判定（留空待独立复核方填写）**：reviewer_verdict = _空_ ／ reviewer = _空_ ／ "
            f"review_date = _空_ ／ review_reason = _空_"
        )
        lines.append("")
    lines.append("## 复核判定表（留空）")
    lines.append("")
    lines.append(f"> {package['review_decision_table']['notice']}")
    lines.append("")
    lines.append("| item_id | declaration | reviewer_verdict | reviewer | review_date | review_reason |")
    lines.append("| --- | --- | --- | --- | --- | --- |")
    for row in package["review_decision_table"]["rows"]:
        lines.append(
            f"| {row['item_id']} | `{row['declaration']}` |  |  |  |  |"
        )
    lines.append("")
    return "\n".join(lines) + "\n"


def render_wildcard_markdown(package: dict[str, Any]) -> str:
    """把通配符导入扩展材料渲染成人读 Markdown。"""

    lines: list[str] = []
    lines.append("---")
    wildcard_description = (
        "D16 §84 通配符导入扩展材料：Java 版本与编译依赖的逐字节固定、3 条对象的导入集合"
        "逐条对应、未使用/冲突/同名类型反例实测，以及标注为待裁决的候选规则草案。"
    )
    lines.append(f'description: "{wildcard_description}"')
    lines.append("kind: package-reference")
    lines.append("---")
    lines.append("")
    lines.append("# D16 §84 通配符导入扩展材料（3 条严格比较拒绝对象）")
    lines.append("")
    lines.append("## 摘要")
    lines.append("")
    lines.append(f"> **{package['notice']}**")
    lines.append("")
    lines.append(
        f"生成时间（UTC）：{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}；"
        f"生成器 `{GENERATOR_RELATIVE}`；仓库 HEAD `{package['repository']['head']}`。"
    )
    lines.append("")
    lines.append(f"> 裁决依据：{package['ruling_reference']}")
    lines.append("")
    counts = package["counts"]
    lines.append(
        f"本文件覆盖 {counts['items']} 条因通配符导入 vs 显式导入被严格比较拒绝的对象；"
        f"机械比较下导入集合等价 {counts['sets_equivalent']} 条、"
        f"因通配符包不在固定 JDK 索引内而**未核实** {counts['sets_equivalence_unknown']} 条；"
        f"反例夹具 {counts['counter_examples']} 条，其中被某个候选变体放行的 "
        f"{counts['counter_examples_accepted_by_a_candidate_variant']} 条；"
        f"候选展开规则虚构出的不存在的类型 {counts['fabricated_imports_detected']} 处。"
    )
    lines.append("")
    lines.append("机器可读版本：[代码同一性通配符导入扩展材料.json](代码同一性通配符导入扩展材料.json)。")
    lines.append("")
    lines.append("## Java 版本与编译依赖的固定方式")
    lines.append("")
    compiler = package["java_version_and_dependencies"]
    measured = compiler["measured"]
    lines.append("| 项 | 实测取值 |")
    lines.append("| --- | --- |")
    lines.append(f"| 工作区 | `{compiler['workspace']}` |")
    lines.append(f"| `java.version` | `{measured['java_version_property']}` |")
    lines.append(f"| `maven.compiler.release` | `{measured['maven_compiler_release']}` |")
    lines.append(f"| `maven.compiler.source` | `{measured['maven_compiler_source']}` |")
    lines.append(f"| `maven.compiler.target` | `{measured['maven_compiler_target']}` |")
    lines.append(f"| `maven-compiler-plugin` 版本 | `{measured['maven_compiler_plugin_version']}` |")
    lines.append(
        f"| 覆盖编译设置的子模块 POM | "
        f"{'、'.join(compiler['measured']['poms_overriding_compiler_settings']) or '无'} |"
    )
    lines.append("")
    lines.append("| POM | 指纹 |")
    lines.append("| --- | --- |")
    for pom in compiler["poms"]:
        lines.append(f"| `{pom['path']}` | `{pom['sha256']}` |")
    lines.append("")
    lines.append("固定方式：")
    lines.append("")
    for line in compiler["how_to_pin"]:
        lines.append(f"- {line}")
    lines.append("")
    lines.append(
        f"**Maven 实跑状态**：{compiler['measured_runtime']['status']}——"
        f"{compiler['measured_runtime']['reason']} 命令："
        f"`{compiler['measured_runtime']['command']}`"
    )
    lines.append("")
    lines.append("## 3 条对象的导入集合逐条对应")
    lines.append("")
    first_item = package["items"][0] if package["items"] else None
    if first_item:
        jdk_evidence = first_item["import_correspondence"]["jdk_index_evidence"]
        lines.append(
            f"JDK 类型索引取自 `{jdk_evidence['source']}`（SHA-256 `{jdk_evidence['source_sha256']}`，"
            f"{jdk_evidence['java_source_entries']} 个 `.java` 条目、{jdk_evidence['packages']} 个包），"
            "用于机械判定“通配符实际可绑定哪些类型”。"
        )
        lines.append("")
    for item in package["items"]:
        jdk_evidence = item["import_correspondence"]["jdk_index_evidence"]
        lines.append(f"### {item['item_id']} {item['declaration']}")
        lines.append("")
        lines.append(f"- 本地：`{item['local_path']}`")
        lines.append(f"- 上游：`{item['upstream_path']}`（SHA-256 `{item['upstream_sha256']}`）")
        result = item["current_rule_result"]
        lines.append(
            f"- 当前规则结果：{'相等' if result['equal'] else '不相等'}；第一处差异：{result['first_difference']}"
        )
        lines.append(
            f"- import 条目数：本地 {result['local_import_count']} / 上游 {result['upstream_import_count']}"
        )
        lines.append("")
        lines.append("| 上游条目 | 行 | 种类 | 本地对应显式导入 | 集合等价 |")
        lines.append("| --- | --- | --- | --- | --- |")
        for row in item["import_correspondence"]["rows"]:
            upstream_entry = row["upstream"]
            if row["kind"] == "通配符导入":
                counterpart = "、".join(
                    statement.replace("import ", "").rstrip(";")
                    for statement in row["local_imports_from_package"]
                )
                equivalent = (
                    "未核实"
                    if row["set_equivalent"] is None
                    else ("是" if row["set_equivalent"] else "否")
                )
            else:
                counterpart = (
                    row["local_counterpart"]["statement"]
                    if row["local_counterpart"]
                    else (
                        "（本地无逐字相同条目；按登记变换映射后对应 "
                        + row["local_counterpart_mapped"]["statement"]
                        + "）"
                        if row.get("local_counterpart_mapped")
                        else "（本地无对应条目）"
                    )
                )
                equivalent = "是" if row["equivalent_after_registered_mapping"] else "否"
            lines.append(
                f"| `{upstream_entry['statement']}` | {upstream_entry['line']} | {row['kind']} | "
                f"{counterpart or '（无）'} | {equivalent} |"
            )
        lines.append("")
        for row in item["wildcard_rows"]:
            lines.append(
                f"- 通配符包 `{row['package']}`：JDK 索引命中={row['package_in_fixed_jdk_index']}；"
                f"`{jdk_evidence['source']}` 中该包登记 "
                f"{row['jdk_package_type_count']} 个顶层类型；上游正文使用的大写简单名 "
                f"`{'、'.join(row['upstream_body_names_after_import'])}`；"
                f"该通配符**实际可绑定** `{'、'.join(row['wildcard_actually_binds'])}`；"
                f"不在该包的正文名 `{'、'.join(row['body_names_not_in_that_package']) or '无'}`；"
                f"本地同包显式导入 `{'、'.join(row['local_explicit_same_package'])}`；"
                f"通配符绑定但本地未显式导入 `{'、'.join(row['bound_missing_on_local_side']) or '无'}`；"
                f"本地显式但通配符不会绑定 `{'、'.join(row['local_explicit_not_bound_upstream']) or '无'}`"
            )
        lines.append("")
        lines.append(
            "- 候选展开规则在本条上的读数："
            + "；".join(
                f"`{key}`={value}"
                for key, value in item["candidate_rule_probe_on_this_item"].items()
            )
            + f"；本地展开集合 `{'、'.join(item['candidate_rule_probe_qualified_sets']['local'])}`，"
            + f"上游展开集合 `{'、'.join(item['candidate_rule_probe_qualified_sets']['upstream'])}`"
        )
        if item["fabricated_imports"]:
            lines.append(
                "- 展开虚构出的类型："
                + "；".join(
                    f"{entry['side']} `{entry['package']}` ← `{'、'.join(entry['assumed_types'])}`"
                    for entry in item["fabricated_imports"]
                )
            )
        lines.append("")
        for row in item["wildcard_rows"]:
            lines.append(f"> 判定依据：{row['equivalence_basis']}。")
        lines.append("")
        lines.append(f"> {item['equivalence_note']}")
        lines.append("")
    lines.append("## 未使用／冲突／同名类型反例")
    lines.append("")
    lines.append(
        "以下夹具在**当前规则实现**上实测读数，并给出三个**候选规则变体**的实测读数，"
        "用来证明“把通配符归一化为显式导入”会放过哪些真实差异。"
        "变体评估器只在本材料生成过程中使用，未登记进受控变换集，也没有门禁入口调用。"
    )
    lines.append("")
    for example in package["counter_examples"]:
        lines.append(
            f"### {example['id']} {example['name']}（{example['category']}）"
        )
        lines.append("")
        lines.append(f"- 待回答的问题：{example['question']}")
        lines.append(f"- 真实差异：{example['real_difference']}")
        lines.append(
            f"- 当前规则：equal={example['current_rule']['equal']}"
            f"（{example['current_rule']['note']}）"
        )
        for name, key in (
            ("展开后按限定名比较", "expand_compare_qualified_equal"),
            ("展开后只按简单名比较", "expand_compare_simple_name_equal"),
            ("丢弃未使用导入后按限定名比较", "drop_unused_compare_qualified_equal"),
        ):
            lines.append(
                f"- 候选变体「{name}」：equal={example['candidate_variants'][key]}"
            )
        lines.append(
            f"- 会放过该差异的变体：{'、'.join(example['wrongly_accepting_variants']) or '无'}"
        )
        if example["fabricated_imports"]:
            lines.append(
                "- 展开虚构出的不存在的类型："
                + "；".join(
                    f"{entry['side']} `{entry['package']}` ← `{'、'.join(entry['assumed_types'])}`"
                    for entry in example["fabricated_imports"]
                )
            )
        lines.append(f"- 结论：{example['conclusion']}")
        lines.append("")
        lines.append("```java")
        lines.append("// 本地")
        lines.append(example["local_source"].rstrip("\n"))
        lines.append("// 上游")
        lines.append(example["upstream_source"].rstrip("\n"))
        lines.append("```")
        lines.append("")
    lines.append("## 候选规则草案（待裁决，不实施）")
    lines.append("")
    draft = package["candidate_rule_draft"]
    lines.append(f"- 标识：`{draft['id']}`，状态：**{draft['status']}**")
    lines.append(f"- 名称：{draft['name']}（方向 {draft['direction']}，操作 `{draft['operation']}`）")
    lines.append(f"- 定义：{draft['definition']}")
    lines.append(f"- 适用范围：{draft['scope']}")
    lines.append("- 前置条件：")
    for condition in draft["preconditions"]:
        lines.append(f"  - {condition}")
    lines.append("- 风险清单：")
    for risk in draft["risks"]:
        lines.append(f"  - **{risk['id']}**：{risk['risk']}（证据位置：`{risk['evidence']}`）")
    lines.append("")
    lines.append("## 未解决问题")
    lines.append("")
    for question in package["open_questions"]:
        lines.append(f"- {question}")
    lines.append("")
    lines.append("## 复核判定表（留空）")
    lines.append("")
    lines.append(f"> {package['review_decision_table']['notice']}")
    lines.append("")
    lines.append("| item_id | declaration | sets_equivalent | reviewer_verdict | reviewer | review_date | review_reason |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- |")
    for row in package["review_decision_table"]["rows"]:
        lines.append(
            f"| {row['item_id']} | `{row['declaration']}` | {row['sets_equivalent']} |  |  |  |  |"
        )
    lines.append("")
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------
# 校验与入口
# --------------------------------------------------------------------------


def verify_item(declaration: str) -> tuple[int, dict[str, Any]]:
    """按当前工作树与快照复算一条候选，并与材料包逐项比对。

    Args:
        declaration: 目标类型的限定名。

    Returns:
        ``(退出码, 复算报告)``；退出码 0 表示与材料完全一致。

    """

    stored = read_json(REVIEW_JSON)
    target = next(
        (item for item in stored["items"] if item["object"]["declaration"] == declaration),
        None,
    )
    if target is None:
        return 2, {"status": "not-found", "declaration": declaration}
    checker = load_checker()
    queue = read_json(QUEUE_PATH)
    index = read_json(INDEX_PATH)
    records = {str(record.get("local_path")): record for record in index["records"]}
    registry = checker.load_evidence_registry(INDEX_PATH, SNAPSHOT_DIR)
    transform_set = resolve_transform_set(checker)
    transforms = ordered_transforms(transform_set)
    queue_item = next(
        (
            item
            for item in queue["items"]
            if item["local_path"] == target["object"]["local_path"]
            and item["declaration"] == declaration
        ),
        None,
    )
    if queue_item is None:  # pragma: no cover - 防御
        return 2, {"status": "queue-entry-missing", "declaration": declaration}
    recomputed = item_materials(
        checker,
        queue_item,
        records[str(queue_item["local_path"])],
        registry,
        transforms,
        transform_set,
        module_index(),
        target["item_id"],
    )
    mismatches: list[str] = []

    def compare(label: str, expected: Any, actual: Any) -> None:
        """记录读数不一致的字段。"""

        if expected != actual:
            mismatches.append(f"{label}：材料 {expected!r}／实测 {actual!r}")

    for field in (
        "local_code_stream_sha256",
        "upstream_code_stream_sha256",
        "local_code_bytes",
        "upstream_code_bytes",
        "local_token_count",
        "upstream_token_count",
        "import_count_local",
        "import_count_upstream",
        "import_entries_local",
        "import_entries_upstream",
        "equal",
        "diff_count",
    ):
        compare(f"strict_comparison.{field}", target["strict_comparison"][field], recomputed["strict_comparison"][field])
    for field in (
        "measured_local_lines",
        "measured_upstream_lines",
        "attributed_local_lines",
        "attributed_upstream_lines",
        "covers_exactly",
        "attribution_block_count",
        "unexplained_blocks",
        "cause_histogram",
    ):
        compare(
            f"attribution_coverage.{field}",
            target["attribution_coverage"][field],
            recomputed["attribution_coverage"][field],
        )
    compare("difference_attribution", target["difference_attribution"], recomputed["difference_attribution"])
    compare(
        "comment_bindings",
        [
            {"role": entry["role"], "lines": entry["lines"], "sha256": entry["sha256"], "text": entry["text"]}
            for entry in target["comment_bindings"]
        ],
        [
            {"role": entry["role"], "lines": entry["lines"], "sha256": entry["sha256"], "text": entry["text"]}
            for entry in recomputed["comment_bindings"]
        ],
    )
    compare(
        "authorship.upstream_fixed_version.author_declared",
        target["authorship"]["upstream_fixed_version"]["author_declared"],
        recomputed["authorship"]["upstream_fixed_version"]["author_declared"],
    )
    compare(
        "object.javadoc_sha256_measured",
        target["object"]["javadoc_sha256_measured"],
        recomputed["object"]["javadoc_sha256_measured"],
    )
    compare("inputs.rule_implementation.sha256", stored["inputs"]["rule_implementation"]["sha256"], sha256_bytes(CHECKER_PATH.read_bytes()))
    compare("inputs.transform_set.sha256", stored["inputs"]["transform_set"]["sha256"], transform_set.get("file_sha256"))
    report = {
        "status": "passed" if not mismatches else "failed",
        "declaration": declaration,
        "item_id": target["item_id"],
        "strict_equal": recomputed["strict_comparison"]["equal"],
        "attribution_covers_exactly": recomputed["attribution_coverage"]["covers_exactly"],
        "snapshot_manifest": registry.snapshot_manifest,
        "mismatches": mismatches,
    }
    return (0 if not mismatches else 1), report


def verify_wildcard(declaration: str | None) -> tuple[int, dict[str, Any]]:
    """复算通配符导入扩展材料（全部对象或指定一条）。

    Args:
        declaration: 可选的限定名；为空时复算全部 3 条。

    Returns:
        ``(退出码, 复算报告)``。

    """

    stored = read_json(WILDCARD_JSON)
    checker = load_checker()
    queue = read_json(QUEUE_PATH)
    index = read_json(INDEX_PATH)
    records = {str(record.get("local_path")): record for record in index["records"]}
    registry = checker.load_evidence_registry(INDEX_PATH, SNAPSHOT_DIR)
    transform_set = resolve_transform_set(checker)
    transforms = ordered_transforms(transform_set)
    recomputed = build_wildcard_package()
    mismatches: list[str] = []
    for expected, actual in zip(stored["items"], recomputed["items"]):
        if declaration and actual["declaration"] != declaration:
            continue
        for field in ("current_rule_result", "import_correspondence", "sets_equivalent"):
            if expected[field] != actual[field]:
                mismatches.append(f"{actual['declaration']}：{field} 与材料不一致")
    if stored["java_version_and_dependencies"]["poms"] != recomputed["java_version_and_dependencies"]["poms"]:
        mismatches.append("java_version_and_dependencies.poms 与材料不一致（编译依赖指纹已变化）")
    if stored["counter_examples"] != recomputed["counter_examples"]:
        mismatches.append("counter_examples 与材料不一致")
    rows = [
        row["declaration"]
        for row in stored["review_decision_table"]["rows"]
        if row["reviewer_verdict"] is not None
    ]
    if rows:
        mismatches.append(f"判定列被填写：{rows}（实施方不得填写）")
    return (0 if not mismatches else 1), {
        "status": "passed" if not mismatches else "failed",
        "declaration": declaration or "（全部 3 条）",
        "mismatches": mismatches,
        "snapshot_manifest": registry.snapshot_manifest,
    }


def main() -> int:
    """命令行入口。"""

    parser = argparse.ArgumentParser(description="生成/复算 D16 逐条复核材料包")
    parser.add_argument("--build", action="store_true", help="重新生成两份材料包（JSON + Markdown）")
    parser.add_argument("--verify-item", metavar="DECLARATION", help="复算单条候选并与材料比对")
    parser.add_argument("--verify-wildcard", action="store_true", help="复算通配符导入扩展材料")
    parser.add_argument("--item", metavar="DECLARATION", help="配合 --verify-wildcard 限定单条对象")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出报告")
    arguments = parser.parse_args()

    if arguments.verify_item:
        code, report = verify_item(arguments.verify_item)
    elif arguments.verify_wildcard:
        code, report = verify_wildcard(arguments.item)
    elif arguments.build:
        review = build_review_package()
        wildcard = build_wildcard_package()
        REVIEW_JSON.write_text(
            json.dumps(review, ensure_ascii=False, indent=2, sort_keys=False) + "\n",
            encoding="utf-8",
        )
        REVIEW_MD.write_text(render_review_markdown(review), encoding="utf-8")
        WILDCARD_JSON.write_text(
            json.dumps(wildcard, ensure_ascii=False, indent=2, sort_keys=False) + "\n",
            encoding="utf-8",
        )
        WILDCARD_MD.write_text(render_wildcard_markdown(wildcard), encoding="utf-8")
        code = 0
        report = {
            "status": "written",
            "review_materials": {
                "json": relative(REVIEW_JSON),
                "json_sha256": sha256_bytes(REVIEW_JSON.read_bytes()),
                "markdown": relative(REVIEW_MD),
                "markdown_sha256": sha256_bytes(REVIEW_MD.read_bytes()),
                "counts": review["counts"],
            },
            "wildcard_materials": {
                "json": relative(WILDCARD_JSON),
                "json_sha256": sha256_bytes(WILDCARD_JSON.read_bytes()),
                "markdown": relative(WILDCARD_MD),
                "markdown_sha256": sha256_bytes(WILDCARD_MD.read_bytes()),
                "counts": wildcard["counts"],
            },
        }
    else:
        parser.error("必须指定 --build、--verify-item 或 --verify-wildcard 之一")

    if arguments.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(report.get("status"), report.get("declaration", ""))
        for mismatch in report.get("mismatches", []):
            print("不一致：", mismatch)
    return code


if __name__ == "__main__":
    raise SystemExit(main())