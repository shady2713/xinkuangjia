#!/usr/bin/env python3
"""使用临时索引与对象库检查暂存区和工作区中的 Java 增量注释。

@author OpenAI Codex
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scripts.common.repository_layout import is_java_source
from scripts.common.worktree_snapshot import prepare_index


def run_git(repo_root: Path, *args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    """在仓库根目录执行 Git 命令并保留标准输出，失败时交由调用方处理。"""
    return subprocess.run(
        ["git", *args],
        cwd=repo_root,
        env=env,
        check=True,
        text=True,
        encoding="utf-8",
        capture_output=True,
        timeout=30,
    )


def resolve_repo_root() -> Path:
    """解析当前命令所属 Git 仓库根目录。"""
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        check=True,
        text=True,
        encoding="utf-8",
        capture_output=True,
        timeout=30,
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
    return sorted({path for path in result.stdout.split("\0") if path and is_java_source(path)})


def main() -> int:
    """把工作区 Java 改动加入临时索引，并复用项目暂存区注释检查器。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="输出私有快照检查的结构化结果")
    args = parser.parse_args()
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
            child_env = prepare_index(repo_root, temporary_index)
            changed_java_files = list_worktree_java_changes(repo_root)
            if changed_java_files:
                run_git(repo_root, "add", "-A", "--", *changed_java_files, env=child_env)

            result = subprocess.run(
                [sys.executable, str(checker), *(["--json"] if args.json else [])],
                cwd=repo_root,
                env=child_env,
                check=False,
                timeout=180,
            )
            return result.returncode
    except subprocess.CalledProcessError as exc:
        message = exc.stderr or exc.stdout or str(exc)
        print(f"工作区 Java 注释检查准备失败：{message.strip()}", file=sys.stderr)
        return 2
    except (OSError, UnicodeError, subprocess.TimeoutExpired) as exc:
        # 超时和系统错误的原因会被吞掉，补上后调用方才能判断是缺环境还是缺依赖。
        detail = str(exc).strip() or type(exc).__name__
        print(f"工作区 Java 注释检查未完成：{type(exc).__name__}: {detail}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
