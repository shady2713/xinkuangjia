"""共享文档规则加载、页面分类及折叠结构分析。

规则来自 scripts/tools/document_rules.py，只解析字面量；不执行配置或 HTML。
@author 李杰
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from fnmatch import fnmatchcase
from html.parser import HTMLParser
from pathlib import Path

from scripts.common.quality_common import DEFAULT_ROOT, CheckError, Finding, read_text, safe_path
from scripts.docs.markdown_support import parse, tokenize_markdown
from scripts.skills.verify_skill_metadata import frontmatter


@dataclass(frozen=True)
class Rules:
    """保存已经收窄类型的项目规则，排除原因与路径一起维护。"""

    path_prefixes: tuple[str, ...]
    path_placeholders: tuple[str, ...]
    structure_exclusions: dict[str, str]
    package_manifests: tuple[str, ...]
    package_readmes: tuple[str, ...]
    readme_sections: dict[str, tuple[str, ...]]
    runtime_kinds: tuple[str, ...]
    model_readmes: tuple[str, ...]
    developer_headings: tuple[str, ...]
    forbidden_terms: tuple[str, ...]
    forbidden_skill_prefixes: tuple[str, ...]
    forbidden_skill_names: tuple[str, ...]
    forbidden_reference_dirs: tuple[str, ...]


def load_rules(root: Path) -> Rules:
    """读取仓库规则；外部测试仓库未提供规则时采用工具自带规则。

    Args:
        root: 已解析的待查仓库根目录。
    Returns:
        类型合法的规则对象；不缓存，避免长驻进程使用旧配置。
    Raises:
        CheckError: 文件越界、语法错误、可执行语句、未知字段或非法值。
    """
    relative = "scripts/tools/document_rules.py"
    candidate = root / relative
    path = (
        safe_path(root, relative)
        if candidate.exists() or candidate.is_symlink()
        else DEFAULT_ROOT / relative
    )
    try:
        tree = ast.parse(read_text(path))
        statements = tree.body
        if (
            statements
            and isinstance(statements[0], ast.Expr)
            and isinstance(statements[0].value, ast.Constant)
            and isinstance(statements[0].value.value, str)
        ):
            statements = statements[1:]
        if len(statements) != 1 or not isinstance(statements[0], ast.Assign):
            raise ValueError("只能包含模块说明及 RULES 字面量赋值")
        statement = statements[0]
        if (
            len(statement.targets) != 1
            or not isinstance(statement.targets[0], ast.Name)
            or statement.targets[0].id != "RULES"
        ):
            raise ValueError("必须赋值给 RULES")
        # literal_eval 不执行调用；另外拒绝重复键，避免前一条规则被覆盖。
        for node in ast.walk(statement.value):
            if isinstance(node, ast.Dict):
                keys = [ast.literal_eval(key) for key in node.keys]
                if len(keys) != len(set(keys)):
                    raise ValueError("规则字典含重复键")
        data = ast.literal_eval(statement.value)
        if not isinstance(data, dict) or set(data) != set(Rules.__dataclass_fields__):
            raise ValueError("规则字段缺失或存在未知字段")
        exclusions = data.pop("structure_exclusions")
        if not isinstance(exclusions, dict) or any(
            not isinstance(k, str) or not k or not isinstance(v, str) or not v.strip()
            for k, v in exclusions.items()
        ):
            raise ValueError("结构排除必须是路径模式到非空理由的映射")
        sections = data.pop("readme_sections")
        if (
            not isinstance(sections, dict)
            or not sections
            or any(
                not isinstance(key, str)
                or not key
                or not isinstance(value, list)
                or not value
                or any(not isinstance(title, str) or not title.strip() for title in value)
                for key, value in sections.items()
            )
        ):
            raise ValueError("readme_sections 必须是类别到非空章节列表的映射")
        for key, value in data.items():
            if not isinstance(value, list) or any(
                not isinstance(item, str) or not item.strip() for item in value
            ):
                raise ValueError(f"{key} 必须是非空字符串列表")
        if not set(data["runtime_kinds"]) <= set(sections):
            raise ValueError("runtime_kinds 含未定义类别")
        return Rules(
            structure_exclusions=exclusions,
            readme_sections={key: tuple(value) for key, value in sections.items()},
            **{key: tuple(value) for key, value in data.items()},
        )
    except (SyntaxError, ValueError, TypeError, RecursionError) as exc:
        raise CheckError(f"文档规则配置无效：{exc}") from exc


def matches(path: str, patterns: tuple[str, ...] | dict[str, str]) -> bool:
    """按仓库相对路径匹配显式模式；星号允许跨目录。"""
    return any(fnmatchcase(path, pattern) for pattern in patterns)


def package_readme(path: Path, root: Path, source: str, rules: Rules) -> bool:
    """按包清单、显式登记或 kind 识别 README，不因目录名猜测包类型。"""
    if not path.name.lower().startswith("readme"):
        return False
    if matches(path.relative_to(root).as_posix(), rules.package_readmes):
        return True
    if any((path.parent / name).is_file() for name in rules.package_manifests):
        return True
    try:
        return "kind" in frontmatter(source)
    except ValueError:
        return False


class Folds(HTMLParser):
    """记录真实 details 区间、summary 和隐藏标题，不执行 HTML。"""

    def __init__(self) -> None:
        """创建每篇文档独立的折叠栈及诊断集合。"""
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[int, bool]] = []
        self.spans: list[tuple[int, int]] = []
        self.errors: list[tuple[int, str]] = []
        self.summary_starts: list[int] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """识别折叠起点及摘要，隐藏的 HTML 标题与锚点直接诊断。"""
        line = self.getpos()[0]
        if self.stack and (
            tag in {"h1", "h2", "h3", "h4", "h5", "h6"}
            or tag == "a"
            and any(key == "id" for key, _ in attrs)
        ):
            self.errors.append((line, "章节标题和锚点必须保持在折叠区外"))
        if tag == "details":
            self.stack.append((line, False))
        elif tag == "summary":
            if self.summary_starts:
                self.errors.append((line, "summary 不能嵌套"))
            self.summary_starts.append(line)
            if not self.stack:
                self.errors.append((line, "summary 必须位于 details 内"))
            else:
                start, seen = self.stack[-1]
                if seen:
                    self.errors.append((line, "同一 details 只能包含一个 summary"))
                self.stack[-1] = (start, True)

    def handle_endtag(self, tag: str) -> None:
        """闭合折叠区并拒绝孤立结束标签或缺少摘要的折叠区。"""
        if tag == "summary":
            if self.summary_starts:
                self.summary_starts.pop()
            else:
                self.errors.append((self.getpos()[0], "summary 结束标签没有对应起点"))
            return
        if tag != "details":
            return
        line = self.getpos()[0]
        if not self.stack:
            self.errors.append((line, "details 结束标签没有对应起点"))
            return
        start, seen = self.stack.pop()
        self.spans.append((start, line))
        if not seen:
            self.errors.append((start, "details 缺少 summary"))


def inspect_folds(source: str) -> Folds:
    """用 Markdown 令牌筛选 HTML 后解析，代码围栏和行内代码不参与折叠判断。"""
    tokens, _ = tokenize_markdown(source)
    lines = ["" for _ in source.splitlines()]
    for token in tokens:
        if token.type == "html_block" and token.map:
            for offset, line in enumerate(token.content.splitlines()):
                lines[token.map[0] + offset] = line
        elif token.type == "inline" and token.map:
            # inline 子令牌没有绝对行号，用已消费的换行数定位 HTML。
            number = token.map[0]
            for child in token.children or []:
                if child.type == "html_inline":
                    lines[number] += child.content
                number += child.content.count("\n") + (child.type in {"softbreak", "hardbreak"})
    result = Folds()
    result.feed("\n".join(lines))
    result.close()
    result.errors.extend((start, "details 没有闭合") for start, _ in result.stack)
    result.errors.extend((start, "summary 没有闭合") for start in result.summary_starts)
    return result


def section_body(source: str, heading: tuple[int, str, int]) -> str:
    """返回标题下至同级或更高标题前的正文，保留子节供结构检查。"""
    level, _, start = heading
    tokens, _ = tokenize_markdown(source)
    top_lines = {
        token.map[0] + 1
        for token in tokens
        if token.type == "heading_open" and token.level == 0 and token.map
    }
    end = next(
        (
            line - 1
            for depth, _, line in parse(source).headings
            if line > start and depth <= level and line in top_lines
        ),
        len(source.splitlines()),
    )
    return "\n".join(source.splitlines()[start:end])


def structure_findings(source: str, relative: str, rules: Rules) -> list[Finding]:
    """检查已有开发者章节的折叠结构，不要求分隔线或开发笔记章节。

    Args:
        source: 文档完整 UTF-8 正文。
        relative: 诊断中的仓库相对路径。
        rules: 项目规则，按明确标题识别开发者细节。
    Returns:
        可机械确认的问题；不推断段落语义，不改写正文。
    """
    tokens, _ = tokenize_markdown(source)
    document = parse(source)
    folds = inspect_folds(source)
    lines = source.splitlines()
    findings = [Finding(relative, line, "doc-fold", message) for line, message in folds.errors]
    # 块引用中的样例标题不构成当前页面章节。
    top_lines = {
        token.map[0] + 1
        for token in tokens
        if token.type == "heading_open" and token.level == 0 and token.map
    }
    headings = [item for item in document.headings if item[2] in top_lines]
    separators = {
        token.map[0] + 1
        for token in tokens
        if token.type == "hr" and token.level == 0 and token.map
    }
    for level, title, number in headings:
        if any(start < number <= end for start, end in folds.spans):
            findings.append(Finding(relative, number, "doc-fold", "章节标题必须保持在折叠区外"))
        if title == "开发笔记" or title in rules.developer_headings:
            end = next(
                (line - 1 for depth, _, line in headings if line > number and depth <= level),
                len(lines),
            )
            spans = [(start, stop) for start, stop in folds.spans if number < start <= stop <= end]
            outside = [
                index
                for index in range(number + 1, end + 1)
                if lines[index - 1].strip()
                and not any(start <= index <= stop for start, stop in spans)
                and index not in separators
                and not lines[index - 1].strip().startswith("<a ")
            ]
            if not spans or outside:
                findings.append(
                    Finding(
                        relative,
                        number,
                        "doc-fold",
                        f"{title}正文必须完整放在 details 中，标题保持可见",
                    )
                )
            if title == "开发笔记":
                body = "\n".join(lines[number:end])
                body = re.sub(
                    r"<summary\b[^>]*>.*?</summary>|<!--.*?-->", "", body, flags=re.S | re.I
                )
                body = re.sub(r"<[^>]+>", "", body).strip()
                if not body:
                    findings.append(
                        Finding(
                            relative, number, "doc-note", "开发笔记不能为空；无内容时可省略该章节"
                        )
                    )
    return findings
