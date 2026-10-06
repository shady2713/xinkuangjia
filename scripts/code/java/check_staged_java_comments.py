#!/usr/bin/env python3
"""检查 Git 暂存区新增或修改的 Java 声明是否具备项目要求的注释。

检查器读取暂存版本而非工作区版本，只校验本次变更覆盖的声明，避免历史注释欠账
阻塞无关提交。DO、VO 的成员变量同样要求使用 JavaDoc 说明字段职责。

public 类型有两条合规路径：准确的 ``@author``，或按 D12 裁决固定格式书写、并由受控
清单与上游快照逐项核验的来源说明。来源说明只主张“某固定上游版本的对应文件未声明
作者”，不主张历史引入版本，也不得写成具体人名。

清单与快照位置按“命令行参数 > 环境变量 > 仓库内受控默认索引”解析：
``--evidence-registry``/``--evidence-snapshots`` 或
``JAVA_COMMENT_EVIDENCE_REGISTRY``/``JAVA_COMMENT_EVIDENCE_SNAPSHOTS`` 显式配置优先；
都没有时读取被检查仓库内的 ``DEFAULT_EVIDENCE_REGISTRY``，不写死任何本机绝对路径。
上游内容不复制进仓库：受控快照优先，缺失时按清单登记的固定提交地址取回并复算
SHA-256；取不回或指纹不符即拒绝。证据不可读时以退出码 2 报告原因，不回退到无条件放行。

@author 李杰
"""

from __future__ import annotations

import argparse
import bisect
import csv
import difflib
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scripts.common.repository_layout import JAVA_SOURCE_ROOT, is_java_source
from scripts.common.check_protocol import payload
from scripts.common.quality_common import CheckError

# Windows Git Hook 可能继承非 UTF-8 控制台编码，统一输出编码以保证中文提示可读。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


GIT_TIMEOUT_SECONDS = 30
HUNK_HEADER_PATTERN = re.compile(
    r"^@@ -\d+(?:,\d+)? \+(?P<line>\d+)(?:,\d+)? @@"
)
TYPE_PATTERN = re.compile(
    r"(?<![\w$])"
    r"(?P<modifiers>(?:(?:public|protected|private|abstract|static|final|"
    r"sealed|non-sealed|strictfp)\s+)*)"
    r"(?P<kind>@interface|class|interface|enum|record)\s+"
    r"(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)"
)
IDENTIFIER_BEFORE_PAREN_PATTERN = re.compile(
    r"(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*$"
)
FIELD_PREFIX_PATTERN = re.compile(
    r"^(?:(?:public|protected|private|static|final|transient|volatile)\s+)*"
    r"(?:@[A-Za-z_$][A-Za-z0-9_$.]*(?:\s*\([^)]*\))?\s+)*"
    r"[A-Za-z_$][A-Za-z0-9_$.,<>?\[\] @]*\s+"
    r"[A-Za-z_$][A-Za-z0-9_$]*\b",
    re.DOTALL,
)
# 兼容普通空白和 JavaDoc/HTML 中常见的空格实体，避免不同模板导致漏检。
AUTHOR_PATTERN = re.compile(
    r"@author(?:[ \t]|&(?:#x20;|#32;|nbsp;))+"
    r"(?P<name>[^\r\n*]+)",
    re.IGNORECASE,
)
# 只拦截无法代表真实身份的明确占位值；真实姓名由执行流程按用户规则核对。
AUTHOR_PLACEHOLDERS = {
    "<author>",
    "<实际作者>",
    "author",
    "name",
    "todo",
    "unknown",
    "unknown author",
    "作者",
    "作者姓名",
    "姓名",
    "实际作者",
    "待填写",
    "开发者",
}
CONTROL_KEYWORDS = {
    "assert",
    "catch",
    "do",
    "for",
    "if",
    "new",
    "return",
    "super",
    "switch",
    "synchronized",
    "this",
    "throw",
    "try",
    "while",
}
# 中性表达不能代表作者身份，也不能借 @author 承载来源说明。
AUTHOR_NEUTRAL_VALUES = {
    "basic-framework",
    "basicframework",
    "未声明作者",
    "来源不明",
    "来源未知",
    "无作者",
    "作者未声明",
    "上游未声明作者",
}
AUTHOR_SOURCE_SENTENCE_PATTERN = re.compile(
    r"来源\s*[:：]|未声明作者|来源不明|来源未知|无作者|作者未声明|"
    r"[A-Za-z0-9._-]+/[A-Za-z0-9._-]+\s*@\s*[0-9a-f]{8,40}"
)
# D12 方案 A：固定格式的来源说明，只能出现在职责 JavaDoc 正文且位于全部块标签之前。
SOURCE_HEADER_PREFIX = "来源："
SOURCE_DECLARATION_SUFFIX = "（该版本未声明作者）"
SOURCE_HEADER_PATTERN = re.compile(
    r"^来源：(?P<repository>[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*)"
    r" @ (?P<commit>[0-9a-f]{40})（该版本未声明作者）$"
)
SOURCE_REPOSITORY_PATTERN = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$"
)
SOURCE_PATH_PATTERN = re.compile(r"^上游文件：(?P<path>.+)$")
SOURCE_LOCAL_PATTERN = re.compile(r"^本地修改：(?P<text>.*)$")
SOURCE_BASIS_FIXED = "来源依据：固定见证版本；历史引入版本未核实。"
SOURCE_BASIS_VERIFIED = "来源依据：已核实引入版本。"
SOURCE_BASIS_LINES = (SOURCE_BASIS_FIXED, SOURCE_BASIS_VERIFIED)
SOURCE_NOTE_LINE_COUNT = 4
LOCAL_MODIFICATION_NONE_LINE = "无。"
LOCAL_MODIFICATION_NONE_MARKERS = {"无", "无本地修改", "no-local-modification", "none"}
# 受控清单的逐类型证据 schema；类型映射与复核结论必须是结构化结果。
EVIDENCE_SCHEMA = "d12-type-evidence/v1"
# 仓库内派生来源索引的 schema；只在清单显式声明时校验，普通记录数组不受影响。
EVIDENCE_INDEX_SCHEMA = "d12-source-index/v1"
EVIDENCE_HISTORY_BASIS = "introduced-verified"
AUTHOR_UNDECLARED_STATUS = "已核实来源但作者未声明"
EVIDENCE_REGISTRY_ENV = "JAVA_COMMENT_EVIDENCE_REGISTRY"
EVIDENCE_SNAPSHOTS_ENV = "JAVA_COMMENT_EVIDENCE_SNAPSHOTS"
# 仓库内受控来源索引；相对被检查仓库根目录解析，不是任何本机绝对路径。
DEFAULT_EVIDENCE_REGISTRY = "docs/测试与可靠性/来源证据/d12-source-index.json"
# 固定地址取回的边界：单个上游文件不超过 4 MiB，连接与读取合计不超过 30 秒；
# 瞬时连接中断按固定次数重试，仍失败即按“取不回”拒绝。
EVIDENCE_FETCH_TIMEOUT_SECONDS = 30.0
EVIDENCE_FETCH_ATTEMPTS = 3
EVIDENCE_FETCH_BACKOFF_SECONDS = 0.2
MAX_UPSTREAM_BYTES = 4 * 1024 * 1024
EVIDENCE_ROUTES = ("路线 1", "路线 2", "路线 3")
EVIDENCE_REQUIRED_FIELDS = (
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
)
# 上游文件的等价作者声明；版权与许可证主体不当作作者姓名。
UPSTREAM_AUTHOR_PATTERN = re.compile(
    r"@author\b"
    r"|^(?:\s*(?:/\*\*?|\*|//|#)?\s*(?:authors?|原作者|作者)\s*[:：=])",
    re.IGNORECASE | re.MULTILINE,
)
REVIEW_CROSS_REFERENCE_PATTERN = re.compile(
    r"(?:见|详见|参见|同)\s*(?:author_reason|open_gap|原因|缺口|上文|下节|证据\.md|本文件|该文件)"
)
# 自造的来源块标签不能代替正文来源说明。
PROVENANCE_TAG_PATTERN = re.compile(
    r"^@(?P<tag>sources?|origin|provenance|upstream|from|来源)\b", re.IGNORECASE
)
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
COMMIT_PATTERN = re.compile(r"^[0-9a-f]{40}$")


@dataclass(frozen=True)
class Finding:
    """表示一个注释门禁问题。

    Attributes:
        path: 仓库内 Java 文件路径。
        line: 暂存版本中的声明行号。
        rule: 命中的规则标识。
        detail: 可直接展示的整改说明。
        evidence_bound: 是否为来源证据主张类诊断。该类诊断必须在每次检查时按当前
            证据重新成立，不因旧版本存在同样失败而按历史欠账豁免。
    """

    path: str
    line: int
    rule: str
    detail: str
    evidence_bound: bool = False


@dataclass(frozen=True)
class TypeDeclaration:
    """记录 Java 类型声明及其主体边界。

    Attributes:
        name: 类型简单名称。
        kind: class、interface、enum、record 或 @interface。
        public: 是否为 public 类型。
        declaration_offset: 声明修饰符或注解的起始偏移量。
        name_offset: 类型名称的起始偏移量。
        open_brace: 类型主体左大括号偏移量。
        close_brace: 类型主体右大括号偏移量。
        outer_depth: 类型声明所在的大括号深度。
    """

    name: str
    kind: str
    public: bool
    declaration_offset: int
    name_offset: int
    open_brace: int
    close_brace: int
    outer_depth: int


