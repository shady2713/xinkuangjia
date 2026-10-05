"""保存与核对本前端构建来源及产物摘要，不收集环境变量或远端地址。

通过 pnpm build:recorded 顺序执行 prepare、现有构建、finish；verify 只读核对。
记录位于 .cache/build-record，包含本地源码摘要、Git 状态和产物摘要，不是签名证明。
@author 李杰
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import verify_workspace_constraints as workspace

DIRECTORY = Path(".cache/build-record")
ARTIFACTS = Path("apps/web-ele/dist")


def git_failure_reason(root: Path, result: subprocess.CompletedProcess) -> str:
    """解释只读 Git 查询失败的原因，优先识别"没有 Git 工作树"。

    只在 Git 已经失败后调用，因此额外探针不会影响正常路径；源码压缩包没有 `.git`，
    这里必须直接说明该前提，不能让使用者只看到笼统的"构建记录未完成"。

    Args:
        root: 当前独立前端根目录。
        result: 已经失败的那次只读 Git 命令结果。
    Returns:
        可打印的失败原因；缺少 `.git` 时明确指出压缩包无法产出交付记录。
    """
    probe = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "--is-inside-work-tree"],
        capture_output=True,
        timeout=30,
        check=False,
    )
    if probe.returncode or probe.stdout.strip() != b"true":
        return (
            "缺少 Git 工作树（没有 .git 目录）：构建记录要求真实提交、工作区状态与文件清单，"
            "源码压缩包或已删除 .git 的目录无法产出交付记录；"
            "请在完整 Git 检出中执行 pnpm build:recorded"
        )
    detail = result.stderr.decode("utf-8", errors="replace").strip().splitlines()
    return f"无法读取 Git 构建来源：{detail[0]}" if detail else "无法读取 Git 构建来源"


def git(root: Path, *arguments: str) -> bytes:
    """执行固定参数的只读 Git 查询；失败或超时不伪造来源信息。"""
    result = subprocess.run(
        ["git", "-C", str(root), *arguments],
        capture_output=True,
        timeout=30,
        check=False,
    )
    if result.returncode:
        raise workspace.InputError(git_failure_reason(root, result))
    return result.stdout


def digest_files(root: Path, paths: list[Path]) -> dict[str, object]:
    """按相对路径及文件内容计算稳定摘要，拒绝链接、越界及非普通文件。"""
    total = hashlib.sha256()
    for path in sorted(set(paths), key=lambda item: item.relative_to(root).as_posix()):
        if not path.resolve().is_relative_to(root):
            raise workspace.InputError("摘要文件越界")
        for ancestor in (path, *path.parents):
            if ancestor == root:
                break
            if workspace._link(ancestor):
                raise workspace.InputError("摘要输入不允许链接")
        if not path.is_file():
            raise workspace.InputError("摘要输入不是普通文件")
        content = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                content.update(chunk)
        relative = path.relative_to(root).as_posix().encode("utf-8")
        total.update(len(relative).to_bytes(8, "big"))
        total.update(relative)
        total.update(content.digest())
    return {"files": len(set(paths)), "sha256": total.hexdigest()}


def source(root: Path) -> dict[str, object]:
    """记录当前前端的 Git 来源、版本、锁文件与源码摘要，不读取环境变量值。"""
    commit = git(root, "rev-parse", "HEAD").decode("ascii").strip()
    if not re.fullmatch(r"[0-9a-f]{40,64}", commit):
        raise workspace.InputError("Git 提交标识无效")
    names = git(
        root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"
    ).split(b"\0")
    paths = []
    for name in names:
        if not name:
            continue
        path = root / name.decode("utf-8")
        # 构建记录与被忽略的产物不是源码；被删文件由状态和剩余文件摘要共同反映。
        relative = path.relative_to(root)
        if any(
            part in workspace.EXCLUDED or part in {"coverage", ".vite", "dist.zip"}
            for part in relative.parts
        ):
            continue
        if path.exists():
            paths.append(path)
    manifest = json.loads(workspace._read(root / "apps/web-ele/package.json", root))
    version = manifest.get("version")
    if not isinstance(version, str) or not version:
        raise workspace.InputError("应用版本缺失")
    return {
        "commit": commit,
        "dirty": bool(git(root, "status", "--porcelain", "--", ".")),
        "version": version,
        "source": digest_files(root, paths),
        "lock": digest_files(root, [root / "pnpm-lock.yaml"]),
    }


def artifacts(root: Path) -> dict[str, object]:
    """摘要必须覆盖非空真实产物目录；不可读目录或任何链接使验证失败。"""
    directory = root / ARTIFACTS
    if not directory.is_dir() or workspace._link(directory):
        raise workspace.InputError("缺少真实构建产物目录")
    paths: list[Path] = []
    for current, names, files in os.walk(
        directory, followlinks=False, onerror=walk_error
    ):
        if any(workspace._link(Path(current) / name) for name in names):
            raise workspace.InputError("产物目录不允许链接")
        paths.extend(Path(current) / name for name in files)
    if not paths:
        raise workspace.InputError("构建产物为空")
    return digest_files(root, paths)


def walk_error(error: OSError) -> None:
    """产物目录不可完整读取时拒绝形成摘要。"""
    raise workspace.InputError("无法完整读取产物") from error


def record_path(root: Path, name: str) -> Path:
    """只允许固定记录名及真实缓存目录，拒绝目录链接和越界路径。"""
    if name not in ("context.json", "record.json"):
        raise workspace.InputError("构建记录名称无效")
    path = root / DIRECTORY / name
    for candidate in (path, *path.parents):
        if candidate == root:
            break
        if (candidate.exists() or candidate.is_symlink()) and workspace._link(
            candidate
        ):
            raise workspace.InputError("构建记录路径不允许链接")
    return path


def save(root: Path, name: str, value: dict[str, object]) -> None:
    """原子写入固定缓存记录；失败时清理本次临时文件，不留下半份 JSON。"""
    path = record_path(root, name)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="\n", dir=path.parent, delete=False
        ) as stream:
            temporary = stream.name
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        if temporary and Path(temporary).exists():
            Path(temporary).unlink()


def load(root: Path, name: str) -> dict[str, object]:
    """读取固定记录，格式错误必须中止而不是回退到当前源码重新认领产物。"""
    return workspace._mapping(
        json.loads(workspace._read(record_path(root, name), root)), "构建记录"
    )


def run(root: Path, action: str) -> dict[str, object]:
    """执行 prepare、finish 或 verify，绑定构建前后源码与产物证据。

    Args:
        root: 当前独立前端根目录。
        action: prepare 写构建上下文；finish 写完成记录；verify 只读核对。
    Returns:
        上下文或已验证的完成记录。
    Raises:
        InputError: 源码变化、产物缺失、上下文不匹配或记录格式错误。
    """
    current = source(root)
    if action == "prepare":
        context = {
            "format": 1,
            "mode": "production",
            "startedAt": datetime.now(timezone.utc).isoformat(),
            "source": current,
        }
        save(root, "context.json", context)
        return context
    context = load(root, "context.json")
    if (
        set(context) != {"format", "mode", "startedAt", "source"}
        or context["format"] != 1
    ):
        raise workspace.InputError("构建上下文格式无效")
    if context["source"] != current or context["mode"] != "production":
        raise workspace.InputError("构建来源已变化，请重新运行 build:recorded")
    digest = artifacts(root)
    if action == "finish":
        record = {
            "context": context,
            "artifacts": digest,
            "finishedAt": datetime.now(timezone.utc).isoformat(),
        }
        save(root, "record.json", record)
        return record
    record = load(root, "record.json")
    if (
        set(record) != {"context", "artifacts", "finishedAt"}
        or record["context"] != context
        or record["artifacts"] != digest
    ):
        raise workspace.InputError("构建记录与当前上下文或产物不一致")
    return record


def main() -> int:
    """分阶段处理构建记录，环境或验证失败返回 2；不会自行调用构建或安装。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "finish", "verify"))
    args = parser.parse_args()
    try:
        report = run(Path(__file__).resolve().parents[2], args.action)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except (workspace.InputError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        print(f"构建记录未完成：{error}", file=sys.stderr)
        print(
            "来源、记录或产物校验失败，请重新检查构建流程。",
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
