"""统一调度仓库质量检查，保留依赖顺序、并发上限和真实失败状态。

用法：python scripts/workflow/run_checks.py --group docs
默认运行全部已登记质量检查，不自动执行构建、提交或业务测试。
@author 李杰
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import threading
import time
from collections.abc import Iterator
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from contextlib import contextmanager
from dataclasses import asdict, dataclass, replace
from pathlib import Path

# 直接按文件路径运行时定位工具所属仓库，不依赖调用者的当前目录。
if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.common.quality_common import DEFAULT_ROOT, CheckError, entry, run_process

SCRIPT_DIRECTORY = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Gate:
    """定义固定的检查入口及其前置检查，不接受任意 Shell 命令。"""

    name: str
    script: str
    group: str
    dependencies: tuple[str, ...] = ()
    root_argument: bool = True
    arguments: tuple[str, ...] = ()
    baseline: str | None = None


@dataclass(frozen=True)
class Outcome:
    """记录单项检查的状态、退出码、耗时与输出，跳过不能算成功。"""

    name: str
    status: str
    code: int
    seconds: float
    output: str


GATES = (
    Gate("md-links", "docs/verify_md_links.py", "docs"),
    Gate("skills", "skills/verify_skill_metadata.py", "docs"),
    Gate("doc-refs", "docs/verify_doc_refs.py", "docs"),
    Gate("package-readmes", "docs/verify_package_readmes.py", "docs"),
    Gate("doc-structure", "docs/verify_doc_structure.py", "docs"),
    Gate("doc-policy", "docs/verify_doc_policy.py", "docs"),
    Gate("note-classification", "docs/verify_agent_note_classification.py", "docs"),
    Gate("note-format", "docs/verify_agent_note_format.py", "docs", ("note-classification",)),
    Gate("mermaid", "docs/verify_mermaid.py", "docs"),
    Gate("web-comments", "code/web/check_worktree_web_comments.py", "comments"),
    Gate(
        "java-comments",
        "code/java/check_worktree_java_comments.py",
        "comments",
        root_argument=False,
    ),
    Gate(
        "python-comments",
        "code/python/check_worktree_python_comments.py",
        "comments",
        root_argument=False,
    ),
)

# 干净 checkout 没有暂存区，按基线比较时改用读取 base→HEAD 差异的暂存入口。
BASELINE_COMMENT_GATES = {
    "java-comments": ("code/java/check_staged_java_comments.py", False, ()),
    "python-comments": ("code/python/check_staged_python_comments.py", False, ()),
    "web-comments": ("code/web/check_worktree_web_comments.py", True, ("--staged",)),
}


def select_gates(names: list[str], group: str) -> list[Gate]:
    """选择检查及其递归前置条件；未知名称或依赖环视为配置错误。"""
    registry = {gate.name: gate for gate in GATES}
    selected: set[str] = set()
    visiting: set[str] = set()

    def include(name: str) -> None:
        """递归补齐依赖并拒绝循环或未知检查名。"""
        if name not in registry:
            raise CheckError(f"未知检查：{name}")
        if name in visiting:
            raise CheckError(f"检查依赖成环：{name}")
        if name in selected:
            return
        visiting.add(name)
        for dependency in registry[name].dependencies:
            include(dependency)
        visiting.remove(name)
        selected.add(name)

    for name in names or [gate.name for gate in GATES if group == "all" or gate.group == group]:
        include(name)
    return [gate for gate in GATES if gate.name in selected]


def apply_baseline(gates: list[Gate], base: str) -> list[Gate]:
    """把 comments 组切换为读取 base→HEAD 差异的暂存检查入口。"""
    result = []
    for gate in gates:
        replacement = BASELINE_COMMENT_GATES.get(gate.name)
        if replacement is None:
            result.append(gate)
            continue
        script, root_argument, extra_arguments = replacement
        result.append(
            replace(
                gate,
                script=script,
                root_argument=root_argument,
                arguments=extra_arguments,
                baseline=base,
            )
        )
    return result


def resolve_commit(root: Path, revision: str) -> str:
    """校验并解析提交引用，失败时报告环境错误而不是使用无效基线。"""
    result = run_process(
        ["git", "-C", str(root), "rev-parse", "--verify", f"{revision}^{{commit}}"],
        root,
        timeout=30,
        env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"},
    )
    commit = result.stdout.decode("utf-8", errors="replace").strip()
    if result.code or not commit:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise CheckError(f"无法解析基线提交 {revision}：{detail or 'git rev-parse 失败'}")
    return commit


@contextmanager
def baseline_environment(root: Path, base: str) -> Iterator[dict[str, str]]:
    """创建 base→HEAD 的临时 Git 环境，让暂存检查复用于干净 checkout。

    临时对象目录通过 alternates 读取真实仓库对象，HEAD 指向基线提交，索引
    由工作区当前 HEAD 树建立。因此 ``git diff --cached`` 恰好表示 base 到
    HEAD 的变更，且不会改动真实索引或仓库状态。

    Args:
        root: 真实仓库根目录。
        base: 基线提交引用或完整提交标识。
    Yields:
        包含临时 GIT_DIR、GIT_WORK_TREE 和 GIT_INDEX_FILE 的子进程环境。
    Raises:
        CheckError: 基线无法解析、仓库目录异常或索引建立失败。
    """
    repository = root.resolve()
    baseline = resolve_commit(repository, base)
    head = resolve_commit(repository, "HEAD")
    # linked worktree 的 ``--absolute-git-dir`` 指向 ``.git/worktrees/<name>``，
    # 该目录没有 objects；``--git-path objects`` 才会解析到共享对象目录。
    object_directory = run_process(
        ["git", "-C", str(repository), "rev-parse", "--git-path", "objects"],
        repository,
        timeout=30,
        env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"},
    )
    if object_directory.code:
        raise CheckError("无法定位 Git 对象目录")
    objects = Path(
        object_directory.stdout.decode("utf-8", errors="replace").strip()
    )
    if not objects.is_absolute():
        objects = repository / objects
    if not objects.is_dir():
        raise CheckError(f"Git 对象目录不存在：{objects}")
    with tempfile.TemporaryDirectory(prefix="quality-gate-baseline-") as temporary:
        folder = Path(temporary)
        temporary_git = folder / "git"
        (temporary_git / "objects" / "info").mkdir(parents=True)
        (temporary_git / "refs").mkdir()
        (temporary_git / "HEAD").write_text(f"{baseline}\n", encoding="utf-8")
        (temporary_git / "config").write_text(
            "[core]\n\trepositoryformatversion = 0\n\tbare = false\n",
            encoding="utf-8",
        )
        (temporary_git / "objects" / "info" / "alternates").write_text(
            f"{objects.resolve()}\n", encoding="utf-8"
        )
        environment = {
            **os.environ,
            "GIT_DIR": str(temporary_git),
            "GIT_WORK_TREE": str(repository),
            "GIT_INDEX_FILE": str(folder / "index"),
            "GIT_OPTIONAL_LOCKS": "0",
            "PYTHONIOENCODING": "utf-8",
            "PYTHONDONTWRITEBYTECODE": "1",
        }
        result = run_process(
            ["git", "read-tree", head],
            repository,
            timeout=30,
            env=environment,
        )
        if result.code:
            detail = result.stderr.decode("utf-8", errors="replace").strip()
            raise CheckError(f"无法建立基线索引：{detail or 'git read-tree 失败'}")
        yield environment


def execute(
    gate: Gate,
    root: Path,
    timeout: float,
    cancel: threading.Event | None = None,
) -> Outcome:
    """在受控子进程中执行单项检查，错误与规则失败分别保留。

    Args:
        gate: 已登记的固定检查配置。
        root: 待检查仓库目录。
        timeout: 单项检查的秒数上限。
        cancel: 用户中断时由调度器设置的取消信号。
    Returns:
        包含真实退出码和耗时的结果，环境异常返回 error 状态。
    """
    started = time.monotonic()
    script = SCRIPT_DIRECTORY / gate.script
    command = [sys.executable, "-B", "-X", "utf8", str(script)]
    if gate.root_argument:
        command.extend(["--root", str(root)])
    command.extend(gate.arguments)
    environment = {
        **os.environ,
        "PYTHONIOENCODING": "utf-8",
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    try:
        if gate.baseline is None:
            result = run_process(
                command,
                root,
                timeout=timeout,
                env=environment,
                cancel=cancel,
            )
        else:
            with baseline_environment(root, gate.baseline) as baseline_env:
                result = run_process(
                    command,
                    root,
                    timeout=timeout,
                    env=baseline_env,
                    cancel=cancel,
                )
        code = result.code
        output = (result.stdout + result.stderr).decode("utf-8", errors="replace")
    except CheckError as exc:
        code, output = 2, str(exc)
    status = "passed" if code == 0 else "failed" if code == 1 else "error"
    return Outcome(gate.name, status, code, round(time.monotonic() - started, 3), output)


def schedule(gates: list[Gate], root: Path, jobs: int, timeout: float) -> list[Outcome]:
    """有界并发运行独立检查；前置失败则明确跳过依赖项。

    Args:
        gates: 已补齐依赖的检查集合。
        root: 待检查仓库根目录。
        jobs: 最大同时运行的检查数。
        timeout: 每项检查的秒数上限。
    Returns:
        按登记顺序排列的全部结果，包括因依赖失败跳过的项。
    Raises:
        CheckError: 调度图无法继续前进。
    """
    pending = {gate.name: gate for gate in gates}
    outcomes: dict[str, Outcome] = {}
    cancel = threading.Event()
    pool = ThreadPoolExecutor(max_workers=jobs)
    try:
        running = {}
        while pending or running:
            for name, gate in list(pending.items()):
                if not all(dependency in outcomes for dependency in gate.dependencies):
                    continue
                if any(outcomes[dependency].status != "passed" for dependency in gate.dependencies):
                    outcomes[name] = Outcome(name, "skipped", 1, 0, "前置检查未通过")
                    del pending[name]
                elif len(running) < jobs:
                    running[pool.submit(execute, gate, root, timeout, cancel)] = name
                    del pending[name]
            if running:
                finished, _ = wait(running, return_when=FIRST_COMPLETED)
                for future in finished:
                    name = running.pop(future)
                    outcomes[name] = future.result()
            elif pending:
                raise CheckError("检查依赖不完整或存在循环")
    finally:
        cancel.set()
        pool.shutdown(wait=True, cancel_futures=True)
    return [outcomes[gate.name] for gate in gates]


def combined_code(outcomes: list[Outcome]) -> int:
    """环境错误优先返回 2，规则失败或跳过返回 1，全部通过返回 0。"""
    if any(result.status == "error" for result in outcomes):
        return 2
    return 1 if any(result.status != "passed" for result in outcomes) else 0


def positive_integer(value: str) -> int:
    """解析正整数参数，拒绝零和负值以防无限等待或无法启动工作池。"""
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("必须是正整数")
    return number


def main() -> int:
    """输出检查清单或运行已选择检查，并保留完整汇总状态。"""
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    arguments.add_argument("--group", choices=("all", "docs", "comments"), default="all")
    arguments.add_argument("--checks", nargs="+", default=[], help="指定检查名，自动补齐前置检查")
    arguments.add_argument("--jobs", type=positive_integer, default=3)
    arguments.add_argument("--timeout", type=positive_integer, default=180)
    arguments.add_argument(
        "--base",
        default=None,
        help="以该提交为基线检查 comments 组，适用于没有暂存区的干净检出",
    )
    arguments.add_argument("--list", action="store_true")
    arguments.add_argument("--json", action="store_true")
    args = arguments.parse_args()
    gates = select_gates(args.checks, args.group)
    if args.base is not None:
        gates = apply_baseline(gates, resolve_commit(args.root.resolve(), args.base))
    if args.list:
        print(json.dumps([asdict(gate) for gate in gates], ensure_ascii=False, indent=2))
        return 0
    outcomes = schedule(gates, args.root.resolve(), args.jobs, args.timeout)
    code = combined_code(outcomes)
    if args.json:
        print(
            json.dumps(
                {"code": code, "results": [asdict(result) for result in outcomes]},
                ensure_ascii=False,
            )
        )
    else:
        for result in outcomes:
            print(f"{result.name}: {result.status} ({result.seconds:.3f}s)")
            if result.output:
                print(result.output.rstrip())
        print(
            f"汇总：{sum(result.status == 'passed' for result in outcomes)}/{len(outcomes)} 通过，退出码 {code}。"
        )
    return code


if __name__ == "__main__":
    raise SystemExit(entry(main))
