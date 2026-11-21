"""验证 CI 基线解析、工具测试 job 与前端门禁步骤。

直接执行 workflow 中对应步骤的 shell，避免只断言 YAML 文本或退出码。
@author 李杰
"""

from __future__ import annotations

import json
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
        'python() { "$PYTEST_PYTHON_EXECUTABLE" "$@"; }\n'
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
    helper = root / "scripts/workflow/resolve_ci_baseline.py"
    if not helper.exists():
        helper.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(DEFAULT_ROOT / "scripts/workflow/resolve_ci_baseline.py", helper)
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


def test_baseline_resolution_is_shared_between_jobs() -> None:
    """docs-comments 与 secrets-scan 共用同一基线解析脚本，不重复内联 shell。"""
    docs_step = step_run("docs-comments", BASELINE_STEP).strip()
    secrets_step = step_run("secrets-scan", BASELINE_STEP).strip()
    assert docs_step == secrets_step
    assert "scripts/workflow/resolve_ci_baseline.py" in docs_step


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
    """前端本地与 CI 共用同一门禁清单并接入可重复关键浏览器路径。"""
    job = workflow_jobs()["frontend"]
    assert job["defaults"]["run"]["working-directory"] == "前端代码/basic-framework-admin"
    steps = job["steps"]
    runs = [step.get("run") for step in steps]
    assert (
        runs.index("pnpm install --frozen-lockfile")
        < runs.index("pnpm run quality:gates")
        < runs.index("pnpm run test:e2e:ci")
    )

    pkg_path = DEFAULT_ROOT / "前端代码/basic-framework-admin/package.json"
    pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
    assert "pnpm run quality:gates" in pkg["scripts"]["quality:verify"]

    node_bin = shutil.which("node")
    assert node_bin is not None
    listed = subprocess.run(
        [node_bin, "scripts/quality/run-shared-gates.mjs", "--list", "--json"],
        cwd=DEFAULT_ROOT / "前端代码/basic-framework-admin",
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
        timeout=30,
    )
    gate_scripts = [item["script"] for item in json.loads(listed.stdout)]
    assert (
        gate_scripts.index("api:check")
        < gate_scripts.index("quality:source-scan")
        < gate_scripts.index("lint")
        < gate_scripts.index("build:ele")
        < gate_scripts.index("quality:prod-scan")
    )
    for test_cmd in (
        "quality:test",
        "quality:analysis:test",
        "quality:workspace:test",
        "quality:development:test",
        "quality:delivery:test",
    ):
        assert test_cmd in gate_scripts


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

    # 2. 纯删除超过 600 行（清理死代码）不应被误杀阻断
    big_legacy = repo / "src" / "Legacy.java"
    big_legacy.parent.mkdir(parents=True)
    big_legacy.write_text("\n".join(f"// old {i}" for i in range(650)) + "\n", encoding="utf-8")
    base_with_legacy = commit_all(repo, "add legacy")
    big_legacy.unlink()
    commit_all(repo, "delete legacy")
    deletion_ok = run_shell(guard_script, repo, {"BASE_SHA": base_with_legacy, "PR_BODY": "prune"})
    assert deletion_ok.returncode == 0, deletion_ok.stdout + deletion_ok.stderr

    # 3. 业务源码新增超过 600 行且无规范独立 [slice-override] 行时必须失败
    src = repo / "src" / "Oversized.java"
    src.write_text("\n".join(f"// line {i}" for i in range(650)) + "\n", encoding="utf-8")
    commit_all(repo, "oversized")
    for invalid_body in (
        "missing rationale",
        "We must not abuse [slice-override] in prose.",
        "[slice-override]",
        "[slice-override]:   ",
    ):
        blocked = run_shell(guard_script, repo, {"BASE_SHA": base_with_legacy, "PR_BODY": invalid_body})
        assert blocked.returncode == 1
        assert "exceed 600-line slice budget" in blocked.stderr

    # 4. PR 描述单独成行附带 `[slice-override]: <原因>` 时放行
    allowed = run_shell(
        guard_script,
        repo,
        {"BASE_SHA": base_with_legacy, "PR_BODY": "Summary\r\n[slice-override]: Architecture baseline migration"},
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


def test_baseline_step_rejects_unreachable_sha(tmp_path: Path) -> None:
    """不可达或非法基线提交必须立即失败，避免后续 diff 产生误导性错误。"""
    repo = tmp_path / "repo"
    init_repository(repo)
    (repo / "README.md").write_text("# 基线\n", encoding="utf-8")
    commit_all(repo, "root")
    helper = repo / "scripts/workflow/resolve_ci_baseline.py"
    helper.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(DEFAULT_ROOT / "scripts/workflow/resolve_ci_baseline.py", helper)
    result = run_shell(
        step_run("secrets-scan", BASELINE_STEP),
        repo,
        {"EVENT_BASE_SHA": "deadbeef" * 5},
    )
    assert result.returncode != 0


def test_frontend_job_caches_playwright_and_uploads_failure_artifacts() -> None:
    """前端 CI 必须缓存 Playwright 浏览器并在失败时上传测试诊断产物。"""
    steps = workflow_jobs()["frontend"]["steps"]
    cache_step = next((step for step in steps if step.get("id") == "playwright-cache"), None)
    assert cache_step is not None
    assert str(cache_step.get("uses", "")).startswith("actions/cache@")
    assert cache_step["with"]["path"] == "~/.cache/ms-playwright"

    upload_step = next(
        (step for step in steps if str(step.get("uses", "")).startswith("actions/upload-artifact@")),
        None,
    )
    assert upload_step is not None
    assert upload_step.get("if") == "failure()"
    assert "test-results" in upload_step["with"]["path"]
