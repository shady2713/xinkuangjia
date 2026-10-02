#!/usr/bin/env python3
"""使用临时 Git 索引检查暂存区和工作区中的 Java 增量注释。"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def run_git(repo_root: Path, *args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    """在仓库根目录执行 Git 命令并保留标准输出，失败时交由调用方处理。"""
    return subprocess.run(
        ["git", *args],
        cwd=repo_root,
        env=env,
        check=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
    )


def resolve_repo_root() -> Path:
    """解析当前命令所属 Git 仓库根目录。"""
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        check=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
    )
    return Path(result.stdout.strip()).resolve()


def list_worktree_java_changes(repo_root: Path) -> list[str]:
    """列出相对真实索引仍有修改或尚未跟踪的 Java 文件。"""
    result = run_git(
        repo_root,
        "ls-files",
        "--modified",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        "*.java",
    )
    return [path for path in result.stdout.split("\0") if path]


def prepare_temporary_index(repo_root: Path, temporary_index: Path) -> dict[str, str]:
    """复制真实索引并返回仅指向临时索引的子进程环境。"""
    index_result = run_git(repo_root, "rev-parse", "--git-path", "index")
    real_index = Path(index_result.stdout.strip())
    if not real_index.is_absolute():
        real_index = (repo_root / real_index).resolve()
    if real_index.exists():
        shutil.copy2(real_index, temporary_index)
    else:
        temporary_index.unlink(missing_ok=True)

    child_env = os.environ.copy()
    child_env["GIT_INDEX_FILE"] = str(temporary_index)
    if not temporary_index.exists():
        run_git(repo_root, "read-tree", "HEAD", env=child_env)
    return child_env


def main() -> int:
    """把工作区 Java 改动加入临时索引，并复用项目暂存区注释检查器。"""
    if os.name == "nt":
        # Codex 会按 UTF-8 读取脚本输出，Windows 默认代码页可能导致中文诊断乱码。
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    try:
        repo_root = resolve_repo_root()
        checker = repo_root / "scripts" / "code" / "java" / "check_staged_java_comments.py"
        if not checker.is_file():
            print(f"未找到项目 Java 注释检查器：{checker}", file=sys.stderr)
            return 2

        with tempfile.TemporaryDirectory(prefix="aimaster-java-comments-") as temp_dir:
            temporary_index = Path(temp_dir) / "index"
            child_env = prepare_temporary_index(repo_root, temporary_index)
            changed_java_files = list_worktree_java_changes(repo_root)
            if changed_java_files:
                run_git(repo_root, "add", "-A", "--", *changed_java_files, env=child_env)

            result = subprocess.run(
                [sys.executable, str(checker)],
                cwd=repo_root,
                env=child_env,
                check=False,
            )
            return result.returncode
    except subprocess.CalledProcessError as exc:
        message = exc.stderr or exc.stdout or str(exc)
        print(f"工作区 Java 注释检查准备失败：{message.strip()}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
