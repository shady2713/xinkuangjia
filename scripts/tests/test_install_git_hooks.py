"""验证提交钩子安装入口的状态判定、拒绝条件与真实 CLI 行为。

每个用例在独立 Git 仓库里自行建立钩子与配置，不读取也不改动用户仓库的钩子设置。
@author 李杰
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from scripts.tests.git_sandbox import GitSandbox, create_sandbox
from scripts.workflow import install_git_hooks as installer

PRE_COMMIT_BODY = "#!/bin/sh\nexit 0\n"


def make_hook(sandbox: GitSandbox, *, executable: bool) -> Path:
    """在测试仓库写入可选的 pre-commit 钩子，并按要求设置可执行位。

    Args:
        sandbox: 独立的测试仓库。
        executable: 为 True 时补上可执行位，用于区分"文件存在"与"真的会被 Git 执行"。
    Returns:
        钩子文件的绝对路径。
    """
    directory = sandbox.root / installer.HOOKS_PATH
    directory.mkdir(exist_ok=True)
    hook = directory / installer.PRE_COMMIT
    hook.write_text(PRE_COMMIT_BODY, encoding="utf-8")
    hook.chmod(0o755 if executable else 0o644)
    return hook


def run_cli(sandbox: GitSandbox, *arguments: str) -> subprocess.CompletedProcess[str]:
    """以真实命令行方式运行安装入口，覆盖 argparse 与退出码路径。

    Args:
        sandbox: 独立的测试仓库，作为 `--root` 传入。
        arguments: 追加在 `--root` 之后的参数。
    Returns:
        已完成进程，标准输出与标准错误都以文本捕获。
    """
    return subprocess.run(
        [sys.executable, "-B", "-X", "utf8", str(Path(installer.__file__)),
         "--root", str(sandbox.root), *arguments],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
        check=False,
    )


def test_unset_hooks_path_is_not_an_install_blocker(tmp_path: Path) -> None:
    """未设置 core.hooksPath 只说明钩子尚未生效，不能因此拒绝安装。"""
    sandbox = create_sandbox(tmp_path / "repo")
    make_hook(sandbox, executable=True)
    document = installer.status(sandbox.root)
    assert installer.active_blockers(document), "未设置 hooksPath 时应判定为未生效"
    assert installer.install_blockers(document) == [], "未设置 hooksPath 不应阻止安装"


def test_install_activates_and_check_reports_active(tmp_path: Path) -> None:
    """可执行钩子存在时安装成功，随后 --check 必须报告已生效并以 0 退出。"""
    sandbox = create_sandbox(tmp_path / "repo")
    make_hook(sandbox, executable=True)
    installed = run_cli(sandbox)
    assert installed.returncode == 0, installed.stderr
    assert sandbox.git("config", "--get", "core.hooksPath").decode().strip() == installer.HOOKS_PATH
    checked = run_cli(sandbox, "--check")
    assert checked.returncode == 0, checked.stderr
    assert "已生效" in checked.stdout


def test_check_reports_inactive_for_missing_executable_bit(tmp_path: Path) -> None:
    """钩子缺少可执行位时 Git 会忽略它，只核对状态的 --check 必须判为未生效并以 2 退出。"""
    sandbox = create_sandbox(tmp_path / "repo")
    make_hook(sandbox, executable=False)
    checked = run_cli(sandbox, "--check")
    assert checked.returncode == 2, checked.stdout
    assert "可执行位" in checked.stderr
    assert installer.status(sandbox.root)["configured_hooks_path"] == "", "--check 不得改动配置"


def test_install_repairs_missing_executable_bit(tmp_path: Path) -> None:
    """安装入口补齐可执行位后，同一仓库必须转为已生效，不需要人工 chmod。"""
    sandbox = create_sandbox(tmp_path / "repo")
    hook = make_hook(sandbox, executable=False)
    document = installer.activate(sandbox.root, force=False)
    assert installer.active_blockers(document) == [], document
    assert os.access(hook, os.X_OK), "安装后钩子应带可执行位"
    installed = run_cli(sandbox)
    assert installed.returncode == 0, installed.stderr


def test_foreign_hook_blocks_install_without_force(tmp_path: Path) -> None:
    """`.git/hooks` 下已有其他管理器的钩子时必须拒绝，避免被 core.hooksPath 静默忽略。"""
    sandbox = create_sandbox(tmp_path / "repo")
    make_hook(sandbox, executable=True)
    hooks_directory = sandbox.root / ".git" / "hooks"
    hooks_directory.mkdir(parents=True, exist_ok=True)
    foreign = hooks_directory / installer.PRE_COMMIT
    foreign.write_text("#!/bin/sh\n# lefthook\n", encoding="utf-8")
    foreign.chmod(0o755)

    refused = run_cli(sandbox)
    assert refused.returncode == 2, refused.stdout
    assert "静默忽略" in refused.stderr
    assert installer.status(sandbox.root)["configured_hooks_path"] == "", "拒绝时不得改动配置"

    forced = run_cli(sandbox, "--force")
    assert forced.returncode == 0, forced.stderr
    assert installer.status(sandbox.root)["configured_hooks_path"] == installer.HOOKS_PATH


def test_different_configured_path_blocks_install(tmp_path: Path) -> None:
    """core.hooksPath 已指向别处时必须拒绝，避免覆盖他人配置。"""
    sandbox = create_sandbox(tmp_path / "repo")
    make_hook(sandbox, executable=True)
    sandbox.git("config", "--local", "core.hooksPath", "other-hooks")
    refused = run_cli(sandbox)
    assert refused.returncode == 2, refused.stdout
    assert "other-hooks" in refused.stderr
    assert installer.status(sandbox.root)["configured_hooks_path"] == "other-hooks"


def test_missing_hook_file_blocks_install(tmp_path: Path) -> None:
    """钩子文件缺失时安装没有意义，必须以 2 明确失败而不是静默设置配置。"""
    sandbox = create_sandbox(tmp_path / "repo")
    refused = run_cli(sandbox)
    assert refused.returncode == 2, refused.stdout
    assert "缺少钩子文件" in refused.stderr


def test_index_mode_reported_for_clone_visibility(tmp_path: Path) -> None:
    """索引中不是 100755 时要给出提示：新克隆的副本仍不可执行。"""
    sandbox = create_sandbox(tmp_path / "repo")
    hook = make_hook(sandbox, executable=True)
    document = installer.activate(sandbox.root, force=False)
    assert document["index_executable"] is False
    assert "100755" in str(document["index_executable_warning"])

    sandbox.git("add", f"{installer.HOOKS_PATH}/{installer.PRE_COMMIT}")
    sandbox.git("update-index", "--chmod=+x", f"{installer.HOOKS_PATH}/{installer.PRE_COMMIT}")
    assert installer.index_executable(sandbox.root) is True
    assert hook.stat().st_mode & 0o111


def run_cli_at(root: Path) -> subprocess.CompletedProcess[str]:
    """在指定目录上运行真实命令行入口，用于非仓库路径的失败路径。

    Args:
        root: 传给 `--root` 的目录，可以不是 Git 仓库。
    Returns:
        已完成进程，标准输出与标准错误都以文本捕获。
    """
    return subprocess.run(
        [sys.executable, "-B", "-X", "utf8", str(Path(installer.__file__)), "--root", str(root)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
        check=False,
    )


def test_status_outside_git_repository_fails(tmp_path: Path) -> None:
    """不在 Git 工作区内时必须报错，而不是假定某个钩子目录。"""
    plain = tmp_path / "plain"
    plain.mkdir()
    with pytest.raises(installer.HookError):
        installer.repository_root(plain)
    result = run_cli_at(plain)
    assert result.returncode == 2, result.stdout
