#!/usr/bin/env python3
"""统一执行 AIMaster 工作区 Java 与 Python 增量注释检查。

@author 李杰
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Sequence

CHECKERS = (
    "java/check_worktree_java_comments.py",
    "python/check_worktree_python_comments.py",
)


def _configure_console_encoding() -> None:
    """在支持的终端中将标准输出和错误输出设置为 UTF-8。"""

    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")


def _run_checker(script_dir: Path, checker_name: str) -> int:
    """运行一个语言专项包装器并返回其状态码。"""

    try:
        result = subprocess.run(
            [sys.executable, str(script_dir / checker_name)],
            check=False,
            timeout=90,
        )
        return result.returncode
    except subprocess.TimeoutExpired:
        print(f"注释检查器执行超时：{checker_name}", file=sys.stderr)
        return 2


def _combined_status(statuses: Sequence[int]) -> int:
    """按执行错误优先于规则失败的顺序合并状态码。"""

    if any(status not in (0, 1) for status in statuses):
        return 2
    if any(status == 1 for status in statuses):
        return 1
    return 0


def main() -> int:
    """依次执行已登记语言检查器并汇总退出状态。"""

    _configure_console_encoding()
    script_dir = Path(__file__).resolve().parent
    statuses = [_run_checker(script_dir, checker_name) for checker_name in CHECKERS]
    return _combined_status(statuses)


if __name__ == "__main__":
    raise SystemExit(main())
