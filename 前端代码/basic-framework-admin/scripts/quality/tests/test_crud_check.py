"""验证 CRUD 模块的合法相对导入和必需检查失败边界。

@author OpenAI Codex
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import check_crud as crud


class CrudCheckTests(unittest.TestCase):
    """使用独立目录及实际 TS/Vue 解析器验证边界，不运行应用服务。"""

    def setUp(self) -> None:
        """准备五个必需模块文件和所属应用配置。"""
        temporary = tempfile.TemporaryDirectory(prefix="crud-check-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.app = self.root / "apps/web-ele"
        self.api = self.app / "src/api/example"
        self.views = self.app / "src/views/example"
        self.write(self.app / "tsconfig.json", "{}")
        self.write(self.api / "types.ts", "export interface Item { id: string; }")
        self.write(self.api / "index.ts", 'export type { Item } from "./types";')
        self.write(self.views / "data.ts", "export const fields = [];")
        self.write(self.views / "index.vue", '<script setup lang="ts">import "./data";</script>')
        self.write(self.views / "modules/form.vue", '<script setup lang="ts">import "../data";</script>')

    def write(self, path: Path, source: str) -> None:
        """只向当前测试临时根目录写入 UTF-8 样例。"""
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source, encoding="utf-8", newline="\n")

    def test_template_local_imports_and_comment_text_are_allowed(self) -> None:
        """模板的 ../data 合法，注释和字符串中的上级目录不是导入。"""
        self.write(self.views / "data.ts", '// import "../../outside";\nconst text = "../../outside";')
        app, files = crud.inspect_modules(self.root, self.api, self.views)
        self.assertEqual(app, self.app)
        self.assertEqual(len(files), 5)

    def test_cross_module_and_nonliteral_imports_are_rejected(self) -> None:
        """静态、动态、重导出越界均失败，变量动态导入不会被静默忽略。"""
        for source in ('import "../other";', 'import("../other");',
                       'export * from "../other";', 'import(target);'):
            with self.subTest(source=source):
                self.write(self.views / "data.ts", source)
                with self.assertRaises(crud.audit.workspace.InputError):
                    crud.inspect_modules(self.root, self.api, self.views)

    def test_missing_config_file_or_dependencies_never_succeeds(self) -> None:
        """真实 CLI 对缺少配置返回非零；缺少必需文件或依赖也不能通过。"""
        script = Path(crud.__file__).resolve()
        (self.app / "tsconfig.json").unlink()
        completed = subprocess.run(
            [sys.executable, "-B", str(script), str(self.api), str(self.views)],
            capture_output=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(completed.returncode, 2)
        self.assertNotIn("全部检查通过", completed.stdout)
        self.write(self.app / "tsconfig.json", "{}")
        with self.assertRaises(crud.audit.workspace.InputError):
            crud.validate(self.root, self.api, self.views)
        (self.api / "types.ts").unlink()
        with self.assertRaises(crud.audit.workspace.InputError):
            crud.inspect_modules(self.root, self.api, self.views)

    def test_typecheck_failure_stops_lint_and_keeps_exit_code(self) -> None:
        """检查进程失败时不运行后续步骤，也不输出完整通过。"""
        self.write(self.root / "node_modules/vue-tsc/bin/vue-tsc.js", "")
        self.write(self.root / "node_modules/eslint/bin/eslint.js", "")
        with patch.object(crud, "run_process", return_value=9) as runner:
            self.assertEqual(crud.validate(self.root, self.api, self.views), 9)
            self.assertEqual(runner.call_count, 1)


if __name__ == "__main__":
    unittest.main()
