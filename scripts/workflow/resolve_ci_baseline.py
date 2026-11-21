#!/usr/bin/env python3
"""统一解析 CI 比较基线，避免多个工作流作业重复维护空树回退脚本。

@author shady2713
"""

from __future__ import annotations

import argparse
import os
import subprocess
from pathlib import Path

ZERO_SHA = "0" * 40
EMPTY_TREE_IDENTITY = {
    "GIT_AUTHOR_NAME": "quality-gate",
    "GIT_AUTHOR_EMAIL": "quality-gate@invalid",
    "GIT_COMMITTER_NAME": "quality-gate",
    "GIT_COMMITTER_EMAIL": "quality-gate@invalid",
}


def _git(cwd: Path, *args: str, env: dict[str, str] | None = None) -> str:
    """执行只读或空树基线 Git 命令并返回标准输出，失败时抛出 RuntimeError。"""
    completed = subprocess.run(
        ["git", *args],
        cwd=cwd,
        env={**os.environ, **(env or {})},
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
        timeout=30,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or "git 命令失败"
        raise RuntimeError(f"git {' '.join(args)} 失败：{detail}")
    return completed.stdout.strip()


def resolve_ci_baseline(cwd: Path, event_base: str | None) -> str:
    """解析有效比较基线；空值或全零基线时回退到空树提交。

    Args:
        cwd: 目标 Git 仓库目录。
        event_base: 事件传入的基线提交标识，可为空或全零 SHA。
    Returns:
        可用于 ``git diff`` 的 40 位提交标识。
    """
    base = (event_base or "").strip()
    if base and base != ZERO_SHA:
        return base
    empty_tree = _git(cwd, "hash-object", "-t", "tree", "/dev/null")
    return _git(cwd, "commit-tree", empty_tree, "-m", "quality gate empty baseline", env=EMPTY_TREE_IDENTITY)


def main(argv: list[str] | None = None) -> int:
    """解析参数并将基线提交写入 GITHUB_OUTPUT（如存在）和标准输出。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event-base", default=os.environ.get("EVENT_BASE_SHA", ""), help="事件基线 SHA")
    parser.add_argument("--cwd", type=Path, default=Path.cwd(), help="目标仓库目录")
    args = parser.parse_args(argv)
    baseline = resolve_ci_baseline(args.cwd.resolve(), args.event_base)
    github_output = os.environ.get("GITHUB_OUTPUT", "").strip()
    if github_output:
        with Path(github_output).open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(f"sha={baseline}\n")
    print(baseline)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
