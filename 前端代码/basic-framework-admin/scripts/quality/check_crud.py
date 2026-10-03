"""验证完整 CRUD 的文件、真实导入边界、应用类型和模块 ESLint。

运行 python -B -X utf8 scripts/quality/check_crud.py <api-path> <views-path>。
缺少环境或解析失败返回 2，类型和规则失败返回非零；不修复或暂存源码。
@author OpenAI Codex
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

import workspace_audit as audit
from run_frontend_tests import run_process


def inspect_modules(root: Path, api: Path, views: Path) -> tuple[Path, list[Path]]:
    """验证同一应用下的 CRUD 文件，允许各模块内部的相对导入。

    Args:
        root: 前端工作区根目录。
        api: API 模块目录。
        views: 页面模块目录。
    Returns:
        所属应用目录和实际被解析的源文件。
    Raises:
        InputError: 文件缺失、目录越界、语法无法解析或导入越出模块。
    """
    root, api, views = root.resolve(), api.resolve(), views.resolve()
    app = next((p for p in views.parents if (p / "tsconfig.json").is_file()), None)
    if app is None or not app.is_relative_to(root / "apps"):
        raise audit.workspace.InputError("页面不属于具有 tsconfig.json 的应用")
    if not api.is_relative_to(app / "src/api") or not views.is_relative_to(app / "src/views"):
        raise audit.workspace.InputError("API 与页面必须位于同一应用的 src/api 和 src/views 下")
    required = [api / "types.ts", api / "index.ts", views / "index.vue",
                views / "data.ts", views / "modules/form.vue"]
    for path in required:
        if not path.is_file():
            raise audit.workspace.InputError(f"缺少 CRUD 文件：{path.relative_to(root)}")
    files: list[Path] = []
    for module in (api, views):
        for path in sorted(module.rglob("*")):
            if audit.workspace._link(path):
                raise audit.workspace.InputError("CRUD 模块不允许通过链接绕过扫描范围")
            if path.is_file() and path.suffix in audit.SOURCE_SUFFIXES:
                files.append(path)
    facts, _ = audit.parse_files(root, files)
    for fact in facts:
        path = root / fact["path"]
        module = api if path.is_relative_to(api) else views
        if fact["dynamic"]:
            raise audit.workspace.InputError(f"无法静态验证动态导入：{fact['path']}")
        for entry in fact["imports"]:
            spec = entry["spec"].split("?", 1)[0]
            if spec.startswith(".") and not (path.parent / spec).resolve().is_relative_to(module):
                raise audit.workspace.InputError(
                    f"跨模块引用须使用应用别名：{fact['path']}:{entry['line']}"
                )
    return app, files


def validate(root: Path, api: Path, views: Path) -> int:
    """运行应用类型及模块 ESLint；缺少必需检查不会输出成功。

    Args:
        root: 已安装锁定依赖的前端工作区。
        api: API 模块目录。
        views: 页面模块目录。
    Returns:
        验证成功为 0，否则保留实际检查退出码。
    Raises:
        InputError: 缺少环境或模块结构、导入边界无效。
    """
    app, files = inspect_modules(root, api, views)
    node = shutil.which("node")
    typecheck = root / "node_modules/vue-tsc/bin/vue-tsc.js"
    eslint = root / "node_modules/eslint/bin/eslint.js"
    if not node or not typecheck.is_file() or not eslint.is_file():
        raise audit.workspace.InputError("缺少 Node.js 或前端锁定依赖；类型与 ESLint 未验证")
    print(f"CRUD 解析完成：{len(files)} 个文件；开始应用类型和模块 ESLint 检查。", flush=True)
    result = run_process([node, str(typecheck), "--noEmit"], app, dict(os.environ), 300)
    if result:
        return result
    result = run_process(
        [node, str(eslint), "--max-warnings", "0", "--rule",
         "@typescript-eslint/no-explicit-any:error", *[str(path) for path in files]],
        root, dict(os.environ), 300,
    )
    if result == 0:
        print("🎉 全部检查通过：文件、导入边界、应用类型和模块 ESLint。")
    return result


def main() -> int:
    """解析两个实际模块目录；缺少环境或无法读取文件时返回 2。"""
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("api", type=Path)
    parser.add_argument("views", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    try:
        return validate(root, args.api.resolve(), args.views.resolve())
    except (OSError, subprocess.TimeoutExpired, audit.workspace.InputError) as exc:
        print(f"CRUD 未通过：{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
