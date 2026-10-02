#!/usr/bin/env python3
"""检查 Git 暂存区新增或修改的 Java 声明是否具备项目要求的注释。

检查器读取暂存版本而非工作区版本，只校验本次变更覆盖的声明，避免历史注释欠账
阻塞无关提交。DO、VO 的成员变量同样要求使用 JavaDoc 说明字段职责。

@author 李杰
"""

from __future__ import annotations

import argparse
import bisect
import difflib
import re
import subprocess
import sys
from dataclasses import dataclass

# Windows Git Hook 可能继承非 UTF-8 控制台编码，统一输出编码以保证中文提示可读。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


JAVA_SOURCE_ROOT = "后端/java服务/"
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


@dataclass(frozen=True)
class Finding:
    """表示一个注释门禁问题。

    Attributes:
        path: 仓库内 Java 文件路径。
        line: 暂存版本中的声明行号。
        rule: 命中的规则标识。
        detail: 可直接展示的整改说明。
    """

    path: str
    line: int
    rule: str
    detail: str


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
        if (
            normalized.startswith(JAVA_SOURCE_ROOT)
            and normalized.endswith(".java")
            and "/target/" not in normalized
            and "/generated-sources/" not in normalized
        ):
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


def _mask_java(source: str) -> str:
    """屏蔽注释和字面量内容，同时保留字符偏移与换行位置。

    Args:
        source: 原始 Java 源码。

    Returns:
        与原文等长的结构化文本；注释和字面量被空格替换。
    """

    chars = list(source)
    masked = list(source)
    index = 0
    state = "normal"
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
    return "".join(masked)


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

    for index in range(position - 1, -1, -1):
        char = masked[index]
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


def _attached_javadoc(source: str, declaration_offset: int) -> str | None:
    """读取紧邻声明或其注解之前的 JavaDoc。

    Args:
        source: 原始 Java 源码。
        declaration_offset: 声明修饰符或首个注解的起始偏移。

    Returns:
        已关联的 JavaDoc 文本；不存在时返回 ``None``。
    """

    prefix = source[:declaration_offset].rstrip()
    if not prefix.endswith("*/"):
        return None
    start = prefix.rfind("/**")
    if start < 0 or prefix.rfind("/*") != start:
        return None
    return prefix[start:]


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


def _has_actual_author(javadoc: str) -> bool:
    """判断 JavaDoc 是否包含非占位的作者姓名。

    Args:
        javadoc: 待检查的完整 JavaDoc 文本。

    Returns:
        至少存在一个非空且不是常见占位值的作者时返回 ``True``。

    Note:
        静态检查只能排除明显占位值，作者真实性仍由生成或评审流程核对。
    """

    for match in AUTHOR_PATTERN.finditer(javadoc):
        author = re.sub(
            r"(?:\s|&(?:#x20;|#32;|nbsp;))+$",
            "",
            match.group("name"),
            flags=re.IGNORECASE,
        ).strip()
        if author and author.casefold() not in AUTHOR_PLACEHOLDERS:
            return True
    return False


def _scan_types(
    path: str,
    source: str,
    starts: list[int],
    added_lines: set[int],
    declarations: list[TypeDeclaration],
) -> list[Finding]:
    """检查本次新增或修改的类型声明 JavaDoc。

    Args:
        path: 仓库相对路径。
        source: 原始 Java 源码。
        starts: 行起始偏移列表。
        added_lines: 暂存差异中的新增行号。
        declarations: 已解析的类型声明。

    Returns:
        类型注释问题列表。
    """

    findings = []
    for declaration in declarations:
        if not _intersects_added_lines(
            starts,
            declaration.declaration_offset,
            declaration.open_brace,
            added_lines,
        ):
            continue
        line = _line_number(starts, declaration.name_offset)
        javadoc = _attached_javadoc(source, declaration.declaration_offset)
        if javadoc is None:
            findings.append(
                Finding(
                    path,
                    line,
                    "type-javadoc",
                    f"类型 {declaration.name} 缺少职责 JavaDoc",
                )
            )
        elif declaration.public and not _has_actual_author(javadoc):
            findings.append(
                Finding(
                    path,
                    line,
                    "type-author",
                    f"public 类型 {declaration.name} 的 JavaDoc 缺少非占位的 @author 实际作者",
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


def _scan_source(path: str, source: str, added_lines: set[int]) -> list[Finding]:
    """扫描单个暂存 Java 文件中的增量注释问题。

    Args:
        path: 仓库相对路径。
        source: 暂存版本 Java 源码。
        added_lines: 暂存差异中的新增行号。

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
    findings.extend(_scan_types(path, source, starts, added_lines, declarations))
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
    path: str, source: str, previous_source: str | None
) -> list[Finding]:
    """识别注释删除或改坏后新出现的问题，不追查未修改的历史欠账。

    Args:
        path: 当前暂存文件路径。
        source: 当前暂存版本源码。
        previous_source: 差异对应的旧源码；新增文件传 None。
    Returns:
        旧版本同一声明行没有的注释问题；同名重载按行映射分别判断。
    """
    if previous_source is None:
        return []
    current_lines = source.splitlines()
    previous_lines = previous_source.splitlines()
    current = _scan_source(path, source, set(range(1, len(current_lines) + 1)))
    if not current:
        return []
    previous = {
        (finding.line, finding.rule, finding.detail)
        for finding in _scan_source(path, previous_source, set(range(1, len(previous_lines) + 1)))
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
        if (line_map.get(finding.line), finding.rule, finding.detail) not in previous
    ]


def _scan_staged_java_comments() -> list[Finding]:
    """扫描全部暂存 Java 文件的增量注释问题。

    Returns:
        本次提交中的全部注释门禁问题。
    """

    findings = []
    for path in _staged_java_paths():
        source = _staged_source(path)
        findings.extend(_scan_source(path, source, _added_lines(path)))
        findings.extend(_new_documentation_findings(path, source, _previous_source(path)))
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
    if _scan_source("后端/java服务/test/GoodDO.java", compliant_source, all_compliant_lines):
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
            "后端/java服务/test/MissingVO.java",
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
        "后端/java服务/test/MissingAuthor.java", author_source, {2}
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
        "后端/java服务/test/PlaceholderAuthor.java",
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
        "后端/java服务/test/StatusEnum.java", enum_source, {9}
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
            "后端/java服务/test/ResultVO.java",
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
        "后端/java服务/test/LegacyVO.java", incremental_source, {5}
    ):
        raise AssertionError("仅修改方法体时不应追溯历史声明注释")
    print("Java 注释检查规则自检通过")


def _parse_args() -> argparse.Namespace:
    """解析命令行参数。

    Returns:
        包含自检开关的参数对象。
    """

    parser = argparse.ArgumentParser(description="检查 Git 暂存区 Java 增量注释")
    parser.add_argument("--self-test", action="store_true", help="运行内置规则自检")
    return parser.parse_args()


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
        findings = _scan_staged_java_comments()
    except RuntimeError as error:
        print(f"Java 注释检查失败：{error}", file=sys.stderr)
        return 2
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
