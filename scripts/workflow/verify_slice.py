#!/usr/bin/env python3
"""Vibe-Coding 增量切片快速验证器：根据相对基线的改动域按需运行定向门禁。

自动解析 merge-base 并识别受影响的 Java 子模块、前端文件、Python 工具脚本与 Markdown 文档，
将有效基线透传至注释与契约检查器，避免分支提交后出现 0 文件假绿。

用法：
  python -B -X utf8 scripts/workflow/verify_slice.py --plan
  python -B -X utf8 scripts/workflow/verify_slice.py --base HEAD
  python -B -X utf8 scripts/workflow/verify_slice.py --base main --skip-runtime

@author shady2713
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
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
class SkippedStep:
    """描述未执行或按参数跳过的检查步骤及明确原因。"""

    name: str
    reason: str


@dataclass(frozen=True)
class SlicePlan:
    """描述当前工作区相对基线的改动归类与待运行步骤。"""

    base: str
    effective_base: str
    changed_files: tuple[str, ...]
    java_modules: tuple[str, ...]
    web_files: tuple[str, ...]
    python_files: tuple[str, ...]
    doc_files: tuple[str, ...]
    steps: tuple[SliceStep, ...]
    skipped_steps: tuple[SkippedStep, ...] = ()


def resolve_head_sha(root: Path) -> str:
    """读取当前仓库 HEAD 提交标识，用于将验收证据绑定到精确受验版本。"""
    proc = subprocess.run(
        ["git", "-c", "core.quotepath=false", "rev-parse", "HEAD"],
        cwd=root.resolve(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
        timeout=15,
    )
    return proc.stdout.strip() if proc.returncode == 0 and proc.stdout.strip() else "UNKNOWN"


def is_worktree_dirty(root: Path) -> bool:
    """检测当前工作区或暂存区是否存在未提交改动，避免用脏树结果冒充干净提交证据。"""
    proc = subprocess.run(
        ["git", "-c", "core.quotepath=false", "status", "--porcelain"],
        cwd=root.resolve(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
        timeout=15,
    )
    return proc.returncode == 0 and bool(proc.stdout.strip())


def resolve_effective_base(root: Path, base: str = "HEAD") -> str:
    """当对比非 HEAD 分支时解析 merge-base，避免把主干新提交误算为当前切片变更。

    Args:
        root: 仓库根目录。
        base: 用户指定的 Git 引用（如 HEAD、main）。
    Returns:
        用于 diff 与注释门禁的有效基线提交标识或 HEAD。
    """
    if base == "HEAD":
        return "HEAD"
    resolved = root.resolve()
    proc = subprocess.run(
        ["git", "-c", "core.quotepath=false", "merge-base", base, "HEAD"],
        cwd=resolved,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
        timeout=30,
    )
    if proc.returncode == 0 and proc.stdout.strip():
        return proc.stdout.strip()
    return base


def _has_staged_changes(root: Path) -> bool:
    """判断当前 Git 索引是否存在已暂存变更，用于按需触发暂存密钥扫描。"""
    proc = subprocess.run(
        ["git", "-c", "core.quotepath=false", "diff", "--cached", "--name-only"],
        cwd=root.resolve(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
        timeout=15,
    )
    return proc.returncode == 0 and bool(proc.stdout.strip())


def collect_changed_files(root: Path, base: str = "HEAD") -> list[str]:
    """收集相对指定 Git 基线（自动取 merge-base）的已暂存、未暂存与未跟踪文件集合。

    Args:
        root: 仓库根目录。
        base: Git 比较基线引用（默认 HEAD）。
    Returns:
        升序去重后的仓库相对 POSIX 路径列表。
    Raises:
        RuntimeError: Git 命令失败或基线不存在时抛出。
    """
    resolved = root.resolve()
    effective_base = resolve_effective_base(resolved, base)
    diff_proc = subprocess.run(
        ["git", "-c", "core.quotepath=false", "diff", "--name-only", "-z", effective_base, "--"],
        cwd=resolved,
        capture_output=True,
        check=False,
        timeout=30,
    )
    if diff_proc.returncode != 0:
        err = diff_proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"无法比较基线 {effective_base}：{err or 'git diff 失败'}")

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


def _collect_worktree_changed_files(root: Path) -> list[str]:
    """收集工作区相对 HEAD 的未提交、已暂存与未跟踪文件，用于补充分支基线遗漏的本地改动。

    Args:
        root: 仓库根目录。
    Returns:
        升序去重后的仓库相对 POSIX 路径列表。
    """
    resolved = root.resolve()
    diff_proc = subprocess.run(
        ["git", "-c", "core.quotepath=false", "diff", "--name-only", "-z", "HEAD", "--"],
        cwd=resolved,
        capture_output=True,
        check=False,
        timeout=30,
    )
    if diff_proc.returncode != 0:
        return []
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


def _has_committed_diff(root: Path, effective_base: str) -> bool:
    """判断指定有效基线到 HEAD 之间是否存在已提交改动，避免同提交空比较引发假绿。

    Args:
        root: 仓库根目录。
        effective_base: 经 merge-base 解析后的基线引用或提交标识。
    Returns:
        存在已提交差异时返回 True，否则返回 False。
    """
    if effective_base == "HEAD":
        return False
    proc = subprocess.run(
        ["git", "-c", "core.quotepath=false", "diff", "--name-only", effective_base, "HEAD", "--"],
        cwd=root.resolve(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
        timeout=30,
    )
    return proc.returncode == 0 and bool(proc.stdout.strip())


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


def _find_related_web_tests(web_dir: Path, web_files: list[str]) -> list[str]:
    """收集本次前端改动中直接修改、同级或同目录 __tests__ 下对应的 Vitest 测试文件。"""
    tests: set[str] = set()
    for rel in web_files:
        inner = Path(rel).relative_to("前端代码/basic-framework-admin")
        if inner.name.endswith((".test.ts", ".spec.ts")):
            tests.add(inner.as_posix())
            continue
        sibling = web_dir / inner.with_suffix(".test.ts")
        if sibling.is_file():
            tests.add(sibling.relative_to(web_dir).as_posix())
        nested = web_dir / inner.parent / "__tests__" / f"{inner.stem}.test.ts"
        if nested.is_file():
            tests.add(nested.relative_to(web_dir).as_posix())
    return sorted(tests)


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
        skip_runtime: 为 True 时仅运行快速静态/注释/文档门禁，跳过 Maven/ESLint/单测子进程。
    Returns:
        结构化增量验证计划。
    """
    resolved = root.resolve()
    effective_base = resolve_effective_base(resolved, base)
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
    web_openapi_changed = any(
        p.startswith("前端代码/basic-framework-admin/apps/web-ele/src/api/generated/")
        for p in changed_files
    )
    python_files = [p for p in changed_files if p.endswith(".py") and (resolved / p).is_file()]
    web_quality_py_changed = any(
        p.startswith("前端代码/basic-framework-admin/scripts/quality/") for p in python_files
    )
    doc_files = [
        p
        for p in changed_files
        if p.endswith(".md")
        or Path(p).name in {"package.json", "pom.xml", "pyproject.toml", "document_rules.py"}
    ]

    worktree_changed = (
        changed_files
        if effective_base == "HEAD"
        else _collect_worktree_changed_files(resolved)
    )
    wt_java_files = [
        p
        for p in worktree_changed
        if p.startswith("后端代码/basic-framework-boot/") and p.endswith(".java") and (resolved / p).is_file()
    ]
    wt_web_files = [
        p
        for p in worktree_changed
        if p.startswith("前端代码/basic-framework-admin/")
        and Path(p).suffix.lower() in WEB_SOURCE_SUFFIXES
        and not p.endswith(".d.ts")
        and (resolved / p).is_file()
    ]
    wt_python_files = [p for p in worktree_changed if p.endswith(".py") and (resolved / p).is_file()]

    has_staged = _has_staged_changes(resolved)
    ci_workflow_changed = any(p == ".github/workflows/ci.yml" for p in changed_files)

    steps: list[SliceStep] = []
    if has_staged:
        steps.append(
            SliceStep(
                name="staged-secrets",
                cwd=str(resolved),
                command=(py_exe, "-B", "-X", "utf8", "scripts/security/scan_staged_secrets.py"),
            )
        )

    if (
        effective_base != "HEAD"
        and _has_committed_diff(resolved, effective_base)
        and (java_files or python_files or web_files)
    ):
        # 对比分支基线时覆蓋 base..HEAD 已提交的增量声明；未提交的工作区改动仍在下方补齐。
        steps.append(
            SliceStep(
                name="branch-comments",
                cwd=str(resolved),
                command=(
                    py_exe,
                    "-B",
                    "-X",
                    "utf8",
                    "scripts/workflow/run_checks.py",
                    "--group",
                    "comments",
                    "--base",
                    effective_base,
                ),
            )
        )

    if wt_java_files:
        steps.append(
            SliceStep(
                name="java-comments",
                cwd=str(resolved),
                command=(
                    py_exe,
                    "-B",
                    "-X",
                    "utf8",
                    "scripts/code/java/check_worktree_java_comments.py",
                ),
            )
        )
    if wt_python_files:
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
    if wt_web_files:
        steps.append(
            SliceStep(
                name="web-comments",
                cwd=str(resolved),
                command=(
                    py_exe,
                    "-B",
                    "-X",
                    "utf8",
                    "scripts/code/web/check_worktree_web_comments.py",
                ),
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

    sql_changed = any(p == "数据库文件/basic_framework.sql" for p in changed_files)
    py_slice_runs_all = False
    if not skip_runtime:
        if any(p.startswith(("scripts/", ".agents/skills/")) for p in python_files):
            py_tests = [p for p in python_files if p.startswith("scripts/tests/test_")]
            has_non_test_py = any(
                p.startswith(("scripts/", ".agents/skills/")) and not p.startswith("scripts/tests/")
                for p in python_files
            )
            py_slice_runs_all = has_non_test_py or not py_tests
            pytest_targets = ["scripts/tests"] if py_slice_runs_all else py_tests
            steps.append(
                SliceStep(
                    name="python-slice-pytest",
                    cwd=str(resolved),
                    command=(py_exe, "-B", "-X", "utf8", "-m", "pytest", "-q", *pytest_targets),
                )
            )
        if ci_workflow_changed and not py_slice_runs_all:
            steps.append(
                SliceStep(
                    name="ci-workflow-pytest",
                    cwd=str(resolved),
                    command=(
                        py_exe,
                        "-B",
                        "-X",
                        "utf8",
                        "-m",
                        "pytest",
                        "-q",
                        "scripts/tests/test_ci_baselines.py",
                    ),
                )
            )
        if web_quality_py_changed:
            steps.append(
                SliceStep(
                    name="web-quality-python-tests",
                    cwd=str(web_dir),
                    command=(
                        py_exe,
                        "-B",
                        "-X",
                        "utf8",
                        "-m",
                        "unittest",
                        "discover",
                        "-s",
                        "scripts/quality/tests",
                        "-p",
                        "test_*.py",
                    ),
                )
            )
        if java_modules or sql_changed:
            mvn_bin = shutil.which("mvn") or shutil.which("mvn.cmd")
            if mvn_bin is None:
                steps.append(
                    SliceStep(
                        name="maven-slice-test",
                        cwd=str(boot_dir),
                        command=(
                            py_exe,
                            "-c",
                            "import sys; sys.stderr.write('错误：检测到 Java 模块或基线 SQL 改动但环境中未安装 mvn，拒绝静默跳过\\n'); sys.exit(2)",
                        ),
                    )
                )
            else:
                if java_modules:
                    steps.append(
                        SliceStep(
                            name="maven-slice-test",
                            cwd=str(boot_dir),
                            command=(mvn_bin, "-B", "-ntp", "-pl", ",".join(java_modules), "-am", "test"),
                        )
                    )
                has_module_or_sql = sql_changed or any(
                    m.startswith("basic-framework-module-") for m in java_modules
                )
                if has_module_or_sql and "basic-framework-server" not in java_modules:
                    steps.append(
                        SliceStep(
                            name="maven-server-contracts",
                            cwd=str(boot_dir),
                            command=(
                                mvn_bin,
                                "-B",
                                "-ntp",
                                "-pl",
                                "basic-framework-server",
                                "-am",
                                "-Dtest=SchemaDoRbacParityTest,OpenApiContractSnapshotTest,FootgunArchitectureTest",
                                "-DfailIfNoTests=false",
                                "-Dsurefire.failIfNoSpecifiedTests=false",
                                "test",
                            ),
                        )
                    )
        if web_files or web_openapi_changed:
            pnpm_bin = shutil.which("pnpm") or shutil.which("pnpm.cmd")
            if pnpm_bin is None:
                steps.append(
                    SliceStep(
                        name="web-slice-eslint" if web_files else "web-slice-api-check",
                        cwd=str(web_dir),
                        command=(
                            py_exe,
                            "-c",
                            "import sys; sys.stderr.write('错误：检测到前端源码改动但环境中未安装 pnpm，拒绝静默跳过\\n'); sys.exit(2)",
                        ),
                    )
                )
            else:
                if web_files:
                    rel_web = [
                        Path(p).relative_to("前端代码/basic-framework-admin").as_posix()
                        for p in web_files
                    ]
                    steps.append(
                        SliceStep(
                            name="web-slice-eslint",
                            cwd=str(web_dir),
                            command=(pnpm_bin, "exec", "eslint", "--cache", *rel_web),
                        )
                    )
                    steps.append(
                        SliceStep(
                            name="web-slice-typecheck",
                            cwd=str(web_dir),
                            command=(pnpm_bin, "check:type"),
                        )
                    )
                    web_tests = _find_related_web_tests(web_dir, web_files)
                    if web_tests:
                        steps.append(
                            SliceStep(
                                name="web-slice-vitest",
                                cwd=str(web_dir),
                                command=(pnpm_bin, "test:unit", *web_tests),
                            )
                        )
                steps.append(
                    SliceStep(
                        name="web-slice-api-check",
                        cwd=str(web_dir),
                        command=(pnpm_bin, "api:check"),
                    )
                )

    skipped_steps: list[SkippedStep] = []
    if effective_base != "HEAD" and changed_files and not has_staged:
        skipped_steps.append(
            SkippedStep(
                "base-secrets-scan",
                "工作区无暂存变更，scan_staged_secrets 仅扫描索引；分支增量密钥由 CI secrets-scan 兜底",
            )
        )
    if skip_runtime:
        if any(p.startswith(("scripts/", ".agents/skills/")) for p in python_files) or web_quality_py_changed:
            skipped_steps.append(SkippedStep("python-runtime-tests", "指定了 --skip-runtime"))
        if ci_workflow_changed:
            skipped_steps.append(SkippedStep("ci-workflow-pytest", "指定了 --skip-runtime"))
        if java_modules or sql_changed:
            skipped_steps.append(SkippedStep("maven-runtime-tests", "指定了 --skip-runtime"))
        if web_files or web_openapi_changed:
            skipped_steps.append(SkippedStep("web-runtime-checks", "指定了 --skip-runtime"))
    if changed_files and not steps:
        skipped_steps.append(
            SkippedStep(
                "unmapped-changes",
                f"变更文件未命中自动切片路由（共 {len(changed_files)} 个），需结合目标模块或完整 CI 验收",
            )
        )

    return SlicePlan(
        base=base,
        effective_base=effective_base,
        changed_files=tuple(changed_files),
        java_modules=tuple(java_modules),
        web_files=tuple(web_files),
        python_files=tuple(python_files),
        doc_files=tuple(doc_files),
        steps=tuple(steps),
        skipped_steps=tuple(skipped_steps),
    )


def build_acceptance_evidence(
    root: Path,
    plan: SlicePlan,
    outcomes: list[dict[str, object]],
    *,
    code: int,
    pr_ref: str = "",
) -> dict[str, object]:
    """按 PR 与 head SHA 汇总可交接的结构化验收证据。

    Args:
        root: 仓库根目录。
        plan: 本次构建的增量切片计划。
        outcomes: 实际执行步骤的退出码与耗时记录。
        code: 本次验收汇总退出码。
        pr_ref: 可选关联 PR 编号或链接。
    Returns:
        包含受验版本、工作区状态、执行步骤与跳过原因的验收证据字典。
    """
    step_commands = {step.name: " ".join(step.command) for step in plan.steps}
    executed = [
        {
            "name": item["name"],
            "code": item["code"],
            "status": "passed" if item["code"] == 0 else "failed",
            "seconds": item["seconds"],
            "command": step_commands.get(str(item["name"]), ""),
        }
        for item in outcomes
    ]
    return {
        "pr": pr_ref or "unassigned",
        "head_sha": resolve_head_sha(root),
        "base": plan.base,
        "effective_base": plan.effective_base,
        "worktree_dirty": is_worktree_dirty(root),
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "overall_code": code,
        "changed_files": list(plan.changed_files),
        "executed_steps": executed,
        "skipped_steps": [asdict(item) for item in plan.skipped_steps],
    }


def render_acceptance_markdown(evidence: dict[str, object]) -> str:
    """将结构化验收证据渲染为可直接粘贴至 PR 或独立审查交接的 Markdown 摘要。"""
    lines = [
        "## 统一验收证据",
        "",
        f"- 关联 PR：`{evidence['pr']}`",
        f"- 受验版本（head SHA）：`{evidence['head_sha']}`"
        + ("（存在未提交工作区改动）" if evidence["worktree_dirty"] else "（工作区干净）"),
        f"- 比较基线：`{evidence['base']}`（有效对比点 `{evidence['effective_base']}`）",
        f"- 生成时间（UTC）：`{evidence['generated_at']}`",
        f"- 汇总退出码：`{evidence['overall_code']}`（变更文件 {len(evidence['changed_files'])} 个）",
        "",
        "### 执行步骤",
        "",
    ]
    executed = evidence["executed_steps"]
    if executed:
        lines.extend(["| 步骤 | 状态 | 退出码 | 耗时 (s) |", "| --- | --- | --- | --- |"])
        for item in executed:
            lines.append(f"| `{item['name']}` | {item['status']} | {item['code']} | {item['seconds']} |")
    else:
        lines.append("- 无实际执行步骤。")

    lines.extend(["", "### 跳过项与原因", ""])
    skipped = evidence["skipped_steps"]
    if skipped:
        for item in skipped:
            lines.append(f"- `{item['name']}`：{item['reason']}")
    else:
        lines.append("- 无跳过项。")
    return "\n".join(lines) + "\n"


def execute_slice_plan(plan: SlicePlan) -> tuple[int, list[dict[str, object]]]:
    """顺序执行切片检查计划并记录每一步耗时与退出码；保留环境错误码 2 高于规则失败 1。"""
    results: list[dict[str, object]] = []
    overall = 0
    for step in plan.steps:
        started = time.monotonic()
        try:
            completed = subprocess.run(step.command, cwd=step.cwd, check=False)
            code = completed.returncode
        except OSError as exc:
            print(f"错误：步骤 {step.name} 启动失败：{exc}", file=sys.stderr)
            code = 2
        elapsed = round(time.monotonic() - started, 3)
        results.append({"name": step.name, "code": code, "seconds": elapsed})
        if code not in (0, 1):
            overall = 2
        elif code == 1 and overall == 0:
            overall = 1
    return overall, results


def main(argv: list[str] | None = None) -> int:
    """解析命令行参数并输出切片计划、执行增量门禁或汇出 PR/SHA 验收证据。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="仓库根目录")
    parser.add_argument("--base", default="HEAD", help="Git 比较基线（默认 HEAD）")
    parser.add_argument("--plan", action="store_true", help="仅打印命中切片与命令计划，不执行子进程")
    parser.add_argument("--skip-runtime", action="store_true", help="跳过 Maven、pytest 与前端运行时步骤")
    parser.add_argument("--json", action="store_true", help="以 JSON 格式输出结果")
    parser.add_argument("--pr", default="", help="关联 PR 编号或链接，用于写入统一验收证据")
    parser.add_argument("--evidence-json", type=Path, help="将绑定 PR 与 head SHA 的结构化验收证据写入 JSON 文件")
    parser.add_argument("--evidence-md", type=Path, help="将绑定 PR 与 head SHA 的验收证据摘要写入 Markdown 文件")
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
            print(
                f"基线：{plan.base}（有效对比点 {plan.effective_base}），"
                f"检测到 {len(plan.changed_files)} 个变更文件，命中 {len(plan.steps)} 项检查："
            )
            for step in plan.steps:
                print(f"  - [{step.name}] ({step.cwd}) {' '.join(step.command)}")
        return 0

    if not plan.steps:
        code, outcomes = 0, []
    else:
        code, outcomes = execute_slice_plan(plan)

    evidence = build_acceptance_evidence(args.root, plan, outcomes, code=code, pr_ref=args.pr)
    if args.evidence_json is not None:
        args.evidence_json.parent.mkdir(parents=True, exist_ok=True)
        args.evidence_json.write_text(
            json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
        )
    if args.evidence_md is not None:
        args.evidence_md.parent.mkdir(parents=True, exist_ok=True)
        args.evidence_md.write_text(
            render_acceptance_markdown(evidence), encoding="utf-8", newline="\n"
        )

    if not plan.steps:
        if args.json:
            print(json.dumps(evidence, ensure_ascii=False, indent=2))
        else:
            print("当前工作区未命中需要执行的增量检查步骤。")
        return 0

    if args.json:
        print(json.dumps({"code": code, "outcomes": outcomes, "evidence": evidence}, ensure_ascii=False, indent=2))
    else:
        total_sec = sum(float(item["seconds"]) for item in outcomes)
        print(f"增量切片检查完成：{len(outcomes)} 项，总耗时 {total_sec:.2f}s，退出码 {code}。")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
