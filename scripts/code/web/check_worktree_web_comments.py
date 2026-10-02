"""检查工作区相对 HEAD 改动涉及的 Web 声明与注释。

用法：python scripts/code/web/check_worktree_web_comments.py [路径] [--all | --staged]
默认涵盖已暂存、未暂存及未跟踪文件的当前内容；--all 审计全量。
--staged 仅读取本次暂存对象，即使工作区文件已被修改或删除也不影响结果。
不会把工作区内容加入 Git 索引，未提交仓库按所有现存文件为新增处理。
@author 李杰
"""

from __future__ import annotations

import difflib
import sys
from pathlib import Path

# 直接按文件路径运行时定位工具所属仓库，不依赖调用者的当前目录。
if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scripts.common.node_bridge import invoke
from scripts.common.quality_common import (
    CheckError,
    Finding,
    discover,
    entry,
    excluded,
    git,
    parser,
    read_text,
    report,
)
from scripts.common.staged_content import checked_name, read_blobs, read_changes, read_index

EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue"}


def changed_lines(before: str, after: str) -> list[int]:
    """返回当前内容受影响的一基行号，纯删除映射到邻接行以捕获删注释。"""
    result: set[int] = set()
    lines = after.splitlines()
    for tag, _, _, start, end in difflib.SequenceMatcher(
        a=before.splitlines(),
        b=lines,
        autojunk=False,
    ).get_opcodes():
        if tag != "equal":
            result.update(range(start + 1, end + 1))
            if start == end and lines:
                result.add(min(start + 1, len(lines)))
    return sorted(result)


def baseline_scope(before: bytes, after: str) -> tuple[list[int] | None, bool]:
    """历史正文无法严格解码时全量检查当前声明，不推测编码或跳过文件。

    Args:
        before: Git 旧对象的原始字节。
        after: 已严格 UTF-8 解码的当前正文。
    Returns:
        增量行和全量标记；无效旧编码返回全量范围。
    """
    try:
        text = before.decode("utf-8-sig", errors="strict")
    except UnicodeDecodeError:
        # 没有可信的旧正文就不能缩小到增量；当前文件仍由同一 AST 门禁完整检查。
        return None, True
    return changed_lines(text, after), False


def collect(root: Path, paths: list[str], *, full: bool = False) -> tuple[int, list[Finding]]:
    """读取当前源码和 HEAD 文本，选中受改动影响的声明后交给 AST 检查。

    Args:
        root: Git 工作区根目录或全量审计目录。
        paths: 可选的 Web 文件或目录。
        full: 为真时不比较 Git，检查所选文件全部声明。
    Returns:
        检查文件数和注释、语法问题；不读取 Git 外部 diff。
    Raises:
        CheckError: 增量模式不在 Git 根目录，或无法读取 Git 对象。
    """
    files = [path for path in discover(root, EXTENSIONS, paths) if not path.name.endswith(".d.ts")]
    tracked: set[str] = set()
    changed: set[str] = set()
    if not full:
        if not (root / ".git").exists():
            raise CheckError("增量检查需要 Git 根目录；非 Git 目录请使用 --all")
        # 用对象名列表区分无 HEAD 的新仓库，不把任意 Git 错误当作新仓库。
        has_head = bool(git(root, "rev-parse", "--revs-only", "HEAD").strip())
        if has_head:
            tracked = set(
                git(root, "ls-tree", "-r", "--name-only", "-z", "HEAD").decode("utf-8").split("\0")
            )
            changed = set(
                git(
                    root,
                    "diff",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--no-renames",
                    "--name-only",
                    "-z",
                    "HEAD",
                    "--",
                )
                .decode("utf-8")
                .split("\0")
            )
        changed.update(
            git(root, "ls-files", "--others", "--exclude-standard", "-z")
            .decode("utf-8")
            .split("\0")
        )
        if not has_head:
            changed.update(path.relative_to(root).as_posix() for path in files)
    payload = []
    for path in files:
        relative = path.relative_to(root).as_posix()
        if not full and relative not in changed:
            continue
        source = read_text(path)
        lines, whole_file = (
            baseline_scope(git(root, "show", f"HEAD:{relative}"), source)
            if not full and relative in tracked else (None, True)
        )
        payload.append(
            {
                "path": relative,
                "source": source,
                "lines": lines,
                "new": whole_file,
            }
        )
    return check_payload(payload)


