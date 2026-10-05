#!/usr/bin/env python3
"""对全部纳管 Java 源码执行注释检查，覆盖增量门禁看不到的历史欠账。

暂存区检查只覆盖本次改动涉及的声明，干净检出上的“零对象”不能证明全库注释
合格。本入口把每个纳管 Java 文件的全部声明交给同一套规则，因此检查对象数
固定等于仓库中的 Java 文件数，规则失败会直接阻断。

用法：python scripts/code/java/check_full_java_comments.py [--json] [文件或目录...]

@author 李杰
"""

from __future__ import annotations

import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scripts.code.java.check_staged_java_comments import Finding, scan_full_source
from scripts.common.check_protocol import emit
from scripts.common.quality_common import CheckError, discover, entry, parser, read_text
from scripts.common.repository_layout import is_java_source

# Windows Git Hook 可能继承非 UTF-8 控制台编码，统一输出编码以保证中文提示可读。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


def scan_all_java_comments(
    paths: list[str] | None = None, root: Path | None = None
) -> tuple[int, list[Finding]]:
    """读取全部纳管 Java 文件并检查其全部声明。

    Args:
        paths: 可选的仓库相对文件或目录；为空时检查整个仓库。
        root: 仓库根目录；省略时使用本工具所属仓库。
    Returns:
        实际读取的文件数与该范围内全部注释问题。
    Raises:
        CheckError: 根目录无效、路径越界或文件无法严格按 UTF-8 读取。
    """

    repository = (root or Path(__file__).resolve().parents[3]).resolve()
    selected = [
        path
        for path in discover(repository, {".java"}, paths or ())
        if is_java_source(path.relative_to(repository).as_posix())
    ]
    findings: list[Finding] = []
    for path in selected:
        relative = path.relative_to(repository).as_posix()
        findings.extend(scan_full_source(relative, read_text(path)))
    return len(selected), sorted(set(findings), key=lambda item: (item.path, item.line, item.rule))


def main() -> int:
    """按统一协议输出全量 Java 注释诊断。

    Returns:
        没有问题时返回 0，存在问题时返回 1，检查无法完成时返回 2。
    """

    arguments = parser(__doc__)
    args = arguments.parse_args()
    try:
        count, findings = scan_all_java_comments(args.paths, args.root)
    except CheckError as error:
        print(f"Java 全量注释检查失败：{error}", file=sys.stderr)
        return 2
    if args.json:
        return emit("Java 注释（全量）", count, findings)
    if not findings:
        print(f"Java 全量注释检查通过：{count} 个纳管文件")
        return 0
    print(f"Java 全量注释检查范围：{count} 个纳管文件", file=sys.stderr)
    for finding in findings:
        print(
            f"- {finding.path}:{finding.line} [{finding.rule}] {finding.detail}",
            file=sys.stderr,
        )
    return 1


if __name__ == "__main__":
    raise SystemExit(entry(main))
