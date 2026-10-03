"""验证三个暂存检查器的误报、注释删除与条件声明边界。

Git 读取使用内存差异替身，避免修改真实索引或读取工作区内容。
@author 李杰
"""

from __future__ import annotations

import difflib
import subprocess
from collections.abc import Sequence
from pathlib import Path

import pytest
from scripts.code.java import check_staged_java_comments as java
from scripts.code.python import check_staged_python_comments as python
from scripts.security import scan_staged_secrets as secrets

JAVA_HEADER = "/** 服务职责。\n * @author 李杰\n */\npublic class Demo {\n"
PYTHON_HEADER = '"""模块职责。\n@author 李杰\n"""\n'


def scan_staged(
    monkeypatch: pytest.MonkeyPatch, language: str, before: str | None, after: str
) -> list[tuple[str, str]]:
    """用 Git 边界替身驱动真实暂存检查流程，保留增量与旧版本语义。

    Args:
        monkeypatch: 当前测试独享的替身管理器，结束时恢复 Git 读取函数。
        language: java 或 python，决定真实检查入口和源码路径。
        before: 提交前的源码；None 表示新文件。
        after: 暂存版本的源码，与实际工作区内容无关。
    Returns:
        规则与说明列表，便于断言是否误伤未修改的历史声明。
    Raises:
        AssertionError: 检查器调用了替身未覆盖的 Git 命令。
    """
    module = java if language == "java" else python
    path = "后端代码/basic-framework-boot/Demo.java" if language == "java" else "src/demo.py"
    patch = "index " + ("a" * 40 if before is not None else "0" * 40) + ".." + "b" * 40
    patch += " 100644\n" + "".join(
        difflib.unified_diff(
            (before or "").splitlines(keepends=True),
            after.splitlines(keepends=True),
            fromfile="a/" + path,
            tofile="b/" + path,
            n=0,
        )
    )

    def read_git(arguments: Sequence[str], *, text: bool = True) -> object:
        """模拟指定文件的只读 Git 输出；未声明的调用立即失败。"""
        if arguments[0] == "diff" and "--name-only" in arguments:
            is_addition_query = "--diff-filter=A" in arguments
            output = "" if is_addition_query and before is not None else path + "\0"
        elif arguments[0] == "diff":
            output = patch
        elif arguments[0] == "show" and arguments[1] == ":" + path:
            output = after
        elif arguments[:2] == ["cat-file", "blob"] and before is not None:
            output = before
        else:
            raise AssertionError("未覆盖的只读 Git 调用")
        value = output if text else output.encode("utf-8")
        if language == "java":
            return value
        return subprocess.CompletedProcess(list(arguments), 0, stdout=value, stderr="")

    monkeypatch.setattr(module, "_run_git", read_git)
    findings = (
        java._scan_staged_java_comments()
        if language == "java"
        else python._scan_staged_python_comments()
    )
    return [(finding.rule, finding.detail) for finding in findings]


@pytest.mark.parametrize(
    "line",
    ["max_tokens = 512", "prompt_token_count: 1024", "max_tokens: 单次生成长度上限。"],
)
def test_token_measurements_are_not_credentials(line: str) -> None:
    """Token 数量及字段说明不应触发固定凭据告警。"""
    assert secrets._scan_added_line("src/service.py", 1, line) == []


@pytest.mark.parametrize("key", ["api_key", "access_token", "max_tokens"])
def test_fixed_credentials_are_still_rejected(key: str) -> None:
    """字段名称豁免不能放行固定字符串凭据，即使字段声称用于计量。"""
    value = "unit-" + "a" * 16
    findings = secrets._scan_added_line("src/service.py", 1, f'{key} = "{value}"')
    assert "sensitive-assignment" in {finding.rule for finding in findings}
    assert all(value not in finding.detail for finding in findings)


@pytest.mark.parametrize("key", ["access_token", "refresh_token", "api_key"])
def test_numeric_credentials_are_not_measurements(key: str) -> None:
    """纯数字值仍须结合明确计量字段判断，认证字段不能误用数量豁免。"""
    findings = secrets._scan_added_line("src/service.py", 1, f"{key} = 512")
    assert "sensitive-assignment" in {finding.rule for finding in findings}


