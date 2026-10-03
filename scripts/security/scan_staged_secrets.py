#!/usr/bin/env python3
"""扫描 Git 暂存区新增内容，明确凭据阻断，名称歧义提示核查。

扫描结果只报告文件、行号和规则，不回显命中的敏感值，避免检查工具造成二次泄露。
Python 测试文件允许 unit- 加 8 至 128 个相同小写字母或数字的虚拟凭据，
支持字符串字面量及 "unit-" + "a" * 16 写法；其他凭据检查保持生效。

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


def _normalized_literal(raw_value: str) -> tuple[str, bool]:
    """规范化赋值右侧并标记其是否为显式字符串字面量。

    Args:
        raw_value: 正则捕获的赋值右侧。

    Returns:
        ``(规范化值, 是否带引号)``。规范化只用于规则判断，值不会输出。
    """

    value = raw_value.strip().rstrip(",;").strip()
    if re.fullmatch(r"\$\{[^{}\r\n]+\}", value):
        return value, False
    # 新增行通常是函数调用的一部分；先移除调用或容器的闭合符号，才能准确
    # 区分 ``api_key=self.api_key`` 变量引用与 ``api_key="literal"`` 字面量。
    value = value.rstrip(")]}").rstrip()
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
    """识别无字符串字面量的基础 TS 类型联合，固定值和其他语法仍继续扫描。"""
    if PurePosixPath(path).suffix.lower() not in {".ts", ".tsx", ".vue"} or operator != ":":
        return False
    primitive = r"(?:string|number|boolean|unknown|any|never|undefined|null)"
    pattern = rf"\s*{primitive}(?:\[\])?(?:\s*[|&]\s*{primitive}(?:\[\])?)*\s*[,;]?\s*"
    return re.fullmatch(pattern, raw_value) is not None


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


def _is_safe_placeholder(value: str) -> bool:
    """判断敏感字段值是否为空、变量引用或明确占位符。

    Args:
        value: 已去除外围引号的字段值。

    Returns:
        不包含固定凭据时返回 ``True``。
    """

    stripped = value.strip()
    upper = stripped.upper()
    if not stripped or upper in {"NULL", "NONE", "FALSE"}:
        return True
    if re.fullmatch(r"\$(?:[A-Za-z_][\w.:]*|\{[^{}\r\n]+\}|\([^()\r\n]+\))", stripped):
        return True
    if stripped.startswith(("{{", "%")):
        return True
    placeholder_markers = (
        "CHANGE_ME",
        "DUMMY",
        "EXAMPLE",
        "PLACEHOLDER",
        "RANDOM",
        "REDACTED",
        "REPLACE",
    )
    return any(marker in upper for marker in placeholder_markers)


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
    """按明确词段识别计量、开关、类型、路径和标识符字段，不按敏感子串放行。

    Args:
        key: 已规范化为小写下划线形式的字段名。
    Returns:
        支持的字段用途；没有足够语义证据时返回 None。
    """

    if _is_noncredential_token_measurement(key) or re.search(
        r"(?:password|passwd|token|secret|credential)s?_"
        r"(?:(?:min|max)_length|timeout|ttl|expire_(?:seconds|minutes|hours)|"
        r"expires_in)(?:_seconds|_minutes|_hours)?$", key
    ):
        return "number"
    if key == "allow_credentials" or re.search(
        r"(?:^|_)(?:password|token|secret|credential)s?_(?:enabled|required)$", key
    ):
        return "boolean"
    if re.search(r"(?:^|_)token_type$", key):
        return "token-type"
    if re.search(r"(?:^|_)(?:file|path)$", key):
        return "path"
    if key == "tokenizer_name" or re.search(r"(?:^|_)token_storage_key$", key):
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
    key = assignment.group("key")
    raw_value = assignment.group("value")
    if syntax_path.lower().endswith(".py"):
        parsed_value = _python_assignment_value(line, key)
        if parsed_value is not None:
            raw_value = parsed_value
    if re.fullmatch(r"\[\s*]|\{\s*}|\(\s*\)", raw_value.strip().rstrip(",;")):
        return findings
    value, quoted = _normalized_literal(raw_value)
    if _is_noncredential_setting(key, value, quoted=quoted):
        return findings
    # Token 计量名称必须同时匹配数量值或未加引号的中文字段说明，不能仅凭
    # 名称放行固定字符串。前面的密钥前缀与 URL 检查结果仍然保留。
    if _is_noncredential_token_measurement(_normalized_field_name(key)) and (
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
    if _is_safe_placeholder(value):
        return findings
    # 仅豁免测试虚拟值的固定赋值告警；此前密钥前缀、URL 及独立私钥检查仍生效。
    if not is_python_code and _is_unit_test_credential(path, raw_value):
        return findings
    # Java/Python/TypeScript 中的变量或方法调用不是固定凭据；显式字符串仍需拦截。
    if (
        not quoted
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
        if isinstance(value, (ast.Call, ast.Name, ast.Attribute, ast.Subscript)):
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
            for text in node.value.splitlines():
                if SENSITIVE_ASSIGNMENT_PATTERN.search(text):
                    # 转义换行与相邻字符串合并后无法精确映射列号，报告原始字面量范围。
                    candidates.append((node.lineno, node.end_lineno or node.lineno, text, True))
    return candidates


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
                findings.extend(_scan_added_line(path, min(changed), text, literal_text=literal_text))
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


def _run_self_test() -> None:
    """使用伪造样本验证放行和拦截规则，避免测试中包含真实凭据。"""

    _test_python_syntax_regressions()
    _test_markdown_regressions()
    _test_unit_credentials_regressions()
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
