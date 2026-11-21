"""验证文档、技能和笔记检查的中文、结构与失败边界。

测试只使用独立临时文件，笔记目录结构采用虚拟路径，不创建项目隐藏目录。
@author 李杰
"""

import inspect
from pathlib import Path

import pytest
from scripts.common.quality_common import CheckError, discover
from scripts.docs import agent_note_support, verify_agent_note_format
from scripts.docs.markdown_support import parse
from scripts.docs.verify_doc_refs import collect as refs
from scripts.docs.verify_md_links import collect as links
from scripts.docs.verify_md_links import decode_path
from scripts.skills.record_skill_evidence import build_report
from scripts.skills.verify_skill_metadata import VERIFICATION_GATES, frontmatter, validate
from scripts.skills.verify_skill_metadata import collect as skills


def write(root: Path, path: str, text: str) -> Path:
    """在测试私有目录写 UTF-8 样例，返回可用于断言的路径。"""
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    return target


CI_WORKFLOW_FIXTURE = (
    "name: CI\n"
    "on:\n"
    "  push:\n"
    "    branches: [main]\n"
    "jobs:\n"
    "  backend:\n"
    "    steps:\n"
    "      - id: maven_verify\n"
    "        name: Maven quality-gate verify\n"
    "        run: mvn -B -ntp -Pquality-gate verify\n"
    "  frontend:\n"
    "    steps:\n"
    "      - id: frontend_gates\n"
    "        name: Shared frontend quality, test, build and security gates\n"
    "        run: pnpm run quality:gates\n"
    "      - id: browser_e2e\n"
    "        name: Browser E2E step renamed by the follow-up\n"
    "        run: pnpm run test:e2e:ci\n"
    "  docs-comments:\n"
    "    steps:\n"
    "      - id: docs_checks\n"
    "      - id: changed_comments\n"
    "  acceptance:\n"
    "    steps:\n"
    "      - id: slice_plan\n"
)


def seed_repository(root: Path, workflow: str = CI_WORKFLOW_FIXTURE) -> None:
    """创建可供验证入口检查的合成仓库目录。"""
    for gate in VERIFICATION_GATES.values():
        if gate.script is not None:
            write(root, gate.script, "# synthetic entrypoint fixture\n")
    write(root, ".github/workflows/ci.yml", workflow)


def skill_source(name: str, *fields: str) -> str:
    """构造含必需字段与待验声明的合成技能内容。"""
    extra = "".join(f"{field}\n" for field in fields)
    return f"---\nname: {name}\ndescription: synthetic fixture\n{extra}---\n"


def skill_messages(root: Path, folder: Path) -> list[str]:
    """核对临时技能定义并收集其元数据诊断。"""
    return [item.message for item in validate(folder / "SKILL.md", folder / "agents/openai.yaml", root)]


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


def test_markdown_rejects_empty_targets_and_bare_hash_anchors(tmp_path: Path) -> None:
    """空链接、空图片地址与空锚点占位符必须报告失败，不得回退为当前文件存在。"""
    write(tmp_path, "docs/目标.md", "# 标题\n")
    write(
        tmp_path,
        "docs/入口.md",
        "[空链接]()\n\n![空图片](   )\n\n[本页空锚点](#)\n\n[跨页空锚点](目标.md#)\n",
    )
    _, findings = links(tmp_path, ["docs/入口.md"])
    assert [item.line for item in findings] == [1, 3, 5, 7]
    assert "不能为空" in findings[0].message
    assert "不能为空" in findings[1].message
    assert "锚点不能为空" in findings[2].message
    assert "锚点不能为空" in findings[3].message


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
        """记录发现实现直接发起的祖先判断次数，并调用原方法保持真实语义。"""
        nonlocal calls
        frame = inspect.currentframe()
        caller = frame.f_back if frame is not None else None
        # Python 3.12 的 Path.relative_to 会内部调用 is_relative_to；3.13 已改为内联判断。
        # 3.12 调用方是 pathlib.py，3.13 是 pathlib/ 包内模块。只统计项目代码中的显式边界校验。
        source = "" if caller is None else caller.f_code.co_filename.replace("\\", "/")
        if caller is None or not (source.endswith("/pathlib.py") or "/pathlib/" in source):
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