def test_secret_builtin_regressions() -> None:
    """完整内置样本同时验证已有配置、注释、私钥和测试凭据边界。"""
    secrets._run_self_test()


@pytest.mark.parametrize(
    ("path", "source"),
    [
        ("src/Service.java", "if (password == null) return;"),
        ("src/config.ts", "if (token === expected) return;"),
        ("src/config.ts", "token" + ": string | null;"),
        ("src/config.ts", "password" + ": string | undefined;"),
    ],
)
def test_comparison_and_type_syntax_are_not_assignments(path: str, source: str) -> None:
    """比较和基础类型联合不构成凭据赋值，不需要按目录豁免源文件。"""
    assert secrets._scan_added_line(path, 1, source) == []


@pytest.mark.parametrize("source", ["field: string | '{value}';", "field = '{value}';"])
def test_type_filter_keeps_string_values_and_strong_signals(source: str) -> None:
    """类型语法校准不豁免带字符串的敏感赋值，强密钥格式仍独立检查。"""
    sample = "sk-" + "a1b2c3d4" * 4
    findings = secrets._scan_added_line("src/config.ts", 1, source.format(value=sample).replace("field", "token"))
    assert any(item.rule == "secret-prefix" for item in findings)


@pytest.mark.parametrize(
    ("path", "line"),
    [
        ("src/config.py", 'token_type = "Bearer"'),
        ("config.yaml", "password_min_length: 8"),
        ("src/config.py", 'tokenizer_name = "cl100k_base"'),
        ("src/config.ts", 'const TOKEN_STORAGE_KEY = "access_token";'),
        ("src/config.py", "token_count = 1024"),
        ("config.yaml", "client_secret_file: /etc/app/secret.txt"),
        ("config.yaml", "credentials_enabled: true"),
        ("src/Config.java", "int tokenCount = 1024;"),
        ("src/config.ts", "const accessTokenTimeout = 30;"),
        ("config.yaml", "credentials_enabled: false"),
        ("config.yaml", 'client_secret_path: "C:\\app\\secret.txt"'),
        ("docs/文件名.md", "token_count: 1024"),
    ],
)
def test_noncredential_fields_require_compatible_values(path: str, line: str) -> None:
    """字段含义与值同时明确时放行，覆盖三种语言、配置及文档。"""
    assert secrets._scan_added_line(path, 7, line) == []


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("token_count", '"unit-aaaaaaaaaaaaaaaa"'),
        ("credentials_enabled", '"unit-aaaaaaaaaaaaaaaa"'),
        ("token_type", '"unit-aaaaaaaaaaaaaaaa"'),
        ("client_secret_file", '"unit-aaaaaaaaaaaaaaaa"'),
        ("accessToken", '"unit-aaaaaaaaaaaaaaaa"'),
        ("apiKey", "123456"),
        ("password_hash", '"unit-aaaaaaaaaaaaaaaa"'),
        ("secretkey", '"unit-aaaaaaaaaaaaaaaa"'),
        ("max_tokens_password", "123456"),
        ("token_count_secret", "123456"),
        ("token_count", '1024; password = "unit-aaaaaaaaaaaaaaaa"'),
        ("token_strategy", '"cache"; password = "unit-aaaaaaaaaaaaaaaa"'),
    ],
)
def test_metadata_names_do_not_hide_credentials(key: str, value: str) -> None:
    """错误类型、固定凭据及同一行第二次敏感赋值仍阻断且不泄露值。"""
    findings = secrets._scan_added_line("config.yaml", 9, f"{key}: {value}")
    assert any(item.severity == "error" for item in findings)
    assert "unit-aaaaaaaaaaaaaaaa" not in repr(findings)


@pytest.mark.parametrize("key", ["token_strategy", "secretariat_name", "tokenizer_backend"])
def test_ambiguous_names_only_warn(key: str) -> None:
    """名称包含敏感词但没有明确凭据语义时保留人工核查提示。"""
    findings = secrets._scan_added_line("config.yaml", 3, f'{key}: "local"')
    assert len(findings) == 1
    assert findings[0].severity == "warning"
    assert findings[0].rule == "ambiguous-sensitive-name"


