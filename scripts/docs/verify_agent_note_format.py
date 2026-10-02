"""按项目约定检查活动 Agent Note，兼容历史英文结构标记。

用法：python scripts/docs/verify_agent_note_format.py [笔记目录]
不检查冻结归档，不要求把历史英文章节批量翻译。
@author 李杰
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# 直接按文件路径运行时定位工具所属仓库，不依赖调用者的当前目录。
if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.common.quality_common import Finding, entry, parser, read_text, report
from scripts.docs.agent_note_support import collect_notes
from scripts.docs.markdown_support import parse

STATUS = {"proposed": "提议中", "implemented": "已实现", "rejected": "已拒绝"}
REQUIRED = {
    "proposed": [
        ("问题", "Problem"),
        ("提案", "Proposal"),
        ("验收标准", "Acceptance criteria"),
        ("风险", "Risks"),
    ],
    "implemented": [
        ("问题", "Problem"),
        ("决策", "Decision"),
        ("影响", "Consequences"),
        ("验证", "Testing", "Validation"),
    ],
    "rejected": [("问题", "Problem"), ("提案", "Proposal")],
}
ALTERNATIVES = ("考虑过的替代方案", "Alternatives considered")


def validate(path: Path, root: Path) -> list[Finding]:
    """检查状态、真实章节及非空内容，代码围栏不能伪造必需章节。

    Args:
        path: 已通过目录分类的活动笔记。
        root: 仓库根目录。
    Returns:
        此文件的格式问题；保留原标记并接受项目约定的中英文标题。
    """
    source = read_text(path)
    parsed = parse(source)
    lifecycle = path.relative_to(root / ".agents/notes").parts[0]
    findings: list[Finding] = []
    relative = path.relative_to(root).as_posix()
    lines = source.splitlines()
    fence_lines = {
        number
        for fence in parsed.fences
        for number in range(fence.line - 1, fence.line + len(fence.content.splitlines()) + 1)
    }
    statuses = [
        (number, line)
        for number, line in enumerate(lines, 1)
        if number not in fence_lines and re.match(r"^(?:状态[：:]|Status:)", line)
    ]
    if len(statuses) != 1:
        findings.append(Finding(relative, 1, "note-status", "必须有唯一的状态行"))
    else:
        number, value = statuses[0]
        expected = (
            rf"^(?:状态[：:]\s*{STATUS[lifecycle]}|Status:\s*{lifecycle})(?:\s*[—－-]\s*.+)?\s*$"
        )
        if not re.fullmatch(expected, value):
            findings.append(Finding(relative, number, "note-status", "状态与所在生命周期不一致"))
    if (
        not parsed.headings
        or parsed.headings[0][0] != 1
        or not re.match(
            r"^(?:决策记录[：:]|Agent Note:)\s*\S",
            parsed.headings[0][1],
        )
    ):
        findings.append(
            Finding(relative, 1, "note-title", "缺少“决策记录：主题”或历史 Agent Note 标题")
        )
    headings = [(title, number) for level, title, number in parsed.headings if level == 2]
    groups = [*REQUIRED[lifecycle], ALTERNATIVES]
    for alternatives in groups:
        matches = [
            (title, number)
            for title, number in headings
            if any(
                title == name or title.startswith(name + "与") or title.startswith(name + "及")
                for name in alternatives
            )
        ]
        # 原格式采用之前留下的真实豁免保留；不为较新的笔记制造历史豁免。
        grandfather = (
            "<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->"
        )
        if (
            not matches
            and alternatives == ALTERNATIVES
            and path.name[:10] < "2026-07-05"
            and grandfather in source
        ):
            continue
        if not matches:
            findings.append(Finding(relative, 1, "note-section", f"缺少章节：{alternatives[0]}"))
            continue
        for _, number in matches:
            next_line = min((n for _, n in headings if n > number), default=len(lines) + 1)
            body = "\n".join(lines[number : next_line - 1])
            if not re.sub(r"<!--[\s\S]*?-->|\s", "", body):
                findings.append(Finding(relative, number, "note-section", "必需章节没有内容"))
    if lifecycle == "rejected":
        reason_in_status = statuses and re.search(r"[—－-]\s*\S", statuses[0][1])
        if not reason_in_status and not any(
            title in {"拒绝理由", "Rejection reason"} for title, _ in headings
        ):
            findings.append(Finding(relative, 1, "note-rejection", "已拒绝笔记必须记录拒绝理由"))
    if lifecycle == "implemented":
        for title, number in headings:
            if title in {
                "提案",
                "计划",
                "迁移计划",
                "验收标准",
                "Proposal",
                "Plan",
                "Migration plan",
                "Acceptance criteria",
            }:
                findings.append(
                    Finding(relative, number, "note-delivered", "已实现笔记应记录实际决策和验证")
                )
    return findings


def collect(root: Path, paths: list[str]) -> tuple[int, list[Finding]]:
    """先验证分类，再检查合法路径中的正文；分类错误仍计入失败。"""
    notes, findings = collect_notes(root, paths)
    count = len(notes) + len(findings)
    for note in notes:
        findings.extend(validate(note, root))
    return count, findings


def main() -> int:
    """按命令行范围检查笔记格式并输出结果。"""
    args = parser(__doc__).parse_args()
    count, findings = collect(args.root.resolve(), args.paths)
    return report("笔记格式", count, findings, as_json=args.json)


if __name__ == "__main__":
    raise SystemExit(entry(main))
