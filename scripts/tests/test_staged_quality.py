"""验证提交钩子的暂存隔离、检查路由、失败汇总与真实命令入口。

真实 Git 验证使用私有索引和对象目录，不创建仓库、不提交、不改变用户索引。
@author 李杰
"""

from __future__ import annotations

import ast
import hashlib
import os
import shutil
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
from scripts.code.web import check_worktree_web_comments as web
from scripts.common import staged_content as staged
from scripts.common.quality_common import DEFAULT_ROOT, CheckError, ProcessResult
from scripts.workflow import check_staged_quality as runner

OLD = "a" * 40
NEW = "b" * 40
ZERO = "0" * 40
DOCUMENT = (
    "# 钩子验证\n\n## 摘要\n\n验证暂存内容。\n\n-----\n\n## 目录\n\n"
    "- [正文](#正文)\n- [开发笔记](#开发笔记)\n\n-----\n\n## 正文\n\n"
    "暂存区检查说明。\n\n-----\n\n## 开发笔记\n\n"
    "<details>\n<summary>维护说明</summary>\n\n无。\n\n</details>\n"
)


@pytest.mark.parametrize(
    "name", ["../outside", "/etc/passwd", "C:/x", ".git/config", "a\nb", "nul.txt", "a. "]
)
def test_snapshot_rejects_unsafe_paths(name: str) -> None:
    """索引中的路径不能用于越界、管理目录、驱动器或换行注入。"""
    with pytest.raises(CheckError):
        staged.checked_name(name.encode())


