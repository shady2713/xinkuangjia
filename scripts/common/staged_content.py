"""读取 Git 暂存对象并创建文档检查视图，不复制工作区内容或执行过滤器。

视图仅还原检查需要的文本，其他文件保留路径占位以验证链接存在性。
不创建 Git 仓库，不写真实索引；调用者负责临时目录和索引副本的生命周期。
@author 李杰
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from scripts.common.quality_common import MAX_TEXT_BYTES, CheckError, run_process


@dataclass(frozen=True)
class IndexEntry:
    """保存已合并的索引条目；对象标识只用于读取，不执行文件内容。"""

    mode: str
    oid: str


@dataclass(frozen=True)
class Change:
    """保存无重命名折叠的暂存变更，零对象标识表示新增或删除。"""

    path: str
    old_oid: str
    new_oid: str
    status: str


def read_git(
    root: Path, *args: str, env: dict[str, str] | None = None, data: bytes | None = None
) -> bytes:
    """有界读取 Git 输出；可指定私有索引环境，不通过 Shell 或内容过滤器。

    Args:
        root: 真实 Git 工作区根目录。
        args: 独立 Git 参数，不含 git 命令本身。
        env: 可覆盖 GIT_INDEX_FILE；省略时继承当前进程环境。
        data: 仅作为 Git 标准输入的数据，通常为对象标识列表。
    Returns:
        原始字节输出，供 NUL 路径或 blob 协议解析。
    Raises:
        CheckError: Git 失败、输出过大、超时或无法启动。
    """
    result = run_process(
        ["git", "-C", str(root), "-c", "core.quotepath=false", *args],
        root,
        env={**(os.environ if env is None else env), "GIT_OPTIONAL_LOCKS": "0"},
        input_bytes=data,
        timeout=60,
    )
    if result.code:
        # Git 错误可能回显数据，只提供操作名，避免快照创建泄露凭据。
        raise CheckError(f"Git {args[0]} 读取失败（退出码 {result.code}）")
    return result.stdout


def checked_name(raw: bytes) -> str:
    """验证 UTF-8 仓库相对路径，拒绝越界、Git 管理目录及 Windows 特殊路径。"""
    name = raw.decode("utf-8", errors="strict")
    parts = PurePosixPath(name).parts
    if (
        not parts
        or name.startswith("/")
        or "\\" in name
        or ":" in name
        or any(part in {".", ".."} or part.lower() == ".git" for part in parts)
        or any(
            part.endswith((".", " "))
            or re.fullmatch(r"(?i)(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?", part)
            for part in parts
        )
        or any(char in name for char in "\r\n\0")
    ):
        raise CheckError("暂存路径不适合安全创建检查视图")
    return name


def read_changes(root: Path, env: dict[str, str] | None = None) -> list[Change]:
    """读取新增、修改和删除的旧新对象；重命名按删除加新增完整检查。"""
    output = read_git(
        root,
        "diff",
        "--cached",
        "--raw",
        "--no-abbrev",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        "-z",
        "--",
        env=env,
    )
    fields = output.split(b"\0")
    result = []
    for index in range(0, len(fields) - 1, 2):
        header = fields[index].decode("ascii").split()
        if len(header) != 5 or not header[0].startswith(":"):
            raise CheckError("Git 暂存差异格式无效")
        if header[4] not in {"A", "C", "M", "D", "T"}:
            raise CheckError("暂存区存在未解决冲突或不支持的变更")
        result.append(Change(checked_name(fields[index + 1]), header[2], header[3], header[4]))
    return result


def read_index(root: Path, env: dict[str, str] | None = None) -> dict[str, IndexEntry]:
    """读取完整索引清单；冲突阶段不允许被静默当作正常文件。"""
    entries = {}
    for record in read_git(root, "ls-files", "--stage", "-z", env=env).split(b"\0"):
        if not record:
            continue
        metadata, raw_path = record.split(b"\t", 1)
        mode, oid, stage = metadata.decode("ascii").split()
        if stage != "0":
            raise CheckError("暂存区存在未解决冲突")
        entries[checked_name(raw_path)] = IndexEntry(mode, oid)
    return entries


def read_blobs(root: Path, oids: list[str], env: dict[str, str] | None = None) -> dict[str, bytes]:
    """批量读取有大小上限的 blob，避免逐文件启动 Git 或解析任意表达式。

    Args:
        root: 对象所属仓库。
        oids: 完整 SHA-1 或 SHA-256 对象标识，允许重复。
        env: 可携带测试对象目录和私有索引，不修改全局环境。
    Returns:
        对象标识到原始内容的映射；单个文本上限为 16 MiB。
    Raises:
        CheckError: 标识非法、对象不存在、类型不符、协议损坏或内容过大。
    """
    identifiers = list(dict.fromkeys(oids))
    if any(re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", oid) is None for oid in identifiers):
        raise CheckError("暂存对象标识无效")
    result: dict[str, bytes] = {}
    for start in range(0, len(identifiers), 32):
        batch = identifiers[start : start + 32]
        output = read_git(
            root, "cat-file", "--batch", env=env, data=("\n".join(batch) + "\n").encode("ascii")
        )
        offset = 0
        for oid in batch:
            end = output.find(b"\n", offset)
            header = output[offset:end].split()
            if end < 0 or len(header) != 3 or header[:2] != [oid.encode(), b"blob"]:
                raise CheckError("Git blob 协议或对象类型无效")
            size = int(header[2])
            if size < 0 or size > MAX_TEXT_BYTES:
                raise CheckError("检查文本超过 16 MiB")
            offset = end + 1
            if output[offset + size : offset + size + 1] != b"\n":
                raise CheckError("Git blob 输出不完整")
            result[oid] = output[offset : offset + size]
            offset += size + 1
        if offset != len(output):
            raise CheckError("Git blob 输出存在多余内容")
    return result


def materialize(
    root: Path,
    destination: Path,
    entries: dict[str, IndexEntry],
    content_paths: set[str],
    env: dict[str, str] | None = None,
) -> None:
    """在私有目录创建暂存视图，链接按索引内目标展开，不建立系统符号链接。

    Args:
        root: Git 对象所属的真实仓库。
        destination: 调用者新建的空临时目录，只在这里写检查数据。
        entries: 完整索引路径清单；普通文件均生成路径占位。
        content_paths: 必须读取完整内容的文件，其他占位不可用于源码检查。
        env: Git 读取环境，保持与索引副本一致。
    Raises:
        CheckError: 路径冲突、越界、链接环、链接指向索引外或对象不可读取。
    """
    links = {name for name, item in entries.items() if item.mode == "120000"}
    wanted = content_paths | links
    blobs = read_blobs(root, [entries[name].oid for name in wanted if name in entries], env)

    def source(name: str, visited: frozenset[str] = frozenset()) -> bytes:
        """安全展开需要内容的索引链接；绝不跟随工作区文件系统链接。"""
        if name in visited or len(visited) > 16:
            raise CheckError("暂存链接存在环或层级过深")
        item = entries[name]
        if item.oid not in blobs:
            blobs.update(read_blobs(root, [item.oid], env))
        if item.mode != "120000":
            return blobs[item.oid]
        link = blobs[item.oid].decode("utf-8", errors="strict")
        if link.startswith(("/", "\\")) or ":" in link:
            raise CheckError("暂存链接指向仓库外")
        target = (destination / name).parent.joinpath(link).resolve()
        if not target.is_relative_to(destination):
            raise CheckError("暂存链接指向仓库外")
        relative = target.relative_to(destination).as_posix()
        if relative not in entries or entries[relative].mode == "160000":
            raise CheckError("暂存链接目标不在普通文件索引中")
        return source(relative, visited | {name})

    created: set[str] = set()
    for name, item in entries.items():
        checked_name(name.encode("utf-8"))
        target = destination / name
        identity = str(target).casefold() if os.name == "nt" else str(target)
        if identity in created:
            raise CheckError("索引路径在当前文件系统中发生大小写冲突")
        created.add(identity)
        if not target.resolve().is_relative_to(destination):
            raise CheckError("暂存路径超出检查视图")
        target.parent.mkdir(parents=True, exist_ok=True)
        if item.mode == "160000":
            target.mkdir(exist_ok=True)
        elif item.mode in {"100644", "100755", "120000"}:
            target.write_bytes(source(name) if name in content_paths else b"")
        else:
            raise CheckError("索引包含不支持的文件模式")
