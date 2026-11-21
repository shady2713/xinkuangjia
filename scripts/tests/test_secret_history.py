"""验证范围内的合成密钥历史与扫描规则版本门禁。

@author Claude Code
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.security import scan_staged_secrets as scanner

SCRIPT = Path(__file__).resolve().parents[1] / "security" / "scan_staged_secrets.py"

# Isolate fixture repositories from user and system Git configuration.
GIT_ENV = {
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_AUTHOR_NAME": "Fixture",
    "GIT_AUTHOR_EMAIL": "fixture@example.invalid",
    "GIT_COMMITTER_NAME": "Fixture",
    "GIT_COMMITTER_EMAIL": "fixture@example.invalid",
}


class CommitRangeScanTest(unittest.TestCase):
    """验证扫描覆盖已删除的合成标记及规则版本更新。"""
    def setUp(self) -> None:
        """为测试创建独立 Git 仓库、作者身份及根提交。"""
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.repo = Path(temp.name)
        patcher = mock.patch.dict(os.environ, GIT_ENV)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(os.chdir, os.getcwd())
        os.chdir(self.repo)
        self.git("init", "-q")
        self.base = self.commit("README.md", "synthetic fixture\n")

    def git(self, *args: str) -> str:
        """在合成仓库执行 Git 命令并返回输出。"""
        result = subprocess.run(["git", *args], check=True, capture_output=True, text=True)
        return result.stdout.strip()

    def commit(self, path: str, content: str | None) -> str:
        """按测试要求添加或删除指定文件后生成独立提交。"""
        if content is None:
            self.git("rm", "-q", "--", path)
        else:
            target = self.repo / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
            self.git("add", "--", path)
        self.git("commit", "-q", "-m", f"update {path}")
        return self.git("rev-parse", "HEAD")

    def test_introduced_then_deleted_marker_is_reported(self) -> None:
        """验证扫描报告已被删除的合成标记位置并隐藏原值。"""
        marker = "sk-" + "z" * 24  # synthetic, built at runtime to avoid self-detection
        introduced = self.commit("config/app.yml", f"api_token: {marker}\n")
        head = self.commit("config/app.yml", None)
        result = subprocess.run(
            [sys.executable, "-B", "-X", "utf8", SCRIPT, "--base", self.base, "--head", head],
            capture_output=True, text=True, timeout=30, check=False,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("2 commit(s)", result.stdout)
        self.assertIn(introduced, result.stderr)
        self.assertNotIn(marker, result.stdout + result.stderr)

    def test_scanner_change_without_version_bump_fails(self) -> None:
        """验证修改扫描规则时必须更新版本，初始化时允许新增规则。"""
        path = scanner.SELF_TEST_PATH
        start = self.commit(path, 'RULESET_VERSION = "1.0"\n')
        unchanged = self.commit(path, 'RULESET_VERSION = "1.0"\nCHANGED = 1\n')
        rules = [item.rule for item in scanner._scan_commit_range(start, unchanged)[1]]
        self.assertIn("ruleset-version", rules)
        bumped = self.commit(path, 'RULESET_VERSION = "1.1"\nCHANGED = 1\n')
        for base in (start, self.base):  # bumped range, then bootstrap without baseline
            rules = [item.rule for item in scanner._scan_commit_range(base, bumped)[1]]
            self.assertNotIn("ruleset-version", rules)

    def test_rules_scope_change_gates_version_but_similar_name_does_not(self) -> None:
        """检查版本门禁依赖实际规则路径而非类似名称。"""
        self.commit(scanner.SELF_TEST_PATH, 'RULESET_VERSION = "1.0"\n')
        scope = "scripts/security/rules_scope.py"
        source = SCRIPT.with_name("rules_scope.py").read_text(encoding="utf-8")
        start = self.commit(scope, source)
        changed = self.commit(scope, source + "# synthetic change\n")
        doc = self.commit(scope + ".md", "Synthetic scanner notes.\n")
        for base, head, gated in ((start, changed, True), (changed, doc, False)):
            rules = [item.rule for item in scanner._scan_commit_range(base, head)[1]]
            self.assertEqual("ruleset-version" in rules, gated)

    def test_unusual_name_with_binary_attribute_is_scanned(self) -> None:
        """用合成数据证明特殊文件名和 Git 属性不影响提交扫描。"""
        marker = "sk-" + "q" * 24  # synthetic, generated at runtime
        self.commit(".gitattributes", "*.yml -diff\n")
        path = "odd dir/[x] +plus.yml"
        (self.repo / "odd dir").mkdir()
        (self.repo / path).write_text(f"++api_token: {marker}\n", encoding="utf-8")
        self.git("add", "--", f":(literal){path}")
        staged = scanner._scan_staged_diff()
        self.git("commit", "-q", "-m", "odd name")
        _, history = scanner._scan_commit_range(self.base, self.git("rev-parse", "HEAD"))
        for findings in (staged, history):
            self.assertIn((path, 1), {(item.path, item.line) for item in findings})
            self.assertTrue(all(marker not in item.detail for item in findings))


if __name__ == "__main__":
    unittest.main()
