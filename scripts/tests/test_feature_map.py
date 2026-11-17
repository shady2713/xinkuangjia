"""验证用户功能图与 web-ele e2e 规格的双向对齐及漂移失败边界。

测试只读仓库文件，并在 pytest 私有目录构造缺行、错路径和空用例样例。
@author 李杰
"""

from pathlib import Path

import pytest
from scripts.common.quality_common import DEFAULT_ROOT
from scripts.docs.feature_map_support import (
    E2E_DIRECTORY,
    FEATURE_MAP,
    parse_feature_map,
    validate_feature_map,
)

TABLE_HEADER = "| 用户路径 | 规格文件 | 断言要点 |\n| --- | --- | --- |\n"


def _write(root: Path, relative: str, source: str) -> Path:
    """写入测试私有的 UTF-8 文件并返回路径。"""
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(source, encoding="utf-8")
    return path


def _document(rows: list[tuple[str, str, str]]) -> str:
    """按固定章节和表头拼出功能图样例，行内容由调用方控制。"""
    body = "\n".join(
        f"| {user_path} | {spec_cell} | {assertion} |"
        for user_path, spec_cell, assertion in rows
    )
    return (
        "---\ndescription: 样例\nkind: package-reference\n---\n\n"
        "# 用户功能图\n\n"
        '<a id="critical-paths"></a>\n\n'
        "## 关键路径与 e2e 对齐\n\n"
        f"{TABLE_HEADER}{body}\n"
    )


def _repository(
    root: Path, specs: dict[str, str], rows: list[tuple[str, str, str]]
) -> Path:
    """构造含功能图和 e2e 规格的临时仓库，规格内容用于控制用例声明。"""
    _write(root, FEATURE_MAP, _document(rows))
    for name, source in specs.items():
        _write(root, f"{E2E_DIRECTORY}/{name}", source)
    return root


def _row(name: str, assertion: str = "断言要点") -> tuple[str, str, str]:
    """返回一条指向指定规格文件的表格行。"""
    return (f"路径 {name}", f"`{E2E_DIRECTORY}/{name}`", assertion)


def test_repository_feature_map_matches_e2e() -> None:
    """仓库当前功能图与全部 e2e 规格双向一致。"""
    assert validate_feature_map(DEFAULT_ROOT) == []


def test_consistent_fixture_passes(tmp_path: Path) -> None:
    """临时仓库的表行、规格文件和用例都存在时没有诊断。"""
    root = _repository(
        tmp_path,
        {"login.spec.ts": "test('登录', async () => {});\n"},
        [_row("login.spec.ts")],
    )
    assert validate_feature_map(root) == []


def test_unregistered_spec_is_reported(tmp_path: Path) -> None:
    """新增规格文件未登记时必须失败，而不是只依赖表中已有行。"""
    root = _repository(
        tmp_path,
        {
            "login.spec.ts": "test('登录', async () => {});\n",
            "permission.spec.ts": "test('权限', async () => {});\n",
        },
        [_row("login.spec.ts")],
    )
    problems = validate_feature_map(root)
    assert any("未在功能图登记" in item and "permission.spec.ts" in item for item in problems)


def test_missing_spec_file_is_reported(tmp_path: Path) -> None:
    """表中登记的文件不存在时必须失败，路径写错不能静默通过。"""
    root = _repository(
        tmp_path,
        {"login.spec.ts": "test('登录', async () => {});\n"},
        [_row("login.spec.ts"), _row("missing.spec.ts")],
    )
    problems = validate_feature_map(root)
    assert any("规格文件不存在" in item and "missing.spec.ts" in item for item in problems)


def test_spec_without_declared_test_is_reported(tmp_path: Path) -> None:
    """规格文件只有钩子而没有用例时，登记不能算有效覆盖。"""
    root = _repository(
        tmp_path,
        {"login.spec.ts": "test.beforeEach(async () => {});\n"},
        [_row("login.spec.ts")],
    )
    problems = validate_feature_map(root)
    assert any("没有任何 Playwright 用例" in item and "login.spec.ts" in item for item in problems)


@pytest.mark.parametrize(
    "source",
    [
        "# 用户功能图\n\n关键路径用散文描述，没有可解析的表格。\n",
        _document([]).replace("| 用户路径 | 规格文件 | 断言要点 |", "| 路径 | 用例 | 说明 |"),
        _document([]).replace("| 断言要点 |", "| 断言要点 | 备注 |"),
        _document([_row("login.spec.ts")]).replace("| --- | --- | --- |", "| --- |"),
    ],
)
def test_malformed_table_is_reported(tmp_path: Path, source: str) -> None:
    """缺少表格、列名不符或分隔行缺列时返回可定位的解析失败。"""
    _write(tmp_path, FEATURE_MAP, source)
    problems = validate_feature_map(tmp_path)
    assert problems and problems[0].startswith("功能图无法解析："), problems


def test_duplicate_table_is_rejected(tmp_path: Path) -> None:
    """重复的关键路径表会让解析歧义，必须失败。"""
    source = _document([_row("login.spec.ts")])
    source += "\n" + TABLE_HEADER + "| 重复 | `` | 重复 |\n"
    with pytest.raises(ValueError, match="表头"):
        parse_feature_map(source)
