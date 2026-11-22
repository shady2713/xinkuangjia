"""验证首个 PR 的受信门禁可脱离候选代码运行。

@author Codex
"""

from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

import pytest

from scripts.common.quality_common import DEFAULT_ROOT

SOURCES = (
    "scripts/workflow/run_trusted_pr_gate.py",
    "scripts/workflow/verify_pr_review.py",
    "scripts/workflow/trusted_ci.py",
    "scripts/security/scan_staged_secrets.py",
    "scripts/security/rules_scope.py",
)


def git(root: Path, *args: str) -> str:
    """在一次性测试仓库运行 Git 命令并返回输出。"""
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


@pytest.fixture
def pr_objects(tmp_path: Path) -> tuple[Path, str, str, str]:
    """创建无门禁基线、候选树及其同版本测试合并对象。"""
    source = tmp_path / "source"
    source.mkdir()
    git(source, "init", "-q")
    git(source, "config", "user.name", "Fixture")
    git(source, "config", "user.email", "fixture@example.invalid")
    (source / "README.md").write_text("synthetic fixture\n", encoding="utf-8")
    git(source, "add", "README.md")
    git(source, "commit", "-q", "-m", "baseline without gate")
    base = git(source, "rev-parse", "HEAD")
    # These files are candidate data. Even the harmless sentinel must never run.
    for relative in SOURCES:
        path = source / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        statement = 'RULESET_VERSION = "2026.14"\n' if path.name == "scan_staged_secrets.py" else ""
        path.write_text(statement + "raise SystemExit(42)\n", encoding="utf-8")
    git(source, "add", "scripts")
    git(source, "commit", "-q", "-m", "synthetic candidate")
    head = git(source, "rev-parse", "HEAD")
    tree = git(source, "rev-parse", "HEAD^{tree}")
    merge = git(source, "commit-tree", tree, "-p", base, "-p", head, "-m", "test merge")
    git(source, "update-ref", "refs/heads/fixture-merge", merge)
    return source, base, head, merge