@pytest.mark.parametrize("key", ["tokenizer_name", "TOKEN_STORAGE_KEY", "token_strategy"])
def test_strong_signals_override_metadata_and_warnings(key: str) -> None:
    """常见密钥格式与带凭据 URL 不因元数据名称或告警分级而被放行。"""
    for value, rule in (
        ("sk-" + "a1b2c3d4" * 4, "secret-prefix"),
        ("https://unit-bbbbbbbb:unit-aaaaaaaaaaaaaaaa@invalid.local", "url-userinfo"),
    ):
        findings = secrets._scan_added_line("docs/文件名.md", 5, f'{key}: "{value}"')
        assert any(item.rule == rule and item.severity == "error" for item in findings)
        assert value not in repr(findings)


@pytest.mark.parametrize(
    ("levels", "expected"),
    [([], 0), (["warning"], 0), (["error"], 1), (["warning", "error"], 1)],
)
def test_secret_cli_exit_status(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    levels: list[str],
    expected: int,
) -> None:
    """命令入口仅因阻断项失败，提示项可见但不能被描述为没有命中。"""
    findings = [secrets.Finding("config.yaml", 3, "test", "需核查", level) for level in levels]
    monkeypatch.setattr(secrets.sys, "argv", ["scan_staged_secrets.py"])
    monkeypatch.setattr(secrets, "_staged_paths", lambda: ["config.yaml"])
    monkeypatch.setattr(secrets, "_scan_staged_diff", lambda paths: findings)
    assert secrets.main() == expected
    output = capsys.readouterr()
    if "warning" in levels:
        assert "需人工核查" in output.err
    if "error" in levels:
        assert "阻断" in output.err
    if levels:
        assert "未发现疑似凭据" not in output.out


def test_secret_cli_read_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """读取失败仍返回错误，不能因加入提示分级变成成功。"""

    def fail_scan(paths: list[str]) -> list[secrets.Finding]:
        """模拟 Git 暂存内容不可读取。"""
        raise RuntimeError("无法读取 Git")

    monkeypatch.setattr(secrets.sys, "argv", ["scan_staged_secrets.py"])
    monkeypatch.setattr(secrets, "_staged_paths", lambda: ["config.yaml"])
    monkeypatch.setattr(secrets, "_scan_staged_diff", fail_scan)
    assert secrets.main() == 2


def scan_secret_source(
    monkeypatch: pytest.MonkeyPatch, path: str, source: str, before: str = ""
) -> list[secrets.Finding]:
    """用完整暂存源码驱动密钥扫描，覆盖真实 diff 与源码上下文的组合。

    Args:
        monkeypatch: 隔离当前测试的 Git 替身。
        path: 样本的仓库相对路径，决定语言和测试凭据边界。
        source: 暂存版本内容。
        before: 旧版本内容，默认为新文件。
    Returns:
        真实扫描入口产生的脱敏问题列表；不访问或修改真实索引。
    """
    patch = "".join(
        difflib.unified_diff(
            before.splitlines(keepends=True),
            source.splitlines(keepends=True),
            fromfile="a/" + path,
            tofile="b/" + path,
            n=0,
        )
    )

    def read_git(arguments: Sequence[str], *, text: bool = True) -> str | bytes:
        """返回指定暂存对象，拒绝任何未预期的 Git 操作。"""
        if arguments[0] == "show" and arguments[1] == ":" + path:
            result = source
        elif arguments[0] == "diff":
            result = path + "\0" if "--name-only" in arguments else patch
        else:
            raise AssertionError("未覆盖的只读 Git 调用")
        return result if text else result.encode("utf-8")

    monkeypatch.setattr(secrets, "_run_git", read_git)
    return secrets._scan_staged_diff()


@pytest.mark.parametrize(
    "filename",
    [
        "test_staged_checkers.py",
        "test_staged_quality.py",
    ],
)
def test_secret_scanner_accepts_its_test_sources(
    monkeypatch: pytest.MonkeyPatch, filename: str
) -> None:
    """整个测试文件作为新增暂存内容扫描，防止只验证解码样本却漏掉外层语法。"""
    path = Path(__file__).with_name(filename)
    relative = path.relative_to(Path(__file__).resolve().parents[2]).as_posix()
    assert scan_secret_source(monkeypatch, relative, path.read_text(encoding="utf-8")) == []


