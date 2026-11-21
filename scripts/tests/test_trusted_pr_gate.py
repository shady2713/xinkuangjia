"""验证首个 PR 的受信门禁可脱离候选代码运行。

@author Codex
"""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

from scripts.common.quality_common import DEFAULT_ROOT

SOURCES = (
    "scripts/workflow/run_trusted_pr_gate.py",
    "scripts/workflow/verify_pr_review.py",
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


def test_first_pr_uses_trusted_release_and_binds_both_parents(tmp_path: Path, pr_objects) -> None:
    """从裸仓库读取候选，确认旧签收和缺少规则复核均无法通过。"""
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
    pull = {"number": 1, "user": actor, "base": {"sha": base}, "head": {"sha": head}}
    event.write_text(json.dumps({"repository": {"owner": actor}, "pull_request": pull}), encoding="utf-8")
    reviews.write_text("[[]]", encoding="utf-8")
    receipt = "pr-review-receipt v1 type={} pr=1 head={} base={} review=fixture-readonly access=readonly"
    approvals = [{"id": n, "author_association": "OWNER", "user": actor, "body": receipt.format(kind, head, base)}
                 for n, kind in ((1, "pass"), (2, "security-rules"))]
    command = [sys.executable, "-I", "-B", str(release / SOURCES[0]), "--repo", str(bare),
               "--event", str(event), "--checkout-sha", merge, "--comments", str(comments),
               "--reviews", str(reviews), "--mode", "solo"]
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
