"""检查源码文档引用及 Markdown 行内代码中的具体仓库路径。

用法：python scripts/docs/verify_doc_refs.py [--json] [源码目录]
按文本扫描注释和字符串中的 .md 路径；不执行代码、不检查锚点。
源码中的 docs 路径相对于最近的 pnpm 工作区；无工作区时相对于仓库根目录。
@author 李杰
"""

from __future__ import annotations

import ast
import io
import re
import sys
import tokenize
from pathlib import Path
from urllib.parse import unquote

# 直接按文件路径运行时定位工具所属仓库，不依赖调用者的当前目录。
if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.common.quality_common import Finding, discover, entry, parser, read_text, report
from scripts.docs.document_support import load_rules
from scripts.docs.markdown_support import tokenize_markdown

# 引号及代码分隔符界定路径；允许中文、空格和百分号编码。
DOC_REFERENCE = re.compile(
    r"(?<![\w./\\-])(?:docs/|\.agents/(?:notes|skills)/)"
    r"[^\r\n\"'`<>|{}*?]*?\.md(?=$|[\s\"'`<>),;:#\]])"
)
EXTENSIONS = {".java", ".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue"}


def _fixture_strings(source: str) -> list[tuple[tuple[int, int], tuple[int, int]]]:
    """识别 Python 测试函数及其装饰器的样例字符串，保留 Docstring 和注释检查。"""
    try:
        tree = ast.parse(source)
        test_ranges = []
        docstrings = set()
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if node.name.startswith(("test_", "_test_")) or node.name == "_run_self_test":
                    # 参数化样例位于 def 之前，必须将装饰器范围归入所属测试。
                    start = min([node.lineno, *(item.lineno for item in node.decorator_list)])
                    test_ranges.append((start, node.end_lineno))
                if node.body and isinstance(node.body[0], ast.Expr):
                    value = node.body[0].value
                    if isinstance(value, ast.Constant) and isinstance(value.value, str):
                        docstrings.add((value.lineno, value.col_offset))
        return [
            (token.start, token.end)
            for token in tokenize.generate_tokens(io.StringIO(source).readline)
            if token.type == tokenize.STRING
            and token.start not in docstrings
            and any(start <= token.start[0] <= end for start, end in test_ranges)
        ]
    except (SyntaxError, tokenize.TokenError):
        # 语法错误不能使文本引用检查静默缺失，保留原始扫描行为。
        return []


def _source_docs_root(root: Path, source_path: Path) -> Path:
    """确定源码文档路径所属的 pnpm 工作区，无标记时保留仓库根语义。

    Args:
        root: 已解析的仓库根目录，限制向上搜索范围。
        source_path: 仓库内被检查的源码文件。
    Returns:
        最近含 pnpm-workspace.yaml 的祖先目录，否则返回仓库根目录。
        仅检查标记存在性，不读取或执行包配置。
    """
    for directory in source_path.parents:
        if not directory.is_relative_to(root):
            break
        if (directory / "pnpm-workspace.yaml").is_file():
            return directory
    return root


def collect(root: Path, paths: list[str]) -> tuple[int, list[Finding]]:
    """核对文本中的具体文档引用；含模板占位符的内容不视为文件路径。

    Args:
        root: 仓库根目录。
        paths: 源码或 Markdown 文件与目录，空列表表示发现全部支持的文件。
    Returns:
        检查的源码数与失效引用，诊断行号对应实际匹配位置。
    """
    files = discover(root, EXTENSIONS | {".md"}, paths)
    rules = load_rules(root)
    findings: list[Finding] = []
    for path in files:
        source = read_text(path)
        if path.suffix.lower() == ".md":
            findings.extend(
                markdown_paths(root, path, source, rules.path_prefixes, rules.path_placeholders)
            )
            continue
        fixtures = _fixture_strings(source) if path.suffix == ".py" else []
        docs_root = _source_docs_root(root, path)
        for number, line in enumerate(source.splitlines(), 1):
            for match in DOC_REFERENCE.finditer(line):
                if any(start <= (number, match.start()) < end for start, end in fixtures):
                    continue
                reference = unquote(match[0])
                # 前端各有独立 docs；不借用其他工作区或仓库同名文件掩盖缺失。
                base = docs_root if reference.startswith("docs/") else root
                target = (base / reference).resolve()
                if not target.is_relative_to(base) or not target.is_file():
                    findings.append(
                        Finding(
                            path.relative_to(root).as_posix(),
                            number,
                            "doc-ref",
                            f"文档目标不存在或越界：{reference}",
                        )
                    )
    return len(files), findings


def markdown_paths(
    root: Path, path: Path, source: str, prefixes: tuple[str, ...], placeholders: tuple[str, ...]
) -> list[Finding]:
    """检查完整行内代码路径；忽略围栏、占位符、通配符和命令片段。

    Args:
        root: 已解析的仓库根目录，不读取仓库外引用目标。
        path: 当前 Markdown 文件。
        source: 完整正文，代码示例由 Markdown 解析器隔离。
        prefixes: 配置中的仓库根相对路径前缀，支持中文与反斜杠。
        placeholders: 明确表示样例的路径分段，不包含实际业务文件名。
    Returns:
        不存在或越界的具体文件、目录引用，行号定位到所在语法块。
    """
    tokens, _ = tokenize_markdown(source)
    findings: list[Finding] = []
    for token in tokens:
        if token.type != "inline" or not token.map:
            continue
        for child in token.children or []:
            if child.type != "code_inline":
                continue
            try:
                reference = unquote(child.content, errors="strict").replace("\\", "/")
            except UnicodeError:
                reference = child.content.replace("\\", "/")
            reference = reference.removeprefix("./")
            if re.search(r"\s+--?[A-Za-z]", reference) or any(
                Path(part).stem in placeholders for part in reference.split("/")
            ):
                continue
            if not reference.startswith(prefixes) or re.search(r"[<>{}*?\n]|\.\.\.|…", reference):
                continue
            # 行号与锚点只用于导航，不属于路径；空格仍可属于中文文件名。
            reference = re.sub(r":\d+(?::\d+)?$", "", reference.split("#", 1)[0])
            target = (root / reference).resolve()
            if not target.is_relative_to(root) or not target.exists():
                findings.append(
                    Finding(
                        path.relative_to(root).as_posix(),
                        token.map[0] + 1,
                        "doc-path",
                        f"仓库路径不存在或越界：{reference}",
                    )
                )
    return findings


def main() -> int:
    """按所选源码范围运行只读文档引用检查。"""
    args = parser(__doc__).parse_args()
    count, findings = collect(args.root.resolve(), args.paths)
    return report("文档路径与源码引用", count, findings, as_json=args.json)


if __name__ == "__main__":
    raise SystemExit(entry(main))