def collect_staged(root: Path, paths: list[str]) -> tuple[int, list[Finding]]:
    """从暂存 blob 与其旧对象构建增量输入，支持首个提交、删除和重命名。

    Args:
        root: 真实 Git 仓库根目录；继承调用方的 GIT_INDEX_FILE。
        paths: 可选仓库相对文件或目录，不依赖工作区文件是否存在。
    Returns:
        实际检查的 Web 文件数及语法、注释诊断；纯删除文件不解析。
    Raises:
        CheckError: 暂存对象读取失败、路径不安全或选中文件不是普通文件。
    """
    selected = [checked_name(path.rstrip("/").encode("utf-8")) for path in paths]
    changes = [
        change
        for change in read_changes(root)
        if change.status != "D"
        and Path(change.path).suffix.lower() in EXTENSIONS
        and not change.path.endswith(".d.ts")
        and not excluded(Path(change.path))
        and (
            not selected
            or any(change.path == path or change.path.startswith(path + "/") for path in selected)
        )
    ]
    if not changes:
        return 0, []
    index = read_index(root)
    if any(index[change.path].mode not in {"100644", "100755"} for change in changes):
        raise CheckError("暂存 Web 检查只支持普通源码文件")
    identifiers = [
        oid for change in changes for oid in (change.old_oid, change.new_oid) if set(oid) != {"0"}
    ]
    blobs = read_blobs(root, identifiers)
    payload = []
    for change in changes:
        is_new = set(change.old_oid) == {"0"}
        source = blobs[change.new_oid].decode("utf-8-sig", errors="strict")
        lines, whole_file = (
            (None, True) if is_new else baseline_scope(blobs[change.old_oid], source)
        )
        payload.append(
            {
                "path": change.path,
                "source": source,
                "lines": lines,
                "new": whole_file,
            }
        )
    return check_payload(payload)


def check_payload(payload: list[dict[str, object]]) -> tuple[int, list[Finding]]:
    """将已确定版本的源码按所属前端分批交给真实解析器，零文件不启动 Node。"""
    if not payload:
        return 0, []
    findings: list[Finding] = []
    # 当前管理前端与仓库其他 Web 工具分组，均使用已安装的框架解析器。
    groups: dict[str, list[dict[str, object]]] = {}
    for item in payload:
        owner = next(
            (
                name
                for name in ("basic-framework-admin",)
                if str(item["path"]).startswith(f"前端代码/{name}/")
            ),
            "其他",
        )
        groups.setdefault(owner, []).append(item)
    # 分批启动解析器，避免一个大型仓库占满桥接请求和诊断内存。
    for group in groups.values():
        for start in range(0, len(group), 50):
            response = invoke("web", {"files": group[start : start + 50]})
            findings.extend(Finding(**value) for value in response["findings"])
    return len(payload), findings


def main() -> int:
    """选择增量或全量模式，按统一诊断协议返回结果。"""
    arguments = parser(__doc__)
    mode = arguments.add_mutually_exclusive_group()
    mode.add_argument("--all", action="store_true", help="全量检查，不依赖 Git 差异")
    mode.add_argument("--staged", action="store_true", help="仅读取 Git 暂存版本")
    args = arguments.parse_args()
    count, findings = (
        collect_staged(args.root.resolve(), args.paths)
        if args.staged
        else collect(args.root.resolve(), args.paths, full=args.all)
    )
    return report("Web 注释", count, findings, as_json=args.json)


if __name__ == "__main__":
    raise SystemExit(entry(main))
