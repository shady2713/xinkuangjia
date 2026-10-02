"""检查 Agent Note 分类及日期命名，不创建目录或改写历史笔记。

用法：python scripts/docs/verify_agent_note_classification.py [笔记目录]
@author 李杰
"""

import sys
from pathlib import Path

# 直接按文件路径运行时定位工具所属仓库，不依赖调用者的当前目录。
if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.common.quality_common import entry, parser, report
from scripts.docs.agent_note_support import collect_notes


def main() -> int:
    """运行活动笔记目录检查并保留明确的检查计数。"""
    args = parser(__doc__).parse_args()
    notes, findings = collect_notes(args.root.resolve(), args.paths)
    return report("笔记分类", len(notes) + len(findings), findings, as_json=args.json)


if __name__ == "__main__":
    raise SystemExit(entry(main))
