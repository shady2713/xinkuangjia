#!/usr/bin/env python3
"""在私有索引和对象库中检查 Python 暂存及工作区变更，不改动真实仓库。

@author 李杰
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Sequence

if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scripts.common.worktree_snapshot import prepare_index
from scripts.common.check_protocol import emit


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
    """根据当前执行目录解析 Git 根目录，便于真实仓库和隔离快照复用。"""

    return Path(_run_git(Path.cwd(), ["rev-parse", "--show-toplevel"]).stdout.strip()).resolve()


def _worktree_python_paths(repo_root: Path) -> list[str]:
    """返回工作区中已修改或未跟踪的 Python 文件路径。"""

    result = _run_git(
        repo_root,
        ["ls-files", "--modified", "--others", "--exclude-standard", "-z", "--", "*.py"],
        text=False,
    )
    return sorted({item.decode("utf-8") for item in result.stdout.split(b"\0") if item})


def _run_checker(repo_root: Path, env: dict[str, str], as_json: bool = False) -> int:
    """使用临时索引运行仓库级 Python 暂存区检查器。"""

    checker = repo_root / "scripts" / "code" / "python" / "check_staged_python_comments.py"
    result = subprocess.run(
        [sys.executable, str(checker), *(["--json"] if as_json else [])],
        cwd=repo_root,
        env=env,
        check=False,
        timeout=60,
    )
    return result.returncode


def main() -> int:
    """将工作区 Python 变化写入临时索引并执行注释检查。"""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="输出私有快照检查的结构化结果")
    args = parser.parse_args()
    _configure_console_encoding()
    try:
        repo_root = _repo_root()
        paths = _worktree_python_paths(repo_root)
        with tempfile.TemporaryDirectory(prefix="aimaster-python-comments-") as temp_dir:
            temporary_index = Path(temp_dir) / "index"
            env = prepare_index(repo_root, temporary_index)
            if paths:
                _run_git(repo_root, ["add", "-A", "--", *paths], env=env)
            selected = _run_git(repo_root, ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR", "--", "*.py"], env=env)
            count = len([name for name in selected.stdout.split("\0") if name])
            if not count:
                if args.json:
                    return emit("Python 注释", 0, [])
                print("Python 注释检查：不适用，没有暂存或工作区 Python 差异；未验证 Python 声明。")
                return 0
            if not args.json:
                print(f"Python 注释检查范围：{count} 个私有快照文件，仅检查受影响声明。", flush=True)
            return _run_checker(repo_root, env, args.json)
    except (RuntimeError, OSError, UnicodeError, subprocess.SubprocessError) as exc:
        # 只打印类型名会让"无法执行"无法定位；补上原因，检查未完成必须可诊断。
        detail = str(exc).strip() or type(exc).__name__
        print(f"Python 工作区注释检查无法执行：{type(exc).__name__}: {detail}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
