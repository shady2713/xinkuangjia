"""从独立采集的 GitHub 记录核对 PR 的 CI、真实附件集成和制品来源。

@author Codex
"""

import hashlib
import io
import json
from pathlib import Path
import zipfile

WORKFLOWS = {
    "ci": (
        "ci.yml", "acceptance-proof", ("acceptance.json", "skill-evidence.json"),
        {
            "backend (Maven quality-gate)": ("Maven quality-gate verify",),
            "frontend (unit + typecheck + lint + build)": (
                "Shared frontend quality, test, build and security gates",
                "Critical browser E2E path (production preview)",
            ),
            "docs + comments": ("Docs checks (with mermaid)", "Comments checks", "PR slice size guard"),
            "pytest (scripts/tests)": ("Pytest tooling tests",),
            "secrets scan (staged-equivalent)": ("Scan changed files for secrets",),
            "acceptance": (
                "Plan slice verification", "Assemble acceptance evidence",
                "Skills report (strict)", "Upload acceptance proof",
            ),
        },
    ),
    "attachment": (
        "attachment-integration.yml", "attachment-integration-summary", ("attachment-integration-summary.json",),
        {"real-attachment-it": (
            "Run RealAttachmentServiceIT", "Write sanitized summary", "Upload summary artifact",
            "Enforce at least one successful test without skips",
        )},
    ),
}
CI_SUITE_STEPS = ("backend/maven_verify", "frontend/frontend_gates", "frontend/browser_e2e", "pytest/pytest_tests")
MAX_BYTES = 8 * 1024 * 1024


def require(condition, message):
    """中止核验并返回固定诊断，避免把制品内容写入日志。"""
    if not condition:
        raise ValueError(message)


def positive_int(value):
    """判断 GitHub ID、尝试号或执行计数是否为正整数。"""
    return type(value) is int and value > 0


def distinct_object(pairs):
    """拒绝可能被消费者解释为不同值的重复 JSON 键。"""
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate JSON key")
        result[key] = value
    return result


def parse(data, kind):
    """解析结构化证据并验证外层类型及数组记录。"""
    result = json.loads(data, object_pairs_hook=distinct_object)
    require(isinstance(result, kind), "invalid JSON shape")
    if kind is list:
        require(all(isinstance(item, dict) for item in result), "invalid list entry")
    return result


def read_limited(path):
    """读取有界的快照文件，限制外部输入在核验时占用的内存。"""
    with path.open("rb") as source:
        data = source.read(MAX_BYTES + 1)
    require(len(data) <= MAX_BYTES, "snapshot file too large")
    return data


def records(path, kind):
    """从已有独立快照读取指定类型的 GitHub API 数据。"""
    return parse(read_limited(path), kind)


def matching(items, key, value):
    """查找唯一记录，缺失或出现多个匹配项时中止。"""
    require(isinstance(items, list), "missing record list")
    matches = [item for item in items if isinstance(item, dict) and item.get(key) == value]
    require(len(matches) == 1, f"missing or ambiguous {key} record")
    return matches[0]


def succeeded(record):
    """要求 GitHub 明确记录执行完成且结论通过。"""
    return record.get("status") == "completed" and record.get("conclusion") == "success"


def matches_pr(association, pr):
    """核对运行关联记录的 PR 编号及两侧仓库、分支和提交。"""
    return isinstance(association, dict) and association.get("number") == pr["number"] and all(
        isinstance(association.get(side), dict)
        and association[side].get("sha") == pr[side]["sha"]
        and association[side].get("ref") == pr[side]["ref"]
        and isinstance(association[side].get("repo"), dict)
        and association[side]["repo"].get("id") == pr[side]["repo"]["id"]
        for side in ("base", "head")
    )


def _matches_fork_run(item, pr):
    """在 Fork PR 场景下 GitHub REST API 返回空 pull_requests，按源仓库与分支匹配运行记录。"""
    head_repo = item.get("head_repository")
    return (
        pr["head"]["repo"]["id"] != pr["base"]["repo"]["id"]
        and item.get("pull_requests") == []
        and isinstance(head_repo, dict)
        and head_repo.get("id") == pr["head"]["repo"]["id"]
        and item.get("head_branch") == pr["head"]["ref"]
    )