def test_conflict_index_fails(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """未合并的索引不能因没有常规修改而被视为检查通过。"""
    monkeypatch.setattr(
        staged, "read_git", lambda *args, **kwargs: f"100644 {OLD} 1\ta.py\0".encode()
    )
    with pytest.raises(CheckError, match="冲突"):
        staged.read_index(tmp_path)


def test_snapshot_never_reads_worktree(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """内容来自对象读取，未暂存工作区文本和未跟踪目标都不进入检查视图。"""
    root, view = tmp_path / "root", tmp_path / "view"
    root.mkdir()
    view.mkdir()
    (root / "文档.md").write_text("未暂存版本", encoding="utf-8")
    (root / "untracked.md").write_text("未跟踪", encoding="utf-8")
    entries = {
        "文档.md": staged.IndexEntry("100644", OLD),
        "图片.png": staged.IndexEntry("100644", NEW),
    }
    monkeypatch.setattr(staged, "read_blobs", lambda *args: {OLD: b"# staged"})
    staged.materialize(root, view, entries, {"文档.md"})
    assert (view / "文档.md").read_text() == "# staged"
    assert (view / "图片.png").is_file()
    assert not (view / "untracked.md").exists()
    assert (root / "文档.md").read_text(encoding="utf-8") == "未暂存版本"


@pytest.mark.parametrize("link", [b"../outside.md", b"alias.md"])
def test_snapshot_rejects_link_escape_and_cycle(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    link: bytes,
) -> None:
    """快照不创建系统链接，也不允许链接环或访问快照外内容。"""
    monkeypatch.setattr(staged, "read_blobs", lambda *args: {OLD: link})
    with pytest.raises(CheckError):
        staged.materialize(
            tmp_path, tmp_path, {"alias.md": staged.IndexEntry("120000", OLD)}, {"alias.md"}
        )


def test_deleted_target_selects_incoming_links(tmp_path: Path) -> None:
    """删除目标会检查未修改引用方的相关行，不把其他历史失效链接一起带入。"""
    (tmp_path / "说明.md").write_text("[受影响](目标.md)\n[历史](旧.md)\n", encoding="utf-8")
    entries = {"说明.md": staged.IndexEntry("100644", OLD)}
    scopes, incoming = runner.document_scopes(
        tmp_path,
        [staged.Change("目标.md", OLD, ZERO, "D")],
        entries,
    )
    assert scopes["md-links"] == ["说明.md"]
    assert incoming["md-links"] == {"说明.md": {1}}
    assert scopes["doc-structure"] == []


def test_deleted_workspace_document_selects_source_references(tmp_path: Path) -> None:
    """删除工作区文档会补查该工程的源码引用，不连带另一工作区的同名引用。"""
    entries = {}
    for workspace in ("甲", "乙"):
        marker = f"前端/{workspace}/pnpm-workspace.yaml"
        source = f"前端/{workspace}/scripts/graph.py"
        (tmp_path / marker).parent.mkdir(parents=True)
        (tmp_path / marker).write_text("", encoding="utf-8")
        (tmp_path / source).parent.mkdir()
        (tmp_path / source).write_text('OUTPUT = "docs/模块图.md"\n', encoding="utf-8")
        entries[marker] = staged.IndexEntry("100644", OLD)
        entries[source] = staged.IndexEntry("100644", OLD)
    scopes, incoming = runner.document_scopes(
        tmp_path, [staged.Change("前端/甲/docs/模块图.md", OLD, ZERO, "D")], entries
    )
    assert scopes["doc-refs"] == ["前端/甲/scripts/graph.py"]
    assert incoming["doc-refs"] == {"前端/甲/scripts/graph.py": {1}}


@pytest.mark.parametrize(
    "mode", ["add", "remove", "reason", "same", "other", "invalid-old", "invalid-new"]
)
def test_rule_changes_select_only_affected_structures(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, mode: str
) -> None:
    """结构排除增删只影响命中页面，其他规则变化扩大检查，非法新配置拒绝。"""
    data = ast.literal_eval(
        ast.parse((DEFAULT_ROOT / runner.RULE_FILE).read_text(encoding="utf-8")).body[-1].value
    )
    pattern = ".gitlab/merge_request_templates/*.md"
    data["structure_exclusions"].pop(pattern, None)
    old = "RULES = " + repr(data)
    data["structure_exclusions"][pattern] = "填写模板"
    new = "RULES = " + repr(data)
    if mode == "remove":
        old, new = new, old
    elif mode == "reason":
        old = new.replace("填写模板", "原有模板说明")
    elif mode == "same":
        old = new
    elif mode == "other":
        data["path_placeholders"].append("另一个占位符")
        new = "RULES = " + repr(data)
    elif mode == "invalid-old":
        old = "RULES = {"
    elif mode == "invalid-new":
        new = "RULES = {"
    monkeypatch.setattr(runner, "read_blobs", lambda *args: {OLD: old.encode(), NEW: new.encode()})
    changes = [staged.Change(runner.RULE_FILE, OLD, NEW, "M")]
    if mode == "invalid-new":
        with pytest.raises(CheckError):
            runner.changed_structure_patterns(tmp_path, tmp_path / "versions", changes, {})
        return
    patterns = runner.changed_structure_patterns(tmp_path, tmp_path / "versions", changes, {})
    expected = None if mode in {"other", "invalid-old"} else set() if mode == "same" else {pattern}
    assert patterns == expected
    entries = {
        name: staged.IndexEntry("100644", NEW)
        for name in (runner.RULE_FILE, ".gitlab/merge_request_templates/Default.md", "历史.md")
    }
    scopes, _ = runner.document_scopes(tmp_path, changes, entries, patterns)
    if patterns is not None:
        assert "历史.md" not in scopes["doc-structure"]
        assert scopes["md-links"] == []
        assert scopes["doc-structure"] == (
            [".gitlab/merge_request_templates/Default.md"] if patterns else []
        )
    else:
        assert "历史.md" in scopes["doc-structure"]


def test_manifest_and_skill_pairing(tmp_path: Path) -> None:
    """只修改清单或删除技能主文件，也必须检查关联 README 或仍在索引内的配对配置。"""
    entries = {
        name: staged.IndexEntry("100644", OLD)
        for name in (
            "pkg/README.md",
            "pkg/package.json",
            ".agents/skills/demo/agents/openai.yaml",
        )
    }
    for name in entries:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("", encoding="utf-8")
    scopes, _ = runner.document_scopes(
        tmp_path,
        [
            staged.Change("pkg/package.json", OLD, NEW, "M"),
            staged.Change(".agents/skills/demo/SKILL.md", OLD, ZERO, "D"),
        ],
        entries,
    )
    assert scopes["package-readmes"] == ["pkg/README.md"]
    assert scopes["skills"] == [".agents/skills/demo/agents/openai.yaml"]


@pytest.mark.parametrize(("codes", "expected"), [([1, 0], 1), ([1, 2], 2), ([0, 0], 0)])
def test_failures_do_not_skip_independent_checks(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    codes: list[int],
    expected: int,
) -> None:
    """一个检查失败后仍执行其他独立检查，环境失败优先返回 2。"""
    calls = []
    remaining = iter(codes)

    def run(*args: object, **kwargs: object) -> ProcessResult:
        """替代子进程边界，记录实际调度次数并依序返回退出码。"""
        calls.append(args)
        return ProcessResult(next(remaining), b"", b"")

    monkeypatch.setattr(runner, "run_process", run)
    monkeypatch.setattr(runner, "needs_documents", lambda changes: False)
    result = runner.run_checks(tmp_path, tmp_path, {}, [staged.Change("a.py", OLD, NEW, "M")])
    assert result == expected and len(calls) == 2


def test_web_uses_staged_content_and_separate_scopes(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """管理前端与仓库工具分别传入暂存源码；工作区文件缺失也不能跳过。"""
    names = ["前端代码/basic-framework-admin/src/文件.ts", "scripts/文件.ts"]
    monkeypatch.setattr(
        web, "read_changes", lambda root: [staged.Change(name, ZERO, NEW, "A") for name in names]
    )
    monkeypatch.setattr(
        web, "read_index", lambda root: {name: staged.IndexEntry("100644", NEW) for name in names}
    )
    monkeypatch.setattr(web, "read_blobs", lambda *args: {NEW: b"const staged = 1;"})
    requests = []

    def invoke(mode: str, payload: dict) -> dict:
        """记录解析请求，不冒充真实语法验证；真实解析另由入口集成测试覆盖。"""
        requests.append(payload["files"])
        return {"findings": []}

    monkeypatch.setattr(web, "invoke", invoke)
    assert web.collect_staged(tmp_path, []) == (2, [])
    assert len(requests) == 2
    assert {batch[0]["path"] for batch in requests} == set(names)
    assert all(batch[0]["source"] == "const staged = 1;" for batch in requests)


@pytest.fixture
def private_index(tmp_path: Path) -> Iterator[dict[str, str]]:
    """复制 HEAD 到私有索引，所有测试对象也隔离存放，结束时核对真实索引。"""
    root = DEFAULT_ROOT
    real_index = Path(
        subprocess.check_output(
            ["git", "rev-parse", "--git-path", "index"],
            cwd=root,
            text=True,
        ).strip()
    )
    if not real_index.is_absolute():
        real_index = root / real_index
    before = hashlib.sha256(real_index.read_bytes()).digest()
    objects = Path(
        subprocess.check_output(
            ["git", "rev-parse", "--git-path", "objects"],
            cwd=root,
            text=True,
        ).strip()
    )
    if not objects.is_absolute():
        objects = root / objects
    private_objects = tmp_path / "objects"
    private_objects.mkdir()
    env = {
        **os.environ,
        "GIT_INDEX_FILE": str(tmp_path / "index"),
        "GIT_OBJECT_DIRECTORY": str(private_objects),
        "GIT_ALTERNATE_OBJECT_DIRECTORIES": str(objects.resolve()),
        "PYTHONIOENCODING": "utf-8",
    }
    subprocess.run(
        ["git", "read-tree", "HEAD"], cwd=root, env=env, check=True, capture_output=True, timeout=30
    )
    try:
        yield env
    finally:
        assert hashlib.sha256(real_index.read_bytes()).digest() == before


def stage_blob(env: dict[str, str], name: str, content: str) -> None:
    """在已隔离的对象库和索引中添加 UTF-8 样本，不触碰工作区文件。"""
    oid = (
        subprocess.check_output(
            ["git", "hash-object", "-w", "--stdin"],
            cwd=DEFAULT_ROOT,
            env=env,
            input=content.encode("utf-8"),
            timeout=30,
        )
        .decode()
        .strip()
    )
    subprocess.run(
        ["git", "update-index", "--add", "--cacheinfo", f"100644,{oid},{name}"],
        cwd=DEFAULT_ROOT,
        env=env,
        check=True,
        capture_output=True,
        timeout=30,
    )


@pytest.mark.parametrize(
    ("name", "content", "code", "marker"),
    [
        ("hook-probe.yaml", "token_strategy" + ": local\n", 0, "需人工核查"),
        ("hook-probe.yaml", "access_token" + ": unit-abc123xyz\n", 1, "阻断"),
        ("docs/" + "钩子验证/说明.md", DOCUMENT, 0, "md-links"),
        ("docs/" + "钩子验证/说明.md", DOCUMENT + "\n[失效](缺失.md)\n", 1, "md-link"),
        ("前端/管理系统/hook-probe.ts", "export function missing() {}\n", 1, "web-doc"),
    ],
)
def test_real_staged_runner(
    private_index: dict[str, str],
    name: str,
    content: str,
    code: int,
    marker: str,
) -> None:
    """真实命令读取只有索引中存在的样本，保留正常、提示及各类失败状态。"""
    stage_blob(private_index, name, content)
    result = subprocess.run(
        [
            sys.executable,
            "-X",
            "utf8",
            "-B",
            str(DEFAULT_ROOT / "scripts/workflow/check_staged_quality.py"),
        ],
        cwd=DEFAULT_ROOT,
        env=private_index,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=120,
    )
    assert result.returncode == code, result.stdout + result.stderr
    assert marker in result.stdout + result.stderr
    assert "unit-abc123xyz" not in result.stdout + result.stderr


def test_real_shell_hook(private_index: dict[str, str]) -> None:
    """用 Git 自带 Shell 执行真实钩子，验证解释器选择与退出状态传递。"""
    git_path = Path(shutil.which("git") or "")
    shell = (
        git_path.parent.parent / "bin/sh.exe" if os.name == "nt" else Path(shutil.which("sh") or "")
    )
    assert shell.is_file(), "真实钩子验证需要 Git Shell"
    stage_blob(private_index, "hook-probe.yaml", "token_count" + ": 1024\n")
    result = subprocess.run(
        [str(shell), str(DEFAULT_ROOT / ".githooks/pre-commit")],
        cwd=DEFAULT_ROOT,
        env=private_index,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=120,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "提交前检查完成" in result.stdout


@pytest.mark.parametrize("valid_note", [True, False])
def test_all_thirteen_checks_are_dispatched(
    private_index: dict[str, str], valid_note: bool
) -> None:
    """一次真实暂存变更覆盖全部检查，并证明无关联类型不会被空范围全仓扫描。"""
    note = "# 决策记录：钩子样本\n\n状态：已实现\n\n" + "\n\n".join(
        f"## {heading}\n\n说明本项决策及边界。"
        for heading in ("问题", "决策", "考虑过的替代方案", "影响", "验证")
    )
    samples = {
        ".agents/notes/implemented/testing/"
        + ("2026-09-21-hook-probe.md" if valid_note else "invalid-name.md"): note,
        ".agents/skills/weetion-hook-probe/SKILL.md": (
            "---\nname: weetion-hook-probe\ndescription: 验证提交检查的技能样本。\n---\n# 样本\n"
        ),
        "docs/钩子验证/说明.md": DOCUMENT.replace(
            "暂存区检查说明。", "```mermaid\nflowchart LR\n  A --> B\n```"
        ),
        "docs/钩子验证/README.md": (
            "---\ndescription: 说明检查样本。\nkind: package-group\n---\n"
            + DOCUMENT.replace("正文", "包").replace(
                "## 开发笔记", "## 相关文档\n\n[说明](说明.md)\n\n-----\n\n## 开发笔记"
            )
        ),
        "hook-probe.py": '"""说明检查样本。\n@author 李杰\n"""\nVALUE = 1\n',
        "后端/java服务/HookProbe.java": "/** 验证检查。\n * @author 李杰\n */\npublic class HookProbe {}\n",
        "前端/业务系统/hook-probe.ts": "/** 模块说明。 */\nconst value = 1;\n",
    }
    for name, content in samples.items():
        stage_blob(private_index, name, content)
    result = subprocess.run(
        [
            sys.executable,
            "-X",
            "utf8",
            "-B",
            str(DEFAULT_ROOT / "scripts/workflow/check_staged_quality.py"),
        ],
        cwd=DEFAULT_ROOT,
        env=private_index,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=120,
    )
    assert result.returncode == (0 if valid_note else 1), result.stdout + result.stderr
    assert "13 项执行结果" in result.stdout
    for name in (
        "secrets",
        "java-comments",
        "python-comments",
        "web-comments",
        *runner.DOC_MODULES,
    ):
        assert name in result.stdout
    if not valid_note:
        assert "note-format: skipped" in result.stdout and "mermaid：检查 1" in result.stdout


def test_deleted_doc_ignores_unrelated_history(private_index: dict[str, str]) -> None:
    """实际删除已跟踪文档时，关联路径检查执行且不把删除当成输入丢失错误。"""
    # 关联引用扫描需要可解码的源码视图；私有索引带入本次已修复的两个 UTF-8 文件。
    # 真实索引仍不变；旧对象的 Web 编码边界由独立回归测试验证。
    for filename in ("cropper.vue", "typing.ts"):
        name = "前端代码/basic-framework-admin/apps/web-ele/src/components/cropper/" + filename
        stage_blob(private_index, name, (DEFAULT_ROOT / name).read_text(encoding="utf-8"))
    subprocess.run(
        ["git", "update-index", "--force-remove", "AGENTS.md"],
        cwd=DEFAULT_ROOT,
        env=private_index,
        check=True,
        capture_output=True,
        timeout=30,
    )
    result = subprocess.run(
        [
            sys.executable,
            "-X",
            "utf8",
            "-B",
            str(DEFAULT_ROOT / "scripts/workflow/check_staged_quality.py"),
        ],
        cwd=DEFAULT_ROOT,
        env=private_index,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=120,
    )
    assert result.returncode == 1, result.stdout + result.stderr
    assert "md-link" in result.stdout
    assert "doc-structure：" not in result.stdout
