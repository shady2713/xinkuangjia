"""验证 Vibe-Coding 增量切片验证器的改动归类、Maven 子模块定位与计划生成。

@author shady2713
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from scripts.code.java import check_staged_java_comments
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
