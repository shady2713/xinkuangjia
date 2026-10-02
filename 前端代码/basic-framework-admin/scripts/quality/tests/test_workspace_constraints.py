"""使用隔离临时工作区验证依赖检查，不读取真实项目依赖。

@author 李杰
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "verify_workspace_constraints.py"
SPEC = importlib.util.spec_from_file_location("workspace_checker", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
checker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = checker
SPEC.loader.exec_module(checker)


class WorkspaceTests(unittest.TestCase):
    """验证发现范围、依赖解析和失败退出，所有输入均属于单个测试。"""

    def setUp(self) -> None:
        """创建中文临时目录，并登记失败时同样执行的清理。"""
        temporary = tempfile.TemporaryDirectory(prefix="工作区检查-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.write(
            "pnpm-workspace.yaml", "packages:\n  - packages/**\n  - '!packages/ignored/**'\n"
        )
        self.package("", "root")
        self.package("packages/core", "@demo/core")

    def write(self, relative: str, content: str) -> None:
        """在测试私有目录写入 UTF-8 样例，不触碰仓库文件。"""
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8", newline="\n")

    def package(self, directory: str, name: str, **fields: object) -> None:
        """生成包清单，允许测试按需声明依赖或非法字段。"""
        self.write(
            str(Path(directory) / "package.json"),
            json.dumps({"name": name, **fields}, ensure_ascii=False),
        )

    def rules(self) -> list[str]:
        """读取规则标识，使断言独立于诊断文案措辞。"""
        return [item["rule"] for item in checker.inspect(self.root)["findings"]]

    def test_valid_alias_relative_catalog_and_root(self) -> None:
        """合法别名、相对包和两类 catalog 应通过，根包也必须计入。"""
        with (self.root / "pnpm-workspace.yaml").open("a", encoding="utf-8") as stream:
            stream.write("catalog:\n  vue: ^3.5.0\ncatalogs:\n  stable:\n    vite: ^7.0.0\n")
        self.package(
            "",
            "root",
            dependencies={
                "@demo/core": "workspace:*",
                "alias": "workspace:@demo/core@^",
                "relative": "workspace:./packages/core",
                "vue": "catalog:",
                "vite": "catalog:stable",
            },
        )
        self.assertEqual(checker.inspect(self.root), {"packages": 2, "findings": [], "code": 0})

    def test_exclusions_and_glob_boundaries(self) -> None:
        """排除包与依赖产物不能污染包名索引，单星不能跨层匹配。"""
        for path in ("packages/ignored/nested", "node_modules/a", "vendor/a", "dist/a"):
            self.package(path, "@demo/core")
        self.assertEqual(self.rules(), [])
        self.assertFalse(checker._matches("packages/a/b", "packages/*"))
        self.assertTrue(checker._matches("packages/a", "packages/**/a"))
        self.assertTrue(checker._matches("packages/a/b", "packages/**"))
        self.assertTrue(checker._matches("apps/a1", "apps/[ab]?"))

    def test_duplicate_names_include_root(self) -> None:
        """根包与子包同名必须报告双方清单，不能被字典覆盖。"""
        self.package("", "@demo/core")
        self.assertEqual(self.rules(), ["duplicate-name"])

    def test_all_dependency_sections_require_workspace(self) -> None:
        """四种依赖声明均阻止内部包意外从注册表解析。"""
        for section in checker.SECTIONS:
            with self.subTest(section=section):
                self.package("", "root", **{section: {"@demo/core": "^1.0.0"}})
                self.assertEqual(self.rules(), ["workspace-protocol"])

    def test_npm_alias_to_internal_package(self) -> None:
        """npm 别名不能绕过内部依赖协议要求。"""
        self.package("", "root", dependencies={"alias": "npm:@demo/core@1.0.0"})
        self.assertEqual(self.rules(), ["workspace-protocol"])
        self.write(
            "pnpm-workspace.yaml",
            "packages: [packages/*]\ncatalog:\n  alias: 'npm:@demo/core@1.0.0'\n",
        )
        self.package("", "root", dependencies={"alias": "catalog:"})
        self.assertEqual(self.rules(), ["workspace-protocol"])

    def test_missing_workspace_targets(self) -> None:
        """普通名称、别名、相对路径及越界目标都必须存在于当前工作区。"""
        for spec in (
            "workspace:*",
            "workspace:@demo/missing@*",
            "workspace:./absent",
            "workspace:../outside",
        ):
            with self.subTest(spec=spec):
                self.package("", "root", dependencies={"missing": spec})
                self.assertEqual(self.rules(), ["workspace-target"])

    def test_missing_and_recursive_catalog(self) -> None:
        """缺失目录、缺失条目和递归引用均报告明确规则问题。"""
        for spec in ("catalog:", "catalog:missing"):
            self.package("", "root", dependencies={"vue": spec})
            self.assertEqual(self.rules(), ["catalog-missing"])
        self.write("pnpm-workspace.yaml", "packages: [packages/*]\ncatalog:\n  vue: 'catalog:'\n")
        self.assertEqual(self.rules(), ["catalog-missing"])
        self.package("", "root", dependencies={"vue": "catalog:"})
        self.assertEqual(self.rules(), ["catalog-recursive"])

    def test_invalid_configuration_fails_closed(self) -> None:
        """非法格式、重复键、自定义标签和越界模式不能当作空扫描通过。"""
        for content in (
            "packages: [",
            "packages: []",
            "packages: [../outside/*]",
            "packages: [packages/*]\npackages: [apps/*]",
            "packages: !!python/object:builtins.object {}",
            "packages: ['packages/{a,b}']",
            "packages: [1]",
        ):
            with self.subTest(content=content):
                self.write("pnpm-workspace.yaml", content)
                with self.assertRaises(checker.InputError):
                    checker.inspect(self.root)

    def test_invalid_manifests_and_dependencies(self) -> None:
        """重复 JSON 键、错误编码及无效依赖对象应中止完整扫描。"""
        for content in (
            '{"name":"a","name":"b"}',
            '{"name":null}',
            '{"name":"a","dependencies":[]}',
        ):
            with self.subTest(content=content):
                self.write("package.json", content)
                with self.assertRaises(checker.InputError):
                    checker.inspect(self.root)
        (self.root / "package.json").write_bytes(b"\xff")
        with self.assertRaises(checker.InputError):
            checker.inspect(self.root)

    def test_cli_exit_codes_and_read_only(self) -> None:
        """真实进程验证成功、规则失败、输入失败及文件内容不变。"""
        for expected in (0, 1, 2):
            if expected == 1:
                self.package("", "root", dependencies={"missing": "workspace:*"})
            if expected == 2:
                self.write("pnpm-workspace.yaml", "packages: []")
            before = {
                p.relative_to(self.root): p.read_bytes()
                for p in self.root.rglob("*")
                if p.is_file()
            }
            result = subprocess.run(
                [
                    sys.executable,
                    "-B",
                    "-X",
                    "utf8",
                    str(SCRIPT),
                    "--root",
                    str(self.root),
                    "--json",
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=15,
                check=False,
            )
            self.assertEqual(result.returncode, expected, result.stderr)
            self.assertEqual(json.loads(result.stdout)["code"], expected)
            self.assertEqual(
                before,
                {
                    p.relative_to(self.root): p.read_bytes()
                    for p in self.root.rglob("*")
                    if p.is_file()
                },
            )


if __name__ == "__main__":
    unittest.main()
