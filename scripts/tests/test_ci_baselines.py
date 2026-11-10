"""验证 CI 基线解析：根提交密钥扫描与干净 checkout 的注释检查入口。

直接执行 workflow 中对应步骤的 shell，避免只断言 YAML 文本或退出码。
@author 李杰
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml
from scripts.common.quality_common import DEFAULT_ROOT

WORKFLOW = DEFAULT_ROOT / ".github" / "workflows" / "ci.yml"
BASELINE_STEP = "Resolve comparison baseline"
ZERO_SHA = "0" * 40


def workflow_jobs() -> dict:
    """读取真实 CI 工作流，测试执行的命令与线上保持一致。"""
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))["jobs"]


def step_run(job: str, name: str) -> str:
    """返回指定 job 中步骤的真实 shell 内容。"""
    for step in workflow_jobs()[job]["steps"]:
        if step.get("name") == name:
            return step["run"]
    raise AssertionError(f"工作流缺少步骤：{job}/{name}")


def run_shell(script: str, root: Path, extra_env: dict[str, str] | None = None):
    """用 bash 执行步骤脚本，保留真实退出码和输出。"""
    return subprocess.run(
        ["bash", "-euo", "pipefail", "-c", script],
        cwd=root,
        env={**os.environ, "PYTHONIOENCODING": "utf-8", **(extra_env or {})},
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=120,
    )


def git(root: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    """在临时仓库执行 Git 命令，失败时保留输出。"""
    return subprocess.run(
        ["git", "-C", str(root), *arguments],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=30,
    )


def init_repository(root: Path) -> None:
    """创建带固定身份的临时仓库。"""
    root.mkdir(parents=True)
    assert git(root, "init", "-b", "main").returncode == 0
    assert git(root, "config", "user.name", "质量门禁样本").returncode == 0
    assert git(root, "config", "user.email", "gate-probe@invalid.local").returncode == 0


def commit_all(root: Path, message: str, *, allow_empty: bool = False) -> str:
    """提交全部变更并返回提交标识。"""
    arguments = ["commit", "-m", message]
    if allow_empty:
        arguments.insert(1, "--allow-empty")
    assert git(root, "add", "-A").returncode == 0
    assert git(root, *arguments).returncode == 0
    return git(root, "rev-parse", "HEAD").stdout.strip()


def resolve_baseline(root: Path, tmp_path: Path, event_base: str) -> str:
    """执行工作流基线步骤并取出解析后的提交标识。"""
    output = tmp_path / "github-output"
    output.write_text("", encoding="utf-8")
    result = run_shell(
        step_run("secrets-scan", BASELINE_STEP),
        root,
        {"EVENT_BASE_SHA": event_base, "GITHUB_OUTPUT": str(output)},
    )
    assert result.returncode == 0, result.stdout + result.stderr
    match = re.search(r"^sha=([0-9a-f]{40})$", output.read_text(encoding="utf-8"), re.MULTILINE)
    assert match is not None
    return match.group(1)


def test_root_commit_secrets_are_scanned(tmp_path: Path) -> None:
    """初始 push 的根提交含固定凭据时必须被 CI 步骤报出并失败。"""
    repo = tmp_path / "repo"
    init_repository(repo)
    scanner = repo / "scripts/security/scan_staged_secrets.py"
    scanner.parent.mkdir(parents=True)
    shutil.copy2(DEFAULT_ROOT / "scripts/security/scan_staged_secrets.py", scanner)
    fake_password = "unit-" + "a" * 8
    config = repo / "config/prod.yaml"
    config.parent.mkdir()
    config.write_text(f"database:\n  password: {fake_password}\n", encoding="utf-8")
    commit_all(repo, "root")
    baseline = resolve_baseline(repo, tmp_path, ZERO_SHA)
    script = step_run("secrets-scan", "Scan changed files for secrets").replace(
        "${{ steps.baseline.outputs.sha }}", baseline
    )
    result = run_shell(script, repo)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "config/prod.yaml" in result.stderr
    assert "No changed files to scan." not in result.stdout


def test_empty_push_diff_still_succeeds(tmp_path: Path) -> None:
    """无文件变化的合法 push 保留成功，不把空差异误报成凭据。"""
    repo = tmp_path / "repo"
    init_repository(repo)
    (repo / "README.md").write_text("# 基线\n", encoding="utf-8")
    baseline_commit = commit_all(repo, "base")
    commit_all(repo, "empty", allow_empty=True)
    baseline = resolve_baseline(repo, tmp_path, baseline_commit)
    script = step_run("secrets-scan", "Scan changed files for secrets").replace(
        "${{ steps.baseline.outputs.sha }}", baseline
    )
    result = run_shell(script, repo)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "No changed files to scan." in result.stdout


def test_comments_job_uses_baseline_and_installs_web_parser() -> None:
    """注释检查必须传入事件基线，并安装 Web 解析依赖而非静默跳过。"""
    job = workflow_jobs()["docs-comments"]
    checkout = next(step for step in job["steps"] if step.get("uses") == "actions/checkout@v4")
    assert checkout["with"]["fetch-depth"] == 0
    uses = [step.get("uses", "") for step in job["steps"]]
    assert any("pnpm/action-setup" in item for item in uses)
    assert any("actions/setup-node" in item for item in uses)
    install = next(step for step in job["steps"] if step.get("name") == "Install web parser")
    assert install["working-directory"] == "前端代码/basic-framework-admin"
    assert "pnpm install --frozen-lockfile" in install["run"]
    comments = step_run("docs-comments", "Comments checks")
    assert "--base" in comments and "steps.baseline.outputs.sha" in comments


@pytest.mark.parametrize("event_base", ["", ZERO_SHA])
def test_baseline_step_falls_back_to_empty_tree(tmp_path: Path, event_base: str) -> None:
    """空基线或全零基线解析为可比较的空提交，而不是根提交自身。"""
    repo = tmp_path / "repo"
    init_repository(repo)
    (repo / "README.md").write_text("# 基线\n", encoding="utf-8")
    commit_all(repo, "root")
    baseline = resolve_baseline(repo, tmp_path, event_base)
    assert baseline != ZERO_SHA
    assert git(repo, "cat-file", "-t", baseline).stdout.strip() == "commit"
    assert git(repo, "diff", "--name-only", baseline, "HEAD").stdout.strip() == "README.md"
