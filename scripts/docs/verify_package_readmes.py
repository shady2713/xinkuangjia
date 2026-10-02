"""按项目中文模板检查包 README 的元数据、章节和结构。

用法：python -B scripts/docs/verify_package_readmes.py [--json] [路径]
按相邻包清单或明确登记识别包；模型交互适用清单维护在 scripts/tools/document_rules.py。
@author 李杰
"""

import re
import sys
from pathlib import Path

# 直接按文件路径运行时定位工具所属仓库，不依赖调用者的当前目录。
if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.common.quality_common import Finding, discover, entry, parser, read_text, report
from scripts.docs.document_support import (
    Rules,
    inspect_folds,
    load_rules,
    matches,
    package_readme,
    section_body,
    structure_findings,
)
from scripts.docs.markdown_support import parse, tokenize_markdown
from scripts.skills.verify_skill_metadata import frontmatter


def validate(source: str, relative: str, rules: Rules) -> list[Finding]:
    """核验一个已识别的包 README，不推断说明文字是否真实充分。

    Args:
        source: README 全文，代码围栏不构成页面章节。
        relative: 仓库相对路径，用于模型适用清单和诊断。
        rules: 经校验的项目规则。
    Returns:
        元数据、必需内容、顺序、模板结构问题；不会执行示例或改写文件。
    """
    findings: list[Finding] = []
    try:
        metadata = frontmatter(source)
    except ValueError as exc:
        message = str(exc).replace("SKILL.md", "包 README")
        return [Finding(relative, 1, "readme-metadata", message)]
    for key in ("description", "kind"):
        if not isinstance(metadata.get(key), str) or not metadata[key].strip():
            findings.append(Finding(relative, 1, "readme-metadata", f"{key} 必须是非空字符串"))
    kind = metadata.get("kind")
    if not isinstance(kind, str) or kind not in rules.readme_sections:
        findings.append(Finding(relative, 1, "readme-kind", "kind 必须是文档规范登记的单一类别"))
        return findings
    document = parse(source)
    tokens, _ = tokenize_markdown(source)
    top_lines = {
        token.map[0] + 1
        for token in tokens
        if token.type == "heading_open" and token.level == 0 and token.map
    }
    headings = [item for item in document.headings if item[0] == 2 and item[2] in top_lines]
    titles = [item[1] for item in headings]
    positions: list[int] = []
    for required in rules.readme_sections[kind]:
        matches_heading = [item for item in headings if item[1] == required]
        if len(matches_heading) != 1:
            findings.append(
                Finding(relative, 1, "readme-section", f"必须有且只有一个 H2 {required}")
            )
            continue
        heading = matches_heading[0]
        positions.append(heading[2])
        body = section_body(source, heading)
        # 限制章节的开发笔记不等于限制说明；空标题不能满足契约。
        if required == "已知限制与暂缓工作":
            folds = inspect_folds(body)
            body_tokens, _ = tokenize_markdown(body)
            # 可选笔记可位于章节中间；去除标题与折叠后仍须有可见限制说明。
            heading_lines = {
                number
                for token in body_tokens
                if token.type == "heading_open" and token.map
                for number in range(token.map[0] + 1, token.map[1] + 1)
            }
            body = "\n".join(
                line
                for number, line in enumerate(body.splitlines(), 1)
                if number not in heading_lines
                and not any(start <= number <= end for start, end in folds.spans)
            )
        visible = parse(body)
        meaningful = re.sub(r"<!--.*?-->|<[^>]+>", "", body, flags=re.S).strip().strip("- \n")
        if not meaningful or not any(
            line.strip() and not line.strip().startswith(("<a ", "<!--", "-----"))
            for line in meaningful.splitlines()
        ):
            findings.append(
                Finding(relative, heading[2], "readme-content", f"{required}缺少正文说明")
            )
        if required == "目录" and not visible.destinations:
            findings.append(Finding(relative, heading[2], "readme-toc", "目录必须包含可点击链接"))
    if positions != sorted(positions):
        findings.append(Finding(relative, 1, "readme-order", "必需章节顺序与 kind 模板不一致"))
    if kind in rules.runtime_kinds:
        limit = (
            titles.index("已知限制与暂缓工作") if "已知限制与暂缓工作" in titles else len(titles)
        )
        if limit == len(titles) or any(title != "开发笔记" for title in titles[limit + 1 :]):
            findings.append(
                Finding(
                    relative, 1, "readme-order", "已知限制与暂缓工作必须是最后一个非开发笔记 H2"
                )
            )
        for title in ("深入探索", "模型体验"):
            if title in titles and titles.index(title) >= limit:
                findings.append(
                    Finding(relative, 1, "readme-order", f"{title}必须位于限制章节之前")
                )
        if matches(relative, rules.model_readmes) and "模型体验" not in titles:
            findings.append(
                Finding(relative, 1, "readme-model", "已登记模型交互的包必须提供模型体验说明")
            )
        for heading in headings:
            if heading[1] == "模型体验" and not section_body(source, heading).strip().strip("- \n"):
                findings.append(
                    Finding(relative, heading[2], "readme-model", "模型体验缺少实际影响说明")
                )
    elif kind == "package-group" and any(
        title in titles for title in ("模型体验", "已知限制与暂缓工作")
    ):
        findings.append(
            Finding(relative, 1, "readme-group", "包组导览不承担模型体验或运行时限制章节")
        )
    findings.extend(structure_findings(source, relative, rules))
    return findings


def collect(root: Path, paths: list[str]) -> tuple[int, list[Finding]]:
    """按包清单及登记发现 README，返回实际检查数，不要求所有目录创建 README。"""
    rules = load_rules(root)
    findings: list[Finding] = []
    count = 0
    for path in discover(root, {".md"}, paths):
        relative = path.relative_to(root).as_posix()
        if matches(relative, rules.structure_exclusions):
            continue
        source = read_text(path)
        if package_readme(path, root, source, rules):
            count += 1
            findings.extend(validate(source, relative, rules))
    return count, findings


def main() -> int:
    """运行 README 检查，使用统一的参数、JSON 输出及失败状态。"""
    args = parser(__doc__).parse_args()
    count, findings = collect(args.root.resolve(), args.paths)
    return report("包 README", count, findings, as_json=args.json)


if __name__ == "__main__":
    raise SystemExit(entry(main))
