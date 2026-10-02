"""验证覆盖率位置、代理子进程和交付归档的独立行为。

所有解包与清理均使用测试私有临时目录，不修改真实构建产物。
@author 李杰
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import unittest
import zipfile
from collections.abc import Callable
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_record
import release_artifacts as release
import report_coverage
import run_frontend_tests as runner


class DeliveryTests(unittest.TestCase):
    """用独立目录核验正常交付及受控破坏，避免依赖真实构建或端口。"""

    def setUp(self) -> None:
        """创建临时工作区并登记回收，初始化最小静态站点。"""
        temporary = tempfile.TemporaryDirectory(prefix="交付工具-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.write("apps/web-ele/.env.production", "VITE_BASE=/admin/\n")
        self.write(
            "apps/web-ele/dist/index.html",
            '<script src="/admin/_app.config.js"></script>',
        )
        self.write("apps/web-ele/dist/_app.config.js", "window.config = {};")
        self.write("apps/web-ele/src/a.ts", "export const a = 1;")
        self.path = self.root / "test.zip"

    def write(self, relative: str, text: str) -> None:
        """仅在测试私有目录中建立 UTF-8 文件。"""
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8", newline="\n")

    def record(self) -> dict[str, object]:
        """按真实摘要算法构造可验证构建记录，不伪造文件摘要。"""
        return {
            "context": {
                "format": 1,
                "mode": "production",
                "source": {"commit": "a" * 40, "version": "1.0.0"},
            },
            "artifacts": build_record.artifacts(self.root),
        }

    def archive(
        self, transform: Callable[[dict[str, object]], None] | None = None
    ) -> Path:
        """生成合法测试 ZIP，允许用例显式修改清单以验证拒绝路径。"""
        directory = self.root / "apps/web-ele/dist"
        data = {
            p.relative_to(directory).as_posix(): p.read_bytes()
            for p in directory.rglob("*")
            if p.is_file()
        }
        manifest = {
            "format": 1,
            "base": "/admin/",
            "build": self.record(),
            "files": {
                name: {"size": len(value), "sha256": hashlib.sha256(value).hexdigest()}
                for name, value in data.items()
            },
        }
        if transform:
            transform(manifest)
        with zipfile.ZipFile(self.path, "w") as archive:
            for name, value in data.items():
                archive.writestr(name, value)
            archive.writestr(release.MANIFEST, json.dumps(manifest))
        return self.path

    def coverage_data(self) -> dict[str, object]:
        """生成语句、函数及两条分支的 Istanbul 样例。"""
        loc = {"start": {"line": 1, "column": 0}, "end": {"line": 1, "column": 10}}
        return {
            str(self.root / "apps/web-ele/src/a.ts"): {
                "s": {"0": 0},
                "statementMap": {"0": loc},
                "f": {"0": 0},
                "fnMap": {"0": {"loc": loc}},
                "b": {"0": [0, 1]},
                "branchMap": {"0": {"locations": [loc, loc]}},
            }
        }

    def test_coverage_locations_and_column_conversion(self) -> None:
        """分别报告零计数语句、函数和分支，并将列号转为一基索引。"""
        rows = report_coverage.uncovered(self.coverage_data(), self.root)
        self.assertEqual(len(rows), 3)
        self.assertEqual(
            {row["kind"] for row in rows}, {"statement", "function", "branch"}
        )
        self.assertTrue(all(row["column"] == 1 for row in rows))

    def test_coverage_rejects_invalid_or_outside_paths(self) -> None:
        """报告为空、映射不匹配或路径越界时不能输出成功报告。"""
        with self.assertRaises(ValueError):
            report_coverage.uncovered({}, self.root)
        data = self.coverage_data()
        item = next(iter(data.values()))
        item["b"]["0"].append(0)
        with self.assertRaises(ValueError):
            report_coverage.uncovered(data, self.root)
        with self.assertRaises(ValueError):
            report_coverage.uncovered({str(self.root.parent / "a.ts"): item}, self.root)

    def test_unknown_vue_column_remains_unknown(self) -> None:
        """Vue 映射的 -1 列仍可定位到行，但不伪造为第一列。"""
        data = self.coverage_data()
        next(iter(data.values()))["statementMap"]["0"]["start"]["column"] = -1
        rows = report_coverage.uncovered(data, self.root)
        self.assertTrue(all(row["column"] is None for row in rows))

    def test_archive_limits_and_symlink_rejected(self) -> None:
        """文件超限或 ZIP 链接条目必须在任何解包动作前拒绝。"""
        path = self.archive()
        with patch.object(release, "MAX_FILE", 1), self.assertRaises(ValueError):
            release.validate(path)
        with zipfile.ZipFile(path, "a") as archive:
            entry = zipfile.ZipInfo("link.js")
            entry.create_system = 3
            entry.external_attr = 0o120777 << 16
            archive.writestr(entry, "index.html")
        with self.assertRaises(ValueError):
            release.validate(path)

    def test_proxy_profiles_preserve_parent_environment(self) -> None:
        """local 清除各种大小写代理并合并绕过列表，inherit 完全保留输入。"""
        before = {
            "HTTP_PROXY": "fixture",
            "https_proxy": "fixture",
            "NODE_USE_ENV_PROXY": "1",
            "NO_PROXY": "example.test",
            "no_proxy": "custom.test",
            "KEEP": "yes",
        }
        snapshot = dict(before)
        result = runner.test_environment(before, "local")
        self.assertEqual(before, snapshot)
        self.assertNotIn("HTTP_PROXY", result)
        self.assertNotIn("NODE_USE_ENV_PROXY", result)
        self.assertIn("example.test", result["NO_PROXY"])
        self.assertIn("custom.test", result["no_proxy"])
        self.assertEqual(runner.test_environment(before, "inherit"), before)

    def test_child_environment_and_exit_code(self) -> None:
        """真实子进程接收隔离环境，失败退出码不能被包装器转换为成功。"""
        env = runner.test_environment({**os.environ, "HTTP_PROXY": "fixture"}, "local")
        code = runner.run_process(
            [
                sys.executable,
                "-B",
                "-c",
                "import os,sys;sys.exit(7 if 'HTTP_PROXY' not in os.environ else 9)",
            ],
            self.root,
            env,
            10,
        )
        self.assertEqual(code, 7)

    def test_child_timeout_reaps_process(self) -> None:
        """超时会终止并回收自有进程树，返回独立超时状态。"""
        code = runner.run_process(
            [sys.executable, "-B", "-c", "import time;time.sleep(30)"],
            self.root,
            dict(os.environ),
            1,
        )
        self.assertEqual(code, 124)

    def test_pnpm_arguments_reach_test_runner(self) -> None:
        """pnpm 有无保留分隔符都将未知参数完整交给 Playwright。"""
        for arguments in (["--list"], ["--", "--list"]):
            with (
                patch.object(sys, "argv", ["runner", "--suite", "e2e", *arguments]),
                patch.object(runner.shutil, "which", return_value="node"),
                patch.object(runner, "run_process", return_value=0) as run,
            ):
                self.assertEqual(runner.main(), 0)
                self.assertEqual(run.call_args.args[0][-1], "--list")

    def test_archive_verify_and_isolated_http(self) -> None:
        """合法压缩包脱离工作区即可验证，静态请求使用随机环回端口。"""
        path = self.archive()
        report = release.validate(path, "1.0.0")
        self.assertEqual(len(report["files"]), 2)
        self.assertEqual(release.smoke(path), {"files": 2, "entryResources": 2})

    def test_pack_uses_verified_record(self) -> None:
        """打包绑定原构建摘要，产物只写入当前项目缓存。"""
        with patch.object(build_record, "run", return_value=self.record()):
            path = release.pack(self.root)
        self.assertTrue(path.is_relative_to(self.root))
        release.validate(path, "1.0.0")

    def test_version_and_manifest_tampering_fail(self) -> None:
        """版本不符或文件摘要与构建摘要不一致时拒绝交付。"""
        path = self.archive()
        with self.assertRaises(ValueError):
            release.validate(path, "2.0.0")

        def corrupt(manifest: dict[str, object]) -> None:
            """改变摘要以模拟内容清单被篡改。"""
            manifest["files"]["index.html"]["sha256"] = "0" * 64

        with self.assertRaises(ValueError):
            release.validate(self.archive(corrupt))

    def test_traversal_duplicates_and_hidden_files_fail(self) -> None:
        """穿越、盘符、隐藏配置、Windows 设备名与源码文件均不允许交付。"""
        for name in (
            "../a.js",
            "C:/a.js",
            "a\\b.js",
            ".env",
            "CON.txt",
            "src/a.ts",
            "a//b.js",
        ):
            with self.subTest(name=name), self.assertRaises(ValueError):
                release.safe_name(name)
        path = self.archive()
        with zipfile.ZipFile(path, "a") as archive:
            archive.writestr("INDEX.HTML", "duplicate")
        with self.assertRaises(ValueError):
            release.validate(path)

    def test_missing_entry_resource_and_external_url_fail(self) -> None:
        """包内缺失入口资源或入口依赖外部服务时不冒充隔离验收成功。"""
        for url in ("/admin/missing.js", "https://example.test/runtime.js"):
            self.write("apps/web-ele/dist/index.html", f'<script src="{url}"></script>')
            with self.assertRaises(ValueError):
                release.smoke(self.archive())

    def test_same_source_digest_order_across_platforms(self) -> None:
        """摘要使用明确相对路径顺序，调用方输入顺序不能改变结果。"""
        paths = [
            self.root / "apps/web-ele/dist/index.html",
            self.root / "apps/web-ele/dist/_app.config.js",
        ]
        self.assertEqual(
            build_record.digest_files(self.root, paths),
            build_record.digest_files(self.root, paths[::-1]),
        )


if __name__ == "__main__":
    unittest.main()
