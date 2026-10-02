"""共享本项目活动 Agent Note 的目录规则，冻结归档始终排除。

分类契约由项目 Agent Note 技能维护；不要求预建生命周期目录或已有笔记。
@author 李杰
"""

from __future__ import annotations

import re
from datetime import date
from pathlib import Path

from scripts.common.quality_common import Finding, discover

LIFECYCLES = {"proposed", "implemented", "rejected"}
CLASSES = {"feature", "bug-fix", "simplification", "architecture", "process", "testing"}
FILENAME = re.compile(r"^(\d{4}-\d{2}-\d{2})-(.+)\.md$")


def collect_notes(root: Path, paths: list[str]) -> tuple[list[Path], list[Finding]]:
    """发现活动笔记并检查层级、分类与有效日期，返回合法路径和诊断。

    Args:
        root: 仓库根目录。
        paths: 可选范围，默认只发现 .agents/notes 下的文件。
    Returns:
        目录合法的活动笔记与分类错误；管理说明不当作笔记。
    """
    note_root = root / ".agents/notes"
    selections = paths or ([".agents/notes"] if note_root.exists() else [])
    files = discover(root, {".md"}, selections)
    notes: list[Path] = []
    findings: list[Finding] = []
    for path in files:
        if not path.is_relative_to(note_root):
            continue
        parts = path.relative_to(note_root).parts
        if path.name in {"AGENTS.md", "CLAUDE.md"} or (
            len(parts) == 1 and path.name.startswith("README")
        ):
            continue
        reason = ""
        if len(parts) != 3 or parts[0] not in LIFECYCLES or parts[1] not in CLASSES:
            reason = "笔记必须位于 生命周期/分类/日期-主题.md"
        else:
            match = FILENAME.fullmatch(path.name)
            try:
                if match is None:
                    raise ValueError("缺少日期或主题")
                date.fromisoformat(match[1])
            except ValueError:
                reason = "文件名必须包含有效日期和非空主题"
        if reason:
            findings.append(
                Finding(path.relative_to(root).as_posix(), 1, "note-classification", reason)
            )
        else:
            notes.append(path)
    return notes, findings
