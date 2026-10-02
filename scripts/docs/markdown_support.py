"""提供 Markdown 语法树、链接、锚点和围栏提取，不把代码示例当作正文。

由文档检查入口加载，依赖 requirements.txt 中的 markdown-it-py。
@author 李杰
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import TYPE_CHECKING, Any, Iterator

from scripts.common.quality_common import CheckError

if TYPE_CHECKING:
    from markdown_it.token import Token


@dataclass(frozen=True)
class Destination:
    """记录链接目标及其所在 Markdown 块或引用定义的一基行号。"""

    url: str
    line: int


@dataclass(frozen=True)
class Fence:
    """记录围栏语言、正文与正文起始的一基行号。"""

    language: str
    content: str
    line: int


@dataclass(frozen=True)
class Markdown:
    """保存检查所需的 Markdown 事实，不渲染或执行 HTML。"""

    anchors: frozenset[str]
    destinations: tuple[Destination, ...]
    fences: tuple[Fence, ...]
    headings: tuple[tuple[int, str, int], ...]


class _AnchorParser(HTMLParser):
    """只收集实际 HTML 中的 a[id]，自动忽略 HTML 注释。"""

    def __init__(self) -> None:
        """初始化本次片段的锚点集合，不执行脚本或读取外部资源。"""
        super().__init__(convert_charrefs=True)
        self.anchors: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """保留 a 标签中的显式 id，其大小写具有区分意义。"""
        if tag == "a":
            self.anchors.update(value for key, value in attrs if key == "id" and value is not None)


def _children(tokens: list[Token]) -> Iterator[Token]:
    """递归访问解析器令牌，覆盖图片说明内部的令牌。"""
    for token in tokens:
        yield token
        if token.children:
            yield from _children(token.children)


def _plain(tokens: list[Token]) -> str:
    """取标题可见文本；保留行内代码和图片说明，去掉格式标记。"""
    return "".join(
        _plain(token.children)
        if token.children
        else token.content
        if token.type in {"text", "code_inline"}
        else " "
        if token.type in {"softbreak", "hardbreak"}
        else ""
        for token in tokens
    )


def slug(text: str) -> str:
    """复现原检查器的 Unicode 标题规则，保留字母数字、空格、下划线和连字符。"""
    allowed = "".join(
        char
        for char in text.lower()
        if char in "_ -" or unicodedata.category(char)[0] in {"L", "N"}
    )
    return allowed.replace(" ", "-")


def tokenize_markdown(source: str) -> tuple[list[Token], dict[str, Any]]:
    """解析正文令牌和引用环境，用空行遮蔽前置元数据以保持诊断行号。

    Args:
        source: 已按 UTF-8 解码的全文。
    Returns:
        Markdown 令牌及第三方解析器的动态引用环境，不执行 HTML。
    Raises:
        CheckError: 未安装 Markdown 解析依赖。
    """
    try:
        from markdown_it import MarkdownIt
    except ImportError as exc:
        raise CheckError("缺少 Markdown 解析器，请安装 tools/quality/requirements.txt") from exc
    # YAML 元数据不属于正文；用空行替换以保留之后的诊断行号。
    source = re.sub(
        r"\A---[^\S\n]*\n.*?\n---[^\S\n]*(?:\n|$)",
        lambda match: "\n" * match[0].count("\n"),
        source,
        count=1,
        flags=re.S,
    )
    engine = MarkdownIt("commonmark", {"html": True}).enable(["table", "strikethrough"])
    # 解析器在 env 中混放引用定义及内部状态，仅在此第三方边界保留动态值。
    environment: dict[str, Any] = {}
    tokens = engine.parse(source, environment)
    return tokens, environment


def parse(source: str) -> Markdown:
    """提取标题、锚点、链接及围栏；输入全文，返回只读事实，不执行示例。"""
    tokens, environment = tokenize_markdown(source)
    anchors: set[str] = set()
    destinations: list[Destination] = []
    fences: list[Fence] = []
    headings: list[tuple[int, str, int]] = []
    for index, token in enumerate(tokens):
        line = token.map[0] + 1 if token.map else 1
        if token.type == "heading_open":
            text = _plain(tokens[index + 1].children or [])
            headings.append((int(token.tag[1:]), text, line))
            base = slug(text)
            anchor = base
            number = 0
            while anchor in anchors:
                number += 1
                anchor = f"{base}-{number}"
            anchors.add(anchor)
        if token.type == "fence":
            fences.append(
                Fence(token.info.split()[0] if token.info.strip() else "", token.content, line + 1)
            )
        for child in _children([token]):
            if child.type in {"link_open", "image"}:
                url = child.attrGet("href" if child.type == "link_open" else "src")
                if url is not None:
                    destinations.append(Destination(url, line))
    # 显式 HTML 锚点不影响标题后缀计数，与原脚本的处理顺序一致。
    html_parser = _AnchorParser()
    for token in _children(tokens):
        if token.type in {"html_inline", "html_block"}:
            html_parser.feed(token.content)
    html_parser.close()
    anchors.update(html_parser.anchors)
    for definition in environment.get("references", {}).values():
        destinations.append(Destination(definition["href"], definition["map"][0] + 1))
    # 引用使用与定义可能指向同一行同一目标，稳定去重而不吞掉不同位置。
    return Markdown(
        frozenset(anchors),
        tuple(dict.fromkeys(destinations)),
        tuple(fences),
        tuple(headings),
    )
