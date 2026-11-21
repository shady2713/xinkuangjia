"""根据 CI 实际步骤结果生成技能行为验收记录。

Usage: python scripts/skills/record_skill_evidence.py --outcomes FILE [--root DIR] [--output FILE] [--strict]

Kept separate from verify_skill_metadata.py so static documentation checks never depend on
CI results. Nothing from skill metadata is executed and no network access happens: CI
assembly supplies outcomes for allowlisted job/step identifiers, and every declared
verification entry is mapped through VERIFICATION_GATES to its gate and pass criteria.

Outcomes file (JSON):
    {
      "head_sha": "<commit under test>",
      "steps": {
        "backend/maven_verify": {"outcome": "success"},
        "acceptance/slice_plan": {"outcome": "success", "sha": "<commit the plan covered>"}
      }
    }

Outcome values follow GitHub Actions step outcomes: success, failure, cancelled, skipped.
Behavior status: passed | failed | stale (success recorded for another commit) |
not-run (cancelled or skipped) | missing (no outcome supplied for the gate).

@author Claude Code
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Allow direct execution as a script by putting the repository root on sys.path.
if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.common.quality_common import CheckError, entry, read_text
from scripts.skills.verify_skill_metadata import (
    VERIFICATION_GATES,
    VerificationGate,
    collect,
    frontmatter,
    skill_folders,
)

REPORT_SCHEMA = "skill-evidence/v1"
SKILLS_DIR = ".agents/skills"
STEP_OUTCOMES = frozenset({"success", "failure", "cancelled", "skipped"})
KNOWN_GATES = frozenset(gate.gate_id for gate in VERIFICATION_GATES.values())
FAILING_STATUSES = frozenset({"failed", "stale"})


def parse_outcomes(data: object) -> tuple[str | None, dict[str, dict]]:
    """校验 CI 步骤结果结构及受验提交。

    Args:
        data: Decoded JSON produced by CI assembly from trusted job/step results.
    Returns:
        The head SHA (or None) and the outcome records keyed by ``job/step`` identifier.
    Raises:
        CheckError: The payload is malformed or names a gate outside the allowlist.
    """
    if not isinstance(data, dict):
        raise CheckError("outcomes must be a JSON object")
    head_sha = data.get("head_sha")
    if head_sha is not None and (not isinstance(head_sha, str) or not head_sha.strip()):
        raise CheckError("head_sha must be a non-empty string when present")
    steps = data.get("steps", {})
    if not isinstance(steps, dict):
        raise CheckError("steps must be an object keyed by job/step identifier")
    for gate_id, record in steps.items():
        if gate_id not in KNOWN_GATES:
            raise CheckError(f"unknown CI gate identifier: {gate_id}")
        outcome = record.get("outcome") if isinstance(record, dict) else None
        if not isinstance(outcome, str) or outcome not in STEP_OUTCOMES:
            raise CheckError(f"{gate_id}: outcome must be one of {', '.join(sorted(STEP_OUTCOMES))}")
        if record.get("sha") is not None and not isinstance(record["sha"], str):
            raise CheckError(f"{gate_id}: sha must be a string when present")
    return head_sha, steps


def behavior_status(gate: VerificationGate, record: dict | None, head_sha: str | None) -> str:
    """依据门禁结论与提交版本计算单项技能行为状态。"""
    if record is None:
        return "missing"
    outcome = record["outcome"]
    if outcome == "failure":
        return "failed"
    if outcome != "success":
        return "not-run"
    if gate.pins_head_sha and (head_sha is None or record.get("sha") != head_sha):
        return "stale"
    return "passed"


def summarize(statuses: list[str]) -> str:
    """汇总行为状态，任何失败优先于全部通过，其余标为待补验。"""
    if not statuses:
        return "undeclared"
    if any(status in FAILING_STATUSES for status in statuses):
        return "failed"
    if all(status == "passed" for status in statuses):
        return "passed"
    return "incomplete"


def build_report(root: Path, outcomes: object) -> dict:
    """把技能声明与允许的 CI 证据绑定并生成报告。

    Args:
        root: Repository root containing .agents/skills.
        outcomes: Decoded CI outcome payload, see the module docstring.
    Returns:
        JSON-serializable report with per-skill and per-behavior status.
    Raises:
        CheckError: Outcomes are malformed or skill metadata does not pass static validation.
    """
    root = root.resolve()
    if not (root / SKILLS_DIR).is_dir():
        raise CheckError(f"{SKILLS_DIR} not found under {root}")
    head_sha, steps = parse_outcomes(outcomes)
    # Only metadata that passes the static allowlist checks may contribute evidence.
    _, findings = collect(root, [SKILLS_DIR])
    if findings:
        raise CheckError(f"skill metadata has {len(findings)} finding(s); run verify_skill_metadata.py first")
    skills = []
    for folder in skill_folders(root, [SKILLS_DIR]):
        metadata = frontmatter(read_text(folder / "SKILL.md"))
        behaviors = []
        for command in metadata.get("verification", []):
            gate = VERIFICATION_GATES[command]
            record = steps.get(gate.gate_id)
            behaviors.append(
                {
                    "command": command,
                    "gate": gate.gate_id,
                    "criteria": gate.criteria,
                    "outcome": record["outcome"] if record else None,
                    "status": behavior_status(gate, record, head_sha),
                }
            )
        skills.append(
            {
                "skill": metadata["name"],
                "lifecycle": metadata.get("status", "active"),
                "result": summarize([item["status"] for item in behaviors]),
                "behaviors": behaviors,
            }
        )
    declared = [item["result"] for item in skills if item["result"] != "undeclared"]
    return {"schema": REPORT_SCHEMA, "head_sha": head_sha, "result": summarize(declared), "skills": skills}


def main() -> int:
    """读取 CI 结果并向指定文件或标准输出写入技能证据。"""
    cli = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    cli.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2], help="repository root")
    cli.add_argument("--outcomes", type=Path, required=True, help="JSON file with trusted CI step outcomes")
    cli.add_argument("--output", type=Path, help="write the report here instead of stdout")
    cli.add_argument("--strict", action="store_true", help="exit 1 unless the overall result is passed")
    args = cli.parse_args()
    if not args.outcomes.is_file():
        raise CheckError(f"outcomes file not found: {args.outcomes}")
    try:
        outcomes = json.loads(read_text(args.outcomes))
    except json.JSONDecodeError as exc:
        raise CheckError(f"outcomes file is not valid JSON: {exc.msg}") from exc
    result = build_report(args.root, outcomes)
    text = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
    return 1 if args.strict and result["result"] != "passed" else 0


if __name__ == "__main__":
    raise SystemExit(entry(main))
