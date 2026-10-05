#!/usr/bin/env python3
"""扫描 Git 暂存区新增内容，明确凭据阻断，名称歧义提示核查。

扫描结果只报告文件、行号和规则，不回显命中的敏感值，避免检查工具造成二次泄露。
Python 测试文件允许 unit- 加 8 至 128 个相同小写字母或数字的虚拟凭据，
支持字符串字面量及 "unit-" + "a" * 16 写法；其他凭据检查保持生效。
SQL 绑定参数（?、?1、:name、#{name}、${name}）与带 DUMMY、CHANGE_ME 等合成标记
的取值不按固定凭据阻断；写死的字面量、密钥前缀、URL 凭据与私钥仍按原口径拦截。

@author 李杰
"""

from __future__ import annotations

import argparse
import ast
import re
import subprocess
import sys
import warnings
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.security.sql_credentials import inspect_insert_credentials

# Windows 的 Git Hook 可能继承非 UTF-8 控制台编码；统一输出编码，避免中文提示乱码。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


SENSITIVE_ASSIGNMENT_PATTERN = re.compile(
    r"(?i)(?P<key>[a-z0-9_.-]*(?:password|passwd|passphrase|secret|token|"
    r"api[_-]?key|access[_-]?key|private[_-]?key|credential)[a-z0-9_.-]*)"
    r"[\"'`]?\s*(?P<operator>:(?!:)|=(?!=|>))\s*(?P<value>.+)$"
)
NON_CREDENTIAL_TOKEN_MEASUREMENT_PATTERN = re.compile(
    r"(?i)(?:^|[._-])(?:max|min|num|number|count|limit|length|budget|usage|"
    r"input|output|prompt|completion|cached|total|generated|requested|remaining)"
    r"[._-]?tokens?(?:[._-](?:count|limit|length|budget|usage|total))?$|"
    r"(?:^|[._-])tokens?[_-](?:count|limit|length|budget|usage|total)$"
)
SECRET_PREFIX_PATTERN = re.compile(
    r"(?i)(?<![a-z0-9_-])(?:sk-[a-z0-9_-]{16,}|ghp_[a-z0-9]{20,}|"
    r"glpat-[a-z0-9_-]{20,}|xox[baprs]-[a-z0-9-]{20,}|AKIA[0-9A-Z]{16})"
    r"(?![a-z0-9_-])"
)
EMBEDDED_CREDENTIAL_URL_PATTERN = re.compile(
    r"(?i)[a-z][a-z0-9+.-]*://(?P<username>[^/@\s:]+):(?P<password>[^/@\s]+)@"
)
# JDBC、MyBatis 与 JPA 的绑定参数写法；后面的语句文本由占位符识别函数单独校验。
SQL_BINDING_PLACEHOLDER_PATTERN = re.compile(
    r"(?:\?[0-9]*|:[A-Za-z_][A-Za-z0-9_]*|#\{[^{}\r\n]+\}|\$\{[^{}\r\n]+\})"
)
# 仓库约定的显式合成标记：测试夹具和示例值必须带这些标记，声明其不是可用凭据。
SYNTHETIC_PLACEHOLDER_MARKERS = (
    "CHANGE_ME",
    "DUMMY",
    "EXAMPLE",
    "PLACEHOLDER",
    "RANDOM",
    "REDACTED",
    "REPLACE",
)
# 嵌在源码字符串里的 SQL 语句：列名列表中的敏感列后跟写死取值，普通配置文本不适用。
EMBEDDED_SQL_STATEMENT_PATTERN = re.compile(
    r"(?i)\b(?:insert\s+into|update|delete\s+from|alter\s+table|create\s+table|set)\b"
)
PRIVATE_KEY_BLOCK_PATTERN = re.compile(
    r"-----BEGIN (?P<key_type>(?:RSA |EC |OPENSSH )?PRIVATE KEY)-----"
    r"(?P<body>.*?)"
    r"-----END (?P=key_type)-----",
    re.DOTALL,
)
PRIVATE_KEY_PAYLOAD_PATTERN = re.compile(r"[A-Za-z0-9+/=]{64,}")
HUNK_HEADER_PATTERN = re.compile(r"^@@ -\d+(?:,\d+)? \+(?P<line>\d+)(?:,\d+)? @@")
SELF_TEST_PATH = "scripts/security/scan_staged_secrets.py"
SELF_TEST_ALLOW_MARKER = "# secret-scan: allow-test"

CONFIG_SUFFIXES = {
    ".cfg",
    ".conf",
    ".ini",
    ".json",
    ".md",
    ".properties",
    ".ps1",
    ".sh",
    ".sql",
    ".toml",
    ".yaml",
    ".yml",
}


@dataclass(frozen=True)
class Finding:
    """表示一个不会携带敏感值的扫描结果。

    Attributes:
        path: 仓库内文件路径。
        line: 暂存版本中的行号；文件名规则命中时为 0。
        rule: 命中的安全规则。
        detail: 可安全展示的字段名或原因，不包含字段值。
        severity: error 表示阻断项，warning 表示不阻断的人工核查提示。
    """

    path: str
    line: int
    rule: str
    detail: str
    severity: str = "error"


def _run_git(arguments: list[str], *, text: bool = True) -> str | bytes:
    """执行只读 Git 命令并返回标准输出。

    Args:
        arguments: 不包含 ``git`` 本身的参数列表。
        text: 是否按 UTF-8 文本返回；NUL 分隔输出应使用字节模式。

    Returns:
        Git 命令的标准输出。

    Raises:
        RuntimeError: Git 命令执行失败时抛出，错误信息不会包含文件内容。
    """

    completed = subprocess.run(
        ["git", "-c", "core.quotepath=false", *arguments],
        check=False,
        capture_output=True,
        text=text,
        encoding="utf-8" if text else None,
        errors="replace" if text else None,
    )
    if completed.returncode != 0:
        stderr = completed.stderr.strip() if text else "Git 命令执行失败"
        raise RuntimeError(stderr or "Git 命令执行失败")
    return completed.stdout


def _staged_paths() -> list[str]:
    """读取本次提交将新增或修改的文件路径。

    Returns:
        使用正斜杠表示的仓库相对路径列表。
    """

    output = _run_git(
        ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR", "--"],
        text=False,
    )
    assert isinstance(output, bytes)
    return [
        item.decode("utf-8", errors="replace") for item in output.split(b"\0") if item
    ]


def _is_forbidden_env_path(path: str) -> bool:
    """判断路径是否属于不允许提交的真实环境文件。

    示例文件和前端构建环境文件允许跟踪；部署及后端服务中的 ``.env``、任意
    ``.env.local`` 和 ``.env.*.local`` 会被阻止。

    Args:
        path: 仓库相对路径。

    Returns:
        需要阻止提交时返回 ``True``。
    """

    normalized = path.replace("\\", "/")
    name = PurePosixPath(normalized).name
    if name in {".env.example", ".env.local.example"}:
        return False
    if name == ".env.local" or re.fullmatch(r"\.env\..+\.local", name):
        return True
    return name == ".env" and normalized.startswith(("部署/", "后端/", "后端代码/", "docs/部署/"))


def _is_config_path(path: str) -> bool:
    """判断文件是否使用配置式的无引号字面量语法。

    Args:
        path: 仓库相对路径。

    Returns:
        配置、脚本、SQL 或文档文件返回 ``True``。
    """

    file_path = PurePosixPath(path)
    return (
        file_path.name.startswith(".env") or file_path.suffix.lower() in CONFIG_SUFFIXES
    )


def _is_code_path(path: str) -> bool:
    """判断路径是否按普通源码处理字符串字面量与表达式语义。

    配置文件（含文档、SQL、脚本）继续按配置文本检查；Python 由 AST 候选负责
    赋值识别，避免逐行文本规则与既有多语句保守判定冲突。

    Args:
        path: 仓库相对路径或文档代码块使用的语法路径。

    Returns:
        需要按源码语义分析时返回 ``True``。
    """

    return (
        not _is_config_path(path) and PurePosixPath(path).suffix.lower() != ".py"
    )


def _string_literal_spans(line: str) -> list[tuple[int, int]]:
    """列出单行内的字符串字面量区间，用于区分字面量文本与真实赋值。

    只做引号配对，不执行语言解析；反斜杠转义不结束字面量，未闭合时区间取到行尾。

    Args:
        line: 待分析的单行源码。

    Returns:
        ``(起始偏移, 结束偏移)`` 列表，结束偏移指向闭合引号之后。
    """

    spans: list[tuple[int, int]] = []
    index = 0
    length = len(line)
    while index < length:
        delimiter = line[index]
        if delimiter not in "\"'`":
            index += 1
            continue
        start = index
        index += 1
        while index < length:
            if line[index] == "\\":
                index += 2
                continue
            if line[index] == delimiter:
                index += 1
                break
            index += 1
        spans.append((start, min(index, length)))
    return spans


def _enclosing_literal(line: str, offset: int) -> tuple[int, int] | None:
    """返回包含指定偏移的字符串字面量区间。

    Args:
        line: 单行源码。
        offset: 敏感名称在行内的起始偏移。

    Returns:
        命中字面量的 ``(起始偏移, 结束偏移)``；不在字面量内部时返回 ``None``。
    """

    for start, end in _string_literal_spans(line):
        if start < offset < end:
            return start, end
    return None


def _in_literal_value(
    line: str, span: tuple[int, int], value_start: int, value_end: int
) -> str | None:
    """取赋值右侧位于同一字符串字面量内部的文本。

    命中位于字面量内部时，只有字面量内部的文本才是候选值；右侧起点已在字面量
    之外（如 JSON 键名本身带引号）时返回 ``None``，继续使用原始捕获文本。

    Args:
        line: 单行源码。
        span: 敏感名称所在字面量的 ``(起始偏移, 结束偏移)``。
        value_start: 正则捕获的赋值右侧起始偏移。
        value_end: 正则捕获的赋值右侧结束偏移。

    Returns:
        字面量内部的赋值文本；右侧不在该字面量内时返回 ``None``。
    """

    start, end = span
    if not start < value_start < end:
        return None
    closed = end <= len(line) and line[end - 1] == line[start]
    content_end = end - 1 if closed else end
    return line[value_start:min(value_end, content_end)]


def _truncate_at_separator(value: str) -> str:
    """截断赋值右侧中位于引号外的第一个逗号或分号。

    正则只能按行捕获，会把同一行的后续对象字段或语句并入候选值；先截断到第一个
    顶层分隔符，才能把 ``enableRefreshToken: true, locale: 'zh-CN'`` 判定为布尔开关。

    Args:
        value: 尚未规范化的赋值右侧。

    Returns:
        第一个顶层分隔符之前的文本；没有分隔符时原样返回。
    """

    index = 0
    length = len(value)
    while index < length:
        character = value[index]
        if character in "\"'`":
            delimiter = character
            index += 1
            while index < length:
                if value[index] == "\\":
                    index += 2
                    continue
                if value[index] == delimiter:
                    index += 1
                    break
                index += 1
            continue
        if character in ",;":
            return value[:index]
        index += 1
    return value


def _strip_trailing_comment(value: str) -> str:
    """移除赋值右侧的行尾注释，引号内的注释符号不参与判断。

    Args:
        value: 尚未规范化的赋值右侧源码。

    Returns:
        去掉 ``//``、``/*`` 或 ``#`` 行尾注释后的文本；没有注释时原样返回。
    """

    index = 0
    length = len(value)
    while index < length:
        character = value[index]
        if character in "\"'`":
            delimiter = character
            index += 1
            while index < length:
                if value[index] == "\\":
                    index += 2
                    continue
                if value[index] == delimiter:
                    index += 1
                    break
                index += 1
            continue
        if value.startswith("//", index) or value.startswith("/*", index):
            return value[:index]
        if character == "#":
            return value[:index]
        index += 1
    return value


def _normalized_literal(raw_value: str) -> tuple[str, bool]:
    """规范化赋值右侧并标记其是否为显式字符串字面量。

    Args:
        raw_value: 正则捕获的赋值右侧。

    Returns:
        ``(规范化值, 是否带引号)``。规范化只用于规则判断，值不会输出。
    """

    value = _strip_trailing_comment(raw_value)
    value = _truncate_at_separator(value).strip()
    # 环境变量与模板占位符的右花括号必须先于闭合符号清理判定，否则会被误当成
    # 容器结尾，把 ``${DB_PASSWORD}`` 或 ``{token}`` 截成残缺文本。
    if re.fullmatch(r"\$\{[^{}\r\n]+\}", value) or re.fullmatch(
        r"\{[A-Za-z_][A-Za-z0-9_.-]*\}", value
    ):
        return value, False
    # 新增行通常是函数调用、容器或对象字段的一部分；循环移除尾部的分隔符、
    # 闭合符号与空白，才能把 ``refreshToken: null } },`` 判定为空值占位。
    while value and (value[-1] in ",;)]}" or value[-1].isspace()):
        value = value[:-1]
    quoted = len(value) >= 2 and value[0] in {'"', "'", "`"} and value[-1] == value[0]
    if quoted:
        value = value[1:-1].strip()
    return value, quoted