@pytest.mark.parametrize("production", [False, True])
def test_secret_scanner_handles_client_test_samples(
    monkeypatch: pytest.MonkeyPatch, production: bool
) -> None:
    """完整源码中的虚拟令牌与凭据 URL 仅在测试路径放行，生产路径仍阻断。"""
    response = {"token": "unit-" + "r" * 16}
    address = "https://unit-aaaaaaaa:unit-bbbbbbbb@invalid.local"
    source = (
        "import secrets\n"
        "token = secrets.token_urlsafe(24)\n"
        f"response = {response!r}\n"
        f"url = {address!r}\n"
    )
    path = "src/client.py" if production else "tests/test_client.py"
    findings = scan_secret_source(monkeypatch, path, source)
    if production:
        assert {item.rule for item in findings} >= {"sensitive-assignment", "url-userinfo"}
    else:
        assert findings == []


@pytest.mark.parametrize(
    "template",
    [
        "name = {value}\n",
        "name: str = {value}\n",
        "data = {{'name': {value}, 'other': 1}}\n",
        "configure(name={value})\n",
        "def run(name={value}): pass\n",
        "def run(*, name={value}): pass\n",
        "name, other = {value}, 1\n",
        "if (name := {value}): pass\n",
        "name = (\n    {value}\n)\n",
    ],
)
def test_secret_python_assignment_contexts(monkeypatch: pytest.MonkeyPatch, template: str) -> None:
    """正常 Python 语法中的固定凭据均阻断，跨行右值与字典值不会被当成引用。"""
    credential = "unit-" + "a" * 16
    source = template.format(value=repr(credential)).replace("name", "password")
    findings = scan_secret_source(monkeypatch, "src/service.py", source)
    assert any(item.rule == "sensitive-assignment" for item in findings)
    assert credential not in repr(findings)


def test_secret_only_changed_multiline_key_is_scanned(monkeypatch: pytest.MonkeyPatch) -> None:
    """只修改多行赋值的字段名也检查未变化的右值，不扩大到无关旧凭据。"""
    value = repr("unit-" + "a" * 16)
    before = f"label = (\n    {value}\n)\n"
    source = before.replace("label", "password")
    findings = scan_secret_source(monkeypatch, "src/service.py", source, before)
    assert len(findings) == 1 and findings[0].line == 1
    assert scan_secret_source(monkeypatch, "src/service.py", source + "count = 1\n", source) == []


@pytest.mark.parametrize("embedded", ["config", "statements", "invalid"])
def test_unknown_test_credentials_are_not_exempt(
    monkeypatch: pytest.MonkeyPatch, embedded: str
) -> None:
    """测试目录中的未知凭据仍阻断，包含配置字符串与语法损坏的源码。"""
    field = "password"
    sample = "fixed-" + "a" * 16
    text = f"{field}: {sample}"
    if embedded == "statements":
        text = f"token_count = 1; {field} = {sample!r}"
    source = (
        f"{field} = {sample!r}\ninvalid ???\n" if embedded == "invalid" else f"cases = [{text!r}]\n"
    )
    findings = scan_secret_source(monkeypatch, "tests/test_service.py", source)
    assert any(item.rule == "sensitive-assignment" for item in findings)
    assert sample not in repr(findings)


@pytest.mark.parametrize(
    ("path", "virtual_user", "expected"),
    [
        ("tests/test_service.py", True, False),
        ("tests/test_service.py", False, True),
        ("src/service.py", True, True),
        ("docs/文件名.md", True, True),
    ],
)
def test_url_virtual_credentials_are_test_only(
    path: str, virtual_user: bool, expected: bool
) -> None:
    """只有测试文件中双端明确的虚拟值可放行；普通账号或其他路径保持拦截。"""
    username = "unit-" + "a" * 8 if virtual_user else "user"
    password = "unit-" + "b" * 8
    assert (
        secrets._contains_unsafe_embedded_credential_url(
            "https://" + username + ":" + password + "@invalid.local", path
        )
        is expected
    )


