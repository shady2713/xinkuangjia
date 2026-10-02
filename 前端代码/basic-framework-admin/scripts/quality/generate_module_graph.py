"""生成或只读核对本前端的中文模块依赖图。

运行 python -B -X utf8 scripts/quality/generate_module_graph.py [--check]。
输出固定为本前端 docs/开发指南/模块依赖关系图.md，不写入另一工程。
@author 李杰
"""

from __future__ import annotations

import argparse
import html
import sys
from pathlib import Path
from urllib.parse import quote

import verify_workspace_constraints as workspace
from workspace_audit import packages

OUTPUT = Path("docs/开发指南/模块依赖关系图.md")
MARKER = "<!-- 由 generate_module_graph.py 生成，请勿手工编辑。 -->"
LABELS = {
    "dependencies": "运行依赖",
    "devDependencies": "开发依赖",
    "optionalDependencies": "可选依赖",
    "peerDependencies": "宿主依赖",
}


def edges(items: list[workspace.Package]) -> list[tuple[str, str, str]]:
    """提取四类内部依赖，解析 workspace 别名与相对目标并保持稳定排序。"""
    names = {p.name for p in items}
    paths = {p.path.parent.resolve(): p.name for p in items}
    result: set[tuple[str, str, str]] = set()
    for package in items:
        for section in workspace.SECTIONS:
            for name, value in package.manifest.get(section, {}).items():
                target = name
                if value.startswith("workspace:"):
                    spec = value.removeprefix("workspace:")
                    alias = workspace.ALIAS.fullmatch(spec)
                    if spec.startswith(("./", "../")):
                        target = paths.get((package.path.parent / spec).resolve(), "")
                    elif alias:
                        target = alias.group(1)
                if target in names:
                    result.add((package.name, target, section))
    return sorted(result)


def render(root: Path) -> str:
    """从已验证清单生成稳定 Markdown；图按依赖类型拆分且包含无边包。

    Args:
        root: 当前前端根目录。
    Returns:
        UTF-8 文档正文，末尾含 LF；不会自行写文件。
    Raises:
        InputError: 工作区清单违反规则或不能读取。
    """
    items = sorted(packages(root), key=lambda p: p.name)
    links = edges(items)
    identifiers = {p.name: f"p{i}" for i, p in enumerate(items)}
    lines = [
        MARKER,
        "",
        "# 模块依赖关系图",
        "",
        "## 摘要",
        "",
        f"当前工作区共 {len(items)} 个包、{len(links)} 条分类依赖。箭头由使用方指向被依赖包；依据清单声明，不代表源码调用图。",
        "",
        "-----",
        "",
        "## 目录",
        "",
        "- [包清单](#包清单)",
    ]
    lines.extend(f"- [{label}](#{label})" for label in LABELS.values())
    lines.extend(
        [
            "- [开发笔记](#开发笔记)",
            "",
            "-----",
            "",
            "## 包清单",
            "",
            "| 包 | 所属清单 |",
            "| --- | --- |",
        ]
    )
    for package in items:
        name = html.escape(package.name).replace("|", "&#124;").replace("\n", " ")
        rel = package.path.relative_to(root).as_posix()
        lines.append(f"| {name} | [package.json]({quote('../../' + rel, safe='/')}) |")
    fence = chr(96) * 3
    for section, label in LABELS.items():
        lines.extend(["", "-----", "", f"## {label}", "", fence + "mermaid", "flowchart LR"])
        for package in items:
            name = html.escape(package.name, quote=True).replace("\n", " ")
            lines.append(f'  {identifiers[package.name]}["{name}"]')
        lines.extend(
            f"  {identifiers[a]} --> {identifiers[b]}" for a, b, s in links if s == section
        )
        lines.append(fence)
    lines.extend(
        [
            "",
            "-----",
            "",
            "## 开发笔记",
            "",
            "<details>",
            "<summary>生成与验证</summary>",
            "",
            "在所属前端运行 pnpm graph:modules 生成，pnpm graph:modules:check 只读检查是否最新。",
            "外部包、动态加载和源码调用不在图中。生成顺序固定；循环依赖按原边保留，不伪装成拓扑顺序。",
            "",
            "</details>",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    """写入唯一受控的生成文档；--check 不写文件，缺失或过期返回 1。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    path = root / OUTPUT
    try:
        expected = render(root)
        if not path.resolve().is_relative_to(root) or path.is_symlink():
            raise workspace.InputError("生成目录或文件不允许越界链接")
        previous = workspace._read(path, root) if path.exists() else None
        if args.check:
            print("模块依赖图已是最新。" if previous == expected else "模块依赖图缺失或过期。")
            return 0 if previous == expected else 1
        if previous is not None and not previous.startswith(MARKER):
            raise workspace.InputError("目标不是本工具生成文档，拒绝覆盖")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(expected, encoding="utf-8", newline="\n")
        print(f"已生成 {OUTPUT.as_posix()}")
        return 0
    except (workspace.InputError, OSError) as exc:
        print(f"模块图生成失败：{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
