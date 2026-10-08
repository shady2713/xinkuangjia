#!/usr/bin/env python3
"""按工作区真实内容计算可复现的源码身份，供性能预算把读数绑定到被校准的那份代码。

构件的字节摘要（Maven 重建出来的 JAR SHA-256）不可复现：同一提交在不同机器或不同时刻
重建就得到不同字节，用它绑定被测版本会让 `build-mismatch` 在任何一次干净检出的 CI 上必现
（实测同一提交在云端运行器与本机分别得到 `c0a94da8…` 与 `71371e1b…`），而且它无法表达
校准时工作区里的未提交改动。本模块改用「Git 修订 + 源码内容摘要」：

* 同一份内容在任何干净检出上得到同一个摘要——摘要只由文件内容决定，与遍历顺序、
  文件时间戳、构建工具与机器无关；
* 改动任意一个字节都会改变摘要——包含未提交改动，因此「测的是不是被校准的那份代码」
  仍然是可判定的真问题，不会退化成常量。

摘要的输入是被测构建的源码范围 `SOURCE_ROOTS`，排除构建产物与日志目录；清单按路径字节序
排序后逐项计入「相对路径 + 字节长度 + 文件内容 SHA-256」，因此换机器、换检出方式都不改变
结果。本模块只读工作区，不写文件、不联网、不发请求。

命令（仓库根）：

    python -B -X utf8 scripts/perf/source_identity.py --root . --json

退出码：0 表示身份可计算；2 表示 Git 检出不可用或源码范围缺失。

@author 性能证据绑定方向执行代理
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Sequence

if __package__ in (None, ""):  # 直接以脚本路径运行时补上仓库根，便于复用同包常量。
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# 绑定方法与源码范围标识会写进预算文件、报告与发布证据，三处必须完全一致，因此只在这里定义。
METHOD = "git-source-id/v1"
SCOPE = "backend-build-inputs/v1"
# 后端构建的全部输入都在这一棵树下；前端与数据库快照不进入后端 JAR，故不在范围内。
SOURCE_ROOTS = ("后端代码/basic-framework-boot",)
# 构建产物、运行日志与工具缓存不参与打包，内容随每次构建变化，必须排除，否则摘要在
# 干净检出之间不可复现。
EXCLUDED_DIRECTORIES = frozenset({"target", "logs", ".git", ".idea", ".vscode",
                                  "node_modules", "__pycache__"})
EXCLUDED_SUFFIXES = frozenset({".class", ".jar", ".log", ".pyc", ".tmp", ".swp"})
EXCLUDED_NAMES = frozenset({".DS_Store", "Thumbs.db"})
REVISION_PATTERN = re.compile(r"[0-9a-f]{40}")


class IdentityFailure(RuntimeError):
    """源码身份无法计算；调用方必须把它当证据缺失处理，而不是当作默认通过。"""


def log(message: str) -> None:
    """输出可核对的单行进度，内容不含凭据与完整环境。"""

    print(f"[源码身份] {message}", flush=True)


def _git(root: Path, *arguments: str) -> str:
    """在给定根目录执行只读 Git 命令并返回去掉首尾空白的标准输出。

    Args:
        root: 仓库根目录。
        arguments: 传给 Git 的只读子命令参数。
    Returns:
        标准输出的去空白文本。
    Raises:
        IdentityFailure: Git 不可用或命令失败；不打印子进程输出以外的任何内容。
    """

    command = ["git", "-C", str(root), *arguments]
    try:
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8",
                                errors="replace", timeout=120, check=False)
    except (OSError, subprocess.SubprocessError) as error:
        raise IdentityFailure(f"Git 不可用：{type(error).__name__}") from error
    if result.returncode != 0:
        raise IdentityFailure(f"Git 命令失败：{' '.join(arguments)}（退出码 {result.returncode}）")
    return result.stdout.strip()


def git_revision(root: Path) -> str:
    """读取当前 HEAD 的完整提交标识，作为可追溯的版本线索。

    Args:
        root: 仓库根目录。
    Returns:
        40 位十六进制提交标识。
    Raises:
        IdentityFailure: 不是 Git 检出，或 `git rev-parse HEAD` 的输出不是提交标识。
    """

    revision = _git(root, "rev-parse", "HEAD")
    if not REVISION_PATTERN.fullmatch(revision):
        raise IdentityFailure("当前目录的 HEAD 不是完整提交标识")
    return revision


def worktree_state(root: Path) -> str:
    """判断源码范围内是否存在未提交改动；只作记录，不参与绑定相等性判定。

    源码摘要本身已经覆盖未提交改动，本字段只用于让人能读出「这次测的是干净检出还是
    带改动的工作区」，因此返回 ``clean`` / ``dirty`` 即可。

    Args:
        root: 仓库根目录。
    Returns:
        ``dirty`` 或 ``clean``。
    Raises:
        IdentityFailure: Git 不可用。
    """

    return "dirty" if _git(root, "status", "--porcelain", "--", *SOURCE_ROOTS) else "clean"


def _excluded(relative: Path) -> bool:
    """判断一个仓库相对路径是否属于构建产物、日志或工具缓存。

    Args:
        relative: 仓库相对路径。
    Returns:
        命中排除清单时返回 ``True``。
    """

    if EXCLUDED_DIRECTORIES.intersection(relative.parts):
        return True
    return relative.name in EXCLUDED_NAMES or relative.suffix in EXCLUDED_SUFFIXES


def source_files(root: Path) -> list[Path]:
    """枚举参与源码摘要的文件，按路径字节序排序。

    排序键取路径的 UTF-8 字节而不是平台字符串顺序，保证同一份内容在任何机器、任何
    文件系统上得到同一份清单与同一个摘要。

    Args:
        root: 仓库根目录。
    Returns:
        仓库相对路径列表，同一文件只出现一次。
    Raises:
        IdentityFailure: 声明的源码范围目录不存在，说明这不是预期布局的检出。
    """

    collected: set[Path] = set()
    for name in SOURCE_ROOTS:
        directory = root / name
        if not directory.is_dir():
            raise IdentityFailure(f"源码范围不存在：{name}")
        for candidate in directory.rglob("*"):
            if not candidate.is_file() or candidate.is_symlink():
                continue
            relative = candidate.relative_to(root)
            if not _excluded(relative):
                collected.add(relative)
    return sorted(collected, key=lambda item: item.as_posix().encode("utf-8"))


def source_digest(root: Path) -> tuple[str, int]:
    """计算源码内容摘要与其文件数。

    摘要只取决于纳入范围的文件内容：逐个文件把「相对路径、字节长度、内容 SHA-256」写进
    同一个 SHA-256，因此改名、改权限之外的内容增删改都会改变摘要，而重新打包、重新检出
    或文件时间戳变化都不会。

    Args:
        root: 仓库根目录。
    Returns:
        十六进制摘要与纳入摘要的文件数。
    Raises:
        IdentityFailure: 源码范围不存在或某个文件在读取期间消失。
    """

    digest = hashlib.sha256()
    relatives = source_files(root)
    for relative in relatives:
        try:
            data = (root / relative).read_bytes()
        except OSError as error:
            raise IdentityFailure(f"源码文件不可读：{relative}（{error.strerror or error}）") from error
        digest.update(relative.as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(len(data)).encode("ascii"))
        digest.update(b"\0")
        digest.update(hashlib.sha256(data).hexdigest().encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest(), len(relatives)


def newest_source_mtime(root: Path) -> float:
    """返回源码范围内最新的修改时间，用于提示被测构件可能早于源码。

    该结果只用于日志提示：构件是否由这份源码构建出来无法从 JAR 字节反推，判断权留给
    有权者与编排流程，检查器不据此改写结论。

    Args:
        root: 仓库根目录。
    Returns:
        纳入摘要的文件中最新的修改时间；范围内没有文件时返回 0.0。
    Raises:
        IdentityFailure: 源码范围不存在。
    """

    relatives = source_files(root)
    return max(((root / relative).stat().st_mtime for relative in relatives), default=0.0)


def identity(root: Path) -> dict[str, object]:
    """计算一次完整的源码身份，供报告与预算对齐使用。

    Args:
        root: 仓库根目录。
    Returns:
        含绑定方法、范围、提交标识、内容摘要、文件数与工作区状态的记录。
    Raises:
        IdentityFailure: Git 检出不可用或源码范围缺失；调用方必须据此拒绝出具证据。
    """

    digest, count = source_digest(root)
    return {
        "method": METHOD,
        "scope": SCOPE,
        "git_revision": git_revision(root),
        "source_sha256": digest,
        "source_files": count,
        "source_worktree": worktree_state(root),
    }


def main(argv: Sequence[str] | None = None) -> int:
    """打印源码身份；退出 0 表示可计算，2 表示证据不可得。

    Args:
        argv: 命令行参数；省略时读取真实进程参数。
    Returns:
        0 表示已算出身份；2 表示 Git 检出不可用或源码范围缺失。
    """

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".", help="仓库根目录")
    parser.add_argument("--json", action="store_true", help="输出结构化结果")
    arguments = parser.parse_args(argv)
    try:
        document = identity(Path(arguments.root).resolve())
    except IdentityFailure as error:
        print(f"源码身份无法计算：{error}", file=sys.stderr)
        return 2
    if arguments.json:
        print(json.dumps(document, ensure_ascii=False))
    else:
        log(f"绑定方法 {document['method']}、范围 {document['scope']}")
        log(f"提交 {document['git_revision']}、工作区 {document['source_worktree']}")
        log(f"源码摘要 {document['source_sha256']}（{document['source_files']} 个文件）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())