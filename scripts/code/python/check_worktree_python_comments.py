#!/usr/bin/env python3
"""在临时 Git 索引中检查工作区 Python 变更，不改动真实暂存区。

@author 李杰
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Sequence


def _configure_console_encoding() -> None:
    """在支持的终端中将标准输出和错误输出设置为 UTF-8。"""

    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")


def _run_git(
    repo_root: Path,
    arguments: Sequence[str],
    *,
    env: dict[str, str] | None = None,
    text: bool = True,
) -> subprocess.CompletedProcess:
    """在仓库根目录执行 Git 命令并统一处理编码和失败信息。"""

    command = ["git", "-c", "core.quotepath=false", *arguments]
    try:
        return subprocess.run(
            command,
            cwd=repo_root,
            env=env,
            check=True,
            capture_output=True,
            text=text,
            encoding="utf-8" if text else None,
            errors="replace" if text else None,
            timeout=30,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("未找到 git，无法准备 Python 注释检查。") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Git 命令执行超时。") from exc
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.decode("utf-8", "replace") if isinstance(exc.stderr, bytes) else exc.stderr
        raise RuntimeError(f"Git 命令执行失败：{stderr.strip()}") from exc


def _repo_root() -> Path:
    """根据脚本位置返回 AIMaster 仓库根目录。"""

    return Path(__file__).resolve().parents[3]


def _worktree_python_paths(repo_root: Path) -> list[str]:
    """返回工作区中已修改或未跟踪的 Python 文件路径。"""

    result = _run_git(
        repo_root,
        ["ls-files", "--modified", "--others", "--exclude-standard", "-z", "--", "*.py"],
        text=False,
    )
    return [item.decode("utf-8", "replace") for item in result.stdout.split(b"\0") if item]


def _real_index_path(repo_root: Path) -> Path:
    """返回真实 Git 索引路径，兼容普通仓库和 worktree。"""

    result = _run_git(repo_root, ["rev-parse", "--git-path", "index"])
    index_path = Path(result.stdout.strip())
    return index_path if index_path.is_absolute() else repo_root / index_path


def _temporary_index_environment(repo_root: Path, temporary_index: Path) -> dict[str, str]:
    """创建仅覆盖 Git 索引位置的子进程环境。"""

    env = os.environ.copy()
    real_index = _real_index_path(repo_root)
    if real_index.exists():
        shutil.copy2(real_index, temporary_index)
    else:
        temporary_index.touch()
    env["GIT_INDEX_FILE"] = str(temporary_index)
    return env


def _run_checker(repo_root: Path, env: dict[str, str]) -> int:
    """使用临时索引运行仓库级 Python 暂存区检查器。"""

    checker = repo_root / "scripts" / "code" / "python" / "check_staged_python_comments.py"
    result = subprocess.run(
        [sys.executable, str(checker)],
        cwd=repo_root,
        env=env,
        check=False,
        timeout=60,
    )
    return result.returncode


def main() -> int:
    """将工作区 Python 变化写入临时索引并执行注释检查。"""

    _configure_console_encoding()
    repo_root = _repo_root()
    try:
        paths = _worktree_python_paths(repo_root)
        if not paths:
            print("工作区没有需要检查的 Python 变更。")
            return 0

        with tempfile.TemporaryDirectory(prefix="aimaster-python-comments-") as temp_dir:
            temporary_index = Path(temp_dir) / "index"
            env = _temporary_index_environment(repo_root, temporary_index)
            _run_git(repo_root, ["add", "-A", "--", *paths], env=env)
            return _run_checker(repo_root, env)
    except (RuntimeError, subprocess.TimeoutExpired) as exc:
        print(f"Python 工作区注释检查无法执行：{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
