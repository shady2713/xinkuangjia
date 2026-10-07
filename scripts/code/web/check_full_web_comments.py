#!/usr/bin/env python3
"""对全部纳管 Web 源码执行注释检查，覆盖增量门禁看不到的历史欠账。

增量入口只覆盖本次改动涉及的声明，干净检出上的「零对象」不能证明全库注释合格。
本入口复用增量入口的同一套规则实现（`collect(..., full=True)`），不新增第二套判定：
同一批 Web 受管文件的全部声明都作为检查对象，规则失败直接以退出码 1 阻断。

零对象不是通过：全量范围下「没有适用对象」意味着范围被意外清空或枚举失败，
按环境错误受控失败（退出码 2），绝不让空范围冒充全库合格。
缺少 Node 运行时或前端依赖时同样按环境错误失败，不记为通过。

用法：python scripts/code/web/check_full_web_comments.py [--json] [文件或目录...]

@author 李杰
"""

from __future__ import annotations

import sys
from pathlib import Path

# 直接按文件路径运行时定位工具所属仓库，不依赖调用者的当前目录。
if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scripts.code.web.check_worktree_web_comments import collect
from scripts.common.quality_common import Finding, CheckError, entry, parser, report

# 全量范围下的最小对象量门限：低于该量说明枚举范围异常，不计为通过。
MINIMUM_CHECKED = 1


def scan_all_web_comments(
    paths: list[str] | None = None, root: Path | None = None
) -> tuple[int, list[Finding]]:
    """把全部受管 Web 文件的全部声明交给与增量入口相同的规则实现。

    Args:
        paths: 可选的仓库相对文件或目录；为空时检查整个仓库的受管 Web 文件集。
        root: 待检查仓库根目录；省略时使用本工具所属仓库。
    Returns:
        实际检查的 Web 文件数与该范围内的全部注释、语法诊断。
    Raises:
        CheckError: 显式目标不存在或越界、文件无法严格按 UTF-8 读取、
            Node 运行时或前端依赖缺失，或全量范围下枚举不到任何适用对象。
    """
    repository = (root or Path(__file__).resolve().parents[3]).resolve()
    checked, findings = collect(repository, paths or [], full=True)
    if checked < MINIMUM_CHECKED:
        raise CheckError(
            f"Web 全量注释检查没有枚举到任何受管 Web 文件（要求至少 {MINIMUM_CHECKED} 个），"
            "范围为空不能证明全库注释合格"
        )
    return checked, findings


def main() -> int:
    """按统一诊断协议输出全量 Web 注释结果。

    Returns:
        没有规则问题时返回 0，存在规则问题时返回 1，环境或范围异常时返回 2。
    """
    arguments = parser(__doc__)
    args = arguments.parse_args()
    checked, findings = scan_all_web_comments(args.paths, args.root)
    return report("Web 全量注释", checked, findings, as_json=args.json)


if __name__ == "__main__":
    raise SystemExit(entry(main))