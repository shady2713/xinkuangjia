"""复核本地质量证据的输入、规则、命令与完整执行集合，不重新运行业务检查。

报告只用于内容一致性验证，不是对报告作者或恶意篡改的签名认证。
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
from scripts.workflow.run_checks import Outcome, combined_code, command_for, select_gates


def validate_results(report: dict[str, object], root: Path) -> list[str]:
    """按当前固定注册表核对完整执行集合，拒绝漏项、命令变更和伪造零对象成功。"""
    selection, results = report.get("selection"), report.get("results")
    if not isinstance(selection, list) or not selection or not isinstance(results, list):
        return ["missing-execution-manifest"]
    names = [item.get("name") for item in selection if isinstance(item, dict)]
    if len(names) != len(selection) or any(not isinstance(name, str) for name in names) or len(set(names)) != len(names):
        return ["invalid-check-selection"]
    try:
        gates = select_gates(names, "all")
    except CheckError:
        return ["unknown-check-selection"]
    if check_evidence.digest(selection) != check_evidence.digest([asdict(gate) for gate in gates]):
        return ["check-registry-changed"]
    if len(results) != len(gates):
        return ["incomplete-check-results"]
    outcomes = []
    for gate, result in zip(gates, results):
        if not isinstance(result, dict) or result.get("name") != gate.name:
            return ["unexpected-check-result"]
        if result.get("command") != command_for(gate, root) or result.get("cwd") != str(root) or result.get("scope") != gate.scope:
            return ["execution-command-or-scope-mismatch"]
        status, count, code = result.get("status"), result.get("checked"), result.get("code")
        if not isinstance(status, str) or status not in {"passed", "failed", "not-applicable", "environment-error", "timeout", "not-run"} or type(code) is not int:
            return ["invalid-check-status"]
        if status == "passed" and (code != 0 or result.get("process_code") != 0 or type(count) is not int or count <= 0):
            return ["unproven-passing-result"]
        if status == "not-applicable" and (code != 0 or result.get("process_code") != 0 or type(count) is not int or count != 0 or not gate.zero_reason or result.get("reason") != gate.zero_reason):
            return ["unexplained-inapplicable-result"]
        if result.get("attempted") is not (status != "not-run"):
            return ["execution-attempt-mismatch"]
        if not isinstance(result.get("output_sha256"), str) or re.fullmatch(r"[0-9a-f]{64}", result["output_sha256"]) is None:
            return ["missing-output-digest"]
        if not isinstance(result.get("diagnostics"), list):
            return ["missing-diagnostic-manifest"]
        if status == "passed" and result["diagnostics"]:
            return ["passing-result-has-findings"]
        outcomes.append(Outcome(gate.name, status, code, 0, "", checked=count))
    code = combined_code(outcomes)
    if type(report.get("code")) is not int or report.get("code") != code:
        return ["summary-code-mismatch"]
    return [] if code == 0 and report.get("status") == "passed" else ["checks-not-passed"]


def verify(path: Path, root: Path) -> list[str]:
    """重新计算当前工作树与工具指纹，拒绝过时、执行期间变动或不完整的证据。

    Args:
        path: 用户指定的 JSON 证据文件。
        root: 本次明确指定的待验证根目录，不采纳报告内任意路径作为指令。
    Returns:
        无问题时为空；否则返回不包含源码正文的失效原因代码。
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
        return ["root-or-input-mode-mismatch"]
    before, after = report.get("before"), report.get("after")
    if report.get("inputs_consistent") is not True or report.get("evidence_error") or before != after or not isinstance(after, dict):
        return ["inputs-were-not-stable"]
    if after.get("digest") != check_evidence.digest(after.get("inputs")):
        return ["input-manifest-digest-mismatch"]
    problems = validate_results(report, root)
    current = check_evidence.snapshot(root, DEFAULT_ROOT)
    if current != after:
        problems.append("current-inputs-differ")
    return problems


def main() -> int:
    """输出证据复核结论；当前且完整通过返回 0，失效返回 1，无法复核返回 2。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    problems = verify(args.report.resolve(), args.root.resolve())
    value = {"status": "valid" if not problems else "invalid", "reasons": problems, "code": 1 if problems else 0}
    print(json.dumps(value, ensure_ascii=False) if args.json else "证据复核：" + value["status"] + ("；" + ", ".join(problems) if problems else ""))
    return value["code"]


if __name__ == "__main__":
    raise SystemExit(entry(main))
