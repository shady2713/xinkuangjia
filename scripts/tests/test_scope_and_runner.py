"""验证 Git 范围协议、检查调度及子进程失败清理。

Git 读操作使用可控替身，不创建或修改真实 Git 仓库。
@author 李杰
"""

import subprocess
import sys
import threading
from pathlib import Path

import pytest
from scripts.common.quality_common import CheckError, run_process
from scripts.workflow import change_scope, run_checks
from scripts.workflow.run_checks import Gate, Outcome, combined_code, schedule, select_gates


def test_scope_preserves_unicode_and_four_sets(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """四种变更分别输出，中文、空格和换行文件名不被拆坏。"""

    def fake_git(root: Path, *args: str) -> bytes:
        """按协议返回读操作结果，意外写操作直接使测试失败。"""
        if "--show-toplevel" in args:
            return (str(tmp_path) + "\n").encode("utf-8")
        if "--verify" in args:
            return b"a" * 40 + b"\n" if "base^{commit}" in args else b"b" * 40 + b"\n"
        if args[0] == "merge-base":
            return b"c" * 40 + b"\n"
        if args[0] == "ls-files":
            return "新 文件\n换行.py\0".encode("utf-8")
        assert args[0] == "diff" and "--no-ext-diff" in args and "--no-textconv" in args
        return b"staged.py\0" if "--cached" in args else b"other.py\0"

    monkeypatch.setattr(change_scope, "git", fake_git)
    report = change_scope.collect(tmp_path, "base")
    assert report["paths"]["untracked"] == ["新 文件\n换行.py"]
    assert report["paths"]["staged"] == ["staged.py"]
    assert set(report["paths"]) == {"committed", "staged", "unstaged", "untracked"}


def test_scope_rejects_multiple_merge_bases(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """不唯一的共同祖先必须失败，不能静默选取第一项。"""
    monkeypatch.setattr(change_scope, "resolve_commit", lambda *_: "a" * 40)
    monkeypatch.setattr(
        change_scope,
        "git",
        lambda _, *args: (
            (str(tmp_path) + "\n").encode() if "--show-toplevel" in args else b"a\nb\n"
        ),
    )
    with pytest.raises(CheckError, match="唯一共同祖先"):
        change_scope.collect(tmp_path, "base")


def test_runner_selects_dependencies_and_rejects_unknown() -> None:
    """单独选择笔记格式仍补齐分类检查，拼错名称不会变成空成功。"""
    assert [gate.name for gate in select_gates(["note-format"], "all")] == [
        "note-classification",
        "note-format",
    ]
    with pytest.raises(CheckError, match="未知检查"):
        select_gates(["unknown"], "all")


def test_runner_failure_skips_only_dependents(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """前置失败会阻断依赖项，但不会吞掉独立检查结果。"""
    calls = []

    def fake_execute(
        gate: Gate,
        root: Path,
        timeout: float,
        cancel: threading.Event,
        **options: object,
    ) -> Outcome:
        """返回可控失败，记录实际调度的检查；新增的维护/报告选项不影响本用例。"""
        calls.append(gate.name)
        return Outcome(
            gate.name,
            "failed" if gate.name == "a" else "passed",
            1 if gate.name == "a" else 0,
            0,
            "",
            checked=1,
        )

    monkeypatch.setattr(run_checks, "execute", fake_execute)
    results = schedule(
        [Gate("a", "", ""), Gate("b", "", "", ("a",)), Gate("c", "", "")], tmp_path, 2, 5
    )
    assert calls.count("a") == 1 and "c" in calls and "b" not in calls
    assert results[1].status == "not-run" and combined_code(results) == 1


def test_runner_concurrency_is_bounded(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """用屏障证明两个独立任务可重叠，同时不会超出并发上限。"""
    barrier = threading.Barrier(2)
    lock = threading.Lock()
    active = 0
    maximum = 0

    def fake_execute(
        gate: Gate,
        root: Path,
        timeout: float,
        cancel: threading.Event,
        **options: object,
    ) -> Outcome:
        """在两个任务同时进入后释放，避免固定休眠猜测并发。"""
        nonlocal active, maximum
        with lock:
            active += 1
            maximum = max(maximum, active)
        barrier.wait(timeout=5)
        with lock:
            active -= 1
        return Outcome(gate.name, "passed", 0, 0, "", checked=1)

    monkeypatch.setattr(run_checks, "execute", fake_execute)
    results = schedule([Gate("a", "", ""), Gate("b", "", "")], tmp_path, 2, 5)
    assert maximum == 2 and combined_code(results) == 0


def test_missing_executable_and_timeout(tmp_path: Path) -> None:
    """启动失败与真实子进程超时都必须报告环境错误。"""
    with pytest.raises(CheckError, match="无法启动"):
        run_process(["aimaster-nonexistent-quality-executable"], tmp_path)
    with pytest.raises(CheckError, match="已终止"):
        run_process([sys.executable, "-c", "import time; time.sleep(30)"], tmp_path, timeout=0.2)


def test_process_exit_status_and_stderr(tmp_path: Path) -> None:
    """非零退出状态及错误流必须原样交给上层汇总。"""
    result = run_process(
        [sys.executable, "-c", "import sys; sys.stderr.write('failure'); sys.exit(7)"], tmp_path
    )
    assert result.code == 7 and result.stderr == b"failure"


def test_cancelled_process_is_reaped(tmp_path: Path) -> None:
    """调度器取消信号能够终止自有进程，不等待完整超时。"""
    cancel = threading.Event()
    cancel.set()
    with pytest.raises(CheckError, match="已取消"):
        run_process([sys.executable, "-c", "import time; time.sleep(30)"], tmp_path, cancel=cancel)


def test_cli_environment_failure_returns_two(tmp_path: Path) -> None:
    """独立脚本在输入路径错误时返回 2，不输出成功状态。"""
    script = Path(run_checks.__file__).resolve().parents[1] / "docs" / "verify_md_links.py"
    result = subprocess.run(
        [sys.executable, "-B", str(script), "--root", str(tmp_path / "missing")],
        capture_output=True,
        timeout=15,
        check=False,
    )
    assert result.returncode == 2
