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
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import asdict, dataclass
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
    arguments = [sys.executable, "-B", "-X", "utf8", str(script)]
    if gate.root_argument:
        arguments.extend(["--root", str(root)])
    try:
        result = run_process(
            arguments,
            root,
            timeout=timeout,
            env={**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1"},
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
    arguments.add_argument("--list", action="store_true")
    arguments.add_argument("--json", action="store_true")
    args = arguments.parse_args()
    gates = select_gates(args.checks, args.group)
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