def _run_git(arguments: list[str], *, text: bool = True) -> str | bytes:
    """执行只读 Git 命令并返回标准输出。

    Args:
        arguments: 不包含 ``git`` 本身的参数列表。
        text: 是否将输出严格解码为 UTF-8 文本。

    Returns:
        Git 命令的标准输出。

    Raises:
        RuntimeError: Git 命令失败或输出不是有效 UTF-8 时抛出。
    """

    try:
        completed = subprocess.run(
            ["git", "-c", "core.quotepath=false", *arguments],
            check=False,
            capture_output=True,
            timeout=GIT_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(
            f"Git 命令超过 {GIT_TIMEOUT_SECONDS} 秒未完成"
        ) from error
    if completed.returncode != 0:
        stderr = completed.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(stderr or "Git 命令执行失败")
    if not text:
        return completed.stdout
    try:
        return completed.stdout.decode("utf-8")
    except UnicodeDecodeError as error:
        raise RuntimeError("Git 输出不是有效 UTF-8，已停止注释检查") from error


def _staged_java_paths() -> list[str]:
    """读取本次提交中新增、复制、修改或重命名的 Java 源文件。

    Returns:
        位于 Java 工程源码目录下的仓库相对路径列表。
    """

    output = _run_git(
        ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR", "--"],
        text=False,
    )
    assert isinstance(output, bytes)
    paths = []
    for raw_path in output.split(b"\0"):
        if not raw_path:
            continue
        try:
            path = raw_path.decode("utf-8")
        except UnicodeDecodeError as error:
            raise RuntimeError("暂存区文件路径不是有效 UTF-8") from error
        normalized = path.replace("\\", "/")
        if is_java_source(normalized):
            paths.append(normalized)
    return paths


def _staged_source(path: str) -> str:
    """读取指定 Java 文件的暂存版本。

    Args:
        path: 仓库相对路径。

    Returns:
        严格按 UTF-8 解码的 Java 源码。

    Raises:
        RuntimeError: 暂存对象不存在或源码不是有效 UTF-8 时抛出。
    """

    output = _run_git(["show", f":{path}"], text=False)
    assert isinstance(output, bytes)
    try:
        return output.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise RuntimeError(f"{path} 不是有效 UTF-8，已停止注释检查") from error


def _staged_bytes(path: str) -> bytes:
    """读取指定 Java 文件的暂存版本原始字节。

    Args:
        path: 仓库相对路径。

    Returns:
        暂存对象的原始字节，用于复算证据清单登记的最终指纹。

    Raises:
        RuntimeError: 暂存对象不存在或 Git 读取失败时抛出。
    """

    output = _run_git(["show", f":{path}"], text=False)
    assert isinstance(output, bytes)
    return output


def _added_lines(path: str) -> set[int]:
    """读取指定文件在暂存差异中的新增行号。

    Args:
        path: 仓库相对路径。

    Returns:
        以暂存版本为基准的一组新增行号。
    """

    output = _run_git(
        [
            "diff",
            "--cached",
            "--unified=0",
            "--no-color",
            "--diff-filter=ACMR",
            "--",
            path,
        ]
    )
    assert isinstance(output, str)
    line_number = 0
    added: set[int] = set()
    for diff_line in output.splitlines():
        hunk = HUNK_HEADER_PATTERN.match(diff_line)
        if hunk:
            line_number = int(hunk.group("line"))
            continue
        if diff_line.startswith("+") and not diff_line.startswith("+++"):
            added.add(line_number)
            line_number += 1
        elif diff_line.startswith(" "):
            line_number += 1
    return added


@lru_cache(maxsize=2)
def _lex_java(source: str) -> tuple[str, tuple[tuple[int, int], ...]]:
    """屏蔽注释和字面量并记录真实块注释边界，复用同一文件的声明分析结果。

    Args:
        source: 原始 Java 源码。

    Returns:
        与原文等长的结构化文本及块注释起止偏移；最多缓存两个源码版本。
    """

    chars = list(source)
    masked = list(source)
    index = 0
    state = "normal"
    comments: list[tuple[int, int]] = []
    comment_start = 0
    while index < len(chars):
        char = chars[index]
        next_char = chars[index + 1] if index + 1 < len(chars) else ""
        if state == "normal":
            if char == "/" and next_char == "/":
                masked[index] = masked[index + 1] = " "
                index += 2
                state = "line-comment"
                continue
            if char == "/" and next_char == "*":
                comment_start = index
                masked[index] = masked[index + 1] = " "
                index += 2
                state = "block-comment"
                continue
            if source.startswith('"""', index):
                masked[index : index + 3] = [" ", " ", " "]
                index += 3
                state = "text-block"
                continue
            if char == '"':
                masked[index] = " "
                index += 1
                state = "string"
                continue
            if char == "'":
                masked[index] = " "
                index += 1
                state = "char"
                continue
        elif state == "line-comment":
            if char == "\n":
                state = "normal"
            else:
                masked[index] = " "
        elif state == "block-comment":
            if char == "*" and next_char == "/":
                comments.append((comment_start, index + 2))
                masked[index] = masked[index + 1] = " "
                index += 2
                state = "normal"
                continue
            if char != "\n":
                masked[index] = " "
        elif state in {"string", "char"}:
            if char == "\\":
                masked[index] = " "
                if index + 1 < len(chars):
                    if chars[index + 1] != "\n":
                        masked[index + 1] = " "
                    index += 2
                    continue
            delimiter = '"' if state == "string" else "'"
            if char == delimiter:
                state = "normal"
            if char != "\n":
                masked[index] = " "
        elif state == "text-block":
            if source.startswith('"""', index):
                masked[index : index + 3] = [" ", " ", " "]
                index += 3
                state = "normal"
                continue
            if char != "\n":
                masked[index] = " "
        index += 1
    return "".join(masked), tuple(comments)


def _mask_java(source: str) -> str:
    """返回屏蔽注释及字面量的等长源码，保留调用方使用的结构定位接口。"""
    return _lex_java(source)[0]


def _depths(masked: str, opening: str, closing: str) -> list[int]:
    """计算每个字符之前的指定结构嵌套深度。

    Args:
        masked: 已屏蔽注释和字面量的源码。
        opening: 左分隔符。
        closing: 右分隔符。

    Returns:
        与源码等长的深度列表。
    """

    result = [0] * len(masked)
    depth = 0
    for index, char in enumerate(masked):
        result[index] = depth
        if char == opening:
            depth += 1
        elif char == closing:
            depth = max(0, depth - 1)
    return result


def _matching_delimiters(masked: str, opening: str, closing: str) -> dict[int, int]:
    """建立成对分隔符从左侧到右侧的偏移映射。

    Args:
        masked: 已屏蔽注释和字面量的源码。
        opening: 左分隔符。
        closing: 右分隔符。

    Returns:
        每个完整左分隔符对应的右分隔符偏移。
    """

    pairs: dict[int, int] = {}
    stack: list[int] = []
    for index, char in enumerate(masked):
        if char == opening:
            stack.append(index)
        elif char == closing and stack:
            pairs[stack.pop()] = index
    return pairs


def _line_starts(source: str) -> list[int]:
    """计算每一行在源码中的起始偏移。

    Args:
        source: Java 源码。

    Returns:
        第一项固定为 0 的行起始偏移列表。
    """

    starts = [0]
    starts.extend(index + 1 for index, char in enumerate(source) if char == "\n")
    return starts


def _line_number(starts: list[int], offset: int) -> int:
    """将字符偏移转换为一基行号。

    Args:
        starts: 行起始偏移列表。
        offset: 源码字符偏移。

    Returns:
        一基行号。
    """

    return bisect.bisect_right(starts, offset)


def _intersects_added_lines(
    starts: list[int], start_offset: int, end_offset: int, added_lines: set[int]
) -> bool:
    """判断声明范围是否与暂存新增行相交。

    Args:
        starts: 行起始偏移列表。
        start_offset: 声明起始偏移。
        end_offset: 声明结束偏移。
        added_lines: 暂存差异中的新增行号。

    Returns:
        至少一个声明行属于新增行时返回 ``True``。
    """

    start_line = _line_number(starts, start_offset)
    end_line = _line_number(starts, end_offset)
    return any(line in added_lines for line in range(start_line, end_line + 1))


def _member_start(
    masked: str, brace_depths: list[int], position: int, member_depth: int
) -> int:
    """定位类型成员在上一个同级结构边界之后的起点。

    Args:
        masked: 已屏蔽注释和字面量的源码。
        brace_depths: 每个字符之前的大括号深度。
        position: 当前声明内的字符偏移。
        member_depth: 类型成员所在的大括号深度。

    Returns:
        可能包含 JavaDoc 和注解的成员片段起始偏移。
    """

    parentheses = 0
    for index in range(position - 1, -1, -1):
        char = masked[index]
        if char == ")":
            parentheses += 1
            continue
        if char == "(" and parentheses:
            parentheses -= 1
            continue
        # 注解参数中的数组也有大括号，但不结束前一个类型成员。
        # 反向匹配小括号可同时覆盖多行数组与嵌套注解，不依赖注解名称。
        if parentheses:
            continue
        if char == ";" and brace_depths[index] == member_depth:
            return index + 1
        if char == "}" and brace_depths[index] == member_depth + 1:
            return index + 1
        if char == "{" and brace_depths[index] == member_depth - 1:
            return index + 1
    return 0


def _first_code_offset(masked: str, start: int, end: int) -> int:
    """返回指定区间内第一个未被屏蔽的非空白字符偏移。

    Args:
        masked: 已屏蔽注释和字面量的源码。
        start: 搜索起始偏移。
        end: 搜索结束偏移，不包含该位置。

    Returns:
        首个代码字符偏移；区间没有代码时返回 ``end``。
    """

    index = start
    while index < end and masked[index].isspace():
        index += 1
    return index


def _attached_javadoc_span(source: str, declaration_offset: int) -> tuple[int, int] | None:
    """读取紧邻声明或其注解之前的 JavaDoc 偏移区间。

    Args:
        source: 原始 Java 源码。
        declaration_offset: 声明修饰符或首个注解的起始偏移。

    Returns:
        JavaDoc 的 ``[起始, 结束)`` 偏移；不存在时返回 ``None``。
    """

    prefix = source[:declaration_offset].rstrip()
    if not prefix.endswith("*/"):
        return None
    for start, end in reversed(_lex_java(source)[1]):
        if end == len(prefix):
            return (start, end) if source.startswith("/**", start) else None
        if end < len(prefix):
            break
    return None


def _attached_javadoc(source: str, declaration_offset: int) -> str | None:
    """读取紧邻声明或其注解之前的 JavaDoc。

    Args:
        source: 原始 Java 源码。
        declaration_offset: 声明修饰符或首个注解的起始偏移。

    Returns:
        已关联的 JavaDoc 文本；不存在时返回 ``None``。
    """

    span = _attached_javadoc_span(source, declaration_offset)
    return None if span is None else source[span[0] : span[1]]


def _strip_leading_annotations(fragment: str) -> tuple[str, int]:
    """移除成员片段开头的 Java 注解并返回相对偏移。

    Args:
        fragment: 已屏蔽注释和字面量的成员片段。

    Returns:
        ``(去除注解后的片段, 片段内代码起始偏移)``。
    """

    index = 0
    length = len(fragment)
    while True:
        while index < length and fragment[index].isspace():
            index += 1
        if index >= length or fragment[index] != "@":
            break
        index += 1
        while index < length and (
            fragment[index].isalnum() or fragment[index] in {"_", "$", "."}
        ):
            index += 1
        while index < length and fragment[index].isspace():
            index += 1
        if index < length and fragment[index] == "(":
            depth = 1
            index += 1
            while index < length and depth:
                if fragment[index] == "(":
                    depth += 1
                elif fragment[index] == ")":
                    depth -= 1
                index += 1
    return fragment[index:], index


def _type_declarations(
    masked: str, brace_depths: list[int], brace_pairs: dict[int, int]
) -> list[TypeDeclaration]:
    """解析源码中的显式类型声明及其主体范围。

    Args:
        masked: 已屏蔽注释和字面量的源码。
        brace_depths: 每个字符之前的大括号深度。
        brace_pairs: 左右大括号偏移映射。

    Returns:
        能够确定完整主体边界的类型声明列表。
    """

    declarations = []
    for match in TYPE_PATTERN.finditer(masked):
        # 模式匹配中的 `record instanceof Type value` 不是 record 类型声明。
        if match.group("kind") == "record" and match.group("name") == "instanceof":
            continue
        open_brace = masked.find("{", match.end())
        if open_brace < 0 or open_brace not in brace_pairs:
            continue
        semicolon = masked.find(";", match.end(), open_brace)
        if semicolon >= 0:
            continue
        outer_depth = brace_depths[match.start()]
        if brace_depths[open_brace] != outer_depth:
            continue
        segment_start = _member_start(
            masked, brace_depths, match.start(), outer_depth
        )
        declaration_offset = _first_code_offset(
            masked, segment_start, match.start() + 1
        )
        modifiers = match.group("modifiers")
        declarations.append(
            TypeDeclaration(
                name=match.group("name"),
                kind=match.group("kind"),
                public="public" in modifiers.split(),
                declaration_offset=declaration_offset,
                name_offset=match.start("name"),
                open_brace=open_brace,
                close_brace=brace_pairs[open_brace],
                outer_depth=outer_depth,
            )
        )
    return declarations


def _enclosing_type(
    declarations: list[TypeDeclaration], position: int, depth: int
) -> TypeDeclaration | None:
    """查找指定偏移所在的最内层类型。

    Args:
        declarations: 全部类型声明。
        position: 待定位字符偏移。
        depth: 该字符之前的大括号深度。

    Returns:
        成员深度匹配的最内层类型；不存在时返回 ``None``。
    """

    candidates = [
        declaration
        for declaration in declarations
        if declaration.open_brace < position < declaration.close_brace
        and depth == declaration.outer_depth + 1
    ]
    return max(candidates, key=lambda declaration: declaration.open_brace, default=None)


def _author_values(javadoc: str) -> list[str]:
    """提取 JavaDoc 中全部 @author 值，去掉行尾空白与 HTML 空格实体。

    Args:
        javadoc: 待检查的完整 JavaDoc 文本。

    Returns:
        按出现顺序排列的作者值列表。
    """

    values = []
    for match in AUTHOR_PATTERN.finditer(javadoc):
        values.append(
            re.sub(
                r"(?:\s|&(?:#x20;|#32;|nbsp;))+$",
                "",
                match.group("name"),
                flags=re.IGNORECASE,
            ).strip()
        )
    return values


def _has_actual_author(javadoc: str) -> bool:
    """判断 JavaDoc 是否包含非占位、非中性的作者姓名。

    Args:
        javadoc: 待检查的完整 JavaDoc 文本。

    Returns:
        至少存在一个非空且既不是常见占位值、也不是中性来源表达的作者时返回 ``True``。

    Note:
        静态检查只能排除明显占位或中性文字，作者真实性仍由生成或评审流程核对。
        “未声明作者”“来源不明”和本裁决的来源句被塞进 ``@author`` 时不代表作者身份。
    """

    for author in _author_values(javadoc):
        if not author:
            continue
        if author.casefold() in AUTHOR_PLACEHOLDERS:
            continue
        if author.casefold() in AUTHOR_NEUTRAL_VALUES:
            continue
        if AUTHOR_SOURCE_SENTENCE_PATTERN.search(author):
            continue
        return True
    return False


@dataclass(frozen=True)
class SourceNote:
    """记录一条固定格式的来源说明。

    Attributes:
        repository: 真实上游 URL 对应的“拥有者/仓库名”。
        commit: 完整 40 位小写提交 SHA。
        upstream_path: 清单中的上游仓库相对文件路径。
        basis: 来源依据行原文。
        local_modification: 本地修改说明。
        line: 来源说明首行在 JavaDoc 正文中的 1 起始行号。
    """

    repository: str
    commit: str
    upstream_path: str
    basis: str
    local_modification: str
    line: int


@dataclass(frozen=True)
class EvidenceRegistry:
    """持有受控来源证据清单、快照根目录与本次采用的输入指纹。

    Attributes:
        path: 清单文件路径。
        sha256: 清单原始字节的 SHA-256，用于报告本次采用的证据版本。
        snapshots: 受控上游快照根目录；未配置时为 ``None``。
        records: ``local_path`` 到清单记录的映射。
        unparsable: 字段数与表头不一致、无法逐项核验的 ``local_path``。
    """

    path: Path
    sha256: str
    snapshots: Path | None
    records: dict[str, dict[str, object]]
    unparsable: frozenset[str]

    def describe(self) -> dict[str, object]:
        """返回可写入结构化报告的输入指纹，不含任何证据内容。"""

        return {
            "registry": str(self.path),
            "registry_sha256": self.sha256,
            "snapshots": None if self.snapshots is None else str(self.snapshots),
            "records": len(self.records),
        }


class EvidenceError(CheckError):
    """表示受控证据输入不可读或结构不受支持，检查无法完成（退出码 2）。"""


def _text(record: dict[str, object], key: str) -> str:
    """读取清单字段的文本值；字段缺失或为 ``null`` 时返回空串。"""

    value = record.get(key)
    return "" if value is None else str(value).strip()


def _provenance_tag_errors(javadoc: str) -> list[str]:
    """识别自造的来源块标签；来源说明只能写在职责 JavaDoc 正文。

    Args:
        javadoc: 完整 JavaDoc 文本。

    Returns:
        自造标签的拒绝原因列表；没有时为空白列表。
    """

    errors = []
    for line in _javadoc_body_lines(javadoc):
        match = PROVENANCE_TAG_PATTERN.match(line.strip())
        if match is not None:
            errors.append(f"自造块标签 @{match.group('tag')} 不能代替正文来源说明")
    return errors


def _javadoc_body_lines(javadoc: str) -> list[str]:
    """把 JavaDoc 拆成正文行，去掉 ``/**``、``*/`` 与每行前导星号。

    Args:
        javadoc: 完整 JavaDoc 文本。

    Returns:
        与源码行一一对应的正文行列表，行内不含注释边框。
    """

    text = javadoc
    if text.startswith("/**"):
        text = text[3:]
    if text.endswith("*/"):
        text = text[:-2]
    lines = []
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("*"):
            line = line[1:]
            if line.startswith(" "):
                line = line[1:]
        lines.append(line.rstrip())
    return lines


def _parse_source_header(line: str) -> tuple[tuple[str, str] | None, str | None]:
    """解析来源说明首行，返回 ``((仓库标识, 提交), 错误说明)``。

    Args:
        line: JavaDoc 正文中的首行文本。

    Returns:
        语法完全匹配时返回仓库标识与完整 SHA；否则返回可直接展示的拒绝原因。
    """

    match = SOURCE_HEADER_PATTERN.match(line)
    if match is not None:
        return (match.group("repository"), match.group("commit")), None
    if not line.startswith(SOURCE_HEADER_PREFIX):
        return None, f"来源说明首行必须以“{SOURCE_HEADER_PREFIX}”开头：{line!r}"
    rest = line[len(SOURCE_HEADER_PREFIX) :]
    if SOURCE_DECLARATION_SUFFIX not in rest:
        return None, "来源说明首行缺少“（该版本未声明作者）”限定，不能断言该固定版本未声明作者"
    body = rest.split(SOURCE_DECLARATION_SUFFIX)[0].strip()
    if " @ " not in body:
        return None, f"来源说明首行缺少“ @ ”提交引用：{line!r}"
    repository, _, reference = body.rpartition(" @ ")
    repository = repository.strip()
    reference = reference.strip()
    if not SOURCE_REPOSITORY_PATTERN.match(repository):
        return None, f"仓库标识必须是真实上游 URL 对应的“拥有者/仓库名”：{repository!r}"
    if re.fullmatch(r"[0-9a-fA-F]{7,39}", reference):
        return None, f"提交引用必须是完整 40 位小写十六进制 SHA，不能使用短 SHA：{reference!r}"
    if not COMMIT_PATTERN.match(reference):
        return None, f"提交引用是浮动分支、标签或非法值，必须固定为完整 40 位小写 SHA：{reference!r}"
    return None, f"来源说明首行不符合固定语法：{line!r}"


def _is_safe_upstream_path(path: str) -> bool:
    """判断上游文件行是否为受控的相对路径，拒绝绝对路径与目录穿越。"""

    if not path or path.startswith("/") or "\\" in path or "://" in path:
        return False
    return all(segment not in {"", ".", ".."} for segment in path.split("/"))


def _parse_source_notes(javadoc: str) -> tuple[list[SourceNote], list[str]]:
    """解析类型 JavaDoc 正文中的固定格式来源说明块。

    Args:
        javadoc: 完整 JavaDoc 文本。

    Returns:
        ``(来源说明列表, 格式错误说明列表)``；错误说明可直接用于诊断。
    """

    lines = _javadoc_body_lines(javadoc)
    first_tag = next(
        (index for index, line in enumerate(lines) if line.startswith("@")), len(lines)
    )
    notes: list[SourceNote] = []
    errors: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if not line.startswith(SOURCE_HEADER_PREFIX):
            index += 1
            continue
        if index >= first_tag:
            errors.append(
                f"来源说明必须位于全部块标签之前，当前第 {index + 1} 行在块标签之后"
            )
            index += 1
            continue
        block = lines[index : index + SOURCE_NOTE_LINE_COUNT]
        if len(block) < SOURCE_NOTE_LINE_COUNT:
            errors.append("来源说明不完整：必须依次给出来源、上游文件、来源依据、本地修改四行")
            break
        header, header_error = _parse_source_header(block[0])
        if header is None:
            errors.append(str(header_error))
            index += 1
            continue
        path_match = SOURCE_PATH_PATTERN.match(block[1])
        upstream_path = "" if path_match is None else path_match.group("path").strip()
        if not _is_safe_upstream_path(upstream_path):
            errors.append(f"上游文件行不是有效的上游仓库相对路径：{block[1]!r}")
            index += 1
            continue
        if block[2] not in SOURCE_BASIS_LINES:
            errors.append(f"来源依据行不是固定取值：{block[2]!r}")
            index += 1
            continue
        local_match = SOURCE_LOCAL_PATTERN.match(block[3])
        local_modification = "" if local_match is None else local_match.group("text").strip()
        if not local_modification:
            errors.append(f"本地修改行缺少实际差异说明：{block[3]!r}")
            index += 1
            continue
        notes.append(
            SourceNote(
                repository=header[0],
                commit=header[1],
                upstream_path=upstream_path,
                basis=block[2],
                local_modification=local_modification,
                line=index + 1,
            )
        )
        index += SOURCE_NOTE_LINE_COUNT
    return notes, errors


def _claims_source_evidence(javadoc: str) -> bool:
    """判断 JavaDoc 是否主张来源证据（正文来源句或被塞进 @author 的来源句）。"""

    if any(
        line.startswith(SOURCE_HEADER_PREFIX) for line in _javadoc_body_lines(javadoc)
    ):
        return True
    if _provenance_tag_errors(javadoc):
        return True
    return any(
        AUTHOR_SOURCE_SENTENCE_PATTERN.search(author) is not None
        for author in _author_values(javadoc)
    )


def _repository_identifier(url: str) -> str | None:
    """从上游仓库 URL 提取“拥有者/仓库名”。"""

    value = url.strip()
    if not value:
        return None
    value = re.sub(r"^[A-Za-z][A-Za-z0-9+.-]*://", "", value)
    if "/" not in value.split(":", 1)[0]:
        value = value.split(":", 1)[-1]
    value = value.split("@")[-1]
    value = value.split("?", 1)[0].split("#", 1)[0].rstrip("/")
    if value.endswith(".git"):
        value = value[: -len(".git")]
    parts = [part for part in value.split("/") if part]
    if len(parts) < 2:
        return None
    return f"{parts[-2]}/{parts[-1]}"


def _upstream_author_lines(text: str) -> list[str]:
    """列出上游源码中的作者声明行；版权与许可证主体不算作者姓名。"""

    return [
        line.strip()
        for line in text.splitlines()
        if UPSTREAM_AUTHOR_PATTERN.search(line)
    ]


def _read_json_records(
    path: Path, text: str
) -> tuple[dict[str, dict[str, object]], frozenset[str], tuple[str, ...]]:
    """读取 JSON 形式的受控清单，保留 ``type_evidence`` 的结构化值。"""

    try:
        value = json.loads(text)
    except json.JSONDecodeError as error:
        raise EvidenceError(f"证据清单 JSON 无法解析：{path}：{error}") from error
    if isinstance(value, dict) and "index_schema" in value:
        declared = value["index_schema"]
        if declared != EVIDENCE_INDEX_SCHEMA:
            raise EvidenceError(
                f"派生来源索引 schema 版本不受支持：{declared!r}，期望 {EVIDENCE_INDEX_SCHEMA}"
            )
    items = value.get("records") if isinstance(value, dict) else value
    if not isinstance(items, list) or not all(isinstance(item, dict) for item in items):
        raise EvidenceError(f"证据清单 JSON 必须是记录数组：{path}")
    records: dict[str, dict[str, object]] = {}
    unparsable: set[str] = set()
    columns: set[str] = set()
    for item in items:
        columns.update(str(key) for key in item)
        record = {str(key): value for key, value in item.items()}
        local_path = _text(record, "local_path")
        if not local_path:
            unparsable.add(f"{path}:<缺少 local_path>")
            continue
        records[local_path] = record
    return records, frozenset(unparsable), tuple(sorted(columns))


def _read_tsv_records(
    text: str,
) -> tuple[dict[str, dict[str, object]], frozenset[str], tuple[str, ...]]:
    """读取 TSV 形式的受控清单，拒绝重复列名与字段数不一致的记录。

    Raises:
        EvidenceError: 表头存在重复列名，逐列取值不唯一。
    """

    rows = list(csv.reader(text.splitlines(), delimiter="\t"))
    if not rows:
        raise EvidenceError("证据清单为空文件")
    header = [name.strip() for name in rows[0]]
    duplicates = sorted({name for name in header if header.count(name) > 1})
    if duplicates:
        # 重复列名会让“后列覆盖前列”成为隐式优先级，必须显式拒绝并指向派生索引。
        raise EvidenceError(
            "证据清单表头存在重复列名，逐列取值不唯一："
            f"{'、'.join(duplicates)}；请提供唯一列名的受控派生索引（JSON）"
        )
    records: dict[str, dict[str, object]] = {}
    unparsable: set[str] = set()
    for number, row in enumerate(rows[1:], start=2):
        if not row or all(not cell.strip() for cell in row):
            continue
        local_index = header.index("local_path") if "local_path" in header else -1
        local_path = row[local_index].strip() if 0 <= local_index < len(row) else ""
        if len(row) != len(header):
            unparsable.add(local_path or f"第 {number} 行")
            continue
        record = {name: value for name, value in zip(header, row)}
        if not local_path:
            unparsable.add(f"第 {number} 行")
            continue
        records[local_path] = record
    return records, frozenset(unparsable), tuple(header)


def load_evidence_registry(
    registry_path: Path, snapshots_path: Path | None
) -> EvidenceRegistry:
    """读取受控证据清单与快照位置，并记录清单原始字节指纹。

    Args:
        registry_path: 清单文件路径，支持 TSV 与 JSON。
        snapshots_path: 受控上游快照根目录；未配置时为 ``None``。

    Returns:
        已解析的受控清单，含本次采用的输入指纹。

    Raises:
        EvidenceError: 清单或快照位置不可读、清单结构不受支持。
    """

    try:
        raw = registry_path.read_bytes()
    except OSError as error:
        raise EvidenceError(f"证据清单不可读：{registry_path}（{error.strerror or error}）") from error
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise EvidenceError(f"证据清单不是有效 UTF-8：{registry_path}") from error
    if registry_path.suffix.lower() == ".json" or text.lstrip()[:1] in {"[", "{"}:
        records, unparsable, columns = _read_json_records(registry_path, text)
    else:
        records, unparsable, columns = _read_tsv_records(text)
    missing = [name for name in EVIDENCE_REQUIRED_FIELDS if name not in columns]
    if missing:
        raise EvidenceError(
            f"证据清单缺少必需字段，结构不受支持：{'、'.join(missing)}"
        )
    if snapshots_path is not None:
        try:
            readable = snapshots_path.is_dir()
        except OSError as error:
            raise EvidenceError(
                f"证据快照目录不可读：{snapshots_path}（{error.strerror or error}）"
            ) from error
        if not readable:
            raise EvidenceError(f"证据快照目录不可读：{snapshots_path}")
    return EvidenceRegistry(
        path=registry_path,
        sha256=hashlib.sha256(raw).hexdigest(),
        snapshots=snapshots_path,
        records=records,
        unparsable=unparsable,
    )


def _environment_path(name: str) -> Path | None:
    """读取显式配置的证据位置环境变量；未配置时返回 ``None``。"""

    value = os.environ.get(name, "").strip()
    return Path(value).expanduser() if value else None


def resolve_evidence_paths(
    registry: Path | None = None,
    snapshots: Path | None = None,
    root: Path | None = None,
) -> tuple[Path | None, Path | None, str]:
    """按“命令行参数 > 环境变量 > 仓库内受控默认索引”解析证据位置。

    Args:
        registry: ``--evidence-registry`` 指定的清单路径。
        snapshots: ``--evidence-snapshots`` 指定的快照根目录。
        root: 被检查仓库根目录；提供时才使用仓库内默认索引。

    Returns:
        ``(清单路径或 None, 快照路径或 None, 来源标识)``。来源标识为
        ``argument``/``environment``/``repository-default``/``absent``，用于报告
        本次采用的输入来自哪里。显式配置不可读时不再回落到默认位置。
    """

    registry_path = registry if registry is not None else _environment_path(EVIDENCE_REGISTRY_ENV)
    snapshots_path = (
        snapshots if snapshots is not None else _environment_path(EVIDENCE_SNAPSHOTS_ENV)
    )
    if registry is not None:
        source = "argument"
    elif registry_path is not None:
        source = "environment"
    elif root is not None and (root / DEFAULT_EVIDENCE_REGISTRY).is_file():
        # 只显式配置快照时仍然使用仓库内受控索引，离线复核不必重复指定清单。
        registry_path = root / DEFAULT_EVIDENCE_REGISTRY
        source = "repository-default"
    else:
        source = "absent"
    return registry_path, snapshots_path, source


def _resolve_evidence(
    registry: Path | None, snapshots: Path | None, root: Path | None = None
) -> EvidenceRegistry | None:
    """解析并加载受控证据输入，未配置任何位置时返回 ``None``。

    Args:
        registry: ``--evidence-registry`` 指定的清单路径。
        snapshots: ``--evidence-snapshots`` 指定的快照根目录。
        root: 被检查仓库根目录；提供时才允许使用仓库内默认索引。

    Returns:
        已加载的受控清单；没有任何清单位置时返回 ``None``。

    Raises:
        EvidenceError: 配置不完整，或清单与快照位置不可读、结构不受支持。
    """

    registry_path, snapshots_path, _ = resolve_evidence_paths(registry, snapshots, root)
    if registry_path is None and snapshots_path is None:
        return None
    if registry_path is None:
        raise EvidenceError(
            f"配置了受控快照但没有来源证据清单，请设置 {EVIDENCE_REGISTRY_ENV} 或 --evidence-registry"
        )
    return load_evidence_registry(registry_path, snapshots_path)


@lru_cache(maxsize=8)
def _cached_evidence(registry: str, snapshots: str, root: str) -> EvidenceRegistry | None:
    """按路径缓存同一进程内重复使用的受控清单，避免逐文件重读账本。"""

    return _resolve_evidence(
        Path(registry) if registry else None,
        Path(snapshots) if snapshots else None,
        Path(root) if root else None,
    )


def _configured_evidence() -> EvidenceRegistry | None:
    """读取仅由环境变量配置的受控证据输入，不启用仓库内默认索引。

    全量入口在 ``main`` 中显式解析默认位置并传入，这里保持“只认显式配置”
    的语义，供不接收根目录的既有调用方继续使用。
    """

    return _cached_evidence(
        os.environ.get(EVIDENCE_REGISTRY_ENV, "").strip(),
        os.environ.get(EVIDENCE_SNAPSHOTS_ENV, "").strip(),
        "",
    )


def evidence_cli_arguments(root: Path | None = None) -> tuple[list[str], str]:
    """解析受控证据位置，返回子检查参数与可读的输入指纹说明。

    Args:
        root: 被检查仓库根目录；用于解析仓库内默认索引。

    Returns:
        ``(命令行参数, 说明)``。清单不可读时不退回“无证据”语义：参数仍然指向
        该位置，由子检查以非零退出报告真实原因，说明中同时保留原因。
    """

    registry, snapshots, _ = resolve_evidence_paths(root=root)
    arguments: list[str] = []
    if registry is not None:
        arguments = ["--evidence-registry", str(registry)]
        if snapshots is not None:
            arguments.extend(["--evidence-snapshots", str(snapshots)])
    try:
        loaded = load_evidence_registry(registry, snapshots) if registry is not None else None
    except EvidenceError as error:
        return arguments, f"Java 注释检查证据输入不可用：{error}"
    return arguments, _describe_evidence(loaded)


def _git_head(directory: Path) -> str | None:
    """读取快照检出目录的 HEAD 提交；不是 Git 检出时返回 ``None``。"""

    try:
        output = _run_git(["-C", str(directory), "rev-parse", "HEAD"])
    except RuntimeError:
        return None
    return output.strip() if isinstance(output, str) else None


def _resolve_snapshot(
    root: Path, repository: str, commit: str, upstream_path: str
) -> Path | None:
    """在受控快照根目录中定位固定提交的对应上游文件。

    依次尝试 ``<仓库名>@<提交>/``、``<仓库名>/<提交>/`` 和固定见证版本检出目录；
    检出目录只在 HEAD 等于该提交时才作为固定版本使用。
    """

    name = repository.split("/", 1)[-1]
    for candidate in (root / f"{name}@{commit}" / upstream_path, root / name / commit / upstream_path):
        if candidate.is_file():
            return candidate
    checkout = root / name
    if checkout.is_dir() and _git_head(checkout) == commit:
        target = checkout / upstream_path
        if target.is_file():
            return target
    return None


def _fixed_content_url(
    file_url: str, repository: str, commit: str, upstream_path: str
) -> tuple[str | None, str | None]:
    """校验清单登记的固定地址并转换为可重取的内容地址。

    地址必须使用 https、固定在登记的提交上并指向登记的上游文件；GitHub 的
    ``blob`` 页面地址转换为同提交的 ``raw`` 内容地址。只把固定地址当作来源，
    不把上游正文复制进仓库。

    Args:
        file_url: 清单 ``upstream_file_url`` 登记的固定地址。
        repository: 来源说明中的“拥有者/仓库名”。
        commit: 固定的完整提交 SHA。
        upstream_path: 上游仓库相对路径。

    Returns:
        ``(可重取内容地址, 错误说明)``；地址合法时错误说明为 ``None``。
    """

    value = file_url.strip()
    if not value:
        return None, "清单缺少可重取的 upstream_file_url 固定地址"
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "https" or not parsed.netloc:
        return None, f"upstream_file_url 必须是 https 固定地址：{value}"
    segments = [urllib.parse.unquote(part) for part in parsed.path.split("/") if part]
    if commit not in segments:
        return None, f"upstream_file_url 未固定在登记的提交 {commit}：{value}"
    index = segments.index(commit)
    tail = "/".join(segments[index + 1 :])
    if tail != upstream_path:
        return None, f"upstream_file_url 指向的路径不是登记的上游文件 {upstream_path}：{value}"
    host = parsed.netloc.lower()
    if host in {"github.com", "www.github.com", "raw.githubusercontent.com"}:
        owner_repo = "/".join(segments[:2])
        if owner_repo != repository:
            return None, (
                f"upstream_file_url 的仓库与来源说明不一致：地址 {owner_repo}，来源 {repository}"
            )
    if host in {"github.com", "www.github.com"}:
        if len(segments) < 4 or segments[2] != "blob":
            return None, f"upstream_file_url 不是固定提交的 blob 地址：{value}"
        return (
            f"https://raw.githubusercontent.com/{segments[0]}/{segments[1]}/{commit}/{tail}",
            None,
        )
    return value, None


@lru_cache(maxsize=512)
def _fetch_upstream_bytes(url: str) -> bytes:
    """按固定地址取回上游内容，只返回原始字节供调用方复算指纹。

    瞬时的连接中断与超时按固定次数重试；重试仍失败时抛出真实异常，由调用方
    转换为“取不回”的拒绝原因，不把网络故障当作内容通过。

    Raises:
        OSError: 网络不可达、HTTP 错误或响应超过字节上限。
    """

    request = urllib.request.Request(url, headers={"User-Agent": "basic-framework-quality-gate"})
    last_error: OSError | None = None
    for attempt in range(EVIDENCE_FETCH_ATTEMPTS):
        if attempt:
            time.sleep(EVIDENCE_FETCH_BACKOFF_SECONDS * attempt)
        try:
            with urllib.request.urlopen(request, timeout=EVIDENCE_FETCH_TIMEOUT_SECONDS) as response:
                raw = response.read(MAX_UPSTREAM_BYTES + 1)
        except (OSError, ValueError) as error:
            last_error = error if isinstance(error, OSError) else OSError(str(error))
            continue
        if len(raw) > MAX_UPSTREAM_BYTES:
            raise OSError(f"上游内容超过 {MAX_UPSTREAM_BYTES} 字节上限")
        return raw
    assert last_error is not None
    raise last_error


def _verify_upstream_content(
    raw: bytes, expected_sha256: str, subject: str
) -> tuple[str | None, str | None]:
    """复算上游内容指纹并检查作者声明，返回 ``(拒绝原因, 实测指纹)``。"""

    digest = hashlib.sha256(raw).hexdigest()
    if digest != expected_sha256:
        return f"{subject}实测指纹 {digest} 与清单 {expected_sha256} 不符", digest
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return f"{subject}不是有效 UTF-8", digest
    authors = _upstream_author_lines(text)
    if authors:
        return f"上游该固定版本存在作者声明，必须保留作者：{authors[0]}", digest
    return None, digest


def _verify_upstream_snapshot(
    registry: EvidenceRegistry,
    *,
    repository: str,
    commit: str,
    upstream_path: str,
    expected_sha256: str,
    file_url: str | None = None,
) -> tuple[str | None, str | None]:
    """复核固定上游内容：受控快照优先，缺失时按固定地址取回并复算指纹。

    Args:
        registry: 受控证据清单，含快照根目录。
        repository: 来源说明中的“拥有者/仓库名”。
        commit: 来源说明中的完整提交 SHA。
        upstream_path: 来源说明中的上游仓库相对路径。
        expected_sha256: 清单登记的上游内容 SHA-256。
        file_url: 清单登记的固定重取地址；快照缺失时使用。

    Returns:
        ``(拒绝原因, 实测指纹)``；拒绝原因为 ``None`` 时该内容通过复核。
    """

    if registry.snapshots is not None:
        candidate = _resolve_snapshot(registry.snapshots, repository, commit, upstream_path)
        if candidate is not None:
            try:
                raw = candidate.read_bytes()
            except OSError as error:
                return f"上游快照不可读：{candidate}（{error.strerror or error}）", None
            return _verify_upstream_content(raw, expected_sha256, "上游内容")
    content_url, url_error = _fixed_content_url(file_url or "", repository, commit, upstream_path)
    if url_error:
        return url_error, None
    try:
        raw = _fetch_upstream_bytes(content_url)
    except (OSError, ValueError) as error:
        detail = getattr(error, "reason", None) or error
        return (
            f"无法从固定地址取回上游内容 {content_url}（{type(error).__name__}: {detail}）"
            f"；可设置 {EVIDENCE_SNAPSHOTS_ENV} 提供受控快照",
            None,
        )
    return _verify_upstream_content(raw, expected_sha256, "上游内容")


def _type_evidence_value(
    record: dict[str, object],
) -> tuple[dict[str, object] | None, str | None]:
    """读取清单记录的逐类型映射，并校验其 schema 版本。"""

    raw = record.get("type_evidence")
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None, "清单缺少逐类型映射（type_evidence），不能凭文件名授权文件内所有类型"
    if isinstance(raw, str):
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            return None, "清单的 type_evidence 不是有效 JSON"
    else:
        value = raw
    if not isinstance(value, dict):
        return None, "清单的 type_evidence 必须是结构化对象"
    if value.get("schema") != EVIDENCE_SCHEMA:
        return None, f"逐类型映射 schema 不是 {EVIDENCE_SCHEMA}"
    if not isinstance(value.get("types"), list):
        return None, "逐类型映射缺少 types 数组"
    return value, None


def _review_conclusion_reason(conclusion: str, subject: str) -> str | None:
    """判断逐项复核结论是否指向被复核对象且给出了独立结论。"""

    if not conclusion:
        return "清单缺少逐项复核结论"
    if subject and subject not in conclusion:
        return f"逐项复核结论没有指向被复核对象 {subject}，不能只写跨字段引用"
    stripped = REVIEW_CROSS_REFERENCE_PATTERN.sub("", conclusion)
    stripped = re.sub(r"[\s，。；、：:（）()【】\[\]的以及和与]", "", stripped)
    if len(stripped) < 6:
        return f"逐项复核结论只指向其他字段，未给出独立结论：{conclusion!r}"
    return None


def _review_reasons(record: dict[str, object], subject: str) -> list[str]:
    """校验逐项复核人、复核日期与复核结论。"""

    reasons = []
    if not _text(record, "review_by"):
        reasons.append("清单缺少逐项复核人 review_by")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", _text(record, "review_date")):
        reasons.append("清单缺少逐项复核日期 review_date（YYYY-MM-DD）")
    conclusion_reason = _review_conclusion_reason(_text(record, "review_conclusion"), subject)
    if conclusion_reason:
        reasons.append(conclusion_reason)
    return reasons


def _upstream_binding_reasons(record: dict[str, object], note: SourceNote) -> list[str]:
    """校验来源说明与清单登记的上游仓库、提交、路径和作者结论一致。"""

    reasons = []
    repository = _repository_identifier(_text(record, "upstream_repo_url"))
    if repository is None:
        reasons.append("清单缺少可解析的上游仓库 URL")
    elif repository != note.repository:
        reasons.append(f"来源仓库标识与清单不一致：注释 {note.repository}，清单 {repository}")
    commit = _text(record, "upstream_commit")
    if not COMMIT_PATTERN.match(commit):
        reasons.append("清单的上游提交不是完整 40 位小写 SHA")
    elif commit != note.commit:
        reasons.append(f"固定提交与清单不一致：注释 {note.commit}，清单 {commit}")
    upstream_path = _text(record, "upstream_path")
    if upstream_path != note.upstream_path:
        reasons.append(
            f"上游文件路径与清单不一致：注释 {note.upstream_path}，清单 {upstream_path or '空'}"
        )
    author_lines = _text(record, "upstream_author_lines")
    if author_lines:
        reasons.append(f"清单登记上游存在作者声明，必须保留作者：{author_lines}")
    return reasons


def _history_reasons(
    record: dict[str, object], note: SourceNote, registry: EvidenceRegistry
) -> list[str]:
    """校验来源依据行与清单登记的历史见证或引入版本记录一致。"""

    if note.basis == SOURCE_BASIS_FIXED:
        reasons = []
        if not _text(record, "history_basis"):
            reasons.append("清单缺少 history_basis 见证与引入版本的关系")
        if not _text(record, "open_gap"):
            reasons.append("固定见证版本路径必须在清单 open_gap 登记历史引入版本缺口")
        return reasons
    value, error = _type_evidence_value(record)
    if value is None:
        return [f"来源依据写成已核实引入版本，但{error}"]
    history = value.get("history")
    if not isinstance(history, dict) or history.get("basis") != EVIDENCE_HISTORY_BASIS:
        return ["来源依据写成已核实引入版本，但清单没有绑定已核实的引入版本记录"]
    reasons = []
    commit = _text(history, "introduced_commit")
    if not COMMIT_PATTERN.match(commit):
        return ["引入版本提交必须是完整 40 位小写 SHA"]
    if _repository_identifier(_text(history, "introduced_repo_url")) != note.repository:
        reasons.append("引入版本仓库与来源说明的仓库标识不一致")
    upstream_path = _text(history, "introduced_path")
    if not _is_safe_upstream_path(upstream_path):
        return reasons + ["引入版本路径不是有效的上游仓库相对路径"]
    digest = _text(history, "introduced_sha256").lower()
    if not SHA256_PATTERN.match(digest):
        return reasons + ["引入版本缺少有效的内容 SHA-256"]
    snapshot_reason, _ = _verify_upstream_snapshot(
        registry,
        repository=note.repository,
        commit=commit,
        upstream_path=upstream_path,
        expected_sha256=digest,
        file_url=_text(history, "file_url"),
    )
    if snapshot_reason:
        reasons.append(f"引入版本快照未通过核验：{snapshot_reason}")
    return reasons


def _route_reasons(record: dict[str, object]) -> list[str]:
    """校验证据路线取值与路线 3 的独立对应点结构。

    Note:
        机器校验只能确认“两个互不相同的对应点各自给出了双方行号”这一结构，
        有区分力的对应与身份贡献仍需人工判断。
    """

    route = _text(record, "evidence_route")
    if route not in EVIDENCE_ROUTES:
        return [f"证据路线不受支持：{route or '空'}"]
    points = _text(record, "evidence_points")
    if not points:
        return ["缺少 evidence_points 比对依据"]
    if route == "路线 3":
        segments = [segment.strip() for segment in re.split(r"[；;]", points) if segment.strip()]
        if len(segments) < 2 or len(set(segments)) < 2:
            return ["路线 3 的 evidence_points 必须有两个独立且有区分力的对应点"]
        if not all(len(re.findall(r"\d+", segment)) >= 2 for segment in segments):
            return ["路线 3 的每个对应点都必须给出双方行号"]
    return []


def _type_mapping_reasons(
    record: dict[str, object],
    declaration: TypeDeclaration,
    javadoc: str,
    qualified_name: str,
    enclosing_type: str | None,
) -> list[str]:
    """校验逐类型映射：限定名、嵌套关系、绑定 JavaDoc 与上游类型。"""

    value, error = _type_evidence_value(record)
    if value is None:
        return [str(error)]
    entry = None
    for candidate in value["types"]:  # type: ignore[union-attr]
        if not isinstance(candidate, dict):
            continue
        if candidate.get("qualified_name") != qualified_name:
            continue
        if bool(candidate.get("nested")) != bool(enclosing_type):
            continue
        if candidate.get("simple_name") not in (None, declaration.name):
            continue
        if candidate.get("kind") not in (None, declaration.kind):
            continue
        entry = candidate
        break
    if entry is None:
        return [f"逐类型映射中没有 {qualified_name} 的条目，目标类型没有对象级授权"]
    reasons = []
    if entry.get("upstream_author_declared") is not False:
        reasons.append(f"逐类型映射没有确认上游对应内容未声明作者：{qualified_name}")
    recorded_javadoc = _text(entry, "javadoc_sha256").lower()
    if not SHA256_PATTERN.match(recorded_javadoc):
        reasons.append("逐类型映射缺少绑定 JavaDoc 的 SHA-256")
    elif recorded_javadoc != hashlib.sha256(javadoc.encode("utf-8")).hexdigest():
        reasons.append("绑定 JavaDoc 指纹不符，来源说明必须由清单绑定当前类型的 JavaDoc")
    if enclosing_type is not None and _text(entry, "enclosing_type") != enclosing_type:
        reasons.append(f"逐类型映射的外层类型不是 {enclosing_type}")
    if not _text(entry, "upstream_type"):
        reasons.append("逐类型映射缺少上游类型或片段")
    reasons.extend(_review_reasons(entry, declaration.name))
    return reasons


def _local_modification_reasons(record: dict[str, object], note: SourceNote) -> list[str]:
    """校验本地修改行与清单记录的实际差异一致。"""

    facts = _text(record, "local_modification_facts")
    if facts.rstrip("。").casefold() in LOCAL_MODIFICATION_NONE_MARKERS:
        if note.local_modification.strip() != LOCAL_MODIFICATION_NONE_LINE:
            return [
                "清单记录该文件相对来源没有本地修改，本地修改行必须写"
                f"“{LOCAL_MODIFICATION_NONE_LINE}”：{note.local_modification!r}"
            ]
        return []
    if note.local_modification.rstrip("。").casefold() in LOCAL_MODIFICATION_NONE_MARKERS:
        return ["清单记录了实际本地修改，本地修改行不能写“无。”"]
    if len(note.local_modification) < 4:
        return [f"本地修改行缺少实际差异说明：{note.local_modification!r}"]
    return []


def _record_sources(
    record: dict[str, object],
) -> tuple[list[dict[str, object]] | None, str | None]:
    """读取清单记录的多来源登记。

    Returns:
        ``(来源条目列表或 None, 错误说明)``；没有 ``sources`` 扩展时返回 ``None``，
        表示按记录的单来源字段核验。
    """

    raw = record.get("type_evidence")
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None, None
    if isinstance(raw, str):
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            return None, None
    else:
        value = raw
    if not isinstance(value, dict) or "sources" not in value:
        return None, None
    sources = value.get("sources")
    if (
        not isinstance(sources, list)
        or not sources
        or not all(isinstance(item, dict) for item in sources)
    ):
        return None, "清单的多来源登记（sources）必须是至少一条结构化记录"
    return sources, None


def _source_entry_matches(entry: dict[str, object], note: SourceNote) -> bool:
    """判断多来源登记条目是否与来源说明块指向同一固定版本。"""

    return (
        _text(entry, "repository") == note.repository
        and _text(entry, "commit") == note.commit
        and _text(entry, "path") == note.upstream_path
    )


def _source_entry_reasons(
    entry: dict[str, object], note: SourceNote, registry: EvidenceRegistry
) -> list[str]:
    """核验多来源登记条目的无作者结论与快照指纹。"""

    reasons = []
    if entry.get("author_declared") is not False:
        reasons.append(f"多来源登记未确认 {note.repository} 该固定版本未声明作者")
    digest = _text(entry, "sha256").lower()
    if not SHA256_PATTERN.match(digest):
        return reasons + [f"多来源登记缺少 {note.upstream_path} 的内容 SHA-256"]
    snapshot_reason, _ = _verify_upstream_snapshot(
        registry,
        repository=note.repository,
        commit=note.commit,
        upstream_path=note.upstream_path,
        expected_sha256=digest,
        file_url=_text(entry, "file_url"),
    )
    if snapshot_reason:
        reasons.append(snapshot_reason)
    return reasons


def _declared_author_sources(sources: list[dict[str, object]]) -> list[str]:
    """列出多来源登记中已声明作者的来源，供保留作者判断。"""

    return [
        f"{_text(entry, 'repository')} @ {_text(entry, 'commit')} {_text(entry, 'path')}"
        for entry in sources
        if entry.get("author_declared") is True
    ]


def _verify_single_note(
    path: str,
    record: dict[str, object],
    declaration: TypeDeclaration,
    javadoc: str,
    note: SourceNote,
    qualified_name: str,
    enclosing_type: str | None,
    registry: EvidenceRegistry,
    local_sha256: str,
) -> list[str]:
    """核验单条来源说明的逐项证据，返回全部拒绝原因。"""

    if path in registry.unparsable:
        return [f"清单记录字段数与表头不一致，无法逐项核验：{path}"]
    reasons = []
    status = _text(record, "author_status")
    if status != AUTHOR_UNDECLARED_STATUS:
        reasons.append(f"清单状态是“{status or '空'}”，不是“{AUTHOR_UNDECLARED_STATUS}”")
    recorded_local = _text(record, "local_sha256_after").lower()
    if not SHA256_PATTERN.match(recorded_local):
        reasons.append("清单缺少有效的本地最终 SHA-256")
    elif recorded_local != local_sha256:
        reasons.append(f"本地最终指纹不符：清单 {recorded_local}，实测 {local_sha256}")
    # 先给对象级授权与复核结论，再给上游定位与内容核验，避免诊断被次要原因挤满。
    reasons.extend(
        _type_mapping_reasons(record, declaration, javadoc, qualified_name, enclosing_type)
    )
    reasons.extend(_review_reasons(record, declaration.name))
    reasons.extend(_route_reasons(record))
    reasons.extend(_history_reasons(record, note, registry))
    sources, sources_error = _record_sources(record)
    if sources_error:
        reasons.append(sources_error)
    elif sources is None:
        reasons.extend(_upstream_binding_reasons(record, note))
        expected_upstream = _text(record, "upstream_sha256").lower()
        if not SHA256_PATTERN.match(expected_upstream):
            reasons.append("清单缺少有效的上游内容 SHA-256")
        else:
            snapshot_reason, _ = _verify_upstream_snapshot(
                registry,
                repository=note.repository,
                commit=note.commit,
                upstream_path=note.upstream_path,
                expected_sha256=expected_upstream,
                file_url=_text(record, "upstream_file_url"),
            )
            if snapshot_reason:
                reasons.append(snapshot_reason)
    else:
        matched = next(
            (entry for entry in sources if _source_entry_matches(entry, note)), None
        )
        if matched is None:
            reasons.append(
                "清单的多来源登记中没有 "
                f"{note.repository} @ {note.commit} {note.upstream_path} 的条目"
            )
        else:
            reasons.extend(_source_entry_reasons(matched, note, registry))
    reasons.extend(_local_modification_reasons(record, note))
    return reasons


def _verify_source_notes(
    path: str,
    declaration: TypeDeclaration,
    javadoc: str,
    notes: list[SourceNote],
    qualified_name: str,
    enclosing_type: str | None,
    registry: EvidenceRegistry | None,
    local_sha256: str | None,
) -> list[str]:
    """核验 public 类型全部来源说明的逐项证据。

    Args:
        path: 仓库相对路径。
        declaration: 待核验的 public 类型声明。
        javadoc: 该类型绑定的完整 JavaDoc 文本。
        notes: 已解析的来源说明列表，多来源逐条核验。
        qualified_name: 含外层类型链的类型限定名。
        enclosing_type: 外层类型限定名；顶层类型为 ``None``。
        registry: 受控证据清单；未配置时为 ``None``。
        local_sha256: 当前对象原始字节的 SHA-256。

    Returns:
        逐条拒绝原因；为空表示该类型的来源例外成立。
    """

    if registry is None:
        return ["未提供受控证据清单，来源说明没有逐项依据"]
    if local_sha256 is None:
        return ["当前对象没有可核验的原始字节指纹"]
    if path in registry.unparsable:
        return [f"清单记录字段数与表头不一致，无法逐项核验：{path}"]
    record = registry.records.get(path)
    if record is None:
        return [f"清单中没有 {path} 的逐项记录，来源说明没有逐项依据"]
    reasons: list[str] = []
    for note in notes:
        reasons.extend(
            _verify_single_note(
                path,
                record,
                declaration,
                javadoc,
                note,
                qualified_name,
                enclosing_type,
                registry,
                local_sha256,
            )
        )
    if reasons:
        return reasons
    sources, _ = _record_sources(record)
    declared = (
        _declared_author_sources(sources)
        if sources is not None
        else ([_text(record, "upstream_author_lines")] if _text(record, "upstream_author_lines") else [])
    )
    if declared and not _has_actual_author(javadoc):
        return [
            "清单登记的其他来源存在作者声明，必须保留准确作者，"
            "不能用一个无作者来源覆盖其他来源："
            + "；".join(declared[:2])
        ]
    return reasons


def _package_name(masked: str) -> str:
    """读取源码的 package 声明，用于构造类型限定名。"""

    match = re.search(
        r"(?m)^[ \t]*package[ \t]+"
        r"([A-Za-z_$][\w$]*(?:[ \t]*\.[ \t]*[A-Za-z_$][\w$]*)*)[ \t]*;",
        masked,
    )
    return "" if match is None else re.sub(r"\s+", "", match.group(1))


def _qualified_type_names(
    declarations: list[TypeDeclaration], declaration: TypeDeclaration, package: str
) -> tuple[str | None, str]:
    """返回类型的外层类型限定名与自身限定名。

    Args:
        declarations: 全部类型声明。
        declaration: 待定位的类型声明。
        package: 源码的 package 名称；默认包为空串。

    Returns:
        ``(外层类型限定名或 None, 类型限定名)``；嵌套类型必须各有自己的映射条目。
    """

    chain = sorted(
        (
            item
            for item in declarations
            if item.open_brace < declaration.open_brace < item.close_brace
        ),
        key=lambda item: item.open_brace,
    )
    names = ([package] if package else []) + [item.name for item in chain]
    return (".".join(names) if chain else None), ".".join([*names, declaration.name])


def _scan_types(
    path: str,
    source: str,
    starts: list[int],
    added_lines: set[int],
    declarations: list[TypeDeclaration],
    *,
    evidence: EvidenceRegistry | None = None,
    local_sha256: str | None = None,
) -> list[Finding]:
    """检查本次新增或修改的类型声明 JavaDoc。

    Args:
        path: 仓库相对路径。
        source: 原始 Java 源码。
        starts: 行起始偏移列表。
        added_lines: 暂存差异中的新增行号。
        declarations: 已解析的类型声明。
        evidence: 受控来源证据清单；未配置时为 ``None``。
        local_sha256: 当前对象原始字节的 SHA-256。

    Returns:
        类型注释问题列表。主张来源证据的类型即使声明行未变也会被检查。
    """

    findings = []
    package = _package_name(_mask_java(source))
    for declaration in declarations:
        javadoc = _attached_javadoc(source, declaration.declaration_offset)
        span = _attached_javadoc_span(source, declaration.declaration_offset)
        claims = javadoc is not None and _claims_source_evidence(javadoc)
        touched = _intersects_added_lines(
            starts,
            declaration.declaration_offset,
            declaration.open_brace,
            added_lines,
        ) or (
            span is not None
            and _intersects_added_lines(starts, span[0], span[1], added_lines)
        )
        if not claims and not touched:
            continue
        line = _line_number(starts, declaration.name_offset)
        if javadoc is None:
            findings.append(
                Finding(
                    path,
                    line,
                    "type-javadoc",
                    f"类型 {declaration.name} 缺少职责 JavaDoc",
                )
            )
            continue
        if not declaration.public:
            continue
        notes, note_errors = _parse_source_notes(javadoc)
        note_errors.extend(_provenance_tag_errors(javadoc))
        if note_errors:
            findings.append(
                Finding(
                    path,
                    line,
                    "type-author",
                    f"public 类型 {declaration.name} 的来源说明无效：{'；'.join(note_errors)}",
                    True,
                )
            )
            continue
        if notes:
            enclosing, qualified = _qualified_type_names(declarations, declaration, package)
            reasons = _verify_source_notes(
                path,
                declaration,
                javadoc,
                notes,
                qualified,
                enclosing,
                evidence,
                local_sha256,
            )
            if reasons:
                findings.append(
                    Finding(
                        path,
                        line,
                        "type-author",
                        f"public 类型 {declaration.name} 的来源说明未被逐项证据支持："
                        f"{'；'.join(reasons[:3])}",
                        True,
                    )
                )
            continue
        if not _has_actual_author(javadoc):
            findings.append(
                Finding(
                    path,
                    line,
                    "type-author",
                    f"public 类型 {declaration.name} 的 JavaDoc 缺少非占位的 @author "
                    "实际作者，也没有本裁决格式的来源说明",
                    claims,
                )
            )
    return findings


def _method_end(masked: str, close_paren: int) -> int | None:
    """确认右括号之后是否构成方法或构造方法声明。

    Args:
        masked: 已屏蔽注释和字面量的源码。
        close_paren: 参数列表右括号偏移。

    Returns:
        声明结束的左大括号或分号偏移；不是方法声明时返回 ``None``。
    """

    tail = masked[close_paren + 1 :]
    match = re.match(
        r"\s*(?:\[\]\s*)*"
        r"(?:throws\s+[A-Za-z_$][A-Za-z0-9_$.,<>?\[\] @\s]*\s*)?"
        r"(?:default\s+[^;{}]+\s*)?"
        r"(?P<end>[;{])",
        tail,
    )
    if match is None:
        return None
    return close_paren + 1 + match.start("end")


def _enum_constants_end(
    declaration: TypeDeclaration, masked: str, brace_depths: list[int]
) -> int:
    """定位枚举常量区结束分号；没有分号时返回类型右大括号。

    Args:
        declaration: 枚举类型声明。
        masked: 已屏蔽注释和字面量的源码。
        brace_depths: 每个字符之前的大括号深度。

    Returns:
        枚举常量区结束偏移。
    """

    member_depth = declaration.outer_depth + 1
    for index in range(declaration.open_brace + 1, declaration.close_brace):
        if masked[index] == ";" and brace_depths[index] == member_depth:
            return index
    return declaration.close_brace


def _has_top_level_assignment(fragment: str) -> bool:
    """判断成员片段是否在参数括号之外包含赋值或 Lambda 箭头。

    Args:
        fragment: 待分析的成员片段。

    Returns:
        存在字段初始化或 Lambda 表达式特征时返回 ``True``。
    """

    depth = 0
    index = 0
    while index < len(fragment):
        char = fragment[index]
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(0, depth - 1)
        elif depth == 0 and char == "=":
            return True
        elif depth == 0 and fragment.startswith("->", index):
            return True
        index += 1
    return False


def _scan_methods(
    path: str,
    source: str,
    masked: str,
    starts: list[int],
    added_lines: set[int],
    brace_depths: list[int],
    paren_pairs: dict[int, int],
    declarations: list[TypeDeclaration],
) -> list[Finding]:
    """检查本次新增或修改的方法和构造方法 JavaDoc。

    Args:
        path: 仓库相对路径。
        source: 原始 Java 源码。
        masked: 已屏蔽注释和字面量的源码。
        starts: 行起始偏移列表。
        added_lines: 暂存差异中的新增行号。
        brace_depths: 每个字符之前的大括号深度。
        paren_pairs: 左右小括号偏移映射。
        declarations: 已解析的类型声明。

    Returns:
        方法和构造方法注释问题列表。
    """

    findings = []
    visited: set[tuple[int, int]] = set()
    for open_paren, close_paren in paren_pairs.items():
        enclosing = _enclosing_type(
            declarations, open_paren, brace_depths[open_paren]
        )
        if enclosing is None:
            continue
        if (
            enclosing.kind == "enum"
            and open_paren
            < _enum_constants_end(enclosing, masked, brace_depths)
        ):
            continue
        name_match = IDENTIFIER_BEFORE_PAREN_PATTERN.search(masked[:open_paren])
        if name_match is None:
            continue
        name = name_match.group("name")
        if name in CONTROL_KEYWORDS:
            continue
        name_offset = name_match.start("name")
        if name_offset > 0 and masked[name_offset - 1] in {".", "@"}:
            continue
        member_depth = enclosing.outer_depth + 1
        segment_start = _member_start(
            masked, brace_depths, name_offset, member_depth
        )
        declaration_offset = _first_code_offset(masked, segment_start, name_offset + 1)
        fragment = masked[declaration_offset:open_paren]
        stripped, _ = _strip_leading_annotations(fragment)
        core_before_paren = stripped.rstrip()
        if not core_before_paren or _has_top_level_assignment(core_before_paren):
            continue
        if re.search(r"\b(?:class|interface|enum|record|new|return|throw)\b", core_before_paren):
            continue
        core_name_match = IDENTIFIER_BEFORE_PAREN_PATTERN.search(core_before_paren)
        if core_name_match is None or core_name_match.group("name") != name:
            continue
        before_name = core_before_paren[: core_name_match.start("name")].rstrip()
        if name != enclosing.name and not before_name:
            continue
        end_offset = _method_end(masked, close_paren)
        if end_offset is None or brace_depths[end_offset] != member_depth:
            continue
        key = (name_offset, end_offset)
        if key in visited:
            continue
        visited.add(key)
        # JavaDoc 位于注解之前，因此关联判断仍使用包含首个注解的原始声明起点。
        if not _intersects_added_lines(
            starts, declaration_offset, end_offset, added_lines
        ):
            continue
        if _attached_javadoc(source, declaration_offset) is None:
            declaration_kind = "构造方法" if name == enclosing.name else "方法"
            findings.append(
                Finding(
                    path,
                    _line_number(starts, name_offset),
                    "method-javadoc",
                    f"{declaration_kind} {name} 缺少职责 JavaDoc",
                )
            )
    return findings


def _scan_compact_record_constructors(
    path: str,
    source: str,
    masked: str,
    starts: list[int],
    added_lines: set[int],
    brace_depths: list[int],
    declarations: list[TypeDeclaration],
) -> list[Finding]:
    """检查 record 的显式紧凑构造方法 JavaDoc。

    Args:
        path: 仓库相对路径。
        source: 原始 Java 源码。
        masked: 已屏蔽注释和字面量的源码。
        starts: 行起始偏移列表。
        added_lines: 暂存差异中的新增行号。
        brace_depths: 每个字符之前的大括号深度。
        declarations: 已解析的类型声明。

    Returns:
        紧凑构造方法注释问题列表。
    """

    findings = []
    for declaration in declarations:
        if declaration.kind != "record":
            continue
        member_depth = declaration.outer_depth + 1
        pattern = re.compile(
            rf"(?<![\w$])(?:(?:public|protected|private)\s+)?"
            rf"{re.escape(declaration.name)}\s*\{{"
        )
        for match in pattern.finditer(
            masked, declaration.open_brace + 1, declaration.close_brace
        ):
            open_brace = match.end() - 1
            if brace_depths[open_brace] != member_depth:
                continue
            segment_start = _member_start(
                masked, brace_depths, match.start(), member_depth
            )
            declaration_offset = _first_code_offset(
                masked, segment_start, match.start() + 1
            )
            if not _intersects_added_lines(
                starts, declaration_offset, open_brace, added_lines
            ):
                continue
            if _attached_javadoc(source, declaration_offset) is None:
                findings.append(
                    Finding(
                        path,
                        _line_number(starts, match.start()),
                        "method-javadoc",
                        f"紧凑构造方法 {declaration.name} 缺少职责 JavaDoc",
                    )
                )
    return findings


def _scan_do_vo_fields(
    path: str,
    source: str,
    masked: str,
    starts: list[int],
    added_lines: set[int],
    brace_depths: list[int],
    declarations: list[TypeDeclaration],
) -> list[Finding]:
    """检查 DO、VO 中本次新增或修改的成员变量 JavaDoc。

    Args:
        path: 仓库相对路径。
        source: 原始 Java 源码。
        masked: 已屏蔽注释和字面量的源码。
        starts: 行起始偏移列表。
        added_lines: 暂存差异中的新增行号。
        brace_depths: 每个字符之前的大括号深度。
        declarations: 已解析的类型声明。

    Returns:
        DO、VO 字段注释问题列表。
    """

    findings = []
    for semicolon, char in enumerate(masked):
        if char != ";":
            continue
        enclosing = _enclosing_type(
            declarations, semicolon, brace_depths[semicolon]
        )
        if enclosing is None or not enclosing.name.endswith(("DO", "VO")):
            continue
        member_depth = enclosing.outer_depth + 1
        segment_start = _member_start(
            masked, brace_depths, semicolon, member_depth
        )
        declaration_offset = _first_code_offset(masked, segment_start, semicolon)
        fragment = masked[declaration_offset:semicolon]
        stripped, _ = _strip_leading_annotations(fragment)
        core = stripped.strip()
        if not core or "(" in core or FIELD_PREFIX_PATTERN.match(core) is None:
            continue
        if not _intersects_added_lines(
            starts, declaration_offset, semicolon, added_lines
        ):
            continue
        field_name_match = re.search(
            r"(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*(?:=|,|$)", core
        )
        field_name = field_name_match.group("name") if field_name_match else "成员变量"
        if _attached_javadoc(source, declaration_offset) is None:
            findings.append(
                Finding(
                    path,
                    _line_number(starts, declaration_offset),
                    "do-vo-field-javadoc",
                    f"{enclosing.name} 字段 {field_name} 缺少职责 JavaDoc",
                )
            )
    return findings


def _record_component_boundaries(
    declaration: TypeDeclaration,
    masked: str,
    paren_depths: list[int],
    paren_pairs: dict[int, int],
) -> list[tuple[int, int]]:
    """切分 record 头部中的顶层组件声明。

    Args:
        declaration: record 类型声明。
        masked: 已屏蔽注释和字面量的源码。
        paren_depths: 每个字符之前的小括号深度。
        paren_pairs: 左右小括号偏移映射。

    Returns:
        每个 record 组件片段的起止偏移列表。
    """

    open_paren = masked.find(
        "(", declaration.name_offset + len(declaration.name), declaration.open_brace
    )
    if open_paren < 0 or open_paren not in paren_pairs:
        return []
    close_paren = paren_pairs[open_paren]
    if close_paren > declaration.open_brace:
        return []
    component_depth = paren_depths[open_paren] + 1
    boundaries = []
    component_start = open_paren + 1
    for index in range(component_start, close_paren):
        if masked[index] == "," and paren_depths[index] == component_depth:
            boundaries.append((component_start, index))
            component_start = index + 1
    boundaries.append((component_start, close_paren))
    return boundaries


def _scan_do_vo_record_components(
    path: str,
    source: str,
    masked: str,
    starts: list[int],
    added_lines: set[int],
    paren_depths: list[int],
    paren_pairs: dict[int, int],
    declarations: list[TypeDeclaration],
) -> list[Finding]:
    """检查 DO、VO record 中本次新增或修改的组件 JavaDoc。

    Args:
        path: 仓库相对路径。
        source: 原始 Java 源码。
        masked: 已屏蔽注释和字面量的源码。
        starts: 行起始偏移列表。
        added_lines: 暂存差异中的新增行号。
        paren_depths: 每个字符之前的小括号深度。
        paren_pairs: 左右小括号偏移映射。
        declarations: 已解析的类型声明。

    Returns:
        DO、VO record 组件注释问题列表。
    """

    findings = []
    for declaration in declarations:
        if declaration.kind != "record" or not declaration.name.endswith(("DO", "VO")):
            continue
        for component_start, component_end in _record_component_boundaries(
            declaration, masked, paren_depths, paren_pairs
        ):
            declaration_offset = _first_code_offset(
                masked, component_start, component_end
            )
            fragment = masked[declaration_offset:component_end]
            stripped, _ = _strip_leading_annotations(fragment)
            name_match = re.search(
                r"(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*$", stripped
            )
            if name_match is None:
                continue
            name = name_match.group("name")
            if not _intersects_added_lines(
                starts, declaration_offset, component_end, added_lines
            ):
                continue
            if _attached_javadoc(source, declaration_offset) is None:
                findings.append(
                    Finding(
                        path,
                        _line_number(starts, declaration_offset),
                        "do-vo-field-javadoc",
                        f"{declaration.name} record 组件 {name} 缺少职责 JavaDoc",
                    )
                )
    return findings


def _enum_constant_boundaries(
    declaration: TypeDeclaration,
    masked: str,
    brace_depths: list[int],
    paren_depths: list[int],
) -> list[tuple[int, int]]:
    """切分枚举常量区中的顶层常量片段。

    Args:
        declaration: 枚举类型声明。
        masked: 已屏蔽注释和字面量的源码。
        brace_depths: 每个字符之前的大括号深度。
        paren_depths: 每个字符之前的小括号深度。

    Returns:
        每个枚举常量片段的起止偏移列表。
    """

    member_depth = declaration.outer_depth + 1
    start = declaration.open_brace + 1
    baseline_paren_depth = paren_depths[start] if start < len(paren_depths) else 0
    boundaries = []
    segment_start = start
    for index in range(start, declaration.close_brace):
        if brace_depths[index] != member_depth:
            continue
        char = masked[index]
        if char == ";" and paren_depths[index] == baseline_paren_depth:
            boundaries.append((segment_start, index))
            break
        if char == "," and paren_depths[index] == baseline_paren_depth:
            boundaries.append((segment_start, index))
            segment_start = index + 1
    else:
        boundaries.append((segment_start, declaration.close_brace))
    return boundaries


def _scan_enum_constants(
    path: str,
    source: str,
    masked: str,
    starts: list[int],
    added_lines: set[int],
    brace_depths: list[int],
    paren_depths: list[int],
    declarations: list[TypeDeclaration],
) -> list[Finding]:
    """检查本次新增或修改的枚举常量 JavaDoc。

    Args:
        path: 仓库相对路径。
        source: 原始 Java 源码。
        masked: 已屏蔽注释和字面量的源码。
        starts: 行起始偏移列表。
        added_lines: 暂存差异中的新增行号。
        brace_depths: 每个字符之前的大括号深度。
        paren_depths: 每个字符之前的小括号深度。
        declarations: 已解析的类型声明。

    Returns:
        枚举常量注释问题列表。
    """

    findings = []
    for declaration in declarations:
        if declaration.kind != "enum":
            continue
        for segment_start, segment_end in _enum_constant_boundaries(
            declaration, masked, brace_depths, paren_depths
        ):
            declaration_offset = _first_code_offset(
                masked, segment_start, segment_end
            )
            fragment = masked[declaration_offset:segment_end]
            stripped, _ = _strip_leading_annotations(fragment)
            name_match = re.match(r"\s*(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)", stripped)
            if name_match is None:
                continue
            name = name_match.group("name")
            if not _intersects_added_lines(
                starts, declaration_offset, segment_end, added_lines
            ):
                continue
            if _attached_javadoc(source, declaration_offset) is None:
                findings.append(
                    Finding(
                        path,
                        _line_number(starts, declaration_offset),
                        "enum-constant-javadoc",
                        f"枚举常量 {name} 缺少用途 JavaDoc",
                    )
                )
    return findings


def _scan_source(
    path: str,
    source: str,
    added_lines: set[int],
    *,
    evidence: EvidenceRegistry | None = None,
    local_sha256: str | None = None,
) -> list[Finding]:
    """扫描单个暂存 Java 文件中的增量注释问题。

    Args:
        path: 仓库相对路径。
        source: 暂存版本 Java 源码。
        added_lines: 暂存差异中的新增行号。
        evidence: 受控来源证据清单；未配置时为 ``None``。
        local_sha256: 当前对象原始字节的 SHA-256。

    Returns:
        当前文件的全部注释门禁问题。
    """

    if not added_lines:
        return []
    masked = _mask_java(source)
    starts = _line_starts(source)
    brace_depths = _depths(masked, "{", "}")
    paren_depths = _depths(masked, "(", ")")
    brace_pairs = _matching_delimiters(masked, "{", "}")
    paren_pairs = _matching_delimiters(masked, "(", ")")
    declarations = _type_declarations(masked, brace_depths, brace_pairs)
    findings = []
    findings.extend(
        _scan_types(
            path,
            source,
            starts,
            added_lines,
            declarations,
            evidence=evidence,
            local_sha256=local_sha256,
        )
    )
    findings.extend(
        _scan_methods(
            path,
            source,
            masked,
            starts,
            added_lines,
            brace_depths,
            paren_pairs,
            declarations,
        )
    )
    findings.extend(
        _scan_compact_record_constructors(
            path,
            source,
            masked,
            starts,
            added_lines,
            brace_depths,
            declarations,
        )
    )
    findings.extend(
        _scan_do_vo_fields(
            path,
            source,
            masked,
            starts,
            added_lines,
            brace_depths,
            declarations,
        )
    )
    findings.extend(
        _scan_do_vo_record_components(
            path,
            source,
            masked,
            starts,
            added_lines,
            paren_depths,
            paren_pairs,
            declarations,
        )
    )
    findings.extend(
        _scan_enum_constants(
            path,
            source,
            masked,
            starts,
            added_lines,
            brace_depths,
            paren_depths,
            declarations,
        )
    )
    return sorted(
        set(findings), key=lambda finding: (finding.path, finding.line, finding.rule)
    )


def _previous_source(path: str) -> str | None:
    """读取暂存差异的旧 blob，兼容删除注释及重命名中的旧路径。

    Args:
        path: 当前暂存版本的仓库相对路径。
    Returns:
        旧版本 UTF-8 源码；新增文件或没有内容差异时返回 None。
    Raises:
        RuntimeError: Git 读取失败或旧源码不是 UTF-8；不会写入索引。
    """
    diff = _run_git(
        ["diff", "--cached", "--full-index", "--no-ext-diff", "--no-textconv", "--", path]
    )
    assert isinstance(diff, str)
    match = re.search(r"^index ([0-9a-f]+)\.\.[0-9a-f]+", diff, re.MULTILINE)
    if match is None or not match.group(1).strip("0"):
        return None
    output = _run_git(["cat-file", "blob", match.group(1)], text=False)
    assert isinstance(output, bytes)
    try:
        return output.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise RuntimeError("旧 Java 源码不是有效 UTF-8，已停止注释检查") from error


def _new_documentation_findings(
    path: str,
    source: str,
    previous_source: str | None,
    *,
    evidence: EvidenceRegistry | None = None,
    local_sha256: str | None = None,
) -> list[Finding]:
    """识别注释删除或改坏后新出现的问题，不追查未修改的历史欠账。

    Args:
        path: 当前暂存文件路径。
        source: 当前暂存版本源码。
        previous_source: 差异对应的旧源码；新增文件传 None。
        evidence: 受控来源证据清单；未配置时为 ``None``。
        local_sha256: 当前对象原始字节的 SHA-256。
    Returns:
        旧版本同一声明行没有的注释问题；同名重载按行映射分别判断。
        来源证据主张类诊断按当前证据重新成立，不因旧版本同样失败而豁免。
    """
    if previous_source is None:
        return []
    current_lines = source.splitlines()
    previous_lines = previous_source.splitlines()
    current = _scan_source(
        path,
        source,
        set(range(1, len(current_lines) + 1)),
        evidence=evidence,
        local_sha256=local_sha256,
    )
    if not current:
        return []
    previous = {
        (finding.line, finding.rule, finding.detail)
        for finding in _scan_source(
            path,
            previous_source,
            set(range(1, len(previous_lines) + 1)),
            evidence=evidence,
            local_sha256=local_sha256,
        )
    }
    # 删除整个方法会让后续声明行号前移；映射未改文本而非标记删除邻接行，
    # 避免把下一方法的历史缺失误算为本次问题，也不按重载方法名合并。
    line_map = {
        block.b + offset + 1: block.a + offset + 1
        for block in difflib.SequenceMatcher(
            None, previous_lines, current_lines, autojunk=False
        ).get_matching_blocks()
        for offset in range(block.size)
    }
    return [
        finding
        for finding in current
        if finding.evidence_bound
        or (line_map.get(finding.line), finding.rule, finding.detail) not in previous
    ]


def scan_full_source(
    path: str, source: str, *, evidence: EvidenceRegistry | None = None
) -> list[Finding]:
    """检查单个 Java 源文件的全部声明，不受暂存差异范围限制。

    全量入口复用同一套规则，把每个文件的所有行都视为受影响范围，
    因此历史欠账不会再被“本次没有改动”掩盖。

    Args:
        path: 仓库相对路径。
        source: 当前 Java 源码。
        evidence: 受控来源证据清单；省略时读取环境变量配置，两者都没有则为 ``None``。
    Returns:
        该文件全部声明的注释问题，行号以当前源码为基准。
    Raises:
        EvidenceError: 环境变量配置的证据输入不可读或结构不受支持。
    """

    registry = evidence if evidence is not None else _configured_evidence()
    return _scan_source(
        path,
        source,
        set(range(1, source.count("\n") + 2)),
        evidence=registry,
        local_sha256=hashlib.sha256(source.encode("utf-8")).hexdigest(),
    )


def _scan_staged_java_comments(
    paths: list[str] | None = None, *, evidence: EvidenceRegistry | None = None
) -> list[Finding]:
    """扫描全部暂存 Java 文件的增量注释问题。

    Args:
        paths: 已读取的增量范围；省略时从当前索引读取，空列表不扩大扫描。
        evidence: 受控来源证据清单；省略时不启用 A 例外核验。
    Returns:
        本次提交中的全部注释门禁问题。
    """

    findings = []
    for path in _staged_java_paths() if paths is None else paths:
        source = _staged_source(path)
        local_sha256 = hashlib.sha256(_staged_bytes(path)).hexdigest()
        findings.extend(
            _scan_source(
                path,
                source,
                _added_lines(path),
                evidence=evidence,
                local_sha256=local_sha256,
            )
        )
        findings.extend(
            _new_documentation_findings(
                path,
                source,
                _previous_source(path),
                evidence=evidence,
                local_sha256=local_sha256,
            )
        )
    return sorted(set(findings), key=lambda finding: (finding.path, finding.line, finding.rule))


def _rules(findings: list[Finding]) -> set[str]:
    """提取测试结果中的规则标识集合。

    Args:
        findings: 待归纳的问题列表。

    Returns:
        问题规则标识集合。
    """

    return {finding.rule for finding in findings}


def _run_self_test() -> None:
    """使用内置 Java 样本验证放行、拦截和增量边界。"""

    if not _has_actual_author("/** @author&#x20;赵六 */"):
        raise AssertionError("HTML 空格分隔的实际作者未被识别")
    if _has_actual_author("/** @author TODO */"):
        raise AssertionError("英文占位作者未被拦截")
    for neutral in (
        "/** @author 未声明作者 */",
        "/** @author 来源：YunaiV/ruoyi-vue-pro @ "
        "ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者） */",
        "/** @author basic-framework */",
        "/** @author 来源不明 */",
    ):
        if _has_actual_author(neutral):
            raise AssertionError(f"中性文字被误判为实际作者：{neutral}")

    note = (
        " * 来源：YunaiV/ruoyi-vue-pro @ "
        "ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）\n"
        " * 上游文件：yudao-framework/yudao-common/src/main/java/Demo.java\n"
        f" * {SOURCE_BASIS_FIXED}\n"
        " * 本地修改：调整包名与类名。\n"
    )
    without_registry = (
        "/**\n * 职责说明。\n *\n" + note + " */\npublic class EvidenceDemo {\n}\n"
    )
    if "type-author" not in _rules(
        _scan_source(
            "后端代码/basic-framework-boot/test/EvidenceDemo.java",
            without_registry,
            set(range(1, without_registry.count("\n") + 2)),
        )
    ):
        raise AssertionError("没有受控清单时来源说明未被拦截")
    floating = without_registry.replace(
        "ac022b15a094cf9cf82903d429b9729e72309da5", "ac022b15"
    )
    if "type-author" not in _rules(
        _scan_source(
            "后端代码/basic-framework-boot/test/EvidenceDemo.java",
            floating,
            set(range(1, floating.count("\n") + 2)),
        )
    ):
        raise AssertionError("短 SHA 浮动引用未被拦截")
    after_tag = (
        "/**\n * 职责说明。\n *\n * @author 张三\n"
        + note
        + " */\npublic class LateNote {\n}\n"
    )
    if "type-author" not in _rules(
        _scan_source(
            "后端代码/basic-framework-boot/test/LateNote.java",
            after_tag,
            set(range(1, after_tag.count("\n") + 2)),
        )
    ):
        raise AssertionError("位于块标签之后的来源说明未被拦截")
    invented = (
        "/**\n * 职责说明。\n *\n"
        " * @source YunaiV/ruoyi-vue-pro @ "
        "ac022b15a094cf9cf82903d429b9729e72309da5\n"
        " */\npublic class InventedTag {\n}\n"
    )
    invented_findings = _scan_source(
        "后端代码/basic-framework-boot/test/InventedTag.java",
        invented,
        set(range(1, invented.count("\n") + 2)),
    )
    if "type-author" not in _rules(invented_findings):
        raise AssertionError("自造 @source 标签未被拦截")
    if not any("自造块标签" in finding.detail for finding in invented_findings):
        raise AssertionError("自造 @source 标签的诊断没有说明原因")
    if not _has_actual_author("/** @author 张三, 李四 */"):
        raise AssertionError("多作者形式未被识别")

    compliant_source = """/**
 * 合规数据对象。
 *
 * @author 张三
 */
public class GoodDO {
    /**
     * 主键。
     */
    @Deprecated
    private Long id;

    /**
     * 创建合规数据对象。
     */
    public GoodDO() {
    }

    /**
     * 执行业务操作。
     */
    @Override
    public String toString() {
        return "GoodDO";
    }

    /**
     * 验证 record 变量的模式匹配条件。
     *
     * @param record 待检查对象
     * @return 匹配到的数据对象；不匹配时返回原对象
     */
    public Object matchRecord(Object record) {
        if (record instanceof GoodDO value) {
            return value;
        }
        return record;
    }
}
"""
    all_compliant_lines = set(range(1, compliant_source.count("\n") + 2))
    if _scan_source("后端代码/basic-framework-boot/test/GoodDO.java", compliant_source, all_compliant_lines):
        raise AssertionError("合规 Java 样本被误报")

    missing_source = """public class MissingVO {
    @Deprecated
    private String name;

    private MissingVO() {
    }

    private void execute(
            String value) {
    }
}
"""
    all_missing_lines = set(range(1, missing_source.count("\n") + 2))
    missing_rules = _rules(
        _scan_source(
            "后端代码/basic-framework-boot/test/MissingVO.java",
            missing_source,
            all_missing_lines,
        )
    )
    expected_rules = {"type-javadoc", "do-vo-field-javadoc", "method-javadoc"}
    if not expected_rules.issubset(missing_rules):
        raise AssertionError(f"缺失注释样本未完整拦截：{missing_rules}")

    author_source = """/** 缺少作者。 */
public interface MissingAuthor {
}
"""
    author_findings = _scan_source(
        "后端代码/basic-framework-boot/test/MissingAuthor.java", author_source, {2}
    )
    if "type-author" not in _rules(author_findings):
        raise AssertionError("public 类型缺少作者的样本未被拦截")

    placeholder_author_source = """/**
 * 作者占位样本。
 *
 * @author 作者
 */
public interface PlaceholderAuthor {
}
"""
    placeholder_author_findings = _scan_source(
        "后端代码/basic-framework-boot/test/PlaceholderAuthor.java",
        placeholder_author_source,
        {6},
    )
    if "type-author" not in _rules(placeholder_author_findings):
        raise AssertionError("public 类型的占位作者未被拦截")

    enum_source = """/**
 * 状态枚举。
 *
 * @author 王五
 */
public enum StatusEnum {
    /** 成功。 */
    SUCCESS(0),
    FAILURE(1);

    private final int code;

    /**
     * 创建状态枚举。
     *
     * @param code 状态码
     */
    StatusEnum(int code) {
        this.code = code;
    }
}
"""
    enum_findings = _scan_source(
        "后端代码/basic-framework-boot/test/StatusEnum.java", enum_source, {9}
    )
    if "enum-constant-javadoc" not in _rules(enum_findings):
        raise AssertionError("枚举常量缺少注释的样本未被拦截")
    if "method-javadoc" in _rules(enum_findings):
        raise AssertionError("枚举常量构造参数被误判为方法")

    record_source = """/**
 * record 响应对象。
 *
 * @author 李杰
 */
public record ResultVO(
        /** 编号。 */ Long id,
        String name) {
    ResultVO {
    }
}
"""
    all_record_lines = set(range(1, record_source.count("\n") + 2))
    record_rules = _rules(
        _scan_source(
            "后端代码/basic-framework-boot/test/ResultVO.java",
            record_source,
            all_record_lines,
        )
    )
    if not {"do-vo-field-javadoc", "method-javadoc"}.issubset(record_rules):
        raise AssertionError(f"record 注释缺失样本未完整拦截：{record_rules}")

    incremental_source = """public class LegacyVO {
    private String legacyField;

    public void legacyMethod() {
        int changed = 1;
    }
}
"""
    if _scan_source(
        "后端代码/basic-framework-boot/test/LegacyVO.java", incremental_source, {5}
    ):
        raise AssertionError("仅修改方法体时不应追溯历史声明注释")
    print("Java 注释检查规则自检通过")


def _parse_args() -> argparse.Namespace:
    """解析命令行参数。

    Returns:
        包含自检开关、结构化输出与受控证据位置的参数对象。
    """

    parser = argparse.ArgumentParser(description="检查 Git 暂存区 Java 增量注释")
    parser.add_argument("--self-test", action="store_true", help="运行内置规则自检")
    parser.add_argument("--json", action="store_true", help="输出结构化计数与诊断")
    parser.add_argument(
        "--evidence-registry",
        type=Path,
        default=None,
        help=f"受控来源证据清单路径（TSV 或 JSON）；默认读取 {EVIDENCE_REGISTRY_ENV}",
    )
    parser.add_argument(
        "--evidence-snapshots",
        type=Path,
        default=None,
        help=f"受控上游快照根目录；默认读取 {EVIDENCE_SNAPSHOTS_ENV}",
    )
    return parser.parse_args()


def _emit(
    name: str, checked: int, findings: list[Finding], evidence: EvidenceRegistry | None
) -> int:
    """输出结构化结果，并附上本次采用的证据输入指纹。

    Args:
        name: 检查器身份。
        checked: 实际消费对象数量。
        findings: 注释门禁问题列表。
        evidence: 受控证据清单；未配置时为 ``None``。
    Returns:
        存在规则问题时为 1，否则为 0。
    """

    result = payload(name, checked, findings)
    # 未配置证据时也显式报告 null，消费者不能把“没有指纹”当成“已验证”。
    result["evidence"] = evidence.describe() if evidence is not None else None
    print(json.dumps(result, ensure_ascii=False))
    return 1 if findings else 0


def _describe_evidence(evidence: EvidenceRegistry | None) -> str:
    """生成证据输入指纹的可读说明，未配置时说明不会启用 A 例外。"""

    if evidence is None:
        return "Java 注释检查证据输入：未配置受控清单与快照，来源说明一律按无逐项依据拒绝。"
    snapshots = "未配置" if evidence.snapshots is None else str(evidence.snapshots)
    return (
        f"Java 注释检查证据输入：清单 {evidence.path}"
        f"（SHA-256 {evidence.sha256}，{len(evidence.records)} 条记录）；受控快照 {snapshots}"
    )


# 其它入口（全量检查、提交路径与 CI 调度）复用同一证据解析与报告实现，
# 保证暂存、工作区、全量与 CI 消费者采用同一契约。
resolve_evidence = _resolve_evidence
describe_evidence = _describe_evidence
configured_evidence = _configured_evidence


def _repository_root() -> Path:
    """定位当前 Git 工作区根目录，用于解析仓库内受控默认索引。

    在仓库子目录中运行时仍以工作区根目录为准；不是 Git 工作区时退回当前目录，
    此时仓库内默认索引不会命中，行为等同于仅使用显式配置。
    """

    try:
        output = _run_git(["rev-parse", "--show-toplevel"])
    except RuntimeError:
        return Path.cwd()
    return Path(output.strip()) if isinstance(output, str) and output.strip() else Path.cwd()


def main() -> int:
    """执行自检或暂存区 Java 注释检查。

    Returns:
        检查通过返回 0；发现问题返回 1；检查器执行失败返回 2。
    """

    args = _parse_args()
    if args.self_test:
        _run_self_test()
        return 0
    try:
        evidence = _resolve_evidence(
            args.evidence_registry, args.evidence_snapshots, _repository_root()
        )
        if not args.json:
            print(_describe_evidence(evidence))
        paths = _staged_java_paths()
        if not paths:
            if args.json:
                return _emit("Java 注释", 0, [], evidence)
            print(f"Java 注释检查：不适用，暂存差异中没有 {JAVA_SOURCE_ROOT} 下的手写 Java 文件；未验证 Java 声明。")
            return 0
        if not args.json:
            print(f"Java 注释检查范围：{len(paths)} 个暂存文件，根目录 {JAVA_SOURCE_ROOT}，仅检查受影响声明。")
        findings = _scan_staged_java_comments(paths, evidence=evidence)
    except RuntimeError as error:
        print(f"Java 注释检查失败：{error}", file=sys.stderr)
        return 2
    if args.json:
        return _emit("Java 注释", len(paths), findings, evidence)
    if not findings:
        print("Java 注释检查通过：暂存区新增或修改的声明符合要求")
        return 0
    print("检测到 Java 注释问题，已阻止提交：", file=sys.stderr)
    for finding in findings:
        print(
            f"- {finding.path}:{finding.line} [{finding.rule}] {finding.detail}",
            file=sys.stderr,
        )
    print("请补充准确的中文 JavaDoc 后重新提交。", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
