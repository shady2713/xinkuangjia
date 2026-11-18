"""验证仓库 Python 工具坏味道门禁、前端工作区清单接入与全仓文本卫生检查。

把确定性坏味道检查接入既有 pytest 门禁，并提供正反例回归测试。
@author shady2713
"""

from __future__ import annotations

import ast
import importlib.util
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from scripts.common.quality_common import DEFAULT_ROOT

TEXT_EXTENSIONS = frozenset(
    {
        ".java",
        ".xml",
        ".sql",
        ".yml",
        ".yaml",
        ".properties",
        ".ts",
        ".tsx",
        ".js",
        ".mjs",
        ".cjs",
        ".vue",
        ".py",
        ".md",
        ".sh",
        ".ps1",
    }
)
CONFLICT_PREFIXES = ("<" * 7 + " ", ">" * 7 + " ")


@dataclass(frozen=True)
class SlopFinding:
    """记录单条确定性坏味道命中的相对路径、一基行号与规则标识。"""

    path: str
    line: int
    rule: str
    detail: str


def _has_comment_in_range(lines: list[str], start_line: int, end_line: int) -> bool:
    """判断一基行号闭区间内是否包含显式井号说明注释。"""
    upper = min(len(lines), max(start_line, end_line))
    for index in range(max(1, start_line) - 1, upper):
        if "#" in lines[index]:
            return True
    return False


def _is_trivial_handler_body(body: list[ast.stmt]) -> bool:
    """判断异常处理体是否仅由 pass 或省略号字面量构成。"""
    if not body:
        return True
    for stmt in body:
        if isinstance(stmt, ast.Pass):
            continue
        if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant) and stmt.value.value is Ellipsis:
            continue
        return False
    return True


def _extract_skip_reason(call: ast.Call) -> str | None:
    """提取 pytest skip 调用或装饰器中的原因文本；未提供有效原因时返回 None。"""
    for keyword in call.keywords:
        if keyword.arg == "reason":
            if isinstance(keyword.value, ast.Constant) and isinstance(keyword.value.value, str):
                text = keyword.value.value.strip()
                return text if text else None
            return "<dynamic>"
    if call.args:
        first = call.args[0]
        if isinstance(first, ast.Constant) and isinstance(first.value, str):
            text = first.value.strip()
            return text if text else None
        return "<dynamic>"
    return None


def _is_pytest_skip_decorator(node: ast.expr) -> tuple[bool, str | None]:
    """识别无条件 pytest.mark.skip 装饰器并校验其是否声明了非空原因。"""
    target = node.func if isinstance(node, ast.Call) else node
    if (
        isinstance(target, ast.Attribute)
        and target.attr == "skip"
        and isinstance(target.value, ast.Attribute)
        and target.value.attr == "mark"
        and isinstance(target.value.value, ast.Name)
        and target.value.value.id == "pytest"
    ):
        if isinstance(node, ast.Call):
            return True, _extract_skip_reason(node)
        return True, None
    return False, None


def scan_python_source(source: str, relative_path: str) -> list[SlopFinding]:
    """使用 AST 检查单个 Python 源码中的裸异常、静默吞异常、残留断点与无理由跳过。

    Args:
        source: UTF-8 解码后的 Python 源码文本。
        relative_path: 用于诊断展示的相对路径。
    Returns:
        按行号排序的坏味道命中列表。
    """
    tree = ast.parse(source, filename=relative_path)
    lines = source.splitlines()
    findings: list[SlopFinding] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.ExceptHandler):
            if node.type is None:
                findings.append(
                    SlopFinding(relative_path, node.lineno, "bare-except", "禁止使用未限定异常类型的裸 except:")
                )
            elif _is_trivial_handler_body(node.body):
                end_line = getattr(node, "end_lineno", node.lineno) or node.lineno
                if not _has_comment_in_range(lines, node.lineno, end_line):
                    findings.append(
                        SlopFinding(
                            relative_path,
                            node.lineno,
                            "silent-except-pass",
                            "禁止无注释说明的静默异常吞没（except ...: pass）",
                        )
                    )
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id == "breakpoint":
                findings.append(
                    SlopFinding(relative_path, node.lineno, "debug-breakpoint", "禁止提交残留的 breakpoint() 调试断点")
                )
            elif (
                isinstance(node.func, ast.Attribute)
                and node.func.attr == "set_trace"
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id in {"pdb", "ipdb"}
            ):
                findings.append(
                    SlopFinding(relative_path, node.lineno, "debug-breakpoint", "禁止提交残留的 set_trace() 调试断点")
                )
            elif (
                isinstance(node.func, ast.Attribute)
                and node.func.attr == "skip"
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id == "pytest"
                and _extract_skip_reason(node) is None
            ):
                findings.append(
                    SlopFinding(
                        relative_path,
                        node.lineno,
                        "unexplained-pytest-skip",
                        "pytest.skip 必须提供非空跳过原因",
                    )
                )
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            for decorator in node.decorator_list:
                matched, reason = _is_pytest_skip_decorator(decorator)
                if matched and reason is None:
                    findings.append(
                        SlopFinding(
                            relative_path,
                            decorator.lineno,
                            "unexplained-pytest-skip",
                            "@pytest.mark.skip 必须提供非空 reason 说明",
                        )
                    )

    return sorted(findings, key=lambda item: (item.line, item.rule))