def latest_run(runs, run, pr, allowed_shas):
    """从完整工作流列表选择同版本最新一次运行，并核对最新尝试与结论。"""
    candidates = []
    for item in runs:
        repository = item.get("repository")
        links = item.get("pull_requests")
        pr_matched = (
            isinstance(links, list) and any(matches_pr(link, pr) for link in links)
        ) or _matches_fork_run(item, pr)
        if (item.get("workflow_id") == run["workflow_id"]
                and item.get("event") == "pull_request" and item.get("head_sha") in allowed_shas
                and isinstance(repository, dict) and repository.get("id") == run["repository"]["id"]
                and repository.get("full_name") == run["repository"]["full_name"]
                and pr_matched):
            require(positive_int(item.get("run_number")) and positive_int(item.get("id"))
                    and positive_int(item.get("run_attempt")), "invalid workflow run history identity")
            candidates.append(item)
    require(candidates, "missing workflow run history")
    top = max(item["run_number"] for item in candidates)
    latest = matching(candidates, "run_number", top)
    require(succeeded(latest), "latest workflow run did not succeed")
    require(all(latest.get(key) == run.get(key) for key in ("id", "run_number", "run_attempt")),
            "selected run or attempt is not current")


def check_jobs(jobs, expected, run, allowed_shas):
    """从按尝试号独立采集的作业列表核对必过作业与步骤。"""
    run_url = f"https://api.github.com/repos/{run['repository']['full_name']}/actions/runs/{run['id']}"
    for name, steps in expected.items():
        job = matching(jobs, "name", name)
        require(positive_int(job.get("id")) and succeeded(job) and job.get("run_id") == run["id"]
                and job.get("head_sha") in allowed_shas
                and job.get("run_attempt", run["run_attempt"]) == run["run_attempt"]
                and job.get("run_url") == run_url,
                f"job failed or belongs to a different run: {name}")
        for name_step in steps:
            require(succeeded(matching(job.get("steps"), "name", name_step)), f"required step failed: {name_step}")


def check_archive(folder, names, artifact):
    """核对 GitHub 记录的摘要，在内存中读取唯一的预期 ZIP 成员。"""
    raw = read_limited(folder / "proof.zip")
    require(len(raw) == artifact.get("size_in_bytes")
            and artifact.get("digest") == "sha256:" + hashlib.sha256(raw).hexdigest(),
            "artifact size or SHA-256 mismatch")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        require(sorted(entry.filename for entry in entries) == sorted(names), "artifact members mismatch")
        require(all(entry.file_size <= MAX_BYTES for entry in entries), "artifact member too large")
        parsed = {}
        for entry in entries:
            with archive.open(entry) as member:
                member_data = member.read(MAX_BYTES + 1)
            require(len(member_data) <= MAX_BYTES, "artifact member too large")
            parsed[entry.filename] = parse(member_data, dict)
        return parsed


def check_ci_status(proofs):
    """确认两份 CI 成功制品包含通过结论和实际执行的必跑套件。"""
    acceptance, skills = (proofs[name] for name in ("acceptance.json", "skill-evidence.json"))
    require(acceptance.get("ok") is True and acceptance.get("reasons") == [],
            "acceptance proof failed")
    require(skills.get("schema") == "skill-evidence/v1" and skills.get("result") == "passed"
            and bool(skills.get("skills")), "skills proof failed")
    for name in CI_SUITE_STEPS:
        step = acceptance["steps"][name]
        counts = step["counts"]
        require(step["outcome"] == step["conclusion"] == "success"
                and positive_int(counts.get("passed")) and type(counts.get("failed", 0)) is int
                and counts.get("failed", 0) == 0, f"suite evidence failed: {name}")


def check_attachment_status(proofs):
    """要求附件作业用实际服务版本执行至少一次完整且成功的集成测试。"""
    summary = proofs["attachment-integration-summary.json"]
    zero_fields = ("failures", "errors", "skipped")
    counts = summary["surefire"]
    versions = summary["service_versions"]
    require(summary.get("conclusion") == summary.get("test_outcome") == "success"
            and summary.get("gate_passed") is True
            and isinstance(counts, dict)
            and positive_int(counts.get("tests"))
            and all(type(counts.get(key)) is int and counts[key] == 0 for key in zero_fields)
            and isinstance(versions, dict)
            and all(isinstance(versions.get(svc), str) and versions[svc].strip()
                    for svc in ("mysql", "redis", "minio", "nginx")),
            "attachment integration proof failed")


