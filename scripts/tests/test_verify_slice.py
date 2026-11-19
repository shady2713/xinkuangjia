"""验证 Vibe-Coding 增量切片验证器的改动归类、Maven 子模块定位与计划生成。

@author shady2713
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

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
