#!/usr/bin/env python3
"""检查暂存区 Python 变更涉及的模块与声明是否具备合规中文 Docstring。

@author 李杰
"""

from __future__ import annotations

import argparse
import ast
import difflib
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Iterable, Sequence

if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scripts.common.check_protocol import emit

CHINESE_PATTERN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
# 兼容普通空白和 Docstring 中可能出现的 HTML 空格实体。
AUTHOR_MARKER_PATTERN = re.compile(r"@author\b", re.IGNORECASE)
AUTHOR_PATTERN = re.compile(
    r"@author(?:[ \t]|&(?:#x20;|#32;|nbsp;))+"
    r"(?P<name>[^\r\n]+)",
    re.IGNORECASE,
)
# 静态门禁只排除明确占位值，真实身份仍由 Skill 按会话规则核对。
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
EXCLUDED_PARTS = {
    ".git",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".tox",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "generated",
    "node_modules",
    "target",
    "venv",
}


@dataclass(frozen=True)
class Finding:
    """表示一条可定位到文件和行号的注释质量问题。"""

    path: str
    line: int
    rule: str
    detail: str


def _configure_console_encoding() -> None:
    """在 Windows 等环境中尽量使用 UTF-8 输出中文诊断信息。"""

    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")


def _repo_root() -> str:
    """返回当前 Git 仓库根目录，无法定位时终止检查。"""

    result = _run_git(["rev-parse", "--show-toplevel"])
    return result.stdout.strip()


def _run_git(arguments: Sequence[str], *, text: bool = True) -> subprocess.CompletedProcess:
    """执行只读 Git 命令，并统一超时、编码和失败处理。"""

    command = ["git", "-c", "core.quotepath=false", *arguments]
    try:
        return subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=text,
            encoding="utf-8" if text else None,
            errors="replace" if text else None,
            timeout=30,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("未找到 git，无法读取暂存区。") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Git 命令执行超时。") from exc
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.decode("utf-8", "replace") if isinstance(exc.stderr, bytes) else exc.stderr
        raise RuntimeError(f"Git 命令执行失败：{stderr.strip()}") from exc


def _is_checkable_python_path(path: str) -> bool:
    """判断路径是否为需要检查且不属于生成目录的 Python 源文件。"""

    normalized = path.replace("\\", "/")
    parts = {part.lower() for part in PurePosixPath(normalized).parts}
    return normalized.lower().endswith(".py") and not parts.intersection(EXCLUDED_PARTS)


def _nul_separated_paths(output: bytes) -> list[str]:
    """将 Git 的 NUL 分隔路径输出解码为 UTF-8 路径列表。"""

    return [item.decode("utf-8", "replace") for item in output.split(b"\0") if item]


def _staged_python_paths() -> list[str]:
    """返回暂存区中新增、复制、修改或重命名的 Python 文件。"""

    result = _run_git(
        ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z", "--", "*.py"],
        text=False,
    )
    return [path for path in _nul_separated_paths(result.stdout) if _is_checkable_python_path(path)]


def _staged_added_paths() -> set[str]:
    """返回暂存区中新建的 Python 文件，用于启用完整声明检查。"""

    result = _run_git(
        ["diff", "--cached", "--name-only", "--diff-filter=A", "-z", "--", "*.py"],
        text=False,
    )
    return {path for path in _nul_separated_paths(result.stdout) if _is_checkable_python_path(path)}


def _staged_source(path: str) -> str:
    """读取指定文件的暂存区内容并按 UTF-8 解码。"""

    result = _run_git(["show", f":{path}"], text=False)
    try:
        return result.stdout.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("文件不是有效的 UTF-8 文本") from exc


def _added_lines(path: str) -> set[int]:
    """解析暂存区零上下文差异，返回新文件侧新增或修改后的行号。"""

    result = _run_git(["diff", "--cached", "--unified=0", "--no-color", "--", path])
    added: set[int] = set()
    header_pattern = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")
    for line in result.stdout.splitlines():
        match = header_pattern.match(line)
        if match is None:
            continue
        start = int(match.group(1))
        count = int(match.group(2) or "1")
        added.update(range(start, start + count))
    return added


def _contains_chinese(text: str) -> bool:
    """判断 Docstring 是否至少包含一个中文字符。"""

    return CHINESE_PATTERN.search(text) is not None


