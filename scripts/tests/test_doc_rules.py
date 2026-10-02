"""验证文档规则的真实输入、模板边界及拒绝路径。

所有写入仅发生在 pytest 临时目录，不修改被检查的仓库文档。
@author 李杰
"""

from dataclasses import replace
from pathlib import Path

import pytest
from scripts.common.quality_common import DEFAULT_ROOT, CheckError
from scripts.docs.document_support import load_rules, structure_findings
from scripts.docs.markdown_support import tokenize_markdown
from scripts.docs.verify_doc_policy import validate as policy
from scripts.docs.verify_doc_refs import collect as references
from scripts.docs.verify_doc_structure import collect as structures
from scripts.docs.verify_package_readmes import collect as readmes
from scripts.docs.verify_package_readmes import validate as readme


def write(root: Path, relative: str, content: str) -> Path:
    """创建测试私有的 UTF-8 文件，返回真实路径供只读入口检查。"""
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


def page(kind: str = "") -> str:
    """构造普通页面或运行时包的有效最小骨架，不省略限制与折叠内容。"""
    header = f"---\ndescription: 提供示例能力\nkind: {kind}\n---\n" if kind else ""
    body = "# 页面\n\n## 摘要\n\n概述。\n\n## 目录\n\n[正文](#使用)\n\n-----\n\n## 使用\n\n步骤。\n\n-----\n\n"
    if kind:
        body += "## 已知限制与暂缓工作\n\n无已知限制。\n\n### 开发笔记\n\n"
    else:
        body += "## 开发笔记\n\n"
    return header + body + "<details>\n<summary>展开</summary>\n\n无。\n\n</details>\n"


def test_rules_do_not_execute_python(tmp_path: Path) -> None:
    """配置出现调用或其他语句时失败，不执行附带文件写入。"""
    marker = tmp_path / "executed"
    write(
        tmp_path,
        "scripts/tools/document_rules.py",
        f"open({str(marker)!r}, 'w').close()\nRULES = {{}}",
    )
    with pytest.raises(CheckError, match="字面量"):
        load_rules(tmp_path)
    assert not marker.exists()


@pytest.mark.parametrize(
    "source", ["RULES = {'a': 1, 'a': 2}", "RULES = []", "RULES = dict()", "RULES = {"]
)
def test_invalid_rules_fail_closed(tmp_path: Path, source: str) -> None:
    """重复键、错误类型和非法语法不能让规则静默跳过。"""
    write(tmp_path, "scripts/tools/document_rules.py", source)
    with pytest.raises(CheckError):
        load_rules(tmp_path)


def test_markdown_paths_and_examples(tmp_path: Path) -> None:
    """中文与空格目录可用，失效及越界路径失败，围栏和占位符不检查。"""
    write(tmp_path, "docs/中文 目录/存在.md", "# 目标")
    write(
        tmp_path,
        "入口.md",
        "`docs/中文 目录/存在.md:2`\n\n`docs/中文 目录/`\n\n`docs/缺失.md`\n\n`docs/../../外部.md`\n\n`docs/{name}.md` `docs/*.md`\n\n```md\n`docs/示例.md`\n```\n",
    )
    _, findings = references(tmp_path, ["入口.md"])
    assert len(findings) == 2
    assert {item.line for item in findings} == {5, 7}


def test_path_scope_includes_new_rules_directory(tmp_path: Path) -> None:
    """新规则路径存在时通过，反斜杠与百分号编码同样解析到本地目录。"""
    write(tmp_path, "scripts/tools/配置.py", "# 配置")
    write(tmp_path, "入口.md", "`scripts\\tools\\配置.py` `scripts/tools/%E9%85%8D%E7%BD%AE.py`")
    assert not references(tmp_path, ["入口.md"])[1]


def test_python_parameter_fixtures_keep_documentation_checks(tmp_path: Path) -> None:
    """参数化样例不是实际引用，但测试注释、Docstring 和普通函数装饰器仍检查。"""
    source = (
        '@pytest.mark.parametrize("path", ["docs/样例.md"])\n'
        "def test_reference(path):\n"
        '    """参见 docs/缺失说明.md 。"""\n'
        "    # 参见 docs/缺失注释.md\n"
        "    assert path\n"
        '@register("docs/真实引用.md")\n'
        "def service(): pass\n"
    )
    write(tmp_path, "test_references.py", source)
    findings = references(tmp_path, ["test_references.py"])[1]
    assert {item.line for item in findings} == {3, 4, 6}


