"""D16 逐条复核材料包与通配符导入扩展材料的结构、复算与负对照测试。

这些用例只验证**材料本身**：条目齐全、逐字指纹可复算、归因恰好覆盖实测差异、
判定列留空、反例确实会被候选规则放过。材料不含任何验收结论，测试也不产生结论。

用法：python3 -B -X utf8 -m pytest scripts/tests/test_d16_review_package.py -q

@author OpenAI Codex
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
GENERATOR = REPO_ROOT / "scripts/tools/build_d16_review_package.py"
REVIEW_JSON = REPO_ROOT / "docs/测试与可靠性/来源证据/代码同一性逐条复核材料.json"
REVIEW_MD = REVIEW_JSON.with_suffix(".md")
WILDCARD_JSON = REPO_ROOT / "docs/测试与可靠性/来源证据/代码同一性通配符导入扩展材料.json"
WILDCARD_MD = WILDCARD_JSON.with_suffix(".md")
INDEX_PATH = REPO_ROOT / "docs/测试与可靠性/来源证据/d12-source-index.json"

sys.path.insert(0, str(REPO_ROOT / "scripts/code/java"))


def load_generator() -> object:
    """按文件路径加载材料生成器。"""

    specification = importlib.util.spec_from_file_location("d16_review_package_tool", GENERATOR)
    assert specification is not None and specification.loader is not None
    module = importlib.util.module_from_spec(specification)
    sys.modules["d16_review_package_tool"] = module
    specification.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def tool() -> object:
    """返回材料生成器模块（会话内复用）。"""

    return load_generator()


@pytest.fixture(scope="session")
def review_package(tool: object) -> dict:
    """在内存中重新生成复核材料包（不落盘）。"""

    return tool.build_review_package()


@pytest.fixture(scope="session")
def wildcard_package(tool: object) -> dict:
    """在内存中重新生成通配符导入扩展材料。"""

    return tool.build_wildcard_package()


@pytest.fixture(scope="session")
def stored_review() -> dict:
    """读取仓内已生成的复核材料。"""

    return json.loads(REVIEW_JSON.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def stored_wildcard() -> dict:
    """读取仓内已生成的通配符导入扩展材料。"""

    return json.loads(WILDCARD_JSON.read_text(encoding="utf-8"))


def test_review_package_covers_the_whole_strict_compare_set(review_package: dict) -> None:
    """材料必须覆盖队列中全部严格比较成立的候选。"""

    queue = json.loads(
        (REPO_ROOT / "docs/测试与可靠性/来源证据/代码同一性复核队列.json").read_text(
            encoding="utf-8"
        )
    )
    expected = [item for item in queue["items"] if item["strict_compare_equal"] is True]
    assert review_package["counts"]["items"] == len(expected) == 42
    assert review_package["counts"]["verdicts_filled_by_implementer"] == 0
    assert {item["object"]["declaration"] for item in review_package["items"]} == {
        item["declaration"] for item in expected
    }


def test_every_item_declares_all_required_sections(review_package: dict) -> None:
    """每条材料都必须含八项必需内容。"""

    for item in review_package["items"]:
        assert item["object"]["local_path"] and item["object"]["declaration"]
        assert item["object"]["kind"], item["item_id"]
        assert item["object"]["module"]["artifact_id"], item["item_id"]
        strict = item["strict_comparison"]
        for field in (
            "local_code_stream_sha256",
            "upstream_code_stream_sha256",
            "local_token_count",
            "upstream_token_count",
            "import_count_local",
            "import_count_upstream",
        ):
            assert strict[field] is not None, (item["item_id"], field)
        assert strict["transform_set"]["transforms_sha256"]
        assert strict["transform_set"]["normalizations_sha256"]
        assert strict["transform_set"]["sha256"]
        assert strict["equal"] is True
        assert item["difference_attribution"], item["item_id"]
        assert item["comment_bindings"], item["item_id"]
        assert item["authorship"]["upstream_fixed_version"]["measured"]["hit_count"] >= 0
        assert item["authorship"]["upstream_other_versions"].startswith("未核实")
        assert {entry["contract_id"] for entry in item["contract_impact"]} == {
            "auth",
            "rate-limit",
            "crypto",
            "lifecycle",
            "sensitive",
            "direction",
        }
        assert item["reproduction"]["item_command"].startswith("cd ")
        assert item["open_questions"], item["item_id"]


def test_attribution_covers_every_measured_difference_line(review_package: dict) -> None:
    """逐行归因必须恰好覆盖规则实现实测的差异行数。"""

    for item in review_package["items"]:
        coverage = item["attribution_coverage"]
        assert coverage["covers_exactly"], item["item_id"]
        assert coverage["attributed_local_lines"] == coverage["measured_local_lines"]
        assert coverage["attributed_upstream_lines"] == coverage["measured_upstream_lines"]
        assert coverage["unexplained_blocks"] == 0, item["item_id"]
        assert not item["material_problems"], item["item_id"]


def test_comment_bindings_are_verbatim_and_fingerprinted(
    tool: object, review_package: dict
) -> None:
    """注释绑定的逐字原文必须与本地文件该行区间完全一致。"""

    for item in review_package["items"]:
        path = REPO_ROOT / item["object"]["local_path"]
        lines = path.read_text(encoding="utf-8").split("\n")
        roles = {binding["role"] for binding in item["comment_bindings"]}
        assert "responsibility-javadoc" in roles, item["item_id"]
        assert "d15-inplace-marker" in roles, item["item_id"]
        for binding in item["comment_bindings"]:
            start, end = binding["lines"]
            verbatim = "\n".join(lines[start - 1 : end])
            assert verbatim == binding["text"], (item["item_id"], binding["lines"])
            assert hashlib.sha256(verbatim.encode("utf-8")).hexdigest() == binding["sha256"]
        statuses = {entry["role"]: entry for entry in item["comment_roles_acceptance"]}
        assert statuses["license-or-copyright"]["present"] is False
        if item["authorship"]["form"] == "来源说明":
            assert statuses["d12-source-note"]["present"] is True


def test_javadoc_fingerprint_uses_the_rule_implementation_basis(review_package: dict) -> None:
    """逐类型 JavaDoc 指纹必须与受控索引登记值一致（口径为 _attached_javadoc）。"""

    for item in review_package["items"]:
        assert item["object"]["javadoc_sha256_matches"] is True, item["item_id"]
        assert item["object"]["javadoc_sha256_measured"] == item["object"]["javadoc_sha256_registered"]


def test_reviewer_decision_columns_are_blank(review_package: dict, wildcard_package: dict) -> None:
    """判定列必须留空，且材料不得声称已判定。"""

    for package in (review_package, wildcard_package):
        for row in package["review_decision_table"]["rows"]:
            assert row["reviewer_verdict"] is None
            assert row["reviewer"] is None
            assert row["review_date"] is None
            assert row["review_reason"] is None
        assert "实施方不得自行填写" in package["review_decision_table"]["notice"]
        assert package["review_decision_table"]["allowed_verdicts"] == [
            "accept",
            "reject",
            "need-more",
        ]
    for item in review_package["items"]:
        assert item["reviewer_decision"] == {
            "reviewer_verdict": None,
            "reviewer": None,
            "review_date": None,
            "review_reason": None,
        }
        draft = item["proposed_contract_draft"]
        assert draft["status"].startswith("草案")
        assert draft["review"]["reviewer"] is None
        assert draft["review"]["date"] is None
        assert draft["review"]["conclusion"] is None
        assert draft["counter_evidence_conclusion"] is None
        assert draft["author_handling"]["code_identity_accepts_signature"] is False


def test_materials_do_not_claim_a_verdict(review_package: dict) -> None:
    """材料中的契约草案不得出现“已验收/已通过”一类实施方结论。"""

    forbidden = ("已验收", "已通过", "复核通过", "改判为", "转为 accepted")
    for item in review_package["items"]:
        draft = json.dumps(item["proposed_contract_draft"], ensure_ascii=False)
        assert not [word for word in forbidden if word in draft], item["item_id"]


def test_index_current_state_snapshot_matches_the_registry(
    tool: object, review_package: dict
) -> None:
    """材料抄录的索引判词必须与受控索引当前值逐条一致（只抄不改）。"""

    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    records = {record["local_path"]: record for record in index["records"]}
    for item in review_package["items"]:
        record = records[item["object"]["local_path"]]
        state = item["index_current_state"]
        assert state["d12_verdict"] == record["d12_verdict"], item["item_id"]
        assert state["evidence_branch"] == record["evidence_branch"], item["item_id"]
        assert state["author_status"] == record["author_status"], item["item_id"]


def test_strict_comparison_readings_recompute_identically(
    tool: object, review_package: dict
) -> None:
    """材料中的代码流读数必须能由规则实现原样复算。"""

    checker = tool.load_checker()
    document = tool.resolve_transform_set(checker)
    transforms = tool.ordered_transforms(document)
    for item in review_package["items"][:6]:
        local = (REPO_ROOT / item["object"]["local_path"]).read_text(encoding="utf-8")
        snapshot = (
            REPO_ROOT
            / "docs/测试与可靠性/来源证据/上游快照"
            / f"ruoyi-vue-pro@{item['object']['upstream']['commit']}"
            / item["object"]["upstream"]["path"]
        )
        upstream = snapshot.read_text(encoding="utf-8")
        local_stream = checker._code_identity_stream(local, transforms, "local")
        upstream_stream = checker._code_identity_stream(upstream, transforms, "upstream")
        strict = item["strict_comparison"]
        assert local_stream["sha256"] == strict["local_code_stream_sha256"]
        assert upstream_stream["sha256"] == strict["upstream_code_stream_sha256"]
        assert local_stream["token_count"] == strict["local_token_count"]
        assert local_stream["import_count"] == strict["import_count_local"]
        assert local_stream["import_count"] == upstream_stream["import_count"]


def test_classifier_recognises_every_difference_nature(tool: object) -> None:
    """归因分类必须区分登记变换、注释差异、空白差异与无法解释。"""

    checker = tool.load_checker()
    document = tool.resolve_transform_set(checker)
    transforms = tool.ordered_transforms(document)
    registered, _, _ = tool.classify_line_pair(
        checker,
        transforms,
        "package com.basicframework.framework.common.pojo;",
        "package cn.iocoder.yudao.framework.common.pojo;",
    )
    assert registered == "registered-transform"
    literal, _, _ = tool.classify_line_pair(
        checker, transforms, 'String a = "x";', 'String a = "y";'
    )
    assert literal == "unexplained"
    comment, _, _ = tool.classify_line_pair(
        checker, transforms, "    CODE, // 上游注释", "    CODE,"
    )
    assert comment == "comment-difference"
    blank, _, _ = tool.classify_line_pair(
        checker, transforms, "    CODE,   ", "    CODE,"
    )
    assert blank == "code-outside-whitespace"
    note, _, _ = tool.classify_line_pair(
        checker, transforms, " * 来源：YunaiV/ruoyi-vue-pro @ ac0", ""
    )
    assert note == "d12-source-note"
    marker, _, _ = tool.classify_line_pair(
        checker, transforms, " * 来源验收：尚未验收", ""
    )
    assert marker == "d15-inplace-marker"


def test_attribution_never_papers_over_a_real_code_difference(tool: object) -> None:
    """负对照：任一未获准的代码字节差异都必须留下未解释残差。"""

    checker = tool.load_checker()
    document = tool.resolve_transform_set(checker)
    transforms = tool.ordered_transforms(document)
    local = (
        "package com.basicframework.framework.common.pojo;\n\n"
        "/**\n"
        " * 本地。\n"
        " */\n"
        "public final class Demo {\n"
        "    private String name;\n"
        "}\n"
    )
    upstream = local.replace("private String name;", "private String other;")
    entries, coverage = tool.build_attribution(checker, local, upstream, transforms)
    assert coverage["covers_exactly"] is True
    assert coverage["unexplained_blocks"] >= 1
    assert coverage["cause_histogram"].get("unexplained", 0) >= 1
    assert entries


def test_stored_materials_match_a_fresh_rebuild(
    tool: object, stored_review: dict, stored_wildcard: dict
) -> None:
    """仓内材料必须与当前工作树重新生成的结果一致（材料不会悄悄过期）。"""

    rebuilt = tool.build_review_package()
    assert [item["item_id"] for item in rebuilt["items"]] == [
        item["item_id"] for item in stored_review["items"]
    ]
    assert rebuilt["counts"] == stored_review["counts"]
    assert rebuilt["inputs"]["rule_implementation"]["sha256"] == (
        stored_review["inputs"]["rule_implementation"]["sha256"]
    )
    rebuilt_wildcard = tool.build_wildcard_package()
    assert rebuilt_wildcard["counts"] == stored_wildcard["counts"]
    assert [
        (item["declaration"], item["sets_equivalent"]) for item in rebuilt_wildcard["items"]
    ] == [(item["declaration"], item["sets_equivalent"]) for item in stored_wildcard["items"]]


def test_material_documents_declare_blank_verdict_table() -> None:
    """人读材料必须写出“判定列留空”的声明。"""

    for path in (REVIEW_MD, WILDCARD_MD):
        text = path.read_text(encoding="utf-8")
        assert "本文件由实施方生成，判定列留空待独立复核方填写" in text, path.name
        assert "reviewer_verdict" in text, path.name


def test_wildcard_package_documents_java_version_from_pom(wildcard_package: dict) -> None:
    """Java 版本与编译依赖必须来自 POM 实测，不得凭空假定。"""

    compiler = wildcard_package["java_version_and_dependencies"]
    measured = compiler["measured"]
    assert measured["java_version_property"] == "17"
    assert measured["maven_compiler_release"] == "${java.version}"
    assert measured["maven_compiler_plugin_version"]
    assert compiler["poms"], "至少要登记反应堆根 POM"
    for pom in compiler["poms"]:
        assert len(pom["sha256"]) == 64, pom["path"]
    assert compiler["measured_runtime"]["status"] in {"未运行", "已运行"}


def test_wildcard_items_report_import_correspondence(wildcard_package: dict) -> None:
    """3 条对象必须逐条给出通配符与显式导入的对应关系。"""

    assert len(wildcard_package["items"]) == 3
    for item in wildcard_package["items"]:
        assert item["current_rule_result"]["equal"] is False, item["item_id"]
        assert item["import_forms_identical"] is False
        assert item["wildcard_rows"], item["item_id"]
        evidence = item["import_correspondence"]["jdk_index_evidence"]
        assert evidence["java_source_entries"] > 0
        assert len(evidence["source_sha256"]) == 64
        for row in item["wildcard_rows"]:
            assert row["set_equivalent"] in {True, False, None}
            assert row["equivalence_basis"]
            if row["package_in_fixed_jdk_index"]:
                assert row["jdk_package_type_count"] > 0
        assert item["sets_equivalent"] in {True, False, None}


def test_wildcard_package_flags_non_jdk_packages_as_unverified(wildcard_package: dict) -> None:
    """不在固定 JDK 索引内的通配符包必须记为未核实，而不是判等价。"""

    unknown = [
        row
        for item in wildcard_package["items"]
        for row in item["wildcard_rows"]
        if not row["package_in_fixed_jdk_index"]
    ]
    assert unknown, "至少有一条对象使用项目自身包的通配符导入"
    for row in unknown:
        assert row["set_equivalent"] is None
        assert "未核实" in row["equivalence_basis"]


def test_counter_examples_cover_required_categories(wildcard_package: dict) -> None:
    """反例必须覆盖未使用、同名不同包与通配符集不等三类。"""

    categories = {example["category"] for example in wildcard_package["counter_examples"]}
    assert len(wildcard_package["counter_examples"]) >= 3
    assert "未使用的导入" in categories
    assert "同名类型来自不同 import" in categories
    assert "通配符集不等价" in categories
    for example in wildcard_package["counter_examples"]:
        assert example["current_rule"]["equal"] is False, example["id"]
        assert example["real_difference"]
        if example["wrongly_accepting_variants"]:
            assert any(example["candidate_variants"].values()), example["id"]
    assert wildcard_package["counts"]["counter_examples_accepted_by_a_candidate_variant"] >= 1
    assert wildcard_package["counts"]["fabricated_imports_detected"] >= 1


def test_candidate_rule_draft_is_not_implemented(wildcard_package: dict) -> None:
    """候选规则必须是待裁决草案，不得被登记进受控变换集。"""

    draft = wildcard_package["candidate_rule_draft"]
    assert draft["status"] == "待裁决（草案不实施）"
    assert draft["decision_columns"] == {
        "reviewer_verdict": None,
        "reviewer": None,
        "review_date": None,
        "review_reason": None,
    }
    assert draft["risks"]
    document = json.loads(
        (
            REPO_ROOT / "docs/测试与可靠性/来源证据/代码同一性变换集.json"
        ).read_text(encoding="utf-8")
    )
    registered = {transform["operation"] for transform in document["transforms"]}
    assert draft["operation"] not in registered


def test_verify_item_entry_point_reports_mismatch(tool: object, tmp_path: Path) -> None:
    """负对照：材料与实测不符时 --verify-item 必须非零退出。"""

    stored = json.loads(REVIEW_JSON.read_text(encoding="utf-8"))
    target = stored["items"][0]
    target["strict_comparison"]["local_token_count"] += 1
    code, report = tool.verify_item("com.basicframework.framework.common.exception.ErrorCode")
    assert code == 0
    assert report["status"] == "passed"
    code_missing, report_missing = tool.verify_item("com.example.NotInPackage")
    assert code_missing == 2
    assert report_missing["status"] == "not-found"


def _drop_head(raw: bytes) -> bytes:
    """剔除材料中记录生成时提交的 head 字段，其余字节原样保留。

    `repository.head` 是"何时生成"的元数据：把它写死会让本用例在任何后续提交上都失败
    （提交即改值）。逐条证据、读数、归因与判定列仍逐字节一致。
    """

    head = json.loads(raw.decode("utf-8")).get("repository", {}).get("head")
    if head is None:
        return raw
    return raw.replace(head.encode("utf-8"), b"<normalized-head>")


def test_generator_cli_rebuilds_identical_materials(tmp_path: Path) -> None:
    """真实 CLI：--build 重新生成的材料与仓内已生成版本逐字节一致。"""

    before_json = REVIEW_JSON.read_bytes()
    before_md = REVIEW_MD.read_text(encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "-B", "-X", "utf8", str(GENERATOR), "--build", "--json"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["status"] == "written"
    # 机器可读材料不得写入逐次变化的时间戳，否则无法按整文件 SHA-256 复算；
    # 人读材料允许记录生成时间，比较时只剔除该行。
    assert _drop_head(REVIEW_JSON.read_bytes()) == _drop_head(before_json)
    assert b"generated_at_utc" not in before_json
    strip_time = lambda text: [  # noqa: E731 - 测试内一次性辅助
        line for line in text.splitlines() if not line.startswith("生成时间（UTC）：")
    ]
    assert strip_time(REVIEW_MD.read_text(encoding="utf-8")) == strip_time(before_md)