def _has_actual_author(docstring: str) -> bool:
    """判断模块 Docstring 是否包含非占位的作者姓名。"""

    for match in AUTHOR_PATTERN.finditer(docstring):
        author = re.sub(
            r"(?:\s|&(?:#x20;|#32;|nbsp;))+$",
            "",
            match.group("name"),
            flags=re.IGNORECASE,
        ).strip()
        if author and author.casefold() not in AUTHOR_PLACEHOLDERS:
            return True
    return False


def _append_module_author_finding(
    findings: list[Finding],
    *,
    path: str,
    docstring: str | None,
    new_file: bool,
) -> None:
    """按新旧文件策略追加模块作者问题。"""

    if docstring is None:
        return
    has_marker = AUTHOR_MARKER_PATTERN.search(docstring) is not None
    has_actual_author = _has_actual_author(docstring)
    if new_file and not has_actual_author:
        findings.append(
            Finding(path, 1, "module-author", "新建模块的模块 Docstring 缺少非占位的 @author 实际作者。")
        )
    elif has_marker and not has_actual_author:
        findings.append(
            Finding(path, 1, "module-author", "模块 Docstring 的 @author 为空或使用了占位值。")
        )


def _docstring_node(body: Sequence[ast.stmt]) -> ast.Expr | None:
    """返回语句块开头的 Docstring 节点，不存在时返回空值。"""

    if not body:
        return None
    first = body[0]
    if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
        return first
    return None


def _line_range_intersects(start: int, end: int, lines: set[int]) -> bool:
    """判断闭区间是否与本次新增行集合相交。"""

    return any(start <= line <= end for line in lines)


def _declaration_start(node: ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef) -> int:
    """返回包含装饰器在内的声明起始行。"""

    decorator_lines = [decorator.lineno for decorator in node.decorator_list]
    return min([node.lineno, *decorator_lines])


def _class_is_involved(node: ast.ClassDef, added_lines: set[int], *, new_file: bool) -> bool:
    """判断类头或类 Docstring 是否被本次变更直接涉及。"""

    if new_file:
        return True
    start = _declaration_start(node)
    if _line_range_intersects(start, node.lineno, added_lines):
        return True
    doc_node = _docstring_node(node.body)
    return doc_node is not None and _line_range_intersects(
        doc_node.lineno,
        doc_node.end_lineno or doc_node.lineno,
        added_lines,
    )


def _function_is_involved(
    node: ast.FunctionDef | ast.AsyncFunctionDef,
    added_lines: set[int],
    *,
    new_file: bool,
) -> bool:
    """判断函数或方法的声明、Docstring、实现体是否被本次变更涉及。"""

    if new_file:
        return True
    return _line_range_intersects(
        _declaration_start(node),
        node.end_lineno or node.lineno,
        added_lines,
    )


def _qualified_name(parents: Sequence[str], name: str) -> str:
    """拼接类、函数和嵌套声明的限定名称。"""

    return ".".join([*parents, name])


def _append_docstring_findings(
    findings: list[Finding],
    *,
    path: str,
    line: int,
    kind: str,
    name: str,
    docstring: str | None,
) -> None:
    """按声明类型追加缺失或非中文 Docstring 的诊断结果。"""

    if docstring is None:
        findings.append(
            Finding(path, line, f"{kind}-docstring", f"{name} 缺少职责 Docstring。")
        )
    elif not _contains_chinese(docstring):
        findings.append(
            Finding(path, line, f"{kind}-docstring-zh", f"{name} 的 Docstring 应使用中文说明职责。")
        )


