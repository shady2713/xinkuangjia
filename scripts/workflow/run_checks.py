"""统一调度仓库质量检查，保留依赖顺序、并发上限和真实失败状态。

用法：python scripts/workflow/run_checks.py --group docs
默认运行全部已登记质量检查，不自动执行构建、提交或业务测试。
@author 李杰
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

# 直接按文件路径运行时定位工具所属仓库，不依赖调用者的当前目录。
if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.common.quality_common import DEFAULT_ROOT, CheckError, CheckTimeout, discover, entry, git, read_text, run_process
from scripts.common.check_protocol import PROTOCOL
from scripts.workflow import check_evidence

SCRIPT_DIRECTORY = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Gate:
    """定义固定的检查入口及其前置检查，不接受任意 Shell 命令。"""

    name: str
    script: str
    group: str
    dependencies: tuple[str, ...] = ()
    root_argument: bool = True
    zero_reason: str | None = None
    scope: str = "worktree-full"


@dataclass(frozen=True)
class Outcome:
    """记录单项检查的状态、退出码、耗时与输出，跳过不能算成功。"""

    name: str
    status: str
    code: int
    seconds: float
    output: str
    checked: int | None = None
    command: tuple[str, ...] = ()
    cwd: str = ""
    reason: str = ""
    scope: str = "worktree-full"
    diagnostics: tuple[dict[str, object], ...] = ()
    attempted: bool = True
    process_code: int | None = None


GATES = (
    Gate("md-links", "docs/verify_md_links.py", "docs"),
    Gate("skills", "skills/verify_skill_metadata.py", "docs"),
    Gate("doc-refs", "docs/verify_doc_refs.py", "docs"),
    Gate("package-readmes", "docs/verify_package_readmes.py", "docs"),
    Gate("doc-structure", "docs/verify_doc_structure.py", "docs"),
    Gate("doc-policy", "docs/verify_doc_policy.py", "docs"),
    Gate("note-classification", "docs/verify_agent_note_classification.py", "docs", zero_reason="没有活动 Agent Notes；框架分发不要求维护历史笔记"),
    Gate("note-format", "docs/verify_agent_note_format.py", "docs", ("note-classification",), zero_reason="没有活动 Agent Notes，未执行笔记正文验证"),
    Gate("mermaid", "docs/verify_mermaid.py", "docs", zero_reason="没有 Mermaid 围栏，未执行图表解析"),
    Gate("web-comments", "code/web/check_worktree_web_comments.py", "comments", zero_reason="没有适用的 Web 增量文件，未验证 Web 声明", scope="worktree-incremental"),
    Gate(
        "java-comments",
        "code/java/check_worktree_java_comments.py",
        "comments",
        root_argument=False,
        zero_reason="没有适用的 Java 增量文件，未验证 Java 声明",
        scope="worktree-private-index-incremental",
    ),
    Gate("backend-boundaries", "code/java/verify_backend_boundaries.py", "boundaries"),
    Gate("workspace-layering", "code/web/verify_workspace_layering.py", "boundaries"),
    Gate("api-contracts", "code/java/verify_api_contracts.py", "boundaries"),
    Gate(
        "python-comments",
        "code/python/check_worktree_python_comments.py",
        "comments",
        root_argument=False,
        zero_reason="没有适用的 Python 增量文件，未验证 Python 声明",
        scope="worktree-private-index-incremental",
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


def command_for(gate: Gate, root: Path) -> list[str]:
    """生成固定检查的真实参数数组，所有子检查必须返回结构化计数协议。"""
    command = [sys.executable, "-B", "-X", "utf8", str(SCRIPT_DIRECTORY / gate.script)]
    if gate.root_argument:
        command.extend(["--root", str(root)])
    return [*command, "--json"]


def zero_scope_confirmed(gate: Gate, root: Path) -> bool:
    """独立枚举可适用对象来确认 N/A，不能只依靠子检查的零计数及登记理由。

    Args:
        gate: 固定注册的可无适用对象检查。
        root: 当前工作树根目录。
    Returns:
        对象清单确实为空时为 True；存在候选对象或政策未知时为 False。
    Raises:
        CheckError: 对象发现或 Git 差异依据无法读取。
    """
    if gate.name in {"note-classification", "note-format"}:
        from scripts.docs.agent_note_support import collect_notes
        notes, findings = collect_notes(root, [])
        return not notes and not findings
    if gate.name == "mermaid":
        from scripts.docs.markdown_support import parse
        return not any(fence.language.lower() == "mermaid" for path in discover(root, {".md"}) for fence in parse(read_text(path)).fences)
    suffixes = {
        "java-comments": {".java"}, "python-comments": {".py"},
        "web-comments": {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue"},
    }.get(gate.name)
    if suffixes is None:
        return False
    files = {path.relative_to(root).as_posix() for path in discover(root, suffixes)}
    if gate.name == "java-comments":
        from scripts.common.repository_layout import is_java_source
        files = {name for name in files if is_java_source(name)}
    elif gate.name == "python-comments":
        from scripts.code.python.check_staged_python_comments import _is_checkable_python_path
        files = {name for name in files if _is_checkable_python_path(name)}
    else:
        files = {name for name in files if not name.endswith(".d.ts")}
    if not git(root, "rev-parse", "--revs-only", "HEAD").strip():
        return not files
    changes = git(root, "diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", "HEAD", "--")
    untracked = git(root, "ls-files", "--others", "--exclude-standard", "-z")
    selected = set((changes + untracked).decode("utf-8").split("\0"))
    return not files.intersection(selected)


def parse_result(gate: Gate, code: int, source: bytes) -> tuple[str, int | None, str, tuple[dict[str, object], ...]]:
    """核对计数、诊断与退出码的一致性；零对象必须由登记理由明确解释。

    Args:
        gate: 已登记的检查及其零对象政策。
        code: 实际子进程退出码。
        source: 子进程标准输出，错误输出不能充当结构化结果。
    Returns:
        状态、实际计数、原因及不含原文的诊断位置。
    Raises:
        CheckError: 协议缺失、格式无效或子进程状态自相矛盾。
    """
    try:
        value = json.loads(source.decode("utf-8"))
    except (ValueError, UnicodeError) as error:
        raise CheckError("检查未返回有效的结构化计数协议") from error
    if not isinstance(value, dict) or value.get("protocol") != PROTOCOL:
        raise CheckError("检查结果协议版本不匹配")
    checked, findings = value.get("checked"), value.get("findings")
    if type(checked) is not int or checked < 0 or not isinstance(findings, list):
        raise CheckError("检查结果缺少合法对象计数或诊断集合")
    if not isinstance(value.get("check"), str) or not value["check"]:
        raise CheckError("检查结果缺少检查身份")
    expected = "failed" if findings else "passed" if checked else "not-applicable"
    if value.get("status") != expected or code != (1 if findings else 0):
        raise CheckError("检查退出码、对象计数和声明状态不一致")
    diagnostics = []
    for finding in findings:
        if (
            not isinstance(finding, dict)
            or any(not isinstance(finding.get(key), str) for key in ("path", "rule"))
            or type(finding.get("line")) is not int or finding["line"] < 0
        ):
            raise CheckError("检查诊断缺少可复核的位置")
        diagnostics.append({key: finding[key] for key in ("path", "line", "rule")})
    if expected == "not-applicable":
        if gate.zero_reason is None:
            return "environment-error", 0, "已选择检查未发现任何对象；请核对根目录和扫描范围", ()
        return expected, 0, gate.zero_reason, ()
    return expected, checked, "", tuple(diagnostics)


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
        包含真实命令、对象计数和耗时；环境问题和超时分别保留。
    """
    started = time.monotonic()
    arguments = command_for(gate, root)
    checked = None
    diagnostics: tuple[dict[str, object], ...] = ()
    reason = ""
    process_code = None
    try:
        result = run_process(
            arguments,
            root,
            timeout=timeout,
            env={**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1"},
            cancel=cancel,
        )
        code = result.code
        process_code = result.code
        output = (result.stdout + result.stderr).decode("utf-8", errors="replace")
        if code in {0, 1}:
            status, checked, reason, diagnostics = parse_result(gate, code, result.stdout)
            if status == "not-applicable" and not zero_scope_confirmed(gate, root):
                status, reason = "environment-error", "子检查报告零对象，但独立范围清单仍存在适用对象"
        else:
            status, reason = "environment-error", "子检查未完成，保留实际非规则退出码"
    except CheckTimeout as exc:
        code, output, status, reason = 2, str(exc), "timeout", "检查超过约定时限，子进程已终止"
    except CheckError as exc:
        code, output, status, reason = 2, str(exc), "environment-error", str(exc)
    except (OSError, UnicodeError) as exc:
        # 输出与原因都保留真实异常文本，避免"检查未完成"无法定位到具体路径或编码问题。
        detail = str(exc).strip() or type(exc).__name__
        code, output, status, reason = 2, detail, "environment-error", f"独立范围清单无法读取，检查未完成：{detail}"
    return Outcome(gate.name, status, code, round(time.monotonic() - started, 3), output, checked, tuple(arguments), str(root), reason, gate.scope, diagnostics, process_code=process_code)


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
                if any(outcomes[dependency].status not in {"passed", "not-applicable"} for dependency in gate.dependencies):
                    outcomes[name] = Outcome(name, "not-run", 1, 0, "前置检查未通过", command=tuple(command_for(gate, root)), cwd=str(root), reason="dependency-failed", scope=gate.scope, attempted=False)
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
    """环境或超时返回 2，失败/未执行/全组无实测对象返回 1，其余返回 0。"""
    if any(result.status in {"environment-error", "timeout"} for result in outcomes):
        return 2
    if any(
        result.status == "passed" and (type(result.checked) is not int or result.checked <= 0)
        or result.status == "not-applicable" and result.checked != 0
        for result in outcomes
    ):
        return 2
    if any(result.status not in {"passed", "not-applicable"} for result in outcomes):
        return 1
    if not any(result.status == "passed" and type(result.checked) is int and result.checked > 0 for result in outcomes):
        return 1
    return 0


def persisted_outcome(outcome: Outcome) -> dict[str, object]:
    """保存结果与输出摘要，去除可能含有源码片段或凭据的原始输出正文。"""
    value = asdict(outcome)
    output = value.pop("output")
    value["output_sha256"] = hashlib.sha256(str(output).encode("utf-8")).hexdigest()
    return value


def run_with_evidence(gates: list[Gate], root: Path, jobs: int, timeout: float) -> tuple[dict[str, object], list[Outcome]]:
    """在执行前后核对同一工作树及规则内容，输入变化时拒绝签发有效成功。

    Args:
        gates: 完整预期检查集合，包含已补齐的依赖。
        root: 实际检查工作目录。
        jobs: 子检查并发上限。
        timeout: 单项检查超时秒数。
    Returns:
        不含源码正文的证据与用于本次终端显示的原始结果；失败也保留真实状态。
    """
    started = datetime.now(timezone.utc).isoformat()
    before: dict[str, object] | None = None
    after: dict[str, object] | None = None
    evidence_error = ""
    try:
        before = check_evidence.snapshot(root, DEFAULT_ROOT)
    except (CheckError, OSError, UnicodeError) as error:
        # 快照失败必须能定位到具体原因，否则"未运行检查"无法与真实规则失败区分。
        evidence_error = f"input-snapshot-failed:{type(error).__name__}:{(str(error).strip() or '无附加信息')}"
        outcomes = [Outcome(gate.name, "not-run", 2, 0, "输入快照失败，未运行检查", command=tuple(command_for(gate, root)), cwd=str(root), reason=evidence_error, scope=gate.scope, attempted=False) for gate in gates]
    else:
        outcomes = schedule(gates, root, jobs, timeout)
        try:
            after = check_evidence.snapshot(root, DEFAULT_ROOT)
        except (CheckError, OSError, UnicodeError) as error:
            evidence_error = f"final-snapshot-failed:{type(error).__name__}:{(str(error).strip() or '无附加信息')}"
    consistent = before is not None and after is not None and before == after
    if not consistent and not evidence_error:
        evidence_error = "inputs-changed-during-checks"
    code = combined_code(outcomes) if consistent else 2
    report: dict[str, object] = {
        "schema": check_evidence.SCHEMA,
        "started_at": started,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "root": str(root),
        "input_mode": "worktree",
        "selection": [asdict(gate) for gate in gates],
        "execution": {"jobs": jobs, "timeout_seconds": timeout},
        "before": before, "after": after,
        "inputs_consistent": consistent,
        "evidence_error": evidence_error,
        "code": code,
        "status": "passed" if code == 0 else "invalid-evidence" if not consistent else "not-verified" if all(result.status == "not-applicable" for result in outcomes) else "failed",
        "results": [persisted_outcome(result) for result in outcomes],
    }
    return report, outcomes


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
    arguments.add_argument(
        "--group", choices=("all", "docs", "comments", "boundaries"), default="all"
    )
    arguments.add_argument("--checks", nargs="+", default=[], help="指定检查名，自动补齐前置检查")
    arguments.add_argument("--jobs", type=positive_integer, default=3)
    arguments.add_argument("--timeout", type=positive_integer, default=180)
    arguments.add_argument("--list", action="store_true")
    arguments.add_argument("--json", action="store_true")
    arguments.add_argument("--report", type=Path, help="显式保存可复核 JSON 证据，路径必须位于输入目录外")
    args = arguments.parse_args()
    gates = select_gates(args.checks, args.group)
    if args.list:
        print(json.dumps([asdict(gate) for gate in gates], ensure_ascii=False, indent=2))
        return 0
    root = args.root.resolve()
    if args.report is not None:
        check_evidence.validate_destination(args.report.resolve(), root, DEFAULT_ROOT)
    report, outcomes = run_with_evidence(gates, root, args.jobs, args.timeout)
    code = int(report["code"])
    if args.report is not None:
        check_evidence.write_report(args.report.resolve(), report)
    if args.json:
        print(
            json.dumps(
                {"code": code, "status": report["status"], "inputs_consistent": report["inputs_consistent"], "evidence_error": report["evidence_error"], "results": [asdict(result) for result in outcomes]},
                ensure_ascii=False,
            )
        )
    else:
        for result in outcomes:
            print(f"{result.name}: {result.status} ({result.seconds:.3f}s)")
            if result.output:
                print(result.output.rstrip())
            if result.reason:
                print(result.reason)
        print(
            f"汇总：{report['status']}；{sum(result.status == 'passed' for result in outcomes)}/{len(outcomes)} 项有实际对象并通过，退出码 {code}。"
        )
        if report["evidence_error"]:
            print(f"证据无效：{report['evidence_error']}")
    return code


if __name__ == "__main__":
    raise SystemExit(entry(main))
