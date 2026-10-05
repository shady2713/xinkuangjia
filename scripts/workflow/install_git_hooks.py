#!/usr/bin/env python3
"""核对并安装仓库的 Git 提交钩子，让受版本控制的根钩子成为唯一权威入口。

本脚本只把 `core.hooksPath` 指向仓库内受版本控制的 `.githooks` 目录，并核验钩子文件存在且
带可执行位；它不写入 `.git/hooks`，不改动暂存区，也不自动暂存或格式化任何文件。

存在两种必须明确拒绝而不是静默处理的情况：其一，`.git/hooks` 下已有其他钩子管理器
（lefthook、husky 等）写入的钩子，此时设置 `core.hooksPath` 会让那些钩子被 Git **静默忽略**，
属于相互覆盖；其二，`core.hooksPath` 已指向别处。两种情况都以退出码 2 报错，需要使用者先
显式处理，`--force` 才覆盖。

用法：
    python -B -X utf8 scripts/workflow/install_git_hooks.py --check
    python -B -X utf8 scripts/workflow/install_git_hooks.py

@author 李杰
"""

from __future__ import annotations

import argparse
import json
import os
import stat
import subprocess
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.common.quality_common import DEFAULT_ROOT

# 钩子目录受版本控制，克隆后即可复用；.git/hooks 不在版本控制内，因此不作为权威入口。
HOOKS_PATH = ".githooks"
PRE_COMMIT = "pre-commit"
# 其他钩子管理器会往 .git/hooks 写同名文件；列出它们的可识别特征用于明确报错。
FOREIGN_MARKERS = ("lefthook", "husky", "pre-commit", "husky.sh")


class HookError(RuntimeError):
    """钩子状态不满足安装前置条件；调用方据此以配置错误退出。"""


def _git(root: Path, arguments: list[str], *, missing_ok: bool = False) -> str:
    """在仓库根目录执行只读 Git 命令并返回标准输出。

    Args:
        root: 仓库根目录。
        arguments: 传给 `git` 的参数列表，不包含 `git` 本身。
        missing_ok: 为 True 时把退出码 1 当作"查询项不存在"返回空字符串，用于
            `git config --get` 读取未设置的键；其余非零退出码仍然报错。
    Returns:
        去除首尾空白后的标准输出；命令无输出时为空字符串。
    Raises:
        HookError: 未安装 git、命令超时或 Git 以非零码退出（`missing_ok` 允许的退出码 1 除外）。
    """
    command = ["git", "-c", "core.quotepath=false", *arguments]
    try:
        completed = subprocess.run(
            command,
            cwd=root,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
        )
    except FileNotFoundError as error:
        raise HookError("未找到 git，无法核对提交钩子。") from error
    except subprocess.TimeoutExpired as error:
        raise HookError("Git 命令执行超时，无法核对提交钩子。") from error
    if completed.returncode != 0:
        if missing_ok and completed.returncode == 1:
            return ""
        detail = (completed.stderr or "").strip()
        raise HookError(f"Git 命令执行失败：{detail}")
    return completed.stdout.strip()


def repository_root(root: Path) -> Path:
    """解析 Git 仓库的顶层目录，用于在任意子目录下也能正确定位钩子。

    Args:
        root: 任意仓库内路径，通常是仓库根目录。
    Returns:
        仓库顶层目录的绝对路径。
    Raises:
        HookError: 该路径不在 Git 工作区内。
    """
    try:
        top = _git(root, ["rev-parse", "--show-toplevel"])
    except HookError as error:
        raise HookError(f"{root} 不在 Git 工作区内，无法安装提交钩子。") from error
    if not top:
        raise HookError(f"{root} 不在 Git 工作区内，无法安装提交钩子。")
    return Path(top).resolve()


def hooks_directory(top: Path) -> Path:
    """返回 Git 实际读取钩子的目录，受 `core.hooksPath` 影响。

    Args:
        top: 仓库顶层目录。
    Returns:
        钩子目录的绝对路径；`core.hooksPath` 未设置时为 `.git/hooks`。
    """
    configured = _git(top, ["config", "--get", "core.hooksPath"], missing_ok=True)
    if not configured:
        return top / ".git" / "hooks"
    candidate = Path(configured)
    return candidate if candidate.is_absolute() else (top / candidate)


def foreign_hooks(top: Path) -> list[str]:
    """列出 `.git/hooks` 下由其他钩子管理器写入的可执行钩子。

    只统计非 `*.sample` 且带可执行位的文件：`core.hooksPath` 一旦设置，这些文件会被 Git
    静默忽略，必须在安装前显式报告，否则使用者会以为它们在生效。

    Args:
        top: 仓库顶层目录。
    Returns:
        相对仓库根目录的钩子路径列表，按字典序排列。
    """
    directory = top / ".git" / "hooks"
    if not directory.is_dir():
        return []
    found: list[str] = []
    for entry in sorted(directory.iterdir()):
        if not entry.is_file() or entry.name.endswith(".sample"):
            continue
        if not os.access(entry, os.X_OK):
            continue
        found.append(str(entry.relative_to(top)))
    return found


def index_executable(top: Path) -> bool:
    """判断 `pre-commit` 在 Git 索引中是否记录为可执行。

    钩子文件必须同时在工作区带可执行位、并在索引中记录为 `100755`，否则新克隆出来的
    副本仍然不可执行，Git 会直接忽略该钩子。

    Args:
        top: 仓库顶层目录。
    Returns:
        索引中该文件模式为 `100755` 时为 True；未跟踪或模式不符时为 False。
    """
    listing = _git(top, ["ls-files", "-s", f"{HOOKS_PATH}/{PRE_COMMIT}"])
    if not listing:
        return False
    return listing.split()[0] == "100755"