def test_normal_structure_and_crlf(tmp_path: Path) -> None:
    """LF 与 CRLF 的同一骨架都有效，解析器不要求重新编码页面。"""
    rules = load_rules(tmp_path)
    assert not structure_findings(page(), "入口.md", rules)
    assert not structure_findings(page().replace("\n", "\r\n"), "入口.md", rules)


def test_merge_request_template_has_its_own_structure(tmp_path: Path) -> None:
    """合并请求模板使用填写骨架，普通页面已有开发者章节仍须折叠。"""
    template = ".gitlab/merge_request_templates/Default.md"
    write(tmp_path, template, "## 理解实现\n\n待填写。\n")
    write(tmp_path, "docs/文件名.md", "## 理解实现\n\n待填写。\n")
    assert not structures(tmp_path, [template])[1]
    assert any(item.rule == "doc-fold" for item in structures(tmp_path, ["docs/文件名.md"])[1])


@pytest.mark.parametrize(
    "before,after,rule",
    [
        ("</details>", "", "doc-fold"),
        ("<summary>展开</summary>", "", "doc-fold"),
    ],
)
def test_structure_rejects_invalid_sections(
    tmp_path: Path, before: str, after: str, rule: str
) -> None:
    """已有章节的折叠损坏仍产生可定位诊断。"""
    findings = structure_findings(page().replace(before, after), "入口.md", load_rules(tmp_path))
    assert rule in {item.rule for item in findings}


def test_fake_structure_in_code_is_ignored(tmp_path: Path) -> None:
    """代码中的样例不构成章节或折叠，不能满足真实开发者章节的折叠要求。"""
    source = page().replace("步骤。", "```md\n<details>\n## 假标题\n```\n")
    assert not structure_findings(source, "入口.md", load_rules(tmp_path))
    assert any(
        item.rule == "doc-fold"
        for item in structure_findings(
            "## 理解实现\n\n```md\n" + page() + "```", "入口.md", load_rules(tmp_path)
        )
    )


def test_developer_details_and_hidden_titles(tmp_path: Path) -> None:
    """明确开发者章节不能裸露，折叠内标题不能伪装成可见章节。"""
    rules = load_rules(tmp_path)
    source = page().replace("## 使用", "## 理解实现")
    assert any(item.rule == "doc-fold" for item in structure_findings(source, "入口.md", rules))
    hidden = page().replace("无。", "## 隐藏标题\n\n无。")
    assert any("标题" in item.message for item in structure_findings(hidden, "入口.md", rules))


@pytest.mark.parametrize("separator", ["", "---", "***", "-----"])
@pytest.mark.parametrize("after_anchor", [False, True])
def test_separators_are_optional(tmp_path: Path, separator: str, after_anchor: bool) -> None:
    """分隔线可省略或使用不同样式，锚点前后位置不构成结构阻断。"""
    anchor = '<a id="使用"></a>'
    boundary = f"{anchor}\n\n{separator}" if after_anchor else f"{separator}\n\n{anchor}"
    source = f"# 页面\n\n## 摘要\n\n概述。\n\n{boundary}\n\n## 使用\n\n步骤。"
    assert not structure_findings(source, "入口.md", load_rules(tmp_path))


@pytest.mark.parametrize("level", [2, 3, 4])
def test_existing_notes_have_no_fixed_count_or_position(tmp_path: Path, level: int) -> None:
    """可选笔记不限制数量、层级及末尾位置，但每段正文继续完整折叠。"""
    note = (
        "#" * level
        + " 开发笔记\n\n<details>\n<summary>展开</summary>\n\n工作假设。\n\n</details>\n\n"
    )
    source = "# 页面\n\n## 使用\n\n步骤。\n\n" + note + note + "## 参考\n\n说明。"
    assert not structure_findings(source, "入口.md", load_rules(tmp_path))
    broken = source.replace("<details>", "", 1)
    assert any(
        item.rule == "doc-fold"
        for item in structure_findings(broken, "入口.md", load_rules(tmp_path))
    )


def test_runtime_readme_and_metadata(tmp_path: Path) -> None:
    """真实包模板通过，重复或多值 kind 不能被当作有效分类。"""
    rules = load_rules(tmp_path)
    valid = page("package-library")
    assert not readme(valid, "README.md", rules)
    assert any(
        item.rule == "readme-kind"
        for item in readme(
            valid.replace("kind: package-library", "kind: [package-library]"), "README.md", rules
        )
    )
    assert any(
        item.rule == "readme-metadata"
        for item in readme(
            valid.replace(
                "kind: package-library", "kind: package-library\nkind: package-reference"
            ),
            "README.md",
            rules,
        )
    )


