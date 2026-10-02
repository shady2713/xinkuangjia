"""检查普通 Markdown 中已有开发者章节与开发笔记的折叠结构。

用法：python -B scripts/docs/verify_doc_structure.py [--json] [文档路径]
特殊格式按 scripts/tools/document_rules.py 排除，包 README 由专用入口复用结构检查。
@author 李杰
"""

import sys
from pathlib import Path

# 直接按文件路径运行时定位工具所属仓库，不依赖调用者的当前目录。
if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.common.quality_common import Finding, discover, entry, parser, read_text, report
from scripts.docs.document_support import load_rules, matches, package_readme, structure_findings


def collect(root: Path, paths: list[str]) -> tuple[int, list[Finding]]:
    """检查选中范围内的普通文档，返回实际检查数和问题；不改写文件。"""
    rules = load_rules(root)
    count = 0
    findings: list[Finding] = []
    for path in discover(root, {".md"}, paths):
        relative = path.relative_to(root).as_posix()
        if matches(relative, rules.structure_exclusions):
            continue
        source = read_text(path)
        if package_readme(path, root, source, rules):
            continue
        count += 1
        findings.extend(structure_findings(source, relative, rules))
    return count, findings


def main() -> int:
    """输出普通文档结构问题，沿用公共参数及退出码约定。"""
    args = parser(__doc__).parse_args()
    count, findings = collect(args.root.resolve(), args.paths)
    return report("文档结构", count, findings, as_json=args.json)


if __name__ == "__main__":
    raise SystemExit(entry(main))
