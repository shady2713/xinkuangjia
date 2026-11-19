#!/usr/bin/env python3
"""跨平台校验 Vue Vben Admin CRUD 模块的文件完整性、导入层级与类型检查。

用法（在管理前端根目录 前端代码/basic-framework-admin 下执行）：
  python -B -X utf8 ../../.agents/skills/weetion-development-web-standards/scripts/check_crud.py <api-path> <views-path>

@author shady2713
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True


def find_typecheck_dir(view_path: Path) -> Path | None:
    """向上查找包含 tsconfig.json 的所属应用目录。

    Args:
        view_path: 页面模块目录路径。
    Returns:
        最近的包含 tsconfig.json 的祖先目录；未找到时返回 None。
    """
    current = view_path.resolve().parent
    while current != current.parent:
        if (current / "tsconfig.json").is_file():
            return current
        current = current.parent
    return None


def scan_lines(paths: list[Path], needle: str) -> list[str]:
    """在指定目录的 TS 与 Vue 文件中检索包含给定子串的行。

    Args:
        paths: 待扫描的目录列表。
        needle: 目标匹配文本。
    Returns:
        格式为 ``path:line: content`` 的命中列表。
    """
    hits: list[str] = []
    for base in paths:
        if not base.is_dir():
            continue
        for file_path in sorted(base.rglob("*")):
            if not file_path.is_file() or file_path.suffix not in {".ts", ".vue"}:
                continue
            for index, line in enumerate(
                file_path.read_text(encoding="utf-8", errors="replace").splitlines(), 1
            ):
                if needle in line:
                    hits.append(f"{file_path.as_posix()}:{index}: {line.strip()}")
    return hits


def main(argv: list[str] | None = None) -> int:
    """执行四步 CRUD 结构与类型校验并返回退出码。

    Args:
        argv: 命令行参数列表（不含程序名）。
    Returns:
        0 表示通过，1 表示存在阻断项。
    """
    args = [item for item in (argv if argv is not None else sys.argv[1:]) if item != "--skip-typecheck"]
    skip_typecheck = "--skip-typecheck" in (argv if argv is not None else sys.argv[1:])
    if len(args) < 2 or not args[0].strip() or not args[1].strip():
        print("请提供实际的 <api-path> 与 <views-path>", file=sys.stderr)
        return 1

    api_path = Path(args[0])
    view_path = Path(args[1])
    errors = 0

    print(f"开始检查 CRUD 模块：api={api_path.as_posix()} views={view_path.as_posix()}")

    # 步骤 1：TypeScript 类型检查（缺少 tsconfig 或 pnpm 时默认失败关闭返回 2）
    if not skip_typecheck:
        typecheck_dir = find_typecheck_dir(view_path)
        pnpm_bin = shutil.which("pnpm") or shutil.which("pnpm.cmd")
        if typecheck_dir is None:
            print(
                f"错误：未找到 {view_path.as_posix()} 所属应用包的 tsconfig.json，无法验证类型",
                file=sys.stderr,
            )
            return 2
        if pnpm_bin is None:
            print("错误：未找到 pnpm，无法执行类型检查", file=sys.stderr)
            return 2
        completed = subprocess.run(
            [pnpm_bin, "exec", "vue-tsc", "--noEmit", "--skipLibCheck"],
            cwd=typecheck_dir,
            check=False,
        )
        if completed.returncode != 0:
            print("错误：TypeScript 类型检查失败", file=sys.stderr)
            errors += 1
        else:
            print("通过：TypeScript 类型检查")

    # 步骤 2：必需文件检查（API 类型允许内聚在 index.ts 或独立 types.ts）
    required_files = [
        api_path / "index.ts",
        view_path / "index.vue",
        view_path / "modules" / "form.vue",
        view_path / "data.ts",
    ]
    for required in required_files:
        if not required.is_file():
            print(f"错误：缺少必需文件 {required.as_posix()}", file=sys.stderr)
            errors += 1
        else:
            print(f"通过：存在 {required.as_posix()}")

    # 步骤 3：禁止跨模块多级相对路径（模块内 modules/form.vue 引用 ../data 合法，禁止 ../../ 越界）
    relative_hits = scan_lines([view_path, api_path], "../../") + scan_lines(
        [api_path], "../"
    )
    if relative_hits:
        print("错误：发现越界相对路径，跨模块引用请改用 #/ 别名：", file=sys.stderr)
        for item in relative_hits:
            print(f"  {item}", file=sys.stderr)
        errors += 1
    else:
        print("通过：未发现越界相对路径")

    # 步骤 4：拦截未注册的失效表格渲染器（如 CellDatetime）并提示显式 any
    invalid_renderers = scan_lines([view_path], "CellDatetime")
    if invalid_renderers:
        print("错误：检测到未注册的表格渲染器 CellDatetime，请改用 formatter: 'formatDateTime'：", file=sys.stderr)
        for item in invalid_renderers:
            print(f"  {item}", file=sys.stderr)
        errors += 1

    any_hits = scan_lines([api_path, view_path], ": any")
    if any_hits:
        print("提示：发现 ': any' 类型注解，建议收窄为明确接口类型：")
        for item in any_hits:
            print(f"  {item}")

    if errors > 0:
        print(f"CRUD 检查失败，共 {errors} 项阻断问题", file=sys.stderr)
        return 1
    print("全部检查通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