def _is_python_type_annotation(path: str, operator: str, raw_value: str) -> bool:
    """判断敏感名称命中是否为 Python 类型注解或安全默认参数。

    Args:
        path: 仓库相对路径。
        operator: 敏感名称后的 ``:`` 或 ``=`` 运算符。
        raw_value: 运算符右侧尚未规范化的文本。

    Returns:
        Python 文件中的纯类型表达式，或默认值为 ``None``、``False``、空值等
        安全占位符时返回 ``True``；固定字符串和配置赋值返回 ``False``，继续
        执行凭据检查。
    """

    if not path.lower().endswith(".py") or operator != ":":
        return False
    type_expression = (
        r"[A-Za-z_][A-Za-z0-9_.]*(?:\[[A-Za-z0-9_., |\[\]]+\])?"
    )
    # 只解析当前参数的类型和默认值，在首个逗号或右括号处结束；后续参数及
    # 返回注解不能成为当前敏感字段的“固定值”。固定字符串不在允许集合内。
    return bool(
        re.match(
            rf"^{type_expression}\s*"
            r"(?:=\s*(?:None|False|NULL|''|\"\")\s*)?(?:,|\)|$)",
            raw_value.strip(),
            flags=re.IGNORECASE,
        )
    )


def _is_typescript_type_annotation(path: str, operator: str, raw_value: str) -> bool:
    """识别无字符串字面量的 TS 类型表达式，固定值和其他语法仍继续扫描。

    Args:
        path: 语法路径；只有 ``.ts``、``.tsx``、``.vue`` 参与判断。
        operator: 敏感名称后的 ``:`` 或 ``=`` 运算符。
        raw_value: 运算符右侧尚未规范化的文本。

    Returns:
        基础类型联合、对象类型体或类型表达式返回 ``True``；带引号的固定值、
        数字及其他运行期语法返回 ``False``，继续执行凭据检查。
    """

    if PurePosixPath(path).suffix.lower() not in {".ts", ".tsx", ".vue"} or operator != ":":
        return False
    primitive = r"(?:string|number|boolean|unknown|any|never|undefined|null)"
    pattern = rf"\s*{primitive}(?:\[\])?(?:\s*[|&]\s*{primitive}(?:\[\])?)*\s*[,;]?\s*"
    if re.fullmatch(pattern, raw_value) is not None:
        return True
    # 参数或返回值的位置可以是对象类型体，类型表达式没有字符串字面量；
    # 带引号的右侧仍按固定值处理，避免用类型规则放行真实凭据。
    value = _strip_trailing_comment(raw_value).strip()
    if any(character in value for character in "\"'`"):
        return False
    return value.startswith("{") or re.search(r"[;{}<>|&]", value) is not None


def _is_typescript_type_declaration(path: str, line: str) -> bool:
    """判断整行是否为 TypeScript 类型别名或接口声明。

    类型名可能包含 ``Password`` 等敏感词，但声明位置没有凭据取值。

    Args:
        path: 仓库相对路径；只有 ``.ts``、``.tsx``、``.vue`` 参与判断。
        line: 待检查的源码行。

    Returns:
        类型别名或接口声明行返回 ``True``。
    """

    if PurePosixPath(path).suffix.lower() not in {".ts", ".tsx", ".vue"}:
        return False
    return (
        re.match(
            r"\s*(?:export\s+)?(?:declare\s+)?(?:type|interface)\s+[A-Za-z_$]", line
        )
        is not None
    )


def _is_dynamic_expression(value: str, path: str) -> bool:
    """判断赋值右侧是否为运行期表达式或结构化字面量。

    固定凭据必须是单一字面量；自增、成员取值、空值合并、模板插值和字符串拼接
    都属于运行期计算，不能按固定值阻断。仅在源码路径生效，配置文件与 Python
    保持原有保守口径。带固定回退分支的表达式不能整体放行：回退值本身是写死的
    常量，仍按固定凭据口径检查。

    Args:
        value: 已规范化的赋值右侧。
        path: 语法路径。

    Returns:
        右侧不是单一固定字面量时返回 ``True``。
    """

    if _fixed_fallback_literal(value) is not None:
        return False
    return _is_plain_dynamic_expression(value, path)


def _is_plain_dynamic_expression(value: str, path: str) -> bool:
    """判断赋值右侧是否为不含可判定固定回退分支的运行期表达式。

    Args:
        value: 已规范化的赋值右侧。
        path: 语法路径。

    Returns:
        右侧属于运行期计算或结构化字面量时返回 ``True``。
    """

    if not _is_code_path(path) or not value:
        return False
    if "${" in value:
        return True
    if value.startswith(("{", "[")):
        return True
    if re.search(r"\+\+|--|\?\?|\?\.|&&|\|\||===|!==|=>", value):
        return True
    if re.match(r"(?:await|new|typeof|void|yield|delete)\s", value):
        return True
    return _has_label_literal_prefix(value)


def _has_label_literal_prefix(value: str) -> bool:
    """判断右侧是否为“标签前缀字面量 + 运行期操作数”的拼接表达式。

    形如 ``"secret-" + appId`` 的前缀只是字段标签，拼接结果由运行期决定；前缀必须
    是小写单词，且其余部分要出现字面量之外的操作数，避免把 ``"Fake-Prod-2026" + x``
    这类带固定凭据的拼接整体放行。

    Args:
        value: 已规范化的赋值右侧。

    Returns:
        符合标签前缀拼接形态时返回 ``True``。
    """

    spans = _string_literal_spans(value)
    if not spans or spans[0][0] != 0:
        return False
    _, literal_end = spans[0]
    if literal_end >= len(value):
        return False
    prefix = value[1 : literal_end - 1]
    if re.fullmatch(r"[a-z]{1,16}[-_ ]?", prefix) is None:
        return False
    remainder = value[literal_end:]
    for start, end in _string_literal_spans(remainder):
        remainder = remainder[:start] + " " * (end - start) + remainder[end:]
    return re.search(r"[A-Za-z_$]", remainder) is not None


# shell 变量展开：``${NAME}`、``${NAME:-默认值}``、``${NAME:=默认值}``；带引号时
# 整体被正则截成 ``:`` 赋值的写法必须先按展开还原，再判断默认值是否为固定凭据。
SHELL_EXPANSION_PATTERN = re.compile(
    r"\$\{(?P<name>[A-Za-z_][A-Za-z0-9_]*)(?::(?P<operator>[-=?+])(?P<default>[^{}]*))?\}"
)
FALLBACK_OPERATOR_PATTERN = re.compile(r"(?<![?:\w])(?:\?\?|\|\||:-|\bor\b)(?![:?\w])")


def _unwrap_literal_text(text: str) -> str:
    """反复剥掉外围引号，取出字面量文本。

    取值可能是 ``"fixed"``、``'fixed'`` 或源码字符串里的 ``\\"fixed\\"`` 转义写法；
    只有层层都是引号包裹时才算单一字面量，带运算符或拼接的表达式原样返回。

    Args:
        text: 已去除左侧空白的片段。

    Returns:
        去掉外围引号后的文本；不是引号包裹的单一字面量时原样返回。
    """

    current = text.strip()
    while len(current) >= 2 and current[0] == current[-1] and current[0] in "\"'`":
        current = current[1:-1].strip()
    return current


def _single_quoted_literal(segment: str) -> str | None:
    """取出片段内唯一的引号字符串字面量内容。

    Args:
        segment: 已经过顶层分隔符切分的片段。

    Returns:
        整段只有一个引号字符串时返回其内容；带拼接、运算符或裸标识符时返回 ``None``。
    """

    text = segment.strip()
    if not text or re.search(r"[&|<>/]", text):
        return None
    if text[0] not in "\"'`":
        return None
    spans = _string_literal_spans(text)
    if len(spans) != 1:
        return None
    start, end = spans[0]
    if start != 0 or end != len(text):
        return None
    return _unwrap_literal_text(text)


def _fixed_fallback_literal(value: str) -> str | None:
    """提取运行期表达式中固定回退分支的字面量。

    环境变量与配置取值本身来自运行期，但其固定回退分支是写死常量：``os.getenv``、
    ``config.get`` 的默认值参数、``??`` / ``||`` / 分号或冒号加横线写法以及模板
    表达式的回退段都属于同一类取值。只有确认回退分支是显式字符串字面量且不是安全
    占位符时才返回，供调用方按固定凭据继续判定；变量引用、复合表达式与安全占位符
    仍按运行期取值放行。

    Args:
        value: 已规范化的赋值右侧。

    Returns:
        固定回退分支的字面量文本；找不到可判定的固定回退分支时返回 ``None``。
    """

    text = value.strip()
    if not text:
        return None
    unwrapped = _unwrap_literal_text(text)
    if unwrapped == text and re.fullmatch(
        r"\"[^\"\r\n]*\"|'[^'\r\n]*'|`[^`]*`", text, flags=re.DOTALL
    ):
        # 整段就是一个字符串字面量，没有回退分支语法。
        return None
    # shell 写法允许把整个展开式用引号包起来，引号不影响回退值的语义。
    shell = re.fullmatch(r"\$\{([^{}\r\n]*?):-([^{}\r\n]*)\}", unwrapped)
    if shell is not None:
        fallback = shell.group(2).strip()
        if not fallback or re.search(r"[\"'`&|<>]", fallback):
            return None
        return None if _is_safe_placeholder(fallback) else fallback
    call = re.match(r"([A-Za-z_$][A-Za-z0-9_$.]*)\s*\(", text)
    if call is not None and text.endswith(")"):
        callee = call.group(1).rsplit(".", 1)[-1]
        if re.search(
            r"(?i)(?:password|passwd|passphrase|secret|token|credential)", callee
        ):
            # 调用名本身是敏感标识符（如 ``getPassword``）时无法确认语义，
            # 交回原有规则判定；参数里的 ``APP_DB_PASSWORD`` 属于键名，不在此列。
            return None
        if text[call.end() : -1].strip().startswith("${"):
            # ``"${DB_PASSWORD:-}"`` 等变量展开被正则截成了 ``:`` 赋值；键名只是
            # 环境变量名，取值由运行期提供，不是固定凭据。
            return None
        arguments = _split_top_level_fields(text[call.end() : -1])
        for argument in arguments[1:]:
            keyword = re.fullmatch(
                r"[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.+)", argument, re.DOTALL
            )
            if keyword is not None:
                argument = keyword.group(1)
            candidate = _single_quoted_literal(argument)
            if candidate is None or not candidate or _is_safe_placeholder(candidate):
                continue
            return candidate
        return None
    operators = list(FALLBACK_OPERATOR_PATTERN.finditer(text))
    if not operators:
        return None
    cursor = len(text)
    while True:
        previous = [item for item in operators if item.end() <= cursor]
        if not previous:
            return None
        operator = previous[-1]
        segment = text[operator.end() : cursor].strip()
        candidate = _single_quoted_literal(segment)
        if candidate is not None and candidate and not _is_safe_placeholder(candidate):
            return candidate
        cursor = operator.start()


def _is_embedded_source_operand(
    path: str, literal_text: str | None, value: str, explicit_string: bool
) -> bool:
    """判断字符串字面量内部嵌入的源码片段是否为运行期操作数。

    测试夹具会把被测源码放进模板字符串，例如 ``{ apiKey: url }`` 里的 ``url``。
    这类裸标识符、成员取值与方法调用由运行期决定，与真实源码中的同名写法语义一致，
    不是固定凭据。只有嵌在对象、代码块等花括号结构内的无引号操作数才按源码片段
    处理；URL 查询串、连接串和配置文本里的裸词仍按固定值拦截，带引号的取值也不适用。

    Args:
        path: 语法路径，只有源码路径参与判断。
        literal_text: 取值所在字符串字面量的完整文本；取值不在字面量内时为 ``None``。
        value: 已规范化的赋值右侧。
        explicit_string: 整段取值本身是否为源码里的显式字符串字面量。

    Returns:
        嵌入文本是运行期操作数时返回 ``True``；其余情况返回 ``False`` 并继续原检查。
    """

    if explicit_string or not _is_code_path(path) or literal_text is None:
        return False
    if any(character in value for character in "\"'`"):
        return False
    if re.fullmatch(r"[a-zA-Z_$][a-zA-Z0-9_$.]*", value) is None and "(" not in value:
        return False
    return "{" in literal_text and "}" in literal_text


def _label_words(text: str) -> list[str]:
    """把字段名或字面量拆成小写词段，用于自述标签判断。

    Args:
        text: 字段名或字面量内容。

    Returns:
        仅由字母数字组成的词段列表。
    """

    return [word for word in re.split(r"[^0-9A-Za-z]+", text.lower()) if word]