def check_workflow(folder, config, event, checkout):
    """按仓库、PR、版本和工作流身份核验一次运行并返回可审计标识。"""
    filename, prefix, names, expected_jobs = config
    repo, pr = event["repository"], event["pull_request"]
    number = pr["number"]
    expected_path = f".github/workflows/{filename}"
    merge_ref = f"refs/pull/{number}/merge"
    workflow = records(folder / "workflow.json", dict)
    run = records(folder / "run.json", dict)
    base, head = pr["base"], pr["head"]
    allowed_shas = (head["sha"], checkout)
    head_ref = head["ref"]
    require(workflow.get("path") == expected_path and positive_int(workflow.get("id"))
            and run.get("workflow_id") == workflow["id"]
            and run.get("path") in (expected_path, f"{expected_path}@{merge_ref}",
                                    f"{expected_path}@{head_ref}", f"{expected_path}@refs/heads/{head_ref}"),
            "wrong workflow source")
    require(run.get("event") == "pull_request" and succeeded(run)
            and positive_int(run.get("id")) and positive_int(run.get("run_attempt"))
            and run.get("head_sha") in allowed_shas
            and run["repository"]["id"] == repo["id"] and run["repository"]["full_name"] == repo["full_name"]
            and run["head_repository"]["id"] == head["repo"]["id"], "wrong or unsuccessful workflow run")
    if not _matches_fork_run(run, pr):
        association = matching(run.get("pull_requests"), "number", number)
        require(matches_pr(association, pr), "wrong PR base or head")
    latest_run(records(folder / "runs.json", list), run, pr, allowed_shas)
    check_jobs(records(folder / "jobs.json", list), expected_jobs, run, allowed_shas)
    artifact = matching(records(folder / "artifacts.json", list), "name", f"{prefix}-{run['run_attempt']}")
    run_info = artifact["workflow_run"]
    require(artifact.get("expired") is False and positive_int(artifact.get("id"))
            and run_info.get("id") == run["id"] and run_info.get("repository_id") == repo["id"]
            and run_info.get("head_repository_id") == head["repo"]["id"]
            and run_info.get("head_sha") == run["head_sha"], "wrong or expired artifact")
    proofs = check_archive(folder, names, artifact)
    stamp = {
        "repository": repo["full_name"], "pr_number": number, "pr_base_sha": base["sha"],
        "pr_head_sha": head["sha"], "tested_sha": checkout, "event_name": "pull_request",
        "workflow_ref": f"{repo['full_name']}/{expected_path}@{merge_ref}",
        "run_id": str(run["id"]), "run_attempt": str(run["run_attempt"]),
    }
    for proof in proofs.values():
        require(positive_int(proof.get("pr_number")) and all(proof.get(key) == value for key, value in stamp.items()),
                "artifact identity mismatch")
    if filename == "ci.yml":
        check_ci_status(proofs)
    else:
        check_attachment_status(proofs)
    return {"workflow_id": workflow["id"], "run_id": run["id"], "run_number": run["run_number"],
            "run_attempt": run["run_attempt"], "artifact_id": artifact["id"], "artifact_digest": artifact["digest"]}


def verify(snapshot, event, checkout):
    """核对 PR 元数据和两组托管证据，失败时返回无输入内容的诊断。"""
    try:
        repo, pr = event["repository"], event["pull_request"]
        require(pr.get("state") == "open" and positive_int(pr.get("number"))
                and pr.get("merge_commit_sha") == checkout and positive_int(repo.get("id"))
                and repo["id"] == pr["base"]["repo"]["id"]
                and repo["full_name"] == pr["base"]["repo"]["full_name"]
                and pr["base"]["ref"] == "main", "invalid open PR metadata or test merge SHA")
        return {label: check_workflow(Path(snapshot) / label, config, event, checkout)
                for label, config in WORKFLOWS.items()}
    except (ValueError, OSError, KeyError, TypeError, AttributeError, RuntimeError, zipfile.BadZipFile) as exc:
        message = exc.args[0] if type(exc) is ValueError and exc.args else "missing or malformed snapshot data"
        raise SystemExit(f"trusted gate: CI proof rejected ({message})") from None
