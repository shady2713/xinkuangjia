"""检查 Markdown 中禁用的旧标识、技能名称和历史目录引用。

用法：python -B scripts/docs/verify_doc_policy.py [--json] [路径]
规则位于 scripts/tools/document_rules.py；活动笔记及需求卡来源字段可按约定引用记录。
@author 李杰
"""

import html
import re
import sys
import unicodedata
from pathlib import Path
from urllib.parse import unquote

# 直接按文件路径运行时定位工具所属仓库，不依赖调用者的当前目录。
if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.common.quality_common import Finding, discover, entry, parser, read_text, report
from scripts.docs.document_support import Rules, load_rules
from scripts.docs.markdown_support import parse, tokenize_markdown


def canonical(text: str) -> str:
    """规范 URL 编码、HTML 实体和兼容字符；不执行转义文本或访问 URL。"""
    for _ in range(3):
        value = html.unescape(unquote(text, errors="replace"))
        if value == text:
            break
        text = value
    return unicodedata.normalize("NFKC", text).replace("\\", "/").casefold()


def requirement_sources(root: Path, path: Path, source: str) -> dict[int, tuple[set[str], str]]:
    """识别需求来源中的活动记录链接，返回行号对应的允许目标及移除链接后的正文。

    Args:
        root: 当前检查视图的根目录，可为提交钩子的暂存快照。
        path: 待检查的需求文档路径，仅接受 docs/需求卡 下的 Markdown。
        source: UTF-8 正文；来源字段必须是独立的单行顶层段落。
    Returns:
        已验证目标与章节的链接集合及剩余正文；其他文字仍接受禁用引用检查。
    Raises:
        CheckError: Markdown 依赖缺失或目标文件无法按 UTF-8 读取。
    """
    relative = path.relative_to(root).as_posix()
    if not relative.startswith("docs/需求卡/") or path.name in {"README.md", "AGENTS.md"}:
        return {}
    tokens, _ = tokenize_markdown(source)
    allowed: dict[int, tuple[set[str], str]] = {}
    lines = source.splitlines()
    for index, token in enumerate(tokens):
        # 只识别真实正文段落；标题、引用、代码和多行段落不能借用字段前缀。
        if (
            token.type != "inline"
            or not token.map
            or token.map[1] != token.map[0] + 1
            or index == 0
            or tokens[index - 1].type != "paragraph_open"
            or tokens[index - 1].level != 0
        ):
            continue
        line = lines[token.map[0]]
        children = token.children or []
        if not line.startswith("需求来源：") or any(
            child.type in {"code_inline", "html_inline", "image"} for child in children
        ):
            continue
        urls = {
            canonical(child.attrGet("href") or "")
            for child in children
            if child.type == "link_open"
        }
        accepted: set[str] = set()
        residual = line
        # 仅移除已解析且通过验证的内联链接，行内其他路径不能随字段一并放行。
        for match in reversed(list(re.finditer(r"(?<![!\\])\[[^\]\n]+\]\(([^()\s]+)\)", line))):
            url = match[1]
            if canonical(url) not in urls:
                continue
            base, separator, fragment = html.unescape(url).partition("#")
            if not separator or not fragment or re.match(r"^(?:[a-zA-Z][a-zA-Z\d+.-]*:|/)", base):
                continue
            target = (path.parent / unquote(base)).resolve()
            if not target.is_relative_to(root):
                continue
            target_relative = target.relative_to(root).as_posix()
            if (
                not target_relative.startswith(".agents/notes/implemented/process/")
                or target.suffix != ".md"
                or not target.is_file()
            ):
                continue
            target_source = read_text(target)
            if (
                not re.search(r"^状态：已实现\s*$", target_source, re.M)
                or unquote(fragment) not in parse(target_source).anchors
            ):
                continue
            accepted.add(canonical(url))
            residual = residual[: match.start(1)] + residual[match.end(1) :]
        if accepted:
            allowed[token.map[0] + 1] = (accepted, residual)
    return allowed