def _is_self_describing_label(key: str, value: str) -> bool:
    """判断字面量是否只是按字段名自述的标签值。

    真实凭据不会包含自身字段名的全部词段；``REAL_USER_TOKEN`` 取
    ``"real-user-token"`` 属于声明性标签，不是可用凭据。

    Args:
        key: 正则捕获的敏感字段名。
        value: 已去除外围引号的字面量内容。

    Returns:
        字段名各词段按顺序出现在字面量中时返回 ``True``。
    """

    key_words = _label_words(_normalized_field_name(key))
    value_words = _label_words(value)
    if not key_words or len(value_words) < len(key_words):
        return False
    position = 0
    for word in value_words:
        if position < len(key_words) and word == key_words[position]:
            position += 1
    return position == len(key_words)


NON_CREDENTIAL_SENTINEL_WORDS = frozenset(
    {
        "disabled",
        "dummy",
        "empty",
        "example",
        "fake",
        "invalid",
        "nil",
        "no",
        "none",
        "not",
        "placeholder",
        "sample",
        "sentinel",
    }
)


def _is_declared_noncredential_name(key: str) -> bool:
    """判断字段名是否明确声明该值不是可用凭据。

    只识别完整词段中的哨兵语义，例如 ``MACHINE_NO_REFRESH_TOKEN`` 与
    ``PLACEHOLDER_API_KEY``；``nonce`` 等包含相同字母的普通名称不受影响。

    Args:
        key: 正则捕获的敏感字段名。

    Returns:
        名称中存在哨兵或占位词段时返回 ``True``。
    """

    return bool(
        NON_CREDENTIAL_SENTINEL_WORDS.intersection(
            _label_words(_normalized_field_name(key))
        )
    )


def _is_noncredential_token_measurement(key: str) -> bool:
    """判断字段是否表示 Token 数量或配额而不是认证凭据。

    仅放行名称中同时包含数量语义和 ``token`` 的字段，例如
    ``max_tokens``、``prompt_token_count``、``token_count``。``access_token``、
    ``refresh_token`` 等认证字段不满足该模式，仍由凭据规则拦截。

    Args:
        key: 已被敏感字段正则捕获的名称。

    Returns:
        字段明确表示 Token 计量值时返回 ``True``。
    """

    return NON_CREDENTIAL_TOKEN_MEASUREMENT_PATTERN.search(key) is not None


def _is_synthetic_placeholder(value: str) -> bool:
    """判断取值是否带仓库约定的显式合成标记。

    仓库约定用 ``DUMMY-``、``CHANGE_ME_`` 等标记把测试夹具和示例值声明为非凭据，
    与 Python 测试的 ``unit-`` 约定同源。标记按大写子串匹配，兼容 ``DUMMY-``、
    ``CHANGE_ME_ACCESS_TOKEN`` 与 ``prefix-DUMMY`` 等既有写法；带标记的取值不按
    固定凭据阻断，其余凭据规则（密钥前缀、URL 凭据、私钥）仍然独立生效。

    Args:
        value: 已去除外围引号的字段值或语句文本。

    Returns:
        文本中出现任一合成标记时返回 ``True``。
    """

    upper = value.strip().upper()
    return any(marker in upper for marker in SYNTHETIC_PLACEHOLDER_MARKERS)


def _is_sql_binding_placeholder(value: str) -> bool:
    """判断赋值右侧是否为 SQL 绑定参数及其后续语句文本。

    ``SET refresh_token = ? WHERE id = ?`` 这类 SQL 文本里，字段取值由 JDBC、
    MyBatis 或 JPA 在运行期绑定，不是写死的凭据；占位符之后的文本属于同一语句的
    其余部分。写死的字面量（``SET api_key = 'realkey'``）不以占位符开头，仍按
    固定凭据拦截。

    Args:
        value: 已规范化的赋值右侧。

    Returns:
        取值以 ``?``、``?1``、``:name``、``#{name}`` 或 ``${name}`` 开头，且其后
        只有同一语句续写文本时返回 ``True``。
    """

    text = value.strip()
    match = SQL_BINDING_PLACEHOLDER_PATTERN.match(text)
    if match is None or match.start() != 0:
        return False
    remainder = text[match.end() :]
    # 占位符之后必须是同一语句的续写（空白、逗号、右括号或分号）；紧跟字母数字说明
    # 命中另有取值，例如把状态文本截成了占位符，不能据此放行。
    return not remainder or remainder[0] in " \t,);"


def _is_safe_placeholder(value: str) -> bool:
    """判断敏感字段值是否为空、变量引用或明确占位符。

    Args:
        value: 已去除外围引号的字段值。

    Returns:
        不包含固定凭据时返回 ``True``。零值是空初始化，``?`` 是 SQL 绑定参数，
        ``{name}`` 是模板占位符，三者与 NULL、NONE、FALSE 同属无凭据取值；
        带 ``DUMMY``、``CHANGE_ME`` 等合成标记的取值按仓库约定放行。
    """

    stripped = value.strip()
    upper = stripped.upper()
    if not stripped or upper in {"NULL", "NONE", "FALSE"}:
        return True
    if re.fullmatch(r"0+(?:\.0+)?", stripped):
        return True
    if stripped == "?":
        return True
    if re.fullmatch(r"\{[A-Za-z_][A-Za-z0-9_.-]*\}", stripped):
        return True
    if re.fullmatch(r"\$(?:[A-Za-z_][\w.:]*|\{[^{}\r\n]+\}|\([^()\r\n]+\))", stripped):
        return True
    if stripped.startswith(("{{", "%")):
        return True
    return _is_synthetic_placeholder(stripped)


def _contains_unsafe_embedded_credential_url(line: str, path: str = "") -> bool:
    """判断文本是否包含未使用明确占位符的 URL 用户信息。

    Args:
        line: 待检查的单行文本。
        path: 原始文件路径，仅 Python 测试可使用约定的双端虚拟凭据。

    Returns:
        URL 中的用户名或密码不是安全占位符时返回 ``True``。
    """

    for credential_url in EMBEDDED_CREDENTIAL_URL_PATTERN.finditer(line):
        username = credential_url.group("username")
        password = credential_url.group("password")
        if _is_unit_test_credential(path, repr(username)) and _is_unit_test_credential(
            path, repr(password)
        ):
            continue
        if not (_is_safe_placeholder(username) and _is_safe_placeholder(password)):
            return True
    return False


def _contains_private_key_payload(body: str) -> bool:
    """判断 PEM 块正文是否包含真实私钥负载，而不是生成代码常量。

    Args:
        body: PEM 头尾之间的文本。

    Returns:
        正文清理换行和可选元数据后是足够长度的 Base64 数据时返回 ``True``。
    """

    normalized_body = body.replace("\\r", "").replace("\\n", "\n")
    payload_lines = []
    for raw_line in normalized_body.splitlines():
        line = raw_line.strip()
        if not line or line.startswith(("Proc-Type:", "DEK-Info:")):
            continue
        payload_lines.append(line)
    payload = "".join(payload_lines)
    return PRIVATE_KEY_PAYLOAD_PATTERN.fullmatch(payload) is not None


def _scan_private_key_group(path: str, start_line: int, content: str) -> list[Finding]:
    """扫描一组连续新增行中的完整私钥材料。

    Args:
        path: 仓库相对路径。
        start_line: 连续新增内容在暂存版本中的起始行号。
        content: 保留换行关系的连续新增内容。

    Returns:
        检测到的完整私钥材料列表；仅有 PEM 头尾生成逻辑时不报告。
    """

    findings = []
    for private_key in PRIVATE_KEY_BLOCK_PATTERN.finditer(content):
        if not _contains_private_key_payload(private_key.group("body")):
            continue
        line_number = start_line + content[: private_key.start()].count("\n")
        findings.append(Finding(path, line_number, "private-key", "发现完整私钥材料"))
    return findings


def _scan_added_private_keys(
    path: str, added_lines: list[tuple[int, str]]
) -> list[Finding]:
    """按连续区段扫描暂存区新增行，避免跨 Git hunk 拼接出伪 PEM 块。

    Args:
        path: 仓库相对路径。
        added_lines: ``(暂存版本行号, 行内容)`` 列表。

    Returns:
        当前文件新增内容中的完整私钥材料列表。
    """

    findings = []
    group: list[tuple[int, str]] = []
    for line_number, line in added_lines:
        if group and line_number != group[-1][0] + 1:
            findings.extend(
                _scan_private_key_group(
                    path, group[0][0], "\n".join(item[1] for item in group)
                )
            )
            group = []
        group.append((line_number, line))
    if group:
        findings.extend(
            _scan_private_key_group(
                path, group[0][0], "\n".join(item[1] for item in group)
            )
        )
    return findings


def _python_docstring_lines(source: str) -> set[int]:
    """从完整暂存源码识别纯文档行，解析失败时保守保留原有扫描。

    Args:
        source: Python 文件的完整内容，不执行其中的代码。

    Returns:
        只包含模块、类或函数 Docstring 的行号；同一行有其他语句时不豁免。
    """

    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        # 不支持的语法或损坏源码不能扩大豁免范围。
        return set()
    lines = source.splitlines()
    result: set[int] = set()
    for node in ast.walk(tree):
        if not isinstance(
            node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
        ):
            continue
        if not node.body or not isinstance(node.body[0], ast.Expr):
            continue
        value = node.body[0].value
        if not isinstance(value, ast.Constant) or not isinstance(value.value, str):
            continue
        assert value.end_lineno is not None and value.end_col_offset is not None
        for number in range(value.lineno, value.end_lineno + 1):
            # AST 列号是 UTF-8 字节偏移，不能按中文字符索引截取。
            encoded = lines[number - 1].encode("utf-8")
            if number == value.lineno and encoded[:value.col_offset].strip():
                continue
            if number == value.end_lineno and encoded[value.end_col_offset:].strip():
                continue
            result.add(number)
    return result


def _python_assignment_value(line: str, key: str) -> str | None:
    """提取单行 Python 赋值右侧，避免类型注解和行尾注释被当成凭据。

    Args:
        line: 待检查的源码行。
        key: 正则已匹配的敏感字段名。

    Returns:
        唯一匹配赋值的右侧源码；不完整或含多个语句时返回 None 并保留原检查。
    """

    source = line.strip()
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return None
    if len(tree.body) != 1:
        return None
    statement = tree.body[0]
    if isinstance(statement, ast.AnnAssign):
        targets = [statement.target]
    elif isinstance(statement, ast.Assign):
        targets = statement.targets
    else:
        return None
    if statement.value is None:
        return None
    if not any(ast.get_source_segment(source, target) == key for target in targets):
        return None
    return ast.get_source_segment(source, statement.value)


def _markdown_python_lines(source: str) -> set[int]:
    """从完整 Markdown 内容定位显式标记的 Python 围栏代码行。

    Args:
        source: 暂存版本的完整文档，不执行代码块内容。

    Returns:
        Python 代码行号集合；未知语言仍沿用配置扫描规则。
    """

    result: set[int] = set()
    fence = ""
    is_python = False
    for number, line in enumerate(source.splitlines(), start=1):
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
        if not fence:
            if marker:
                fence = marker.group(1)
                is_python = marker.group(2).strip().lower() in {"python", "py", "python3"}
            continue
        # 只有同类且不短于起始围栏的独占行才结束代码块，避免错判嵌套标记。
        if (
            marker
            and marker.group(1)[0] == fence[0]
            and len(marker.group(1)) >= len(fence)
            and not marker.group(2).strip()
        ):
            fence = ""
            is_python = False
        elif is_python:
            result.add(number)
    return result


def _normalized_field_name(key: str) -> str:
    """将驼峰、常量名和分隔符统一为小写词段，用于识别字段用途。"""

    words = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", key)
    words = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", words)
    return re.sub(r"[._-]+", "_", words).lower()


def _noncredential_setting_kind(key: str) -> str | None:
    """按明确词段识别计量、开关、类型、路径、名称和标识符字段，不按敏感子串放行。

    Args:
        key: 已规范化为小写下划线形式的字段名。
    Returns:
        支持的字段用途；没有足够语义证据时返回 None。
    """

    if _is_noncredential_token_measurement(key) or re.search(
        r"(?:password|passwd|token|secret|credential)s?_"
        r"(?:(?:min|max)_length|timeout|ttl|expire_(?:seconds|minutes|hours)|"
        r"expires_in|(?:column_)?(?:limit|length|size|bytes)|max|min)"
        r"(?:_seconds|_minutes|_hours)?$", key
    ):
        return "number"
    if (
        key == "allow_credentials"
        or re.search(
            r"(?:^|_)(?:password|token|secret|credential)s?_(?:enabled|required)$", key
        )
        or re.search(
            r"(?:^|_)enable[d]?_(?:refresh|access|auth|api|client)?_?tokens?$", key
        )
        or re.search(
            r"(?:^|_)(?:refresh|access|auth|api|client)?_?tokens?_(?:enabled|required)$",
            key,
        )
    ):
        return "boolean"
    if re.search(r"(?:^|_)token_type$", key):
        return "token-type"
    if re.search(r"(?:^|_)(?:file|path)$", key):
        return "path"
    # 请求头名与查询参数名是协议名称，不是凭据本体；值仍须是名称形态。
    if re.search(r"(?:^|_)(?:header|parameter|param)$", key):
        return "name"
    # 提示、消息与标签字段存放展示文案或国际化键名，不存放凭据本体。
    if key == "tokenizer_name" or re.search(
        r"(?:^|_)(?:token_storage_key|tip|message|msg|label|hint)$", key
    ):
        return "identifier"
    return None


