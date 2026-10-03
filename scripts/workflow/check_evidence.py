"""绑定检查输入、工具和规则的本地证据，不保存源码正文或完整环境变量。

证据证明内容一致性与已记录检查状态，不提供抵抗恶意伪造报告的签名认证。
@author OpenAI Codex
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import sys
import tempfile
from pathlib import Path

from scripts.common.quality_common import CheckError, EXCLUDED_DIRS, git, run_process

SCHEMA = "quality-evidence/v1"


def digest(value: object) -> str:
    """对结构化记录生成稳定摘要，不受字典插入顺序或输出缩进影响。"""
    data = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def file_record(path: Path, root: Path) -> dict[str, object]:
    """记录文件内容摘要和变动元数据；不读取指向检查根目录之外的链接正文。

    Args:
        path: 候选输入路径，可为已删除的跟踪对象或符号链接。
        root: 允许读取内容的根目录。
    Returns:
        类型、大小、摘要和修改时间；不包含源文件文本。
    Raises:
        CheckError: 读取期间文件变化或遇到无法绑定的特殊文件。
    """
    if not path.exists() and not path.is_symlink():
        return {"kind": "missing"}
    before = path.lstat()
    if path.is_symlink():
        record: dict[str, object] = {"kind": "symlink", "target": os.readlink(path)}
        resolved = path.resolve()
        if resolved.is_relative_to(root) and resolved.is_file():
            record["content"] = file_record(resolved, root)
        else:
            record["target_exists"] = resolved.exists()
        return record
    if path.is_dir():
        return {"kind": "directory"}
    if not stat.S_ISREG(before.st_mode):
        raise CheckError("检查输入包含无法绑定内容的特殊文件")
    checksum = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            checksum.update(block)
    after = path.stat()
    if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
        raise CheckError("计算证据期间输入文件发生变化，请重新执行检查")
    return {
        "kind": "file", "size": after.st_size, "sha256": checksum.hexdigest(),
        "mtime_ns": after.st_mtime_ns, "mode": stat.S_IMODE(after.st_mode),
    }


def file_names(root: Path) -> list[str]:
    """枚举检查可见的跟踪及未跟踪文件，目录遍历与 Git 均排除构建和依赖目录。"""
    if not root.is_dir():
        raise CheckError("检查根目录不存在")
    if (root / ".git").exists():
        names = git(root, "ls-files", "--cached", "--others", "--exclude-standard", "-z")
        values = names.decode("utf-8").split("\0")
    else:
        values = []
        for directory, children, files in os.walk(root, followlinks=False):
            parent = Path(directory)
            children[:] = [name for name in children if name not in EXCLUDED_DIRS and not (parent / name).is_symlink()]
            values.extend((parent / name).relative_to(root).as_posix() for name in files)
    return sorted({name for name in values if name and not any(part in EXCLUDED_DIRS for part in Path(name).parts)})


def project_snapshot(root: Path) -> dict[str, object]:
    """绑定当前工作树清单，并对增量检查依赖的 HEAD、索引及 Git 忽略规则留证。"""
    names = file_names(root)
    manifest = {name: file_record(root / name, root) for name in names}
    metadata: dict[str, object] = {"kind": "non-git"}
    if (root / ".git").exists():
        metadata = {
            "kind": "git", "head": git(root, "rev-parse", "--revs-only", "HEAD").decode().strip(),
            "index": {}, "info_exclude": {},
            "effective_config_sha256": hashlib.sha256(git(root, "config", "--null", "--list", "--show-origin")).hexdigest(),
        }
        for label, relative in (("index", "index"), ("info_exclude", "info/exclude")):
            path = Path(git(root, "rev-parse", "--git-path", relative).decode("utf-8").strip())
            if not path.is_absolute():
                path = root / path
            metadata[label] = file_record(path, path.parent.resolve())
    return {"root": str(root), "files": manifest, "git": metadata}


def tool_snapshot(tool_root: Path) -> dict[str, object]:
    """绑定实际执行的质量工具、规则与 Node 桥接源文件，兼容检查外部测试目录。"""
    wanted = [path for path in (tool_root / "scripts").rglob("*.py") if not any(part in EXCLUDED_DIRS for part in path.relative_to(tool_root).parts)]
    frontend = tool_root / "前端代码/basic-framework-admin"
    if frontend.is_dir():
        wanted.extend(path for path in (frontend / "scripts").rglob("*") if path.is_file() and path.suffix in {".mjs", ".js", ".ts"} and not any(part in EXCLUDED_DIRS for part in path.relative_to(tool_root).parts))
        wanted.extend(frontend / name for name in ("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"))
        for name in ("typescript", "mermaid", "@vue/compiler-sfc"):
            package = frontend / "node_modules" / name / "package.json"
            if package.exists():
                wanted.append(package)
    return {
        "root": str(tool_root),
        "files": {path.relative_to(tool_root).as_posix(): file_record(path, tool_root) for path in sorted(set(wanted))},
    }


def runtime_versions(root: Path) -> dict[str, object]:
    """只收集实际解释器与已安装 Git/Node 的版本，不保存完整环境或工具自由输出。"""
    versions: dict[str, object] = {
        "python": {"path": sys.executable, "version": ".".join(map(str, sys.version_info[:3]))}
    }
    for name in ("git", "node"):
        executable = shutil.which(name)
        if executable is None:
            versions[name] = {"available": False}
            continue
        try:
            result = run_process([executable, "--version"], root, timeout=10)
            version = result.stdout.decode("utf-8", errors="strict").strip()
            prefix = "git version " if name == "git" else "v"
            if result.code or not version.startswith(prefix) or len(version) > 100 or any(char in version for char in "\r\n"):
                raise CheckError("工具版本输出不符合约定")
            versions[name] = {"available": True, "path": executable, "version": version}
        except (CheckError, UnicodeError):
            versions[name] = {"available": False, "path": executable, "reason": "version-unavailable"}
    return versions


def snapshot(root: Path, tool_root: Path) -> dict[str, object]:
    """同时绑定工作树、Git 增量依据、工具源码和运行时，支持尚未提交的内容。"""
    inputs = {
        "kind": "worktree-with-incremental-git-context",
        "project": project_snapshot(root),
        "tools": tool_snapshot(tool_root),
        "runtime": runtime_versions(root),
        "environment": environment_snapshot(),
    }
    return {"digest": digest(inputs), "inputs": inputs}


def environment_snapshot() -> dict[str, str]:
    """只绑定会改变 Git/Python/Node 解释行为的环境字段摘要，不收集完整环境。"""
    relevant = {
        "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_COUNT", "PYTHONPATH", "PYTHONHOME",
        "NODE_OPTIONS", "NODE_PATH",
    }
    return {
        key: hashlib.sha256(value.encode("utf-8")).hexdigest()
        for key, value in sorted(os.environ.items())
        if key in relevant or key.startswith(("GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_"))
    }


def validate_destination(path: Path, root: Path, tool_root: Path) -> None:
    """要求证据写到输入目录之外，避免报告自身改动输入或覆盖纳管源文件。"""
    if path.suffix.lower() != ".json":
        raise CheckError("检查证据必须使用 .json 文件")
    if path.is_relative_to(root) or path.is_relative_to(tool_root):
        raise CheckError("请把检查证据保存到被检查仓库及工具源码目录之外")


def write_report(path: Path, report: dict[str, object]) -> None:
    """仅在显式请求的路径写 UTF-8 JSON；不把子进程输出正文放入证据文件。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n", dir=path.parent, prefix=".quality-report-", suffix=".tmp", delete=False) as output:
            temporary = Path(output.name)
            output.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