def _scan_declarations(
    body: Iterable[ast.AST],
    *,
    path: str,
    added_lines: set[int],
    new_file: bool,
    parents: tuple[str, ...] = (),
) -> list[Finding]:
    """递归检查显式声明，包含条件、异常、循环和匹配分支中的声明。"""

    findings: list[Finding] = []
    for node in body:
        if isinstance(node, ast.ClassDef):
            name = _qualified_name(parents, node.name)
            if _class_is_involved(node, added_lines, new_file=new_file):
                _append_docstring_findings(
                    findings,
                    path=path,
                    line=node.lineno,
                    kind="class",
                    name=f"类 {name}",
                    docstring=ast.get_docstring(node, clean=False),
                )
            findings.extend(
                _scan_declarations(
                    node.body,
                    path=path,
                    added_lines=added_lines,
                    new_file=new_file,
                    parents=(*parents, node.name),
                )
            )
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            name = _qualified_name(parents, node.name)
            if _function_is_involved(node, added_lines, new_file=new_file):
                _append_docstring_findings(
                    findings,
                    path=path,
                    line=node.lineno,
                    kind="function",
                    name=f"函数或方法 {name}",
                    docstring=ast.get_docstring(node, clean=False),
                )
            findings.extend(
                _scan_declarations(
                    node.body,
                    path=path,
                    added_lines=added_lines,
                    new_file=new_file,
                    parents=(*parents, node.name),
                )
            )
        else:
            # 控制流节点及 except/case 中间节点不形成命名作用域，继续寻找
            # 内部显式声明，并保留原有限定名称；装饰器不能替代职责注释。
            findings.extend(
                _scan_declarations(
                    ast.iter_child_nodes(node),
                    path=path,
                    added_lines=added_lines,
                    new_file=new_file,
                    parents=parents,
                )
            )
    return findings


def _scan_source(path: str, source: str, added_lines: set[int], *, new_file: bool) -> list[Finding]:
    """检查单个 Python 文件中本次变更涉及的模块和声明注释。"""

    if not added_lines:
        return []
    try:
        tree = ast.parse(source, filename=path)
    except SyntaxError as exc:
        return [Finding(path, exc.lineno or 1, "syntax-error", f"无法解析 Python 语法：{exc.msg}")]

    findings: list[Finding] = []
    module_docstring = ast.get_docstring(tree, clean=False)
    _append_docstring_findings(
        findings,
        path=path,
        line=1,
        kind="module",
        name="模块",
        docstring=module_docstring,
    )
    _append_module_author_finding(
        findings,
        path=path,
        docstring=module_docstring,
        new_file=new_file,
    )
    findings.extend(
        _scan_declarations(
            tree.body,
            path=path,
            added_lines=added_lines,
            new_file=new_file,
        )
    )
    return findings


def _previous_source(path: str) -> str | None:
    """从暂存差异读取旧 blob，不依赖工作区文件或重命名前的路径。

    Args:
        path: 当前暂存版本的仓库相对路径。
    Returns:
        旧版本源码；新增文件或没有内容差异时返回 None。
    Raises:
        RuntimeError: Git 无法读取差异或对象；不修改 Git 状态。
        ValueError: 旧源码不是 UTF-8。
    """
    result = _run_git(
        ["diff", "--cached", "--full-index", "--no-ext-diff", "--no-textconv", "--", path]
    )
    match = re.search(r"^index ([0-9a-f]+)\.\.[0-9a-f]+", result.stdout, re.MULTILINE)
    if match is None or not match.group(1).strip("0"):
        return None
    result = _run_git(["cat-file", "blob", match.group(1)], text=False)
    try:
        return result.stdout.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("旧 Python 源码不是有效的 UTF-8 文本") from exc


def _new_documentation_findings(
    path: str, source: str, previous_source: str | None
) -> list[Finding]:
    """补充注释删除和改坏引入的问题，同时保留未改声明的历史边界。

    Args:
        path: 当前暂存文件路径。
        source: 当前暂存版本源码。
        previous_source: 对应旧源码；新增文件传 None。
    Returns:
        当前声明相对旧版本新增的诊断，不把相邻历史问题算作本次删除结果。
    """
    if previous_source is None:
        return []
    current_lines = source.splitlines()
    previous_lines = previous_source.splitlines()
    current = _scan_source(
        path, source, set(range(1, len(current_lines) + 1)) or {1}, new_file=False
    )
    if not current:
        return []
    previous = {
        (finding.line, finding.rule, finding.detail)
        for finding in _scan_source(
            path, previous_source, set(range(1, len(previous_lines) + 1)) or {1}, new_file=False
        )
    }
    # 未改声明通过文本行映射保持身份，删除其他函数导致的行号移动不构成
    # 新问题；实际新增或修改涉及的声明仍由原有增量检查负责。
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