def test_readme_limitations_toc_and_order(tmp_path: Path) -> None:
    """空限制、不可点击目录及颠倒的前置章节都必须失败。"""
    rules = load_rules(tmp_path)
    source = page("package-library").replace("无已知限制。", "").replace("[正文](#使用)", "正文")
    assert {"readme-content", "readme-toc"} <= {
        item.rule for item in readme(source, "README.md", rules)
    }
    source = (
        page("package-library")
        .replace("## 摘要", "## 临时")
        .replace("## 目录", "## 摘要")
        .replace("## 临时", "## 目录")
    )
    assert any(item.rule == "readme-order" for item in readme(source, "README.md", rules))


def test_model_scope_is_explicit(tmp_path: Path) -> None:
    """只有明确登记的模型包才强制模型体验，普通包不承担该章节。"""
    rules = replace(load_rules(tmp_path), model_readmes=("model/README.md",))
    assert not readme(page("package-library"), "other/README.md", rules)
    assert any(
        item.rule == "readme-model"
        for item in readme(page("package-library"), "model/README.md", rules)
    )


def test_group_template_has_no_runtime_sections(tmp_path: Path) -> None:
    """包组采用独立模板，可有开发笔记，不强加模型与限制。"""
    source = "---\ndescription: 包组导览\nkind: package-group\n---\n" + page().replace(
        "## 使用", "## 包"
    ).replace("## 开发笔记", "## 相关文档\n\n[文档](#包)\n\n-----\n\n## 开发笔记")
    assert not readme(source, "README.md", load_rules(tmp_path))


def test_collectors_do_not_duplicate_readme_checks(tmp_path: Path) -> None:
    """包清单决定 README 归属，普通文档检查不重复报告包问题。"""
    write(tmp_path, "module/pyproject.toml", "")
    write(tmp_path, "module/README.md", page("package-library"))
    write(tmp_path, "docs/说明.md", page())
    write(tmp_path, "docs/AGENTS.md", "# 目录规则")
    assert readmes(tmp_path, []) == (1, [])
    assert structures(tmp_path, []) == (1, [])


def test_policy_encoding_relative_links_and_product_names(tmp_path: Path) -> None:
    """禁用项不能用编码绕过；普通产品前缀不应被误判为旧技能。"""
    rules = replace(
        load_rules(tmp_path),
        forbidden_terms=("obsolete",),
        forbidden_skill_prefixes=("retired-",),
        forbidden_skill_names=("retired-explicit",),
        forbidden_reference_dirs=("history/",),
    )
    path = tmp_path / "docs/入口.md"
    source = "obso&#108;ete\n`retired-runtime`\n`retired-doc`\n[旧记录](../history/记录.md)\n`retired-explicit`"
    findings = policy(tmp_path, path, source, rules, {"doc"})
    assert {item.rule for item in findings} == {
        "doc-policy-term",
        "doc-policy-skill",
        "doc-policy-reference",
    }
    assert not any(item.line == 2 for item in findings)
    assert any(item.line == 5 and item.rule == "doc-policy-skill" for item in findings)


def test_project_policy_keeps_reference_checks_without_name_blacklists(tmp_path: Path) -> None:
    """项目停用名称黑名单后，普通文本不拦截，历史目录引用仍产生阻断诊断。"""
    rules = load_rules(DEFAULT_ROOT)
    assert not rules.forbidden_terms
    assert not rules.forbidden_skill_prefixes
    assert not rules.forbidden_skill_names
    path = tmp_path / "docs/入口.md"
    assert policy(tmp_path, path, "obsolete retired-doc retired-explicit", rules, {"doc"}) == []
    source = "[旧记录](../" + rules.forbidden_reference_dirs[0] + "记录.md)"
    findings = policy(tmp_path, path, source, rules, set())
    assert {item.rule for item in findings} == {"doc-policy-reference"}


@pytest.mark.parametrize("filename", ["需求卡总览.md", "G01-T01-检查.md", "20260928-01-计划.md"])
def test_policy_allows_requirement_source_sections(tmp_path: Path, filename: str) -> None:
    """总览、子卡和单文档的来源字段可直接引用已实现记录的有效章节。"""
    write(
        tmp_path,
        ".agents/notes/implemented/process/2026-09-28-source.md",
        "# 决策记录：需求\n\n状态：已实现\n\n## 已确认需求与来源\n\n需求正文。\n",
    )
    path = tmp_path / "docs/需求卡/20260928-01-检查" / filename
    url = "../../../.agents/notes/implemented/process/2026-09-28-source.md#已确认需求与来源"
    source = f"需求来源：[需求记录]({url})，适用需求版本 v1.0。\n"
    assert policy(tmp_path, path, source, load_rules(DEFAULT_ROOT), set()) == []


