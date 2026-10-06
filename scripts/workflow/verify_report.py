"""复核本地质量证据的输入、规则、命令与完整执行集合，不重新运行业务检查。

报告只用于内容一致性验证，不是对报告作者或恶意篡改的签名认证。

协议与 ``run_checks`` 的 ``quality-check/v2`` 状态集合保持同步：维护完成态
``completed-with-registered-blockers``（执行完成、存在已登记阻断、无硬失败）可以被复核，
但它与 ``passed`` 分列，``state`` 字段明示来源验收并未通过；``failed`` 仍然被拒绝。
@author OpenAI Codex
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict
from pathlib import Path

if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.common.quality_common import DEFAULT_ROOT, CheckError, entry
from scripts.workflow import check_evidence
from scripts.workflow.run_checks import (
    CHECK_STATUS_MAINTENANCE,
    Outcome,
    combined_code,
    command_for,
    select_gates,
)

# 允许出现在报告里的逐项状态：既有六态 + v2 维护完成态。``failed`` 仍是受支持状态，
# 但它在汇总阶段与其他非通过状态一样被拒绝，不会因本集合扩大而被接受。
ALLOWED_STATUSES = frozenset(
    {
        "passed",
        "failed",
        "not-applicable",
        "environment-error",
        "timeout",
        "not-run",
        CHECK_STATUS_MAINTENANCE,
    }
)


def expected_command(
    gate: object,
    root: Path,
    result: dict[str, object],
    report_mode: object,
) -> list[str]:
    """重建该结果的预期命令，含报告显式声明的维护模式与来源报告输出路径。

    维护模式是调用方的显式选择，只能由报告自身声明；来源报告路径是**输出**位置，
    不参与判定，只从已记录的参数里取回并按固定入口重建，避免把任意命令当成有效执行。
    其他任何参数差异仍然按命令不符拒绝。
    """

    maintenance = report_mode == "maintenance"
    acceptance_report: Path | None = None
    command = result.get("command")
    if isinstance(command, list) and "--acceptance-report" in command:
        index = command.index("--acceptance-report")
        if index + 1 >= len(command) or not isinstance(command[index + 1], str):
            return []
        acceptance_report = Path(command[index + 1])
        if not acceptance_report.is_absolute():
            return []
    return command_for(
        gate, root, maintenance=maintenance, acceptance_report=acceptance_report
    )


def validate_results(report: dict[str, object], root: Path) -> tuple[list[str], str]:
    """按当前固定注册表核对完整执行集合，拒绝漏项、命令变更和伪造零对象成功。

    Returns:
        ``(失效原因代码列表, 状态)``；状态为 ``passed``、``completed-with-registered-blockers``
        或 ``failed``。前两者都表示证据当前且完整，但维护完成态**不**代表通过。
    """
    selection, results = report.get("selection"), report.get("results")
    if not isinstance(selection, list) or not selection or not isinstance(results, list):
        return ["missing-execution-manifest"], "failed"
    names = [item.get("name") for item in selection if isinstance(item, dict)]
    if len(names) != len(selection) or any(not isinstance(name, str) for name in names) or len(set(names)) != len(names):
        return ["invalid-check-selection"], "failed"
    try:
        gates = select_gates(names, "all")
    except CheckError:
        return ["unknown-check-selection"], "failed"
    if check_evidence.digest(selection) != check_evidence.digest([asdict(gate) for gate in gates]):
        return ["check-registry-changed"], "failed"
    if len(results) != len(gates):
        return ["incomplete-check-results"], "failed"
    execution = report.get("execution")
    report_mode = execution.get("mode") if isinstance(execution, dict) else None
    outcomes = []
    for gate, result in zip(gates, results):
        if not isinstance(result, dict) or result.get("name") != gate.name:
            return ["unexpected-check-result"], "failed"
        if result.get("command") != expected_command(gate, root, result, report_mode) or result.get("cwd") != str(root) or result.get("scope") != gate.scope:
            return ["execution-command-or-scope-mismatch"], "failed"
        status, count, code = result.get("status"), result.get("checked"), result.get("code")
        if not isinstance(status, str) or status not in ALLOWED_STATUSES or type(code) is not int:
            return ["invalid-check-status"], "failed"
        if status == "passed" and (code != 0 or result.get("process_code") != 0 or type(count) is not int or count <= 0):
            return ["unproven-passing-result"], "failed"
        if status == CHECK_STATUS_MAINTENANCE:
            # 维护完成态不是通过：必须真实执行、退出 0、有正对象、显式声明维护模式、
            # 存在已登记阻断且没有硬失败，否则不得以“已完成”名义进入有效集合。
            if code != 0 or result.get("process_code") != 0 or type(count) is not int or count <= 0:
                return ["unproven-maintenance-result"], "failed"
            if report_mode != "maintenance" or result.get("acceptance_mode") != "maintenance":
                return ["maintenance-mode-not-declared"], "failed"
            blockers = result.get("blockers")
            if not isinstance(blockers, list) or not blockers:
                return ["maintenance-result-without-registered-blockers"], "failed"
            if result.get("diagnostics"):
                return ["maintenance-result-has-hard-failures"], "failed"
        if status == "not-applicable" and (code != 0 or result.get("process_code") != 0 or type(count) is not int or count != 0 or not gate.zero_reason or result.get("reason") != gate.zero_reason):
            return ["unexplained-inapplicable-result"], "failed"
        if result.get("attempted") is not (status != "not-run"):
            return ["execution-attempt-mismatch"], "failed"
        if not isinstance(result.get("output_sha256"), str) or re.fullmatch(r"[0-9a-f]{64}", result["output_sha256"]) is None:
            return ["missing-output-digest"], "failed"
        if not isinstance(result.get("diagnostics"), list):
            return ["missing-diagnostic-manifest"], "failed"
        if status == "passed" and result["diagnostics"]:
            return ["passing-result-has-findings"], "failed"
        outcomes.append(Outcome(gate.name, status, code, 0, "", checked=count))
    code = combined_code(outcomes)
    if type(report.get("code")) is not int or report.get("code") != code:
        return ["summary-code-mismatch"], "failed"
    maintenance = [result for result in outcomes if result.status == CHECK_STATUS_MAINTENANCE]
    if code == 0 and report.get("status") == "passed" and not maintenance:
        return [], "passed"
    if code == 0 and report.get("status") == CHECK_STATUS_MAINTENANCE and maintenance:
        return [], CHECK_STATUS_MAINTENANCE
    return ["checks-not-passed"], "failed"


def verify(path: Path, root: Path) -> tuple[list[str], str]:
    """重新计算当前工作树与工具指纹，拒绝过时、执行期间变动或不完整的证据。

    Args:
        path: 用户指定的 JSON 证据文件。
        root: 本次明确指定的待验证根目录，不采纳报告内任意路径作为指令。
    Returns:
        ``(失效原因代码列表, 状态)``；无问题时状态为 ``passed`` 或
        ``completed-with-registered-blockers``，否则为 ``failed``。
    Raises:
        CheckError: 报告格式非法、过大或无法建立当前输入快照。
    """
    if path.stat().st_size > 32 * 1024 * 1024:
        raise CheckError("证据文件超过 32 MiB")
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, UnicodeError) as error:
        raise CheckError("证据文件不是有效 UTF-8 JSON") from error
    if not isinstance(report, dict) or report.get("schema") != check_evidence.SCHEMA:
        raise CheckError("证据协议版本不匹配")
    if report.get("root") != str(root) or report.get("input_mode") != "worktree":
        return ["root-or-input-mode-mismatch"], "failed"
    before, after = report.get("before"), report.get("after")
    if report.get("inputs_consistent") is not True or report.get("evidence_error") or before != after or not isinstance(after, dict):
        return ["inputs-were-not-stable"], "failed"
    if after.get("digest") != check_evidence.digest(after.get("inputs")):
        return ["input-manifest-digest-mismatch"], "failed"
    problems, state = validate_results(report, root)
    current = check_evidence.snapshot(root, DEFAULT_ROOT)
    if current != after:
        problems.append("current-inputs-differ")
        state = "failed"
    return problems, state


def main() -> int:
    """输出证据复核结论；当前且完整通过返回 0，失效返回 1，无法复核返回 2。

    维护完成态返回 0 但 ``state`` 明示存在已登记阻断、来源验收未通过；``failed`` 报告
    仍返回 1，不能被本入口接受为完成。
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    problems, state = verify(args.report.resolve(), args.root.resolve())
    valid = not problems
    value = {
        "status": "valid" if valid else "invalid",
        "state": state if valid else "failed",
        "reasons": problems,
        "code": 0 if valid else 1,
    }
    print(
        json.dumps(value, ensure_ascii=False)
        if args.json
        else "证据复核：" + value["status"] + f"（{value['state']}）" + ("；" + ", ".join(problems) if problems else "")
    )
    return value["code"]


if __name__ == "__main__":
    raise SystemExit(entry(main))
