"""D17 成员级逐条复核材料包（108 条）的结构、复算与负对照测试。

这些用例只验证**材料本身**：候选集合可复现、A1／A2 分类与裁决 D17 登记的计数一致、
逐成员双侧指纹与判定列留空、差异归因恰好覆盖实测差异账、样板门槛确实由规则实现
给出、判定语义字段留空，以及材料不会悄悄过期。材料不含任何验收结论，测试也不
产生结论。

用法：python3 -B -X utf8 -m pytest scripts/tests/test_d17_member_review_package.py -q

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
GENERATOR = REPO_ROOT / "scripts/tools/build_d17_member_review_package.py"
EVIDENCE_DIR = REPO_ROOT / "docs/测试与可靠性/来源证据"
REVIEW_JSON = EVIDENCE_DIR / "成员同一性逐条复核材料.json"
REVIEW_MD = REVIEW_JSON.with_suffix(".md")
INDEX_PATH = EVIDENCE_DIR / "d12-source-index.json"
QUEUE_PATH = EVIDENCE_DIR / "代码同一性复核队列.json"
MANIFEST_PATH = EVIDENCE_DIR / "成员同一性成员清单.json"
SCHEMA_PATH = EVIDENCE_DIR / "成员同一性契约schema.json"

BLOCKING_VERDICTS = {
    "证据不足，保持原状并登记阻断",
    "复核回退，保持来源说明并登记阻断（尚未验收）",
    "需补证，尚未验收",
}


def load_generator() -> object:
    """按文件路径加载材料生成器。"""

    specification = importlib.util.spec_from_file_location("d17_member_review_package_tool", GENERATOR)
    assert specification is not None and specification.loader is not None
    module = importlib.util.module_from_spec(specification)
    sys.modules["d17_member_review_package_tool"] = module
    specification.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def tool() -> object:
    """返回材料生成器模块（会话内复用）。"""

    return load_generator()


@pytest.fixture(scope="session")
def package(tool: object) -> dict:
    """在内存中重新生成材料包（不落盘）。"""

    return tool.build_review_package()


@pytest.fixture(scope="session")
def stored() -> dict:
    """读取仓内已生成的材料包。"""

    return json.loads(REVIEW_JSON.read_text(encoding="utf-8"))


def expected_candidate_keys() -> set[tuple[str, str]]:
    """独立于生成器地复算「仍待来源验收且不在 D16 队列」的声明集合。"""

    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    queue = json.loads(QUEUE_PATH.read_text(encoding="utf-8"))
    excluded = {
        (str(item["local_path"]), str(item["declaration"]))
        for item in queue["items"]
    }
    keys: set[tuple[str, str]] = set()
    for record in index["records"]:
        if str(record["d12_verdict"]) not in BLOCKING_VERDICTS:
            continue
        type_evidence = json.loads(str(record.get("type_evidence") or "{}"))
        for entry in type_evidence.get("types") or []:
            key = (str(record["local_path"]), str(entry["qualified_name"]))
            if key not in excluded:
                keys.add(key)
    return keys


def test_candidate_set_is_derived_from_the_controlled_index(package: dict) -> None:
    """候选集合必须能由受控索引与 D16 队列机械复算，得到 117 条待复核声明。"""

    candidates = expected_candidate_keys()
    assert len(candidates) == 117
    assert package["scope"]["candidate_declarations"] == 117
    assert package["scope"]["excluded_b_class"] == 5
    assert package["scope"]["excluded_c_class"] == 4
    assert package["counts"]["items"] == 108
    assert package["scope"]["judgements_made"] == 0


def test_a_class_counts_match_the_ruling(package: dict) -> None:
    """A1／A2 的分类计数必须复现裁决 D17 登记的 107／1。"""

    assert package["counts"]["a1"] == 107
    assert package["counts"]["a2"] == 1
    assert package["counts"]["a1"] + package["counts"]["a2"] == package["counts"]["items"]
    for item in package["items"]:
        assert item["classification"]["a_class"] in {"A1", "A2"}, item["item_id"]
        if item["classification"]["a_class"] == "A1":
            assert (
                item["classification"]["content_equal_member_sha256"]
                or item["classification"]["header_equal"]
            ), item["item_id"]
        else:
            assert not item["classification"]["content_equal_member_sha256"], item["item_id"]
            assert not item["classification"]["header_equal"], item["item_id"]


def test_excluded_objects_are_listed_with_their_basis(package: dict) -> None:
    """B 类 5 条与 C 类 4 条必须连同排除依据一起列在包首页。"""

    excluded = package["excluded_objects"]
    assert excluded["b_class"]["count"] == 5
    assert excluded["c_class"]["count"] == 4
    assert len(excluded["b_class"]["objects"]) == 5
    assert len(excluded["c_class"]["objects"]) == 4
    for entry in excluded["b_class"]["objects"] + excluded["c_class"]["objects"]:
        assert entry["exclusion_basis"], entry["declaration"]
        assert entry["manifest_exclusion_basis"], entry["declaration"]
    paths = {
        str(entry["upstream_path"])
        for entry in excluded["b_class"]["objects"] + excluded["c_class"]["objects"]
    }
    assert len(paths) == 9, "B／C 两条必须是 9 个互不相同的上游对象"
    markdown = REVIEW_MD.read_text(encoding="utf-8")
    assert "排除在外的 B 类 5 条与 C 类 4 条" in markdown
    for entry in excluded["b_class"]["objects"] + excluded["c_class"]["objects"]:
        assert f"`{entry['declaration']}`" in markdown, entry["declaration"]
    assert "避免复核方误以为 108 条" in markdown or "避免误读" in package["excluded_objects"]["note"]


def test_excluded_objects_are_not_part_of_the_package(package: dict) -> None:
    """被排除的对象不得同时出现在 108 条 A 类材料里。"""

    excluded_paths = {
        str(entry["local_path"])
        for entry in package["excluded_objects"]["b_class"]["objects"]
        + package["excluded_objects"]["c_class"]["objects"]
    }
    selected = {item["object"]["local_path"] for item in package["items"]}
    assert not (excluded_paths & selected)


def test_manifest_upstream_paths_all_exist_in_the_controlled_index(package: dict) -> None:
    """受控清单的 B／C 条目上游路径必须逐条命中受控索引（否则排除实际不触发）。"""

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    upstream_paths = {str(record["upstream_path"]) for record in index["records"]}
    roster = list(manifest["branch_ineligible"]) + list(manifest["contract_conflicts"])
    assert len(roster) == 9
    mismatched = [
        str(item["upstream_path"]) for item in roster if str(item["upstream_path"]) not in upstream_paths
    ]
    assert mismatched == [], f"受控清单存在索引中不存在的上游路径：{mismatched}"
    # 若将来再次出现不一致，材料必须如实登记而不是静默按另一条口径排除。
    reported = package["excluded_objects"]["manifest_upstream_path_mismatch"]
    assert len(reported) == len(mismatched)
    for entry in package["excluded_objects"]["b_class"]["objects"]:
        assert entry["match_basis"] == "upstream_path", entry["declaration"]
    for entry in package["excluded_objects"]["c_class"]["objects"]:
        assert entry["match_basis"] == "upstream_path", entry["declaration"]


def test_branch_ineligible_exclusion_actually_fires(tool: object) -> None:
    """B 类排除必须由规则实现真实命中，而不是靠生成器自己的兜底匹配。"""

    checker = tool.load_checker()
    manifest, error = checker._load_member_identity_member_manifest(str(MANIFEST_PATH))
    assert error is None and manifest is not None
    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    records = {str(record["local_path"]): record for record in index["records"]}
    for entry in manifest["branch_ineligible"]:
        record = records[str(entry["local_path"])]
        assert checker._member_identity_ineligible_object(record, manifest), entry["local_path"]
    for entry in manifest["contract_conflicts"]:
        record = records[str(entry["local_path"])]
        assert checker._member_identity_boiler_c_object(record, manifest), entry["local_path"]


def test_every_item_declares_all_required_sections(package: dict) -> None:
    """每条材料都必须含 D17 §G8 要求的九项内容。"""

    for item in package["items"]:
        obj = item["object"]
        assert obj["local_path"] and obj["declaration"], item["item_id"]
        assert obj["kind"], item["item_id"]
        assert obj["module"]["artifact_id"] and obj["module"]["pom_sha256"], item["item_id"]
        assert obj["local_file_sha256"], item["item_id"]
        assert obj["upstream"]["sha256"] == obj["upstream"]["sha256_measured"], item["item_id"]
        assert obj["javadoc_lines"][0] and obj["javadoc_lines"][1], item["item_id"]
        member_identity = item["member_identity"]
        assert member_identity["branch"] == "E2-member-identity"
        assert member_identity["route"] == "路线 2"
        assert member_identity["rules_version"] == "d17-member-compare/v1"
        assert member_identity["transform_reuse"]["source_branch"] == "E1-code-identity"
        assert member_identity["transform_set"]["transforms_sha256"]
        assert member_identity["contract_schema"]["rules_sha256"]
        assert member_identity["member_manifest"]["rules_sha256"]
        assert member_identity["quantity_condition"]["reasons"] or member_identity[
            "quantity_condition"
        ]["entry"]
        for side in ("local", "upstream"):
            coverage = item["coverage_selfcheck"][side]
            assert coverage["code_stream_sha256"], item["item_id"]
            assert coverage["lexeme_count"] > 0, item["item_id"]
        assert item["difference_ledger"]["measured_differences"]
        assert item["difference_ledger"]["attribution"], item["item_id"]
        assert item["comment_bindings"], item["item_id"]
        assert {
            entry["role"] for entry in item["comment_roles_acceptance"]
        } == {
            "responsibility-javadoc",
            "d12-source-note",
            "d15-inplace-marker",
            "license-or-copyright",
        }
        authorship = item["authorship"]
        assert authorship["form"] in {"作者标签", "来源说明"}, item["item_id"]
        assert authorship["upstream_other_versions"].startswith("未核实")
        assert authorship["author_handling_draft"]["member_identity_accepts_signature"] is False
        assert authorship["author_handling_draft"]["history_gap"]
        assert {entry["contract_id"] for entry in item["contract_impact"]} == {
            "auth",
            "rate-limit",
            "lifecycle",
            "crypto",
            "sensitive",
            "direction",
        }
        for entry in item["contract_impact"]:
            if not entry["hit"]:
                assert "不等于" in entry["detail"] or "未越过" in entry["detail"], item["item_id"]
        assert item["reproduction"]["item_command"].startswith("cd ")
        assert item["open_questions"], item["item_id"]
        assert item["classification"]["rule"]


def test_every_equal_member_carries_both_sides_fingerprints(package: dict) -> None:
    """每个相等成员都必须登记双方 SHA-256、字节数、词素数、行号区间与变换发生点。"""

    for item in package["items"]:
        for member in item["member_identity"]["members"]:
            key = member["member_key"]
            assert "#" in key, key
            assert member["local_member_sha256"] == member["upstream_member_sha256"], key
            assert len(member["local_member_sha256"]) == 64
            assert member["local_member_bytes"] == member["upstream_member_bytes"], key
            assert (
                member["local_member_lexeme_count"] == member["upstream_member_lexeme_count"]
            ), key
            assert member["local_lines"][0] <= member["local_lines"][1], key
            assert member["upstream_lines"][0] <= member["upstream_lines"][1], key
            assert member["member_sha256_equal"] is True, key
            assert member["raw_slice_matched_by"]["local_matched"] is True, key
            assert member["raw_slice_matched_by"]["upstream_matched"] is True, key
            assert member["raw_slice_matched_by"]["basis"] in {
                "member_key",
                "transformed_sha256",
            }, key
            if member["raw_identical"]:
                assert (
                    member["raw_local_member_sha256"]
                    == member["raw_upstream_member_sha256"]
                    == member["local_member_sha256"]
                ), key
            for side in ("local", "upstream"):
                matrix = member["transforms"][side]["matrix"]
                assert [row["rule"] for row in matrix] == ["T1", "T2", "T3", "T4", "T5"], key
                for reading in member["transforms"][side]["occurrence_points"]:
                    assert reading["rewritten_lexeme_count"] > 0, key
                    assert reading["points"], key
                    for point in reading["points"]:
                        assert point["before"] != point["after"], key
                        assert point["lexeme_index"] > 0 and point["line"] > 0, key


def test_member_qualification_is_decided_by_the_rule_implementation(
    tool: object, package: dict
) -> None:
    """合格性判定必须等于规则实现对同一成员的实测返回，不允许工具自说自话。"""

    checker = tool.load_checker()
    manifest, error = checker._load_member_identity_member_manifest(str(MANIFEST_PATH))
    assert error is None and manifest is not None
    import re as _re

    patterns = tuple(
        _re.compile(str(item)) for item in manifest["discrimination"]["generic_string_patterns"]
    )
    transform_set = tool.resolve_transform_set(checker)
    transforms = tool.ordered_transforms(transform_set)
    for item in package["items"]:
        if not item["member_identity"]["members"]:
            continue
        member = item["member_identity"]["members"][0]
        local_text = (REPO_ROOT / item["object"]["local_path"]).read_text(encoding="utf-8")
        upstream_path = (
            REPO_ROOT
            / "docs/测试与可靠性/来源证据/上游快照"
            / f"ruoyi-vue-pro@{item['object']['upstream']['commit']}"
            / item["object"]["upstream"]["path"]
        )
        upstream_text = upstream_path.read_text(encoding="utf-8")
        local_view = checker._member_identity_view(local_text, transforms, "local")
        upstream_view = checker._member_identity_view(upstream_text, transforms, "upstream")
        paired = checker._member_identity_pair(local_view, upstream_view)
        keyed = {str(row["key"]): row for row in paired["equal"]}
        source = keyed.get(str(member["member_key"]))
        assert source is not None, member["member_key"]
        local_member = next(
            row for row in local_view["members"] if row["key"] == member["member_key"]
        )
        probe = {
            "key": local_member["key"],
            "kind": local_member["kind"],
            "name": local_member["name"],
            "tokens": local_member["tokens"],
            "body_brace": local_member["body_brace"],
            "anchors": checker._member_identity_anchors_for(local_member, patterns),
        }
        reasons = checker._member_identity_boilerplate_reasons(probe, manifest)
        assert member["qualification"]["qualifies"] is (not reasons), member["member_key"]
        assert member["qualification"]["boilerplate_reasons"] == reasons
        assert probe["anchors"] == member["qualification"]["anchor_counts"]["anchors"]
        return


def test_boilerplate_members_are_never_counted_as_evidence(package: dict) -> None:
    """被样板门槛排除的成员绝不能进入合格集合。"""

    excluded_keys: set[str] = set()
    for item in package["items"]:
        quantity = item["member_identity"]["quantity_condition"]
        qualifying = set(quantity["qualifying_members"])
        excluded = {entry["member_key"] for entry in quantity["excluded_members"]}
        assert not (qualifying & excluded), item["item_id"]
        excluded_keys |= excluded
        for entry in quantity["excluded_members"]:
            assert entry["boilerplate_reasons"], entry["member_key"]
        by_key = {
            str(member["member_key"]): member for member in item["member_identity"]["members"]
        }
        for key in qualifying:
            assert by_key[key]["qualification"]["qualifies"] is True, key
            assert by_key[key]["qualification"]["branch_facts"]["boundary_selfcheck_hard"] is False
            anchors = by_key[key]["qualification"]["anchor_counts"]
            assert anchors["total"] >= anchors["required_min"], key
            assert anchors["lexeme_count"] >= anchors["required_min_lexeme_count"], key
        if quantity["entry"] == "M0":
            assert quantity["m0"]["qualifying_raw_identical"] >= 1, item["item_id"]
            assert quantity["mt"]["satisfied"] is False, item["item_id"]
        if quantity["entry"] == "MT":
            assert quantity["mt"]["qualifying_transformed"] >= 2, item["item_id"]
            assert quantity["m0"]["qualifying_raw_identical"] == 0, item["item_id"]
    assert excluded_keys, "本包必须真的命中过样板排除，否则门槛形同虚设"


def test_items_failing_the_quantity_condition_are_marked_and_diagnosed(package: dict) -> None:
    """不满足 M0／MT 的条目必须如实标为不成立并给出诊断，不得凑数。"""

    failing = [item for item in package["items"] if item["status"]["overall"] != "成立"]
    assert failing, "本包必须如实标出不成立的条目"
    for item in failing:
        quantity = item["member_identity"]["quantity_condition"]
        assert quantity["entry"] is None, item["item_id"]
        assert quantity["status"] == "不成立"
        assert quantity["reasons"], item["item_id"]
        assert item["status"]["reasons"], item["item_id"]
        assert any("M0 不成立" in reason for reason in quantity["reasons"]), item["item_id"]
        assert any("MT 不成立" in reason for reason in quantity["reasons"]), item["item_id"]
        assert any(
            "不得据本材料改判" in question for question in item["open_questions"]
        ), item["item_id"]
    for item in package["items"]:
        quantity = item["member_identity"]["quantity_condition"]
        expected = (
            "成立"
            if quantity["entry"] is not None
            and item["coverage_selfcheck"]["both_complete"]
            and item["difference_ledger"]["coverage"]["covers_exactly"]
            else "不成立"
        )
        assert item["status"]["overall"] == expected, item["item_id"]
        assert item["status"]["quantity_condition"] == quantity["status"]


def test_coverage_and_boundary_selfcheck_recompute_identically(
    tool: object, package: dict
) -> None:
    """覆盖性与边界自检必须能由规则实现原样复算（成员能逐词素拼回整流）。"""

    checker = tool.load_checker()
    transform_set = tool.resolve_transform_set(checker)
    transforms = tool.ordered_transforms(transform_set)
    for item in package["items"][:8]:
        local_text = (REPO_ROOT / item["object"]["local_path"]).read_text(encoding="utf-8")
        upstream_path = (
            REPO_ROOT
            / "docs/测试与可靠性/来源证据/上游快照"
            / f"ruoyi-vue-pro@{item['object']['upstream']['commit']}"
            / item["object"]["upstream"]["path"]
        )
        upstream_text = upstream_path.read_text(encoding="utf-8")
        for side, text in (("local", local_text), ("upstream", upstream_text)):
            view = checker._member_identity_view(text, transforms, side)
            recorded = item["coverage_selfcheck"][side]
            assert recorded["code_stream_sha256"] == view["code_stream_sha256"], item["item_id"]
            assert recorded["lexeme_count"] == view["token_count"]
            assert recorded["members"] == len(view["members"])
            assert recorded["coverage_complete"] == bool(view["coverage_complete"])
            assert recorded["problems"] == [str(item) for item in view["problems"]]
            assert recorded["independent_rebuild_matches_stream"] is True, item["item_id"]
            assert recorded["non_countable_notes"] == [
                problem for problem in recorded["problems"] if "成员边界自检不计入" in problem
            ]
            assert recorded["hard_problems"] == [
                problem
                for problem in recorded["problems"]
                if problem in recorded["hard_problems"]
            ]
            expected_boundary = (
                "无 hard 边界失败"
                if not recorded["hard_problems"]
                else f"有 {len(recorded['hard_problems'])} 处 hard 边界／覆盖失败"
            )
            assert recorded["boundary_selfcheck"] == expected_boundary


def test_no_item_has_a_hard_split_or_coverage_failure(package: dict) -> None:
    """本包内不得出现 hard 边界失败或不成立的覆盖性自检（否则条目必须被判不成立）。"""

    for item in package["items"]:
        for side in ("local", "upstream"):
            recorded = item["coverage_selfcheck"][side]
            assert recorded["hard_problems"] == [], (item["item_id"], side)
            assert recorded["coverage_complete"] is True, (item["item_id"], side)
            assert recorded["independent_rebuild_matches_stream"] is True, (item["item_id"], side)
            assert recorded["lexeme_errors"] == []
        assert item["coverage_selfcheck"]["hard_problem_count"] == 0, item["item_id"]


def test_difference_attribution_covers_every_measured_category(package: dict) -> None:
    """归因必须恰好覆盖规则实现实测的七类差异，未解释块为 0。"""

    for item in package["items"]:
        coverage = item["difference_ledger"]["coverage"]
        measured = item["difference_ledger"]["measured_differences"]
        assert coverage["measured"] == measured, item["item_id"]
        assert coverage["covers_exactly"] is True, item["item_id"]
        assert coverage["unexplained_blocks"] == 0, item["item_id"]
        assert not coverage["unexplained_categories"], item["item_id"]
        totals: dict[str, int] = {}
        for entry in item["difference_ledger"]["attribution"]:
            assert entry["location"] and entry["declaration"] and entry["nature"], entry["category"]
            assert entry["cause"], entry["category"]
            totals[entry["category"]] = totals.get(entry["category"], 0) + int(
                entry["changed_lines"]["local"]
            )
        for category, value in measured.items():
            assert totals.get(category, 0) == value, (item["item_id"], category)
            if value:
                assert any(
                    entry["category"] == category for entry in item["difference_ledger"]["attribution"]
                ), (item["item_id"], category)


def test_line_attribution_covers_every_measured_difference_line(package: dict) -> None:
    """逐行差异账必须恰好覆盖实测差异行，未解释块如实登记并进入未解决问题。"""

    for item in package["items"]:
        coverage = item["line_attribution_coverage"]
        assert coverage["covers_exactly"] is True, item["item_id"]
        assert coverage["attributed_local_lines"] == coverage["measured_local_lines"]
        assert coverage["attributed_upstream_lines"] == coverage["measured_upstream_lines"]
        if coverage["unexplained_blocks"]:
            assert any(
                "无法由已登记变换" in question for question in item["open_questions"]
            ), item["item_id"]


def test_comment_bindings_are_verbatim_and_fingerprinted(package: dict) -> None:
    """注释绑定的逐字原文必须与本地文件该行区间完全一致。"""

    for item in package["items"]:
        path = REPO_ROOT / item["object"]["local_path"]
        lines = path.read_text(encoding="utf-8").split("\n")
        for binding in item["comment_bindings"]:
            start, end = binding["lines"]
            verbatim = "\n".join(lines[start - 1 : end])
            assert verbatim == binding["text"], (item["item_id"], binding["lines"])
            assert hashlib.sha256(verbatim.encode("utf-8")).hexdigest() == binding["sha256"]
        statuses = {entry["role"]: entry for entry in item["comment_roles_acceptance"]}
        assert statuses["responsibility-javadoc"]["present"] is True, item["item_id"]
        for entry in statuses.values():
            assert entry["acceptance_beyond_member_identity"], item["item_id"]


def test_index_current_state_snapshot_matches_the_registry(package: dict) -> None:
    """材料抄录的索引判词必须与受控索引当前值逐条一致（只抄不改）。"""

    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    records = {record["local_path"]: record for record in index["records"]}
    for item in package["items"]:
        record = records[item["object"]["local_path"]]
        state = item["index_current_state"]
        assert state["d12_verdict"] == record["d12_verdict"], item["item_id"]
        assert state["evidence_branch"] == record["evidence_branch"], item["item_id"]
        assert state["author_status"] == record["author_status"], item["item_id"]


def test_repository_index_declares_no_member_identity_record(package: dict) -> None:
    """本轮不得改判任何记录：索引里 E2-member-identity 仍然是 0 条。"""

    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    occurrences = sum(
        1 for record in index["records"] if record.get("evidence_branch") == "E2-member-identity"
    )
    assert occurrences == 0
    assert package["counts"]["verdicts_filled_by_implementer"] == 0


def test_reviewer_decision_and_semantic_fields_are_blank(package: dict) -> None:
    """判定列与语义字段必须留空，材料不得出现实施方结论。"""

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
    forbidden = ("已验收", "已通过", "复核通过", "改判为", "转为 accepted")
    for item in package["items"]:
        assert item["reviewer_decision"] == {
            "reviewer_verdict": None,
            "reviewer": None,
            "review_date": None,
            "review_reason": None,
        }
        for member in item["member_identity"]["members"]:
            assert all(
                value is None for value in member["qualification"]["semantic_fields"].values()
            ), member["member_key"]
        draft = item["proposed_contract_draft"]
        assert draft["status"].startswith("草案")
        assert draft["review"]["reviewer"] is None
        assert draft["review"]["date"] is None
        assert draft["review"]["conclusion"] is None
        assert draft["counter_evidence_conclusion"] is None
        assert draft["business_subject"]["reviewer"] is None
        assert draft["business_subject"]["non_generic_reason"] is None
        for member in draft["members"]:
            for field in (
                "owner_responsibility",
                "non_generic_reason",
                "discriminative_reason",
                "coverage_reason",
            ):
                assert member[field] is None, member["member_key"]
        serialized = json.dumps(draft, ensure_ascii=False)
        assert not [word for word in forbidden if word in serialized], item["item_id"]


def test_material_documents_declare_blank_verdict_table() -> None:
    """人读材料必须写明判定列留空并给出口径声明。"""

    markdown = REVIEW_MD.read_text(encoding="utf-8")
    assert "本文件由实施方生成，判定列留空待独立复核方填写；实施方不得自行填写" in markdown
    assert "## 复核判定表（留空）" in markdown
    assert markdown.count("**复核判定（留空待独立复核方填写）**") == 108
    assert "不等于来源已验收" in markdown


def test_stored_materials_match_a_fresh_rebuild(package: dict, stored: dict) -> None:
    """仓内材料必须与当前工作树重新生成的结果一致（材料不会悄悄过期）。"""

    assert [item["item_id"] for item in package["items"]] == [
        item["item_id"] for item in stored["items"]
    ]
    assert package["counts"] == stored["counts"]
    assert package["inputs"]["rule_implementation"]["sha256"] == (
        stored["inputs"]["rule_implementation"]["sha256"]
    )
    assert package["inputs"]["member_manifest"]["rules_sha256"] == (
        stored["inputs"]["member_manifest"]["rules_sha256"]
    )


def test_generator_cli_rebuilds_identical_materials() -> None:
    """真实 CLI：--build 重新生成的 JSON 必须与仓内版本逐字节一致。"""

    before = REVIEW_JSON.read_bytes()
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
    assert REVIEW_JSON.read_bytes() == before
    assert b"generated_at_utc" not in before


def test_verify_item_entry_point_reports_mismatch(tool: object) -> None:
    """真实 CLI：--verify-item 对每条都应通过；不存在的限定名返回 not-found。"""

    stored = json.loads(REVIEW_JSON.read_text(encoding="utf-8"))
    target = stored["items"][0]["object"]["declaration"]
    code, report = tool.verify_item(target)
    assert code == 0, report.get("mismatches")
    assert report["status"] == "passed"
    assert report["mismatches"] == []
    missing_code, missing = tool.verify_item("com.example.NotInPackage")
    assert missing_code == 2
    assert missing["status"] == "not-found"


def test_verify_item_detects_a_mutated_rule_implementation(tool: object, monkeypatch: object) -> None:
    """负对照：规则实现的成员读数被改动时，--verify-item 必须报告不一致。"""

    checker = tool.load_checker()

    def always_excluded(member: dict, manifest: dict) -> list[str]:
        """把所有成员都判为样板（模拟门槛被改坏）。"""

        return [f"成员 {member['key']!r} 被突变判为样板"]

    monkeypatch.setattr(checker, "_member_identity_boilerplate_reasons", always_excluded)
    stored = json.loads(REVIEW_JSON.read_text(encoding="utf-8"))
    target = next(
        item["object"]["declaration"]
        for item in stored["items"]
        if item["member_identity"]["quantity_condition"]["entry"] == "M0"
    )
    code, report = tool.verify_item(target)
    assert code == 1
    assert report["status"] == "failed"
    assert report["mismatches"]


def test_verify_batch_recomputes_every_item(tool: object) -> None:
    """真实 CLI：--verify-batch 必须复算全部 108 条并全部一致。"""

    code, report = tool.verify_batch()
    assert code == 0, report["mismatches"]
    assert report["status"] == "passed"
    assert report["items"] == 108


def test_verify_batch_detects_tampered_material(
    tool: object, monkeypatch: object, tmp_path: Path
) -> None:
    """负对照：材料被篡改一个成员指纹后，--verify-batch 必须非零退出。

    篡改对象是 ``tmp_path`` 里的**副本**，仓内材料不被本用例改写；否则同一次测试
    运行里任何并发读取仓内材料的过程都会看到伪造读数。
    """

    original = json.loads(REVIEW_JSON.read_text(encoding="utf-8"))
    tampered = json.loads(json.dumps(original, ensure_ascii=False))
    target = next(item for item in tampered["items"] if item["member_identity"]["members"])
    target["member_identity"]["members"][0]["local_member_sha256"] = "0" * 64
    tampered_path = tmp_path / "成员同一性逐条复核材料.json"
    tampered_path.write_text(
        json.dumps(tampered, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    monkeypatch.setattr(tool, "REVIEW_JSON", tampered_path)
    code, report = tool.verify_batch()
    assert code == 1
    assert report["status"] == "failed"
    assert report["mismatches"]
    assert any(target["item_id"] in mismatch for mismatch in report["mismatches"])
    monkeypatch.undo()
    restored_code, restored = tool.verify_batch()
    assert restored_code == 0, restored["mismatches"]


def test_material_reproduction_commands_run_offline(tool: object, package: dict) -> None:
    """复现命令必须只依赖仓内快照与工作树（断网可跑）。"""

    for item in package["items"][:4]:
        command = item["reproduction"]["item_command"]
        assert "--verify-item" in command
        assert item["object"]["declaration"] in command
        assert "curl" not in command and "git clone" not in command
    for gate in package["reproduction"]["gates"]:
        assert "curl" not in gate and "wget" not in gate
    assert "--verify-batch" in package["reproduction"]["batch_command_template"]


def test_material_inlines_no_source_text_but_keeps_recomputable_references(
    tool: object, package: dict
) -> None:
    """成员／行级／归因证据只给「路径 + 行区间 + 逐字 SHA-256」，且必须能复算。"""

    sample = package["items"][:6]
    for item in sample:
        local_path = REPO_ROOT / item["object"]["local_path"]
        upstream_path = (
            REPO_ROOT
            / "docs/测试与可靠性/来源证据/上游快照"
            / f"ruoyi-vue-pro@{item['object']['upstream']['commit']}"
            / item["object"]["upstream"]["path"]
        )

        def resolve(reference: dict) -> str:
            """按登记的路径与行区间取回逐字原文。"""

            if not reference["present"]:
                return ""
            source = (REPO_ROOT / reference["path"]).read_text(encoding="utf-8")
            start, end = reference["lines"]
            return "\n".join(source.split("\n")[start - 1 : end])

        assert local_path.exists() and upstream_path.exists()
        for member in item["member_identity"]["members"]:
            assert "member_text_local" not in member, member["member_key"]
            assert "member_text_upstream" not in member, member["member_key"]
            assert member["member_fingerprint_note"], member["member_key"]
            for side in ("local", "upstream"):
                reference = member[f"member_text_ref_{side}"]
                assert reference["path"] and reference["lines"], member["member_key"]
                body = resolve(reference)
                assert hashlib.sha256(body.encode("utf-8")).hexdigest() == reference["sha256"]
        for entry in item["difference_ledger"]["attribution"]:
            assert "before_text" not in entry and "after_text" not in entry
            for key in ("before_ref", "after_ref"):
                reference = entry[key]
                if not reference["present"]:
                    continue
                body = resolve(reference)
                assert (
                    hashlib.sha256(body.encode("utf-8")).hexdigest() == reference["sha256"]
                ), (item["item_id"], entry["category"], key)
        for block_row in item["line_difference_attribution"]:
            assert block_row["local_text"] is None
            assert block_row["upstream_text"] is None
            for key in ("local_text_ref", "upstream_text_ref"):
                reference = block_row[key]
                if not reference["present"]:
                    continue
                body = resolve(reference)
                assert (
                    hashlib.sha256(body.encode("utf-8")).hexdigest() == reference["sha256"]
                ), (item["item_id"], key)
        for contract in item["contract_impact"]:
            for marker in contract["markers"]:
                assert "text" not in marker and marker["line_sha256"]
            for row in contract.get("cross_module_imports") or []:
                assert "import" not in row and row["import_sha256"]
        for row in item["authorship"]["local_author_tag_lines"]:
            assert "text" not in row and row["line_sha256"]


def test_material_triggers_no_secret_scanner_finding(tool: object, package: dict) -> None:
    """材料本身不得含会被 check_staged_quality 密钥扫描判为疑似凭据的字符串。"""

    integrity = package["material_integrity"]
    assert integrity["blocking_findings"] == 0
    assert integrity["json_findings"] == []
    assert integrity["markdown_findings"] == []
    assert integrity["scanner"] == "scripts/security/scan_staged_secrets.py"
    json_text = tool.serialize_package(package)
    markdown_text = tool.render_review_markdown(package)
    assert tool.scanner_findings(
        "docs/测试与可靠性/来源证据/成员同一性逐条复核材料.json", json_text
    ) == []
    assert tool.scanner_findings(
        "docs/测试与可靠性/来源证据/成员同一性逐条复核材料.md", markdown_text
    ) == []


def credential_probe_lines() -> list[str]:
    """运行时拼出凭据形态的探针行。

    这些字符串**故意**长成会被密钥扫描判为疑似凭据的样子，用来验证判定口径本身不是
    恒不命中。为避免把这种字符串写进仓库源码（那会被提交前检查拦下，也让源码变成新的
    凭据形态载体），这里在运行时按片段拼出来；源码里只有片段，没有完整形态。
    """

    key = "tok" + "en"
    prefix = "sk" + "-" + "a" * 24
    header = "X" + "-Amz-" + "Cred" + "ential" + "=" + "3Tvalue"
    return [
        f'String {key} = "abcdef123456";',
        prefix,
        f'example = "https://s3.example.com/a.png?{header}"',
    ]


def test_secret_scanner_oracle_detects_a_credential_shaped_line(tool: object) -> None:
    """有效性自检：判定口径确实会把凭据形态文本判为命中（不是恒不命中）。"""

    for probe in credential_probe_lines():
        assert tool.scanner_findings(tool.MATERIAL_SCAN_PATH, probe), probe
    assert not tool.scanner_findings(tool.MATERIAL_SCAN_PATH, " * 字典类型按名称前缀检索。")
    assert not tool.scanner_findings(tool.MATERIAL_SCAN_PATH, " * @author 李杰")


def test_comment_binding_keeps_verbatim_unless_credential_shaped(tool: object) -> None:
    """注释绑定默认保留逐字原文；含凭据形态时改为指纹并给出省略原因。"""

    clean, omitted = tool.build_comment_binding(
        "后端代码/x/A.java",
        "com.example.A",
        {"role": "responsibility-javadoc", "lines": [1, 2], "text": " * 职责说明。", "sha256": "0" * 64,
         "author_tag_lines": []},
    )
    assert omitted == ""
    assert clean["text_inlined"] is True and clean["text"] == " * 职责说明。"
    risky, reason = tool.build_comment_binding(
        "后端代码/x/A.java",
        "com.example.A",
        {"role": "responsibility-javadoc", "lines": [1, 2],
         "text": credential_probe_lines()[-1],
         "sha256": "1" * 64, "author_tag_lines": []},
    )
    assert reason
    assert risky["text_inlined"] is False
    assert risky["text"] is None
    assert risky["secret_scan_findings"]
    assert risky["sha256"] == "1" * 64
    assert risky["verbatim_path"] == "后端代码/x/A.java"
    assert risky["text_omitted_reason"]


def test_comment_bindings_are_verbatim_or_fingerprinted(package: dict) -> None:
    """材料里的注释绑定要么逐字原文可核对，要么给出可核对的指纹与省略说明。"""

    for item in package["items"]:
        path = REPO_ROOT / item["object"]["local_path"]
        lines = path.read_text(encoding="utf-8").split("\n")
        for binding in item["comment_bindings"]:
            start, end = binding["lines"]
            verbatim = "\n".join(lines[start - 1 : end])
            assert verbatim == binding["text"] if binding["text_inlined"] else verbatim is not None
            assert hashlib.sha256(verbatim.encode("utf-8")).hexdigest() == binding["sha256"]
            assert binding["verbatim_path"] == item["object"]["local_path"]
            if binding["text_inlined"]:
                assert binding["secret_scan_findings"] == []
            else:
                assert binding["text_omitted_reason"]
                assert any("逐字原文含疑似凭据形态字符串" in problem for problem in item["material_problems"])