def write_snapshot(root: Path, base: str, head: str, merge: str, fault: str = "") -> None:
    """按本地合成 GitHub 记录生成同版本、同尝试的作业和制品证据。"""
    import yaml

    repo = {"id": 29, "full_name": "fixture/example"}
    for index, (label, filename, proofs) in enumerate((
        ("ci", "ci.yml", ("acceptance.json", "skill-evidence.json")),
        ("attachment", "attachment-integration.yml", ("attachment-integration-summary.json",)),
    ), start=1):
        folder = root / label
        folder.mkdir(parents=True, exist_ok=True)
        workflow_path = f".github/workflows/{filename}"
        workflow = yaml.safe_load((DEFAULT_ROOT / workflow_path).read_text(encoding="utf-8"))
        workflow_id, run_id, attempt = 20 + index, 80 + index, 2
        association = {"number": 1, "base": {"sha": base, "ref": "main", "repo": repo},
                       "head": {"sha": head, "ref": "fix", "repo": repo}}
        run = {
            "id": run_id, "workflow_id": workflow_id, "path": f"{workflow_path}@refs/pull/1/merge",
            "run_number": 9, "run_attempt": attempt, "head_sha": head, "repository": repo,
            "head_repository": repo, "event": "pull_request", "pull_requests": [association],
            "status": "completed", "conclusion": "success",
        }
        jobs = [
            {"id": 100 + i, "run_id": run_id, "head_sha": head,
             "run_url": f"https://api.github.com/repos/fixture/example/actions/runs/{run_id}",
             "name": item.get("name", key), "status": "completed", "conclusion": "success",
             "steps": [{"name": step["name"], "status": "completed", "conclusion": "success"} for step in
                       item["steps"] if "name" in step and step.get("if") not in ("failure()", "failure() || cancelled()")]}
            for i, (key, item) in enumerate(workflow["jobs"].items())
        ]
        stamp = {
            "repository": repo["full_name"], "pr_number": 1, "pr_base_sha": base, "pr_head_sha": head,
            "tested_sha": merge, "event_name": "pull_request", "run_id": str(run_id), "run_attempt": str(attempt),
            "workflow_ref": f"{repo['full_name']}/{workflow_path}@refs/pull/1/merge",
        }
        bodies = {
            "acceptance.json": {"ok": True, "reasons": [], "steps": {
                step: {"outcome": "success", "conclusion": "success", "counts": {"passed": 2, "failed": 0}}
                for step in ("backend/maven_verify", "frontend/frontend_gates", "frontend/browser_e2e", "pytest/pytest_tests")
            }},
            "skill-evidence.json": {"schema": "skill-evidence/v1", "result": "passed", "skills": [{"id": "fixture"}]},
            "attachment-integration-summary.json": {
                "conclusion": "success", "test_outcome": "success", "gate_passed": True,
                "surefire": {"tests": 1, "failures": 0, "errors": 0, "skipped": 0},
                "service_versions": {name: "fixture version" for name in ("mysql", "redis", "minio", "nginx")},
            },
        }
        if label == "ci":
            if fault == "wrong repository":
                run["repository"] = {"id": 9, "full_name": "other/example"}
            if fault == "wrong workflow":
                run["path"] = ".github/workflows/other.yml@refs/pull/1/merge"
            if fault == "wrong base":
                run["pull_requests"] = [dict(association, base=dict(association["base"], sha=head))]
            if fault == "wrong PR":
                run["pull_requests"] = [dict(association, number=2)]
            if fault == "wrong head":
                run["head_sha"] = base
            if fault == "wrong merge":
                stamp["tested_sha"] = head
            if fault == "wrong attempt":
                stamp["run_attempt"] = "1"
            if fault == "wrong run":
                stamp["run_id"] = "1"
            if fault == "failed run":
                run["conclusion"] = "failure"
            if fault == "failed job":
                jobs[0]["conclusion"] = "failure"
            if fault == "skipped step":
                name = "Maven quality-gate verify"
                next(step for step in jobs[0]["steps"] if step["name"] == name)["conclusion"] = "skipped"
            if fault == "zero CI tests":
                bodies["acceptance.json"]["steps"]["pytest/pytest_tests"]["counts"]["passed"] = 0
            if fault == "missing skill":
                proofs = ("acceptance.json",)
        elif fault == "zero attachment tests":
            bodies["attachment-integration-summary.json"]["surefire"]["tests"] = 0
        with zipfile.ZipFile(folder / "proof.zip", "w") as package:
            for name in proofs:
                package.writestr(name, json.dumps({**stamp, **bodies[name]}))
        prefix = "acceptance-proof" if label == "ci" else "attachment-integration-summary"
        archive = (folder / "proof.zip").read_bytes()
        artifact = {"id": 200 + index, "name": f"{prefix}-{attempt}", "expired": False,
                    "digest": f"sha256:{sha256(archive).hexdigest()}", "size_in_bytes": len(archive),
                    "workflow_run": {"id": run_id, "repository_id": repo["id"],
                                     "head_repository_id": repo["id"], "head_sha": head}}
        if label == "attachment" and fault == "invalid digest":
            artifact["digest"] = f"sha256:{'a' * 64}"
        if label == "attachment" and fault == "missing artifact":
            artifact["name"] = "diagnostic-2"
        for name, body in (("run", run), ("runs", [run]), ("jobs", jobs), ("artifacts", [artifact]),
                           ("workflow", {"id": workflow_id, "path": workflow_path})):
            (folder / f"{name}.json").write_text(json.dumps(body), encoding="utf-8")


