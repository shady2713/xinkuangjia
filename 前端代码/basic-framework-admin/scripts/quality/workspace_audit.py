"""只读检查当前前端的源码依赖、分层方向和配置入口。

运行 python -B -X utf8 scripts/quality/workspace_audit.py --kind all。
使用本前端已安装的 Node、TypeScript 和 Vue 解析器；不执行目标源码。
@author 李杰
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import verify_workspace_constraints as workspace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from development_rules import BASE_PACKAGES, CONFIG_OWNER, SOURCE_SUFFIXES

BRIDGE = (
    Path(__file__).resolve().parents[2]
    / "internal/lint-configs/eslint-config/src/rules/development-parser.mjs"
)


def packages(root: Path) -> list[workspace.Package]:
    """复用工作区发现规则；重复名称或无效依赖配置先由工作区检查拒绝。"""
    report = workspace.inspect(root)
    if report["code"]:
        raise workspace.InputError("工作区清单有问题，请先运行 quality:workspace")
    return workspace._packages(root, workspace._yaml(root / "pnpm-workspace.yaml", root))


def source_files(root: Path, items: list[workspace.Package]) -> list[Path]:
    """仅扫描各包 src 目录，跳过依赖、产物与链接；遍历失败不能算通过。"""
    result: set[Path] = set()
    for package in items:
        source = package.path.parent / "src"
        if not source.exists():
            continue
        if workspace._link(source):
            raise workspace.InputError("源码根目录不允许链接")
        for directory, names, files in os.walk(source, followlinks=False, onerror=walk_error):
            parent = Path(directory)
            for name in names:
                if name not in workspace.EXCLUDED and workspace._link(parent / name):
                    raise workspace.InputError("源码目录不允许链接")
            names[:] = sorted(name for name in names if name not in workspace.EXCLUDED)
            for name in sorted(files):
                path = parent / name
                if path.suffix in SOURCE_SUFFIXES:
                    result.add(path)
    return sorted(result)


def walk_error(error: OSError) -> None:
    """无法读取目录时中止，防止遗漏源码后误报成功。"""
    raise workspace.InputError("源码目录无法读取") from error


def parse_files(root: Path, paths: list[Path]) -> tuple[list[dict[str, object]], set[str]]:
    """分批使用真实语法树提取源码事实；解析失败、超时或缺少 Node 均中止。

    Args:
        root: 当前前端根目录。
        paths: 已发现的源码文件列表。
    Returns:
        每个文件的导入及配置位置、Node 内建模块集合。
    Raises:
        InputError: 输入过大、解析器异常或协议不完整。
    """
    node = shutil.which("node")
    if not node:
        raise workspace.InputError("缺少 Node.js，请准备所属前端的依赖")
    facts: list[dict[str, object]] = []
    builtins: set[str] = set()
    for start in range(0, len(paths), 100):
        batch = [
            {"path": p.relative_to(root).as_posix(), "source": workspace._read(p, root)}
            for p in paths[start : start + 100]
        ]
        payload = json.dumps(batch, ensure_ascii=False)
        if len(payload.encode("utf-8")) > 32 * 1024 * 1024:
            raise workspace.InputError("源码批次超过 32 MiB")
        completed = subprocess.run(
            [node, str(BRIDGE), "--stdio"],
            input=payload,
            capture_output=True,
            encoding="utf-8",
            timeout=60,
            check=False,
        )
        if completed.returncode:
            raise workspace.InputError("源码解析失败；请检查当前前端解析依赖及源码语法")
        try:
            result = json.loads(completed.stdout)
            if len(result["files"]) != len(batch):
                raise ValueError("不完整")
            facts.extend(result["files"])
            builtins.update(result["builtins"])
        except (ValueError, KeyError, TypeError) as exc:
            raise workspace.InputError("解析器返回不完整结果") from exc
    return facts, builtins


def package_name(spec: str) -> str:
    """把带子路径和 Vite 查询参数的裸导入转为 npm 包名。"""
    clean = spec.split("?", 1)[0]
    return "/".join(clean.split("/")[:2]) if clean.startswith("@") else clean.split("/")[0]


def owner(path: Path, items: list[workspace.Package]) -> workspace.Package:
    """选择路径最深的所属包，避免根包遮蔽子包清单。"""
    return max(
        (p for p in items if path.is_relative_to(p.path.parent)), key=lambda p: len(p.path.parts)
    )


def forbidden_layer(path: str, spec: str, app_packages: set[str] | None = None) -> bool:
    """禁止共享包向上依赖应用或聚合层；应用可消费自己的源码别名。

    Args:
        path: 相对于前端工作区的源文件路径。
        spec: 导入说明符，跨包相对导入已转换为目标包名。
        app_packages: 从工作区清单发现的应用包名。
    Returns:
        导入方向违反当前工程边界时为 True。
    """
    if path.startswith("packages/") and (
        spec.startswith("#/") or package_name(spec) in (app_packages or set())
    ):
        return True
    if path.startswith("packages/@core/base/"):
        return spec.startswith(("@vben/", "@vben-core/"))
    if path.startswith("packages/@core/"):
        return spec.startswith("@vben/")
    if any(path.startswith(f"packages/{part}/") for part in BASE_PACKAGES):
        return spec.startswith("@vben/")
    return False


def inspect(root: Path, kind: str) -> dict[str, object]:
    """检查当前工程并返回诊断；不修复清单、不改变业务源码。

    Args:
        root: 包含 pnpm 配置的前端根目录。
        kind: dependencies、layers、config 或 all。
    Returns:
        扫描规模、诊断和动态导入覆盖提示；规则问题 code 为 1。
    Raises:
        InputError: 工作区或源码不能可靠解析。
    """
    root = root.resolve()
    items = packages(root)
    app_packages = {
        item.name for item in items if item.path.relative_to(root).as_posix().startswith("apps/")
    }
    paths = source_files(root, items)
    facts, builtins = parse_files(root, paths)
    findings: list[dict[str, object]] = []
    dynamic: list[dict[str, object]] = []
    for fact in facts:
        relative = fact["path"]
        package = owner(root / relative, items)
        declared = {
            name for section in workspace.SECTIONS for name in package.manifest.get(section, {})
        }
        aliases = package.manifest.get("imports", {})
        for entry in fact["imports"]:
            spec = entry["spec"]
            target = spec
            if spec.startswith("."):
                target_path = (root / relative).parent / spec.split("?", 1)[0]
                resolved = target_path.resolve()
                if not resolved.is_relative_to(root):
                    findings.append(
                        {"path": relative, "line": entry["line"], "rule": "import-outside"}
                    )
                    continue
                target_package = owner(resolved, items)
                # 包内相对导入不跨层；跨包路径转换成真实目标包名后判定方向。
                target = target_package.name if target_package.path != package.path else ""
                if kind in ("all", "dependencies") and target and target not in declared:
                    findings.append(
                        {
                            "path": relative,
                            "line": entry["line"],
                            "rule": "undeclared-dependency",
                            "package": target,
                        }
                    )
            is_local = spec.startswith((".", "/", "#", "virtual:", "\0"))
            if kind in ("all", "dependencies") and not is_local:
                name = package_name(spec)
                if (
                    name not in builtins
                    and not name.startswith("node:")
                    and name != package.name
                    and name not in declared
                ):
                    findings.append(
                        {
                            "path": relative,
                            "line": entry["line"],
                            "rule": "undeclared-dependency",
                            "package": name,
                        }
                    )
            if (
                spec.startswith("#")
                and kind in ("all", "dependencies")
                and not any(fnmatch.fnmatchcase(spec, alias) for alias in aliases)
            ):
                findings.append(
                    {"path": relative, "line": entry["line"], "rule": "unknown-package-alias"}
                )
            if kind in ("all", "layers") and forbidden_layer(relative, target, app_packages):
                findings.append(
                    {"path": relative, "line": entry["line"], "rule": "layer-direction"}
                )
        if kind in ("all", "config"):
            for entry in fact["config"]:
                if entry["rule"] == "config-owner" and relative == CONFIG_OWNER:
                    continue
                # 声明文件和测试不属于运行时配置入口，仍参与依赖和分层检查。
                if relative.endswith(".d.ts") or any(
                    part in relative for part in (".test.", ".spec.", "/__tests__/")
                ):
                    continue
                findings.append({"path": relative, **entry})
        dynamic.extend({"path": relative, "line": line} for line in fact["dynamic"])
    return {
        "packages": len(items),
        "files": len(paths),
        "findings": findings,
        "dynamicImports": dynamic,
        "code": 1 if findings else 0,
    }


def main() -> int:
    """解析命令并输出结构化诊断；输入或环境错误返回 2，不回显敏感源码。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument(
        "--kind", choices=("all", "dependencies", "layers", "config"), default="all"
    )
    args = parser.parse_args()
    try:
        report = inspect(args.root, args.kind)
    except (workspace.InputError, OSError, subprocess.TimeoutExpired) as exc:
        report = {
            "code": 2,
            "error": str(exc) if isinstance(exc, workspace.InputError) else "环境或子进程失败",
        }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return int(report["code"])


if __name__ == "__main__":
    raise SystemExit(main())