@pytest.mark.parametrize("language", ["java", "python"])
def test_deleted_method_documentation_is_detected(
    monkeypatch: pytest.MonkeyPatch, language: str
) -> None:
    """仅删除职责注释也必须拒绝，且不报告相邻未修改的历史欠账。"""
    if language == "java":
        doc = "    /** 执行任务。 */\n"
        before = JAVA_HEADER + doc + "    void run() {}\n    void legacy() {}\n}\n"
        expected = "method-javadoc"
    else:
        doc = '    """执行任务。"""\n'
        before = PYTHON_HEADER + "def run():\n" + doc + "    pass\n\ndef legacy():\n    pass\n"
        expected = "function-docstring"
    findings = scan_staged(monkeypatch, language, before, before.replace(doc, ""))
    assert len(findings) == 1
    assert findings[0][0] == expected and "run" in findings[0][1]


@pytest.mark.parametrize("language", ["java", "python"])
def test_deleting_whole_method_does_not_blame_next_method(
    monkeypatch: pytest.MonkeyPatch, language: str
) -> None:
    """删除完整声明后，不能把删除位置映射到邻接声明而追查历史欠账。"""
    if language == "java":
        removed = "    /** 执行任务。 */\n    void run() {}\n"
        before = JAVA_HEADER + removed + "    void legacy() {}\n}\n"
    else:
        removed = 'def run():\n    """执行任务。"""\n    pass\n\n'
        before = PYTHON_HEADER + removed + "def legacy():\n    pass\n"
    assert scan_staged(monkeypatch, language, before, before.replace(removed, "")) == []


def test_removed_java_author_is_detected(monkeypatch: pytest.MonkeyPatch) -> None:
    """删除 JavaDoc 内部作者行时，类型声明未变化也应报告作者缺失。"""
    before = JAVA_HEADER + "}\n"
    findings = scan_staged(monkeypatch, "java", before, before.replace(" * @author 李杰\n", ""))
    assert [rule for rule, _ in findings] == ["type-author"]


def test_java_overloads_are_distinguished(monkeypatch: pytest.MonkeyPatch) -> None:
    """同名重载的既有欠账不能遮蔽另一个重载本次删除注释的问题。"""
    doc = "    /** 按编号执行。 */\n"
    before = JAVA_HEADER + "    void run() {}\n" + doc + "    void run(int id) {}\n}\n"
    findings = scan_staged(monkeypatch, "java", before, before.replace(doc, ""))
    assert len(findings) == 1 and findings[0][0] == "method-javadoc"


@pytest.mark.parametrize("documented", [False, True])
@pytest.mark.parametrize(
    "annotation",
    [
        '@ValueSource(strings = {"one",\n        "two"})',
        '@Nested(values = {@Case(name="one"),\n        @Case(name="two")})',
    ],
)
def test_java_annotation_arrays_preserve_attached_documentation(
    monkeypatch: pytest.MonkeyPatch, documented: bool, annotation: str
) -> None:
    """多行数组和嵌套注解不是成员结束；仍要求其后真实方法具备职责注释。"""
    comment = "    /** 验证输入边界。 */\n" if documented else ""
    source = JAVA_HEADER + "    /** 相邻旧方法。 */\n    void previous() {}\n" + comment
    source += "    @ParameterizedTest\n    " + annotation + "\n    void run(String value) {}\n}\n"
    findings = scan_staged(monkeypatch, "java", None, source)
    assert [rule for rule, _ in findings] == ([] if documented else ["method-javadoc"])


@pytest.mark.parametrize("comment,expected", [
    ("/** 拒绝 text/* 与 image/* 的宽泛匹配。 */", []),
    ("/** 文档内的 /** 示例不能改变外层起点。 */", []),
    ("/* 普通注释中的 /** 不是 JavaDoc。 */", ["method-javadoc"]),
])
def test_java_comment_openers_inside_comments_are_plain_text(
    monkeypatch: pytest.MonkeyPatch, comment: str, expected: list[str]
) -> None:
    """块注释内不嵌套，MIME 通配和注释示例不能使职责说明丢失或被伪造。"""
    source = JAVA_HEADER + "    " + comment + "\n    @Test\n    void run() {}\n}\n"
    assert [rule for rule, _ in scan_staged(monkeypatch, "java", None, source)] == expected