@pytest.fixture
def gate_command(tmp_path: Path, pr_objects):
    """构建受信发布目录、只读对象仓库和带两条签收的同版本输入。"""
    source, base, head, merge = pr_objects
    bare = tmp_path / "objects.git"
    git(tmp_path, "clone", "-q", "--bare", source.as_uri(), str(bare))
    assert git(bare, "ls-tree", "-r", base, "--", "scripts") == ""
    release = tmp_path / "trusted-release"
    for relative in SOURCES:
        path = release / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(DEFAULT_ROOT / relative, path)
    event, comments, reviews = (tmp_path / name for name in ("event.json", "comments.json", "reviews.json"))
    actor = {"type": "User", "login": "fixtureowner", "id": 42}
    repo = {"owner": actor, "id": 29, "full_name": "fixture/example"}
    pull = {"number": 1, "state": "open", "user": actor,
            "base": {"sha": base, "ref": "main", "repo": repo},
            "head": {"sha": head, "ref": "fix", "repo": repo},
            "merge_commit_sha": merge}
    event.write_text(json.dumps({"repository": repo, "pull_request": pull}), encoding="utf-8")
    reviews.write_text("[[]]", encoding="utf-8")
    receipt = "pr-review-receipt v1 type={} pr=1 head={} base={} review=fixture-readonly access=readonly"
    approvals = [{"id": n, "author_association": "OWNER", "user": actor, "body": receipt.format(kind, head, base)}
                 for n, kind in ((1, "pass"), (2, "security-rules"))]
    snapshot = tmp_path / "snapshot"
    command = [sys.executable, "-I", "-B", str(release / SOURCES[0]), "--repo", str(bare),
               "--event", str(event), "--checkout-sha", merge, "--comments", str(comments),
               "--reviews", str(reviews), "--mode", "solo", "--ci-snapshot", str(snapshot)]
    comments.write_text(json.dumps([approvals]), encoding="utf-8")
    return command, snapshot, source, comments, approvals, receipt


def test_first_pr_uses_trusted_release_and_binds_both_parents(gate_command, pr_objects) -> None:
    """从裸仓库读取候选，确认旧签收和缺少规则复核均无法通过。"""
    command, snapshot, source, comments, approvals, receipt = gate_command
    _, base, head, merge = pr_objects
    write_snapshot(snapshot, base, head, merge)
    for current, code in ((approvals[:1], 1), (approvals, 0)):
        comments.write_text(json.dumps([current]), encoding="utf-8")
        outcome = subprocess.run(command, cwd=source, env={**os.environ, "PYTHONPATH": str(source / "scripts/security")},
                                 check=False, capture_output=True, text=True, timeout=30)
        assert outcome.returncode == code, outcome.stdout + outcome.stderr
        gate = json.loads(outcome.stderr.splitlines()[-1])
        assert gate["secrets"] == 0 and gate["review"] == code
    approvals[0]["body"] = receipt.format("pass", base, base)
    comments.write_text(json.dumps([approvals]), encoding="utf-8")
    stale = subprocess.run(command, cwd=source, check=False, capture_output=True, text=True, timeout=30)
    assert stale.returncode == 1 and '"review": 1' in stale.stderr


@pytest.mark.parametrize("fault", [
    "missing snapshot", "wrong repository", "wrong workflow", "wrong PR", "wrong base", "wrong head",
    "wrong merge", "wrong run", "wrong attempt", "failed run", "failed job", "skipped step",
    "missing skill", "zero CI tests", "missing artifact", "invalid digest", "zero attachment tests",
])
def test_trusted_gate_rejects_incomplete_or_stale_ci(gate_command, pr_objects, fault) -> None:
    """独立门禁命令必须拒绝缺档、失败、错版本或过期尝试的证据。"""
    command, snapshot, source, *_ = gate_command
    _, base, head, merge = pr_objects
    if fault != "missing snapshot":
        write_snapshot(snapshot, base, head, merge, fault)
    result = subprocess.run(command, cwd=source, check=False, capture_output=True, text=True, timeout=30)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "Traceback" not in result.stderr, result.stderr


