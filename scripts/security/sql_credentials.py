"""解析 MySQL 初始化 SQL 的字段与 INSERT 值对应关系，补齐按位置写入的凭据检查。

只进行词法与结构分析，不执行 SQL；诊断由调用者生成，值不会作为问题文本返回。
@author OpenAI Codex
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class Token:
    """保存 SQL 词元及源码行范围，字符串值只用于内部分类。"""

    text: str
    kind: str
    line: int
    end_line: int


@dataclass(frozen=True)
class Issue:
    """返回 SQL 凭据或无法可靠对应字段的诊断，不包含写入值。"""

    line: int
    rule: str
    detail: str


SENSITIVE_TABLES = {
    "system_users", "system_oauth2_access_token", "system_oauth2_refresh_token",
    "system_oauth2_client", "system_auto_login_ticket", "system_sms_code", "infra_config",
}
EXTRA_FIELDS = {("system_auto_login_ticket", "ticket"), ("system_sms_code", "code")}
TOKEN_PATTERN = re.compile(
    r"(?P<space>\s+)|(?P<comment>--[^\r\n]*|\#[^\r\n]*|/\*[\s\S]*?\*/)|"
    r"(?P<string>'(?:''|\\[\s\S]|[^'\\])*'|\"(?:\"\"|\\[\s\S]|[^\"\\])*\")|"
    r"(?P<identifier>`(?:``|[^`])*`|[A-Za-z_][A-Za-z0-9_$]*)|"
    r"(?P<number>\d+(?:\.\d+)?)|(?P<symbol>.)",
    re.DOTALL,
)


def tokenize(source: str) -> list[Token]:
    """保留字符串、标识符和括号边界，注释中的伪 SQL 不参与字段映射。"""
    tokens: list[Token] = []
    line = 1
    for match in TOKEN_PATTERN.finditer(source):
        text = match.group()
        end_line = line + text.count("\n")
        kind = match.lastgroup or "symbol"
        if kind not in {"space", "comment"}:
            tokens.append(Token(text, kind, line, end_line))
        elif kind == "comment" and text.startswith("/*!"):
            # MySQL 可执行注释仍包含实际语句，不能作为普通注释忽略。
            body = re.sub(r"^/\*!\d*", "", text)[:-2]
            tokens.extend(Token(item.text, item.kind, item.line + line - 1, item.end_line + line - 1)
                          for item in tokenize(body))
        line = end_line
    return tokens


def name(token: Token) -> str:
    """规范化 SQL 标识符，保留值文本与字段名称之间的语义区别。"""
    return token.text.strip("`").replace("``", "`").lower()


def grouped(tokens: list[Token], start: int) -> tuple[list[list[Token]], int]:
    """提取一个括号组内的逗号项，嵌套调用和字符串中的逗号不拆分。

    Args:
        tokens: 当前 SQL 语句的词元。
        start: 左括号位置。
    Returns:
        顶层各项及右括号之后的位置；不完整输入返回空项及语句末尾。
    """
    if start >= len(tokens) or tokens[start].text != "(":
        return [], len(tokens)
    depth = 1
    groups: list[list[Token]] = [[]]
    for index in range(start + 1, len(tokens)):
        token = tokens[index]
        if token.kind == "symbol":
            if token.text == "(":
                depth += 1
            elif token.text == ")":
                depth -= 1
                if depth == 0:
                    return groups, index + 1
            elif token.text == "," and depth == 1:
                groups.append([])
                continue
        groups[-1].append(token)
    return [], len(tokens)


def table_at(tokens: list[Token], index: int) -> tuple[str, int]:
    """读取可带数据库前缀的表名，返回表名及后续词元位置。"""
    if index >= len(tokens) or tokens[index].kind != "identifier":
        return "", index
    table = name(tokens[index])
    index += 1
    if index + 1 < len(tokens) and tokens[index].text == ".":
        table = name(tokens[index + 1])
        index += 2
    return table, index


def literal(token: Token) -> str:
    """解码 SQL 引号转义供占位符判断，不执行数据库表达式。"""
    text = token.text[1:-1]
    return re.sub(r"\\(.)", r"\1", text.replace(token.text[0] * 2, token.text[0]), flags=re.DOTALL)


def inspect_insert_credentials(
    source: str,
    changed_lines: set[int],
    is_credential: Callable[[str], bool],
    is_placeholder: Callable[[str], bool],
    is_metadata: Callable[[str, str, bool], bool],
) -> list[Issue]:
    """按显式列或当前文件 DDL 对应 INSERT 字段，只检查受影响的写入契约。

    Args:
        source: 完整暂存 SQL，不能使用未暂存工作区版本替代。
        changed_lines: 暂存差异中的新增行，用于限定写入或 DDL 变更。
        is_credential: 调用方的敏感字段语义判定。
        is_placeholder: 调用方的空值及明确占位符判定。
        is_metadata: 依据字段和值共同识别计量、类型等非凭据元数据。
    Returns:
        脱敏诊断；已知敏感表的按位置写入缺少 DDL 时要求显式列，避免猜测字段顺序。
    """
    statements: list[list[Token]] = [[]]
    for token in tokenize(source):
        if token.kind == "symbol" and token.text == ";":
            statements.append([])
        else:
            statements[-1].append(token)
    schemas: dict[str, tuple[list[str], bool]] = {}
    issues: list[Issue] = []
    constraints = {"primary", "unique", "index", "key", "constraint", "foreign", "check", "fulltext", "spatial"}
    for statement in statements:
        if not statement:
            continue
        words = [name(token) for token in statement]
        changed = any(statement[0].line <= line <= statement[-1].end_line for line in changed_lines)
        if words[:2] == ["create", "table"]:
            start = 5 if words[2:5] == ["if", "not", "exists"] else 2
            table, position = table_at(statement, start)
            groups, _ = grouped(statement, position)
            columns = [name(group[0]) for group in groups if group and name(group[0]) not in constraints]
            if table and columns:
                schemas[table] = (columns, changed)
            continue
        if words[0] not in {"insert", "replace"}:
            continue
        position = 1
        while position < len(words) and words[position] in {"low_priority", "delayed", "high_priority", "ignore", "into"}:
            position += 1
        table, position = table_at(statement, position)
        columns: list[str] = []
        schema_changed = False
        if position < len(statement) and statement[position].text == "(":
            groups, position = grouped(statement, position)
            columns = [name(group[0]) for group in groups if len(group) == 1 and group[0].kind == "identifier"]
        elif table in schemas:
            columns, schema_changed = schemas[table]
        if not changed and not schema_changed:
            continue
        if position >= len(statement) or words[position] not in {"values", "value"}:
            continue
        if not columns:
            if table in SENSITIVE_TABLES:
                issues.append(Issue(statement[0].line, "sql-schema-unresolved", "敏感表按位置写入缺少可靠字段顺序，请提供显式列名或同文件 DDL"))
            continue
        position += 1
        while position < len(statement):
            values, end = grouped(statement, position)
            if not values:
                break
            if len(values) != len(columns):
                if table in SENSITIVE_TABLES or any(is_credential(column) for column in columns):
                    issues.append(Issue(statement[position].line, "sql-schema-unresolved", "敏感表写入字段与值数量不一致，无法验证凭据"))
                break
            row = dict(zip(columns, values))
            config_key = next((literal(token) for token in row.get("config_key", row.get("key", [])) if token.kind == "string"), "")
            for column, expression in row.items():
                sensitive = is_credential(column) or (table, column) in EXTRA_FIELDS
                if table == "infra_config" and column == "value":
                    sensitive = bool(config_key) and is_credential(config_key)
                if not sensitive:
                    continue
                fixed = [token for token in expression if token.kind in {"string", "number"}]
                if any(
                    not is_placeholder(literal(token) if token.kind == "string" else token.text)
                    and not is_metadata(column, literal(token) if token.kind == "string" else token.text, token.kind == "string")
                    for token in fixed
                ):
                    issues.append(Issue(expression[0].line, "sql-sensitive-insert", "INSERT 向凭据字段写入固定值"))
            position = end
            if position < len(statement) and statement[position].text == ",":
                position += 1
            else:
                break
    return issues