def test_skill_lifecycle_and_verification_metadata(tmp_path: Path) -> None:
    """技能生命周期状态、替代、退役与行为验收元数据按契约通过或阻断。"""
    seed_repository(tmp_path)
    write(
        tmp_path,
        "new-skill/SKILL.md",
        (
            "---\n"
            "name: new-skill\n"
            "description: 新技能\n"
            "status: active\n"
            "supersedes:\n"
            "  - legacy-skill\n"
            "verification:\n"
            "  - python -B -X utf8 scripts/workflow/run_checks.py --group docs\n"
            "---\n"
        ),
    )
    assert not validate(tmp_path / "new-skill/SKILL.md", tmp_path / "new-skill/agents/openai.yaml", tmp_path)

    valid_retired = write(
        tmp_path,
        "legacy-skill/SKILL.md",
        (
            "---\n"
            "name: legacy-skill\n"
            "description: 已退役旧技能\n"
            "status: retired\n"
            "disable-model-invocation: true\n"
            "replaced-by: new-skill\n"
            "---\n"
        ),
    )
    assert not validate(valid_retired, tmp_path / "legacy-skill/agents/openai.yaml", tmp_path)

    bad_deprecated = write(
        tmp_path,
        "old-missing/SKILL.md",
        "---\nname: old-missing\ndescription: 缺替代说明\nstatus: deprecated\n---\n",
    )
    assert any("replaced-by" in item.message for item in validate(bad_deprecated, tmp_path / "absent.yaml", tmp_path))

    bad_retired = write(
        tmp_path,
        "retired-auto/SKILL.md",
        (
            "---\n"
            "name: retired-auto\n"
            "description: 退役但仍允许模型隐式调用\n"
            "status: retired\n"
            "retirement-reason: 功能已合入主流程\n"
            "replaced-by: missing-skill\n"
            "verification: []\n"
            "---\n"
        ),
    )
    messages = [item.message for item in validate(bad_retired, tmp_path / "absent.yaml", tmp_path)]
    assert any("disable-model-invocation" in msg for msg in messages)
    assert any("不存在的技能" in msg for msg in messages)
    assert any("verification" in msg for msg in messages)


def test_skill_verification_allowlist_and_entrypoints(tmp_path: Path) -> None:
    """验证技能声明只能引用允许且存在的执行入口。"""
    seed_repository(tmp_path)
    folder = tmp_path / "demo"
    write(tmp_path, "demo/SKILL.md", skill_source("demo", "verification:", "  - python -B -X utf8 -m pytest scripts/tests"))
    assert any("not allowlisted" in msg for msg in skill_messages(tmp_path, folder))

    write(
        tmp_path,
        "demo/SKILL.md",
        skill_source(
            "demo",
            "verification:",
            '  - "mvn -B -ntp -Pquality-gate verify"',
            '  - "pnpm run quality:gates"',
            '  - "pnpm run test:e2e:ci"',
            '  - "python -B -X utf8 scripts/workflow/verify_slice.py --base main --plan"',
        ),
    )
    # Every gate, including file-based verify_slice, resolves through its stable CI step id.
    assert not skill_messages(tmp_path, folder)

    (tmp_path / "scripts/workflow/verify_slice.py").unlink()
    assert any("scripts/workflow/verify_slice.py" in msg for msg in skill_messages(tmp_path, folder))

    seed_repository(tmp_path, CI_WORKFLOW_FIXTURE.replace("run: mvn -B -ntp -Pquality-gate verify", "run: mvn -B verify"))
    assert any("does not run" in msg and "backend/maven_verify" in msg for msg in skill_messages(tmp_path, folder))

    # The same stable id survives a display-name change; a missing id fails the gate.
    seed_repository(tmp_path, CI_WORKFLOW_FIXTURE.replace("name: Shared frontend", "name: Renamed frontend"))
    assert not skill_messages(tmp_path, folder)
    seed_repository(tmp_path, CI_WORKFLOW_FIXTURE.replace("id: frontend_gates", "id: renamed_gates"))
    assert any("frontend/frontend_gates not found" in msg for msg in skill_messages(tmp_path, folder))
    seed_repository(tmp_path, CI_WORKFLOW_FIXTURE.replace("id: slice_plan", "name: Slice plan"))
    assert any("acceptance/slice_plan not found" in msg for msg in skill_messages(tmp_path, folder))

    (tmp_path / ".github/workflows/ci.yml").unlink()
    assert any(".github/workflows/ci.yml is missing" in msg for msg in skill_messages(tmp_path, folder))


