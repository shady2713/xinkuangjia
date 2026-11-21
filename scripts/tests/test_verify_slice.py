"""验证 Vibe-Coding 增量切片验证器的改动归类、Maven 子模块定位与计划生成。

@author shady2713
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest
from scripts.code.java import check_staged_java_comments
from scripts.common.quality_common import DEFAULT_ROOT
from scripts.security import scan_staged_secrets
from scripts.workflow import verify_slice


def _init_git_repo(root: Path) -> Path:
    """初始化带提交基线与模块 pom.xml 的临时 Git 仓库。"""
    root.mkdir(parents=True)
    subprocess.run(["git", "init", "-b", "main", str(root)], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", str(root), "config", "user.name", "slice-tester"],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "-C", str(root), "config", "user.email", "slice@invalid.local"],
        check=True,
        capture_output=True,
    )
    mod_dir = root / "后端代码/basic-framework-boot/basic-framework-module-system"
    mod_dir.mkdir(parents=True)
    (mod_dir / "pom.xml").write_text("<project/>", encoding="utf-8", newline="\n")
    (root / "README.md").write_text("# base\n", encoding="utf-8", newline="\n")
    subprocess.run(["git", "-C", str(root), "add", "-A"], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", str(root), "commit", "-m", "init"], check=True, capture_output=True
    )
    return root


def test_verify_slice_identifies_java_modules_web_python_and_docs(tmp_path: Path) -> None:
    """增量切片计划准确映射所属 Maven 子模块、前端源码、Python 脚本与文档门禁。"""
    repo = _init_git_repo(tmp_path / "repo")
    java_file = (
        repo
        / "后端代码/basic-framework-boot/basic-framework-module-system/src/main/java/Demo.java"
    )
    java_file.parent.mkdir(parents=True)
    java_file.write_text("class Demo {}\n", encoding="utf-8", newline="\n")

    web_file = repo / "前端代码/basic-framework-admin/apps/web-ele/src/demo.ts"
    web_file.parent.mkdir(parents=True)
    web_file.write_text("export const x = 1;\n", encoding="utf-8", newline="\n")

    py_file = repo / "scripts/demo_tool.py"
    py_file.parent.mkdir(parents=True)
    py_file.write_text('"""示例。"""\n', encoding="utf-8", newline="\n")

    (repo / "README.md").write_text("# updated\n", encoding="utf-8", newline="\n")

    changed = verify_slice.collect_changed_files(repo, "HEAD")
    plan = verify_slice.build_slice_plan(repo, changed, base="HEAD", skip_runtime=True)

    assert plan.java_modules == ("basic-framework-module-system",)
    assert "前端代码/basic-framework-admin/apps/web-ele/src/demo.ts" in plan.web_files
    assert "scripts/demo_tool.py" in plan.python_files
    assert "README.md" in plan.doc_files
    step_names = [step.name for step in plan.steps]
    assert step_names == ["java-comments", "python-comments", "web-comments", "docs-gates"]
    assert verify_slice.main(["--root", str(repo), "--plan"]) == 0

    runtime_plan = verify_slice.build_slice_plan(repo, changed, base="HEAD", skip_runtime=False)
    runtime_map = {step.name: step for step in runtime_plan.steps}
    assert "python-slice-pytest" in runtime_map
    if "maven-slice-test" in runtime_map:
        assert "-am" in runtime_map["maven-slice-test"].command
        assert "-Dsurefire.failIfNoSpecifiedTests=false" in runtime_map["maven-server-contracts"].command

    # 在 main 分支仅带未提交工作区改动执行 --base main，不得漏检工作区注释
    dirty_main_plan = verify_slice.build_slice_plan(repo, changed, base="main", skip_runtime=True)
    dirty_main_steps = {step.name for step in dirty_main_plan.steps}
    assert {"java-comments", "python-comments", "web-comments", "docs-gates"} <= dirty_main_steps
    assert "branch-comments" not in dirty_main_steps

    # 切出特性分支提交部分文件并保留其他未提交改动时，须同时检查分支提交与工作区增量
    subprocess.run(["git", "-C", str(repo), "checkout", "-b", "feat/slice"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(repo), "add", java_file.as_posix()], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", str(repo), "commit", "-m", "add demo java"],
        check=True,
        capture_output=True,
    )
    branch_changed = verify_slice.collect_changed_files(repo, "main")
    branch_plan = verify_slice.build_slice_plan(repo, branch_changed, base="main", skip_runtime=True)
    branch_map = {step.name: step for step in branch_plan.steps}
    assert "branch-comments" in branch_map
    assert "--base" in branch_map["branch-comments"].command
    assert "python-comments" in branch_map
    assert "web-comments" in branch_map


def test_check_worktree_python_comments_uses_cwd_repo(tmp_path: Path) -> None:
    """check_worktree_python_comments 必须按工作目录定位目标 Git 仓库而非脚本所在主仓。"""
    repo = _init_git_repo(tmp_path / "isolated-repo")
    bad_py = repo / "mod_bad.py"
    bad_py.write_text("def no_doc():\n    return 1\n", encoding="utf-8", newline="\n")
    script = DEFAULT_ROOT / "scripts" / "code" / "python" / "check_worktree_python_comments.py"

    proc = subprocess.run(
        [sys.executable, "-B", "-X", "utf8", str(script)],
        cwd=repo,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
        timeout=30,
    )
    assert proc.returncode == 1
    assert "mod_bad.py" in (proc.stdout + proc.stderr)


def test_secret_scanner_and_java_comment_regressions() -> None:
    """回归验证权限码冒号、JSON 结构头不误报且真实凭据与注解花括号方法正常判定。"""
    assert (
        scan_staged_secrets._scan_added_line(
            "数据库文件/basic_framework.sql",
            10,
            "INSERT INTO system_menu VALUES (1, '令牌', 'system:oauth2-token:query');",
        )
        == []
    )
    assert (
        scan_staged_secrets._scan_added_line(
            "前端代码/basic-framework-admin/apps/web-ele/src/api/generated/openapi.json",
            20,
            '  "password" : {',
        )
        == []
    )
    # 即使在生成契约文件中，真实密钥前缀仍必须被阻断
    synthetic_prefix = "sk-" + "liveleakcredential1234567890"
    leaked = scan_staged_secrets._scan_added_line(
        "前端代码/basic-framework-admin/apps/web-ele/src/api/generated/openapi.json",
        21,
        f'  "description": "{synthetic_prefix}"',
    )
    assert any(item.rule == "secret-prefix" for item in leaked)

    # TypeScript/Vue 参数与属性类型注解放行，显式字符串字面量仍必须阻断
    ts_param = "new" + "Token"
    assert (
        scan_staged_secrets._scan_added_line(
            "前端代码/basic-framework-admin/apps/web-ele/src/auth.ts",
            10,
            f"function settle({ts_param}: string, err?: unknown) {{",
        )
        == []
    )
    ts_field = "pass" + "word"
    ts_literal = "hardcoded" + "Secret123"
    ts_leaked = scan_staged_secrets._scan_added_line(
        "前端代码/basic-framework-admin/apps/web-ele/src/auth.ts",
        11,
        f"const payload = {{ {ts_field}: '{ts_literal}' }};",
    )
    assert any(item.rule == "sensitive-assignment" for item in ts_leaked)

    annotated_java = (
        "/**\n * 控制器。\n *\n * @author shady2713\n */\n"
        "public class DemoController {\n"
        "    /**\n     * 多路径映射接口。\n     *\n     * @return 结果\n     */\n"
        '    @SuppressWarnings({"unchecked", "rawtypes"})\n'
        "    public String list() {\n"
        '        return "ok";\n'
        "    }\n"
        "}\n"
    )
    all_lines = set(range(1, annotated_java.count("\n") + 2))
    assert (
        check_staged_java_comments._scan_source(
            "后端代码/basic-framework-boot/DemoController.java", annotated_java, all_lines
        )
        == []
    )


def test_verify_slice_frontend_plan_covers_typecheck_api_check_and_quality_python(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """前端切片运行时计划必须覆盖 typecheck、api:check 以及前端 quality Python 测试。"""
    repo = _init_git_repo(tmp_path / "web-repo")
    monkeypatch.setattr(verify_slice.shutil, "which", lambda name: "pnpm" if "pnpm" in name else None)

    ts_file = repo / "前端代码/basic-framework-admin/apps/web-ele/src/demo.ts"
    ts_file.parent.mkdir(parents=True)
    ts_file.write_text("export const demo = 1;\n", encoding="utf-8", newline="\n")
    quality_py = repo / "前端代码/basic-framework-admin/scripts/quality/verify_workspace_constraints.py"
    quality_py.parent.mkdir(parents=True)
    quality_py.write_text('"""约束检查。"""\n', encoding="utf-8", newline="\n")

    plan = verify_slice.build_slice_plan(
        repo,
        [
            "前端代码/basic-framework-admin/apps/web-ele/src/demo.ts",
            "前端代码/basic-framework-admin/scripts/quality/verify_workspace_constraints.py",
        ],
        base="HEAD",
        skip_runtime=False,
    )
    step_map = {step.name: step for step in plan.steps}
    assert "web-slice-eslint" in step_map
    assert step_map["web-slice-typecheck"].command == ("pnpm", "check:type")
    assert step_map["web-slice-api-check"].command == ("pnpm", "api:check")
    assert step_map["web-quality-python-tests"].command[-2:] == ("-p", "test_*.py")

    # 仅变更生成的 OpenAPI 快照（无 .ts 源码）也必须触发 api:check
    openapi_only = verify_slice.build_slice_plan(
        repo,
        ["前端代码/basic-framework-admin/apps/web-ele/src/api/generated/openapi.json"],
        base="HEAD",
        skip_runtime=False,
    )
    openapi_steps = [step.name for step in openapi_only.steps]
    assert openapi_steps == ["web-slice-api-check"]


def test_verify_slice_exports_unified_pr_and_head_sha_acceptance_evidence(tmp_path: Path) -> None:
    """按 PR 与 head SHA 导出同一份验收证据，准确记录执行步骤、跳过原因与工作区状态。"""
    repo = _init_git_repo(tmp_path / "evidence-repo")
    py_checker = repo / "scripts/code/python/check_worktree_python_comments.py"
    py_checker.parent.mkdir(parents=True)
    py_checker.write_text('"""桩检查器。"""\nraise SystemExit(0)\n', encoding="utf-8", newline="\n")
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-m", "add checker"], check=True, capture_output=True)
    py_file = repo / "scripts/demo.py"
    py_file.write_text('"""演示模块。"""\n', encoding="utf-8", newline="\n")

    evidence_json = tmp_path / "evidence" / "pr-95.json"
    evidence_md = tmp_path / "evidence" / "pr-95.md"
    head_sha = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    code = verify_slice.main(
        [
            "--root",
            str(repo),
            "--base",
            "HEAD",
            "--skip-runtime",
            "--pr",
            "#95",
            "--evidence-json",
            str(evidence_json),
            "--evidence-md",
            str(evidence_md),
        ]
    )
    assert code == 0
    payload = json.loads(evidence_json.read_text(encoding="utf-8"))
    assert payload["pr"] == "#95"
    assert payload["head_sha"] == head_sha
    assert payload["tested_sha"] == head_sha
    assert payload["pr_head_sha"] is None
    assert payload["worktree_dirty"] is True
    assert payload["overall_code"] == 0
    assert any(item["name"] == "python-comments" and item["status"] == "passed" for item in payload["executed_steps"])
    assert any(
        item["name"] == "python-runtime-tests" and "--skip-runtime" in item["reason"]
        for item in payload["skipped_steps"]
    )

    markdown = evidence_md.read_text(encoding="utf-8")
    assert "#95" in markdown
    assert head_sha in markdown
    assert "python-runtime-tests" in markdown
    assert "--skip-runtime" in markdown
    assert "实际受验 SHA" in markdown
    assert "未匹配文件" in markdown

    # A caller-supplied PR head SHA is recorded verbatim; tested_sha stays the real checkout.
    pr_sha = "0123456789abcdef" * 2 + "01234567"
    override_json = tmp_path / "evidence" / "pr-95-override.json"
    override_args = ["--root", str(repo), "--skip-runtime", "--pr-head-sha", pr_sha]
    override_args += ["--evidence-json", str(override_json)]
    assert verify_slice.main(override_args) == 0
    override = json.loads(override_json.read_text(encoding="utf-8"))
    assert override["pr_head_sha"] == pr_sha
    assert override["tested_sha"] == override["head_sha"] == head_sha
    with pytest.raises(SystemExit):
        verify_slice.main(["--root", str(repo), "--plan", "--pr-head-sha", "not-a-sha"])


def test_web_comments_and_task_card_remote_delivery_docs_stay_aligned() -> None:
    """Web 注释规范与任务卡模板/执行说明不得回退为过期口径或冲突远端推送规则。"""
    web_comments_doc = (
        DEFAULT_ROOT
        / ".agents/skills/weetion-development-web-standards/references/web-comments.md"
    ).read_text(encoding="utf-8")
    assert "只覆盖 Java 与 Python" not in web_comments_doc
    assert "Java、Python 与 Web" in web_comments_doc

    task_cards_root = DEFAULT_ROOT / ".agents/skills/weetion-task-cards"
    for rel in (
        "SKILL.md",
        "references/execution.md",
        "templates/overview.md",
        "templates/subtask.md",
        "templates/plan.md",
    ):
        text = (task_cards_root / rel).read_text(encoding="utf-8")
        assert "推送仅由用户人工操作" not in text, f"{rel} 仍残留过期绝对禁止推送表述"
        assert "git-workflow.md#授权与交付边界" in text, f"{rel} 未统一引用 git-workflow.md#授权与交付边界"


def test_execute_slice_plan_preserves_env_error_code_and_handles_os_error(tmp_path: Path) -> None:
    """环境错误码 2 优先级高于规则失败 1，且启动失败 OSError 归类为退出码 2。"""
    plan = verify_slice.SlicePlan(
        base="HEAD",
        effective_base="HEAD",
        changed_files=("a.py",),
        java_modules=(),
        web_files=(),
        python_files=("a.py",),
        doc_files=(),
        steps=(
            verify_slice.SliceStep("rule-fail", str(tmp_path), (sys.executable, "-c", "import sys; sys.exit(1)")),
            verify_slice.SliceStep("env-fail", str(tmp_path), (sys.executable, "-c", "import sys; sys.exit(2)")),
        ),
    )
    code, outcomes = verify_slice.execute_slice_plan(plan)
    assert code == 2
    assert [item["code"] for item in outcomes] == [1, 2]

    os_err_plan = verify_slice.SlicePlan(
        base="HEAD",
        effective_base="HEAD",
        changed_files=("a.py",),
        java_modules=(),
        web_files=(),
        python_files=("a.py",),
        doc_files=(),
        steps=(
            verify_slice.SliceStep("missing-bin", str(tmp_path), ("definitely-missing-executable-xyz",)),
        ),
    )
    os_code, os_outcomes = verify_slice.execute_slice_plan(os_err_plan)
    assert os_code == 2
    assert os_outcomes[0]["code"] == 2


def test_verify_slice_routes_ci_workflow_and_reports_skipped_coverage(tmp_path: Path) -> None:
    """ci.yml 变更路由到基线单测；无暂存分支增量与未映射变更均显式记录 skipped_steps。"""
    repo = _init_git_repo(tmp_path / "ci-route-repo")
    subprocess.run(["git", "-C", str(repo), "checkout", "-b", "feat/ci"], check=True, capture_output=True)
    ci_file = repo / ".github/workflows/ci.yml"
    ci_file.parent.mkdir(parents=True)
    ci_file.write_text("name: CI\n", encoding="utf-8", newline="\n")
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-m", "touch ci"], check=True, capture_output=True)

    changed = verify_slice.collect_changed_files(repo, "main")
    plan = verify_slice.build_slice_plan(repo, changed, base="main", skip_runtime=False)
    step_names = [step.name for step in plan.steps]
    assert "ci-workflow-pytest" in step_names
    skipped_names = {item.name for item in plan.skipped_steps}
    assert "base-secrets-scan" in skipped_names

    mixed_plan = verify_slice.build_slice_plan(
        repo, [".github/workflows/ci.yml", "docker-compose.dev.yml"], base="HEAD", skip_runtime=False
    )
    assert "ci-workflow-pytest" in [step.name for step in mixed_plan.steps]
    assert mixed_plan.unmatched_files == ("docker-compose.dev.yml",)

    unmapped_plan = verify_slice.build_slice_plan(
        repo, ["docker-compose.dev.yml"], base="HEAD", skip_runtime=False
    )
    assert unmapped_plan.steps == ()
    assert any(item.name == "unmapped-changes" for item in unmapped_plan.skipped_steps)