def test_java_comment_marker_in_string_does_not_attach_javadoc() -> None:
    """字符串中的伪注释不能冒充紧邻方法的真实职责说明。"""
    source = 'class Demo { String text = "/** 伪造 */"; /* 普通说明 */ void run() {} }'
    assert java._attached_javadoc(source, source.index("void run")) is None


@pytest.mark.parametrize("scope", ["module", "class"])
def test_deleted_python_scope_documentation(monkeypatch: pytest.MonkeyPatch, scope: str) -> None:
    """模块和类的纯 Docstring 删除均按新出现的职责缺失检查。"""
    if scope == "module":
        before, removed = PYTHON_HEADER + "VALUE = 1\n", PYTHON_HEADER
    else:
        removed = '    """提供服务。"""\n'
        before = PYTHON_HEADER + "class Service:\n" + removed + "    pass\n"
    findings = scan_staged(monkeypatch, "python", before, before.replace(removed, ""))
    assert [rule for rule, _ in findings] == [scope + "-docstring"]


@pytest.mark.parametrize(
    "block",
    [
        "if True:\n    def run():\n        pass\n",
        "try:\n    pass\nexcept ValueError:\n    def run():\n        pass\n",
        "for item in []:\n    def run():\n        pass\n",
        "match 1:\n    case 1:\n        def run():\n            pass\n",
    ],
)
def test_python_control_flow_declarations_are_checked(
    monkeypatch: pytest.MonkeyPatch, block: str
) -> None:
    """条件、异常、循环和匹配分支中的函数均属于需要注释的显式声明。"""
    findings = scan_staged(monkeypatch, "python", None, PYTHON_HEADER + block)
    assert [rule for rule, _ in findings] == ["function-docstring"]


@pytest.mark.parametrize("language", ["java", "python"])
def test_existing_self_tests(language: str) -> None:
    """保留两种语言原有内置样例，防止新增变更识别破坏既有规则。"""
    module = java if language == "java" else python
    module._run_self_test()


@pytest.mark.parametrize("explicit_columns", [False, True])
@pytest.mark.parametrize("quoted_table", [False, True])
def test_sql_insert_rejects_fixed_credentials(
    monkeypatch: pytest.MonkeyPatch, explicit_columns: bool, quoted_table: bool
) -> None:
    """带列名与按位置写入均根据真实字段识别凭据，诊断不包含模拟值。"""
    table = "`system_oauth2_refresh_token`" if quoted_table else "system_oauth2_refresh_token"
    columns = "(id, refresh_token, memo)" if explicit_columns else ""
    sample = "unit-" + "a" * 16
    source = (
        f"CREATE TABLE {table} (id bigint, refresh_token varchar(128), memo varchar(128));\n"
        f"INSERT INTO {table} {columns} VALUES (1, '{sample}', 'text, with ) and ''quote');\n"
    )
    findings = scan_secret_source(monkeypatch, "数据库文件/fixture.sql", source)
    assert any(item.rule == "sql-sensitive-insert" for item in findings)
    assert sample not in repr(findings)


def test_sql_sensitive_positional_insert_requires_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    """缺少敏感表字段映射时明确阻断，不能因凭据只出现在 VALUES 内而漏检。"""
    source = "INSERT INTO system_oauth2_refresh_token VALUES (1, '" + "unit-" + "a" * 16 + "');\n"
    findings = scan_secret_source(monkeypatch, "数据库文件/fixture.sql", source)
    assert [item.rule for item in findings] == ["sql-schema-unresolved"]


def test_sql_placeholder_and_parameter_values_remain_valid(monkeypatch: pytest.MonkeyPatch) -> None:
    """空值、受控绑定参数和明确占位符可初始化结构，普通标签不是凭据。"""
    source = (
        "CREATE TABLE system_users (id bigint, password varchar(128), remark varchar(128));\n"
        "INSERT INTO system_users VALUES (1, '', 'text'), (2, NULL, 'more');\n"
        "INSERT INTO system_users (id, password) VALUES (3, 'CHANGE_ME_PASSWORD');\n"
        "INSERT INTO system_users (id, password) VALUES (4, @provided);\n"
        "INSERT INTO other_table (label) VALUES ('refresh_token');\n"
        "INSERT INTO other_table (`path`, token_type, token_count) VALUES ('/home', 'Bearer', 42);\n"
    )
    assert scan_secret_source(monkeypatch, "数据库文件/fixture.sql", source) == []