def status(top: Path) -> dict[str, object]:
    """汇总当前钩子安装状态，不修改仓库或配置。

    Args:
        top: 仓库顶层目录。
    Returns:
        含期望值、实际配置、钩子文件可执行性与外来钩子清单的状态字典。
    """
    hook_file = top / HOOKS_PATH / PRE_COMMIT
    configured = _git(top, ["config", "--get", "core.hooksPath"], missing_ok=True)
    return {
        "root": str(top),
        "expected_hooks_path": HOOKS_PATH,
        "configured_hooks_path": configured,
        "hooks_directory": str(hooks_directory(top)),
        "hook_file": str(hook_file.relative_to(top)),
        "hook_file_present": hook_file.is_file(),
        "hook_file_executable": hook_file.is_file() and os.access(hook_file, os.X_OK),
        "index_executable": index_executable(top),
        "foreign_hooks": foreign_hooks(top),
    }


def active_blockers(document: dict[str, object]) -> list[str]:
    """给出"钩子当前未真正生效"的原因，供 `--check` 与安装后复核共用。

    Args:
        document: `status` 返回的状态字典。
    Returns:
        人类可读的原因列表；为空表示钩子已经处于生效状态。
    """
    reasons: list[str] = []
    configured = document["configured_hooks_path"]
    if configured != HOOKS_PATH:
        actual = configured or "(未设置，Git 会读取 .git/hooks)"
        reasons.append(f"core.hooksPath 为 {actual}，不是期望的 {HOOKS_PATH}")
    if not document["hook_file_present"]:
        reasons.append(f"缺少钩子文件 {document['hook_file']}")
    elif not document["hook_file_executable"]:
        reasons.append(f"{document['hook_file']} 没有可执行位，Git 会直接忽略该钩子")
    return reasons


def install_blockers(document: dict[str, object]) -> list[str]:
    """给出"不能安全安装"的原因，避免覆盖或忽略已有的钩子。

    `core.hooksPath` 未设置本身不是阻止原因——那正是安装要修的状态；只有它被显式指向
    别处、钩子文件缺失，或 `.git/hooks` 下已存在其他管理器的钩子时才拒绝。

    Args:
        document: `status` 返回的状态字典。
    Returns:
        人类可读的阻止原因列表；为空表示可以执行安装。
    """
    reasons: list[str] = []
    configured = document["configured_hooks_path"]
    if configured and configured != HOOKS_PATH:
        reasons.append(f"core.hooksPath 已指向 {configured}，与期望的 {HOOKS_PATH} 不一致")
    if not document["hook_file_present"]:
        reasons.append(f"缺少钩子文件 {document['hook_file']}")
    foreign = document["foreign_hooks"]
    if foreign:
        reasons.append(
            "以下钩子已存在于 .git/hooks，设置 core.hooksPath 会让它们被 Git 静默忽略："
            + "、".join(str(item) for item in foreign)
        )
    return reasons


def activate(top: Path, *, force: bool) -> dict[str, object]:
    """把 `core.hooksPath` 指向 `.githooks`，必要时补上钩子文件的可执行位。

    Args:
        top: 仓库顶层目录。
        force: 为 True 时忽略阻止原因强行设置；为 False 时遇到阻止原因直接报错。
    Returns:
        安装后的状态字典，额外含 `changed` 表示本次是否真的改动了配置或文件模式。
    Raises:
        HookError: 存在阻止原因且未指定 `force`，或无法写入 Git 配置与文件模式。
    """
    before = status(top)
    reasons = install_blockers(before)
    if reasons and not force:
        raise HookError("；".join(reasons))
    changed = False
    if before["configured_hooks_path"] != HOOKS_PATH:
        _git(top, ["config", "--local", "core.hooksPath", HOOKS_PATH])
        changed = True
    hook_file = top / HOOKS_PATH / PRE_COMMIT
    if hook_file.is_file() and not os.access(hook_file, os.X_OK):
        mode = hook_file.stat().st_mode
        hook_file.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        changed = True
    after = status(top)
    after["changed"] = changed
    after["index_executable_warning"] = (
        ""
        if after["index_executable"]
        else f"{HOOKS_PATH}/{PRE_COMMIT} 在索引中不是 100755，新克隆的副本仍不可执行；"
        "需要用 git update-index --chmod=+x 提交该模式"
    )
    return after


def main() -> int:
    """按参数核对或安装提交钩子，并以明确的退出码报告结果。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--check", action="store_true", help="只核对状态，不修改配置或文件模式")
    parser.add_argument("--force", action="store_true", help="存在阻止原因时仍然设置 core.hooksPath")
    parser.add_argument("--json", action="store_true")
    arguments = parser.parse_args()

    try:
        top = repository_root(arguments.root)
        if arguments.check:
            document = status(top)
            document["blockers"] = active_blockers(document)
            document["active"] = not document["blockers"]
        else:
            document = activate(top, force=arguments.force)
            document["blockers"] = active_blockers(document)
            document["active"] = not document["blockers"]
        code = 0 if document["active"] else 2
    except HookError as error:
        document = {"root": str(arguments.root), "active": False, "blockers": [str(error)]}
        code = 2

    if arguments.json:
        print(json.dumps(document, ensure_ascii=False, indent=2))
    else:
        print(f"仓库根目录：{document.get('root', '')}")
        print(f"core.hooksPath：{document.get('configured_hooks_path') or '(未设置)'}")
        for reason in document.get("blockers", []):
            print(f"未生效原因：{reason}", file=sys.stderr)
        if document.get("index_executable_warning"):
            print(f"提示：{document['index_executable_warning']}", file=sys.stderr)
        print("提交钩子状态：" + ("已生效" if document.get("active") else "未生效"))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