def test_skill_replacement_tracks_rename_delete_and_retire(tmp_path: Path) -> None:
    """验证更名、删除或退役后失效的替代关系会阻断。"""
    base = tmp_path / ".agents/skills"
    legacy = base / "legacy"
    retired = ("status: retired", "disable-model-invocation: true")
    write(base, "legacy/SKILL.md", skill_source("legacy", *retired, "replaced-by: current"))
    write(base, "current/SKILL.md", skill_source("current", "supersedes: [legacy]"))
    write(base, "unrelated/SKILL.md", skill_source("unrelated"))
    assert skills(tmp_path, []) == (3, [])

    write(base, "current/SKILL.md", skill_source("current", *retired, "retirement-reason: retired too", "supersedes: [legacy]"))
    # A path subset still re-checks lifecycle-linked skills, so the retired target is caught.
    count, findings = skills(tmp_path, [".agents/skills/unrelated"])
    assert count == 3
    assert any("current must be active" in item.message for item in findings)

    (base / "current").rename(base / "renamed")
    write(base, "renamed/SKILL.md", skill_source("renamed", "supersedes: [legacy]"))
    assert any("replaced-by" in msg and "current" in msg for msg in skill_messages(tmp_path, legacy))
    assert any("replaced by current, not renamed" in msg for msg in skill_messages(tmp_path, base / "renamed"))

    write(base, "current/SKILL.md", skill_source("other", "supersedes: [legacy]"))
    assert any("declares another name" in msg for msg in skill_messages(tmp_path, legacy))

    (base / "current/SKILL.md").unlink()
    assert any("replaced-by" in msg and "current" in msg for msg in skill_messages(tmp_path, legacy))


def test_skill_supersedes_reciprocity_terminal_and_cycles(tmp_path: Path) -> None:
    """验证替代关系互相对应，且禁止终止退役和循环引用。"""
    retired = ("status: retired", "disable-model-invocation: true")
    write(
        tmp_path,
        "successor/SKILL.md",
        skill_source("successor", "supersedes: [still-active, terminal, elsewhere, long-gone]"),
    )
    write(tmp_path, "still-active/SKILL.md", skill_source("still-active"))
    write(tmp_path, "terminal/SKILL.md", skill_source("terminal", *retired, "retirement-reason: no successor planned"))
    write(tmp_path, "elsewhere/SKILL.md", skill_source("elsewhere", *retired, "replaced-by: other-target"))
    write(tmp_path, "other-target/SKILL.md", skill_source("other-target", "supersedes: [elsewhere]"))
    found = skill_messages(tmp_path, tmp_path / "successor")
    assert len(found) == 3
    assert any("still-active" in msg and "neither deprecated nor retired" in msg for msg in found)
    assert any("terminal" in msg and "no successor" in msg for msg in found)
    assert any("replaced by other-target, not successor" in msg for msg in found)
    # Decision: a terminal retirement (retirement-reason without replaced-by) is valid on its own.
    assert not skill_messages(tmp_path, tmp_path / "terminal")

    write(tmp_path, "one-way/SKILL.md", skill_source("one-way", *retired, "replaced-by: other-target"))
    assert any("must list one-way in supersedes" in msg for msg in skill_messages(tmp_path, tmp_path / "one-way"))

    write(tmp_path, "loop-a/SKILL.md", skill_source("loop-a", "status: deprecated", "replaced-by: loop-b", "supersedes: [loop-b]"))
    write(tmp_path, "loop-b/SKILL.md", skill_source("loop-b", "status: deprecated", "replaced-by: loop-a", "supersedes: [loop-a]"))
    assert any("lifecycle cycle" in msg for msg in skill_messages(tmp_path, tmp_path / "loop-a"))

    write(tmp_path, "bad-ref/SKILL.md", skill_source("bad-ref", "supersedes: [Bad_Name]"))
    assert skill_messages(tmp_path, tmp_path / "bad-ref")
    write(tmp_path, "bad-active/SKILL.md", skill_source("bad-active", "replaced-by: other-target"))
    assert any("active skills must not declare" in msg for msg in skill_messages(tmp_path, tmp_path / "bad-active"))


