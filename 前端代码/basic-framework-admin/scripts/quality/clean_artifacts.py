"""预览当前前端的构建产物清理；显式提供本次计划摘要才执行删除。

运行 python -B -X utf8 scripts/quality/clean_artifacts.py。
执行需 --execute <预览输出的 planId>；--dependencies 额外纳入包根 node_modules。
不删除锁文件，不递归按目录名猜测目标，不进入链接目录。
@author 李杰
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import verify_workspace_constraints as workspace
from workspace_audit import packages

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from development_rules import BUILD_OUTPUTS


def validate_target(root: Path, path: Path) -> None:
    """拒绝根目录、越界和目标自身或祖先链接，防止清理进入其他项目。"""
    if path == root or not path.resolve().is_relative_to(root):
        raise workspace.InputError("清理目标越界或指向根目录")
    for current in (path, *path.parents):
        if current == root:
            break
        if workspace._link(current):
            raise workspace.InputError("清理目标及其祖先不允许符号链接或 junction")


def tree_signature(root: Path, target: Path) -> str:
    """记录目标树的路径、大小和修改时间；拒绝内部链接与不可读目录。"""
    digest = hashlib.sha256()
    candidates = [target]
    if target.is_dir():
        for directory, names, files in os.walk(target, followlinks=False, onerror=walk_error):
            # Windows junction 不一定受 followlinks 约束，进入下一层前必须拒绝。
            if any(workspace._link(Path(directory) / name) for name in names + files):
                raise workspace.InputError("清理目标内部存在链接，拒绝递归删除")
            candidates.extend(Path(directory) / name for name in sorted(names + files))
    for path in sorted(candidates):
        validate_target(root, path)
        stat = path.stat()
        digest.update(
            json.dumps(
                [path.relative_to(root).as_posix(), stat.st_size, stat.st_mtime_ns],
                ensure_ascii=False,
            ).encode("utf-8")
        )
    return digest.hexdigest()


def walk_error(error: OSError) -> None:
    """清理规划需要完整目录证据，不能忽略无法读取的子目录。"""
    raise workspace.InputError("清理目标无法完整读取") from error


def plan(root: Path, dependencies: bool = False) -> dict[str, object]:
    """完整规划后返回可审核目标及摘要，不执行删除。

    Args:
        root: 已解析的独立前端根目录。
        dependencies: 是否显式包含包根的 node_modules。
    Returns:
        相对目标路径及绑定当前目录状态的 planId。
    Raises:
        InputError: 目标包含链接、受版本控制文件或不能可靠规划。
    """
    items = packages(root)
    targets: list[Path] = []
    for package in items:
        for name in (*BUILD_OUTPUTS, *(("node_modules",) if dependencies else ())):
            target = package.path.parent / name
            if target.exists() or target.is_symlink():
                validate_target(root, target)
                targets.append(target)
    targets = sorted(set(targets))
    completed = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-z"], capture_output=True, timeout=30, check=False
    )
    if completed.returncode:
        raise workspace.InputError("无法核对 Git 跟踪文件，拒绝规划清理")
    tracked = [root / name.decode("utf-8") for name in completed.stdout.split(b"\0") if name]
    for target in targets:
        if any(path == target or path.is_relative_to(target) for path in tracked):
            raise workspace.InputError(f"目标包含受版本控制文件：{target.relative_to(root)}")
    snapshots = [(p.relative_to(root).as_posix(), tree_signature(root, p)) for p in targets]
    token = hashlib.sha256(
        json.dumps([str(root), snapshots], ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    return {"targets": [p for p, _ in snapshots], "planId": token, "dependencies": dependencies}


def execute(root: Path, dependencies: bool, token: str) -> dict[str, object]:
    """重新规划并匹配摘要后删除；执行失败不会报告成功，可能已部分删除。

    Args:
        root: 当前前端根目录。
        dependencies: 与预览一致的依赖清理选择。
        token: 用户核对过的当前计划摘要。
    Returns:
        已执行计划。
    Raises:
        InputError: 计划已变化或目标不安全。
        OSError: 文件占用或删除失败，之前的删除不可自动恢复。
    """
    current = plan(root, dependencies)
    if current["planId"] != token:
        raise workspace.InputError("清理计划已变化，请重新预览")
    for relative in current["targets"]:
        path = root / relative
        validate_target(root, path)
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()
    return current


def main() -> int:
    """默认输出清理预览；只有显式 --execute 匹配当前计划时允许删除。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dependencies", action="store_true")
    parser.add_argument("--execute", metavar="PLAN_ID")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    try:
        report = (
            execute(root, args.dependencies, args.execute)
            if args.execute
            else plan(root, args.dependencies)
        )
        print(json.dumps({"executed": bool(args.execute), **report}, ensure_ascii=False, indent=2))
        return 0
    except (workspace.InputError, OSError, subprocess.TimeoutExpired) as exc:
        print(f"清理未完成：{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
