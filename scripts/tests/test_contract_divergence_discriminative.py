"""为 D16 事项 C 点名的 4 个契约冲突对象补针对性判别性测试。

这 4 个对象在 `.bf-local/closure/证据.md` 事项 C 中被点名为「本地相对上游基线
**有意**改写了已确认契约」，采用上游原文会破坏本地契约（认证白名单收窄、
缓存管理器事务感知、XSS safelist 去掉 `style`、导出列标题措辞）。因此它们不能按
「代码同一性」路径关闭，也不能靠「编译通过」当作证据——必须有一组**能区分**
本地契约与上游基线的断言。

本文件的每个用例都做两件事：

1. **正面**：从当前工作树的真实 Java 源码里，按规则实现
   ``scripts/code/java/check_staged_java_comments.py`` 自己的词法器
   （``_code_identity_code_tokens``）读出**代码 token**（注释与空白已被剔除），
   机械抽出该对象的契约要素，断言它等于**已确认的本地契约取值**；
2. **反面（判别性）**：把同一套抽取器指向仓内受控上游快照里的固定提交文件，
   断言它给出的是**另一组取值**。若两侧读数相同，用例立即失败——这保证断言确实
   有区分力，而不是把「读到什么是什么」固化成通过。

断言的是**源码层契约取值**而不是运行期行为：Python 用例无法启动 Spring 容器，
因此本文件不冒充运行时集成测试；运行时验证仍需 `mvn test` 覆盖相应模块。
四个对象都属于「结构性契约」（放行路径集合、缓存管理器构造、白名单属性集合、
导出列标题字面量），在源码层即可唯一确定；任何改写都会改变抽取结果并让用例失败。

全部读数只依赖仓内受控快照与当前工作树，断网可跑；不联网、不改源码、不改索引。

@author 来源收尾方向执行代理
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT_ROOT = REPO_ROOT / "docs/测试与可靠性/来源证据/上游快照"
SNAPSHOT_PREFIX = "ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5"

if str(REPO_ROOT) not in sys.path:  # pragma: no cover - 直接以脚本方式运行时补齐导入根
    sys.path.insert(0, str(REPO_ROOT))

from scripts.code.java import check_staged_java_comments as java  # noqa: E402

SECURITY_LOCAL = (
    "后端代码/basic-framework-boot/basic-framework-module-infra/src/main/java/com/basicframework"
    "/module/infra/framework/security/config/SecurityConfiguration.java"
)
SECURITY_UPSTREAM = "yudao-module-infra/src/main/java/cn/iocoder/yudao/module/infra/framework/security/config/SecurityConfiguration.java"

CACHE_LOCAL = (
    "后端代码/basic-framework-boot/basic-framework-core/basic-framework-spring-boot-starter-redis"
    "/src/main/java/com/basicframework/framework/redis/config/BasicFrameworkCacheAutoConfiguration.java"
)
CACHE_UPSTREAM = "yudao-framework/yudao-spring-boot-starter-redis/src/main/java/cn/iocoder/yudao/framework/redis/config/YudaoCacheAutoConfiguration.java"

XSS_LOCAL = (
    "后端代码/basic-framework-boot/basic-framework-core/basic-framework-spring-boot-starter-web"
    "/src/main/java/com/basicframework/framework/xss/core/clean/JsoupXssCleaner.java"
)
XSS_UPSTREAM = "yudao-framework/yudao-spring-boot-starter-web/src/main/java/cn/iocoder/yudao/framework/xss/core/clean/JsoupXssCleaner.java"

DICT_LOCAL = (
    "后端代码/basic-framework-boot/basic-framework-module-system/src/main/java/com/basicframework"
    "/module/system/controller/admin/dict/vo/type/DictTypeRespVO.java"
)
DICT_UPSTREAM = "yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/dict/vo/type/DictTypeRespVO.java"

# 已确认的本地契约取值（与 `.bf-local/closure/证据.md` 事项 C 的实测残差一一对应）。
CONFIRMED_ANONYMOUS_PATHS = frozenset(
    {'"/actuator/health"', '"/actuator/health/**"', 'buildAdminApi("/infra/file/content/**")'}
)
CONFIRMED_UPSTREAM_ANONYMOUS_PATHS = frozenset(
    {
        '"/v3/api-docs/**"',
        '"/webjars/**"',
        '"/swagger-ui.html"',
        '"/swagger-ui/**"',
        '"/actuator"',
        '"/actuator/**"',
        '"/druid/**"',
        'buildAdminApi("/infra/file/*/get/**")',
    }
)
CONFIRMED_SAFELIST_ATTRIBUTES = frozenset({(':all', "class"), ("a", "target")})
CONFIRMED_EXCEL_HEADERS = {
    "id": '"字典编号"',
    "name": '"字典名称"',
    "type": '"字典类型"',
    "status": '"状态"',
}


def code_tokens(relative_path: str) -> list[list[str]]:
    """按规则实现自己的词法器读出单侧代码 token 流（注释与空白已剔除）。

    Args:
        relative_path: 仓库相对路径；`上游快照/` 前缀缺失时按受控快照布局解析。

    Returns:
        ``[类别, 原文, 行号]`` 三元组列表。

    Raises:
        AssertionError: 词法解析出现受控拒绝原因，或文件不可读。
    """

    candidate = REPO_ROOT / relative_path
    if not candidate.is_file():
        candidate = SNAPSHOT_ROOT / SNAPSHOT_PREFIX / relative_path
    assert candidate.is_file(), f"受控输入不可读：{relative_path}"
    tokens, errors = java._code_identity_code_tokens(candidate.read_text(encoding="utf-8"))
    assert not errors, f"{relative_path} 词法解析被受控拒绝：{errors}"
    return tokens


def string_literal(token: list[str]) -> str | None:
    """返回字符串字面量 token 的原文，不是字面量时返回空值。"""

    return token[1] if token[0] == "string" else None


def matching_paren(tokens: list[list[str]], start: int) -> int:
    """返回与 ``tokens[start]``（左括号）配对的右括号下标；未闭合返回 -1。"""

    assert tokens[start][1] == "(", f"下标 {start} 不是左括号"
    depth = 0
    for index in range(start, len(tokens)):
        text = tokens[index][1]
        if text == "(":
            depth += 1
        elif text == ")":
            depth -= 1
            if depth == 0:
                return index
    return -1


def split_arguments(tokens: list[list[str]], start: int, end: int) -> list[list[list[str]]]:
    """按顶层逗号把 ``(`` 与 ``)`` 之间的 token 切成实参组。"""

    groups: list[list[list[str]]] = []
    current: list[list[str]] = []
    depth = 0
    for token in tokens[start + 1 : end]:
        text = token[1]
        if text in {"(", "["}:
            depth += 1
        elif text in {")", "]"}:
            depth -= 1
        elif text == "," and depth == 0:
            groups.append(current)
            current = []
            continue
        current.append(token)
    if current:
        groups.append(current)
    return groups


def simple_name(token: list[str]) -> str:
    """返回标识符或限定名的最后一段（``a.b.C`` 取 ``C``）。"""

    return token[1].rsplit(".", 1)[-1]


def call_arguments(tokens: list[list[str]], name: str) -> list[list[list[str]]]:
    """抽出代码流中所有 ``name(...)`` 调用的实参组（限定名按最后一段匹配）。"""

    found: list[list[list[str]]] = []
    for index, token in enumerate(tokens):
        if token[0] not in {"ident", "name"} or simple_name(token) != name:
            continue
        if index + 1 >= len(tokens) or tokens[index + 1][1] != "(":
            continue
        end = matching_paren(tokens, index + 1)
        if end < 0:
            continue
        found.append(split_arguments(tokens, index + 1, end))
    return found


def is_followed_by(tokens: list[list[str]], index: int, name: str) -> bool:
    """判断从 ``index`` 起是否紧跟 ``.name``（链式调用）。"""

    return (
        index + 1 < len(tokens)
        and tokens[index][1] == "."
        and simple_name(tokens[index + 1]) == name
    )


def permit_all_patterns(tokens: list[list[str]]) -> frozenset[str]:
    """抽出所有 `requestMatchers(...)` 且随后调用 `permitAll()` 的匹配模式原文。"""

    patterns: set[str] = set()
    for index, token in enumerate(tokens):
        if token[0] not in {"ident", "name"} or simple_name(token) != "requestMatchers":
            continue
        if index + 1 >= len(tokens) or tokens[index + 1][1] != "(":
            continue
        end = matching_paren(tokens, index + 1)
        if end < 0 or not is_followed_by(tokens, end + 1, "permitAll"):
            continue
        parts = "".join(item[1] for item in tokens[index + 2 : end])
        patterns.add(parts)
    return frozenset(patterns)


def add_attributes_calls(tokens: list[list[str]]) -> set[tuple[str, ...]]:
    """抽出白名单 `addAttributes(选择器, 属性...)` 的全部实参组合。"""

    calls: set[tuple[str, ...]] = set()
    for groups in call_arguments(tokens, "addAttributes"):
        calls.add(tuple(group[0][1].strip('"') for group in groups))
    return calls


def excel_headers_by_field(tokens: list[list[str]]) -> dict[str, str]:
    """把 `@ExcelProperty("列标题")` 绑定到紧随其后的字段声明名。"""

    headers: dict[str, str] = {}
    for index, token in enumerate(tokens):
        if token[0] != "ident" or token[1] != "ExcelProperty":
            continue
        if index + 1 >= len(tokens) or tokens[index + 1][1] != "(":
            continue
        end = matching_paren(tokens, index + 1)
        if end < 0:
            continue
        groups = split_arguments(tokens, index + 1, end)
        title = None
        for group in groups:
            literals = [string_literal(item) for item in group if item[0] == "string"]
            if literals:
                title = literals[0]
                break
        if title is None:
            continue
        cursor = end + 1
        while cursor < len(tokens) and tokens[cursor][1] != ";":
            cursor += 1
        if cursor > end + 1 and cursor < len(tokens):
            headers[tokens[cursor - 1][1]] = title
    return headers


def identifiers(tokens: list[list[str]], name: str) -> int:
    """统计某个标识符在代码 token 流中出现的次数。"""

    return sum(1 for token in tokens if simple_name(token) == name)


def returned_expression(tokens: list[list[str]], method: str) -> str:
    """返回指定方法体内第一条 ``return`` 语句的表达式原文。"""

    start = next(
        (index for index, token in enumerate(tokens) if simple_name(token) == method and token[0] == "ident"),
        -1,
    )
    assert start >= 0, f"未找到方法 {method}"
    for index in range(start, len(tokens)):
        if tokens[index][0] == "ident" and tokens[index][1] == "return":
            parts: list[str] = []
            for token in tokens[index + 1 :]:
                if token[1] == ";":
                    break
                parts.append(token[1])
            return "".join(parts)
    raise AssertionError(f"方法 {method} 内没有 return 语句")


def test_security_configuration_anonymous_whitelist_is_the_narrowed_local_contract() -> None:
    """认证白名单只放行健康检查与按完整路径取文件，且与上游放行集合不同。"""

    local = permit_all_patterns(code_tokens(SECURITY_LOCAL))
    upstream = permit_all_patterns(code_tokens(SECURITY_UPSTREAM))
    assert local == CONFIRMED_ANONYMOUS_PATHS
    assert upstream == CONFIRMED_UPSTREAM_ANONYMOUS_PATHS
    assert local != upstream
    assert not (local & upstream - {'"/actuator/health"'})


def test_cache_auto_configuration_returns_timeout_manager_without_transaction_aware() -> None:
    """缓存管理器返回 `TimeoutRedisCacheManager` 且不调用 `setTransactionAware`。"""

    local_tokens = code_tokens(CACHE_LOCAL)
    upstream_tokens = code_tokens(CACHE_UPSTREAM)
    assert returned_expression(local_tokens, "redisCacheManager") == (
        "newTimeoutRedisCacheManager(cacheWriter,redisCacheConfiguration)"
    )
    assert identifiers(local_tokens, "setTransactionAware") == 0
    assert identifiers(upstream_tokens, "setTransactionAware") == 1
    assert returned_expression(upstream_tokens, "cacheManager") != returned_expression(
        local_tokens, "redisCacheManager"
    )


def test_jsoup_xss_cleaner_safelist_drops_the_style_attribute() -> None:
    """XSS safelist 不放行 `style`，其余属性放行范围与上游差一个 `style`。"""

    local = add_attributes_calls(code_tokens(XSS_LOCAL))
    upstream = add_attributes_calls(code_tokens(XSS_UPSTREAM))
    assert local == CONFIRMED_SAFELIST_ATTRIBUTES
    assert ("a", "target") in local
    assert not any("style" in attribute for attributes in local for attribute in attributes)
    assert any("style" in attribute for attributes in upstream for attribute in attributes)
    assert local != upstream


def test_dict_type_export_column_header_uses_the_local_wording() -> None:
    """导出列标题使用本地措辞「字典编号」，上游措辞「字典主键」不在本地。"""

    local = excel_headers_by_field(code_tokens(DICT_LOCAL))
    upstream = excel_headers_by_field(code_tokens(DICT_UPSTREAM))
    assert local["id"] == CONFIRMED_EXCEL_HEADERS["id"]
    assert {field: local[field] for field in CONFIRMED_EXCEL_HEADERS} == CONFIRMED_EXCEL_HEADERS
    assert upstream["id"] == '"字典主键"'
    assert '"字典主键"' not in set(local.values())
    assert local["id"] != upstream["id"]


@pytest.mark.parametrize(
    ("local_path", "upstream_path"),
    [
        (SECURITY_LOCAL, SECURITY_UPSTREAM),
        (CACHE_LOCAL, CACHE_UPSTREAM),
        (XSS_LOCAL, XSS_UPSTREAM),
        (DICT_LOCAL, DICT_UPSTREAM),
    ],
)
def test_every_contract_object_is_both_readable_and_distinguishable(
    local_path: str, upstream_path: str
) -> None:
    """4 个对象的本地与上游两侧都必须能读出 token 流（防止抽取器空转通过）。"""

    local = code_tokens(local_path)
    upstream = code_tokens(upstream_path)
    assert len(local) > 50
    assert len(upstream) > 50
    assert [token[0] for token in local].count("comment") == 0
