#!/usr/bin/env python3
"""采集 GitHub Actions 实际步骤结果，并汇出关联同一运行和提交的验收制品。

record JOB  appends `proof=<compact JSON>` to GITHUB_OUTPUT for one job.
assemble    validates every job proof and writes acceptance.json plus skill-outcomes.json.

@author Claude Code
"""
import argparse
import glob
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

OUTCOMES = ("success", "failure", "cancelled", "skipped")
STATES = (None, *OUTCOMES)
COUNT_KEYS = {"passed", "failed", "skipped", "flaky"}
SKILL_IDS = ("backend/maven_verify", "frontend/frontend_gates", "frontend/browser_e2e",
             "docs-comments/docs_checks", "docs-comments/changed_comments")
REQUIRED_STEPS = {"backend": ("maven_verify",), "pytest": ("pytest_tests",), "secrets-scan": ("scan_history",),
                  "frontend": ("frontend_gates", "browser_e2e"), "independent-review": ("verify_review",),
                  "docs-comments": ("docs_checks", "changed_comments")}
COUNTED = {"backend/maven_verify", "pytest/pytest_tests", "frontend/frontend_gates", "frontend/browser_e2e"}
JUNIT_STEP = {"backend": "maven_verify", "pytest": "pytest_tests"}
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
SHA = re.compile(r"[0-9a-f]{40}")
STEP_ID = re.compile(r"[A-Za-z_][A-Za-z0-9_-]*")


def git(*args):
    """读取实际 checkout 或提交双亲供制品验收。"""
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout.strip()


def read(path):
    """按 UTF-8 读取证据输入，缺失或无法读取时返回空值。"""
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")
    except (OSError, TypeError):
        return None


def load_json(text):
    """解析受验环境提供的 JSON，遇到无效格式时返回空值。"""
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return None


def write_json(path, data):
    """将受控结构以稳定顺序保存为 UTF-8 JSON。"""
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def is_sha(value):
    """确认值是此仓库支持的完整 Git SHA。"""
    return isinstance(value, str) and SHA.fullmatch(value) is not None


def run_ids():
    """读取本次 GitHub 运行 ID 与重试次数。"""
    return os.environ.get("GITHUB_RUN_ID", ""), os.environ.get("GITHUB_RUN_ATTEMPT", "")


def native_plan(raw):
    """复用切片计划格式，仅保留可发布字段及跳过原因。"""
    try:
        plan = {k: raw[k] for k in ("base", "effective_base", "changed_files", "unmatched_files")}
        plan["steps"] = [s["name"] for s in raw["steps"]]
        plan["skipped_steps"] = [{"name": s["name"], "reason": s["reason"]} for s in raw["skipped_steps"]]
    except (KeyError, TypeError):
        return None
    lists = (plan["changed_files"], plan["unmatched_files"], plan["steps"])
    if not all(isinstance(x, list) and all(isinstance(t, str) for t in x) for x in lists):
        return None
    values = [plan["base"], plan["effective_base"], *(v for s in plan["skipped_steps"] for v in s.values())]
    return plan if all(isinstance(v, (str, type(None))) for v in values) else None


def junit_counts(pattern):
    """统计 Maven 或 pytest 的 JUnit 用例结果。"""
    files = sorted(glob.glob(pattern, recursive=True))
    if not files:
        return None, "junit report missing"
    counts = {"passed": 0, "failed": 0, "skipped": 0}
    for name in files:
        try:
            root = ET.parse(name).getroot()
        except (ET.ParseError, OSError):
            return None, "junit report malformed"
        for case in root.iter("testcase"):
            tags = {child.tag for child in case}
            key = "failed" if tags & {"failure", "error"} else "skipped" if "skipped" in tags else "passed"
            counts[key] += 1
    return counts, None


def vitest_counts(path):
    """过滤颜色编码后读取 Vitest 最终结果计数。"""
    text = read(path)
    if text is None:
        return None, "vitest log missing"
    # Use the last "Tests  N passed | M skipped (T)" summary Vitest prints.
    summaries = re.findall(r"^\s*Tests\s+(\d.*)$", ANSI.sub("", text), re.M)
    if not summaries:
        return None, "vitest summary missing"
    found = {k: re.search(rf"(\d+) {k}\b", summaries[-1]) for k in ("passed", "failed", "skipped")}
    return {k: int(m.group(1)) if m else 0 for k, m in found.items()}, None


