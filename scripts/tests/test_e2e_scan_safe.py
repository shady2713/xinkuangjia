"""验证 e2e 目录不提交真实形态的口令与密钥字面量。

扫描 web-ele 的规格、README 和文本夹具；xlsx、png 等二进制夹具不按文本读取。
@author 李杰
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from scripts.common.quality_common import DEFAULT_ROOT

E2E_DIRECTORY = "前端代码/basic-framework-admin/apps/web-ele/e2e"
TEXT_SUFFIXES = frozenset(
    {".cjs", ".js", ".json", ".md", ".mjs", ".mts", ".sql", ".ts", ".txt", ".yaml", ".yml"}
)
PLACEHOLDER_PREFIX = "CHANGE_ME"
BCRYPT_HASH = re.compile(r"^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$")
CREDENTIAL_ASSIGNMENT = re.compile(
    r"""(?ix)
    (?P<key>["'`]?[A-Za-z0-9_.$-]*
        (?:password|passwd|passphrase|secret|hmac|api[_-]?key|access[_-]?key
           |private[_-]?key|signing[_-]?key|credential|token)
        [A-Za-z0-9_.$-]*["'`]?)
    \s*(?P<operator>:(?!=)|=(?!=))\s*
    (?P<value>['"`].+)$
    """
)
STRING_LITERAL = re.compile(r"""^(?P<quote>['"`])(?P<value>.*?)(?P=quote)""", re.DOTALL)
SECRET_PREFIX = re.compile(
    r"(?i)(?<![a-z0-9_-])(?:sk-[a-z0-9_-]{16,}|ghp_[a-z0-9]{20,}|"
    r"glpat-[a-z0-9_-]{20,}|xox[baprs]-[a-z0-9-]{20,}|AKIA[0-9A-Z]{16})"
    r"(?![a-z0-9_-])"
)
HMAC_HEX_KEY = re.compile(r"(?<![0-9A-Za-z])[0-9A-Fa-f]{64,}(?![0-9A-Za-z])")

# 样例值用片段拼出，避免测试文件自身命中仓库密钥扫描；本门禁只扫描 e2e 目录。
FIXTURE_VALUE = "unit-" + "a" * 16
FIELD = "pass" + "word"


@dataclass(frozen=True)
class Finding:
    """保存一条不携带命中值的扫描结果。

    Attributes:
        path: 相对仓库根的 e2e 文件路径。
        line: 命中行号，从 1 开始。
        rule: 命中的检查规则名。
    """

    path: str
    line: int
    rule: str


def _allowed_literal(value: str) -> bool:
    """判断字符串字面量是否属于允许的占位符、插值或密码摘要。

    Args:
        value: 已去掉引号的字面量内容。
    Returns:
        无需阻断时返回 ``True``；真实形态的固定值返回 ``False``。
    """
    if not value or value.startswith(PLACEHOLDER_PREFIX) or "${" in value:
        return True
    return BCRYPT_HASH.fullmatch(value) is not None


def scan_text(relative: str, source: str) -> list[Finding]:
    """扫描单个文本文件中的凭据赋值与高置信密钥形态。

    Args:
        relative: 相对仓库根的文件路径，用于诊断。
        source: UTF-8 解码后的完整文本。
    Returns:
        按行号排序的诊断；只报告位置和规则，不回显敏感值。
    """
    findings: list[Finding] = []
    for number, line in enumerate(source.splitlines(), 1):
        if SECRET_PREFIX.search(line) or HMAC_HEX_KEY.search(line):
            findings.append(Finding(relative, number, "secret-material"))
            continue
        assignment = CREDENTIAL_ASSIGNMENT.search(line)
        if assignment is None:
            continue
        literal = STRING_LITERAL.match(assignment.group("value"))
        if literal is not None and not _allowed_literal(literal.group("value")):
            findings.append(Finding(relative, number, "credential-literal"))
    return findings


def e2e_text_files(root: Path) -> list[Path]:
    """列出 e2e 目录下按文本扫描的文件。

    Args:
        root: 仓库根目录。
    Returns:
        稳定排序的文本文件路径；目录缺失时直接失败，避免空范围伪装通过。
    Raises:
        AssertionError: e2e 目录不存在或实际没有文本文件。
    """
    directory = root / E2E_DIRECTORY
    if not directory.is_dir():
        raise AssertionError(f"缺少 e2e 目录：{E2E_DIRECTORY}")
    files = sorted(
        path
        for path in directory.rglob("*")
        if path.is_file() and path.suffix.lower() in TEXT_SUFFIXES
    )
    if not files:
        raise AssertionError(f"e2e 目录没有可扫描的文本文件：{E2E_DIRECTORY}")
    return files


def scan_directory(root: Path) -> list[Finding]:
    """扫描 e2e 目录的全部文本文件。

    Args:
        root: 仓库根目录。
    Returns:
        汇总后的诊断；行为空表示当前目录没有命中规则。
    Raises:
        AssertionError: 文本文件无法按 UTF-8 解码时抛出。
    """
    findings: list[Finding] = []
    for path in e2e_text_files(root):
        relative = path.relative_to(root).as_posix()
        findings.extend(scan_text(relative, path.read_text(encoding="utf-8-sig")))
    return findings


def test_current_e2e_directory_has_no_plaintext_credentials() -> None:
    """当前基线已改为环境变量注入，e2e 文本文件不得出现固定口令或密钥。"""
    findings = scan_directory(DEFAULT_ROOT)
    assert not findings, [f"{item.path}:{item.line} {item.rule}" for item in findings]


def test_literal_password_in_spec_is_rejected() -> None:
    """规格中写回固定口令必须由点名规则的诊断阻断。"""
    source = f"export const account = {{ {FIELD}: '{FIXTURE_VALUE}' }};\n"
    findings = scan_text("login.spec.ts", source)
    assert [(item.line, item.rule) for item in findings] == [(1, "credential-literal")]


def test_placeholders_environment_and_hashes_are_allowed() -> None:
    """占位符、环境变量读取和 BCrypt 摘要不是明文凭据。"""
    bcrypt_hash = (
        "$2b$10$" + "lu8UUvPAU7c4lDr.2A.gGO6shr7RD4TCbYC4nQtVjCwlZV/BGJxsq"
    )
    source = "\n".join(
        [
            f"export const unknown = {{ {FIELD}: 'CHANGE_ME_WRONG_PASSWORD' }};",
            f"export const admin = {{ {FIELD}: requiredTestSecret('E2E_ADMIN_PASSWORD') }};",
            f"SET `{FIELD}` = '{bcrypt_hash}';",
            f"const template = {{ {FIELD}: `${{process.env.E2E_ADMIN_PASSWORD}}` }};",
        ]
    )
    assert scan_text("fixtures/seed-e2e.sql", source) == []


def test_hmac_key_material_is_rejected() -> None:
    """固定 HMAC 十六进制密钥、赋值字面量和密钥前缀都必须阻断。"""
    source = "\n".join(
        [
            "const hmacKey = '" + "a1b2c3d4" * 8 + "';",
            "const signingKey = 'dGhpcy1pcy1hLXRlc3QtaG1hYy1rZXk=';",
            "const client = 'sk-" + "a1b2c3d4" * 4 + "';",
        ]
    )
    findings = scan_text("support/flows.ts", source)
    assert [(item.line, item.rule) for item in findings] == [
        (1, "secret-material"),
        (2, "credential-literal"),
        (3, "secret-material"),
    ]


def test_readme_command_literal_is_scanned(tmp_path: Path) -> None:
    """README 中示例命令的固定口令同样被扫描，不只检查 TypeScript 规格。"""
    readme = tmp_path / "e2e" / "README.md"
    readme.parent.mkdir(parents=True)
    variable = "E2E_ADMIN_" + FIELD.upper()
    readme.write_text(f"export {variable}='{FIXTURE_VALUE}'\n", encoding="utf-8")
    findings = scan_text("e2e/README.md", readme.read_text(encoding="utf-8"))
    assert [(item.line, item.rule) for item in findings] == [(1, "credential-literal")]


def test_binary_fixtures_are_not_read_as_text(tmp_path: Path) -> None:
    """xlsx、png 等二进制夹具不进入文本范围，文本夹具仍会被扫描。"""
    directory = tmp_path / E2E_DIRECTORY
    directory.mkdir(parents=True)
    (directory / "fixtures").mkdir()
    payload = b"pass" + b"word: '" + FIXTURE_VALUE.encode() + b"'"
    (directory / "fixtures" / "user-import.xlsx").write_bytes(payload)
    (directory / "fixtures" / "upload-sample.png").write_bytes(payload)
    (directory / "login.spec.ts").write_text("export const a = 1;\n", encoding="utf-8")
    assert [path.name for path in e2e_text_files(tmp_path)] == ["login.spec.ts"]
    assert scan_directory(tmp_path) == []
