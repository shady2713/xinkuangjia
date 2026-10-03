"""验证开发工具的真实语法解析、关系图、只读规划及构建记录失败边界。

测试使用私有临时目录，不执行真实仓库清理或完整构建。
@author 李杰
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_record
import clean_artifacts
import generate_module_graph as graph
import verify_workspace_constraints as workspace
import workspace_audit as audit


class DevelopmentTests(unittest.TestCase):
    """每项测试维护独立工作区，避免测试顺序影响构建或清理结果。"""

    def setUp(self) -> None:
        """创建私有中文目录并登记自动清理，仅写入测试样例。"""
        temporary = tempfile.TemporaryDirectory(prefix="开发检查-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.write("pnpm-workspace.yaml", "packages: ['packages/*', 'apps/*']\n")
        self.package("", "root")
        self.package("packages/core", "@test/core")
        self.package("apps/web-ele", "app", dependencies={"@test/core": "workspace:*"})
        self.write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n")

    def write(self, path: str, content: str) -> None:
        """写入测试私有 UTF-8 文件，目录仅在当前临时根下创建。"""
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8", newline="\n")

    def package(self, directory: str, name: str, **fields: object) -> None:
        """建立具有版本及可选依赖的最小包清单。"""
        self.write(
            str(Path(directory) / "package.json"),
            json.dumps({"name": name, "version": "1.0.0", **fields}),
        )

    def test_real_parser_ignores_comments_and_handles_vue(self) -> None:
        """注释中的伪导入不生效，Vue 脚本静态和动态导入保留原始行号。"""
        self.write(
            "apps/web-ele/src/page.vue",
            '<template><div /></template>\n<script setup lang="ts">\n'
            '// import "fake";\nimport { a } from "@test/core";\n'
            'const load = () => import("missing");\n</script>\n',
        )
        report = audit.inspect(self.root, "dependencies")
        self.assertEqual(report["files"], 1)
        self.assertEqual([(f["package"], f["line"]) for f in report["findings"]], [("missing", 5)])

    def test_parser_types_reexports_require_and_dynamic_gap(self) -> None:
        """类型导入、重导出与 require 都可提取，变量动态导入明确报告覆盖缺口。"""
        self.write(
            "apps/web-ele/src/a.ts",
            'type T = import("type-only").T;\n'
            'export * from "reexport";\nconst x = require("required");\nimport(variable);\n',
        )
        report = audit.inspect(self.root, "dependencies")
        self.assertEqual(
            {f["package"] for f in report["findings"]}, {"type-only", "reexport", "required"}
        )
        self.assertEqual(report["dynamicImports"][0]["line"], 4)

    def test_parser_failure_is_not_success(self) -> None:
        """无法可靠解析的 TS 不能返回无问题报告。"""
        self.write("apps/web-ele/src/a.ts", "const a = ;")
        with self.assertRaises(workspace.InputError):
            audit.inspect(self.root, "all")

    def test_relative_cross_package_dependency(self) -> None:
        """跨包相对导入同样需要清单声明，包内相对导入不误报依赖。"""
        self.package("apps/web-ele", "app")
        self.write("apps/web-ele/src/a.ts", 'import "../../../packages/core/src/a";\nimport "./b";')
        self.assertEqual(
            [f["rule"] for f in audit.inspect(self.root, "dependencies")["findings"]],
            ["undeclared-dependency"],
        )

    def test_layer_direction_matches_existing_contract(self) -> None:
        """沿用 core/base 与基础包规则，并允许基础包内部相对引用。"""
        self.assertTrue(audit.forbidden_layer("packages/@core/base/x/src/a.ts", "@vben-core/foo"))
        self.assertTrue(audit.forbidden_layer("packages/@core/x/src/a.ts", "@vben/foo"))
        self.assertTrue(audit.forbidden_layer("packages/utils/src/a.ts", "@vben/foo"))
        self.assertFalse(audit.forbidden_layer("packages/utils/src/a.ts", ""))
        self.assertFalse(audit.forbidden_layer("apps/web-ele/src/a.ts", "#/api/foo"))

    def test_app_aliases_remain_legal_and_shared_imports_cannot_reach_apps(self) -> None:
        """真实解析允许应用本地 API，拒绝共享包静态、动态及相对反向依赖。"""
        self.package("apps/web-ele", "@test/app", imports={"#/*": "./src/*"})
        self.write(
            "apps/web-ele/src/page.vue",
            '<script setup lang="ts">\nimport "#/api/foo";\n'
            'import "#/layouts/basic";\nimport "#/locales";\n'
            'import "#/store/auth";\n</script>\n',
        )
        self.assertEqual(audit.inspect(self.root, "layers")["findings"], [])
        self.write(
            "packages/core/src/a.ts",
            '// import "@test/app";\nimport "./local";\n'
            'import "@test/app/api/foo";\nimport("#/api/foo");\n'
            'export * from "../../../apps/web-ele/src/store/auth";\n',
        )
        report = audit.inspect(self.root, "layers")
        self.assertEqual(report["files"], 2)
        self.assertEqual(
            [(item["rule"], item["line"]) for item in report["findings"]],
            [("layer-direction", 3), ("layer-direction", 4), ("layer-direction", 5)],
        )

    def test_config_diagnostics_do_not_expose_values(self) -> None:
        """配置入口绕过和内联端点只输出位置，不泄露字面量值。"""
        self.write(
            "apps/web-ele/src/a.ts",
            'const x = env["VITE_GLOB_API_URL"];\n'
            'const options = {baseURL: "/fixture-endpoint"};\n',
        )
        report = audit.inspect(self.root, "config")
        self.assertEqual(
            {f["rule"] for f in report["findings"]}, {"config-owner", "inline-endpoint"}
        )
        self.assertNotIn("/fixture-endpoint", json.dumps(report))

    def test_graph_alias_relative_and_stable_output(self) -> None:
        """关系图保留依赖类型，别名与相对目标均指向真实包，重复生成相同。"""
        self.package(
            "apps/web-ele",
            "app",
            dependencies={"alias": "workspace:@test/core@*"},
            peerDependencies={"relative": "workspace:../../packages/core"},
        )
        first = graph.render(self.root)
        self.assertEqual(first, graph.render(self.root))
        self.assertEqual(len(graph.edges(audit.packages(self.root))), 2)
        self.assertIn("3 个包、2 条分类依赖", first)
        self.assertIn("## 宿主依赖", first)

    def git_files(self, tracked: bytes = b"") -> subprocess.CompletedProcess:
        """构造只读 Git 边界结果，不创建真实 .git 或修改暂存区。"""
        return subprocess.CompletedProcess(["git"], 0, stdout=tracked)

    def test_clean_preview_and_explicit_execution(self) -> None:
        """预览保留文件，仅使用匹配计划可删除测试产物且保留源码与锁文件。"""
        self.write("apps/web-ele/dist/index.html", "fixture")
        self.write("apps/web-ele/src/keep.ts", "export {};")
        self.write("apps/web-ele/src/dist/keep.txt", "source")
        with patch.object(clean_artifacts.subprocess, "run", return_value=self.git_files()):
            plan = clean_artifacts.plan(self.root)
            self.assertEqual(plan["targets"], ["apps/web-ele/dist"])
            self.assertTrue((self.root / plan["targets"][0]).exists())
            clean_artifacts.execute(self.root, False, plan["planId"])
        self.assertTrue((self.root / "apps/web-ele/src/keep.ts").exists())
        self.assertTrue((self.root / "apps/web-ele/src/dist/keep.txt").exists())
        self.assertTrue((self.root / "pnpm-lock.yaml").exists())

    def test_clean_refuses_changed_plan_and_tracked_files(self) -> None:
        """计划变化或包含跟踪文件时，必须在删除任何目标前失败。"""
        self.write("apps/web-ele/dist/index.html", "before")
        with patch.object(clean_artifacts.subprocess, "run", return_value=self.git_files()):
            plan = clean_artifacts.plan(self.root)
            self.write("apps/web-ele/dist/index.html", "after changed")
            with self.assertRaises(workspace.InputError):
                clean_artifacts.execute(self.root, False, plan["planId"])
        with patch.object(
            clean_artifacts.subprocess,
            "run",
            return_value=self.git_files(b"apps/web-ele/dist/index.html\0"),
        ):
            with self.assertRaises(workspace.InputError):
                clean_artifacts.plan(self.root)
        self.assertTrue((self.root / "apps/web-ele/dist/index.html").exists())

    def test_clean_rejects_links_and_escape(self) -> None:
        """目标链接、祖先链接和根目录外目标均不能进入删除计划。"""
        with self.assertRaises(workspace.InputError):
            clean_artifacts.validate_target(self.root, self.root.parent)
        self.write("apps/web-ele/dist/a", "test")
        real_link = workspace._link
        with patch.object(
            workspace, "_link", side_effect=lambda p: p.name == "dist" or real_link(p)
        ):
            with self.assertRaises(workspace.InputError):
                clean_artifacts.plan(self.root)

    def test_build_record_detects_artifact_and_source_changes(self) -> None:
        """构建前后来源一致才能记录，产物修改或新准备阶段会使旧记录失效。"""
        self.write("apps/web-ele/dist/index.html", "artifact")
        with patch.object(build_record, "source", return_value={"commit": "fixture"}):
            build_record.run(self.root, "prepare")
            build_record.run(self.root, "finish")
            build_record.run(self.root, "verify")
            self.write("apps/web-ele/dist/index.html", "changed")
            with self.assertRaises(workspace.InputError):
                build_record.run(self.root, "verify")
            build_record.run(self.root, "finish")
            build_record.run(self.root, "prepare")
            with self.assertRaises(workspace.InputError):
                build_record.run(self.root, "verify")
        with patch.object(build_record, "source", return_value={"commit": "changed"}):
            with self.assertRaises(workspace.InputError):
                build_record.run(self.root, "finish")

    def test_build_record_missing_or_empty_output(self) -> None:
        """缺少上下文、空产物和非法记录不能形成可验证的构建记录。"""
        with patch.object(build_record, "source", return_value={"commit": "fixture"}):
            with self.assertRaises(workspace.InputError):
                build_record.run(self.root, "finish")
            build_record.run(self.root, "prepare")
            with self.assertRaises(workspace.InputError):
                build_record.run(self.root, "finish")
            (self.root / "apps/web-ele/dist").mkdir()
            with self.assertRaises(workspace.InputError):
                build_record.run(self.root, "finish")

    def test_source_digest_uses_frontend_scope(self) -> None:
        """来源包含提交、版本、锁文件和当前前端文件，未把完整环境写入记录。"""

        def git_result(root: Path, *arguments: str) -> bytes:
            """以确定性的只读 Git 结果隔离外部仓库状态。"""
            if arguments[0] == "rev-parse":
                return b"a" * 40
            if arguments[0] == "ls-files":
                return b"apps/web-ele/package.json\0pnpm-lock.yaml\0"
            return b""

        with patch.object(build_record, "git", side_effect=git_result):
            first = build_record.source(self.root)
            self.assertEqual(first["version"], "1.0.0")
            self.write("pnpm-lock.yaml", "changed")
            self.assertNotEqual(first, build_record.source(self.root))


if __name__ == "__main__":
    unittest.main()
