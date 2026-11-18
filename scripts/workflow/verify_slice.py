#!/usr/bin/env python3
"""Vibe-Coding 增量切片快速验证器：根据相对基线的改动域按需运行秒级门禁。

自动识别受影响的 Java 子模块、前端文件、Python 工具脚本与 Markdown 文档，
仅运行命中的增量注释检查、文档契约检查及定向单测/Lint，缩短本地与智能体反馈闭环。

用法：
  python -B -X utf8 scripts/workflow/verify_slice.py --plan
  python -B -X utf8 scripts/workflow/verify_slice.py --base HEAD
  python -B -X utf8 scripts/workflow/verify_slice.py --base main --skip-runtime

@author shady2713
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path

sys.dont_write_bytecode = True

DEFAULT_ROOT = Path(__file__).resolve().parents[2]
WEB_SOURCE_SUFFIXES = frozenset({".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue"})


@dataclass(frozen=True)
class SliceStep:
    """描述单个待执行的增量检查步骤。"""

    name: str
    cwd: str
    command: tuple[str, ...]


@dataclass(frozen=True)
class SlicePlan:
    """描述当前工作区相对基线的改动归类与待运行步骤。"""

    base: str
    changed_files: tuple[str, ...]
    java_modules: tuple[str, ...]
    web_files: tuple[str, ...]
    python_files: tuple[str, ...]
    doc_files: tuple[str, ...]
    steps: tuple[SliceStep, ...]


def collect_changed_files(root: Path, base: str = "HEAD") -> list[str]:
    """收集相对指定 Git 基线的已暂存、未暂存与未跟踪文件集合。

    Args:
        root: 仓库根目录。
        base: Git 比较基线引用（默认 HEAD）。
    Returns:
        升序去重后的仓库相对 POSIX 路径列表。
    Raises:
        RuntimeError: Git 命令失败或基线不存在时抛出。
    """
    resolved = root.resolve()
    diff_proc = subprocess.run(
        ["git", "-c", "core.quotepath=false", "diff", "--name-only", "-z", base, "--"],
        cwd=resolved,
        capture_output=True,
        check=False,
        timeout=30,
    )
    if diff_proc.returncode != 0:
        err = diff_proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"无法比较基线 {base}：{err or 'git diff 失败'}")

    untracked_proc = subprocess.run(
        ["git", "-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard", "-z"],
        cwd=resolved,
        capture_output=True,
        check=False,
        timeout=30,
    )
    paths = {
        raw.decode("utf-8", errors="replace")
        for raw in (diff_proc.stdout + untracked_proc.stdout).split(b"\0")
        if raw
    }
    return sorted(paths)


def resolve_java_modules(root: Path, changed_files: list[str]) -> list[str]:
    """根据改动文件向上查找所属 Maven 子模块相对目录。

    Args:
        root: 仓库根目录。
        changed_files: 改动文件相对路径列表。
    Returns:
        相对于 后端代码/basic-framework-boot 的 Maven 子模块路径列表。
    """
    boot_root = root.resolve() / "后端代码" / "basic-framework-boot"
    modules: set[str] = set()
    for rel in changed_files:
        if not rel.startswith("后端代码/basic-framework-boot/"):
            continue
        candidate = (root.resolve() / rel).parent
        while candidate.is_relative_to(boot_root) and candidate != boot_root:
            if (candidate / "pom.xml").is_file():
                modules.add(candidate.relative_to(boot_root).as_posix())
                break
            candidate = candidate.parent
    return sorted(modules)


def build_slice_plan(
    root: Path,
    changed_files: list[str],
    *,
    base: str = "HEAD",
    skip_runtime: bool = False,
) -> SlicePlan:
    """根据改动路径分类构建最小完备的增量检查计划。

    Args:
        root: 仓库根目录。
        changed_files: 改动文件相对路径列表。
        base: Git 基线名称。
        skip_runtime: 为 True 时仅运行快速静态/注释/文档门禁，跳过 Maven/ESLint 子进程。
    Returns:
        结构化增量验证计划。
    """
    resolved = root.resolve()
    py_exe = sys.executable
    boot_dir = resolved / "后端代码" / "basic-framework-boot"
    web_dir = resolved / "前端代码" / "basic-framework-admin"

    java_files = [
        p for p in changed_files if p.startswith("后端代码/basic-framework-boot/") and p.endswith(".java")
    ]
    java_modules = resolve_java_modules(resolved, changed_files)
    web_files = [
        p
        for p in changed_files
        if p.startswith("前端代码/basic-framework-admin/")
        and Path(p).suffix.lower() in WEB_SOURCE_SUFFIXES
        and not p.endswith(".d.ts")
        and (resolved / p).is_file()
    ]
    python_files = [p for p in changed_files if p.endswith(".py") and (resolved / p).is_file()]
    doc_files = [
        p
        for p in changed_files
        if p.endswith(".md")
        or Path(p).name in {"package.json", "pom.xml", "pyproject.toml", "document_rules.py"}
    ]

    steps: list[SliceStep] = []
    if java_files:
        steps.append(
            SliceStep(
                name="java-comments",
                cwd=str(resolved),
                command=(py_exe, "-B", "-X", "utf8", "scripts/code/java/check_worktree_java_comments.py"),
            )
        )
    if python_files:
        steps.append(
            SliceStep(
                name="python-comments",
                cwd=str(resolved),
                command=(
                    py_exe,
                    "-B",
                    "-X",
                    "utf8",
                    "scripts/code/python/check_worktree_python_comments.py",
                ),
            )
        )
    if web_files:
        steps.append(
            SliceStep(
                name="web-comments",
                cwd=str(resolved),
                command=(py_exe, "-B", "-X", "utf8", "scripts/code/web/check_worktree_web_comments.py"),
            )
        )
    if doc_files:
        steps.append(
            SliceStep(
                name="docs-gates",
                cwd=str(resolved),
                command=(
                    py_exe,
                    "-B",
                    "-X",
                    "utf8",
                    "scripts/workflow/run_checks.py",
                    "--group",
                    "docs",
                ),
            )
        )

    if not skip_runtime:
        mvn_bin = shutil.which("mvn") or shutil.which("mvn.cmd")
        if java_modules and mvn_bin:
            steps.append(
                SliceStep(
                    name="maven-slice-test",
                    cwd=str(boot_dir),
                    command=(mvn_bin, "-B", "-ntp", "-pl", ",".join(java_modules), "test"),
                )
            )
        pnpm_bin = shutil.which("pnpm") or shutil.which("pnpm.cmd")
        if web_files and pnpm_bin and len(web_files) <= 40:
            rel_web = [
                Path(p).relative_to("前端代码/basic-framework-admin").as_posix() for p in web_files
            ]
            steps.append(
                SliceStep(
                    name="web-slice-eslint",
                    cwd=str(web_dir),
                    command=(pnpm_bin, "exec", "eslint", "--cache", *rel_web),
                )
            )

    return SlicePlan(
        base=base,
        changed_files=tuple(changed_files),
        java_modules=tuple(java_modules),
        web_files=tuple(web_files),
        python_files=tuple(python_files),
        doc_files=tuple(doc_files),
        steps=tuple(steps),
    )


def execute_slice_plan(plan: SlicePlan) -> tuple[int, list[dict[str, object]]]:
    """顺序执行切片检查计划并记录每一步耗时与退出码。"""
    results: list[dict[str, object]] = []
    overall = 0
    for step in plan.steps:
        started = time.monotonic()
        completed = subprocess.run(step.command, cwd=step.cwd, check=False)
        elapsed = round(time.monotonic() - started, 3)
        results.append({"name": step.name, "code": completed.returncode, "seconds": elapsed})
        if completed.returncode != 0 and overall == 0:
            overall = 1
    return overall, results


def main(argv: list[str] | None = None) -> int:
    """解析命令行参数并输出切片计划或执行增量门禁。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="仓库根目录")
    parser.add_argument("--base", default="HEAD", help="Git 比较基线（默认 HEAD）")
    parser.add_argument("--plan", action="store_true", help="仅打印命中切片与命令计划，不执行子进程")
    parser.add_argument("--skip-runtime", action="store_true", help="跳过 Maven 与 ESLint 运行时步骤")
    parser.add_argument("--json", action="store_true", help="以 JSON 格式输出结果")
    args = parser.parse_args(argv)

    try:
        changed = collect_changed_files(args.root, args.base)
        plan = build_slice_plan(
            args.root, changed, base=args.base, skip_runtime=args.skip_runtime
        )
    except RuntimeError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2

    if args.plan:
        if args.json:
            print(json.dumps(asdict(plan), ensure_ascii=False, indent=2))
        else:
            print(f"基线：{plan.base}，检测到 {len(plan.changed_files)} 个变更文件，命中 {len(plan.steps)} 项检查：")
            for step in plan.steps:
                print(f"  - [{step.name}] ({step.cwd}) {' '.join(step.command)}")
        return 0

    if not plan.steps:
        print("当前工作区未命中需要执行的增量检查步骤。")
        return 0

    code, outcomes = execute_slice_plan(plan)
    if args.json:
        print(json.dumps({"code": code, "outcomes": outcomes}, ensure_ascii=False, indent=2))
    else:
        total_sec = sum(float(item["seconds"]) for item in outcomes)
        print(f"增量切片检查完成：{len(outcomes)} 项，总耗时 {total_sec:.2f}s，退出码 {code}。")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