def playwright_counts(path):
    """从 Playwright JSON 提取通过、失败、跳过与不稳定用例计数。"""
    text = read(path)
    if text is None:
        return None, "playwright report missing"
    try:
        stats = json.loads(text)["stats"]
        return {"passed": int(stats["expected"]), "failed": int(stats["unexpected"]),
                "flaky": int(stats.get("flaky", 0)), "skipped": int(stats["skipped"])}, None
    except (ValueError, KeyError, TypeError, AttributeError):
        return None, "playwright report malformed"


def record(args):
    """把当前作业的步骤和受验版本写入 GitHub 作业输出。"""
    raw = load_json(os.environ.get("CI_STEPS_JSON"))
    steps = {}
    for sid, step in (raw.items() if isinstance(raw, dict) else ()):
        step = step if isinstance(step, dict) else {}
        entry = {"outcome": step.get("outcome"), "conclusion": step.get("conclusion")}
        if entry["outcome"] == "skipped":
            entry["reason"] = "step skipped"
        steps[sid] = entry
    reports = ((JUNIT_STEP.get(args.job), junit_counts, args.junit), ("frontend_gates", vitest_counts, args.vitest_log),
               ("browser_e2e", playwright_counts, args.playwright))
    for sid, reader, source in reports:
        if source is not None and sid:
            entry = steps.setdefault(sid, {"outcome": None, "conclusion": None, "reason": "step missing"})
            entry["counts"], why = reader(source)
            if why:
                entry["counts_reason"] = why
    run_id, attempt = run_ids()
    proof = {"job": args.job, "status": os.environ.get("CI_JOB_STATUS"), "run_id": run_id,
             "run_attempt": attempt, "sha": git("rev-parse", "HEAD"), "steps": steps}
    if not isinstance(raw, dict):
        proof["reason"] = "CI_STEPS_JSON missing or malformed"
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as out:
        out.write("proof=" + json.dumps(proof, separators=(",", ":"), sort_keys=True) + "\n")
    return 0


def clean_step(step):
    """校验并提取受控的步骤状态和计数字段。"""
    if not isinstance(step, dict) or step.get("outcome") not in STATES or step.get("conclusion") not in STATES:
        return None
    counts = step.get("counts")
    if counts is not None and not (isinstance(counts, dict) and set(counts) <= COUNT_KEYS
                                   and all(type(v) is int and v >= 0 for v in counts.values())):
        return None
    clean = {"outcome": step.get("outcome"), "conclusion": step.get("conclusion")}
    if "counts" in step:
        clean["counts"] = counts
    for key in ("reason", "counts_reason"):
        if step.get(key) in ("step skipped", "step missing", "junit report missing", "junit report malformed",
                             "vitest log missing", "vitest summary missing", "playwright report missing",
                             "playwright report malformed"):
            clean[key] = step[key]
    return clean


def check_proof(name, need, expect):
    """核对依赖作业输出的运行、提交和步骤结构。"""
    result = need.get("result") if isinstance(need, dict) else None
    job = {"result": result if result in OUTCOMES else None}
    outputs = need.get("outputs") if isinstance(need, dict) else None
    text = outputs.get("proof") if isinstance(outputs, dict) else None
    if not text and job["result"] == "skipped":
        job["reason"] = "job skipped without proof"
        return job, {}, None
    proof = load_json(text)
    if not isinstance(proof, dict) or not isinstance(proof.get("steps"), dict):
        return job, {}, "proof missing or malformed"
    if proof.get("job") != name:
        return job, {}, "proof job mismatch"
    for key, want in expect.items():
        if not want or proof.get(key) != want:
            return job, {}, f"proof {key} mismatch"
    steps = {}
    for sid, step in proof["steps"].items():
        clean = clean_step(step)
        if clean is None or not STEP_ID.fullmatch(sid):
            return job, {}, "proof step malformed"
        steps[sid] = clean
    job["status"] = proof.get("status") if proof.get("status") in OUTCOMES else None
    return job, steps, None