@pytest.mark.parametrize(
    "relative,template,target,fragment",
    [
        ("docs/普通文档.md", "需求来源：[来源]({url})", "valid", "已确认需求与来源"),
        ("docs/需求卡/README.md", "需求来源：[来源]({url})", "valid", "已确认需求与来源"),
        ("docs/需求卡/计划.md", "参考资料：[来源]({url})", "valid", "已确认需求与来源"),
        ("docs/需求卡/计划.md", "需求来源：[来源]({url})", "missing", "已确认需求与来源"),
        ("docs/需求卡/计划.md", "需求来源：[来源]({url})", "valid", "不存在"),
        ("docs/需求卡/计划.md", "需求来源：[来源]({url})", "valid", ""),
        ("docs/需求卡/计划.md", "需求来源：[来源]({url})", "rejected", "已确认需求与来源"),
        ("docs/需求卡/计划.md", "```md\n需求来源：[来源]({url})\n```", "valid", "已确认需求与来源"),
        ("docs/需求卡/计划.md", "`需求来源：[来源]({url})`", "valid", "已确认需求与来源"),
        ("docs/需求卡/计划.md", "> 需求来源：[来源]({url})", "valid", "已确认需求与来源"),
        ("docs/需求卡/计划.md", "# 需求来源：[来源]({url})", "valid", "已确认需求与来源"),
        ("docs/需求卡/计划.md", "需求来源：![来源]({url})", "valid", "已确认需求与来源"),
        (
            "docs/需求卡/计划.md",
            "需求来源：[来源]({url})\n续行：[资料]({url})",
            "valid",
            "已确认需求与来源",
        ),
    ],
)
def test_policy_rejects_invalid_requirement_sources(
    tmp_path: Path, relative: str, template: str, target: str, fragment: str
) -> None:
    """来源例外不覆盖普通文档、其他字段、示例语法及无效目标或章节。"""
    note = ".agents/notes/implemented/process/2026-09-28-source.md"
    if target != "missing":
        status = "已拒绝" if target == "rejected" else "已实现"
        write(tmp_path, note, f"# 决策记录：需求\n\n状态：{status}\n\n## 已确认需求与来源\n")
    depth = len(Path(relative).parent.parts)
    url = "../" * depth + note + ("#" + fragment if fragment else "")
    findings = policy(
        tmp_path, tmp_path / relative, template.format(url=url), load_rules(DEFAULT_ROOT), set()
    )
    assert {item.rule for item in findings} == {"doc-policy-reference"}


def test_policy_requirement_source_does_not_hide_other_references(tmp_path: Path) -> None:
    """合法来源不能掩盖同一行附加的禁用路径、失效链接或其他段落的引用。"""
    note = ".agents/notes/implemented/process/2026-09-28-source.md"
    write(tmp_path, note, "# 决策记录：需求\n\n状态：已实现\n\n## 来源\n")
    url = "../../" + note + "#来源"
    path = tmp_path / "docs/需求卡/计划.md"
    rules = load_rules(DEFAULT_ROOT)
    for suffix in (f"，另见 {note}", f"，[失效]({url}失效)", f"\n\n参考：[记录]({url})"):
        findings = policy(tmp_path, path, f"需求来源：[记录]({url}){suffix}", rules, set())
        assert {item.rule for item in findings} == {"doc-policy-reference"}


def test_configuration_matches_its_own_declared_schema() -> None:
    """真实规则文件必须通过加载器，以防新增字段忘记接入类型校验。"""
    assert "package-group" in load_rules(DEFAULT_ROOT).readme_sections


def test_commands_and_named_placeholders_are_not_paths(tmp_path: Path) -> None:
    """带选项的命令及明确样例分段不能误报成仓库文件。"""
    write(
        tmp_path, "入口.md", "`scripts/check.py --group docs` `scripts/相对路径` `docs/文件名.md`"
    )
    assert not references(tmp_path, ["入口.md"])[1]


@pytest.mark.parametrize("source", [page().replace("</summary>", ""), page().replace("无。", "")])
def test_empty_note_and_unclosed_summary_fail(tmp_path: Path, source: str) -> None:
    """空折叠不满足开发笔记，未闭合摘要也不能视为有效 HTML 结构。"""
    assert structure_findings(source, "入口.md", load_rules(tmp_path))


