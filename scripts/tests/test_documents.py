"""验证文档、技能和笔记检查的中文、结构与失败边界。

测试只使用独立临时文件，笔记目录结构采用虚拟路径，不创建项目隐藏目录。
@author 李杰
"""

from pathlib import Path

import pytest
from scripts.common.quality_common import CheckError, discover
from scripts.docs import agent_note_support, verify_agent_note_format
from scripts.docs.markdown_support import parse
from scripts.docs.verify_doc_refs import collect as refs
from scripts.docs.verify_md_links import collect as links
from scripts.docs.verify_md_links import decode_path
from scripts.skills.verify_skill_metadata import frontmatter, validate


def write(root: Path, path: str, text: str) -> Path:
    """在测试私有目录写 UTF-8 样例，返回可用于断言的路径。"""
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    return target


def test_markdown_links_and_anchors(tmp_path: Path) -> None:
    """中文编码、重复标题、HTML 锚点与引用图片均应被正确识别。"""
    write(tmp_path, "docs/目标.md", "# 重复\n# 重复\n<a id='说明'></a>\n")
    write(tmp_path, "docs/图片.png", "fixture")
    write(
        tmp_path,
        "docs/入口.md",
        (
            "[中文](%E7%9B%AE%E6%A0%87.md#重复-1)\n"
            "[锚点](目标.md#说明)\n![图片][image]\n\n[image]: 图片.png\n"
            "\n```md\n[示例](不存在.md)\n```\n"
            "\n<!-- <a id='假锚点'></a> -->\n"
        ),
    )
    count, findings = links(tmp_path, ["docs/入口.md"])
    assert count == 1
    assert not findings
    write(tmp_path, "docs/入口.md", "[错](目标.md#假锚点)\n[缺](不存在.md)\n")
    _, findings = links(tmp_path, ["docs/入口.md"])
    assert len(findings) == 2
    assert any("锚点" in item.message for item in findings)


def test_unused_definition_and_code_html() -> None:
    """未使用的引用定义也要检查；行内代码和 HTML 注释不能注册锚点。"""
    parsed = parse('[unused]: 缺失.md\n\n`<a id="fake"></a>`\n<!-- <a id="hidden"></a> -->\n')
    assert any(item.url.endswith(".md") for item in parsed.destinations)
    assert not parsed.anchors


def test_heading_collisions_and_formatting() -> None:
    """真实标题文字去格式后保持稳定，重复标题不覆盖已有编号锚点。"""
    parsed = parse("# 标题\n# 标题-1\n# 标题\n# **强调** 和 `代码`\n")
    assert {"标题", "标题-1", "标题-2", "强调-和-代码"} <= parsed.anchors


def test_malformed_percent_path_preserves_literal_filename(tmp_path: Path) -> None:
    """无效 UTF-8 百分号序列不得被替换字符破坏真实文件名。"""
    write(tmp_path, "%FF.md", "# 说明")
    write(tmp_path, "入口.md", "[文件](%FF.md)")
    assert decode_path("%FF.md") == "%FF.md"
    assert not links(tmp_path, ["入口.md"])[1]


def test_discovery_excludes_and_missing_root(tmp_path: Path) -> None:
    """默认和显式范围均不能绕过 vendor 排除，错误路径不得静默通过。"""
    write(tmp_path, "docs/正常.md", "# 说明")
    write(tmp_path, "vendor/跳过.md", "[坏](missing.md)")
    assert len(discover(tmp_path, {".md"})) == 1
    with pytest.raises(CheckError):
        discover(tmp_path, {".md"}, ["vendor"])
    with pytest.raises(CheckError):
        discover(tmp_path, {".md"}, ["缺失"])
    with pytest.raises(CheckError):
        discover(tmp_path / "不存在", {".md"})


@pytest.mark.parametrize(
    ("scope", "expected"),
    [
        ([], ["docs/a.md", "docs/sub/b.md", "docs-extra/c.md"]),
        (["."], ["docs/a.md", "docs/sub/b.md", "docs-extra/c.md"]),
        (["docs"], ["docs/a.md", "docs/sub/b.md"]),
        (["docs/a.md"], ["docs/a.md"]),
        (["docs/sub", "docs/a.md", "docs/a.md"], ["docs/a.md", "docs/sub/b.md"]),
        (["docs", "docs/sub/b.md"], ["docs/a.md", "docs/sub/b.md"]),
    ],
)
def test_discovery_scope_boundaries(tmp_path: Path, scope: list[str], expected: list[str]) -> None:
    """文件、目录及重叠范围保持相同集合，不误收同名前缀目录或重复结果。"""
    for name in ("docs/a.md", "docs/sub/b.md", "docs-extra/c.md", "docs/data.txt"):
        write(tmp_path, name, "sample")
    assert discover(tmp_path, {".md"}, scope) == sorted(tmp_path / name for name in expected)


