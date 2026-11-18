"""验证 CI 基线解析、工具测试 job 与前端门禁步骤。

直接执行 workflow 中对应步骤的 shell，避免只断言 YAML 文本或退出码。
@author 李杰
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import yaml
from scripts.common.quality_common import DEFAULT_ROOT

WORKFLOW = DEFAULT_ROOT / ".github" / "workflows" / "ci.yml"
BASELINE_STEP = "Resolve comparison baseline"
CHECKOUT_ACTION = "actions/checkout@"
SETUP_PYTHON_ACTION = "actions/setup-python@"
PYTEST_COMMAND = "python -B -X utf8 -m pytest scripts/tests"
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


def action_step(job: dict, action: str) -> dict:
    """返回 job 中使用指定 Action 的唯一步骤，不写死会过时的大版本。"""
    matches = [step for step in job["steps"] if str(step.get("uses", "")).startswith(action)]
    assert len(matches) == 1, f"{job.get('name', 'job')} 必须使用一次 {action}"
    return matches[0]


def resolve_bash_executable() -> str:
    """优先使用 Git 自带 Bash，避免 Windows 系统目录中的 WSL 启动器在无子系统环境下失败。"""
    if os.name == "nt":
        git_executable = shutil.which("git")
        if git_executable:
            git_root = Path(git_executable).resolve().parents[1]
            for relative in ("bin/bash.exe", "usr/bin/bash.exe"):
                candidate = git_root / relative
                if candidate.is_file():
                    return str(candidate)
    found = shutil.which("bash")
    assert found is not None, "测试 CI 脚本需要可用的 bash 解释器"
    return found


def run_shell(script: str, root: Path, extra_env: dict[str, str] | None = None):
    """用 bash 执行步骤脚本，保留真实退出码和输出。"""
    effective_script = (
        'python3() { "$PYTEST_PYTHON_EXECUTABLE" "$@"; }\n' + script
        if os.name == "nt"
        else script
    )
    return subprocess.run(
        [resolve_bash_executable(), "-euo", "pipefail", "-c", effective_script],
        cwd=root,
        env={
            **os.environ,
            "PYTHONIOENCODING": "utf-8",
            "PYTEST_PYTHON_EXECUTABLE": Path(sys.executable).as_posix(),
            **(extra_env or {}),
        },
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


def test_all_jobs_share_one_checkout_version() -> None:
    """所有 job 使用同一 checkout 版本，只有需要历史的 job 取完整提交。"""
    jobs = workflow_jobs()
    checkouts = {name: action_step(job, CHECKOUT_ACTION) for name, job in jobs.items()}
    versions = {checkout["uses"] for checkout in checkouts.values()}
    assert len(versions) == 1
    assert next(iter(versions)).startswith(f"{CHECKOUT_ACTION}v")
    for name in ("docs-comments", "secrets-scan"):
        assert checkouts[name]["with"]["fetch-depth"] == 0
    for name in ("backend", "frontend", "pytest"):
        assert "fetch-depth" not in checkouts[name].get("with", {})


def test_comments_job_uses_baseline_and_installs_web_parser() -> None:
    """注释检查必须传入事件基线，并安装 Web 解析依赖而非静默跳过。"""
    job = workflow_jobs()["docs-comments"]
    checkout = action_step(job, CHECKOUT_ACTION)
    assert checkout["with"]["fetch-depth"] == 0
    uses = [step.get("uses", "") for step in job["steps"]]
    assert any("pnpm/action-setup" in item for item in uses)
    assert any("actions/setup-node" in item for item in uses)
    install = next(step for step in job["steps"] if step.get("name") == "Install web parser")
    assert install["working-directory"] == "前端代码/basic-framework-admin"
    assert "pnpm install --frozen-lockfile" in install["run"]
    comments = step_run("docs-comments", "Comments checks")
    assert "--base" in comments and "steps.baseline.outputs.sha" in comments


def test_pytest_job_installs_requirements_and_runs_suite() -> None:
    """工具测试 job 与文档 job 同 Python 版本，并准备真实 Node 解析依赖。"""
    jobs = workflow_jobs()
    job = jobs["pytest"]
    python_version = action_step(job, SETUP_PYTHON_ACTION)["with"]["python-version"]
    docs_version = action_step(jobs["docs-comments"], SETUP_PYTHON_ACTION)["with"]["python-version"]
    assert python_version == docs_version
    uses = [step.get("uses", "") for step in job["steps"]]
    assert any("pnpm/action-setup" in item for item in uses)
    assert any("actions/setup-node" in item for item in uses)
    assert step_run("pytest", "Install quality tooling") == (
        "python -m pip install -r tools/quality/requirements.txt"
    )
    install = next(step for step in job["steps"] if step.get("name") == "Install web parser")
    assert install["working-directory"] == "前端代码/basic-framework-admin"
    assert "pnpm install --frozen-lockfile" in install["run"]
    assert step_run("pytest", "Pytest tooling tests") == PYTEST_COMMAND


def test_frontend_job_runs_lint_after_install() -> None:
    """前端 job 在既有安装之后、构建之前执行契约与 lint 门禁，并在构建后扫描产物。"""
    job = workflow_jobs()["frontend"]
    assert job["defaults"]["run"]["working-directory"] == "前端代码/basic-framework-admin"
    steps = job["steps"]
    runs = [step.get("run") for step in steps]
    assert (
        runs.index("pnpm install --frozen-lockfile")
        < runs.index("pnpm api:check")
        < runs.index("pnpm lint")
        < runs.index("pnpm build:ele")
        < runs.index("pnpm quality:prod-scan")
    )


def test_pr_slice_size_guard_blocks_oversized_pr_without_override(tmp_path: Path) -> None:
    """超大非生成 PR 缺少 [slice-override] 时阻断，声明豁免或仅生成文件大改动时放行。"""
    repo = tmp_path / "repo"
    init_repository(repo)
    (repo / "README.md").write_text("# 基线\n", encoding="utf-8")
    base_sha = commit_all(repo, "base")

    # 1. 生成文件超过 600 行不计入预算
    gen = repo / "apps" / "web-ele" / "src" / "api" / "generated" / "api-types.d.ts"
    gen.parent.mkdir(parents=True)
    gen.write_text("\n".join(f"export type T{i} = string;" for i in range(700)) + "\n", encoding="utf-8")
    commit_all(repo, "generated")
    guard_script = step_run("docs-comments", "PR slice size guard")
    gen_res = run_shell(guard_script, repo, {"BASE_SHA": base_sha, "PR_BODY": "routine sync"})
    assert gen_res.returncode == 0, gen_res.stdout + gen_res.stderr

    # 2. 业务源码超过 600 行且无 [slice-override] 必须失败
    src = repo / "src" / "Oversized.java"
    src.parent.mkdir(parents=True)
    src.write_text("\n".join(f"// line {i}" for i in range(650)) + "\n", encoding="utf-8")
    commit_all(repo, "oversized")
    blocked = run_shell(guard_script, repo, {"BASE_SHA": base_sha, "PR_BODY": "missing rationale"})
    assert blocked.returncode == 1
    assert "exceeds 600-line slice budget" in blocked.stderr

    # 3. PR 描述显式附带 [slice-override] 时放行
    allowed = run_shell(
        guard_script,
        repo,
        {"BASE_SHA": base_sha, "PR_BODY": "Architecture baseline [slice-override]"},
    )
    assert allowed.returncode == 0, allowed.stdout + allowed.stderr


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
