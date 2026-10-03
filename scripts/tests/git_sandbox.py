"""为质量工具测试构造完全独立的 Git 对象、索引、引用与历史。

@author OpenAI Codex
"""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class GitSandbox:
    """持有单个测试拥有的仓库及不会继承用户 Git 管理目录的环境。"""

    root: Path
    env: dict[str, str]

    def git(self, *arguments: str, data: bytes | None = None) -> bytes:
        """只在测试仓库执行有界 Git 命令，失败向测试传播且不执行用户钩子。"""
        return subprocess.run(
            ["git", "-c", "core.quotepath=false", *arguments],
            cwd=self.root,
            env=self.env,
            input=data,
            capture_output=True,
            check=True,
            timeout=30,
        ).stdout

    def stage(self, name: str, source: str) -> None:
        """将 UTF-8 样本写入测试对象库及索引，不改动对应工作区文件。"""
        oid = self.git("hash-object", "-w", "--stdin", data=source.encode("utf-8")).decode().strip()
        self.git("update-index", "--add", "--cacheinfo", f"100644,{oid},{name}")

    def record_baseline(self) -> None:
        """在私有引用中记录当前索引作为基线，不调用 commit 钩子或真实仓库。"""
        tree = self.git("write-tree").decode().strip()
        commit = self.git("commit-tree", tree, data=b"isolated test baseline\n").decode().strip()
        self.git("update-ref", "HEAD", commit)


def create_sandbox(folder: Path) -> GitSandbox:
    """在全新测试目录初始化空仓库，拒绝复用可能属于他人的已有目录。

    Args:
        folder: 调用者分配的临时目录下尚不存在的仓库目录。
    Returns:
        不依赖用户 HEAD、索引、对象库或配置的测试仓库。
    Raises:
        OSError: 目录已有或无法创建。
        subprocess.CalledProcessError: 测试仓库初始化失败。
    """
    folder.mkdir()
    env = {key: value for key, value in os.environ.items() if not key.upper().startswith("GIT_")}
    env.update({
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_AUTHOR_NAME": "Quality test fixture",
        "GIT_AUTHOR_EMAIL": "fixture@example.invalid",
        "GIT_COMMITTER_NAME": "Quality test fixture",
        "GIT_COMMITTER_EMAIL": "fixture@example.invalid",
        "PYTHONIOENCODING": "utf-8",
        "PYTHONDONTWRITEBYTECODE": "1",
    })
    sandbox = GitSandbox(folder, env)
    sandbox.git("init", "--quiet", "--template=", "--initial-branch=fixture")
    sandbox.git("config", "core.autocrlf", "false")
    sandbox.git("config", "core.longpaths", "true")
    env.update({"GIT_DIR": str(folder / ".git"), "GIT_WORK_TREE": str(folder)})
    return sandbox