def test_sql_bcrypt_hash_is_not_an_environment_reference(monkeypatch: pytest.MonkeyPatch) -> None:
    """以美元符号开头的固定密码摘要仍属于凭据，不能误用环境变量豁免。"""
    sample = "$2a$10$" + "a" * 53
    source = f"INSERT INTO system_users (id, password) VALUES (1, '{sample}');\n"
    findings = scan_secret_source(monkeypatch, "数据库文件/fixture.sql", source)
    assert any(item.rule == "sql-sensitive-insert" for item in findings)
    assert sample not in repr(findings)


def test_sql_changed_field_rechecks_unchanged_values(monkeypatch: pytest.MonkeyPatch) -> None:
    """把旧字段改为凭据字段时检查其既有写入值，普通尾部修改不追查无关旧行。"""
    sample = "unit-" + "a" * 16
    before = f"CREATE TABLE demo (label varchar(128));\nINSERT INTO demo VALUES ('{sample}');\n"
    source = before.replace("label", "password")
    findings = scan_secret_source(monkeypatch, "数据库文件/fixture.sql", source, before)
    assert [item.rule for item in findings] == ["sql-sensitive-insert"]
    assert scan_secret_source(monkeypatch, "数据库文件/fixture.sql", source + "SELECT 1;\n", source) == []


def test_sql_key_value_configuration_and_tickets(monkeypatch: pytest.MonkeyPatch) -> None:
    """初始化密码配置和登录票据的间接字段也阻断，安全开关值继续允许。"""
    sample = "unit-" + "a" * 16
    source = (
        f"INSERT INTO infra_config (`key`, `value`) VALUES ('system.user.init-password', '{sample}');\n"
        "INSERT INTO infra_config (`key`, `value`) VALUES ('system.user.register-enabled', 'false');\n"
        f"INSERT INTO system_auto_login_ticket (`ticket`) VALUES ('{sample}');\n"
    )
    findings = scan_secret_source(monkeypatch, "数据库文件/fixture.sql", source)
    assert [(item.line, item.rule) for item in findings] == [(1, "sql-sensitive-insert"), (3, "sql-sensitive-insert")]


def test_sql_comments_cannot_hide_executable_inserts(monkeypatch: pytest.MonkeyPatch) -> None:
    """普通注释不当成初始化语句，MySQL 可执行注释内的写入仍须检查。"""
    sample = "unit-" + "a" * 16
    statement = f"INSERT INTO system_users (password) VALUES ('{sample}');"
    source = f"-- {statement}\n/* plain: {statement} */\n/*!50000 {statement} */\n"
    findings = scan_secret_source(monkeypatch, "数据库文件/fixture.sql", source)
    assert [(item.line, item.rule) for item in findings] == [(3, "sql-sensitive-insert")]


def test_empty_python_containers_are_not_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    """空容器初始化不含固定凭据，相邻非空敏感赋值仍须阻断。"""
    source = "tokens = []\ncredentials = {}\npasswords = ()\n"
    assert scan_secret_source(monkeypatch, "src/parser.py", source) == []
    source += "password" + " = '" + "unit-" + "a" * 16 + "'\n"
    findings = scan_secret_source(monkeypatch, "src/parser.py", source)
    assert [item.rule for item in findings] == ["sensitive-assignment"]


def test_sql_metadata_cannot_hide_fixed_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    """名称声称计量但写入固定字符串时仍阻断，不能按列名整体豁免。"""
    source = "INSERT INTO other_table (token_count) VALUES ('" + "unit-" + "a" * 16 + "');\n"
    findings = scan_secret_source(monkeypatch, "数据库文件/fixture.sql", source)
    assert [item.rule for item in findings] == ["sql-sensitive-insert"]