def validate(
    root: Path, path: Path, source: str, rules: Rules, skill_suffixes: set[str]
) -> list[Finding]:
    """核验正文和路径中的已禁用引用；只读解析，绝不访问外部链接。

    Args:
        root: 仓库根目录。
        path: 当前 Markdown 路径。
        source: 完整 Markdown，禁用标识在代码示例和注释中也检查。
        rules: 字面量配置中明确维护的禁用规则。
        skill_suffixes: 当前技能的名称后缀，用于区分旧技能名和普通产品标识。
    Returns:
        去重后的问题；活动笔记互引和有效需求来源链接按各自边界放行。
    """
    relative = path.relative_to(root).as_posix()
    findings: list[Finding] = []
    note = relative.startswith(".agents/notes/")
    sources = requirement_sources(root, path, source) if not note else {}
    for number, line in enumerate([relative, *source.splitlines()]):
        normalized = canonical(line)
        for term in rules.forbidden_terms:
            if canonical(term) in normalized:
                findings.append(
                    Finding(relative, max(number, 1), "doc-policy-term", f"含已禁用标识：{term}")
                )
        for name in rules.forbidden_skill_names:
            if re.search(r"(?<![a-z0-9_-])" + re.escape(name) + r"(?![a-z0-9_-])", normalized):
                findings.append(
                    Finding(relative, max(number, 1), "doc-policy-skill", f"含旧技能名称：{name}")
                )
        for prefix in rules.forbidden_skill_prefixes:
            for match in re.finditer(
                r"(?<![a-z0-9_-])" + re.escape(prefix) + r"([a-z0-9]+(?:-[a-z0-9]+)*)", normalized
            ):
                before = normalized[: match.start()]
                if match[1] in skill_suffixes or before.endswith((".agents/skills/", "$")):
                    findings.append(
                        Finding(
                            relative,
                            max(number, 1),
                            "doc-policy-skill",
                            f"含旧技能名称：{match[0]}",
                        )
                    )
        if not note and any(
            canonical(directory).rstrip("/") in canonical(sources.get(number, (set(), line))[1])
            for directory in rules.forbidden_reference_dirs
        ):
            findings.append(
                Finding(
                    relative,
                    max(number, 1),
                    "doc-policy-reference",
                    "普通文档不能引用已禁用的历史记录目录",
                )
            )
    if not note:
        for destination in parse(source).destinations:
            url = canonical(destination.url)
            if url in sources.get(destination.line, (set(), ""))[0]:
                continue
            if re.match(r"^[a-z][a-z0-9+.-]*:", url) or url.startswith("//"):
                continue
            target = (path.parent / url.split("#", 1)[0]).resolve()
            if target.is_relative_to(root):
                reference = target.relative_to(root).as_posix().casefold()
                if any(
                    reference == directory.rstrip("/").casefold()
                    or reference.startswith(directory.casefold().rstrip("/") + "/")
                    for directory in rules.forbidden_reference_dirs
                ):
                    findings.append(
                        Finding(
                            relative,
                            destination.line,
                            "doc-policy-reference",
                            "相对链接指向已禁用的历史记录目录",
                        )
                    )
    # 同一位置的原文路径与解析链接只报告一次，避免放大问题数量。
    unique = {
        (item.line, item.rule, item.message if item.rule != "doc-policy-reference" else ""): item
        for item in findings
    }
    return list(unique.values())


def collect(root: Path, paths: list[str]) -> tuple[int, list[Finding]]:
    """扫描维护中的 Markdown；沿用固定排除范围，返回对象数和规则问题。"""
    rules = load_rules(root)
    folder = root / ".agents/skills"
    suffixes = (
        {
            item.name.removeprefix("weetion-")
            for item in folder.iterdir()
            if item.is_dir() and item.name.startswith("weetion-")
        }
        if folder.is_dir()
        else set()
    )
    for name in rules.forbidden_skill_names:
        for prefix in ("weetion-", *rules.forbidden_skill_prefixes):
            if name.startswith(prefix):
                suffixes.add(name.removeprefix(prefix))
    files = discover(root, {".md"}, paths)
    findings = []
    for path in files:
        findings.extend(validate(root, path, read_text(path), rules, suffixes))
    return len(files), findings


def main() -> int:
    """按统一命令行契约输出禁用引用的路径与行号。"""
    args = parser(__doc__).parse_args()
    count, findings = collect(args.root.resolve(), args.paths)
    return report("文档禁用引用", count, findings, as_json=args.json)


if __name__ == "__main__":
    raise SystemExit(entry(main))
