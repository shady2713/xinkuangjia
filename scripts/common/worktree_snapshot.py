"""为工作区检查创建私有 Git 索引与对象库，不向真实仓库写入检查对象。

@author OpenAI Codex
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


def git(root: Path, arguments: list[str], env: dict[str, str] | None = None) -> bytes:
    """有界执行快照准备命令，保留失败状态供语言入口统一报告。"""
    return subprocess.run(
        ["git", "-c", "core.quotepath=false", *arguments],
        cwd=root,
        env=env,
        capture_output=True,
        check=True,
        timeout=30,
    ).stdout


def git_path(root: Path, name: str) -> Path:
    """读取当前仓库实际使用的 Git 路径，兼容 worktree 及调用方隔离环境。"""
    path = Path(git(root, ["rev-parse", "--git-path", name]).decode("utf-8").strip())
    return path if path.is_absolute() else (root / path).resolve()


def prepare_index(root: Path, temporary_index: Path) -> dict[str, str]:
    """复制当前索引并隔离新对象；缺索引时从 HEAD 或空树初始化合法索引。

    Args:
        root: 当前 Git 工作区根目录。
        temporary_index: 调用者独享临时目录内尚不存在的索引路径。
    Returns:
        私有索引与对象库环境；现有对象库及其备用来源仅供读取。
    Raises:
        FileExistsError: 目标索引已存在，不覆盖未知归属的文件。
        OSError: 私有文件无法创建或源索引无法读取。
        subprocess.CalledProcessError: Git 读取或私有索引初始化失败。
        subprocess.TimeoutExpired: 单个准备命令超过 30 秒。
    """
    if temporary_index.exists():
        raise FileExistsError("检查快照索引必须使用尚不存在的私有路径")
    original = git_path(root, "index")
    if original.exists():
        shutil.copyfile(original, temporary_index)
    private_objects = temporary_index.parent / "objects"
    private_objects.mkdir()
    env = os.environ.copy()
    env["GIT_INDEX_FILE"] = str(temporary_index)
    env["GIT_OBJECT_DIRECTORY"] = str(private_objects)
    source_objects = str(git_path(root, "objects"))
    alternates = env.get("GIT_ALTERNATE_OBJECT_DIRECTORIES", "")
    env["GIT_ALTERNATE_OBJECT_DIRECTORIES"] = source_objects + (
        os.pathsep + alternates if alternates else ""
    )
    if not temporary_index.exists():
        try:
            git(root, ["rev-parse", "--verify", "--quiet", "HEAD"], env)
        except subprocess.CalledProcessError as error:
            if error.returncode != 1:
                raise
            git(root, ["read-tree", "--empty"], env)
        else:
            git(root, ["read-tree", "HEAD"], env)
    return env