def test_hidden_limitations_do_not_satisfy_readme(tmp_path: Path) -> None:
    """面向使用者的限制不能只存在于折叠内容中。"""
    source = page("package-library").replace(
        "无已知限制。", "<details>\n<summary>限制</summary>\n\n有资源上限。\n\n</details>"
    )
    assert any(
        item.rule == "readme-content" for item in readme(source, "README.md", load_rules(tmp_path))
    )


def test_notes_keep_links_but_not_forbidden_terms(tmp_path: Path) -> None:
    """活动笔记可互相引用，禁用标识规则仍保持独立。"""
    rules = replace(load_rules(tmp_path), forbidden_terms=("obsolete",))
    source = "[记录](./旧记录.md)\nobsolete"
    findings = policy(
        tmp_path, tmp_path / ".agents/notes/implemented/process/记录.md", source, rules, set()
    )
    assert [item.rule for item in findings] == ["doc-policy-term"]


def test_scope_excludes_vendor_and_does_not_write(tmp_path: Path) -> None:
    """运行检查不会重写正文，固定 vendor 排除不受显式范围覆盖。"""
    path = write(tmp_path, "入口.md", page())
    write(tmp_path, "vendor/错误.md", "# 缺少笔记")
    original = path.read_bytes()
    assert structures(tmp_path, []) == (1, [])
    assert path.read_bytes() == original
    with pytest.raises(CheckError):
        structures(tmp_path, ["vendor"])


def test_readme_quoted_headings_and_fenced_note_are_examples(tmp_path: Path) -> None:
    """块引用标题不能截断摘要，围栏里的开发笔记不能截断真实限制说明。"""
    source = page("package-library").replace("概述。", "> ## 引用示例\n\n真实摘要。")
    source = source.replace("无已知限制。", "```md\n### 开发笔记\n```\n\n无已知限制。")
    assert not readme(source, "README.md", load_rules(tmp_path))


@pytest.mark.parametrize("kind", tuple(load_rules(DEFAULT_ROOT).readme_sections))
def test_all_readme_templates_allow_omitting_notes(kind: str) -> None:
    """七类模板省略笔记及分隔线后仍通过，必需元数据和业务章节保持不变。"""
    source = (DEFAULT_ROOT / ".agents/skills/weetion-doc/templates" / f"{kind}.md").read_text(
        encoding="utf-8"
    )
    # 模板说明在围栏外，只提取可复制的页面骨架。
    tokens, _ = tokenize_markdown(source)
    metadata = next(
        token.content for token in tokens if token.type == "fence" and "kind:" in token.content
    )
    body = next(
        (token.content for token in tokens if token.type == "fence" and token.info == "markdown"),
        None,
    )
    if body is None:
        body = "# 历史记录\n\n" + "\n\n".join(
            f"## {title}\n\n[记录](#历史记录)" if title == "目录" else f"## {title}\n\n已核实说明。"
            for title in load_rules(DEFAULT_ROOT).readme_sections[kind]
        )
    example = metadata + body
    example = example.split('<a id="dev-note"></a>')[0].replace("-----\n", "")
    assert not readme(example, "README.md", load_rules(DEFAULT_ROOT))


@pytest.mark.parametrize("level", [2, 3, 4])
def test_runtime_notes_can_precede_or_follow_limitations(tmp_path: Path, level: int) -> None:
    """运行时 README 的笔记可在限制前后，不能代替必需的可见限制内容。"""
    source = page("package-library")
    base, body = source.split("### 开发笔记", 1)
    note = "#" * level + " 开发笔记" + body
    for candidate in (
        base + note,
        base.replace("## 已知限制与暂缓工作", note + "\n## 已知限制与暂缓工作"),
    ):
        assert not readme(candidate, "README.md", load_rules(tmp_path))
    assert any(
        item.rule == "readme-content"
        for item in readme(
            (base + note).replace("无已知限制。", ""), "README.md", load_rules(tmp_path)
        )
    )


def test_visible_limitations_after_optional_note_still_count(tmp_path: Path) -> None:
    """限制章节中的笔记不截断后续可见说明，单独的标题不构成限制正文。"""
    source = (
        page("package-library").replace("无已知限制。", "") + "\n### 容量边界\n\n最多处理一批。\n"
    )
    assert not readme(source, "README.md", load_rules(tmp_path))
    assert any(
        item.rule == "readme-content"
        for item in readme(source.replace("最多处理一批。", ""), "README.md", load_rules(tmp_path))
    )