def test_discovery_explicit_files_avoid_pairwise_ancestry(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """批量显式文件只保留线性数量的边界校验，不依赖机器耗时设定性能阈值。"""
    names = [f"docs/group-{index % 5}/file-{index:03d}.md" for index in range(80)]
    for name in names:
        write(tmp_path, name, "sample")
    original = Path.is_relative_to
    calls = 0

    def counted(path: Path, other: Path) -> bool:
        """记录祖先判断次数并调用原方法，保持真实路径判断语义。"""
        nonlocal calls
        calls += 1
        return original(path, other)

    monkeypatch.setattr(Path, "is_relative_to", counted)
    assert discover(tmp_path, {".md"}, names) == sorted(tmp_path / name for name in names)
    # 允许每个文件的输入安全校验和结果边界校验，预留一次线性余量。
    assert calls <= 3 * len(names)


def test_link_escape_and_no_external_requests(tmp_path: Path) -> None:
    """外部网址跳过，越界相对目标报告失败而不读取仓库外正文。"""
    write(tmp_path, "入口.md", "[外部](https://example.invalid/)\n[越界](../private.md)\n")
    _, findings = links(tmp_path, [])
    assert len(findings) == 1
    assert "超出仓库" in findings[0].message


def test_source_refs_chinese_and_placeholders(tmp_path: Path) -> None:
    """源码字符串中的中文路径可检查，模板路径不被当成具体文件。"""
    write(tmp_path, "docs/开发指南/中文 文档.md", "说明")
    write(
        tmp_path,
        "sample.py",
        ('# docs/开发指南/中文 文档.md\nvalue = "docs/开发指南/缺失.md"\n# docs/{topic}.md\n'),
    )
    count, findings = refs(tmp_path, ["sample.py"])
    assert count == 1
    assert len(findings) == 1 and findings[0].line == 2


def test_source_docs_follow_nearest_workspace(tmp_path: Path) -> None:
    """各工作区的文档独立解析，缺失时不能借用根目录或相邻工程的同名文件。"""
    write(tmp_path, "docs/开发指南/模块图.md", "# 仓库说明")
    write(tmp_path, "前端/甲/pnpm-workspace.yaml", "packages: []")
    write(tmp_path, "前端/乙/pnpm-workspace.yaml", "packages: []")
    write(tmp_path, "前端/甲/docs/开发指南/模块图.md", "# 甲模块图")
    source = 'OUTPUT = "docs/开发指南/模块图.md"\n'
    write(tmp_path, "前端/甲/scripts/graph.py", source)
    write(tmp_path, "前端/乙/scripts/graph.py", source)
    count, findings = refs(tmp_path, ["前端"])
    assert count == 3
    assert [(item.path, item.line) for item in findings] == [("前端/乙/scripts/graph.py", 1)]
    write(tmp_path, "前端/乙/docs/开发指南/模块图.md", "# 乙模块图")
    assert not refs(tmp_path, ["前端"])[1]


def test_source_docs_keep_repository_and_agent_roots(tmp_path: Path) -> None:
    """普通包清单不改变根相对语义，前端源码里的智能体路径仍相对于仓库。"""
    write(tmp_path, "docs/说明.md", "# 说明")
    write(tmp_path, ".agents/skills/demo/SKILL.md", "# 规则")
    write(tmp_path, "module/package.json", "{}")
    write(tmp_path, "module/tool.py", 'REFERENCE = "docs/说明.md"\n')
    write(tmp_path, "前端/pnpm-workspace.yaml", "packages: []")
    write(tmp_path, "前端/tool.py", 'REFERENCE = ".agents/skills/demo/SKILL.md"\n')
    assert not refs(tmp_path, ["module/tool.py", "前端/tool.py"])[1]


def test_source_docs_reject_workspace_escape(tmp_path: Path) -> None:
    """工作区文档引用不能通过上级路径或编码访问工作区外的现有文件。"""
    write(tmp_path, "outside.md", "# 不属于工作区")
    write(tmp_path, "前端/pnpm-workspace.yaml", "packages: []")
    write(tmp_path, "前端/tool.py", 'REFERENCE = "docs/%2E%2E/%2E%2E/outside.md"\n')
    findings = refs(tmp_path, ["前端/tool.py"])[1]
    assert len(findings) == 1 and findings[0].rule == "doc-ref"


def test_test_data_strings_do_not_claim_repository_files(tmp_path: Path) -> None:
    """测试字符串是输入样例；测试函数的注释和职责文档仍受引用检查。"""
    prefix = "docs/"
    write(
        tmp_path,
        "test_sample.py",
        (
            "def test_sample():\n"
            f'    """核对 {prefix}职责.md 的行为。"""\n'
            f'    value = "{prefix}假数据.md"\n'
            f"    # 规则见 {prefix}规则.md\n"
        ),
    )
    _, findings = refs(tmp_path, [])
    assert len(findings) == 2
    assert {item.line for item in findings} == {2, 4}


def test_skill_optional_config_and_consistency(tmp_path: Path) -> None:
    """没有 Codex 配置也检查主文件；有配置时检查名称和调用策略。"""
    skill = write(tmp_path, "demo/SKILL.md", "---\nname: demo\ndescription: 示例技能\n---\n")
    config = tmp_path / "demo/agents/openai.yaml"
    assert not validate(skill, config, tmp_path)
    write(tmp_path, "demo/agents/openai.yaml", 'interface:\n  default_prompt: "使用 $other"\n')
    assert any("default_prompt" in item.message for item in validate(skill, config, tmp_path))
    write(
        tmp_path,
        "demo/agents/openai.yaml",
        'interface:\n  default_prompt: "使用 $demo"\npolicy:\n  allow_implicit_invocation: false\n',
    )
    assert any("策略不一致" in item.message for item in validate(skill, config, tmp_path))


@pytest.mark.parametrize(
    "source",
    [
        "---\nname: demo\nname: other\n---\n",
        "---\nname: demo\n",
        "---\n!!python/object/apply:os.system [echo]\n---\n",
    ],
)
def test_invalid_skill_yaml(source: str) -> None:
    """重复键、未闭合元数据及可执行 YAML 标签必须失败。"""
    with pytest.raises(ValueError):
        frontmatter(source)


def test_frontmatter_crlf_and_wrong_policy(tmp_path: Path) -> None:
    """CRLF 元数据可以解析，但布尔策略不能用字符串代替。"""
    assert frontmatter("---\r\nname: demo\r\n---\r\n")["name"] == "demo"
    skill = write(
        tmp_path,
        "demo/SKILL.md",
        '---\nname: demo\ndescription: 示例\ndisable-model-invocation: "true"\n---\n',
    )
    assert validate(skill, tmp_path / "absent.yaml", tmp_path)


def test_note_paths_without_creating_hidden_dirs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """有效日期通过，错误分类和无效日期失败，管理文件不算笔记。"""
    paths = [
        tmp_path / ".agents/notes/implemented/process/2026-09-20-正常.md",
        tmp_path / ".agents/notes/implemented/unknown/2026-09-20-错误.md",
        tmp_path / ".agents/notes/implemented/process/2026-02-30-错误.md",
        tmp_path / ".agents/notes/AGENTS.md",
    ]
    monkeypatch.setattr(agent_note_support, "discover", lambda *_: paths)
    notes, findings = agent_note_support.collect_notes(tmp_path, [])
    assert len(notes) == 1 and len(findings) == 2


@pytest.mark.parametrize("english", [False, True])
def test_note_chinese_and_legacy_english(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, english: bool
) -> None:
    """中文骨架与历史英文标记都能表达同一有效的已实现决策。"""
    headings = (
        ["Problem", "Decision", "Alternatives considered", "Consequences", "Testing"]
        if english
        else ["问题", "决策", "考虑过的替代方案", "影响与恢复", "验证"]
    )
    source = (
        "# Agent Note: 示例\n\nStatus: implemented\n\n"
        if english
        else "# 决策记录：示例\n\n状态：已实现\n\n"
    )
    source += "\n".join(f"## {heading}\n\n真实依据。\n" for heading in headings)
    monkeypatch.setattr(verify_agent_note_format, "read_text", lambda _: source)
    path = tmp_path / ".agents/notes/implemented/process/2026-09-20-示例.md"
    assert not verify_agent_note_format.validate(path, tmp_path)


def test_note_cannot_fake_sections_in_fences(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """围栏中的章节不满足正文要求，状态不匹配也必须报告。"""
    source = "# 决策记录：示例\n\n状态：提议中\n\n```md\n## 问题\n## 决策\n```\n"
    monkeypatch.setattr(verify_agent_note_format, "read_text", lambda _: source)
    path = tmp_path / ".agents/notes/implemented/process/2026-09-20-示例.md"
    findings = verify_agent_note_format.validate(path, tmp_path)
    assert {"note-status", "note-section"} <= {item.rule for item in findings}
