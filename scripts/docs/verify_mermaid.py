"""使用 Mermaid 官方解析器检查 Markdown 图表语法，不生成图片。

用法：python scripts/docs/verify_mermaid.py [docs] [--json]
Python 提取真实围栏，Node 仅解析图表；缺少依赖不能报告通过。
@author 李杰
"""

from __future__ import annotations

import sys
from pathlib import Path

# 直接按文件路径运行时定位工具所属仓库，不依赖调用者的当前目录。
if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.common.node_bridge import invoke
from scripts.common.quality_common import Finding, discover, entry, parser, read_text, report
from scripts.docs.markdown_support import parse


def collect(root: Path, paths: list[str]) -> tuple[int, list[Finding]]:
    """批量提取 Mermaid 围栏并返回解析错误，零图表时明确报告零计数。

    Args:
        root: 仓库根目录。
        paths: Markdown 文件或目录范围。
    Returns:
        实际图表数和定位到围栏正文的语法错误。
    """
    blocks = [
        {"path": path.relative_to(root).as_posix(), "line": fence.line, "source": fence.content}
        for path in discover(root, {".md"}, paths)
        for fence in parse(read_text(path)).fences
        if fence.language.lower() == "mermaid"
    ]
    if not blocks:
        return 0, []
    response = invoke("mermaid", {"blocks": blocks})
    return len(blocks), [Finding(**value) for value in response["findings"]]


def main() -> int:
    """输出图表语法检查结果，不将零图表描述为已解析文件。"""
    args = parser(__doc__).parse_args()
    count, findings = collect(args.root.resolve(), args.paths)
    return report("Mermaid 图表", count, findings, as_json=args.json)


if __name__ == "__main__":
    raise SystemExit(entry(main))