def scan_text_hygiene(content: str, relative_path: str) -> list[SlopFinding]:
    """检查文本文件中的合并冲突标记残留与编码损坏替换符。

    Args:
        content: UTF-8 解码后的文本内容。
        relative_path: 用于报告定位的相对路径。
    Returns:
        命中的冲突标记或乱码替换符列表。
    """
    findings: list[SlopFinding] = []
    for line_number, line in enumerate(content.splitlines(), 1):
        if "\ufffd" in line:
            findings.append(
                SlopFinding(relative_path, line_number, "replacement-char", "文件存在 U+FFFD 编码损坏替换字符")
            )
        if line.startswith(CONFLICT_PREFIXES):
            findings.append(
                SlopFinding(relative_path, line_number, "merge-conflict-marker", "文件存在未解决的 Git 合并冲突标记")
            )
    return findings


def _tracked_files(root: Path) -> list[Path]:
    """读取当前仓库全部已跟踪文件路径，跳过已被工作区删除的路径。"""
    output = subprocess.check_output(
        ["git", "-c", "core.quotepath=false", "ls-files", "-z"],
        cwd=root,
        timeout=30,
    )
    paths: list[Path] = []
    for raw in output.split(b"\0"):
        if not raw:
            continue
        candidate = root / raw.decode("utf-8")
        if candidate.is_file():
            paths.append(candidate)
    return sorted(paths)


def test_repository_python_scripts_have_no_slop_patterns() -> None:
    """仓库质量脚本与前端Python工具不得包含裸异常、静默吞异常、断点或无理由跳过。"""
    roots = (
        DEFAULT_ROOT / "scripts",
        DEFAULT_ROOT / "前端代码" / "basic-framework-admin" / "scripts",
        DEFAULT_ROOT / ".agents" / "skills",
    )
    checked = 0
    findings: list[SlopFinding] = []
    for directory in roots:
        if not directory.is_dir():
            continue
        for path in sorted(directory.rglob("*.py")):
            if "__pycache__" in path.parts:
                continue
            checked += 1
            relative = path.relative_to(DEFAULT_ROOT).as_posix()
            findings.extend(scan_python_source(path.read_text(encoding="utf-8"), relative))
    assert checked > 0
    assert findings == []


def test_python_slop_rules_reject_bad_samples() -> None:
    """故意引入裸 except、静默 pass、断点与无理由 skip 时检查必须失败。"""
    bad_source = (
        "import pdb\n"
        "import pytest\n\n"
        "@pytest.mark.skip\n"
        "def test_skipped():\n"
        "    pass\n\n"
        "def sample():\n"
        "    breakpoint()\n"
        "    pdb.set_trace()\n"
        "    try:\n"
        "        sample()\n"
        "    except:\n"
        "        return 1\n"
        "    try:\n"
        "        sample()\n"
        "    except ValueError:\n"
        "        pass\n"
        "    pytest.skip('')\n"
    )
    findings = scan_python_source(bad_source, "bad_sample.py")
    assert [item.rule for item in findings] == [
        "unexplained-pytest-skip",
        "debug-breakpoint",
        "debug-breakpoint",
        "bare-except",
        "silent-except-pass",
        "unexplained-pytest-skip",
    ]

    clean_source = (
        "import pytest\n\n"
        "@pytest.mark.skip(reason='等待外部夹具准备')\n"
        "def test_documented_skip():\n"
        "    try:\n"
        "        int('x')\n"
        "    except ValueError:\n"
        "        # 预期格式错误时安全忽略\n"
        "        pass\n"
    )
    assert scan_python_source(clean_source, "clean_sample.py") == []


def test_frontend_workspace_constraints_pass_in_ci() -> None:
    """将管理前端工作区与 catalog 约束检查接入既有 pytest 门禁。"""
    frontend_root = DEFAULT_ROOT / "前端代码" / "basic-framework-admin"
    script_path = frontend_root / "scripts" / "quality" / "verify_workspace_constraints.py"
    spec = importlib.util.spec_from_file_location("verify_workspace_constraints_gate", script_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    report = module.inspect(frontend_root)
    assert report["code"] == 0, report


def test_tracked_files_have_no_conflict_markers_or_replacement_chars() -> None:
    """全仓已跟踪源码与文档不得残留合并冲突标记或 U+FFFD 乱码替换符。"""
    findings: list[SlopFinding] = []
    checked = 0
    for path in _tracked_files(DEFAULT_ROOT):
        if path.suffix.lower() not in TEXT_EXTENSIONS:
            continue
        checked += 1
        relative = path.relative_to(DEFAULT_ROOT).as_posix()
        content = path.read_text(encoding="utf-8", errors="replace")
        findings.extend(scan_text_hygiene(content, relative))
    assert checked > 0
    assert findings == []


def test_text_hygiene_rejects_conflict_markers_and_replacement_char() -> None:
    """故意注入冲突标记与 U+FFFD 替换符时检查必须准确报出位置。"""
    sample = "正常文本\n" + "<" * 7 + " HEAD\n损坏\ufffd字符\n" + ">" * 7 + " feature\n"
    findings = scan_text_hygiene(sample, "sample.md")
    assert [(item.line, item.rule) for item in findings] == [
        (2, "merge-conflict-marker"),
        (3, "replacement-char"),
        (4, "merge-conflict-marker"),
    ]