def _is_noncredential_setting(key: str, value: str, *, quoted: bool) -> bool:
    """仅在用途和值一致时放行元数据；先前命中的密钥格式和 URL 仍保留。

    Args:
        key: 原始字段名，兼容下划线、驼峰和大写常量。
        value: 规范化后的完整赋值文本，不输出到诊断。
        quoted: 值是否为显式字符串，用于限制布尔开关的类型。
    Returns:
        能确认是非凭据配置时返回 True；类型不符或未知用途返回 False。
    """

    kind = _noncredential_setting_kind(_normalized_field_name(key))
    if kind == "number":
        return re.fullmatch(r"[0-9]+(?:_[0-9]+)*", value) is not None
    if kind == "boolean":
        return not quoted and value.lower() in {"true", "false"}
    if kind == "token-type":
        return value.lower() in {"bearer", "basic", "jwt"}
    if kind == "path":
        # 必须具备本地目录结构；普通固定字符串、URL 和后续语句不能冒充路径。
        return re.fullmatch(
            r"(?:/|\.{1,2}/|[A-Za-z]:[/\\]|\\\\|[\w.-]+[/\\])[\w ./\\-]+", value
        ) is not None
    if kind == "name":
        # 请求头或查询参数名称是单个标识符词，带点号或空白的长值仍按凭据处理。
        return re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,63}", value) is not None
    if kind == "identifier":
        return re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.-]*", value) is not None
    return False


def _is_credential_field(key: str) -> bool:
    """识别明确凭据名称；已知元数据类型不符也保持阻断，其他名称仅提示。"""

    normalized = _normalized_field_name(key)
    if normalized in {"secretkey", "accesstoken", "refreshtoken", "authtoken", "clientsecret"}:
        return True
    if _noncredential_setting_kind(normalized) is not None:
        return True
    return re.search(
        r"(?:^|_)(?:password|passwd|passphrase|secret|token|credential)s?"
        r"(?:_(?:key|value|hash|salt|digest))?$|"
        r"(?:^|_)(?:api|access|private)_?key(?:_value)?$", normalized
    ) is not None


def _is_unit_test_credential(path: str, raw_value: str) -> bool:
    """识别 Python 测试中的固定虚拟凭据，不执行表达式或生成重复字符串。

    Args:
        path: 仓库相对路径；仅接受 test/tests 目录、test_*.py 或 *_test.py。
        raw_value: 敏感字段右侧源码，可包含字典条目的末尾逗号。

    Returns:
        值严格符合 unit- 加 8 至 128 个相同小写字母或数字时返回 True。
        未知语法、过长输入或非测试路径返回 False，继续原有扫描。
    """

    test_path = PurePosixPath(path)
    if test_path.suffix != ".py" or not (
        {"test", "tests"}.intersection(test_path.parts[:-1])
        or test_path.name.startswith("test_")
        or test_path.name.endswith("_test.py")
    ):
        return False
    # 限制解析规模；只检查 AST 形状，不使用 eval 或按重复次数分配内存。
    source = raw_value.strip().removesuffix(",").strip()
    if len(source) > 256:
        return False
    try:
        expression = ast.parse(source, mode="eval").body
    except (SyntaxError, ValueError):
        return False
    if isinstance(expression, ast.Constant) and isinstance(expression.value, str):
        return re.fullmatch(r"unit-([a-z0-9])\1{7,127}", expression.value) is not None
    if not (
        isinstance(expression, ast.BinOp)
        and isinstance(expression.op, ast.Add)
        and isinstance(expression.left, ast.Constant)
        and expression.left.value == "unit-"
        and isinstance(expression.right, ast.BinOp)
        and isinstance(expression.right.op, ast.Mult)
    ):
        return False
    character = expression.right.left
    count = expression.right.right
    return (
        isinstance(character, ast.Constant)
        and isinstance(character.value, str)
        and re.fullmatch(r"[a-z0-9]", character.value) is not None
        and isinstance(count, ast.Constant)
        and type(count.value) is int
        and 8 <= count.value <= 128
    )


def _split_top_level_fields(text: str) -> list[str]:
    """按引号外的逗号或分号把嵌入文本拆成独立字段。

    字符串字面量内部可能嵌入 SQL、JSON 或配置文本；只有位于引号外层的分隔符才
    划分字段，引号内的逗号（``'2026, Q1'``）与反斜杠转义不能切断取值。拆出的片段
    仍保留原有引号与语法，供逐字段检查复用同一套规则。

    Args:
        text: 字面量内部的文本片段。

    Returns:
        去掉空白的字段片段列表；没有顶层分隔符时返回单一原片段。
    """

    fields: list[str] = []
    current: list[str] = []
    index = 0
    length = len(text)
    while index < length:
        character = text[index]
        if character in "\"'`":
            delimiter = character
            current.append(character)
            index += 1
            while index < length:
                if text[index] == "\\":
                    current.append(text[index : index + 2])
                    index += 2
                    continue
                current.append(text[index])
                if text[index] == delimiter:
                    index += 1
                    break
                index += 1
            continue
        if character in ",;":
            fields.append("".join(current).strip())
            current = []
            index += 1
            continue
        current.append(character)
        index += 1
    fields.append("".join(current).strip())
    return [field for field in fields if field]


def _scan_embedded_literal_fields(
    path: str, line_number: int, inner_value: str
) -> list[Finding] | None:
    """逐字段检查字符串字面量内部的嵌入文本，不再因出现后续字段而整体豁免。

    字面量里嵌入 SQL 或 JSON 时，同一行会包含多个敏感赋值。此时必须保留引号与
    语法语义按字段分别检查：``{"password": "realkey", "api_key": "other"}`` 中的
    每个取值都由各自字段独立判定，多一个敏感字段不会让前一个字段免检。文本没有
    顶层分隔符时返回 ``None``，由调用方继续原有单字段规则。

    Args:
        path: 仓库相对路径。
        line_number: 暂存版本中的行号。
        inner_value: 字面量内部的赋值右侧文本。

    Returns:
        嵌入了多个字段时返回逐字段检查得到的去重结果（可为空列表，表示各字段均
        合法）；没有顶层字段分隔符时返回 ``None``。
    """

    if not any(character in inner_value for character in "\"'`"):
        return None
    fields = _split_top_level_fields(inner_value)
    if len(fields) < 2:
        return None
    findings: list[Finding] = []
    for field in fields:
        # 片段来自字符串内容，仍按字面量语义解析，避免把嵌入的源码语法当真实赋值。
        assignment = SENSITIVE_ASSIGNMENT_PATTERN.search(field)
        if assignment is not None:
            literal, quoted = _normalized_literal(assignment.group("value"))
            if quoted and (
                _is_self_describing_label(assignment.group("key"), literal)
                or _is_fixture_placeholder(literal)
            ):
                # 取值只是按字段名自述的标签或短夹具占位标识，不构成固定凭据。
                continue
        findings.extend(_scan_added_line(path, line_number, field, literal_text=True))
    return list(dict.fromkeys(findings))


def _scan_embedded_sql_credentials(path: str, line_number: int, text: str) -> list[Finding]:
    """检查嵌在源码字符串里的 SQL 语句中与敏感字段对应的写死取值。

    语句可能没有任何源级赋值语法，例如 ``INSERT INTO t (id, password, api_key)
    VALUES (1, 'fixed', 'other')``。这里只按列名与取值的对应关系取出敏感字段的取值，
    再复用固定凭据规则判定：绑定参数、显式占位符与相邻元数据（``'/home'``、
    ``'Bearer'``）仍由原有规则放行，写死凭据照常阻断。

    Args:
        path: 仓库相对路径。
        line_number: 暂存版本中的行号。
        text: 单行嵌入 SQL 文本。

    Returns:
        该语句中写死凭据产生的去重问题列表；没有可判定取值时返回空列表。
    """

    findings: list[Finding] = []
    for key, raw_value in _sensitive_sql_assignments(text):
        # ``@name`` 是 MySQL 会话变量/绑定参数写法，取值由运行期提供，不是写死凭据。
        operand = raw_value.strip()
        if re.fullmatch(r"@{1,2}[A-Za-z_][A-Za-z0-9_]*", operand):
            continue
        # 取值只是按字段名自述的标签（``api_key = 'keyA'``）或仓库约定的短夹具
        # 占位值（``secretA``）时不构成固定凭据；判断必须基于 SQL 里的真实字段名，
        # 不能借用外层源码行里的其他字段名。
        literal, quoted = _normalized_literal(operand)
        if quoted and (
            _is_self_describing_label(key, literal) or _is_fixture_placeholder(literal)
        ):
            continue
        findings.extend(_scan_added_line(
            path, line_number, f"{key} = {raw_value}", literal_text=True,
        ))
    return list(dict.fromkeys(findings))


def _remainder_has_credential(path: str, line_number: int, raw_value: str) -> bool:
    """判断赋值右侧截断后的剩余文本是否仍会命中凭据规则。

    同一行可能包含多个字段；只有剩余部分确实会报告凭据时才继续阻断，避免把
    ``{"MYSQL_ROOT_PASSWORD": "DUMMY-a", "MINIO_ROOT_PASSWORD": "DUMMY-b"}``
    这类合成夹具整体判成固定凭据。递归范围严格递减，不会重复扫描同一段文本。

    Args:
        path: 仓库相对路径。
        line_number: 暂存版本中的行号。
        raw_value: 当前字段的原始赋值右侧。

    Returns:
        剩余文本仍会报告凭据时返回 ``True``。
    """

    prefix = _truncate_at_separator(raw_value)
    if not prefix:
        return False
    remainder = raw_value[len(prefix) :].lstrip(",;").strip()
    if not remainder:
        return False
    return bool(_scan_added_line(path, line_number, remainder))