@pytest.mark.parametrize("label", ["ci", "attachment"])
@pytest.mark.parametrize(("latest_status", "want"), [
    ("current", 0), ("queued", 1), ("in_progress", 1), ("failure", 1), ("success", 1), ("rerun", 1),
])
def test_trusted_gate_requires_latest_matching_workflow_run(gate_command, pr_objects, label, latest_status, want):
    """两个工作流均按同版本最新运行和尝试验收，即使历史运行已成功。"""
    command, snapshot, source, *_ = gate_command
    _, base, head, merge = pr_objects
    write_snapshot(snapshot, base, head, merge)
    folder = snapshot / label
    run = json.loads((folder / "run.json").read_text())
    older = dict(run, id=run["id"] - 10, run_number=8)
    unrelated = dict(run, id=run["id"] + 40, run_number=30,
                     pull_requests=[dict(run["pull_requests"][0], number=2)])
    rows = [older, unrelated, run]
    if latest_status == "rerun":
        rows[-1] = dict(run, run_attempt=run["run_attempt"] + 1)
    elif latest_status != "current":
        status = latest_status if latest_status in ("queued", "in_progress") else "completed"
        rows.insert(0, dict(run, id=run["id"] + 10, run_number=10, status=status,
                            conclusion=latest_status if status == "completed" else None))
    (folder / "runs.json").write_text(json.dumps(rows), encoding="utf-8")
    result = subprocess.run(command, cwd=source, check=False, capture_output=True, text=True, timeout=30)
    assert result.returncode == want, result.stdout + result.stderr
    if want:
        assert "latest workflow run did not succeed" in result.stderr or "selected run or attempt is not current" in result.stderr


def test_attachment_checkout_depth_contains_merge_parents(tmp_path: Path, pr_objects) -> None:
    """用真实浅仓库验证附件作业配置可读取合并提交的双亲。"""
    import yaml

    source, base, head, merge = pr_objects
    config = yaml.safe_load((DEFAULT_ROOT / ".github/workflows/attachment-integration.yml").read_text(encoding="utf-8"))
    checkout = config["jobs"]["real-attachment-it"]["steps"][0]
    depth = checkout["with"]["fetch-depth"]
    assert depth != 1
    for limit, expected in [(1, [merge]), (depth, [merge, base, head])]:
        dest = tmp_path / f"depth-{limit}"
        options = ["--depth", str(limit)] if limit else []
        git(tmp_path, "clone", "-q", *options, "--branch", "fixture-merge", source.as_uri(), str(dest))
        assert git(dest, "rev-list", "--parents", "-n", "1", "HEAD").split() == expected


def test_trusted_gate_accepts_multiple_attachment_tests_and_fork_pr(
    gate_command, pr_objects, tmp_path: Path
) -> None:
    """附件集成支持多个成功用例，且 Fork PR 在 pull_requests 为空数组时凭制品与仓库身份通过。"""
    command, snapshot, source, *_ = gate_command
    _, base, head, merge = pr_objects
    write_snapshot(snapshot, base, head, merge)
    event_path = Path(command[command.index("--event") + 1])
    event_data = json.loads(event_path.read_text(encoding="utf-8"))
    fork_repo = {"id": 99, "full_name": "contributor/example"}
    event_data["pull_request"]["head"]["repo"] = fork_repo
    event_path.write_text(json.dumps(event_data), encoding="utf-8")

    for label in ("ci", "attachment"):
        folder = snapshot / label
        run = json.loads((folder / "run.json").read_text(encoding="utf-8"))
        run["head_repository"] = fork_repo
        run["head_branch"] = "fix"
        run["pull_requests"] = []
        (folder / "run.json").write_text(json.dumps(run), encoding="utf-8")
        (folder / "runs.json").write_text(json.dumps([run]), encoding="utf-8")
        artifacts = json.loads((folder / "artifacts.json").read_text(encoding="utf-8"))
        artifacts[0]["workflow_run"]["head_repository_id"] = fork_repo["id"]
        if label == "attachment":
            with zipfile.ZipFile(folder / "proof.zip", "r") as zin:
                payload = json.loads(zin.read("attachment-integration-summary.json"))
            payload["surefire"]["tests"] = 2
            with zipfile.ZipFile(folder / "proof.zip", "w") as zout:
                zout.writestr("attachment-integration-summary.json", json.dumps(payload))
            raw = (folder / "proof.zip").read_bytes()
            artifacts[0]["size_in_bytes"] = len(raw)
            artifacts[0]["digest"] = f"sha256:{sha256(raw).hexdigest()}"
        (folder / "artifacts.json").write_text(json.dumps(artifacts), encoding="utf-8")

    result = subprocess.run(command, cwd=source, check=False, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