def assemble(args):
    """校验实际受验版本和运行身份，生成验收及技能制品。"""
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    reasons = []
    run_id, attempt = run_ids()
    try:
        head = git("rev-parse", "HEAD")
    except (OSError, subprocess.CalledProcessError):
        head = None
    if not (run_id and attempt and is_sha(head)):
        reasons.append("run id, attempt or checkout sha unavailable")
    if os.environ.get("GITHUB_SHA", head) != head:
        reasons.append("checkout does not match GITHUB_SHA")
    event_name = os.environ.get("GITHUB_EVENT_NAME", "")
    pr_base = pr_head = None
    if event_name == "pull_request":
        # Only the base/head SHAs are read from the event; nothing else is copied.
        event = load_json(read(os.environ.get("GITHUB_EVENT_PATH")))
        try:
            pr_base, pr_head = (event["pull_request"][side]["sha"] for side in ("base", "head"))
        except (KeyError, TypeError):
            pr_base = pr_head = None
        if not (is_sha(pr_base) and is_sha(pr_head)):
            pr_base = pr_head = None
            reasons.append("pull_request event lacks base/head sha")
        elif not is_sha(head) or git("rev-list", "--parents", "-n", "1", head).split()[1:] != [pr_base, pr_head]:
            reasons.append("merge parents do not match pull_request base/head")
    plan = native_plan(load_json(read(args.plan)))
    if plan is None:
        reasons.append("slice plan missing or malformed")
    elif pr_base is not None and plan["base"] != pr_base:
        reasons.append("slice plan base does not match pull_request base")
    fatal = list(reasons)  # 版本、提交或计划无效时整份技能证据失效。
    needs = load_json(os.environ.get("CI_NEEDS_JSON"))
    if not isinstance(needs, dict):
        reasons.append("CI_NEEDS_JSON missing or malformed")
        needs = {}
    expect = {"run_id": run_id, "run_attempt": attempt, "sha": head}
    jobs, steps = {}, {}
    for name in sorted(set(REQUIRED_STEPS) | set(needs)):
        if name == "independent-review" and event_name == "push":
            jobs[name] = {"result": None, "reason": "intentionally skipped on push"}
            continue
        job, job_steps, why = check_proof(name, needs.get(name), expect)
        if not why and name in REQUIRED_STEPS and job["result"] != "success":
            why = f"required job {job['result']}"
        if why:
            job["reason"] = why
            reasons.append(f"{name}: {why}")
        jobs[name] = job
        steps.update({f"{name}/{sid}": step for sid, step in job_steps.items()})
        for sid in REQUIRED_STEPS.get(name, ()):
            step = job_steps.get(sid) or {}
            if step.get("outcome") not in OUTCOMES:
                reasons.append(f"{name}/{sid}: outcome missing")
            elif f"{name}/{sid}" in COUNTED and step["outcome"] != "skipped" and step.get("counts") is None:
                reasons.append(f"{name}/{sid}: counts missing")
    acceptance = {"ok": not reasons, "reasons": reasons, "event_name": event_name, "tested_sha": head,
                  "pr_base_sha": pr_base, "pr_head_sha": pr_head, "run_id": run_id, "run_attempt": attempt,
                  "plan": plan, "jobs": jobs, "steps": steps}
    write_json(out_dir / "acceptance.json", acceptance)
    skill_path = out_dir / "skill-outcomes.json"
    if fatal:
        skill_path.unlink(missing_ok=True)  # never leave stale or partial skill evidence behind
        return 1
    stamp = {"sha": head, "run_id": run_id, "run_attempt": attempt}
    skill = {sid: {"outcome": steps[sid]["outcome"], **stamp}
             for sid in SKILL_IDS if steps.get(sid, {}).get("outcome") in OUTCOMES}
    # slice_plan evidence comes from the plan file actually loaded above.
    skill["acceptance/slice_plan"] = {"outcome": "success", **stamp}
    write_json(skill_path, {"tested_sha": head, "run_id": run_id, "run_attempt": attempt, "steps": skill})
    return 1 if reasons else 0


def main(argv=None):
    """解析 CI 记录与汇总两个子命令。"""
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    rec = sub.add_parser("record", help="serialize one job's step proof into GITHUB_OUTPUT")
    rec.add_argument("job")
    rec.add_argument("--junit", help="JUnit XML glob for backend/maven_verify or pytest/pytest_tests")
    rec.add_argument("--vitest-log", help="Vitest log for the frontend_gates step")
    rec.add_argument("--playwright", help="Playwright JSON report for the browser_e2e step")
    asm = sub.add_parser("assemble", help="validate needs proofs and write acceptance evidence")
    asm.add_argument("--plan", required=True)
    asm.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    return record(args) if args.mode == "record" else assemble(args)


if __name__ == "__main__":
    sys.exit(main())
