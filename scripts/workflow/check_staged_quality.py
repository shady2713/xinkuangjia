"""按暂存范围执行提交前检查，汇总失败且不改写真实索引或工作区。

用法：python -B scripts/workflow/check_staged_quality.py [--list]
复制当前索引用于一致性读取；文档使用临时视图，源码不执行。
工具使用当前安装环境，不自动安装依赖、格式化、暂存、提交或推送。
@author 李杰
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import os
import sys
import tempfile
from dataclasses import replace
from fnmatch import fnmatchcase
from pathlib import Path
from urllib.parse import unquote

if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.common.quality_common import (
    DEFAULT_ROOT,
    CheckError,
    Finding,
    entry,
    excluded,
    report,
    run_process,
)
from scripts.common.staged_content import (
    Change,
    IndexEntry,
    materialize,
    read_blobs,
    read_changes,
    read_git,
    read_index,
)

RULE_FILE = "scripts/tools/document_rules.py"
SOURCE_SUFFIXES = {".java", ".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue"}
WEB_SUFFIXES = SOURCE_SUFFIXES - {".java", ".py"}
DOC_MODULES = {
    "md-links": "docs.verify_md_links",
    "doc-refs": "docs.verify_doc_refs",
    "doc-structure": "docs.verify_doc_structure",
    "doc-policy": "docs.verify_doc_policy",
    "package-readmes": "docs.verify_package_readmes",
    "skills": "skills.verify_skill_metadata",
    "note-classification": "docs.verify_agent_note_classification",
    "note-format": "docs.verify_agent_note_format",
    "mermaid": "docs.verify_mermaid",
}


def core_jobs(changes: list[Change]) -> list[tuple[str, str, list[str]]]:
    """根据暂存后仍存在的源码选择核心检查，密钥检查始终覆盖本次提交。"""
    paths = [item.path for item in changes if item.status != "D" and not excluded(Path(item.path))]
    jobs = [("secrets", "security/scan_staged_secrets.py", [])]
    if any(path.startswith("后端/java服务/") and path.endswith(".java") for path in paths):
        jobs.append(("java-comments", "code/java/check_staged_java_comments.py", []))
    if any(path.endswith(".py") for path in paths):
        jobs.append(("python-comments", "code/python/check_staged_python_comments.py", []))
    if any(Path(path).suffix in WEB_SUFFIXES and not path.endswith(".d.ts") for path in paths):
        jobs.append(("web-comments", "code/web/check_worktree_web_comments.py", ["--staged"]))
    return jobs


def needs_documents(changes: list[Change]) -> bool:
    """判断文档内容、元数据或链接目标是否可能受到本次暂存变更影响。"""
    return any(
        not excluded(Path(item.path))
        and (
            Path(item.path).suffix in SOURCE_SUFFIXES | {".md"}
            or item.status == "D"
            or item.path.endswith("/agents/openai.yaml")
            or Path(item.path).name in {"package.json", "pom.xml", "pyproject.toml"}
        )
        for item in changes
    )


def document_scopes(
    view: Path,
    changes: list[Change],
    entries: dict[str, IndexEntry],
    structure_patterns: set[str] | None = None,
) -> tuple[dict[str, list[str]], dict[str, dict[str, set[int]]]]:
    """计算变更文档、配对元数据与受影响入站引用，不检查无关历史页面。

    Args:
        view: 已由暂存对象构建的文档视图。
        changes: 完整暂存差异，删除目标也用于查找入站引用。
        entries: 暂存后仍存在的索引路径。
        structure_patterns: 仅结构排除发生变化时的受影响模式；None 保守扩大所有检查。
    Returns:
        每类检查的范围，以及未修改引用方只允许报告的受影响行号。
    """
    from scripts.docs.markdown_support import parse
    from scripts.docs.verify_doc_refs import DOC_REFERENCE, _source_docs_root

    available = {name for name in entries if not excluded(Path(name))}
    touched = {change.path for change in changes}
    changed = available & touched
    markdown = {name for name in available if name.endswith(".md")}
    sources = {name for name in available if Path(name).suffix in SOURCE_SUFFIXES}
    full = RULE_FILE in touched and structure_patterns is None
    selected_md = markdown if full else markdown & changed
    selected_refs = sources | markdown if full else (sources | markdown) & changed
    # 清单改变会影响相邻 README 的分类，不能只检查内容变过的 README。
    manifests = {
        Path(name).parent
        for name in touched
        if Path(name).name in {"package.json", "pom.xml", "pyproject.toml"}
    }
    selected_md |= {
        name
        for name in markdown
        if Path(name).parent in manifests and Path(name).name.lower().startswith("readme")
    }
    incoming: dict[str, dict[str, set[int]]] = {"md-links": {}, "doc-refs": {}}
    impacts = {item.path for item in changes if item.status == "D" or item.path.endswith(".md")}
    removed_docs = {
        item.path for item in changes if item.status == "D" and item.path.endswith(".md")
    }
    if impacts:
        for name in sorted(markdown - selected_md):
            for link in parse((view / name).read_text(encoding="utf-8-sig")).destinations:
                raw = link.url.split("#", 1)[0].split("?", 1)[0]
                if not raw or ":" in raw or raw.startswith("/"):
                    continue
                target = ((view / name).parent / unquote(raw)).resolve()
                if target.is_relative_to(view):
                    relative = target.relative_to(view).as_posix()
                    if relative in impacts or any(
                        path.startswith(relative + "/") for path in impacts
                    ):
                        incoming["md-links"].setdefault(name, set()).add(link.line)
    if removed_docs:
        for name in sorted(sources - selected_refs):
            docs_root = _source_docs_root(view, view / name)
            for number, line in enumerate(
                (view / name).read_text(encoding="utf-8-sig").splitlines(), 1
            ):
                for match in DOC_REFERENCE.finditer(line):
                    reference = unquote(match[0])
                    base = docs_root if reference.startswith("docs/") else view
                    target = (base / reference).resolve()
                    # 删除工作区文档也要补查未修改源码，范围与引用检查器一致。
                    if (
                        target.is_relative_to(base)
                        and target.relative_to(view).as_posix() in removed_docs
                    ):
                        incoming["doc-refs"].setdefault(name, set()).add(number)
    skill_folders = {
        "/".join(name.split("/")[:3])
        for name in touched
        if name.startswith(".agents/skills/")
        and (name.endswith("/SKILL.md") or name.endswith("/agents/openai.yaml"))
    }
    skill_paths = sorted(
        name
        for name in available
        if any(
            name in {folder + "/SKILL.md", folder + "/agents/openai.yaml"}
            for folder in skill_folders
        )
    )
    notes = sorted(name for name in selected_md if name.startswith(".agents/notes/"))
    scopes = {
        "md-links": sorted(selected_md | incoming["md-links"].keys()),
        "doc-refs": sorted(selected_refs | incoming["doc-refs"].keys()),
        "doc-structure": sorted(selected_md),
        "doc-policy": sorted(selected_md),
        "package-readmes": sorted(selected_md),
        "skills": skill_paths,
        "note-classification": notes,
        "note-format": notes,
        "mermaid": sorted(selected_md),
    }
    if structure_patterns:
        affected = {
            name
            for name in markdown
            if any(fnmatchcase(name, pattern) for pattern in structure_patterns)
        }
        scopes["doc-structure"] = sorted(set(scopes["doc-structure"]) | affected)
        scopes["package-readmes"] = sorted(set(scopes["package-readmes"]) | affected)
    return scopes, incoming


def changed_structure_patterns(
    root: Path, folder: Path, changes: list[Change], env: dict[str, str]
) -> set[str] | None:
    """比较提交前后的规则，只为结构排除变化扩大受影响页面范围。

    Args:
        root: 被检查的仓库根目录。
        folder: 临时规则版本目录，不在工作区内。
        changes: 暂存差异，提供旧规则与新规则的对象编号。
        env: 隔离索引与对象读取环境。
    Returns:
        新增、移除或改变理由的结构模式；其他规则变化、首次新增时返回 None。
    Raises:
        CheckError: 无法读取对象或新规则无效；不退回工作区配置。
    """
    from scripts.docs.document_support import load_rules

    change = next((item for item in changes if item.path == RULE_FILE), None)
    if change is None:
        return set()
    if change.status != "M":
        return None
    blobs = read_blobs(root, [change.old_oid, change.new_oid], env)
    for version, oid in (("old", change.old_oid), ("new", change.new_oid)):
        path = folder / version / RULE_FILE
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(blobs[oid])
    new = load_rules(folder / "new")
    try:
        old = load_rules(folder / "old")
    except CheckError:
        return None  # 旧规则非法时没有可靠的缩小范围依据。
    if replace(old, structure_exclusions={}) != replace(new, structure_exclusions={}):
        return None
    return {
        pattern
        for pattern in old.structure_exclusions.keys() | new.structure_exclusions.keys()
        if old.structure_exclusions.get(pattern) != new.structure_exclusions.get(pattern)
    }


def check_documents(
    root: Path, folder: Path, changes: list[Change], env: dict[str, str]
) -> list[int]:
    """创建暂存文档视图并运行独立检查；单项失败不遮蔽其他检查结果。

    文档规则改变时扩大到相应内容；删除文档时补查源码引用。非文本文件只
    保留路径占位，不执行 smudge/filter 或被检查的配置、示例和源码。
    """
    entries = read_index(root, env)
    structure_patterns = changed_structure_patterns(
        root, folder.parent / "rule-versions", changes, env
    )
    touched = {item.path for item in changes}
    all_sources = (RULE_FILE in touched and structure_patterns is None) or any(
        item.status == "D" and item.path.endswith(".md") for item in changes
    )
    content = {
        name
        for name in entries
        if name.endswith(".md")
        or name.endswith("/agents/openai.yaml")
        or name == RULE_FILE
        or (
            not excluded(Path(name))
            and Path(name).suffix in SOURCE_SUFFIXES
            and (all_sources or name in touched)
        )
    }
    if RULE_FILE not in entries:
        raise CheckError("文档检查需要已暂存的 scripts/tools/document_rules.py")
    materialize(root, folder, entries, content, env)
    scopes, incoming = document_scopes(folder, changes, entries, structure_patterns)
    codes: list[int] = []
    classification = 0
    for name, module in DOC_MODULES.items():
        paths = scopes[name]
        if not paths:
            continue  # 空列表在现有工具中表示全仓扫描，必须在调用前排除。
        if name == "note-format" and classification:
            print("note-format: skipped（笔记分类未通过）")
            codes.append(classification)
            continue
        try:
            checker = importlib.import_module("scripts." + module)
            if name == "note-classification":
                notes, findings = checker.collect_notes(folder, paths)
                count = len(notes) + len(findings)
            else:
                count, findings = checker.collect(folder, paths)
            filtered: list[Finding] = [
                finding
                for finding in findings
                if finding.path not in incoming.get(name, {})
                or finding.line in incoming[name][finding.path]
            ]
            code = report(name, count, filtered, as_json=False)
        except (CheckError, ImportError, OSError, UnicodeError, ValueError) as error:
            reason = (
                str(error) if isinstance(error, (CheckError, ImportError)) else type(error).__name__
            )
            print(f"{name}: error（{reason}，无法完成检查）", file=sys.stderr)
            code = 2
        if name == "note-classification":
            classification = code
        codes.append(code)
    return codes


def run_checks(root: Path, folder: Path, env: dict[str, str], changes: list[Change]) -> int:
    """执行已选核心与文档检查，环境错误优先于规则失败，不把跳过算成功。"""
    codes = []
    for name, script, arguments in core_jobs(changes):
        try:
            command = [sys.executable, "-X", "utf8", "-B", str(DEFAULT_ROOT / "scripts" / script)]
            if name == "web-comments":
                command.extend(["--root", str(root)])
            result = run_process(command + arguments, root, env=env, timeout=180)
            print(f"[{name}]", flush=True)
            print(result.stdout.decode("utf-8", errors="replace"), end="", flush=True)
            print(
                result.stderr.decode("utf-8", errors="replace"), end="", file=sys.stderr, flush=True
            )
            codes.append(result.code if result.code in {0, 1} else 2)
        except CheckError as error:
            print(f"{name}: error（{error}）", file=sys.stderr)
            codes.append(2)
    if needs_documents(changes):
        view = folder / "documents"
        view.mkdir()
        try:
            codes.extend(check_documents(root, view, changes, env))
        except (CheckError, ImportError, OSError, UnicodeError, ValueError) as error:
            print(f"暂存文档视图检查失败：{error}", file=sys.stderr)
            codes.append(2)
    code = 2 if 2 in codes else 1 if 1 in codes else 0
    print(f"提交前检查完成：{len(codes)} 项执行结果，退出码 {code}。")
    return code


def main() -> int:
    """复制索引后执行检查，并检测检查期间真实索引或 HEAD 是否被外部改变。

    Returns:
        无阻断项返回 0，规则失败返回 1，环境或并发变更返回 2。
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--list", action="store_true", help="只显示本次可能触发的检查")
    args = parser.parse_args()
    root = args.root.resolve()
    index_path = Path(read_git(root, "rev-parse", "--git-path", "index").decode().strip())
    if not index_path.is_absolute():
        index_path = root / index_path
    if not index_path.is_file():
        print("提交前检查：没有暂存索引。")
        return 0
    original = index_path.read_bytes()
    original_head = read_git(root, "rev-parse", "--revs-only", "HEAD")
    # Windows 临时目录通常比仓库路径长，Java 深层包路径可能超过 MAX_PATH。
    # 从临时根就采用长路径表示，创建、检查和自动清理使用同一种绝对路径。
    temporary_root = str(Path(tempfile.gettempdir()).resolve())
    if os.name == "nt" and not temporary_root.startswith("\\\\?\\"):
        temporary_root = (
            "\\\\?\\UNC\\" + temporary_root[2:]
            if temporary_root.startswith("\\\\")
            else "\\\\?\\" + temporary_root
        )
    with tempfile.TemporaryDirectory(prefix="aimaster-staged-", dir=temporary_root) as temporary:
        folder = Path(temporary).resolve()
        private_index = folder / "index"
        private_index.write_bytes(original)
        # Git for Windows 的环境路径不识别 Python 长路径前缀；索引本身位于
        # 临时根，路径足够短，只给文件系统视图保留长路径表示。
        git_index = str(private_index)
        if git_index.startswith("\\\\?\\UNC\\"):
            git_index = "\\\\" + git_index[8:]
        elif git_index.startswith("\\\\?\\"):
            git_index = git_index[4:]
        env = {
            **os.environ,
            "GIT_INDEX_FILE": git_index,
            "PYTHONIOENCODING": "utf-8",
            "PYTHONDONTWRITEBYTECODE": "1",
        }
        changes = read_changes(root, env)
        read_index(root, env)  # 即使没有普通差异，也必须拒绝冲突索引。
        if args.list:
            print("核心检查：" + ", ".join(name for name, _, _ in core_jobs(changes)))
            print(
                "文档检查按暂存对象选择："
                + (", ".join(DOC_MODULES) if needs_documents(changes) else "无")
            )
            return 0
        if not changes:
            print("提交前检查：没有暂存变更。")
            return 0
        result = run_checks(root, folder, env, changes)
    if (
        not index_path.is_file()
        or hashlib.sha256(index_path.read_bytes()).digest() != hashlib.sha256(original).digest()
        or read_git(root, "rev-parse", "--revs-only", "HEAD") != original_head
    ):
        raise CheckError("检查期间暂存区或 HEAD 被其他操作改变，请重新检查")
    return result


if __name__ == "__main__":
    raise SystemExit(entry(main))
