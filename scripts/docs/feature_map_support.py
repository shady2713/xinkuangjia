"""解析用户功能图的关键路径表并核对 web-ele e2e 规格的双向覆盖。

功能图是 e2e 登记的唯一入口；本模块只读 Markdown 与规格源码，
路径均相对于仓库根目录，不执行被测代码。
@author 李杰
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

FEATURE_MAP = "docs/测试与可靠性/功能图.md"
E2E_DIRECTORY = "前端代码/basic-framework-admin/apps/web-ele/e2e"
HEADING = "## 关键路径与 e2e 对齐"
COLUMNS = ("用户路径", "规格文件", "断言要点")
SPEC_PATH = re.compile(r"^`(?P<path>[^`\r\n]+)`$")
SEPARATOR_CELL = re.compile(r"^:?-{3,}:?$")
# Playwright 用例声明；钩子 beforeEach 等不是测试，不能用来满足登记要求。
TEST_DECLARATION = re.compile(r"(?m)^\s*test(?:\.(?:only|skip|fixme|fail))?\s*\(")


@dataclass(frozen=True)
class FeaturePath:
    """保存功能图中的一条关键路径及其规格登记。"""

    user_path: str
    spec_file: str
    assertion: str
    line: int


def _cells(line: str) -> list[str] | None:
    """把 Markdown 表格行拆成单元格；非表格行返回空值。

    Args:
        line: 文档中的一行原始文本。
    Returns:
        去除首尾空白的单元格；不是以竖线包围的行时返回 None。
    Raises:
        ValueError: 单元格内含未转义竖线，无法稳定拆分。
    """
    stripped = line.strip()
    if not stripped.startswith("|") or not stripped.endswith("|"):
        return None
    if "\\|" in stripped:
        raise ValueError("关键路径表单元格不能包含竖线")
    return [cell.strip() for cell in stripped[1:-1].split("|")]


def _table_start(lines: list[str]) -> int:
    """定位唯一的关键路径表头，返回其行下标。

    Args:
        lines: 完整文档按行拆分的结果。
    Returns:
        表头所在的行下标。
    Raises:
        ValueError: 缺少章节、缺少表头或出现多个同名表。
    """
    headings = [
        index for index, line in enumerate(lines) if line.strip() == HEADING
    ]
    if len(headings) != 1:
        raise ValueError(f"功能图必须且只能包含一个「{HEADING}」章节")
    headers = [
        index
        for index, line in enumerate(lines)
        if _cells(line) == list(COLUMNS)
    ]
    if len(headers) != 1:
        raise ValueError(
            "关键路径表必须且只能包含一个表头：| 用户路径 | 规格文件 | 断言要点 |"
        )
    if headers[0] < headings[0]:
        raise ValueError("关键路径表必须位于「关键路径与 e2e 对齐」章节内")
    return headers[0]


def parse_feature_map(source: str) -> list[FeaturePath]:
    """解析关键路径表，拒绝缺列、空值和无法定位的规格路径。

    Args:
        source: 功能图完整 UTF-8 正文。
    Returns:
        按表格顺序排列的关键路径。
    Raises:
        ValueError: 表头、分隔行或登记内容不符合固定格式。
    """
    lines = source.splitlines()
    header = _table_start(lines)
    separator = _cells(lines[header + 1]) if header + 1 < len(lines) else None
    if separator is None or len(separator) != len(COLUMNS) or not all(
        SEPARATOR_CELL.match(cell) for cell in separator
    ):
        raise ValueError("关键路径表头下一行必须是三列分隔行")
    entries: list[FeaturePath] = []
    for index in range(header + 2, len(lines)):
        cells = _cells(lines[index])
        if cells is None:
            break
        if len(cells) != len(COLUMNS):
            raise ValueError(f"功能图第 {index + 1} 行必须恰好包含三列")
        user_path, spec_cell, assertion = cells
        if not user_path or not assertion:
            raise ValueError(f"功能图第 {index + 1} 行的用户路径和断言要点不能为空")
        match = SPEC_PATH.match(spec_cell)
        if match is None:
            raise ValueError(
                f"功能图第 {index + 1} 行的规格文件必须是单个行内代码路径"
            )
        spec_file = match.group("path")
        if not spec_file.startswith(f"{E2E_DIRECTORY}/") or not spec_file.endswith(
            ".spec.ts"
        ):
            raise ValueError(
                f"功能图第 {index + 1} 行的规格文件不在 {E2E_DIRECTORY} 下：{spec_file}"
            )
        entries.append(FeaturePath(user_path, spec_file, assertion, index + 1))
    if not entries:
        raise ValueError("关键路径表至少需要一条已登记的规格文件")
    return entries


def spec_files(root: Path) -> list[str]:
    """列出 web-ele e2e 目录中的规格文件仓库相对路径。

    Args:
        root: 仓库根目录。
    Returns:
        排序后的仓库相对路径；目录不存在时返回空列表。
    """
    directory = root / E2E_DIRECTORY
    if not directory.is_dir():
        return []
    return sorted(
        path.relative_to(root).as_posix() for path in directory.glob("*.spec.ts")
    )


def test_declarations(source: str) -> int:
    """统计规格源码中直接声明的 Playwright 用例数。

    Args:
        source: 规格文件的 TypeScript 正文。
    Returns:
        test/test.only/test.skip 等用例声明数量，不含 beforeEach 钩子。
    """
    return len(TEST_DECLARATION.findall(source))


def validate_feature_map(root: Path) -> list[str]:
    """核对功能图与 e2e 规格文件的双向对齐，返回全部可定位问题。

    Args:
        root: 仓库根目录。
    Returns:
        问题描述列表；空列表表示功能图与现有规格互相覆盖。
    """
    path = root / FEATURE_MAP
    if not path.is_file():
        return [f"功能图不存在：{FEATURE_MAP}"]
    try:
        entries = parse_feature_map(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as exc:
        return [f"功能图无法解析：{exc}"]
    problems: list[str] = []
    declared = {entry.spec_file for entry in entries}
    actual = set(spec_files(root))
    for entry in entries:
        spec = root / entry.spec_file
        if not spec.is_file():
            problems.append(
                f"功能图第 {entry.line} 行的规格文件不存在：{entry.spec_file}"
            )
            continue
        if entry.spec_file not in actual:
            problems.append(
                f"功能图第 {entry.line} 行的规格文件不属于 web-ele e2e：{entry.spec_file}"
            )
        if test_declarations(spec.read_text(encoding="utf-8")) == 0:
            problems.append(
                f"功能图第 {entry.line} 行的规格文件没有任何 Playwright 用例：{entry.spec_file}"
            )
    for missing in sorted(actual - declared):
        problems.append(f"e2e 规格文件未在功能图登记：{missing}")
    return problems