def _scan_added_line(
    path: str,
    line_number: int,
    line: str,
    *,
    is_docstring: bool = False,
    is_python_code: bool = False,
    scan_assignment: bool = True,
    literal_text: bool = False,
) -> list[Finding]:
    """扫描一条暂存区新增行，且不把命中值写入结果。

    Args:
        path: 仓库相对路径。
        line_number: 暂存版本中的行号。
        line: 不包含 Git diff 前缀的新增内容。
        is_docstring: 由完整暂存源码确认的纯 Docstring 行，仅跳过赋值规则。
        is_python_code: 当前行是否位于 Markdown 的 Python 围栏内。
        scan_assignment: 完整 Python AST 已负责赋值时，原始行只扫描强信号。
        literal_text: 当前文本来自字符串内容，冒号表达式不能当成类型注解。

    Returns:
        当前行命中的安全问题列表。
    """

    # 仅扫描器自身的伪造样本可跳过，普通业务文件不能借助注释绕过检查。
    if path == SELF_TEST_PATH and SELF_TEST_ALLOW_MARKER in line:
        return []

    findings: list[Finding] = []
    upper_line = line.upper()
    if SECRET_PREFIX_PATTERN.search(line) and not any(
        marker in upper_line
        for marker in ("EXAMPLE", "DUMMY", "PLACEHOLDER", "REDACTED")
    ):
        findings.append(Finding(path, line_number, "secret-prefix", "发现常见密钥前缀"))
    if _contains_unsafe_embedded_credential_url(line, path):
        findings.append(
            Finding(path, line_number, "url-userinfo", "URL 中嵌入了账号和密码")
        )

    # 注释仍执行密钥前缀和 URL 凭据扫描，但不把示例赋值语法当成真实配置。
    if not scan_assignment or is_docstring or line.lstrip().startswith(("#", "//", "/*", "*", "<!--")):
        return findings

    assignment = SENSITIVE_ASSIGNMENT_PATTERN.search(line)
    if assignment is None:
        return findings
    key = assignment.group("key")
    # 源码标识符不能以数字开头；命中形如 ``%26password`` 的百分号转义尾部时，
    # 匹配到的并不是字段名，继续按赋值处理只会产生误报。
    if _is_code_path(path) and re.match(r"[A-Za-z_$]", key) is None:
        return findings
    # TypeScript 类型别名与接口声明只有类型名，没有凭据取值。
    if _is_typescript_type_declaration(path, line):
        return findings
    # 文档代码块只复用 Python 语法识别，报告路径与其他凭据规则保持原样。
    syntax_path = "snippet.py" if is_python_code else path
    if literal_text:
        # 可解析的 Python 赋值保留表达式语义；其余嵌入内容按配置文本检查。
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", SyntaxWarning)
                warnings.simplefilter("ignore", DeprecationWarning)
                tree = ast.parse(line)
        except (SyntaxError, ValueError):
            tree = ast.Module(body=[], type_ignores=[])
        if len(tree.body) > 1:
            # 一条样例可包含多条语句，不能因第一个字段合法而遗漏后面的凭据。
            for statement in tree.body:
                findings.extend(_scan_added_line(
                    path, line_number, ast.unparse(statement), literal_text=True,
                ))
            return list(dict.fromkeys(findings))
        syntax_path = "snippet.py" if any(
            isinstance(node, (ast.Assign, ast.AnnAssign)) and node.value is not None
            for node in tree.body
        ) else "literal.yaml"
    if _is_python_type_annotation(
        path=syntax_path,
        operator=assignment.group("operator"),
        raw_value=assignment.group("value"),
    ):
        return findings
    if not literal_text and _is_typescript_type_annotation(
        syntax_path, assignment.group("operator"), assignment.group("value")
    ):
        return findings
    raw_value = assignment.group("value")
    from_literal = False
    enclosing_literal_text: str | None = None
    if not literal_text:
        # 命中位于字符串字面量内部时，只有字面量内部的文本才是候选值；提示语、
        # SQL 语句和 URL 中的赋值语法属于字面量文本，不能按配置赋值阻断。
        literal = _enclosing_literal(line, assignment.start("key"))
        if literal is not None:
            inner_value = _in_literal_value(
                line, literal, assignment.start("value"), assignment.end("value")
            )
            if inner_value is not None:
                if _is_code_path(path):
                    if not inner_value.strip():
                        return findings
                    # 嵌入文本含多个字段时逐字段检查：先前字段不能因为有后续敏感
                    # 赋值而被整体豁免，逐字段结果本身就是本行的最终结论。
                    embedded = _scan_embedded_literal_fields(
                        path, line_number, inner_value
                    )
                    if embedded is not None:
                        return list(dict.fromkeys([*findings, *embedded]))
                raw_value = inner_value
                from_literal = True
                enclosing_literal_text = line[literal[0] : literal[1]]
            elif _is_code_path(path):
                # 取值落在字面量之外（如 JSON 键名在引号内、取值在键名引号之外）时，
                # 不能因捕获跨过引号边界就整行放行。键名后紧跟赋值符说明引号外就是
                # 该字段的取值，按同一套规则继续判定；否则只把引号之后的剩余文本按
                # 源码检查，长度严格递减。
                tail = line[literal[1] :]
                if re.match(r"\s*(?::(?!:)|=(?!=))", tail) is not None:
                    raw_value = tail
                    from_literal = True
                elif tail.strip():
                    findings.extend(_scan_added_line(
                        path, line_number, tail, is_python_code=is_python_code,
                    ))
                    return list(dict.fromkeys(findings))
    if syntax_path.lower().endswith(".py"):
        parsed_value = _python_assignment_value(line, key)
        if parsed_value is not None:
            raw_value = parsed_value
            from_literal = False
    # 同一行可能还有别的敏感赋值；截断只服务于当前字段的类型判断，剩余文本若
    # 仍会报告凭据，就不能因为前一个字段合法而整行放行。
    single_assignment = not _remainder_has_credential(path, line_number, raw_value)
    if single_assignment and re.fullmatch(
        r"\[\s*]|\{\s*}|\(\s*\)", raw_value.strip().rstrip(",;")
    ):
        return findings
    value, quoted = _normalized_literal(raw_value)
    # shell 的 ``${NAME:-}``、``${NAME:=}`` 等展开会被正则截成 ``:`` 赋值；键名只是
    # 环境变量名，取值由运行期提供，不是固定凭据。带非空默认值的写法由固定回退
    # 分支规则单独处理。
    shell_expansion = SHELL_EXPANSION_PATTERN.fullmatch(value)
    if shell_expansion is None and not quoted and raw_value.strip().endswith("}"):
        # 带引号的展开会被正则截成 ``-"`` 之外的取值；``-1`` 之类普通数值不以
        # 右花括号结尾，不会命中该分支。
        truncated = re.fullmatch(r"-(?P<default>[^{}]*?)[\s\"'`]*\}", raw_value.strip())
        if truncated is not None:
            shell_expansion = truncated
    if shell_expansion is not None:
        default = shell_expansion.groupdict().get("default") or ""
        if not _is_safe_placeholder(default):
            findings.append(Finding(
                path, line_number, "sensitive-assignment",
                f"敏感字段 {key} 使用固定回退值",
            ))
        return list(dict.fromkeys(findings))
    # 环境变量与配置取值本身由运行期决定，但其固定回退分支是写死常量。回退值必须在
    # 规范化把调用参数截成第一个字段之前取出，后续按固定凭据判定；空串、null 与
    # 显式占位符返回 None，仍按运行期语义放行。
    fixed_fallback = _fixed_fallback_literal(raw_value)
    # 整段取值本身是否为显式字符串字面量：源码里的 ``"realkey"`` 与字面量内部的
    # ``'realkey'`` 都算，字面量内部的裸源码文本（``url``）不算。
    explicit_string = quoted
    # 字面量内部的文本按字符串内容处理；测试夹具嵌入的源码片段由运行期操作数规则
    # 单独识别，见 _is_embedded_source_operand。
    quoted = quoted or from_literal
    if single_assignment and fixed_fallback is None and re.fullmatch(
        r"\[\s*]|\{\s*}|\(\s*\)", value
    ):
        return findings
    if single_assignment and fixed_fallback is None and _is_noncredential_setting(
        key, value, quoted=quoted
    ):
        return findings
    # Token 计量名称必须同时匹配数量值或未加引号的中文字段说明，不能仅凭
    # 名称放行固定字符串。前面的密钥前缀与 URL 检查结果仍然保留。
    if single_assignment and fixed_fallback is None and _is_noncredential_token_measurement(
        _normalized_field_name(key)
    ) and (
        re.fullmatch(r"[0-9]+(?:_[0-9]+)*", value)
        or (
            not quoted
            and assignment.group("operator") == ":"
            and re.fullmatch(
                r"[\u3400-\u4dbf\u4e00-\u9fff][\u3400-\u4dbf\u4e00-\u9fff0-9，。；：、（）\s]*", value
            )
        )
    ):
        return findings
    if single_assignment and fixed_fallback is None and _is_safe_placeholder(value):
        return findings
    # SQL 文本里的绑定参数不是固定值：``SET refresh_token = ? WHERE id = ?`` 的取值
    # 由运行期参数提供，占位符之后的语句文本不属于当前字段。写死的字面量不以占位符
    # 开头，仍按固定凭据拦截；源码里整段带引号的显式字符串不适用这条规则。
    if (
        single_assignment
        and fixed_fallback is None
        and not explicit_string
        and _is_sql_binding_placeholder(value)
    ):
        return findings
    # 仅豁免测试虚拟值的固定赋值告警；此前密钥前缀、URL 及独立私钥检查仍生效。
    if single_assignment and not is_python_code and _is_unit_test_credential(
        path, raw_value
    ):
        return findings
    # 字段名或字面量本身声明该值不是凭据时，只有单一固定字符串会被放行；
    # 密钥前缀、URL 与私钥规则已在前面的独立检查中生效。固定回退分支已确认是写死
    # 取值，字段名自述或规范化截断都不能把它当成标签整体放行。
    if (
        single_assignment
        and fixed_fallback is None
        and quoted
        and not _is_config_path(syntax_path)
        and (_is_declared_noncredential_name(key) or _is_self_describing_label(key, value))
    ):
        return findings
    # 运行期表达式与结构化字面量不是固定凭据；显式字符串与配置文本仍需拦截。
    if single_assignment and _is_dynamic_expression(value, syntax_path):
        return findings
    # 字符串字面量里嵌入的源码片段按同一运行期口径判断：``{ apiKey: url }`` 的取值是
    # 变量引用，不是固定凭据；URL 查询串与配置文本里的裸词仍继续拦截。
    if single_assignment and _is_embedded_source_operand(
        syntax_path, enclosing_literal_text, value, explicit_string
    ):
        return findings
    # Java/Python/TypeScript 中的变量或方法调用不是固定凭据；显式字符串仍需拦截。
    # 已确认固定回退分支的表达式不能按运行期调用整体放行，回退值仍按固定凭据判定。
    if (
        single_assignment
        and fixed_fallback is None
        and not quoted
        and not _is_config_path(syntax_path)
        and (re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_.]*", value) or "(" in value)
    ):
        return findings
    # 未解析完的同一行若还有敏感赋值，不能依据第一个模糊名称降为提示。
    if _is_credential_field(key) or SENSITIVE_ASSIGNMENT_PATTERN.search(raw_value):
        findings.append(
            Finding(path, line_number, "sensitive-assignment", f"敏感字段 {key} 使用固定值")
        )
    else:
        findings.append(Finding(
            path, line_number, "ambiguous-sensitive-name",
            f"字段 {key} 的用途不明确，需人工核查是否包含凭据", "warning",
        ))
    return findings


def _python_assignment_candidates(source: str) -> list[tuple[int, int, str, bool]] | None:
    """提取真实赋值和字符串中的配置文本，避免把外层列表符号当作字段值。

    Args:
        source: 完整暂存源码；仅解析语法，不执行表达式。
    Returns:
        起止行、独立赋值文本及字符串内容标志；语法失败返回 None，回退逐行扫描。
        赋值跨行时按整个范围关联新增行，确保只修改字段名也能触发检查。
    """
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return None
    docstrings: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.body and isinstance(node.body[0], ast.Expr):
                docstrings.add(id(node.body[0].value))
    candidates: list[tuple[int, int, str, bool]] = []

    def add_assignment(target: ast.AST, value: ast.AST, key: str | None = None) -> None:
        """将字段与完整右值配对；静态解包逐项检查，其他表达式保留源码语义。"""
        if isinstance(target, (ast.Tuple, ast.List)) and isinstance(value, (ast.Tuple, ast.List)):
            if len(target.elts) == len(value.elts):
                for item, assigned in zip(target.elts, value.elts):
                    add_assignment(item, assigned)
                return
        name = key if key is not None else ast.unparse(target)
        if not SENSITIVE_ASSIGNMENT_PATTERN.search(f"{name} = value"):
            return
        if isinstance(value, (ast.List, ast.Tuple, ast.Set)) and not value.elts:
            return
        if isinstance(value, ast.Dict) and not value.keys:
            return
        # 调用或引用并非固定赋值；其内部的关键字、字典和强信号仍独立检查。
        # 例外是带固定回退分支的取值函数：``os.getenv("X", "固定值")`` 的默认值
        # 是写死常量，必须按固定凭据继续判定，不能因整体是调用而免检。
        if isinstance(value, (ast.Call, ast.Name, ast.Attribute, ast.Subscript)):
            if not isinstance(value, ast.Call):
                return
            if _fixed_fallback_literal(ast.unparse(value)) is None:
                return
        text = f"{name} = {ast.unparse(value)}"
        candidates.append((target.lineno, value.end_lineno or value.lineno, text, False))

    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                add_assignment(target, node.value)
        elif isinstance(node, (ast.AnnAssign, ast.NamedExpr)) and node.value is not None:
            add_assignment(node.target, node.value)
        elif isinstance(node, ast.Dict):
            for key, value in zip(node.keys, node.values):
                if isinstance(key, ast.Constant) and isinstance(key.value, str):
                    add_assignment(key, value, key.value)
        elif isinstance(node, ast.keyword) and node.arg is not None:
            add_assignment(node, node.value, node.arg)
        elif isinstance(node, ast.arguments):
            positional = [*node.posonlyargs, *node.args]
            defaults = list(zip(positional[len(positional) - len(node.defaults):], node.defaults))
            defaults.extend(zip(node.kwonlyargs, node.kw_defaults))
            for argument, value in defaults:
                if value is not None:
                    add_assignment(argument, value, argument.arg)
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
            sql_source = bool(EMBEDDED_SQL_STATEMENT_PATTERN.search(node.value))
            for text in node.value.splitlines():
                if EMBEDDED_SQL_STATEMENT_PATTERN.search(text):
                    # 字符串内容本身是 SQL 语句时，列名列表里的敏感列名后面跟的是
                    # 逗号或括号而不是赋值语法；取值写在同一行的 VALUES 与 SET 中，
                    # 必须按语句文本检查，不能把语句当成源码字符串整体放行。
                    if _sensitive_sql_assignments(text):
                        candidates.append((node.lineno, node.end_lineno or node.lineno, text, True))
                elif SENSITIVE_ASSIGNMENT_PATTERN.search(text):
                    # 转义换行与相邻字符串合并后无法精确映射列号，报告原始字面量范围。
                    skipped = sql_source and not _sensitive_sql_assignments(text)
                    if not skipped:
                        candidates.append((node.lineno, node.end_lineno or node.lineno, text, True))
    return candidates


def _inside_quote_literal(text: str, offset: int) -> bool:
    """判断偏移是否落在引号字符串内部。

    SQL 的 VALUES 里也可能出现与敏感字段同名的字面量（例如标签文本
    ``'refresh_token'``）；这类命中不是列名或赋值目标，必须排除。按偏移之前的
    引号数量判断是否位于字符串内部，不依赖正则字符类。

    Args:
        text: 单行嵌入 SQL 文本。
        offset: 命中在文本中的起始偏移。

    Returns:
        偏移位于字符串字面量内部时返回 ``True``。
    """

    prefix = text[:offset]
    return bool(prefix.count("'") % 2 or prefix.count('"') % 2)


def _sensitive_sql_assignments(text: str) -> list[tuple[str, str]]:
    """取出嵌入 SQL 文本里与敏感字段配对的字符串取值。

    语句可能没有源级赋值语法，例如 ``INSERT INTO t (id, password) VALUES (1,
    'fixed')``：此时先按列名列表与取值列表的先后顺序逐项配对，只有敏感列对应的取值
    才作为候选。同时按赋值符识别 ``UPDATE t SET password = 'fixed'`` 与
    ``WHERE password = 'fixed'``，位于引号内部的同名字面量（标签文本）会被排除。

    Args:
        text: 源码字符串中的一行文本。

    Returns:
        ``(字段名, 取值文本)`` 列表；绑定参数、表达式与列定义不返回。
    """

    statement = text.strip()
    if not EMBEDDED_SQL_STATEMENT_PATTERN.search(statement):
        return []
    pairs: list[tuple[str, str]] = []
    columns = re.match(r"(?is)\binsert\s+into\b[^(]*\((?P<columns>[^()]*)\)", statement)
    if columns is not None:
        tuples = re.match(r"(?is)[^()]*\((?P<values>[^()]*)\)", statement[columns.end() :])
        if tuples is not None:
            names = _split_top_level_fields(columns.group("columns"))
            entries = _split_top_level_fields(tuples.group("values"))
            if len(names) == len(entries):
                pairs.extend(
                    (name.strip("`\"' "), entry)
                    for name, entry in zip(names, entries)
                    if _is_credential_field(name.strip("`\"' "))
                )
    for assignment in SENSITIVE_ASSIGNMENT_PATTERN.finditer(statement):
        key = assignment.group("key")
        if not _is_credential_field(key):
            continue
        if _inside_quote_literal(statement, assignment.start("key")):
            continue
        pairs.append((key, _first_sql_assignment_operand(assignment.group("value"))))
    return pairs


def _is_fixture_placeholder(value: str) -> bool:
    """判断取值是否为测试夹具约定的短占位标识。

    仓库夹具用字母加单个大写字母或数字的短标识区分同形字段，例如 ``keyA``、
    ``secretA``；这类 1 至 24 字符、不含其他大写字母的标识不是可用凭据。真实凭据
    通常包含混合大小写、数字分隔或更长随机串，不满足该形态。

    Args:
        value: 已去除外围引号的取值文本。

    Returns:
        取值符合短夹具占位标识时返回 ``True``。
    """

    return re.fullmatch(r"[a-z][a-z0-9_]{0,20}[A-Z][a-z0-9]{0,2}", value) is not None


def _first_sql_assignment_operand(raw_value: str) -> str:
    """取赋值右侧到第一个顶层分隔符之前的文本。

    同一行可能还有后续赋值或子句：``SET password = 'fixed', api_key = 'other'
    WHERE id = 1``。只要第一个取值，才能让后续字段按各自规则独立判定，而不是把整段
    语句当成一个畸形取值。

    Args:
        raw_value: 敏感赋值右侧的原始文本。

    Returns:
        第一个逗号或分号之前的文本；没有分隔符时原样返回。
    """

    return _truncate_at_separator(raw_value).strip()


def _scan_staged_diff(paths: list[str] | None = None) -> list[Finding]:
    """扫描暂存区新增行及禁止提交的环境文件。

    Args:
        paths: 已读取的适用暂存文件；省略时从当前索引查询。
    Returns:
        全部安全问题列表；删除行不会重复报告历史中已经存在的凭据。
    """

    findings = [
        Finding(path, 0, "forbidden-env-file", "真实环境文件不得提交")
        for path in (_staged_paths() if paths is None else paths)
        if _is_forbidden_env_path(path)
    ]
    output = _run_git(
        ["diff", "--cached", "--unified=0", "--no-color", "--diff-filter=ACMR", "--"]
    )
    assert isinstance(output, str)
    current_path = ""
    current_line = 0
    docstring_lines: set[int] = set()
    python_code_lines: set[int] = set()
    added_lines_by_path: dict[str, list[tuple[int, str]]] = {}
    python_candidates: dict[str, list[tuple[int, int, str, bool]] | None] = {}
    sql_sources: dict[str, str] = {}
    for diff_line in output.splitlines():
        if diff_line.startswith("+++ b/"):
            current_path = diff_line[6:]
            docstring_lines = set()
            python_code_lines = set()
            if current_path.lower().endswith(".py"):
                # 必须读取暂存版本；工作区中未暂存的引号变化不能影响提交判定。
                source = _run_git(["show", f":{current_path}"])
                assert isinstance(source, str)
                docstring_lines = _python_docstring_lines(source)
                python_candidates[current_path] = _python_assignment_candidates(source)
            elif current_path.lower().endswith(".md"):
                # 围栏可能处于未修改的上下文中，必须从完整暂存文档定位语言。
                source = _run_git(["show", f":{current_path}"])
                assert isinstance(source, str)
                python_code_lines = _markdown_python_lines(source)
            elif current_path.lower().endswith(".sql"):
                source = _run_git(["show", f":{current_path}"])
                assert isinstance(source, str)
                sql_sources[current_path] = source
            continue
        hunk = HUNK_HEADER_PATTERN.match(diff_line)
        if hunk:
            current_line = int(hunk.group("line"))
            continue
        if diff_line.startswith("+") and not diff_line.startswith("+++"):
            added_line = diff_line[1:]
            findings.extend(
                _scan_added_line(
                    current_path,
                    current_line,
                    added_line,
                    is_docstring=current_line in docstring_lines,
                    is_python_code=current_line in python_code_lines,
                    scan_assignment=python_candidates.get(current_path) is None,
                )
            )
            added_lines_by_path.setdefault(current_path, []).append(
                (current_line, added_line)
            )
            current_line += 1
        elif diff_line.startswith(" "):
            current_line += 1
    for path, added_lines in added_lines_by_path.items():
        if path in sql_sources:
            findings.extend(
                Finding(path, item.line, item.rule, item.detail)
                for item in inspect_insert_credentials(
                    sql_sources[path], {line for line, _ in added_lines},
                    lambda key: bool(SENSITIVE_ASSIGNMENT_PATTERN.fullmatch(key + "=value")) and _is_credential_field(key),
                    _is_safe_placeholder,
                    lambda key, value, quoted: _is_noncredential_setting(key, value, quoted=quoted),
                )
            )
        for start, end, text, literal_text in python_candidates.get(path) or []:
            changed = [
                number for number, original in added_lines
                if start <= number <= end
                and not (path == SELF_TEST_PATH and SELF_TEST_ALLOW_MARKER in original)
            ]
            if changed:
                line_number = min(changed)
                if (
                    literal_text
                    and EMBEDDED_SQL_STATEMENT_PATTERN.search(text)
                    and _sensitive_sql_assignments(text)
                ):
                    # SQL 列名列表没有源级赋值语法；按列名与取值的配对检查写死取值。
                    # 同一行仍可能有普通赋值，不能因此跳过原有敏感赋值检查。
                    findings.extend(
                        _scan_embedded_sql_credentials(path, line_number, text)
                    )
                findings.extend(_scan_added_line(path, line_number, text, literal_text=literal_text))
        findings.extend(_scan_added_private_keys(path, added_lines))
    return list(dict.fromkeys(findings))


def _test_python_syntax_regressions() -> None:
    """验证文档误报、带注解赋值及语法失败时的安全边界，样本均为伪造值。"""

    path = "src/service.py"
    safe_assignments = (
        'service_token: str = ""  # 中文说明',  # secret-scan: allow-test
        'service_token = ""  # 中文说明',  # secret-scan: allow-test
        'service_token: str = os.getenv("SERVICE_TOKEN", "")',
    )
    for line in safe_assignments:
        assert not _scan_added_line(path, 1, line), "安全赋值被误报"
    unsafe_assignments = (
        'service_token: str = "Fake-Prod-2026"  # 中文说明',  # secret-scan: allow-test
        'service_token = "Fake#Prod-2026"  # 中文说明',  # secret-scan: allow-test
        'service_token: str = "Fake-Prod-2026"; other = 1',  # secret-scan: allow-test
    )
    for line in unsafe_assignments:
        assert _scan_added_line(path, 1, line), "固定凭据未被拦截"

    source = '\n'.join((
        '"""模块说明。',
        'service_token: 出站服务认证令牌。',  # secret-scan: allow-test
        '"""',
        'class Client:',
        '    """客户端说明。',
        '    service_token: HTTP 出站认证令牌，仅 HTTP 模式使用。',  # secret-scan: allow-test
        '    """',
        '    async def send(self):',
        '        """发送请求。',
        '        provided_token: 请求头读取的值，缺失时为 None。',  # secret-scan: allow-test
        '        """',
        '        pass',
    ))
    docstring_lines = _python_docstring_lines(source)
    assert docstring_lines == {1, 2, 3, 5, 6, 7, 9, 10, 11}
    for number, line in enumerate(source.splitlines(), start=1):
        assert not _scan_added_line(
            path, number, line, is_docstring=number in docstring_lines
        ), "中文文档被误报"

    # 普通多行字符串可能是实际配置，不能因为带三引号而放行。
    assert not _python_docstring_lines(
        'settings = """\nservice_token: 固定值\n"""'  # secret-scan: allow-test
    )
    assert not _python_docstring_lines(
        '"""未闭合文档\nservice_token: 固定值'  # secret-scan: allow-test
    )
    boundary = '"""中文说明。"""; service_token = "Fake-Prod-2026"'  # secret-scan: allow-test
    assert not _python_docstring_lines(boundary)
    assert _scan_added_line(path, 1, boundary), "文档同行赋值未被拦截"
    for line in (
        'service_token: sk-fakecredential123456789',  # secret-scan: allow-test
        '地址: https://user:password@example.invalid/api',  # secret-scan: allow-test
    ):
        assert _scan_added_line(path, 1, line, is_docstring=True), "文档凭据未被拦截"


def _test_markdown_regressions() -> None:
    """验证文档 Python 语法误报修复及围栏、字段类型和凭据拦截边界。"""

    path = "docs/settings.md"
    safe_lines = (
        "secret_key: str",  # secret-scan: allow-test
        "external_api_key: str",  # secret-scan: allow-test
        "access_token_expire_minutes: int = 30",  # secret-scan: allow-test
        "def hash_password(password: str) -> str:",  # secret-scan: allow-test
        "def verify_password(plain_password: str, hashed_password: str) -> bool:",  # secret-scan: allow-test
        "allow_credentials=True,",  # secret-scan: allow-test
        'secret_key: str = os.getenv("SERVICE_KEY")',  # secret-scan: allow-test
    )
    for line in safe_lines:
        assert not _scan_added_line(path, 1, line, is_python_code=True), "Python 示例误报"
    unsafe_lines = (
        'secret_key: str = "Fake-Prod-2026"',  # secret-scan: allow-test
        'password = "Fake-Prod-2026"',  # secret-scan: allow-test
        'allow_credentials="Fake-Prod-2026",',  # secret-scan: allow-test
        'access_token_expire_minutes: str = "Fake-Prod-2026"',  # secret-scan: allow-test
        "access_token = 123456",  # secret-scan: allow-test
        'url = "https://user:password@example.invalid/db"',  # secret-scan: allow-test
        'key = "sk-fakecredential123456789"',  # secret-scan: allow-test
        'secret_key: str = "Fake-Prod-2026',  # secret-scan: allow-test
    )
    for line in unsafe_lines:
        findings = _scan_added_line(path, 8, line, is_python_code=True)
        assert findings, "Python 示例中的凭据未被拦截"
        assert all(item.path == path and item.line == 8 for item in findings)
        assert "Fake-Prod-2026" not in repr(findings), "报告泄露命中值"

    source = "\n".join((
        "```python", safe_lines[0], "```", safe_lines[0],
        "~~~yaml", safe_lines[0], "~~~",
        "````py", safe_lines[1], "```", safe_lines[0], "````",
        "~~~python3", safe_lines[0], "~~~",
        "```python", unsafe_lines[0],
    ))
    python_lines = _markdown_python_lines(source)
    assert python_lines == {2, 9, 10, 11, 14, 17}, "围栏边界识别错误"
    for number in (4, 6):
        assert _scan_added_line(
            path, number, source.splitlines()[number - 1],
            is_python_code=number in python_lines,
        ), "普通文档或其他语言被错误豁免"
    assert _scan_added_line(path, 17, unsafe_lines[0], is_python_code=True)
    for line in (
        "allow_credentials: true",  # secret-scan: allow-test
        "access_token_expire_minutes: 30",  # secret-scan: allow-test
    ):
        assert not _scan_added_line("config.yaml", 1, line), "非凭据配置误报"
    for line in (
        'allow_credentials: "true"',  # secret-scan: allow-test
        "access_token_expire_minutes: 30; password: unsafe",  # secret-scan: allow-test
        "other_allow_credentials: true",  # secret-scan: allow-test
    ):
        assert _scan_added_line("config.yaml", 1, line), "字段或类型边界被扩大"


def _test_unit_credentials_regressions() -> None:
    """验证测试虚拟凭据放行、路径和表达式边界及原有凭据拦截能力。"""

    paths = ("tests/fixture.py", "test/fixture.py", "src/test_bus.py", "src/bus_test.py")
    safe_lines = (
        '"MINIO_ACCESS_KEY": "unit-" + "a" * 16,',  # secret-scan: allow-test
        '"MINIO_SECRET_KEY": "unit-" + "b" * 32,',  # secret-scan: allow-test
        'api_key = "unit-aaaaaaaa"',  # secret-scan: allow-test
        'api_key: str = "unit-" + "0" * 128',  # secret-scan: allow-test
    )
    for path in paths:
        for line in safe_lines:
            assert not _scan_added_line(path, 29, line), "测试虚拟凭据被误报"
    for path in ("src/bus.py", "contest/bus.py", "tests/config.yaml", "docs/test.md"):
        for line in safe_lines[:3]:
            assert _scan_added_line(path, 29, line), "非测试文件被错误豁免"
    for value in (
        '"unit-abcdefghi"', '"unit-" + "ab" * 16', '"unit-" + "a" * 7',
        '"unit-" + "a" * 129', '"unit-" + "a" * -1', '"unit-" + "a" * True',
        '"unit-" + "a" * 1000000000', '"unit-" + "a" * count',
        '"unit-" + "a" * 16 + suffix', '"unit-" + "a" *', '"x"' * 100,
        '__import__("os").getenv("KEY")',
    ):
        assert not _is_unit_test_credential(paths[0], value), "未知表达式被错误豁免"
    for line, rule in (
        ('api_key = "Fake-Prod-2026"', "sensitive-assignment"),  # secret-scan: allow-test
        ('api_key = "sk-fakecredential123456789"', "secret-prefix"),  # secret-scan: allow-test
        ('url = "https://user:password@example.invalid"', "url-userinfo"),  # secret-scan: allow-test
        ('api_key = "unit-aaaaaaaa"; password = "Fake-Prod-2026"', "sensitive-assignment"),  # secret-scan: allow-test
    ):
        findings = _scan_added_line(paths[0], 29, line)
        assert any(item.rule == rule for item in findings), "测试文件凭据未被拦截"
        assert all(item.path == paths[0] and item.line == 29 for item in findings)
        assert "Fake-Prod-2026" not in repr(findings), "报告泄露命中值"
    private_key = "\n".join((
        "-----BEGIN PRIVATE KEY-----", "A" * 64, "-----END PRIVATE KEY-----",
    ))
    assert _scan_added_private_keys(
        paths[0], list(enumerate(private_key.splitlines(), start=1))
    ), "测试文件私钥未被拦截"


def _test_semantic_recognition_regressions() -> None:
    """验证字面量文本、声明位置、运行期表达式与哨兵名称的识别边界。

    正样本覆盖提示语、SQL 文本、类型声明、请求头名、计量字段、布尔开关、运行期
    表达式、结构化取值、哨兵名称和显式合成夹具；负样本锁定真实形态凭据仍然阻断，
    证明这些识别修复没有放宽固定凭据规则。
    """

    safe_samples = (
        # 方法调用参数里的提示文本：命中位于字面量内部且没有取值。
        (
            "src/main/java/AdminBootstrapMain.java",
            'char[] confirmation = input.read("Confirm administrator password: ");',  # secret-scan: allow-test
        ),
        # SQL 文本里的绑定参数不是固定值。
        (
            "src/main/java/MachineTokenQuery.java",
            'jdbc.queryForObject("SELECT COUNT(*) FROM t WHERE refresh_token = ?", Integer.class);',  # secret-scan: allow-test
        ),
        # 字面量内部的 SQL 片段属于文本，不是 Java 配置赋值。
        (
            "src/test/java/SmsPipelineIT.java",
            "jdbc.update(\"UPDATE t SET api_key='keyA', api_secret='secretA', \");",  # secret-scan: allow-test
        ),
        # 文档里的缓存键模板是占位符，不是固定值。
        (
            "docs/redis.md",
            "- Redis 中可能残留 `oauth2_access_token:{token}` 缓存键。",  # secret-scan: allow-test
        ),
        # 类型别名、对象类型体与参数类型没有凭据取值。
        ("src/form.ts", "type PasswordFieldRef = {"),  # secret-scan: allow-test
        (
            "src/form.ts",
            "function generateRsaKeyPair(): { privateKey: string; publicKey: string } {",  # secret-scan: allow-test
        ),
        ("src/form.ts", "async function changePassword(passwords: {"),  # secret-scan: allow-test
        # 请求头名与查询参数名是协议名称，不是凭据本体。
        (
            "src/main/java/SecurityFrameworkUtils.java",
            'private static final String TOKEN_HEADER = "Authorization";',  # secret-scan: allow-test
        ),
        (
            "src/main/java/SecurityFrameworkUtils.java",
            'private static final String TOKEN_PARAMETER = "token";',  # secret-scan: allow-test
        ),
        # 刷新令牌列的存储长度上限是计量元数据。
        (
            "src/test/java/OAuth2MachineTokenTest.java",
            "private static final int REFRESH_TOKEN_COLUMN_LIMIT = 32;",  # secret-scan: allow-test
        ),
        # 布尔开关只控制是否刷新令牌。
        ("config.yaml", "enableRefreshToken: true"),  # secret-scan: allow-test
        # 提示字段存放国际化键名，不是凭据取值。
        (
            "src/lock-screen.test.ts",
            "const PASSWORD_ERROR_TIP = 'authentication.passwordErrorTip';",  # secret-scan: allow-test
        ),
        # 运行期表达式：计数器零初始化、前后缀自增、异步取值、空值合并与模板插值。
        ("src/form-render/dependencies.ts", "let triggerToken = 0;"),  # secret-scan: allow-test
        (
            "src/form-render/dependencies.ts",
            "const currentToken = ++triggerToken;",  # secret-scan: allow-test
        ),
        (
            "src/request/preset-interceptors.ts",
            "const newToken = await refresh;",  # secret-scan: allow-test
        ),
        (
            "src/views/reset-pwd.vue",
            "const body = { oldPassword: values.oldPassword ?? '' };",  # secret-scan: allow-test
        ),
        (
            "src/store/auth.ts",
            "const identity = { accessToken: `test-session-${userId}` };",  # secret-scan: allow-test
        ),
        # 结构化对象取值不是固定凭据字符串。
        (
            "src/api/auth.test.ts",
            "transport.post.mockResolvedValue({ accessToken: { privateValue: 'must-not-appear' } });",  # secret-scan: allow-test
        ),
        # 哨兵名称与自述标签声明该值不是可用凭据。
        (
            "src/main/java/OAuth2MachineToken.java",
            'public static final String MACHINE_NO_REFRESH_TOKEN = "machine-no-refresh-token";',  # secret-scan: allow-test
        ),
        (
            "src/test/java/ApiSignatureAspectTest.java",
            'private static final String APP_SECRET = "protect-test-app-secret";',  # secret-scan: allow-test
        ),
        # 测试夹具使用显式合成值，与现有 unit- 约定同源。
        (
            "src/api/auth.test.ts",
            "const fixture = { accessToken: 'DUMMY-test-access' };",  # secret-scan: allow-test
        ),
        (
            "src/api/auth.test.ts",
            "const fixture = { password: 'DUMMY-test-input' };",  # secret-scan: allow-test
        ),
        # 同一行的多个合成字段各自声明为占位值，整行不再判为固定凭据。
        (
            "src/api/auth.test.ts",
            "const fixture = { accessToken: 'DUMMY-test-access', refreshToken: 'DUMMY-test-refresh' };",  # secret-scan: allow-test
        ),
        # 固定回退分支的安全占位符与变量引用仍按运行期取值放行。
        (
            "src/env_fallback.py",
            'service_token: str = os.getenv("SERVICE_TOKEN", "")',  # secret-scan: allow-test
        ),
        (
            "src/config.ts",
            'export const apiKey = process.env.API_KEY ?? "";',  # secret-scan: allow-test
        ),
        (
            "src/config.ts",
            'export const apiKey = process.env.API_KEY ?? other.apiKey;',  # secret-scan: allow-test
        ),
        (
            "scripts/run.sh",
            'DB_PASSWORD="${APP_DB_' + "PASS" + 'WORD:-}"',  # secret-scan: allow-test
        ),
        (
            "scripts/run.sh",
            'DB_PASSWORD="${APP_DB_' + "PASS" + 'WORD}"',  # secret-scan: allow-test
        ),
    )
    for path, line in safe_samples:
        findings = _scan_added_line(path, 1, line)
        if findings:
            raise AssertionError(f"语义误报样本未被放行：{path} {findings[0].rule}")
    unsafe_samples = (
        ("src/service.py", 'password = "Prod-2026-RealValue"'),  # secret-scan: allow-test
        ("src/service.py", 'api_key = "Fake-Prod-2026"'),  # secret-scan: allow-test
        ("src/service.py", 'access_token = "ghp_' + "a" * 32 + '"'),  # secret-scan: allow-test
        ("src/service.py", "access_token = 123456"),  # secret-scan: allow-test
        (
            "部署/config.yaml",
            "url: https://user:RealPass123@example.invalid/api",  # secret-scan: allow-test
        ),
        # 字面量内部只有一个完整值时仍按固定凭据阻断。
        (
            "src/config.ts",
            "const target = 'jdbc:mysql://localhost/app?password=RealPass123';",  # secret-scan: allow-test
        ),
        # 自述标签与哨兵名称不能掩盖真实密钥形态。
        (
            "src/main/java/Service.java",
            'private static final String APP_SECRET = "Prod-2026-RealValue";',  # secret-scan: allow-test
        ),
        (
            "src/main/java/Service.java",
            'private static final String PASSWORD = "Prod-2026-RealValue" + suffix;',  # secret-scan: allow-test
        ),
        (
            "src/main/java/OAuth2MachineToken.java",
            'public static final String MACHINE_NO_REFRESH_TOKEN = "ghp_' + "b" * 32 + '";',  # secret-scan: allow-test
        ),
        # 已识别的元数据字段在值形态不符时仍按凭据阻断。
        ("config.yaml", 'enableRefreshToken: "RealPass123"'),  # secret-scan: allow-test
        (
            "src/main/java/Service.java",
            'private static final String TOKEN_PARAMETER = "eyJhbGciOiJIUzI1NiJ9.realvalue";',  # secret-scan: allow-test
        ),
        (
            "src/main/java/Service.java",
            'private static final int REFRESH_TOKEN_COLUMN_LIMIT = "RealPass123";',  # secret-scan: allow-test
        ),
        # 同一行的多个字段没有合成标记时仍按固定凭据阻断。
        (
            "src/api/auth.test.ts",
            "const fixture = { accessToken: 'RealPass123', refreshToken: 'RealPass456' };",  # secret-scan: allow-test
        ),
        # 同一行多一个敏感字段不能让前一个字段免检：字面量内每个取值独立判定。
        (
            "src/config.ts",
            'export const jdbc = `{"password": "RealPass123", "api_key": "RealKey456"}`;',  # secret-scan: allow-test
        ),
        (
            "src/config.ts",
            'const cfg = {"password": "RealPass123", "api_key": "RealKey456"};',  # secret-scan: allow-test
        ),
        # 环境变量与配置取值的固定回退分支是写死常量，必须按固定凭据阻断。
        (
            "src/env_fallback.py",
            'db_password = os.getenv("APP_DB_PASSWORD", "RealPass123")',  # secret-scan: allow-test
        ),
        (
            "src/env_fallback.py",
            'db_password = config.get("db.password", "RealPass123")',  # secret-scan: allow-test
        ),
        (
            "src/config.ts",
            'export const dbPassword = process.env.APP_DB_PASSWORD ?? "RealPass123";',  # secret-scan: allow-test
        ),
        (
            "src/config.ts",
            'export const dbPassword = process.env.APP_DB_PASSWORD ?? "RealPass123" ?? fallback;',  # secret-scan: allow-test
        ),
        (
            "scripts/run.sh",
            'DB_PASSWORD="${APP_DB_' + "PASS" + 'WORD:-RealPass123}"',  # secret-scan: allow-test
        ),
    )
    for path, line in unsafe_samples:
        if not any(item.severity == "error" for item in _scan_added_line(path, 1, line)):
            raise AssertionError(f"真实形态凭据未被拦截：{path}")


def _test_sql_and_embedded_source_regressions() -> None:
    """验证 SQL 绑定参数与字面量内嵌源码片段的识别边界。

    正样本覆盖 ``SET <凭据列> = ?`` 与 ``WHERE <名> = ?`` 的组合、多列 SET、MyBatis
    与 JPA 命名参数、SQL 文本里的合成占位符，以及测试夹具把源码放进字符串字面量时的
    运行期操作数。负样本锁定写死的 SQL 字面量、生产口令、AWS 密钥、``sk-``/``ghp_``
    前缀、私钥块、URL 内嵌账号密码、``.env`` 路径与混合表达式仍然阻断，证明这两处
    误报修正没有放宽固定凭据规则。
    """

    safe_samples = (
        # SET 列占位符与 WHERE 占位符的组合：取值由运行期参数绑定。
        (
            "src/main/java/OAuth2AccessTokenMapper.java",
            'jdbc.update("UPDATE t SET refresh_token = ? WHERE id = ?", token, id);',  # secret-scan: allow-test
        ),
        (
            "src/main/java/OAuth2AccessTokenMapper.java",
            'jdbc.update("UPDATE t SET refresh_token = ?, update_time = ? WHERE id = ?");',  # secret-scan: allow-test
        ),
        (
            "src/main/java/OAuth2AccessTokenMapper.java",
            'String sql = "UPDATE t SET client_secret = ? WHERE client_id = ?";',  # secret-scan: allow-test
        ),
        # MyBatis 与 JPA 的命名参数同样不是固定值。
        (
            "src/main/resources/TokenMapper.xml",
            "UPDATE system_oauth2_access_token SET refresh_token = #{refreshToken} WHERE id = #{id}",  # secret-scan: allow-test
        ),
        (
            "src/main/java/TokenRepository.java",
            '@Query("UPDATE t SET refresh_token = :token WHERE id = :id")',  # secret-scan: allow-test
        ),
        # SQL 文本里的合成占位符仍按仓库约定放行。
        (
            "src/main/java/OAuth2AccessTokenMapper.java",
            "jdbc.update(\"UPDATE t SET refresh_token = 'DUMMY-refresh' WHERE id = ?\", id);",  # secret-scan: allow-test
        ),
        (
            "src/main/java/OAuth2AccessTokenMapper.java",
            "jdbc.update(\"UPDATE t SET refresh_token = 'CHANGE_ME_REFRESH_TOKEN' WHERE id = ?\");",  # secret-scan: allow-test
        ),
        # 测试夹具把被测源码放进模板字符串：其中的标识符、成员取值与调用是运行期操作数。
        (
            "internal/lint-configs/eslint-config/src/rules/development-parser.test.mjs",
            "      `const b = { apiKey: url };`,",  # secret-scan: allow-test
        ),
        (
            "internal/lint-configs/eslint-config/src/rules/development-parser.test.mjs",
            "      `const c = { authToken: values.authToken };`,",  # secret-scan: allow-test
        ),
        (
            "internal/lint-configs/eslint-config/src/rules/development-parser.test.mjs",
            "      `const d = { clientSecret: buildSecret() };`,",  # secret-scan: allow-test
        ),
    )
    for path, line in safe_samples:
        findings = _scan_added_line(path, 1, line)
        if findings:
            raise AssertionError(f"SQL 或内嵌源码误报未被放行：{path} {findings[0].rule}")

    unsafe_samples = (
        # SQL 文本里写死的凭据仍按固定值拦截。
        (
            "src/main/java/OAuth2AccessTokenMapper.java",
            "jdbc.update(\"UPDATE t SET api_key = 'RealKey123' WHERE id = ?\", id);",  # secret-scan: allow-test
        ),
        (
            "src/main/java/OAuth2AccessTokenMapper.java",
            "jdbc.update(\"UPDATE t SET api_key='keyA' WHERE id = ?\", id);",  # secret-scan: allow-test
        ),
        # 源码里整段带引号的取值不适用绑定参数豁免。
        (
            "src/main/java/OAuth2AccessTokenMapper.java",
            'password = "? WHERE clause";',  # secret-scan: allow-test
        ),
        # 字面量内嵌源码里的带引号取值仍按固定凭据处理。
        (
            "internal/lint-configs/eslint-config/src/rules/development-parser.test.mjs",
            "      `const b = { apiKey: 'RealPass123' };`,",  # secret-scan: allow-test
        ),
        # URL 查询串里的固定口令不是绑定参数。
        (
            "src/config.ts",
            "const target = 'jdbc:mysql://localhost/app?password=RealPass123';",  # secret-scan: allow-test
        ),
        # 生产口令、混合表达式与哨兵名称不能掩盖真实取值。
        (
            "src/main/java/Service.java",
            'private static final String PASSWORD = "Prod-2026-RealValue";',  # secret-scan: allow-test
        ),
        (
            "src/main/java/Service.java",
            'private static final String PASSWORD = "Prod-2026-RealValue" + suffix;',  # secret-scan: allow-test
        ),
        # AWS 访问密钥前缀仍由密钥格式规则拦截。
        (
            "src/main/java/Service.java",
            'private static final String ACCESS_KEY = "AKIAIOSFODNN7REALKEY12";',  # secret-scan: allow-test
        ),
        # sk- 与 ghp_ 前缀仍由密钥格式规则拦截。
        (
            "src/service.py",
            'api_key = "sk-fakecredential123456789"',  # secret-scan: allow-test
        ),
        (
            "src/service.py",
            'access_token = "ghp_' + "b" * 32 + '"',  # secret-scan: allow-test
        ),
        # URL 内嵌账号密码仍由 URL 规则拦截。
        (
            "部署/config.yaml",
            "url: https://user:RealPass123@example.invalid/api",  # secret-scan: allow-test
        ),
    )
    for path, line in unsafe_samples:
        if not any(
            item.severity == "error" for item in _scan_added_line(path, 1, line)
        ):
            raise AssertionError(f"真实形态凭据未被拦截：{path}")

    private_key = "\n".join((
        "-----BEGIN PRIVATE KEY-----", "B" * 64, "-----END PRIVATE KEY-----",
    ))
    if not _scan_added_private_keys(
        "keys/service.pem", list(enumerate(private_key.splitlines(), start=1))
    ):
        raise AssertionError("完整私钥材料未被拦截")
    if not _is_forbidden_env_path("部署/生产/.env"):
        raise AssertionError("部署 .env 路径未被拦截")


def _run_self_test() -> None:
    """使用伪造样本验证放行和拦截规则，避免测试中包含真实凭据。"""

    _test_python_syntax_regressions()
    _test_markdown_regressions()
    _test_unit_credentials_regressions()
    _test_semantic_recognition_regressions()
    _test_sql_and_embedded_source_regressions()
    safe_cases = (
        ("src/service.py", 'token_type = "Bearer"'),  # secret-scan: allow-test
        ("config.yaml", "password_min_length: 8"),  # secret-scan: allow-test
        ("src/service.py", 'tokenizer_name = "cl100k_base"'),  # secret-scan: allow-test
        ("src/config.ts", 'const TOKEN_STORAGE_KEY = "access_token";'),  # secret-scan: allow-test
        ("src/service.py", "token_count = 1024"),  # secret-scan: allow-test
        ("config.yaml", "client_secret_file: /etc/app/secret.txt"),  # secret-scan: allow-test
        ("config.yaml", "credentials_enabled: true"),  # secret-scan: allow-test
        ("部署/.env.example", "OPENROUTER_API_KEY="),  # secret-scan: allow-test
        ("部署/.env.example", "DB_PASSWORD=${DB_PASSWORD}"),  # secret-scan: allow-test
        (
            "部署/.env.example",
            "TOKEN=CHANGE_ME_RANDOM_TOKEN",  # secret-scan: allow-test
        ),
        (
            "部署/config.yaml",
            "url: rtsp://CHANGE_ME_USER:CHANGE_ME_PASSWORD@example.invalid/live",  # secret-scan: allow-test
        ),
        (
            "src/service.py",
            "password = request.get_password()",  # secret-scan: allow-test
        ),
        ("src/service.py", "api_key: Optional[str],"),  # secret-scan: allow-test
        (
            "src/service.py",
            "api_key: Optional[str] = None,",  # secret-scan: allow-test
        ),
        (
            "src/service.py",
            "def build(api_key: str = None, **kwargs) -> None:",  # secret-scan: allow-test
        ),
        (
            "src/service.py",
            "client = Client(api_key=self._api_key)",  # secret-scan: allow-test
        ),
        ("src/service.py", "max_tokens = 512"),  # secret-scan: allow-test
        (
            "src/service.py",
            "prompt_token_count: 1024",  # secret-scan: allow-test
        ),
        (
            "src/service.py",
            "max_tokens: 单次生成长度上限。",  # secret-scan: allow-test
        ),
        ("src/service.py", '# api_key="documented-literal"'),  # secret-scan: allow-test
        (
            "src/styles.css",
            ".task-background { mask-image: none; }",  # secret-scan: allow-test
        ),
    )
    unsafe_cases = (
        ("部署/config.yaml", 'password: "Fake-Prod-2026"'),  # secret-scan: allow-test
        (
            "部署/config.env",
            "OPENROUTER_API_KEY=sk-fakecredential123456789",  # secret-scan: allow-test
        ),
        (
            "部署/config.yaml",
            "url: https://user:password@example.invalid/api",  # secret-scan: allow-test
        ),
        (
            "部署/config.env",
            "GIT_TOKEN=glpat-fakecredential123456789",  # secret-scan: allow-test
        ),
        (
            "src/service.py",
            'client = Client(api_key="Fake-Prod-2026")',  # secret-scan: allow-test
        ),
        (
            "src/service.py",
            'api_key: Optional[str] = "Fake-Prod-2026",',  # secret-scan: allow-test
        ),
        (
            "src/service.py",
            'access_token = "Fake-Prod-2026"',  # secret-scan: allow-test
        ),
    )
    for path, line in safe_cases:
        if _scan_added_line(path, 1, line):
            raise AssertionError(f"安全样本被误报：{path}")
    for path, line in unsafe_cases:
        if not any(item.severity == "error" for item in _scan_added_line(path, 1, line)):
            raise AssertionError(f"危险样本未被拦截：{path}")
    ambiguous = _scan_added_line("config.yaml", 1, 'token_strategy: "cache"')  # secret-scan: allow-test
    if not ambiguous or any(item.severity != "warning" for item in ambiguous):
        raise AssertionError("模糊字段未按人工核查提示处理")
    fake_private_key_lines = (
        "-----BEGIN PRIVATE KEY-----",
        "QUJD" * 24,
        "-----END PRIVATE KEY-----",
    )
    fake_private_key_findings = _scan_added_private_keys(
        "keys/test.pem", list(enumerate(fake_private_key_lines, start=1))
    )
    if not fake_private_key_findings:
        raise AssertionError("完整私钥伪造样本未被拦截")
    generated_key_code = (
        "const header = `-----BEGIN RSA PRIVATE KEY-----`;",
        "return header + getPrivateBaseKeyB64() + `-----END RSA PRIVATE KEY-----`;",
    )
    if _scan_added_private_keys(
        "src/jsencrypt.js", list(enumerate(generated_key_code, start=1))
    ):
        raise AssertionError("私钥生成代码被误报")
    if not _is_forbidden_env_path("部署/生产/.env"):
        raise AssertionError("部署 .env 文件名规则未生效")
    if _is_forbidden_env_path("部署/.env.example"):
        raise AssertionError(".env.example 不应被文件名规则拦截")
    print("密钥扫描规则自检通过")


def _parse_args() -> argparse.Namespace:
    """解析命令行参数。

    Returns:
        包含自检开关的参数对象。
    """

    parser = argparse.ArgumentParser(description="扫描 Git 暂存区新增内容中的疑似凭据")
    parser.add_argument("--self-test", action="store_true", help="运行内置伪造样本测试")
    return parser.parse_args()


def main() -> int:
    """执行自检或暂存区扫描。

    Returns:
        无阻断项（可有提示）返回 0；阻断项返回 1；扫描失败返回 2。
    """

    args = _parse_args()
    if args.self_test:
        _run_self_test()
        return 0
    try:
        paths = _staged_paths()
        if not paths:
            print("密钥扫描：不适用，没有新增或修改的暂存文件；未验证任何文件内容。")
            return 0
        print(f"密钥扫描范围：{len(paths)} 个暂存文件，检查新增内容与环境文件路径。")
        findings = _scan_staged_diff(paths)
    except RuntimeError as error:
        print(f"密钥扫描失败：{error}", file=sys.stderr)
        return 2
    if not findings:
        print("密钥扫描通过：暂存区新增内容未发现疑似凭据")
        return 0
    errors = [finding for finding in findings if finding.severity == "error"]
    if errors:
        print("检测到阻断项，密钥扫描未通过：", file=sys.stderr)
    else:
        print("密钥扫描无阻断项，但有提示需人工核查：", file=sys.stderr)
    for finding in findings:
        location = (
            finding.path if finding.line == 0 else f"{finding.path}:{finding.line}"
        )
        label = "阻断" if finding.severity == "error" else "提示，需人工核查"
        print(f"- {location} [{label}][{finding.rule}] {finding.detail}", file=sys.stderr)
    if errors:
        print("请改用环境变量、密钥系统或明确的 CHANGE_ME 占位符。", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