def _scan_staged_python_comments(paths: list[str] | None = None) -> list[Finding]:
    """汇总暂存区全部相关 Python 文件的注释质量问题。"""

    added_paths = _staged_added_paths()
    findings: list[Finding] = []
    for path in _staged_python_paths() if paths is None else paths:
        try:
            source = _staged_source(path)
            previous_source = None if path in added_paths else _previous_source(path)
        except ValueError as exc:
            findings.append(Finding(path, 1, "encoding", str(exc)))
            continue
        findings.extend(_scan_source(path, source, _added_lines(path), new_file=path in added_paths))
        findings.extend(_new_documentation_findings(path, source, previous_source))
    return sorted(set(findings), key=lambda finding: (finding.path, finding.line, finding.rule))


def _assert_rules(
    source: str,
    added_lines: set[int],
    expected_rules: set[str],
    *,
    new_file: bool = False,
) -> None:
    """断言测试源码产生的规则集合与预期一致。"""

    actual = {finding.rule for finding in _scan_source("sample.py", source, added_lines, new_file=new_file)}
    if actual != expected_rules:
        raise AssertionError(f"预期 {sorted(expected_rules)}，实际 {sorted(actual)}")


def _run_self_test() -> None:
    """运行不依赖 Git 状态的内置回归测试。"""

    compliant = '''"""示例模块。

@author 李杰
"""

class Service:
    """提供示例服务。"""

    async def execute(self) -> None:
        """执行示例任务。"""
        return None
'''
    _assert_rules(
        compliant,
        set(range(1, compliant.count("\n") + 2)),
        set(),
        new_file=True,
    )

    missing = "class Service:\n    def execute(self):\n        return None\n"
    _assert_rules(
        missing,
        {1, 2, 3},
        {"module-docstring", "class-docstring", "function-docstring"},
        new_file=True,
    )

    english = '''"""Example module.

@author Alice
"""

def execute():
    """Execute the task."""
    return None
'''
    _assert_rules(
        english,
        set(range(1, english.count("\n") + 2)),
        {"module-docstring-zh", "function-docstring-zh"},
        new_file=True,
    )

    new_without_author = '''"""新建模块。"""

VALUE = 1
'''
    _assert_rules(
        new_without_author,
        {1, 3},
        {"module-author"},
        new_file=True,
    )

    placeholder_author = '''"""旧模块。

@author TODO
"""

VALUE = 1
'''
    _assert_rules(placeholder_author, {6}, {"module-author"})

    html_author = '''"""HTML 空格作者模块。

@author&#x20;王五
"""

VALUE = 1
'''
    _assert_rules(
        html_author,
        set(range(1, html_author.count("\n") + 2)),
        set(),
        new_file=True,
    )

    legacy = '''"""遗留模块。"""

def legacy():
    return 1

VALUE = 2
'''
    _assert_rules(legacy, {6}, set())
    _assert_rules(legacy, {4}, {"function-docstring"})

    nested = '''"""嵌套函数模块。"""

def outer():
    """执行外层任务。"""
    async def inner():
        return None
    return inner
'''
    _assert_rules(nested, {5, 6}, {"function-docstring"})
    _assert_rules("def broken(:\n    pass\n", {1}, {"syntax-error"})


def _parse_args(argv: Sequence[str]) -> argparse.Namespace:
    """解析命令行参数。"""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true", help="运行内置回归测试")
    parser.add_argument("--json", action="store_true", help="输出结构化计数与诊断")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    """执行自测或暂存区 Python 注释检查并返回进程状态码。"""

    _configure_console_encoding()
    args = _parse_args(sys.argv[1:] if argv is None else argv)
    if args.self_test:
        _run_self_test()
        print("Python 注释检查器自测通过。")
        return 0

    try:
        os.chdir(_repo_root())
        paths = _staged_python_paths()
        findings = _scan_staged_python_comments(paths)
    except RuntimeError as exc:
        print(f"Python 注释检查无法执行：{exc}", file=sys.stderr)
        return 2

    if args.json:
        return emit("Python 注释", len(paths), findings)
    if not paths:
        print("Python 注释检查：不适用，没有暂存 Python 文件；未验证 Python 声明。")
        return 0

    if not findings:
        print("Python 暂存区注释检查通过。")
        return 0

    print("Python 暂存区注释检查发现以下问题：", file=sys.stderr)
    for finding in findings:
        print(
            f"{finding.path}:{finding.line}: [{finding.rule}] {finding.detail}",
            file=sys.stderr,
        )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