def test_skill_evidence_report_from_ci_outcomes(tmp_path: Path) -> None:
    """验证技能行为状态来自绑定受验版本的 CI 步骤证据。"""
    seed_repository(tmp_path)
    base = tmp_path / ".agents/skills"
    docs = '  - "python -B -X utf8 scripts/workflow/run_checks.py --group docs"'
    slice_plan = '  - "python -B -X utf8 scripts/workflow/verify_slice.py --base main --plan"'
    write(base, "tasks/SKILL.md", skill_source("tasks", "verification:", docs, slice_plan))
    write(base, "java/SKILL.md", skill_source("java", "verification:", '  - "mvn -B -ntp -Pquality-gate verify"'))
    write(base, "plain/SKILL.md", skill_source("plain"))
    head = "a" * 40
    envelope = {"tested_sha": head, "run_id": "101", "run_attempt": "1"}
    run = {"sha": head, "run_id": "101", "run_attempt": "1"}
    outcomes = {
        **envelope,
        "steps": {
            "docs-comments/docs_checks": {"outcome": "success", **run},
            "acceptance/slice_plan": {"outcome": "success", **run},
            "backend/maven_verify": {"outcome": "failure", **run},
        },
    }
    report = build_report(tmp_path, outcomes)
    by_skill = {item["skill"]: item for item in report["skills"]}
    assert [item["status"] for item in by_skill["tasks"]["behaviors"]] == ["passed", "passed"]
    assert by_skill["tasks"]["behaviors"][1]["gate"] == "acceptance/slice_plan"
    assert by_skill["java"]["result"] == "failed"
    assert by_skill["plain"]["result"] == "undeclared"
    assert report["result"] == "failed"
    assert (report["tested_sha"], report["run_id"], report["run_attempt"]) == (head, "101", "1")

    del outcomes["steps"]["docs-comments/docs_checks"]
    outcomes["steps"]["acceptance/slice_plan"]["sha"] = "b" * 40
    tasks = next(item for item in build_report(tmp_path, outcomes)["skills"] if item["skill"] == "tasks")
    assert [item["status"] for item in tasks["behaviors"]] == ["missing", "stale"]
    # A successful non-slice gate from another attempt, or lacking run identity, is stale.
    outcomes["steps"]["backend/maven_verify"] = {"outcome": "success", **run, "run_attempt": "2"}
    outcomes["steps"]["docs-comments/docs_checks"] = {"outcome": "success", "sha": head}
    by_skill = {item["skill"]: item for item in build_report(tmp_path, outcomes)["skills"]}
    assert by_skill["java"]["behaviors"][0]["status"] == "stale"
    assert by_skill["tasks"]["behaviors"][0]["status"] == "stale"

    with pytest.raises(CheckError):
        build_report(tmp_path, {**envelope, "steps": {"backend/unknown_step": {"outcome": "success"}}})
    with pytest.raises(CheckError):
        build_report(tmp_path, {**envelope, "steps": {"backend/maven_verify": {"outcome": "green"}}})
    with pytest.raises(CheckError):
        build_report(tmp_path, {"tested_sha": head, "run_attempt": "1", "steps": {}})
    write(base, "plain/SKILL.md", skill_source("plain", "verification:", "  - echo unapproved"))
    with pytest.raises(CheckError):
        build_report(tmp_path, {**envelope, "steps": {}})


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
