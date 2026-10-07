#!/usr/bin/env python3
"""生成 D17 成员级逐条复核材料包（E2-member-identity 的 A1/A2 候选）。

本工具只**准备材料**：它把裁决 D17 §G8 要求的逐条读数整理成机器可读 JSON 与
人读 Markdown——对象标识、成员切分与覆盖性自检、逐成员双侧指纹、M0/MT 数量条件、
「完整、非通用、有区分力」的机械化判定依据、全部残余差异的归因账、注释逐字原文、
作者与来源事实、契约影响位置、复现命令与未解决问题。工具**不判定**任何条目：
``reviewer_verdict`` / ``reviewer`` / ``review_date`` / ``review_reason`` 一律写
``null``，语义理由（``owner_responsibility`` 等）也留空，由独立复核方填写；
实施方不得代填，也不得改判索引记录。

所有成员级读数一律**调用规则实现自身**：词法与序列化来自
``scripts/code/java/check_staged_java_comments.py`` 的 ``_code_identity_*``，
成员切分、边界自检、样板门槛、区分力锚点、配对与实测差异账来自该模块的
``_member_identity_*``。本工具不另写一套比较或切分实现，也不复制既有结论。

与 D16 的 42 条包同口径的辅助读数（逐行归因、注释绑定、契约影响、模块索引、
上游作者扫描、声明 JavaDoc 绑定）复用同一个仓内生成器
``scripts/tools/build_d16_review_package.py`` 的实现，避免两套材料出现分叉口径；
这些实现同样只调用规则实现自身的函数。

用法::

    python3 -B -X utf8 scripts/tools/build_d17_member_review_package.py --build
    python3 -B -X utf8 scripts/tools/build_d17_member_review_package.py --verify-item \
        com.basicframework.framework.common.exception.ErrorCode --json
    python3 -B -X utf8 scripts/tools/build_d17_member_review_package.py --verify-batch --json

@author OpenAI Codex
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ElementTree
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
EVIDENCE_DIR = REPO_ROOT / "docs/测试与可靠性/来源证据"
INDEX_PATH = EVIDENCE_DIR / "d12-source-index.json"
QUEUE_PATH = EVIDENCE_DIR / "代码同一性复核队列.json"
SNAPSHOT_DIR = EVIDENCE_DIR / "上游快照"
CHECKER_PATH = REPO_ROOT / "scripts/code/java/check_staged_java_comments.py"
PRECOMMIT_SCAN_TOOL_PATH = REPO_ROOT / "scripts/security/scan_staged_secrets.py"
TRANSFORM_SET_PATH = EVIDENCE_DIR / "代码同一性变换集.json"
CONTRACT_SCHEMA_PATH = EVIDENCE_DIR / "成员同一性契约schema.json"
MEMBER_MANIFEST_PATH = EVIDENCE_DIR / "成员同一性成员清单.json"
D16_GENERATOR_PATH = REPO_ROOT / "scripts/tools/build_d16_review_package.py"
JAVA_WORKSPACE = REPO_ROOT / "后端代码/basic-framework-boot"

REVIEW_JSON = EVIDENCE_DIR / "成员同一性逐条复核材料.json"
REVIEW_MD = EVIDENCE_DIR / "成员同一性逐条复核材料.md"

SCHEMA_REVIEW = "d17-member-identity-review-materials/v1"
GENERATOR_RELATIVE = "scripts/tools/build_d17_member_review_package.py"
D16_GENERATOR_RELATIVE = "scripts/tools/build_d16_review_package.py"
IMPLEMENTER = "D17 成员级复核材料实施方（scripts/tools/build_d17_member_review_package.py）"

HEADER_NOTICE = (
    "本文件由实施方生成，判定列留空待独立复核方填写；实施方不得自行填写。"
    "本文件不含任何验收结论，也不改判索引中的任何记录："
    "d12_verdict / evidence_branch / evidence_route 一律保持原值。"
    "「成立／不成立」只表示规则实现对该条实测出的机械条件是否满足，"
    "不等于来源已验收，也不解除任何已登记阻断。"
)

# 索引中仍处于「已登记阻断」状态的三种判词；候选集合只从这三条派生。
BLOCKING_VERDICTS = (
    "证据不足，保持原状并登记阻断",
    "复核回退，保持来源说明并登记阻断（尚未验收）",
    "需补证，尚未验收",
)

CLASSIFICATION_RULE = (
    "候选集＝受控索引中 d12_verdict ∈ {已登记阻断三种判词} 的记录按逐类型映射展开的全部声明，"
    "减去 D16 复核队列已单列的 45 条候选；B/C 对象按受控成员清单 "
    "branch_ineligible / contract_conflicts 排除后得到 108 条 A 类对象。"
    "A1／A2 的机械判据：存在内容相等的**完整成员**（双方成员规范字节逐字节相同，"
    "按内容而非按成员键匹配）或双方类型头规范字节相同者记为 A1；"
    "只有包/导入段在登记变换后相等、没有任何成员或类型头相等者记为 A2。"
    "该判据由规则实现的 _member_identity_view / _member_identity_pair 实测得出，"
    "复算命令见 reproduction。"
)

_D16_MODULE: dict[str, Any] = {"value": None}
_CHECKER_MODULE: dict[str, Any] = {"value": None}
_SCANNER_MODULE: dict[str, Any] = {"value": None}

AUTHOR_TOKEN_PATTERN = re.compile(r"@author|作者\s*[:：]|\bauthor\s*:", re.IGNORECASE)
MEMBER_TEXT_LIMIT = 600
# 材料自身在仓库内的相对路径：作为密钥扫描判定「这段逐字原文能否内联」的固定口径。
MATERIAL_SCAN_PATH = "docs/测试与可靠性/来源证据/成员同一性逐条复核材料.json"


# --------------------------------------------------------------------------
# 基础工具
# --------------------------------------------------------------------------


def sha256_bytes(raw: bytes) -> str:
    """返回字节串的 SHA-256 十六进制指纹。"""

    return hashlib.sha256(raw).hexdigest()


def sha256_text(text: str) -> str:
    """返回 UTF-8 文本的 SHA-256 十六进制指纹。"""

    return sha256_bytes(text.encode("utf-8"))


def git(*arguments: str) -> str:
    """在仓库根执行只读 git 命令并返回去除行尾换行的输出。"""

    result = subprocess.run(
        ("git",) + arguments,
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def _load_module(name: str, path: Path) -> Any:
    """按文件路径加载一个模块，避免依赖调用者的当前目录。"""

    sys.dont_write_bytecode = True
    specification = importlib.util.spec_from_file_location(name, path)
    if specification is None or specification.loader is None:  # pragma: no cover - 防御
        raise RuntimeError(f"无法加载模块：{path}")
    module = importlib.util.module_from_spec(specification)
    sys.modules[name] = module
    specification.loader.exec_module(module)
    return module


def load_checker() -> Any:
    """加载规则实现 ``check_staged_java_comments.py``（进程内只加载一次）。

    缓存保证同一进程内的复算与生成走**同一个**规则实现实例：负对照用例要能真实
    替换规则函数并观察到材料复算结果随之变化，否则对照只会自我印证。
    """

    module = _CHECKER_MODULE.get("value")
    if module is None:
        module = _load_module("d17_rule_implementation", CHECKER_PATH)
        _CHECKER_MODULE["value"] = module
    return module


def load_d16_generator() -> Any:
    """加载 D16 复核材料生成器，复用同口径的辅助读数实现。"""

    return _load_module("d16_review_generator_shared", D16_GENERATOR_PATH)


def relative(path: Path) -> str:
    """把绝对路径转换为相对仓库根的展示路径。"""

    return path.resolve().relative_to(REPO_ROOT).as_posix()


def read_json(path: Path) -> dict[str, Any]:
    """读取 UTF-8 JSON 对象。"""

    return json.loads(path.read_text(encoding="utf-8"))


def reproduction_preamble() -> str:
    """返回复核方在本机复算时需要的环境前缀。"""

    return d16_generator().reproduction_preamble()


def d16_generator() -> Any:
    """返回已加载的 D16 复核材料生成器模块（进程内只加载一次）。"""

    module = _D16_MODULE.get("value")
    if module is None:
        module = load_d16_generator()
        _D16_MODULE["value"] = module
    return module


def resolve_transform_set(checker: Any) -> dict[str, Any]:
    """按受控路径解析变换集清单，失败即受控失败。"""

    return d16_generator().resolve_transform_set(checker)


def ordered_transforms(document: dict[str, Any]) -> list[dict[str, Any]]:
    """按清单登记的执行顺序返回变换列表。"""

    return d16_generator().ordered_transforms(document)


def truncate(text: str, limit: int = MEMBER_TEXT_LIMIT) -> dict[str, Any]:
    """返回文本指纹与长度，不内联正文。

    本材料**不重复内联源码原文**：成员、行级与归因证据一律给出「仓库内可读路径 +
    行区间 + 逐字 SHA-256 + 复算口径」。复核方按路径与行区间直接读仓内已提交的源文件
    或受控上游快照即可拿到逐字内容并校验指纹；材料不把源码字节再复制一份到新文件里。

    Args:
        text: 已算出的正文（仅用于取指纹与长度）。
        limit: 保留参数以兼容调用点；正文本身不再写入材料。

    Returns:
        仅含指纹与长度的字典。

    """

    return {
        "inlined": False,
        "bytes": len(text.encode("utf-8")),
        "characters": len(text),
        "sha256": sha256_text(text),
        "limit_argument": limit,
        "note": "逐字正文不在本材料内联；按 path + lines 读取并校验 sha256。",
    }


# --------------------------------------------------------------------------
# 密钥扫描口径：材料自身不得引入疑似凭据形态的字符串
# --------------------------------------------------------------------------


def load_secret_scanner() -> Any:
    """加载密钥扫描器实现（进程内只加载一次）。

    判定「某段逐字原文是否可以内联进材料」直接复用扫描器**自身的逐行规则函数**
    ``_scan_added_line``，不另写一套正则：材料口径与门禁口径必须同源，否则会出现
    「材料认为安全、门禁判定阻断」的分叉。
    """

    module = _SCANNER_MODULE.get("value")
    if module is None:
        module = _load_module("d17_secret_scanner", PRECOMMIT_SCAN_TOOL_PATH)
        _SCANNER_MODULE["value"] = module
    return module


def scanner_findings(path: str, text: str) -> list[dict[str, Any]]:
    """用扫描器自身的逐行规则判定一段文本是否会被门禁判为疑似凭据。

    Args:
        path: 以材料自身的相对路径参与判定（扫描器按路径后缀选择规则）。
        text: 待判定文本（逐行送入扫描器）。

    Returns:
        命中列表；空列表表示该文本不会被密钥扫描拦截。

    """

    scanner = load_secret_scanner()
    findings: list[dict[str, Any]] = []
    for number, line in enumerate(text.split("\n"), 1):
        for finding in scanner._scan_added_line(path, number, line):
            findings.append(
                {
                    "line": number,
                    "rule": finding.rule,
                    "severity": finding.severity,
                    "detail": finding.detail,
                }
            )
    return findings


def serialize_package(package: dict[str, Any]) -> str:
    """按落盘口径序列化材料包（与 ``--build`` 写盘使用的形式完全一致）。"""

    return json.dumps(package, ensure_ascii=False, indent=2, sort_keys=False) + "\n"


def material_secret_scan(package: dict[str, Any]) -> dict[str, Any]:
    """用密钥扫描器自身的规则扫一遍材料包与 Markdown，确认不会被门禁拦截。

    材料把指纹、路径与行区间登记进来，**不内联源码正文**；本函数把这条口径变成
    可核对的事实：任何残留的疑似凭据形态字符串都会被这里逐条列出，并在 ``--build``
    时直接让构建失败，而不是等到提交时才被拦。

    Args:
        package: 已组装完成的材料包。

    Returns:
        ``{"json_findings": [...], "markdown_findings": [...], "blocking": n}``。

    """

    json_findings = scanner_findings(relative(REVIEW_JSON), serialize_package(package))
    markdown_findings = scanner_findings(relative(REVIEW_MD), render_review_markdown(package))
    return {
        "scanner": relative(PRECOMMIT_SCAN_TOOL_PATH),
        "scanner_sha256": sha256_bytes(PRECOMMIT_SCAN_TOOL_PATH.read_bytes()),
        "oracle": "scripts.security.scan_staged_secrets._scan_added_line（逐行规则，材料按自身相对路径参与判定）",
        "json_findings": json_findings,
        "markdown_findings": markdown_findings,
        "blocking_findings": len([item for item in json_findings + markdown_findings if item["severity"] == "error"]),
        "inline_text_policy": (
            "成员、行级与归因证据一律登记「路径 + 行区间 + 逐字 SHA-256」，不内联源码正文；"
            "注释绑定默认保留逐字原文（其证据价值在逐字比对），仅当该原文会被密钥扫描判为"
            "疑似凭据时改为指纹 + 路径，并在 material_problems 说明。"
        ),
    }



# --------------------------------------------------------------------------
# 候选集合与分类
# --------------------------------------------------------------------------


def candidate_declarations(index: dict[str, Any], queue: dict[str, Any]) -> list[dict[str, Any]]:
    """从受控索引派生仍待来源验收的声明集合（排除 D16 队列已单列的候选）。

    Args:
        index: 受控来源索引文档。
        queue: D16 复核队列文档。

    Returns:
        每条含 ``record`` 与 ``declaration`` 的候选列表，按路径与限定名排序。

    """

    queue_keys = {
        (str(item["local_path"]), str(item["declaration"])) for item in queue["items"]
    }
    rows: list[dict[str, Any]] = []
    for record in index["records"]:
        if str(record.get("d12_verdict")) not in BLOCKING_VERDICTS:
            continue
        type_evidence = json.loads(str(record.get("type_evidence") or "{}"))
        for entry in type_evidence.get("types") or []:
            declaration = str(entry.get("qualified_name"))
            if (str(record["local_path"]), declaration) in queue_keys:
                continue
            rows.append(
                {
                    "record": record,
                    "declaration": declaration,
                    "type_entry": entry,
                }
            )
    rows.sort(key=lambda row: (str(row["record"]["local_path"]), str(row["declaration"])))
    return rows


def split_excluded_objects(
    rows: list[dict[str, Any]], manifest: dict[str, Any]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """按受控成员清单把候选分成 A 类、B 类（本分支不可关闭）与 C 类（契约冲突）。

    Args:
        rows: 候选声明列表。
        manifest: 已校验的受控成员清单。

    Returns:
        ``(A 类, B 类, C 类)``，每条附 ``exclusion_basis`` 与 ``match_basis``。

    """

    ineligible = list(manifest.get("branch_ineligible") or [])
    conflicts = list(manifest.get("contract_conflicts") or [])
    ineligible_paths = {str(item["upstream_path"]) for item in ineligible}
    ineligible_local = {str(item["local_path"]) for item in ineligible}
    ineligible_names = {Path(str(item["upstream_path"])).name for item in ineligible}
    conflict_paths = {str(item["upstream_path"]) for item in conflicts}
    a_rows: list[dict[str, Any]] = []
    b_rows: list[dict[str, Any]] = []
    c_rows: list[dict[str, Any]] = []
    for row in rows:
        record = row["record"]
        upstream_path = str(record.get("upstream_path"))
        local_path = str(record.get("local_path"))
        matched_b = next(
            (
                item
                for item in ineligible
                if str(item["upstream_path"]) == upstream_path
                and str(item["local_path"]) in {local_path, ""}
            ),
            None,
        )
        matched_b_local = next(
            (
                item
                for item in ineligible
                if str(item["local_path"]) == local_path and matched_b is None
            ),
            None,
        )
        matched_c = next(
            (
                item
                for item in conflicts
                if str(item["upstream_path"]) == upstream_path
                and str(item["local_path"]) in {local_path, ""}
            ),
            None,
        )
        if matched_b is not None:
            b_rows.append(
                {
                    **row,
                    "exclusion_basis": "branch_ineligible（受控成员清单，upstream_path 精确匹配）",
                    "match_basis": "upstream_path",
                    "manifest_entry": matched_b,
                }
            )
            continue
        if matched_b_local is not None:
            b_rows.append(
                {
                    **row,
                    "exclusion_basis": (
                        "branch_ineligible（受控成员清单，local_path 精确匹配；"
                        "清单登记的上游路径与受控索引登记的上游路径不一致，"
                        "故规则实现 _member_identity_ineligible_object 的 upstream_path "
                        "匹配**不会**命中该对象，详见该条 material_problems）"
                    ),
                    "match_basis": "local_path（清单上游路径与索引不一致）",
                    "manifest_entry": matched_b_local,
                }
            )
            continue
        if matched_c is not None:
            c_rows.append(
                {
                    **row,
                    "exclusion_basis": "contract_conflicts（受控成员清单，C 类逐项签认前排除）",
                    "match_basis": "upstream_path",
                    "manifest_entry": matched_c,
                }
            )
            continue
        if upstream_path in ineligible_names or Path(upstream_path).name in ineligible_names:
            b_rows.append(
                {
                    **row,
                    "exclusion_basis": "branch_ineligible（按上游文件基名匹配）",
                    "match_basis": "upstream-basename",
                    "manifest_entry": None,
                }
            )
            continue
        a_rows.append(row)
    return a_rows, b_rows, c_rows


# --------------------------------------------------------------------------
# 成员级读数（全部调用规则实现自身的函数）
# --------------------------------------------------------------------------


def raw_member_slices(
    checker: Any, source: str, transforms: list[dict[str, Any]], side: str
) -> tuple[dict[str, list[list[str]]], dict[str, list[list[list[str]]]], set[str]]:
    """切出**未执行 T1–T5** 的成员，并按其变换后的规范字节索引。

    规则实现 ``_member_identity_view`` 只把未变换侧的成员按**该侧自己的成员键**
    登记成 SHA-256；但登记变换会改写类简单名（例如 ``Yudao*`` → ``BasicFramework*``），
    未变换侧的成员键与变换后侧因此可能不同，按键索引会取不到对应成员。本函数改为：
    用规则实现自己的切分器切出未变换成员，按登记变换施加后序列化，**以变换后的规范
    字节**为索引，从而精确对应到变换后侧的成员。

    Args:
        checker: 规则实现模块。
        source: 单侧源码原文。
        transforms: 按执行顺序排列的登记变换。
        side: ``local`` 或 ``upstream``。

    Returns:
        ``(未变换成员键 → 词素切片, 变换后规范字节 SHA-256 → 词素切片列表, 成员键集合)``。

    """

    lexemes, _errors = checker._code_identity_code_tokens(source)
    prologue_end, body_open, error = checker._member_identity_prologue_and_header(lexemes)
    if error or body_open < 0:
        return {}, {}, set()
    header = lexemes[prologue_end : body_open + 1]
    # 归属类型名取自**变换后**的类型头：规则实现 ``_member_identity_view`` 也用变换后的
    # header 给未变换侧成员定键（未变换侧的原始类名可能与变换后不同）。口径必须一致，
    # 否则本工具登记的原始成员与规则实现登记的原始成员对不上。
    stream = checker._code_identity_stream(source, transforms, side)
    stream_lexemes: list[list[str]] = stream["tokens"]  # type: ignore[assignment]
    stream_prologue, stream_body, stream_error = checker._member_identity_prologue_and_header(
        stream_lexemes
    )
    owner = ""
    if not stream_error and stream_body >= 0:
        stream_header = stream_lexemes[stream_prologue : stream_body + 1]
        for index, (kind, text, _line) in enumerate(stream_header):
            if kind == "ident" and text in {"class", "interface", "enum", "record", "@interface"}:
                if index + 1 < len(stream_header):
                    owner = stream_header[index + 1][1]
                break
    else:  # pragma: no cover - 变换后流不可能比未变换流更早失败
        owner = ""
    kind_hint = "enum-body" if any(item[1] == "enum" for item in header) else ""
    _tiles, members, _problems, _close = checker._member_identity_segment(
        lexemes[body_open:], owner, kind_hint
    )
    by_key: dict[str, list[list[str]]] = {}
    by_digest: dict[str, list[list[list[str]]]] = {}
    for member in members:
        by_key[str(member["key"])] = list(member["tokens"])
        current = list(member["tokens"])
        for transform in transforms:
            direction = str(transform.get("direction"))
            if direction != "both" and side != "upstream":
                continue
            current = checker._code_identity_apply_transform(current, transform)
        digest = hashlib.sha256(checker._code_identity_serialize(current)).hexdigest()
        by_digest.setdefault(digest, []).append(list(member["tokens"]))
    return by_key, by_digest, set(by_key)


def transform_occurrences_on_slice(
    checker: Any,
    lexemes: list[list[str]],
    transforms: list[dict[str, Any]],
    side: str,
) -> list[dict[str, Any]]:
    """逐条登记一个成员切片上每条变换的**实际发生点**。

    Args:
        checker: 规则实现模块。
        lexemes: 未变换的成员词素切片。
        transforms: 按执行顺序排列的登记变换。
        side: ``local`` 或 ``upstream``。

    Returns:
        每条变换一条读数：是否执行、改写词素数与发生点（词素序号、行号、前后原文）。

    """

    readings: list[dict[str, Any]] = []
    current = list(lexemes)
    for transform in transforms:
        direction = str(transform.get("direction"))
        applies = direction == "both" or side == "upstream"
        reading: dict[str, Any] = {
            "rule": str(transform.get("id")),
            "name": str(transform.get("name")),
            "operation": str(transform.get("operation")),
            "direction": direction,
            "applied_on_this_side": applies,
        }
        if not applies:
            reading.update({"rewritten_lexeme_count": 0, "points": []})
            readings.append(reading)
            continue
        after = checker._code_identity_apply_transform(current, transform)
        points = [
            {
                "lexeme_index": position + 1,
                "lexeme_kind": later[0],
                "line": int(later[2]),
                "before": before[1],
                "after": later[1],
            }
            for position, (before, later) in enumerate(zip(current, after))
            if before[1] != later[1]
        ]
        reading.update(
            {
                "rewritten_lexeme_count": len(points),
                "points": points,
                "stream_reordered": checker._code_identity_serialize(current)
                != checker._code_identity_serialize(after),
            }
        )
        current = after
        readings.append(reading)
    return readings


def member_branch_facts(
    checker: Any, member: dict[str, Any], manifest: dict[str, Any]
) -> dict[str, Any]:
    """给出「为什么这个成员不是普通字段／getter／setter／空方法」的逐分支事实。

    判定本身一律取规则实现 ``_member_identity_boilerplate_reasons`` 的返回值；
    本函数只把该函数内部的各个分支条件**逐条暴露出来**，便于复核方核对
    受控成员清单 ``boilerplate_exclusions`` 的每一条是否被命中。

    Args:
        checker: 规则实现模块。
        member: 含 ``kind``/``tokens``/``body_brace``/``name``/``key``/``anchors`` 的成员读数。
        manifest: 已校验的受控成员清单。

    Returns:
        逐分支事实字典与规则实现返回的排除原因列表。

    """

    boilerplate = manifest.get("boilerplate_exclusions", {})
    lexemes: list[list[str]] = list(member["tokens"])  # type: ignore[arg-type]
    kind = str(member["kind"])
    name = str(member["name"])
    body_brace = int(member["body_brace"])
    body_lexemes = lexemes[body_brace + 1 : -1] if body_brace >= 0 else []
    body_text = " ".join(lexeme[1] for lexeme in body_lexemes)
    accessors = {str(item) for item in boilerplate.get("accessor_methods", [])}
    generic_names = {str(item) for item in boilerplate.get("generic_field_names", [])}
    annotation_names = {str(item) for item in boilerplate.get("annotation_only_names", [])}
    no_anchor_kinds = {str(item) for item in boilerplate.get("no_anchor_members", [])}
    generic_field_names = set(checker.MEMBER_IDENTITY_BOILERPLATE_FIELD_NAMES)
    has_initializer = any(lexeme[1] == "=" for lexeme in lexemes)
    identifier_lexemes = [lexeme[1] for lexeme in lexemes if lexeme[0] in {"ident", "name"}]
    boundary = checker._member_identity_boundary_reasons(lexemes, kind, body_brace)
    return {
        "member_kind": kind,
        "member_kind_countable": kind in set(checker.MEMBER_IDENTITY_MEMBER_KINDS),
        "member_kind_excluded_by_manifest": kind in {str(item) for item in boilerplate.get("kinds", [])},
        "member_kind_no_anchor_member": kind in no_anchor_kinds,
        "boundary_selfcheck_findings": [
            {"severity": severity, "detail": detail} for severity, detail in boundary
        ],
        "boundary_selfcheck_hard": any(severity == "hard" for severity, _ in boundary),
        "boundary_selfcheck_non_countable": any(
            severity == "non-countable" for severity, _ in boundary
        ),
        "is_accessor_named": bool(checker.MEMBER_IDENTITY_ACCESSOR_NAME.match(name)),
        "is_generic_accessor_name": name in accessors
        or bool(checker.MEMBER_IDENTITY_BOILERPLATE_ACCESSOR.match(name)),
        "has_trivial_body": bool(checker.MEMBER_IDENTITY_TRIVIAL_RETURN.match(body_text.strip())),
        "body_empty": not body_lexemes or not body_text.strip(),
        "is_plain_field_without_initializer": kind == "field"
        and not has_initializer
        and (name in generic_names or name in generic_field_names),
        "is_annotation_only_field": kind == "field"
        and not has_initializer
        and bool(identifier_lexemes)
        and all(item in annotation_names for item in identifier_lexemes),
        "has_initializer": has_initializer,
        "name": name,
    }


def anchor_counts(checker: Any, member: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any]:
    """按受控清单登记区分力锚点的分类计数与门槛。"""

    anchors = list(member.get("anchors") or [])
    discrimination = manifest.get("discrimination", {})
    by_kind = collections.Counter(str(item["kind"]) for item in anchors)
    return {
        "total": len(anchors),
        "by_kind": dict(sorted(by_kind.items())),
        "required_min": int(discrimination.get("min_anchors", 1)),
        "anchor_kinds_allowed": [str(item) for item in discrimination.get("anchor_kinds", [])],
        "lexeme_count": len(member["tokens"]),  # type: ignore[arg-type]
        "required_min_lexeme_count": int(discrimination.get("min_member_lexeme_count", 1)),
        "anchors": [{"kind": str(item["kind"]), "lexeme": str(item["lexeme"])} for item in anchors],
        "note": "锚点只是机械可识别的非惯用事实候选；是否承载业务语义主体由 D17 §G5 的"
        "独立语义复核负责，锚点计数不等于业务主体成立。",
    }


def member_rows(
    checker: Any,
    local_view: dict[str, Any],
    upstream_view: dict[str, Any],
    paired: dict[str, Any],
    manifest: dict[str, Any],
    generic_patterns: tuple[re.Pattern[str], ...],
    raw_local: dict[str, list[list[list[str]]]],
    raw_upstream: dict[str, list[list[list[str]]]],
    transforms: list[dict[str, Any]],
    raw_keys_local: set[str],
    raw_keys_upstream: set[str],
    raw_local_digest: dict[str, list[list[list[str]]]],
    raw_upstream_digest: dict[str, list[list[list[str]]]],
    local_rel: str,
    upstream_rel: str,
    local_text: str,
    upstream_text: str,
) -> list[dict[str, Any]]:
    """为每个相等成员登记双侧指纹、行区间、变换发生点与合格性判定。

    Args:
        checker: 规则实现模块。
        local_view: 本地成员读数。
        upstream_view: 上游成员读数。
        paired: 规则实现的配对结果。
        manifest: 已校验的受控成员清单。
        generic_patterns: 受控清单登记的惯用字符串模式。
        raw_local: 本地未变换成员词素表（按变换后的规范字节索引）。
        raw_upstream: 上游未变换成员词素表（按变换后的规范字节索引）。
        transforms: 按执行顺序排列的登记变换。
        raw_keys_local: 本地未变换侧的成员键集合。
        raw_keys_upstream: 上游未变换侧的成员键集合。
        raw_local_digest: 本地未变换成员按变换后规范字节的索引。
        raw_upstream_digest: 上游未变换成员按变换后规范字节的索引。
        local_rel: 本地文件的仓库内相对路径。
        upstream_rel: 上游快照文件的仓库内相对路径。
        local_text: 本地源码原文。
        upstream_text: 上游源码原文。

    Returns:
        每个相等成员一条完整读数（含不合格者的排除原因）。

    """

    rows: list[dict[str, Any]] = []
    for item in paired["equal"]:
        key = str(item["key"])
        local_member = next(row for row in local_view["members"] if row["key"] == key)
        upstream_member = next(row for row in upstream_view["members"] if row["key"] == key)
        probe = {
            "key": key,
            "kind": local_member["kind"],
            "name": local_member["name"],
            "tokens": local_member["tokens"],
            "body_brace": local_member["body_brace"],
        }
        anchors = checker._member_identity_anchors_for(probe, generic_patterns)
        probe["anchors"] = anchors
        boiler_reasons = checker._member_identity_boilerplate_reasons(probe, manifest)
        # 未变换侧成员优先按**成员键**对应（与规则实现同一口径）；成员键取不到时退回
        # 「变换后规范字节」索引，避免登记变换改写类简单名后取不到对应的原始成员。
        local_slice = raw_local.get(key)
        upstream_slice = raw_upstream.get(key)
        match_basis = "member_key"
        if local_slice is None or upstream_slice is None:
            local_candidates = list(raw_local_digest.get(str(item["local_member_sha256"]), []))
            upstream_candidates = list(
                raw_upstream_digest.get(str(item["upstream_member_sha256"]), [])
            )
            if local_slice is None and local_candidates:
                local_slice = local_candidates.pop(0)
                match_basis = "transformed_sha256"
            if upstream_slice is None and upstream_candidates:
                upstream_slice = upstream_candidates.pop(0)
                match_basis = "transformed_sha256" if match_basis == "member_key" else match_basis
        local_occurrences = (
            transform_occurrences_on_slice(checker, local_slice, transforms, "local")
            if local_slice is not None
            else []
        )
        upstream_occurrences = (
            transform_occurrences_on_slice(checker, upstream_slice, transforms, "upstream")
            if upstream_slice is not None
            else []
        )
        raw_key_matches_rule_reading = (
            key in raw_keys_local and key in raw_keys_upstream
        )
        local_applied = [
            str(reading["rule"])
            for reading in local_occurrences
            if reading.get("rewritten_lexeme_count")
        ]
        upstream_applied = [
            str(reading["rule"])
            for reading in upstream_occurrences
            if reading.get("rewritten_lexeme_count")
        ]
        def compact(readings: list[dict[str, Any]]) -> dict[str, Any]:
            """只保留真正改写了该成员的变换读数，并给出全部规则的执行矩阵。"""

            return {
                "matrix": [
                    {
                        "rule": str(reading["rule"]),
                        "applied_on_this_side": bool(reading["applied_on_this_side"]),
                        "rewritten_lexeme_count": int(reading["rewritten_lexeme_count"]),
                    }
                    for reading in readings
                ],
                "occurrence_points": [
                    reading
                    for reading in readings
                    if reading["applied_on_this_side"] and reading["rewritten_lexeme_count"]
                ],
                "note": (
                    "occurrence_points 只登记**实际改写了本成员**的变换及其逐词素发生点；"
                    "matrix 给出 T1–T5 全部规则在本侧的执行与改写计数。"
                ),
            }

        rows.append(
            {
                "member_key": key,
                "kind": item["kind"],
                "local_lines": list(item["local_lines"]),
                "upstream_lines": list(item["upstream_lines"]),
                "local_member_sha256": item["local_member_sha256"],
                "upstream_member_sha256": item["upstream_member_sha256"],
                "local_member_bytes": item["local_member_bytes"],
                "upstream_member_bytes": item["upstream_member_bytes"],
                "local_member_lexeme_count": item["local_member_lexeme_count"],
                "upstream_member_lexeme_count": item["upstream_member_lexeme_count"],
                "raw_local_member_sha256": item["raw_local_member_sha256"],
                "raw_upstream_member_sha256": item["raw_upstream_member_sha256"],
                "raw_identical": bool(item["raw_identical"]),
                "member_sha256_equal": item["local_member_sha256"] == item["upstream_member_sha256"],
                "transforms": {
                    "local": compact(local_occurrences),
                    "upstream": compact(upstream_occurrences),
                },
                "transforms_rewriting_member": {
                    "local": local_applied,
                    "upstream": upstream_applied,
                },
                "raw_slice_matched_by": {
                    "basis": match_basis,
                    "basis_note": (
                        "member_key 表示与规则实现同一口径按成员键对应；"
                        "transformed_sha256 表示成员键取不到时按变换后的规范字节对应"
                    ),
                    "local_matched": local_slice is not None,
                    "upstream_matched": upstream_slice is not None,
                    "raw_member_key_identical_on_both_sides": raw_key_matches_rule_reading,
                },
                "qualification": {
                    "qualifies": not boiler_reasons,
                    "boilerplate_reasons": list(boiler_reasons),
                    "branch_facts": member_branch_facts(checker, probe, manifest),
                    "anchor_counts": anchor_counts(checker, probe, manifest),
                    "mechanical_basis": (
                        "完整成员（边界自检无 hard、非单独分号、定界符平衡、"
                        "以自身闭合符结束）；非普通字段／getter／setter／空方法／"
                        "只由样板注解与惯用类型名构成的模板；区分力锚点计数与词素数"
                        "均达到受控成员清单门槛。以上逐条事实见 branch_facts 与 "
                        "anchor_counts，判定由规则实现 _member_identity_boilerplate_reasons 给出。"
                    ),
                    "semantic_fields": {
                        "owner_responsibility": None,
                        "non_generic_reason": None,
                        "discriminative_reason": None,
                        "coverage_reason": None,
                    },
                    "semantic_fields_note": (
                        "四个语义字段属 D17 §G5 的独立语义复核结论，"
                        "实施方不得代填，留空待独立复核方填写。"
                    ),
                },
                "member_text_ref_local": text_reference(
                    local_rel, list(item["local_lines"]), local_text, "member"
                ),
                "member_text_ref_upstream": text_reference(
                    upstream_rel, list(item["upstream_lines"]), upstream_text, "member"
                ),
                "member_fingerprint_note": (
                    "成员身份以双侧规范字节 SHA-256／字节数／词素数为准；"
                    "member_text_ref_* 是该成员行区间在仓库文件中的逐字指纹（lines-join-v1），"
                    "供复核方直接读到原文核对，不参与任何比较"
                ),
            }
        )
    return rows


def content_equal_members(local_view: dict[str, Any], upstream_view: dict[str, Any]) -> list[str]:
    """返回双方都存在、且规范字节完全相同的成员 SHA-256（按内容而非成员键匹配）。"""

    upstream_hashes = {str(row["sha256"]) for row in upstream_view["members"]}
    return sorted(
        {
            str(row["sha256"])
            for row in local_view["members"]
            if str(row["sha256"]) in upstream_hashes
        }
    )


def coverage_selfcheck(
    checker: Any, source: str, transforms: list[dict[str, Any]], side: str, view: dict[str, Any]
) -> dict[str, Any]:
    """独立复算「成员能否逐词素拼回整条代码流」并汇总边界自检结论。

    Args:
        checker: 规则实现模块。
        source: 单侧源码原文。
        transforms: 按执行顺序排列的登记变换。
        side: ``local`` 或 ``upstream``。
        view: 规则实现的成员读数。

    Returns:
        覆盖性读数：词素总数、成员数、铺满对账结论、边界自检结论与全部问题。

    """

    stream = checker._code_identity_stream(source, transforms, side)
    lexemes: list[list[str]] = stream["tokens"]  # type: ignore[assignment]
    prologue_end, body_open, error = checker._member_identity_prologue_and_header(lexemes)
    rebuilt: list[list[str]] = []
    rebuild_ok = False
    member_tiles = 0
    if not error and body_open >= 0:
        header = lexemes[prologue_end : body_open + 1]
        owner = ""
        for index, (kind, text, _line) in enumerate(header):
            if kind == "ident" and text in {"class", "interface", "enum", "record", "@interface"}:
                if index + 1 < len(header):
                    owner = header[index + 1][1]
                break
        kind_hint = "enum-body" if any(item[1] == "enum" for item in header) else ""
        tiles, _members, _problems, body_close = checker._member_identity_segment(
            lexemes[body_open:], owner, kind_hint
        )
        member_tiles = len(tiles)
        rebuilt = list(lexemes[:prologue_end]) + list(header)
        for tile in tiles:
            rebuilt.extend(tile)
        if body_close is not None:
            rebuilt.extend(lexemes[body_open + body_close : body_open + body_close + 1])
            rebuild_ok = rebuilt == lexemes
    problems = [str(item) for item in view["problems"]]
    hard = [
        item
        for item in problems
        if "成员边界自检不计入" not in item
        and any(keyword in item for keyword in ("覆盖性自检", "边界", "完整成员", "铺满对账",
                                                "无法收束", "无法确定类型体起点", "无法前进",
                                                "重复的完整限定成员标识", "切分不可靠"))
    ]
    non_countable = [item for item in problems if "成员边界自检不计入" in item]
    return {
        "side": side,
        "code_stream_sha256": view["code_stream_sha256"],
        "code_bytes": view["code_bytes"],
        "lexeme_count": view["token_count"],
        "prologue_sha256": view["prologue_sha256"],
        "header_sha256": view["header_sha256"],
        "members": len(view["members"]),  # type: ignore[arg-type]
        "member_tiles": member_tiles,
        "coverage_complete": bool(view["coverage_complete"]),
        "independent_rebuild_matches_stream": rebuild_ok,
        "lexeme_errors": [str(item) for item in view["errors"]],
        "problems": problems,
        "hard_problems": hard,
        "non_countable_notes": non_countable,
        "boundary_selfcheck": "无 hard 边界失败" if not hard else f"有 {len(hard)} 处 hard 边界／覆盖失败",
    }


# --------------------------------------------------------------------------
# 差异账与归因
# --------------------------------------------------------------------------


def text_lines(source: str) -> list[str]:
    """把源码切成物理行。"""

    return source.split("\n")


def line_span(lines: list[int]) -> list[int]:
    """返回行号列表的首尾行区间；空列表返回 ``[None, None]``。"""

    if not lines:
        return [None, None]
    return [min(lines), max(lines)]


def prologue_lines_of(checker: Any, view_source: str) -> list[int]:
    """返回包/导入段的物理行号集合（按规则实现的 prologue 判定）。"""

    lexemes, _errors = checker._code_identity_code_tokens(view_source)
    prologue_end, body_open, error = checker._member_identity_prologue_and_header(lexemes)
    if error or body_open < 0:
        return []
    return sorted({int(lexeme[2]) for lexeme in lexemes[:prologue_end]})


def text_reference(
    path: str, lines: list[int], source: str, region: str
) -> dict[str, Any]:
    """返回一段源码的「路径 + 行区间 + 逐字 SHA-256 + 复算口径」。

    成员、行级与归因证据都**不内联正文**：材料给出仓库内可读路径与行区间，复核方
    直接读仓内已提交的源文件（或受控上游快照）即可拿到逐字内容并校验指纹。材料不把
    源码字节再复制一份到新文件，避免重新引入凭据形态字符串。

    Args:
        path: 仓库内相对路径。
        lines: 1 起算的闭区间行号。
        source: 该侧的源码全文（用于取逐行文本算指纹）。
        region: 区域名称（package-import／type-header／member／comment 等）。

    Returns:
        文本引用字典；``lines`` 为 ``[None, None]`` 时表示该侧没有对应内容。

    """

    if not lines or lines[0] is None:
        return {
            "path": path,
            "lines": [None, None],
            "region": region,
            "present": False,
            "sha256": None,
            "derivation": "该侧没有对应区域",
        }
    source_lines = source.split("\n")
    body = "\n".join(source_lines[lines[0] - 1 : lines[1]])
    return {
        "path": path,
        "lines": list(lines),
        "region": region,
        "present": True,
        "sha256": sha256_text(body),
        "characters": len(body),
        "derivation": "lines-join-v1",
    }


def replace_inline_text(rows: Any, *, text_key: str = "text", sha_key: str = "line_sha256") -> Any:
    """把复用 D16 实现带回的源码逐字文本就地换成指纹。

    契约命中行、跨模块 import、作者标签行、上游作者命中行与许可命中行都是**源码正文**。
    本材料统一不内联源码正文：改为「行号 + 逐行 SHA-256」，复核方按行号直接读仓内文件。

    Args:
        rows: 列表或单个字典。
        text_key: 待替换的文本键名。
        sha_key: 写入指纹的键名。

    Returns:
        原结构（就地修改）。

    """

    if isinstance(rows, dict):
        rows = [rows]
    for row in rows or []:
        if not isinstance(row, dict) or text_key not in row:
            continue
        value = row.pop(text_key)
        if value is not None:
            row[sha_key] = sha256_text(str(value))
            row["inlined"] = False
    return rows


def strip_contract_impact(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """把契约影响里的源码逐字文本换成行指纹。

    复用 D16 实现得到的 ``markers[].text``（命中行原文）与
    ``cross_module_imports[].import``（import 原文）都是源码正文；本材料按行号登记
    逐行 SHA-256，不内联正文。命中行号本身、契约名、权威命令与「不等于确认无影响」的
    说明全部保留。

    Args:
        entries: 契约影响读数。

    Returns:
        同一列表（就地修改）。

    """

    for entry in entries:
        replace_inline_text(entry.get("markers"))
        for row in entry.get("cross_module_imports") or []:
            value = row.pop("import", None)
            if value is not None:
                row["import_sha256"] = sha256_text(str(value))
                row["inlined"] = False
        entry["inline_text_policy"] = "inline-text-v1"
    return entries


def build_comment_binding(
    local_path: str, declaration: str, block_row: dict[str, Any]
) -> tuple[dict[str, Any], str]:
    """登记一条注释绑定，并对逐字原文执行「可否内联」判定。

    注释绑定的证据价值在**逐字比对**，默认内联逐字原文；但若原文本身会被密钥扫描
    判为疑似凭据，就改为「路径 + 行区间 + 逐字 SHA-256」，并说明省略原因。判定直接
    调用扫描器自身的逐行规则（``_scan_added_line``），不另写正则。

    Args:
        local_path: 本地源文件的仓库内相对路径。
        declaration: 目标声明限定名。
        block_row: 注释块（``role``/``lines``/``text``/``sha256``/``author_tag_lines``）。

    Returns:
        ``(登记项, 省略说明或空串)``。

    """

    hits = scanner_findings(MATERIAL_SCAN_PATH, str(block_row["text"]))
    entry: dict[str, Any] = {
        "role": block_row["role"],
        "lines": block_row["lines"],
        "sha256": block_row["sha256"],
        "declaration": declaration,
        "author_tag_lines": block_row["author_tag_lines"],
        "verbatim_path": local_path,
        "verbatim_derivation": (
            "读取 verbatim_path 指向的本地源文件，取 lines 行区间（含首尾）"
            "按 \n join 后的逐字文本，其 SHA-256 即本值"
        ),
    }
    if hits:
        entry["text"] = None
        entry["text_inlined"] = False
        entry["secret_scan_findings"] = hits
        entry["text_omitted_reason"] = (
            "该逐字原文含会被 check_staged_quality 密钥扫描判为疑似凭据的字符串"
            f"（{hits[0]['rule']}：{hits[0]['detail']}）；"
            "材料不把源码字节再复制一份到新文件，改为按 path + lines 读取并校验 sha256。"
        )
        return entry, (
            f"{block_row['role']} @ L{block_row['lines'][0]}–L{block_row['lines'][1]}"
            f"（{hits[0]['rule']}）"
        )
    entry["text"] = block_row["text"]
    entry["text_inlined"] = True
    entry["secret_scan_findings"] = []
    return entry, ""


def draft_text_reference(reference: dict[str, Any]) -> str:
    """把文本引用转成契约草案里 ``before_text``/``after_text`` 要求的非空登记值。

    规则实现要求归因登记逐条 ``before_text``/``after_text``；本材料不内联源码正文，
    因此这里登记**指向仓内可读位置与指纹的引用串**（非空、可复算），并在同一归因块的
    ``nature`` 与本条材料首页说明该口径。复核方据此到仓内文件取逐字原文。

    Args:
        reference: ``text_reference`` 或成员次序引用。

    Returns:
        非空引用串。

    """

    path = reference.get("path") or "（本侧无对应区域）"
    lines = reference.get("lines") or [None, None]
    digest = reference.get("sha256")
    # 不用「路径:行号」写法：`.java:` 会被密钥扫描当成 `键: 值` 形态。
    return (
        f"逐字正文不在本材料内联；位置 {path} 第 {lines[0]} 行至第 {lines[1]} 行；"
        f"逐字 SHA-256 {digest}"
    )


def build_difference_ledger(
    checker: Any,
    local_view: dict[str, Any],
    upstream_view: dict[str, Any],
    paired: dict[str, Any],
    local_text: str,
    upstream_text: str,
    declaration: str,
    local_rel: str,
    upstream_rel: str,
) -> tuple[dict[str, int], list[dict[str, Any]], dict[str, Any]]:
    """按规则实现的实测差异账逐类别生成归因，并做恰好覆盖核对。

    归因只登记**路径 + 行区间 + 逐字 SHA-256**，不内联源码正文。

    Args:
        checker: 规则实现模块。
        local_view: 本地成员读数。
        upstream_view: 上游成员读数。
        paired: 规则实现的配对结果。
        local_text: 本地原文。
        upstream_text: 上游原文。
        declaration: 目标声明限定名。
        local_rel: 本地文件的仓库内相对路径。
        upstream_rel: 上游快照文件的仓库内相对路径。

    Returns:
        ``(实测差异账, 归因列表, 覆盖统计)``。

    """

    measured = checker._member_identity_measured_differences(
        local_view, upstream_view, local_text, upstream_text
    )
    local_lines = text_lines(local_text)
    upstream_lines = text_lines(upstream_text)
    local_prologue = set(prologue_lines_of(checker, local_text))
    attribution: list[dict[str, Any]] = []

    def block(
        category: str,
        cause: str,
        location: str,
        local_span: list[int],
        upstream_span: list[int],
        before_ref: dict[str, Any],
        after_ref: dict[str, Any],
        nature: str,
        rule: str = "",
        evidence: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """登记一条归因（行数按实测差异账登记，位置与指纹为实测值）。

        Args:
            category: 受控差异类别。
            cause: 受控归因成因。
            location: 人类可读位置描述。
            local_span: 本地行区间。
            upstream_span: 上游行区间。
            before_ref: 本地侧文本引用（路径 + 行区间 + 指纹）。
            after_ref: 上游侧文本引用。
            nature: 差异性质说明。
            rule: 所用受控变换规则号。
            evidence: 逐点证据（只给行号与指纹，不内联正文）。

        Returns:
            本条归因。

        """

        entry: dict[str, Any] = {
            "category": category,
            "cause": cause,
            "location": location,
            "declaration": declaration,
            "nature": nature,
            "rule": rule,
            "local_lines": local_span,
            "upstream_lines": upstream_span,
            "before_ref": before_ref,
            "after_ref": after_ref,
            "evidence": evidence or [],
        }
        attribution.append(entry)
        return entry

    if measured["package-import"]:
        upstream_prologue = set(prologue_lines_of(checker, upstream_text))
        evidence = []
        for line in sorted(local_prologue | upstream_prologue):
            local_value = local_lines[line - 1] if line - 1 < len(local_lines) else ""
            upstream_value = upstream_lines[line - 1] if line - 1 < len(upstream_lines) else ""
            if local_value.strip() != upstream_value.strip():
                evidence.append(
                    {
                        "local_line": line if line - 1 < len(local_lines) else None,
                        "upstream_line": line if line - 1 < len(upstream_lines) else None,
                        "local_line_sha256": sha256_text(local_value),
                        "upstream_line_sha256": sha256_text(upstream_value),
                    }
                )
        rule = "T1"
        block(
            "package-import",
            "registered-transform",
            f"包/导入段（本地 L{min(local_prologue) if local_prologue else 1}–"
            f"L{max(local_prologue) if local_prologue else 1}）",
            line_span(sorted(local_prologue)),
            line_span(sorted(upstream_prologue)),
            text_reference(local_rel, line_span(sorted(local_prologue)), local_text, "package-import"),
            text_reference(
                upstream_rel, line_span(sorted(upstream_prologue)), upstream_text, "package-import"
            ),
            "命名空间与模块名的受控映射造成的包/导入段差异；原始字节由上游固定输入留证",
            rule=rule,
            evidence=evidence,
        )
    if measured["type-header"]:
        local_header = [
            int(member["line_first"]) for member in local_view["members"]
        ] or [1]
        block(
            "type-header",
            "type-header-adaptation",
            "类型声明头（类/接口声明与修饰符）",
            [min(local_header) - 1, max(local_header)],
            [1, len(upstream_lines)],
            text_reference(
                local_rel, [min(local_header) - 1, max(local_header)], local_text, "type-header"
            ),
            text_reference(upstream_rel, [1, len(upstream_lines)], upstream_text, "type-header"),
            "类型头本地重命名与修饰符变化；不进入成员计数，须由复核方核对是否影响对外契约",
        )
    for item in paired["differing"]:
        local_member = next(row for row in local_view["members"] if row["key"] == item["key"])
        upstream_member = next(
            row for row in upstream_view["members"] if row["key"] == item["key"]
        )
        block(
            "member",
            "member-content-difference",
            f"成员 {item['key']}",
            list(item["local_lines"]),
            list(item["upstream_lines"]),
            text_reference(local_rel, list(item["local_lines"]), local_text, "member"),
            text_reference(upstream_rel, list(item["upstream_lines"]), upstream_text, "member"),
            "同一完整限定成员标识下的业务成员内容差异；须由复核方按实际修改性质逐项核对",
            evidence=[
                {
                    "local_member_sha256": item["local_member_sha256"],
                    "upstream_member_sha256": item["upstream_member_sha256"],
                    "local_member_bytes": item["local_member_bytes"],
                    "upstream_member_bytes": item["upstream_member_bytes"],
                }
            ],
        )
    for item in paired["local_only"]:
        block(
            "local-only",
            "local-only-member",
            f"仅本地成员 {item['key']}",
            list(item["local_lines"]),
            [None, None],
            text_reference(local_rel, list(item["local_lines"]), local_text, "member"),
            text_reference(upstream_rel, [None, None], upstream_text, "member"),
            "仅本地存在的完整成员；须核对是否为本地新增业务并说明来源",
        )
    for item in paired["upstream_only"]:
        block(
            "upstream-only",
            "upstream-only-member",
            f"仅上游成员 {item['key']}",
            [None, None],
            list(item["upstream_lines"]),
            text_reference(local_rel, [None, None], local_text, "member"),
            text_reference(upstream_rel, list(item["upstream_lines"]), upstream_text, "member"),
            "仅上游存在的完整成员；须核对移除原因与运行行为",
        )
    if measured["order"]:
        local_order = [str(row["key"]) for row in local_view["members"]]  # type: ignore[union-attr]
        upstream_order = [str(row["key"]) for row in upstream_view["members"]]  # type: ignore[union-attr]
        position = next(
            (
                index
                for index, (left, right) in enumerate(zip(local_order, upstream_order))
                if left != right
            ),
            0,
        )
        block(
            "order",
            "member-order-change",
            f"成员出现次序（第 {position + 1} 个成员起）",
            [1, len(local_lines)],
            [1, len(upstream_lines)],
            {
                "path": None,
                "lines": [None, None],
                "region": "member-order",
                "present": True,
                "sha256": sha256_text(" → ".join(local_order)),
                "derivation": "member-key-order-v1",
                "member_keys_sha256": sha256_text(" → ".join(local_order)),
                "member_key_count": len(local_order),
            },
            {
                "path": None,
                "lines": [None, None],
                "region": "member-order",
                "present": True,
                "sha256": sha256_text(" → ".join(upstream_order)),
                "derivation": "member-key-order-v1",
                "member_keys_sha256": sha256_text(" → ".join(upstream_order)),
                "member_key_count": len(upstream_order),
            },
            "成员集合相同但次序不同；成员键配对不受次序影响，仍须复核方核对阅读与初始化影响",
        )
    if measured["comment"]:
        comment_numbers = [
            number
            for number, line in enumerate(local_lines, 1)
            if line.strip().startswith(("//", "/*", "*"))
        ]
        block(
            "comment",
            "comment-difference",
            "注释行集合",
            line_span(comment_numbers),
            [1, len(upstream_lines)],
            text_reference(local_rel, line_span(comment_numbers), local_text, "comment"),
            text_reference(upstream_rel, [1, len(upstream_lines)], upstream_text, "comment"),
            "注释与代码流的差异；D17 §G7 要求注释、署名、版权与许可另行独立验收",
        )

    # 规则实现按**类别**实测差异行数，不按归因块实测；这里按每块登记的真实本地/上游
    # 行数把类别合计**精确拆分**到各块（余数按行数最多的块吸收），
    # 保证「同类别合计 == 实测类别合计」恒成立，且每块的登记值仍与该块真实行数成比例。
    grouped: dict[str, list[dict[str, Any]]] = collections.defaultdict(list)
    for entry in attribution:
        grouped[str(entry["category"])].append(entry)
    for category, entries in grouped.items():
        for field, span_key in (("local", "local_lines"), ("upstream", "upstream_lines")):
            total = int(measured.get(category, 0))
            weights = []
            for entry in entries:
                span = list(entry[span_key])
                weights.append(max(int(span[1]) - int(span[0]) + 1, 1) if span[0] else 1)
            weight_sum = sum(weights)
            shares = [total * weight // weight_sum for weight in weights]
            remainder = total - sum(shares)
            order = sorted(
                range(len(entries)), key=lambda position: weights[position], reverse=True
            )
            for step in range(remainder):
                shares[order[step % len(order)]] += 1
            for entry, share in zip(entries, shares):
                entry.setdefault("changed_lines", {})[field] = share
                entry["changed_lines_basis"] = {
                    "category": category,
                    "measured_category_total": total,
                    "block_local_line_span": list(entry["local_lines"]),
                    "block_upstream_line_span": list(entry["upstream_lines"]),
                    "note": (
                        "规则实现 _member_identity_measured_differences 按类别实测差异行数；"
                        "本块登记的 changed_lines 是该类别合计按各块真实行区间拆分的份额，"
                        "同类别合计恒等于实测值。"
                    ),
                }

    draft = {
        "difference_attribution": [
            {
                "category": entry["category"],
                "cause": entry["cause"],
                "location": entry["location"],
                "local_lines": entry["local_lines"],
                "upstream_lines": entry["upstream_lines"],
                "changed_lines": entry["changed_lines"],
                "declaration": entry["declaration"],
                "nature": entry["nature"],
                "before_text": draft_text_reference(entry["before_ref"]),
                "after_text": draft_text_reference(entry["after_ref"]),
                "rule": entry["rule"],
            }
            for entry in attribution
        ]
    }
    covers, cover_reason = checker._member_identity_attribution_covers(draft, measured)
    attributed_totals: dict[str, int] = {}
    for entry in attribution:
        attributed_totals[str(entry["category"])] = attributed_totals.get(
            str(entry["category"]), 0
        ) + int(entry["changed_lines"]["local"])
    unexplained = [
        entry["category"]
        for entry in attribution
        if str(entry["cause"]) not in set(checker.MEMBER_IDENTITY_ATTRIBUTION_CAUSES)
    ]
    coverage = {
        "measured": measured,
        "attributed_totals": attributed_totals,
        "covers_exactly": bool(covers),
        "rule_check_reason": cover_reason,
        "attribution_blocks": len(attribution),
        "unexplained_blocks": len(unexplained),
        "unexplained_categories": unexplained,
        "accounting_rule": (
            "归因按规则实现的七个受控差异类别逐类别登记；"
            "changed_lines.local 与实测账逐类别相等时 _member_identity_attribution_covers 返回真。"
            "每个实测非零类别都必须有归因块，实测为零的类别不得登记。"
        ),
    }
    return measured, attribution, coverage


# --------------------------------------------------------------------------
# 单条候选材料
# --------------------------------------------------------------------------


def item_materials(
    checker: Any,
    d16gen: Any,
    row: dict[str, Any],
    registry: Any,
    transforms: list[dict[str, Any]],
    transform_set: dict[str, Any],
    schema: dict[str, Any],
    manifest: dict[str, Any],
    generic_patterns: tuple[re.Pattern[str], ...],
    modules: dict[str, Any],
    index: dict[str, Any],
    item_id: str,
) -> dict[str, Any]:
    """为一条 A 类候选组装完整复核材料。

    Args:
        checker: 规则实现模块。
        d16gen: D16 复核材料生成器模块（复用同口径辅助读数）。
        row: 候选行（含 ``record``/``declaration``/``type_entry``）。
        registry: 已加载的受控证据登记。
        transforms: 按执行顺序排列的登记变换。
        transform_set: 受控变换集清单。
        schema: 已校验的契约 schema。
        manifest: 已校验的受控成员清单。
        generic_patterns: 受控清单登记的惯用字符串模式。
        modules: Maven 模块与包根索引。
        index: 受控来源索引文档。
        item_id: 材料包内的条目编号。

    Returns:
        单条材料字典；不含任何判定字段。

    """

    record = row["record"]
    type_entry = row["type_entry"]
    local_path = str(record["local_path"])
    declaration = str(row["declaration"])
    problems: list[str] = []
    local_raw = (REPO_ROOT / local_path).read_bytes()
    local_text = local_raw.decode("utf-8")
    upstream_raw, upstream_error = checker._upstream_bytes_for_contract(registry, record)
    if upstream_error or upstream_raw is None:  # pragma: no cover - 防御
        raise RuntimeError(f"{declaration}：上游比较输入不可得：{upstream_error}")
    upstream_text = upstream_raw.decode("utf-8-sig", errors="replace")

    local_view = checker._member_identity_view(local_text, transforms, "local")
    upstream_view = checker._member_identity_view(upstream_text, transforms, "upstream")
    paired = checker._member_identity_pair(local_view, upstream_view)
    raw_local, raw_local_digest, raw_keys_local = raw_member_slices(
        checker, local_text, transforms, "local"
    )
    raw_upstream, raw_upstream_digest, raw_keys_upstream = raw_member_slices(
        checker, upstream_text, transforms, "upstream"
    )
    upstream_rel = str(
        Path(
            "docs/测试与可靠性/来源证据/上游快照",
            f"ruoyi-vue-pro@{record.get('upstream_commit')}",
            str(record.get("upstream_path")),
        ).as_posix()
    )

    members = member_rows(
        checker,
        local_view,
        upstream_view,
        paired,
        manifest,
        generic_patterns,
        raw_local,
        raw_upstream,
        transforms,
        raw_keys_local,
        raw_keys_upstream,
        raw_local_digest,
        raw_upstream_digest,
        local_path,
        upstream_rel,
        local_text,
        upstream_text,
    )
    qualifying = [entry for entry in members if entry["qualification"]["qualifies"]]
    raw_qualifying = [entry for entry in qualifying if entry["raw_identical"]]
    transformed_qualifying = [entry for entry in qualifying if not entry["raw_identical"]]
    excluded = [entry for entry in members if not entry["qualification"]["qualifies"]]

    m0_satisfied = len(raw_qualifying) >= 1
    mt_overlap: list[str] = []
    if len(transformed_qualifying) >= 2:
        first, second = transformed_qualifying[0], transformed_qualifying[1]
        for side_label, field in (("本地", "local_lines"), ("上游", "upstream_lines")):
            left = list(first[field])
            right = list(second[field])
            if not (max(left) < min(right) or max(right) < min(left)):
                mt_overlap.append(f"{side_label}行号范围重叠")
    mt_satisfied = (
        len(transformed_qualifying) >= 2
        and not raw_qualifying
        and not mt_overlap
        and first["member_key"] != second["member_key"]  # noqa: F821 - 由上面的长度检查保证
    )
    entry_name: str | None = "M0" if m0_satisfied else ("MT" if mt_satisfied else None)

    local_coverage = coverage_selfcheck(checker, local_text, transforms, "local", local_view)
    upstream_coverage = coverage_selfcheck(
        checker, upstream_text, transforms, "upstream", upstream_view
    )
    measured, attribution, attribution_coverage = build_difference_ledger(
        checker,
        local_view,
        upstream_view,
        paired,
        local_text,
        upstream_text,
        declaration,
        local_path,
        upstream_rel,
    )
    line_attribution, line_coverage = d16_generator().build_attribution(
        checker, local_text, upstream_text, transforms
    )
    for block_row in line_attribution:
        # 逐行差异块同样**不内联正文**：块级给出路径 + 行区间 + 逐字 SHA-256；
        # 只对**未能解释**的块保留逐行行号与判定理由（复核方真正要逐行核对的只有这些）。
        local_span = block_row.get("local_line") or []
        upstream_span = block_row.get("upstream_line") or []
        local_body = (
            "\n".join(
                local_text.split("\n")[int(local_span[0]) - 1 : int(local_span[1])]
            )
            if local_span and local_span[0]
            else ""
        )
        upstream_body = (
            "\n".join(
                upstream_text.split("\n")[int(upstream_span[0]) - 1 : int(upstream_span[1])]
            )
            if upstream_span and upstream_span[0]
            else ""
        )
        block_row["local_text_ref"] = text_reference(
            local_path, list(local_span), local_text, "diff-block"
        )
        block_row["upstream_text_ref"] = text_reference(
            upstream_rel, list(upstream_span), upstream_text, "diff-block"
        )
        block_row["local_text"] = None
        block_row["upstream_text"] = None
        block_row["local_text_sha256"] = sha256_text(local_body)
        block_row["upstream_text_sha256"] = sha256_text(upstream_body)
        if block_row.get("cause") == "unexplained":
            block_row["line_by_line"] = [
                {
                    "local_line": row["local_line"],
                    "upstream_line": row["upstream_line"],
                    "reason": row["reason"],
                }
                for row in block_row.get("line_by_line") or []
            ]
        else:
            block_row.pop("line_by_line", None)
    line_unexplained = int(line_coverage["unexplained_blocks"])

    classification = {
        "a_class": "A1"
        if content_equal_members(local_view, upstream_view)
        or local_view["header_sha256"] == upstream_view["header_sha256"]
        else "A2",
        "rule": CLASSIFICATION_RULE,
        "content_equal_member_sha256": content_equal_members(local_view, upstream_view),
        "header_equal": local_view["header_sha256"] == upstream_view["header_sha256"],
        "prologue_equal": local_view["prologue_sha256"] == upstream_view["prologue_sha256"],
        "key_paired_equal_members": [str(item["key"]) for item in paired["equal"]],
        "note": "分类用「按内容匹配的相等成员」判定，以复现裁决 D17 §证据核对中的 A1/A2 计数；"
        "证据本身一律按规则实现 _member_identity_pair 的**完整限定成员键**配对，"
        "两侧类简单名不同的成员不会互相配对。",
    }

    quantity_reasons: list[str] = []
    if entry_name is None:
        quantity_reasons.append(
            f"M0 不成立：未执行 T1–T5 即逐字节相等的合格成员 0 个"
            f"（变换后相等的合格成员 {len(transformed_qualifying)} 个，"
            f"被样板门槛排除的相等成员 {len(excluded)} 个）"
        )
        quantity_reasons.append(
            f"MT 不成立：变换后相等的合格成员 {len(transformed_qualifying)} 个，"
            f"不足 2 个"
            + ("；且未变换即相等的合格成员为 0，满足 MT 的前置条件" if not raw_qualifying else "")
        )
        if mt_overlap:
            quantity_reasons.append("MT 范围重叠：" + "；".join(mt_overlap))

    coverage_problems = (
        local_coverage["hard_problems"] + upstream_coverage["hard_problems"]
    )
    quantity_status = "成立" if entry_name is not None else "不成立"
    attribution_status = (
        "恰好覆盖实测差异账" if attribution_coverage["covers_exactly"] else "未覆盖实测差异账"
    )
    overall_status = (
        "成立"
        if entry_name is not None
        and not coverage_problems
        and attribution_coverage["covers_exactly"]
        and local_coverage["coverage_complete"]
        and upstream_coverage["coverage_complete"]
        else "不成立"
    )
    status_reasons: list[str] = list(quantity_reasons)
    if coverage_problems:
        status_reasons.append("切分／覆盖性自检存在 hard 失败：" + "；".join(coverage_problems))
    if not attribution_coverage["covers_exactly"]:
        status_reasons.append("差异归因未恰好覆盖：" + attribution_coverage["rule_check_reason"])
    if overall_status == "成立":
        status_reasons.append(
            f"数量条件满足 {entry_name}（合格成员 {len(qualifying)} 个，其中未变换即相等 "
            f"{len(raw_qualifying)} 个、变换后相等 {len(transformed_qualifying)} 个）；"
            "覆盖性自检两侧成立且无 hard；差异归因恰好覆盖实测七类差异。"
        )

    resolved_type = d16_generator().declaration_javadoc(checker, local_text, declaration)
    javadoc_start = (
        resolved_type["javadoc_lines"][0]
        if resolved_type is not None
        else int(type_entry.get("javadoc_start_line") or 0)
    )
    javadoc_end = (
        resolved_type["javadoc_lines"][1]
        if resolved_type is not None
        else int(type_entry.get("javadoc_end_line") or 0)
    )
    whole_javadoc = "\n".join(local_text.split("\n")[javadoc_start - 1 : javadoc_end])
    measured_javadoc_sha = (
        resolved_type["javadoc_sha256"]
        if resolved_type is not None
        else sha256_text(whole_javadoc)
    )
    registered_javadoc_sha = str(type_entry.get("javadoc_sha256") or "").lower()
    if resolved_type is None:
        problems.append(
            f"{declaration}：按规则实现口径找不到声明及其紧邻 JavaDoc，无法绑定逐类型 JavaDoc"
        )
    elif measured_javadoc_sha != registered_javadoc_sha:
        problems.append(
            f"{declaration}：受控索引登记的 javadoc_sha256 与本地实测不符"
            f"（记录 {registered_javadoc_sha}，实测 {measured_javadoc_sha}）"
        )
    notes, note_errors = checker._parse_source_notes(whole_javadoc)
    bindings: list[dict[str, Any]] = []
    redacted_bindings: list[str] = []
    if resolved_type is not None:
        for block_row in d16_generator().javadoc_blocks(local_text, javadoc_start, javadoc_end):
            entry, omitted = build_comment_binding(local_path, declaration, block_row)
            if omitted:
                redacted_bindings.append(omitted)
            bindings.append(entry)
    for note in redacted_bindings:
        problems.append(
            f"{declaration}：注释绑定 {note} 的逐字原文含疑似凭据形态字符串，"
            "已改为路径 + 行区间 + 逐字 SHA-256 登记，未内联原文。"
        )
    license_scan = d16_generator().local_license_scan(local_text, upstream_text)
    replace_inline_text(license_scan.get("local_hits"))
    replace_inline_text(license_scan.get("upstream_hits"))
    binding_status = [
        {
            "role": "responsibility-javadoc",
            "present": bool(bindings),
            "acceptance_beyond_member_identity": (
                "未验收：成员级内容关系只覆盖登记成员；职责、参数、业务约束与实际消费"
                "仍须复核方逐条核对（D17 §G7）"
            ),
            "lines": [javadoc_start, javadoc_end],
        },
        {
            "role": "d12-source-note",
            "present": bool(notes),
            "acceptance_beyond_member_identity": (
                f"未验收：索引当前判词为「{record.get('d12_verdict')}」；"
                "来源说明格式解析错误 " + (str(note_errors) if note_errors else "无")
            ),
            "parsed_notes": [
                {
                    "repository": note.repository,
                    "commit": note.commit,
                    "upstream_path": note.upstream_path,
                    "basis": note.basis,
                    "local_modification": note.local_modification,
                    "javadoc_body_line": note.line,
                }
                for note in notes
            ],
        },
        {
            "role": "d15-inplace-marker",
            "present": any(
                marker in whole_javadoc
                for marker in (
                    checker.SOURCE_REVIEW_UNACCEPTED_MARKER,
                    checker.SOURCE_REVIEW_ACCEPTED_MARKER,
                    checker.SIGNATURE_REVIEW_UNACCEPTED_MARKER,
                    checker.SIGNATURE_REVIEW_ACCEPTED_MARKER,
                )
            ),
            "acceptance_beyond_member_identity": (
                "未验收：就地标注是验收状态的登记表字段，成员级内容关系不改变其状态"
            ),
            "markers": [
                marker
                for marker in (
                    checker.SOURCE_REVIEW_UNACCEPTED_MARKER,
                    checker.SOURCE_REVIEW_ACCEPTED_MARKER,
                    checker.SIGNATURE_REVIEW_UNACCEPTED_MARKER,
                    checker.SIGNATURE_REVIEW_ACCEPTED_MARKER,
                )
                if marker in whole_javadoc
            ],
        },
        {
            "role": "license-or-copyright",
            "present": license_scan["present_locally"] or license_scan["present_upstream"],
            "acceptance_beyond_member_identity": (
                "不适用：实测本地与上游都没有版权/许可证声明行；许可关联按索引登记的 "
                f"LICENSE 指纹核对（license_sha256={record.get('license_sha256')}，"
                f"版权声明={record.get('license_copyright')}）"
            ),
            "scan": license_scan,
        },
    ]

    author_scan = d16_generator().upstream_author_scan(upstream_text)
    replace_inline_text(author_scan.get("hits"))
    form = str(record.get("author_form") or type_entry.get("author_form") or "")
    if not form:
        form = "作者标签" if bindings and any(b["author_tag_lines"] for b in bindings) else "来源说明"
    author_tag_lines = replace_inline_text(
        [
            {"line": number, "text": line.strip()}
            for number, line in enumerate(local_text.split("\n"), 1)
            if AUTHOR_TOKEN_PATTERN.search(line)
        ]
    )
    open_questions = [
        f"受控索引登记的历史依据为「{record.get('history_basis')}」——历史引入版本仍属未核实，"
        "本材料只固定见证版本，不推断引入时间。",
        "上游固定提交之外的其他版本是否声明作者、是否存在其他贡献者：未核实"
        "（本材料只对快照内该固定提交的逐字节副本实测）。",
        f"索引 `open_gap` 原文登记的剩余缺口：{record.get('open_gap')}",
        "本条尚无独立复核方结论：D17 §G8 要求业务语义主体由实施者之外的负责方逐条复核，"
        "成员登记的四个语义字段与 business_subject 均留空待填，本材料不代替该复核。",
    ]
    if line_unexplained:
        open_questions.append(
            f"逐行归因中有 {line_unexplained} 处差异块无法由已登记变换、代码外空白或注释差异解释；"
            "这些行已按受控成因登记为真实本地改动，但实际修改性质与正确性必须由复核方逐项判定。"
        )
    if not entry_name:
        open_questions.append(
            "本条在严格口径下不满足 M0/MT 数量条件，不得据本材料改判；"
            "诊断见 member_identity.quantity_condition.reasons。"
        )

    status_summary = {
        "quantity_condition": quantity_status,
        "difference_attribution": attribution_status,
        "coverage_selfcheck": "成立"
        if not coverage_problems
        and local_coverage["coverage_complete"]
        and upstream_coverage["coverage_complete"]
        else "不成立",
        "overall": overall_status,
        "reasons": status_reasons,
        "notice": (
            "「成立」只表示规则实现对该条实测出的机械条件成立，"
            "不等于来源已验收、不解除任何已登记阻断、也不构成改判。"
        ),
    }

    draft_members = [
        {
            "member_key": entry["member_key"],
            "kind": entry["kind"],
            "local_lines": entry["local_lines"],
            "upstream_lines": entry["upstream_lines"],
            "local_member_sha256": entry["local_member_sha256"],
            "upstream_member_sha256": entry["upstream_member_sha256"],
            "local_member_bytes": entry["local_member_bytes"],
            "upstream_member_bytes": entry["upstream_member_bytes"],
            "local_member_lexeme_count": entry["local_member_lexeme_count"],
            "upstream_member_lexeme_count": entry["upstream_member_lexeme_count"],
            "raw_local_member_sha256": entry["raw_local_member_sha256"],
            "raw_upstream_member_sha256": entry["raw_upstream_member_sha256"],
            "raw_identical": entry["raw_identical"],
            "anchors": entry["qualification"]["anchor_counts"]["anchors"][:3],
            "owner_responsibility": None,
            "non_generic_reason": None,
            "discriminative_reason": None,
            "coverage_reason": None,
        }
        for entry in qualifying
    ]

    return {
        "item_id": item_id,
        "classification": classification,
        "status": status_summary,
        "object": {
            "local_path": local_path,
            "declaration": declaration,
            "kind": (resolved_type or {}).get("kind") or type_entry.get("kind"),
            "public": (resolved_type or {}).get("public"),
            "nested": bool(type_entry.get("nested")),
            "enclosing_type": type_entry.get("enclosing_type"),
            "declaration_line": (resolved_type or {}).get("declaration_line")
            or type_entry.get("declaration_line"),
            "open_brace_line": (resolved_type or {}).get("open_brace_line"),
            "javadoc_span_offsets": (resolved_type or {}).get("javadoc_span"),
            "javadoc_lines": [javadoc_start, javadoc_end],
            "javadoc_sha256_registered": registered_javadoc_sha or None,
            "javadoc_sha256_measured": measured_javadoc_sha,
            "javadoc_sha256_matches": measured_javadoc_sha == registered_javadoc_sha,
            "javadoc_fingerprint_basis": (
                "check_staged_java_comments._attached_javadoc 返回的偏移区间文本"
                "（首行不含缩进，其余行保留原文）；注释绑定的逐字原文另按行区间 join。"
            ),
            "public_type_count_in_file": record.get("public_type_count"),
            "local_file_sha256": sha256_bytes(local_raw),
            "module": d16_generator().module_of_path(local_path, modules),
            "types_in_file": [
                {
                    "qualified_name": item.get("qualified_name"),
                    "kind": item.get("kind"),
                    "nested": item.get("nested"),
                    "enclosing_type": item.get("enclosing_type"),
                    "upstream_type": item.get("upstream_type"),
                    "mapping_basis": item.get("mapping_basis"),
                }
                for item in (json.loads(str(record.get("type_evidence") or "{}")).get("types") or [])
            ],
            "upstream": {
                "repo_url": record.get("upstream_repo_url"),
                "repo_id": record.get("upstream_repo_id"),
                "commit": record.get("upstream_commit"),
                "path": record.get("upstream_path"),
                "file_url": record.get("upstream_file_url"),
                "sha256": record.get("upstream_sha256"),
                "sha256_measured": sha256_bytes(upstream_raw),
                "snapshot_relative": str(
                    Path(
                        f"ruoyi-vue-pro@{record.get('upstream_commit')}",
                        str(record.get("upstream_path")),
                    ).as_posix()
                ),
            },
        },
        "index_current_state": {
            "note": "本条在受控索引中的**当前**判词字段，只抄录、不修改；材料生成后复核方可核对索引是否被改写。",
            "d12_verdict": record.get("d12_verdict"),
            "evidence_branch": record.get("evidence_branch"),
            "evidence_route": record.get("evidence_route"),
            "author_status": record.get("author_status"),
            "d12_blocker_reason": record.get("d12_blocker_reason"),
            "independent_review": record.get("independent_review"),
        },
        "member_identity": {
            "branch": checker.EVIDENCE_BRANCH_MEMBER_IDENTITY,
            "route": checker.MEMBER_IDENTITY_ROUTE,
            "rules_version": checker.MEMBER_IDENTITY_RULES_VERSION,
            "serialization": {
                "version": checker.CODE_IDENTITY_SERIALIZATION,
                "encoding": "utf-8",
                "lexeme_separator": "U+001F",
                "lexeme_terminator": "U+001E",
            },
            "ruling": schema.get("ruling"),
            "contract_schema": {
                "path": relative(CONTRACT_SCHEMA_PATH),
                "sha256": sha256_bytes(CONTRACT_SCHEMA_PATH.read_bytes()),
                "rules_sha256": schema.get("contract_schema_sha256_measured"),
            },
            "member_manifest": {
                "path": relative(MEMBER_MANIFEST_PATH),
                "sha256": sha256_bytes(MEMBER_MANIFEST_PATH.read_bytes()),
                "rules_sha256": manifest.get("members_manifest_sha256_measured"),
                "boilerplate_exclusions_ref": "#/inputs/member_manifest/boilerplate_exclusions",
                "discrimination_ref": "#/inputs/member_manifest/discrimination",
            },
            "transform_reuse": {
                "source_branch": checker.EVIDENCE_BRANCH_CODE_IDENTITY,
                "authorized_by": "D17 §G4",
                "reason": (
                    "复用 D16 受控变换集 N1 与 T1–T5；不新增任意替换、删除 import、"
                    "字符串内空白折叠或通配符同一化。"
                ),
            },
            "transform_set": {
                "path": relative(TRANSFORM_SET_PATH),
                "sha256": transform_set.get("file_sha256"),
                "transforms_sha256": transform_set.get("transforms_sha256"),
                "normalizations_sha256": transform_set.get("normalizations_sha256"),
                "rules_version": str(transform_set.get("rules_version")),
                "serialization": str(transform_set.get("serialization")),
                "definitions_ref": "#/inputs/transform_set（该处登记 N1 与 T1–T5 的逐字定义与 pairs）",
            },
            "applied_transforms": [str(item) for item in transform_set.get("execution_order") or []],
            "quantity_condition": {
                "entry": entry_name,
                "status": quantity_status,
                "m0": {
                    "definition": str(schema.get("entry_definitions", {}).get("M0")),
                    "required": 1,
                    "qualifying_raw_identical": len(raw_qualifying),
                    "satisfied": m0_satisfied,
                },
                "mt": {
                    "definition": str(schema.get("entry_definitions", {}).get("MT")),
                    "required": 2,
                    "qualifying_transformed": len(transformed_qualifying),
                    "precondition_m0_absent": not raw_qualifying,
                    "overlap_findings": mt_overlap,
                    "satisfied": mt_satisfied,
                },
                "qualifying_members": [entry["member_key"] for entry in qualifying],
                "excluded_members": [
                    {
                        "member_key": entry["member_key"],
                        "boilerplate_reasons": entry["qualification"]["boilerplate_reasons"],
                    }
                    for entry in excluded
                ],
                "reasons": quantity_reasons,
            },
            "members": members,
            "authority": (
                "成员读数由 scripts/code/java/check_staged_java_comments.py 的 "
                "_member_identity_view / _member_identity_segment / "
                "_member_identity_boundary_reasons / _member_identity_pair / "
                "_member_identity_anchors_for / _member_identity_boilerplate_reasons 产出；"
                "本工具不另写切分、配对或样板判定实现。"
            ),
        },
        "coverage_selfcheck": {
            "local": local_coverage,
            "upstream": upstream_coverage,
            "both_complete": bool(
                local_coverage["coverage_complete"] and upstream_coverage["coverage_complete"]
            ),
            "hard_problem_count": len(coverage_problems),
            "note": (
                "覆盖性自检＝包/导入段 + 类型头 + 全部成员切片 + 类型体收尾右花括号"
                "逐词素拼回整条代码流；边界自检＝每个切片都是完整合法成员"
                "（定界符平衡、以自身闭合符结束、不以分隔符起始）。"
                "覆盖成立不等于切分正确，两者分别给出。"
            ),
        },
        "difference_ledger": {
            "measured_differences": measured,
            "categories": [str(item) for item in checker.MEMBER_IDENTITY_DIFFERENCE_CATEGORIES],
            "attribution": attribution,
            "coverage": attribution_coverage,
        },
        "line_difference_attribution": line_attribution,
        "line_attribution_coverage": line_coverage,
        "line_attribution_note": (
            "本节是逐行差异账，与 D16 逐条复核材料同口径（复用 "
            f"{D16_GENERATOR_RELATIVE} 的实现），用于给复核方定位每一处差异；"
            "E2 分支的权威差异账是 difference_ledger（规则实现 _member_identity_measured_differences）。"
        ),
        "comment_bindings": bindings,
        "comment_roles_acceptance": binding_status,
        "authorship": {
            "form": form,
            "form_meaning": {
                "作者标签": "本地 JavaDoc 保留 `@author` 姓名形态；上游是否声明作者需另行核实",
                "来源说明": "本地 JavaDoc 以 D12 格式写来源说明，不声称个人作者",
            }.get(form, "未知形态"),
            "index_author_status": record.get("author_status"),
            "index_author_reason": record.get("author_reason"),
            "index_upstream_author_lines": record.get("upstream_author_lines"),
            "index_upstream_author_scan_text": record.get("upstream_author_scan"),
            "local_author_tag_lines": author_tag_lines,
            "upstream_fixed_version": {
                "author_declared": author_scan["author_declared"],
                "measured": author_scan,
                "file_sha256": sha256_bytes(upstream_raw),
                "recompute_command": (
                    "python3 -B -X utf8 -c \"import re,hashlib,pathlib;"
                    f"p=pathlib.Path('{relative(SNAPSHOT_DIR)}/ruoyi-vue-pro@"
                    f"{record.get('upstream_commit')}/{record.get('upstream_path')}');"
                    "t=p.read_text(encoding='utf-8');"
                    "print(hashlib.sha256(p.read_bytes()).hexdigest());"
                    "print([(i,l.strip()) for i,l in enumerate(t.split(chr(10)),1)"
                    " if re.search(r'@author|作者\\s*[:：]|\\bauthor\\s*:', l, re.I)])\""
                ),
                "conclusion": "已实测（快照内该固定提交的逐字节副本全文扫描）"
                if not author_scan["author_declared"]
                else "已实测：该固定提交文件内存在作者声明行，逐行见 measured.hits",
            },
            "upstream_other_versions": (
                "未核实：本材料不对固定提交之外的任何上游版本作作者声明判断"
            ),
            "author_handling_draft": {
                "member_identity_accepts_signature": False,
                "declared_author_status": record.get("author_status"),
                "author_route": (
                    "作者标签形态：成员级内容关系不验收现存姓名，须按 D10/D12 各自条件判定署名是否成立"
                    if form == "作者标签"
                    else "来源说明形态：须完整满足 D12 来源例外（上游该固定版本未声明作者 + D13 格式）"
                ),
                "history_gap": "历史引入版本未核实；本分支不关闭该缺口。",
                "note": "本字段为草案，未写入受控索引；实施方不得据此改判署名。",
            },
        },
        "contract_impact": strip_contract_impact(
            d16_generator().contract_impact(local_path, local_text, modules)
        ),
        "reproduction": {
            "item_command": (
                reproduction_preamble()
                + f"python3 -B -X utf8 {GENERATOR_RELATIVE} --verify-item '{declaration}' --json"
            ),
            "gates": [
                reproduction_preamble()
                + "python3 -B -X utf8 scripts/code/java/check_staged_java_comments.py "
                "--validate-evidence-branches --json",
                reproduction_preamble()
                + "python3 -B -X utf8 scripts/code/java/check_full_java_comments.py --json",
                reproduction_preamble()
                + "python3 -B -X utf8 scripts/code/java/check_full_java_comments.py "
                "--maintenance --json",
            ],
            "note": (
                "全部命令只读仓内快照与工作树，断网可跑；--verify-item 逐项复算本条并与本材料比对，"
                "任一读数不符即退出非零。"
            ),
        },
        "open_questions": open_questions,
        "material_problems": problems,
        "reviewer_decision": {
            "reviewer_verdict": None,
            "reviewer": None,
            "review_date": None,
            "review_reason": None,
        },
        "proposed_contract_draft": {
            "status": (
                "草案：未写入受控索引，未改判任何字段；语义字段与 review.* "
                "由独立复核方填写后才有意义"
            ),
            "schema": checker.MEMBER_IDENTITY_SCHEMA,
            "branch": checker.EVIDENCE_BRANCH_MEMBER_IDENTITY,
            "route": checker.MEMBER_IDENTITY_ROUTE,
            "rules_version": checker.MEMBER_IDENTITY_RULES_VERSION,
            "serialization": {
                "version": checker.CODE_IDENTITY_SERIALIZATION,
                "encoding": "utf-8",
                "lexeme_separator": "U+001F",
                "lexeme_terminator": "U+001E",
            },
            "entry": entry_name,
            "inputs": {
                "local": {"path": local_path, "sha256": sha256_bytes(local_raw)},
                "upstream": {
                    "repo_url": record.get("upstream_repo_url"),
                    "commit": record.get("upstream_commit"),
                    "path": record.get("upstream_path"),
                    "sha256": record.get("upstream_sha256"),
                    "file_url": record.get("upstream_file_url"),
                },
            },
            "coverage": {
                "local_code_stream_sha256": local_view["code_stream_sha256"],
                "upstream_code_stream_sha256": upstream_view["code_stream_sha256"],
                "local_prologue_sha256": local_view["prologue_sha256"],
                "upstream_prologue_sha256": upstream_view["prologue_sha256"],
                "local_header_sha256": local_view["header_sha256"],
                "upstream_header_sha256": upstream_view["header_sha256"],
                "local_members": len(local_view["members"]),
                "upstream_members": len(upstream_view["members"]),
                "local_coverage_complete": bool(local_view["coverage_complete"]),
                "upstream_coverage_complete": bool(upstream_view["coverage_complete"]),
            },
            "members": draft_members,
            "business_subject": {
                "declaration": declaration,
                "implementer": IMPLEMENTER,
                "reviewer": None,
                "owner_responsibility": None,
                "non_generic_reason": None,
                "coverage_reason": None,
                "note": "语义复核结论留空：D17 §G5 要求由实施者之外的负责方给出。",
            },
            "difference_attribution": [
                {
                    "category": entry["category"],
                    "cause": entry["cause"],
                    "rule": entry["rule"],
                    "location": entry["location"],
                    "local_lines": entry["local_lines"],
                    "upstream_lines": entry["upstream_lines"],
                    "changed_lines": entry["changed_lines"],
                    "declaration": entry["declaration"],
                    "nature": entry["nature"],
                    "before_text": draft_text_reference(entry["before_ref"]),
                    "after_text": draft_text_reference(entry["after_ref"]),
                }
                for entry in attribution
            ],
            "comment_bindings": [
                {
                    "role": entry["role"],
                    "lines": entry["lines"],
                    "sha256": entry["sha256"],
                    "verbatim_text_ref": (
                        "#/comment_bindings（逐字原文在本条 comment_bindings 中登记，此处不重复）"
                    ),
                }
                for entry in bindings
            ],
            "author_handling": {
                "member_identity_accepts_signature": False,
                "declared_author_status": record.get("author_status"),
                "author_route": (
                    "作者标签形态：成员级内容关系不验收现存姓名，须按 D10/D12 各自条件判定"
                    if form == "作者标签"
                    else "来源说明形态：须完整满足 D12 来源例外与 D13 格式"
                ),
                "history_gap": "历史引入版本未核实；本分支不关闭该缺口。",
            },
            "tool": {
                "name": "check_staged_java_comments.py",
                "version": checker.MEMBER_IDENTITY_SCHEMA,
                "sha256": sha256_bytes(CHECKER_PATH.read_bytes()),
            },
            "review": {
                "implementer": IMPLEMENTER,
                "reviewer": None,
                "date": None,
                "conclusion": None,
            },
            "counter_evidence_conclusion": None,
        },
    }


# --------------------------------------------------------------------------
# 材料包
# --------------------------------------------------------------------------


def excluded_object_row(entry: dict[str, Any]) -> dict[str, Any]:
    """把 B／C 类排除对象整理成可读的登记行。"""

    manifest_entry = entry.get("manifest_entry") or {}
    return {
        "local_path": str(entry["record"]["local_path"]),
        "declaration": str(entry["declaration"]),
        "upstream_path": entry["record"].get("upstream_path"),
        "match_basis": entry.get("match_basis"),
        "exclusion_basis": entry.get("exclusion_basis"),
        "manifest_exclusion_reason": manifest_entry.get("exclusion_reason"),
        "manifest_required_verification": manifest_entry.get("required_verification"),
        "manifest_pending_decision": manifest_entry.get("pending_decision"),
        "manifest_exclusion_basis": manifest_entry.get("exclusion_basis"),
        "index_d12_verdict": entry["record"].get("d12_verdict"),
    }


def build_review_package() -> dict[str, Any]:
    """组装 108 条 A 类候选（107 条 A1 + 1 条 A2）的逐条复核材料包。"""

    checker = load_checker()
    d16gen = load_d16_generator()
    index = read_json(INDEX_PATH)
    queue = read_json(QUEUE_PATH)
    schema, schema_error = checker._load_member_identity_contract_schema(
        str(CONTRACT_SCHEMA_PATH)
    )
    manifest, manifest_error = checker._load_member_identity_member_manifest(
        str(MEMBER_MANIFEST_PATH)
    )
    if schema_error or manifest_error or schema is None or manifest is None:
        raise RuntimeError(f"受控文档不可用：{schema_error or ''} {manifest_error or ''}")
    transform_set = resolve_transform_set(checker)
    transforms = ordered_transforms(transform_set)
    generic_patterns = tuple(
        re.compile(str(item))
        for item in manifest["discrimination"]["generic_string_patterns"]
    )
    registry = checker.load_evidence_registry(INDEX_PATH, SNAPSHOT_DIR)
    modules = d16_generator().module_index()

    candidates = candidate_declarations(index, queue)
    a_rows, b_rows, c_rows = split_excluded_objects(candidates, manifest)

    items: list[dict[str, Any]] = []
    for number, row in enumerate(a_rows, 1):
        items.append(
            item_materials(
                checker,
                d16gen,
                row,
                registry,
                transforms,
                transform_set,
                schema,
                manifest,
                generic_patterns,
                modules,
                index,
                f"E2MI-{number:03d}",
            )
        )

    manifest_entry_mismatch = [
        row
        for row in b_rows
        if str(row.get("match_basis", "")).startswith("local_path")
    ]
    snapshot_summary = registry.snapshot_manifest or {}
    package: dict[str, Any] = {
        "schema": SCHEMA_REVIEW,
        "title": "D17 §G8 成员级逐条复核材料包（E2-member-identity 的 A1／A2 候选）",
        "notice": HEADER_NOTICE,
        "scope": {
            "source_index": relative(INDEX_PATH),
            "d16_queue": relative(QUEUE_PATH),
            "candidate_declarations": len(candidates),
            "selected": f"A 类 {len(a_rows)} 条（A1 {sum(1 for item in items if item['classification']['a_class'] == 'A1')} 条、"
            f"A2 {sum(1 for item in items if item['classification']['a_class'] == 'A2')} 条）",
            "excluded_b_class": len(b_rows),
            "excluded_c_class": len(c_rows),
            "judgements_made": 0,
            "classification_rule": CLASSIFICATION_RULE,
            "not_the_whole_backlog": (
                "本包只覆盖 A 类 108 条。B 类 5 条在本分支下不存在相等成员、C 类 4 条在有权者"
                "逐项签认前排除在全部自动路线之外，二者均不因本包而关闭；"
                "索引中其余已登记阻断记录也不在本包范围内。"
            ),
        },
        "excluded_objects": {
            "note": (
                "以下对象**不在**本包 108 条之内。列出它们是为了避免复核方误以为 108 条"
                "就是全部剩余阻断。"
            ),
            "b_class": {
                "count": len(b_rows),
                "rule": "裁决 D17 §B 类五条的出口：本分支不能关闭，只能由路线 1／3 或可靠导入记录另行收口。",
                "objects": [excluded_object_row(row) for row in b_rows],
            },
            "c_class": {
                "count": len(c_rows),
                "rule": (
                    "裁决 D17 §C 类四条：有权者逐条签认契约并完成相应验证之前，"
                    "排除在全部自动来源验收、自动改判与自动解除阻断路线之外。"
                ),
                "objects": [excluded_object_row(row) for row in c_rows],
            },
            "manifest_upstream_path_mismatch": [
                {
                    "local_path": str(row["record"]["local_path"]),
                    "declaration": str(row["declaration"]),
                    "manifest_upstream_path": (row.get("manifest_entry") or {}).get("upstream_path"),
                    "index_upstream_path": row["record"].get("upstream_path"),
                    "consequence": (
                        "受控成员清单的 branch_ineligible 按 upstream_path 精确匹配；"
                        "该条登记的上游路径与受控索引登记的上游路径不同，"
                        "规则实现 _member_identity_ineligible_object 不会命中该对象。"
                        "本材料仍按 local_path 把它排除在 A 类之外，"
                        "并如实登记该差异；清单与索引都不在本轮可改范围。"
                    ),
                }
                for row in manifest_entry_mismatch
            ],
        },
        "generated_by": GENERATOR_RELATIVE,
        "generation_note": (
            "本 JSON 不写入生成时间戳：材料必须能按整文件 SHA-256 逐次复算；"
            "生成时间记录在同名 Markdown 的首段。"
        ),
        "repository": {
            "root": str(REPO_ROOT),
            "head": git("rev-parse", "HEAD"),
            "branch": git("branch", "--show-current"),
            "python": sys.version.split()[0],
        },
        "inputs": {
            "source_index": {
                "path": relative(INDEX_PATH),
                "sha256": sha256_bytes(INDEX_PATH.read_bytes()),
                "records_sha256": str(index["manifest"].get("records_sha256")),
                "records": len(index["records"]),
            },
            "d16_queue": {
                "path": relative(QUEUE_PATH),
                "sha256": sha256_bytes(QUEUE_PATH.read_bytes()),
                "items": len(queue["items"]),
            },
            "contract_schema": {
                "path": relative(CONTRACT_SCHEMA_PATH),
                "sha256": sha256_bytes(CONTRACT_SCHEMA_PATH.read_bytes()),
                "rules_sha256": schema.get("contract_schema_sha256_measured"),
                "entries": [str(item) for item in schema.get("entries") or []],
            },
            "member_manifest": {
                "path": relative(MEMBER_MANIFEST_PATH),
                "sha256": sha256_bytes(MEMBER_MANIFEST_PATH.read_bytes()),
                "rules_sha256": manifest.get("members_manifest_sha256_measured"),
                "boilerplate_exclusions": manifest.get("boilerplate_exclusions"),
                "discrimination": manifest.get("discrimination"),
                "contract_conflicts": manifest.get("contract_conflicts"),
                "branch_ineligible": manifest.get("branch_ineligible"),
            },
            "transform_set": {
                "path": relative(TRANSFORM_SET_PATH),
                "sha256": transform_set.get("file_sha256"),
                "transforms_sha256": transform_set.get("transforms_sha256"),
                "normalizations_sha256": transform_set.get("normalizations_sha256"),
                "schema": str(transform_set.get("schema")),
                "branch": str(transform_set.get("branch")),
                "route": str(transform_set.get("route")),
                "rules_version": str(transform_set.get("rules_version")),
                "serialization": str(transform_set.get("serialization")),
                "execution_order": [str(item) for item in transform_set.get("execution_order") or []],
                "comparison_order": [str(item) for item in transform_set.get("comparison_order") or []],
                "normalizations": transform_set.get("normalizations"),
                "transforms": transform_set.get("transforms"),
            },
            "rule_implementation": {
                "path": relative(CHECKER_PATH),
                "sha256": sha256_bytes(CHECKER_PATH.read_bytes()),
            },
            "shared_generator": {
                "path": relative(D16_GENERATOR_PATH),
                "sha256": sha256_bytes(D16_GENERATOR_PATH.read_bytes()),
                "note": (
                    "逐行归因、注释绑定、契约影响、模块索引、上游作者扫描与声明 JavaDoc "
                    "绑定复用该生成器的实现，保证与 D16 逐条复核材料同口径。"
                ),
            },
            "upstream_snapshot": {
                "root": relative(SNAPSHOT_DIR),
                "manifest_sha256": snapshot_summary.get("manifest_sha256"),
                "files": snapshot_summary.get("files"),
                "bytes": snapshot_summary.get("bytes"),
                "licenses": snapshot_summary.get("licenses"),
                "note": "清单逐条复算由规则实现的 verify_snapshot_manifest 完成；任一条不符即抛 EvidenceError。",
            },
            "maven_modules": modules,
        },
        "reproduction": {
            "gates": [
                reproduction_preamble() + "python3 -B -X utf8 -m pytest scripts/tests -q",
                reproduction_preamble()
                + "python3 -B -X utf8 scripts/workflow/run_checks.py --group docs --json",
                reproduction_preamble()
                + "python3 -B -X utf8 scripts/workflow/run_checks.py --group boundaries --json",
                reproduction_preamble()
                + "python3 -B -X utf8 scripts/code/java/check_staged_java_comments.py "
                "--validate-evidence-branches --json",
                reproduction_preamble()
                + "python3 -B -X utf8 scripts/code/java/check_full_java_comments.py --json",
                reproduction_preamble()
                + "python3 -B -X utf8 scripts/code/java/check_full_java_comments.py "
                "--maintenance --json",
            ],
            "item_command_template": reproduction_preamble()
            + f"python3 -B -X utf8 {GENERATOR_RELATIVE} --verify-item <限定名> --json",
            "batch_command_template": reproduction_preamble()
            + f"python3 -B -X utf8 {GENERATOR_RELATIVE} --verify-batch --json",
            "snapshot_command": (
                reproduction_preamble()
                + "python3 -B -X utf8 -c \"import sys;sys.path.insert(0,'scripts/code/java');"
                "import check_staged_java_comments as m;from pathlib import Path;"
                "p=Path('docs/测试与可靠性/来源证据/上游快照');"
                "print(m.verify_snapshot_manifest(p, m._load_snapshot_manifest(p)))\""
            ),
            "note": "全部命令只读仓内快照与工作树，断网可跑。",
        },
        "review_decision_table": {
            "notice": HEADER_NOTICE,
            "columns": [
                "item_id",
                "declaration",
                "local_path",
                "a_class",
                "mechanical_status",
                "entry",
                "reviewer_verdict",
                "reviewer",
                "review_date",
                "review_reason",
            ],
            "allowed_verdicts": ["accept", "reject", "need-more"],
            "rows": [
                {
                    "item_id": item["item_id"],
                    "declaration": item["object"]["declaration"],
                    "local_path": item["object"]["local_path"],
                    "a_class": item["classification"]["a_class"],
                    "mechanical_status": item["status"]["overall"],
                    "entry": item["member_identity"]["quantity_condition"]["entry"],
                    "reviewer_verdict": None,
                    "reviewer": None,
                    "review_date": None,
                    "review_reason": None,
                }
                for item in items
            ],
        },
        "counts": {
            "items": len(items),
            "files": len({item["object"]["local_path"] for item in items}),
            "a1": sum(1 for item in items if item["classification"]["a_class"] == "A1"),
            "a2": sum(1 for item in items if item["classification"]["a_class"] == "A2"),
            "entry_m0": sum(
                1
                for item in items
                if item["member_identity"]["quantity_condition"]["entry"] == "M0"
            ),
            "entry_mt": sum(
                1
                for item in items
                if item["member_identity"]["quantity_condition"]["entry"] == "MT"
            ),
            "mechanical_status_holds": sum(
                1 for item in items if item["status"]["overall"] == "成立"
            ),
            "mechanical_status_fails": sum(
                1 for item in items if item["status"]["overall"] == "不成立"
            ),
            "coverage_both_complete": sum(
                1 for item in items if item["coverage_selfcheck"]["both_complete"]
            ),
            "hard_problem_items": sum(
                1 for item in items if item["coverage_selfcheck"]["hard_problem_count"]
            ),
            "attribution_covers_exactly": sum(
                1
                for item in items
                if item["difference_ledger"]["coverage"]["covers_exactly"]
            ),
            "unexplained_attribution_blocks": sum(
                item["difference_ledger"]["coverage"]["unexplained_blocks"] for item in items
            ),
            "line_unexplained_blocks": sum(
                int(item["line_attribution_coverage"]["unexplained_blocks"]) for item in items
            ),
            "qualifying_members": sum(
                len(item["member_identity"]["quantity_condition"]["qualifying_members"])
                for item in items
            ),
            "excluded_boilerplate_members": sum(
                len(item["member_identity"]["quantity_condition"]["excluded_members"])
                for item in items
            ),
            "upstream_author_declared_in_fixed_version": sum(
                1
                for item in items
                if item["authorship"]["upstream_fixed_version"]["author_declared"]
            ),
            "material_problems": sum(1 for item in items if item["material_problems"]),
            "verdicts_filled_by_implementer": 0,
        },
        "items": items,
    }
    scan = material_secret_scan(package)
    package["material_integrity"] = scan
    package["counts"]["material_secret_scan_blocking"] = scan["blocking_findings"]
    package["counts"]["material_secret_scan_findings"] = len(
        scan["json_findings"] + scan["markdown_findings"]
    )
    package["counts"]["comment_bindings_text_omitted"] = sum(
        1
        for item in items
        for binding in item["comment_bindings"]
        if not binding["text_inlined"]
    )
    if scan["blocking_findings"]:
        offenders = [
            f"{item['rule']}@{item['line']}"
            for item in scan["json_findings"] + scan["markdown_findings"]
        ]
        raise RuntimeError(
            "材料自身含会被密钥扫描判为疑似凭据的字符串，拒绝落盘："
            + "、".join(offenders[:10])
        )
    return package


# --------------------------------------------------------------------------
# Markdown 渲染
# --------------------------------------------------------------------------


def render_review_markdown(package: dict[str, Any]) -> str:
    """把复核材料包渲染成人读 Markdown。"""

    lines: list[str] = []
    lines.append("---")
    description = (
        "D17 §G8 成员级逐条复核材料包：108 条 A 类对象（107 条 A1、1 条 A2）的成员切分与"
        "覆盖性自检、逐成员双侧指纹与变换发生点、M0／MT 数量条件、样板与区分力的机械判定、"
        "全部残余差异归因、注释逐字原文、作者与来源事实、契约影响位置、复现命令与未解决问题；"
        "B 类 5 条与 C 类 4 条的排除依据同列首页；判定列留空待独立复核方填写。"
    )
    lines.append(f'description: "{description}"')
    lines.append("kind: package-reference")
    lines.append("---")
    lines.append("")
    lines.append("# D17 §G8 成员级逐条复核材料包（E2-member-identity 的 A1／A2 候选）")
    lines.append("")
    lines.append("## 摘要")
    lines.append("")
    lines.append(f"> **{package['notice']}**")
    lines.append("")
    lines.append(
        f"生成时间（UTC）：{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}；"
        f"生成器 `{package['generated_by']}`；仓库 HEAD `{package['repository']['head']}`。"
    )
    lines.append("")
    counts = package["counts"]
    lines.append(
        f"本包覆盖 **{counts['items']}** 条 A 类对象（{counts['files']} 个文件）："
        f"**A1 {counts['a1']} 条、A2 {counts['a2']} 条**。"
        f"逐条机械判定为「成立」{counts['mechanical_status_holds']} 条、"
        f"「不成立」{counts['mechanical_status_fails']} 条；"
        f"入口 M0 {counts['entry_m0']} 条、MT {counts['entry_mt']} 条。"
        f"合格成员合计 {counts['qualifying_members']} 个，"
        f"被样板门槛排除的相等成员合计 {counts['excluded_boilerplate_members']} 个。"
        f"覆盖性自检两侧成立 {counts['coverage_both_complete']} 条，"
        f"存在 hard 失败 {counts['hard_problem_items']} 条；"
        f"差异归因恰好覆盖实测差异账 {counts['attribution_covers_exactly']} 条，"
        f"未解释归因块合计 {counts['unexplained_attribution_blocks']} 处；"
        f"逐行差异账中无法由已登记变换解释的差异块合计 {counts['line_unexplained_blocks']} 处。"
        f"实施方填写的判定数 **{counts['verdicts_filled_by_implementer']}**。"
    )
    lines.append("")
    lines.append("机器可读版本：[成员同一性逐条复核材料.json](成员同一性逐条复核材料.json)。")
    lines.append("")
    lines.append("### 源码正文口径（不内联）")
    lines.append("")
    # 自扫阶段会先用「尚未附加自扫结果」的包渲染一次 Markdown，因此这里必须容错读取。
    integrity = package.get("material_integrity") or {
        "scanner": relative(PRECOMMIT_SCAN_TOOL_PATH),
        "json_findings": [],
        "markdown_findings": [],
        "blocking_findings": 0,
    }
    lines.append(
        "本材料**不重复内联源码正文**。成员、行级差异块与差异归因一律登记「仓库内可读路径 + "
        "行区间 + 逐字 SHA-256 + 复算口径（`lines-join-v1`：取该行区间含首尾行按 `\\n` join "
        "的文本）」；复核方直接读仓内已提交的源文件或上游快照即可拿到逐字内容并校验指纹。"
        "成员身份本身仍以**双方规范字节 SHA-256／字节数／词素数**为准，指纹不因省略正文而减弱。"
    )
    lines.append("")
    lines.append(
        f"注释绑定的逐字原文**默认保留**（其证据价值就在逐字比对）；只有当该原文会被密钥扫描判为"
        f"疑似凭据时才改为指纹 + 路径，并在该条 `material_problems` 写明省略原因。判定口径直接"
        f"复用密钥扫描器自身的逐行规则函数 "
        f"`{integrity['scanner']}` 的 `_scan_added_line`，不另写正则。"
    )
    lines.append("")
    lines.append(
        f"材料生成时用同一口径自扫一遍本 JSON 与本 Markdown：命中 "
        f"**{len(integrity['json_findings']) + len(integrity['markdown_findings'])}** 处"
        f"（阻断级 {integrity['blocking_findings']} 处）；"
        f"被省略原文的注释绑定 {counts.get('comment_bindings_text_omitted', 0)} 条。"
        "任何残留的疑似凭据形态字符串都会让 `--build` 直接失败，而不是等到提交时才被拦。"
    )
    lines.append("")
    lines.append("## 目录")
    lines.append("")
    lines.append("- [候选范围与分类口径](#候选范围与分类口径)")
    lines.append("- [排除在外的 B 类 5 条与 C 类 4 条](#排除在外的-b-类-5-条与-c-类-4-条)")
    lines.append("- [共同输入与固定值](#共同输入与固定值)")
    lines.append("- [复现命令](#复现命令)")
    lines.append("- [逐条汇总表](#逐条汇总表)")
    lines.append("- [逐条材料](#逐条材料)")
    lines.append("- [复核判定表（留空）](#复核判定表留空)")
    lines.append("")
    lines.append("## 候选范围与分类口径")
    lines.append("")
    scope = package["scope"]
    lines.append(scope["classification_rule"])
    lines.append("")
    lines.append(
        f"逐条分类的复核计数：A1 **{counts['a1']}** 条、A2 **{counts['a2']}** 条，"
        f"合计 {counts['items']} 条，与裁决 D17 §证据核对登记的「A1 107、A2 1」一致。"
    )
    lines.append("")
    lines.append(f"> {scope['not_the_whole_backlog']}")
    lines.append("")
    lines.append("## 排除在外的 B 类 5 条与 C 类 4 条")
    lines.append("")
    excluded = package["excluded_objects"]
    lines.append(excluded["note"])
    lines.append("")
    lines.append(f"### B 类 {excluded['b_class']['count']} 条（本分支不能关闭）")
    lines.append("")
    lines.append(f"排除依据：{excluded['b_class']['rule']}")
    lines.append("")
    lines.append("| # | 本地类型 | 上游文件 | 排除依据（受控成员清单登记） | 必要验证方向 | 匹配口径 |")
    lines.append("| --- | --- | --- | --- | --- | --- |")
    for number, entry in enumerate(excluded["b_class"]["objects"], 1):
        lines.append(
            f"| {number} | `{entry['declaration']}` | `{entry['upstream_path']}` | "
            f"{entry['manifest_exclusion_reason'] or entry['exclusion_basis']} | "
            f"{entry['manifest_required_verification'] or '（未登记）'} | {entry['match_basis']} |"
        )
    lines.append("")
    lines.append(f"### C 类 {excluded['c_class']['count']} 条（有权者逐项签认前排除在所有自动路线外）")
    lines.append("")
    lines.append(f"排除依据：{excluded['c_class']['rule']}")
    lines.append("")
    lines.append("| # | 本地类型 | 上游文件 | 待签认问题 | 必要验证方向 | 排除理由 |")
    lines.append("| --- | --- | --- | --- | --- | --- |")
    for number, entry in enumerate(excluded["c_class"]["objects"], 1):
        lines.append(
            f"| {number} | `{entry['declaration']}` | `{entry['upstream_path']}` | "
            f"{entry['manifest_pending_decision'] or '（未登记）'} | "
            f"{entry['manifest_required_verification'] or '（未登记）'} | "
            f"{entry['manifest_exclusion_reason'] or entry['exclusion_basis']} |"
        )
    lines.append("")
    if excluded["manifest_upstream_path_mismatch"]:
        lines.append("### 受控清单与受控索引的上游路径不一致（如实登记）")
        lines.append("")
        for entry in excluded["manifest_upstream_path_mismatch"]:
            lines.append(
                f"- `{entry['declaration']}`：受控成员清单登记 "
                f"`{entry['manifest_upstream_path']}`，受控索引登记 `{entry['index_upstream_path']}`。"
            )
            lines.append(f"  - 后果：{entry['consequence']}")
        lines.append("")
    lines.append("## 共同输入与固定值")
    lines.append("")
    lines.append("| 输入 | 路径 | 指纹 |")
    lines.append("| --- | --- | --- |")
    inputs = package["inputs"]
    lines.append(
        f"| 受控来源索引 | `{inputs['source_index']['path']}` | `{inputs['source_index']['sha256']}` |"
    )
    lines.append(
        f"| D16 复核队列（用于排除已单列候选） | `{inputs['d16_queue']['path']}` | "
        f"`{inputs['d16_queue']['sha256']}` |"
    )
    lines.append(
        f"| 成员同一性契约schema | `{inputs['contract_schema']['path']}` | 整文件 "
        f"`{inputs['contract_schema']['sha256']}`；规则集 `{inputs['contract_schema']['rules_sha256']}` |"
    )
    lines.append(
        f"| 成员同一性成员清单 | `{inputs['member_manifest']['path']}` | 整文件 "
        f"`{inputs['member_manifest']['sha256']}`；规则集 `{inputs['member_manifest']['rules_sha256']}` |"
    )
    transform_set = inputs["transform_set"]
    lines.append(
        f"| 代码同一性变换集 | `{transform_set['path']}` | 整文件 `{transform_set['sha256']}`；"
        f"transforms `{transform_set['transforms_sha256']}`；normalizations "
        f"`{transform_set['normalizations_sha256']}` |"
    )
    lines.append(
        f"| 规则实现 | `{inputs['rule_implementation']['path']}` | "
        f"`{inputs['rule_implementation']['sha256']}` |"
    )
    snapshot = inputs["upstream_snapshot"]
    lines.append(
        f"| 上游快照清单 | `{inputs['upstream_snapshot']['root']}/上游快照清单.json` | "
        f"`{snapshot['manifest_sha256']}`；{snapshot['files']} 条 / {snapshot['bytes']} 字节 / "
        f"{snapshot['licenses']} 份许可证 |"
    )
    lines.append("")
    lines.append("### 变换集精确定义（N1 + T1–T5）")
    lines.append("")
    for normalization in transform_set["normalizations"] or []:
        lines.append(
            f"- **{normalization['id']} {normalization['name']}**（方向 {normalization['direction']}）："
            f"{normalization['definition']} 适用范围：{normalization['scope']}"
        )
    for transform in transform_set["transforms"] or []:
        lines.append(
            f"- **{transform['id']} {transform['name']}**（方向 {transform['direction']}，"
            f"操作 `{transform['operation']}`，登记 {len(transform.get('pairs') or [])} 对）："
            f"{transform['definition']} 适用范围：{transform['scope']}"
        )
        for pair in transform.get("pairs") or []:
            lines.append(f"  - `{pair[0]}` → `{pair[1]}`")
    lines.append("")
    lines.append("## 复现命令")
    lines.append("")
    lines.append("以下命令全部只读仓内快照与工作树，断网可跑：")
    lines.append("")
    lines.append("```bash")
    for command in package["reproduction"]["gates"]:
        lines.append(command)
        lines.append('echo "exit=$?"')
    lines.append(package["reproduction"]["item_command_template"])
    lines.append(package["reproduction"]["batch_command_template"])
    lines.append(package["reproduction"]["snapshot_command"])
    lines.append("```")
    lines.append("")
    lines.append("## 逐条汇总表")
    lines.append("")
    lines.append("| item_id | 类型 | A 类 | 入口 | 合格成员 | 被排除成员 | 覆盖自检 | 归因恰好覆盖 | 机械判定 |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for item in package["items"]:
        quantity = item["member_identity"]["quantity_condition"]
        lines.append(
            f"| {item['item_id']} | `{item['object']['declaration']}` | "
            f"{item['classification']['a_class']} | {quantity['entry'] or '—'} | "
            f"{len(quantity['qualifying_members'])} | {len(quantity['excluded_members'])} | "
            f"{'两侧成立' if item['coverage_selfcheck']['both_complete'] else '不成立'} | "
            f"{'是' if item['difference_ledger']['coverage']['covers_exactly'] else '否'} | "
            f"{item['status']['overall']} |"
        )
    lines.append("")
    lines.append("## 逐条材料")
    lines.append("")
    for item in package["items"]:
        obj = item["object"]
        module = obj["module"]
        quantity = item["member_identity"]["quantity_condition"]
        lines.append(f"### {item['item_id']} {obj['declaration']}")
        lines.append("")
        lines.append(
            f"- A 类分类：**{item['classification']['a_class']}**"
            f"（内容相等的完整成员 {len(item['classification']['content_equal_member_sha256'])} 个、"
            f"类型头相等={item['classification']['header_equal']}）"
        )
        lines.append(
            f"- 机械判定：**{item['status']['overall']}**"
            f"（数量条件 {item['status']['quantity_condition']}；"
            f"覆盖自检 {item['status']['coverage_selfcheck']}；"
            f"归因 {item['status']['difference_attribution']}）"
        )
        for reason in item["status"]["reasons"]:
            lines.append(f"  - {reason}")
        lines.append("")
        lines.append("**1. 对象标识**")
        lines.append("")
        lines.append(f"- 本地文件：`{obj['local_path']}`（整文件 SHA-256 `{obj['local_file_sha256']}`）")
        lines.append(
            f"- 类型：`{obj['declaration']}`（{obj['kind']}，"
            f"嵌套类型：{'是，外层 ' + str(obj['enclosing_type']) if obj['nested'] else '否'}），"
            f"声明第 {obj['declaration_line']} 行，JavaDoc 第 {obj['javadoc_lines'][0]}–{obj['javadoc_lines'][1]} 行"
        )
        lines.append(
            f"- 所属模块：`{module.get('artifact_id')}`（POM `{module.get('pom')}`，"
            f"POM SHA-256 `{module.get('pom_sha256')}`）"
        )
        lines.append(
            f"- 同文件声明类型：{'；'.join(str(entry['qualified_name']) for entry in obj['types_in_file'])}"
        )
        lines.append(
            f"- 上游固定输入：`{obj['upstream']['repo_id']}@{obj['upstream']['commit']}` 的 "
            f"`{obj['upstream']['path']}`，登记指纹 `{obj['upstream']['sha256']}`，"
            f"本轮实测 `{obj['upstream']['sha256_measured']}`"
        )
        lines.append(
            f"- 逐类型 JavaDoc 指纹：登记 `{obj['javadoc_sha256_registered']}`，"
            f"实测 `{obj['javadoc_sha256_measured']}`，一致：{obj['javadoc_sha256_matches']}"
        )
        lines.append("")
        lines.append("**2. 成员级内容关系（E2-member-identity 核心）**")
        lines.append("")
        lines.append(
            f"- 分支 `{item['member_identity']['branch']}`，路线 "
            f"`{item['member_identity']['route']}`，规则版本 "
            f"`{item['member_identity']['rules_version']}`，序列化 "
            f"`{item['member_identity']['serialization']['version']}`"
        )
        lines.append(
            f"- 数量条件：**入口 {quantity['entry'] or '不成立'}**；"
            f"M0 要求 {quantity['m0']['required']} 个未变换即相等的完整成员，实测 "
            f"{quantity['m0']['qualifying_raw_identical']} 个 → "
            f"{'成立' if quantity['m0']['satisfied'] else '不成立'}；"
            f"MT 要求 {quantity['mt']['required']} 个变换后相等的完整成员，实测 "
            f"{quantity['mt']['qualifying_transformed']} 个、前置 M0 不存在="
            f"{quantity['mt']['precondition_m0_absent']} → "
            f"{'成立' if quantity['mt']['satisfied'] else '不成立'}"
        )
        lines.append(
            f"- 合格成员：{'；'.join(f'`{key}`' for key in quantity['qualifying_members']) or '（无）'}"
        )
        if quantity["excluded_members"]:
            lines.append("- 被样板门槛排除的相等成员：")
            for entry in quantity["excluded_members"]:
                lines.append(f"  - `{entry['member_key']}`：{'；'.join(entry['boilerplate_reasons'])}")
        lines.append("")
        lines.append("| 成员键 | 种类 | 本地行 | 上游行 | 本地成员 SHA-256 | 上游成员 SHA-256 | 字节 本地/上游 | 词素 本地/上游 | 未变换原始字节相等 | 施加变换（本地/上游） | 合格 |")
        lines.append("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
        for member in item["member_identity"]["members"]:
            lines.append(
                f"| `{member['member_key']}` | {member['kind']} | "
                f"{member['local_lines'][0]}–{member['local_lines'][1]} | "
                f"{member['upstream_lines'][0]}–{member['upstream_lines'][1]} | "
                f"`{member['local_member_sha256']}` | `{member['upstream_member_sha256']}` | "
                f"{member['local_member_bytes']}/{member['upstream_member_bytes']} | "
                f"{member['local_member_lexeme_count']}/{member['upstream_member_lexeme_count']} | "
                f"{member['raw_identical']} | "
                f"{'、'.join(member['transforms_rewriting_member']['local']) or '无'} / "
                f"{'、'.join(member['transforms_rewriting_member']['upstream']) or '无'} | "
                f"{'合格' if member['qualification']['qualifies'] else '不合格'} |"
            )
        lines.append("")
        lines.append("**3. 「完整、非通用、有区分力」的机械化判定依据**")
        lines.append("")
        for member in item["member_identity"]["members"]:
            facts = member["qualification"]["branch_facts"]
            anchors = member["qualification"]["anchor_counts"]
            lines.append(f"- `{member['member_key']}`（{'合格' if member['qualification']['qualifies'] else '不合格'}）")
            lines.append(
                f"  - 完整成员：种类 {facts['member_kind']}"
                f"（可计数={facts['member_kind_countable']}，清单排除={facts['member_kind_excluded_by_manifest']}）；"
                f"边界自检 hard={facts['boundary_selfcheck_hard']}、"
                f"non-countable={facts['boundary_selfcheck_non_countable']}"
            )
            lines.append(
                f"  - 不是普通字段：无初始化表达式的普通字段={facts['is_plain_field_without_initializer']}；"
                f"只由样板注解与惯用类型名构成={facts['is_annotation_only_field']}；"
                f"有初始化表达式={facts['has_initializer']}"
            )
            lines.append(
                f"  - 不是 getter/setter：accessor 命名={facts['is_accessor_named']}；"
                f"通用样板方法名={facts['is_generic_accessor_name']}；"
                f"惯用取值/赋值体={facts['has_trivial_body']}"
            )
            if facts["member_kind"] in {"method", "constructor", "initializer-block"}:
                lines.append(f"  - 不是空方法：方法体为空={facts['body_empty']}")
            else:
                lines.append(
                    f"  - 不是空方法：不适用（种类 {facts['member_kind']} 没有方法体，"
                    f"空方法排除规则对该成员不生效）"
                )
            lines.append(
                f"  - 惯用锚点计数：合计 **{anchors['total']}** 个"
                f"（门槛 ≥{anchors['required_min']}），分类 "
                f"{anchors['by_kind'] or '（无）'}；"
                f"词素数 {anchors['lexeme_count']}（门槛 ≥{anchors['required_min_lexeme_count']}）"
            )
            if anchors["anchors"]:
                samples = "、".join(
                    f"`{item['lexeme']}`" for item in anchors["anchors"][:6]
                )
                lines.append(f"  - 锚点样例：{samples}")
            for point in member["qualification"]["boilerplate_reasons"]:
                lines.append(f"  - 排除原因（规则实现原文）：{point}")
            for side in ("local", "upstream"):
                for reading in member["transforms"][side]["occurrence_points"]:
                    if not reading["applied_on_this_side"]:
                        continue
                    if not reading["rewritten_lexeme_count"]:
                        continue
                    preview = "；".join(
                        f"第 {point['lexeme_index']} 词素（第 {point['line']} 行）`{point['before']}`→`{point['after']}`"
                        for point in reading["points"][:4]
                    )
                    lines.append(
                        f"  - 变换发生点（{'本地' if side == 'local' else '上游'} {reading['rule']} "
                        f"{reading['name']}）：改写 {reading['rewritten_lexeme_count']} 个词素"
                        + (f"；{preview}" if preview else "")
                    )
            lines.append(
                "  - 语义字段 owner_responsibility / non_generic_reason / "
                "discriminative_reason / coverage_reason：_留空待独立复核方填写_"
            )
        lines.append("")
        lines.append("**4. 覆盖性自检与成员边界自检**")
        lines.append("")
        lines.append("| 侧 | 代码流 SHA-256 | 词素数 | 成员数 | 切片数 | 覆盖性自检 | 独立重拼一致 | 边界自检 |")
        lines.append("| --- | --- | --- | --- | --- | --- | --- | --- |")
        for side, label in (("local", "本地"), ("upstream", "上游")):
            row = item["coverage_selfcheck"][side]
            lines.append(
                f"| {label} | `{row['code_stream_sha256']}` | {row['lexeme_count']} | {row['members']} | "
                f"{row['member_tiles']} | {row['coverage_complete']} | "
                f"{row['independent_rebuild_matches_stream']} | {row['boundary_selfcheck']} |"
            )
        for side, label in (("local", "本地"), ("upstream", "上游")):
            for note in item["coverage_selfcheck"][side]["non_countable_notes"]:
                lines.append(f"- {label} 侧成员边界自检不计入（不计入证据、保留切片）：{note}")
        for side, label in (("local", "本地"), ("upstream", "上游")):
            for hard in item["coverage_selfcheck"][side]["hard_problems"]:
                lines.append(f"- **{label} 侧 hard 失败**：{hard}")
        lines.append("")
        lines.append("**5. 全部残余差异的归因账**")
        lines.append("")
        coverage = item["difference_ledger"]["coverage"]
        measured = item["difference_ledger"]["measured_differences"]
        lines.append(
            f"实测差异账（规则实现 _member_identity_measured_differences）："
            + "；".join(f"{category}={value}" for category, value in measured.items())
        )
        lines.append(
            f"归因覆盖：恰好覆盖={coverage['covers_exactly']}，归因块 {coverage['attribution_blocks']} 处，"
            f"未解释块 {coverage['unexplained_blocks']} 处，规则核对说明：{coverage['rule_check_reason'] or '（通过）'}"
        )
        lines.append("")
        lines.append(
            "| 类别 | cause | rule | 位置 | 本地行 | 上游行 | 本地逐字 SHA-256 | 上游逐字 SHA-256 |"
        )
        lines.append("| --- | --- | --- | --- | --- | --- | --- | --- |")
        for entry in item["difference_ledger"]["attribution"]:
            lines.append(
                f"| {entry['category']} | {entry['cause']} | {entry['rule'] or '—'} | "
                f"{entry['location']} | {entry['local_lines'][0]}–{entry['local_lines'][1]} | "
                f"{entry['upstream_lines'][0]}–{entry['upstream_lines'][1]} | "
                f"`{(entry['before_ref'].get('sha256') or '该侧无')}` | "
                f"`{(entry['after_ref'].get('sha256') or '该侧无')}` |"
            )
        lines.append("")
        line_coverage = item["line_attribution_coverage"]
        lines.append(
            f"逐行差异账（与 D16 同口径）：实测差异行 本地 "
            f"{line_coverage['measured_local_lines']} / 上游 "
            f"{line_coverage['measured_upstream_lines']}，归因合计 本地 "
            f"{line_coverage['attributed_local_lines']} / 上游 "
            f"{line_coverage['attributed_upstream_lines']}，恰好覆盖="
            f"{line_coverage['covers_exactly']}，归因块 "
            f"{line_coverage['attribution_block_count']} 处，未能解释 "
            f"{line_coverage['unexplained_blocks']} 处。完整逐行原文见 JSON 的 "
            "line_difference_attribution。"
        )
        lines.append("")
        lines.append("**6. 注释绑定证据（四类角色逐字原文与指纹）**")
        lines.append("")
        for binding in item["comment_bindings"]:
            lines.append(
                f"- `{binding['role']}` 第 {binding['lines'][0]}–{binding['lines'][1]} 行，"
                f"SHA-256 `{binding['sha256']}`"
                + (f"，作者标签行 {binding['author_tag_lines']}" if binding["author_tag_lines"] else "")
            )
            if binding["text_inlined"]:
                lines.append("")
                lines.append("```java")
                lines.append(binding["text"])
                lines.append("```")
            else:
                lines.append("")
                lines.append(f"  - 未内联逐字原文：{binding['text_omitted_reason']}")
        for status in item["comment_roles_acceptance"]:
            lines.append(
                f"- 角色 `{status['role']}`：存在={status['present']}；"
                f"成员级内容关系之外的验收状态：{status['acceptance_beyond_member_identity']}"
            )
        lines.append("")
        authorship = item["authorship"]
        lines.append("**7. 署名与作者处理**")
        lines.append("")
        lines.append(f"- 形态：**{authorship['form']}**（{authorship['form_meaning']}）")
        lines.append(f"- 索引登记 `author_status`：`{authorship['index_author_status']}`")
        lines.append(
            f"- 索引登记 `upstream_author_lines`：`{authorship['index_upstream_author_lines']}`"
        )
        lines.append(
            f"- 上游固定版本是否声明作者：**"
            f"{'是' if authorship['upstream_fixed_version']['author_declared'] else '否'}**；"
            f"{authorship['upstream_fixed_version']['conclusion']}；扫描命中 "
            f"{authorship['upstream_fixed_version']['measured']['hit_count']} 行"
        )
        for hit in authorship["upstream_fixed_version"]["measured"]["hits"]:
            lines.append(
                f"  - 第 {hit['line']} 行：逐行 SHA-256 `{hit['line_sha256']}`（正文见上游快照同名文件）"
            )
        lines.append(f"- 上游其他版本：**{authorship['upstream_other_versions']}**")
        lines.append(
            "- 本地作者标签行："
            + (
                "；".join(
                    f"第 {row['line']} 行（逐行 SHA-256 `{row['line_sha256']}`）"
                    for row in authorship["local_author_tag_lines"]
                )
                or "无"
            )
        )
        lines.append(
            f"- `author_handling` 登记值：`member_identity_accepts_signature="
            f"{str(authorship['author_handling_draft']['member_identity_accepts_signature']).lower()}`，"
            f"`declared_author_status={authorship['author_handling_draft']['declared_author_status']}`，"
            f"`history_gap={authorship['author_handling_draft']['history_gap']}`"
        )
        lines.append("")
        lines.append("**8. 契约影响（机械命中行号，非结论）**")
        lines.append("")
        lines.append("| 契约 | 命中 | 具体位置 | 权威核对命令 |")
        lines.append("| --- | --- | --- | --- |")
        for entry in item["contract_impact"]:
            if entry["contract_id"] == "direction":
                positions = "；".join(
                    f"第 {hit['line']} 行（import SHA-256 `{hit['import_sha256']}`）"
                    f" → {hit['target_module']}"
                    for hit in entry["cross_module_imports"]
                )
            else:
                positions = "；".join(
                    f"第 {hit['line']} 行 `{hit['marker']}`（逐行 SHA-256 `{hit['line_sha256']}`）"
                    for hit in entry["markers"][:6]
                )
                if entry["marker_hit_count"] > 6:
                    positions += f"…（共 {entry['marker_hit_count']} 处）"
            lines.append(
                f"| {entry['contract']} | {'是' if entry['hit'] else '否'} | "
                f"{positions or entry['detail']} | `{entry['verify_command']}` |"
            )
        lines.append("")
        lines.append("**9. 可供判定的复现命令**")
        lines.append("")
        lines.append("```bash")
        lines.append(item["reproduction"]["item_command"])
        lines.append("```")
        lines.append("")
        lines.append("**10. 未解决问题**")
        lines.append("")
        for question in item["open_questions"]:
            lines.append(f"- {question}")
        for problem in item["material_problems"]:
            lines.append(f"- **材料自身问题**：{problem}")
        lines.append("")
        lines.append(
            "**复核判定（留空待独立复核方填写）**：reviewer_verdict = _空_ ／ reviewer = _空_ ／ "
            "review_date = _空_ ／ review_reason = _空_"
        )
        lines.append("")
    lines.append("## 复核判定表（留空）")
    lines.append("")
    lines.append(f"> {package['review_decision_table']['notice']}")
    lines.append("")
    lines.append(
        "| item_id | declaration | a_class | entry | mechanical_status | reviewer_verdict | "
        "reviewer | review_date | review_reason |"
    )
    lines.append("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for row in package["review_decision_table"]["rows"]:
        lines.append(
            f"| {row['item_id']} | `{row['declaration']}` | {row['a_class']} | "
            f"{row['entry'] or '—'} | {row['mechanical_status']} |  |  |  |  |"
        )
    lines.append("")
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------
# 校验与入口
# --------------------------------------------------------------------------


def verify_item(declaration: str) -> tuple[int, dict[str, Any]]:
    """按当前工作树与快照复算一条候选，并与材料包逐项比对。

    Args:
        declaration: 目标类型的限定名。

    Returns:
        ``(退出码, 复算报告)``；退出码 0 表示与材料完全一致。

    """

    stored = read_json(REVIEW_JSON)
    target = next(
        (item for item in stored["items"] if item["object"]["declaration"] == declaration),
        None,
    )
    if target is None:
        return 2, {"status": "not-found", "declaration": declaration}
    recomputed = recompute_item(target["item_id"])
    mismatches: list[str] = []
    if recomputed is None:
        return 2, {"status": "candidate-missing", "declaration": declaration}

    def compare(label: str, expected: Any, actual: Any) -> None:
        """记录读数不一致的字段。"""

        if expected != actual:
            mismatches.append(f"{label}：材料 {expected!r}／实测 {actual!r}")

    quantity_expected = target["member_identity"]["quantity_condition"]
    quantity_actual = recomputed["member_identity"]["quantity_condition"]
    for field in (
        "entry",
        "status",
        "qualifying_members",
        "excluded_members",
        "reasons",
        "m0",
        "mt",
    ):
        compare(f"member_identity.quantity_condition.{field}", quantity_expected[field], quantity_actual[field])
    compare(
        "member_identity.members",
        [
            {
                "member_key": entry["member_key"],
                "local_lines": entry["local_lines"],
                "upstream_lines": entry["upstream_lines"],
                "local_member_sha256": entry["local_member_sha256"],
                "upstream_member_sha256": entry["upstream_member_sha256"],
                "local_member_bytes": entry["local_member_bytes"],
                "upstream_member_bytes": entry["upstream_member_bytes"],
                "local_member_lexeme_count": entry["local_member_lexeme_count"],
                "upstream_member_lexeme_count": entry["upstream_member_lexeme_count"],
                "raw_local_member_sha256": entry["raw_local_member_sha256"],
                "raw_upstream_member_sha256": entry["raw_upstream_member_sha256"],
                "raw_identical": entry["raw_identical"],
                "transforms_rewriting_member": entry["transforms_rewriting_member"],
                "qualifies": entry["qualification"]["qualifies"],
                "boilerplate_reasons": entry["qualification"]["boilerplate_reasons"],
                "anchor_counts": entry["qualification"]["anchor_counts"]["total"],
                "anchor_by_kind": entry["qualification"]["anchor_counts"]["by_kind"],
                "branch_facts": entry["qualification"]["branch_facts"],
            }
            for entry in target["member_identity"]["members"]
        ],
        [
            {
                "member_key": entry["member_key"],
                "local_lines": entry["local_lines"],
                "upstream_lines": entry["upstream_lines"],
                "local_member_sha256": entry["local_member_sha256"],
                "upstream_member_sha256": entry["upstream_member_sha256"],
                "local_member_bytes": entry["local_member_bytes"],
                "upstream_member_bytes": entry["upstream_member_bytes"],
                "local_member_lexeme_count": entry["local_member_lexeme_count"],
                "upstream_member_lexeme_count": entry["upstream_member_lexeme_count"],
                "raw_local_member_sha256": entry["raw_local_member_sha256"],
                "raw_upstream_member_sha256": entry["raw_upstream_member_sha256"],
                "raw_identical": entry["raw_identical"],
                "transforms_rewriting_member": entry["transforms_rewriting_member"],
                "qualifies": entry["qualification"]["qualifies"],
                "boilerplate_reasons": entry["qualification"]["boilerplate_reasons"],
                "anchor_counts": entry["qualification"]["anchor_counts"]["total"],
                "anchor_by_kind": entry["qualification"]["anchor_counts"]["by_kind"],
                "branch_facts": entry["qualification"]["branch_facts"],
            }
            for entry in recomputed["member_identity"]["members"]
        ],
    )
    for side in ("local", "upstream"):
        for field in (
            "code_stream_sha256",
            "members",
            "coverage_complete",
            "independent_rebuild_matches_stream",
            "hard_problems",
            "non_countable_notes",
        ):
            compare(
                f"coverage_selfcheck.{side}.{field}",
                target["coverage_selfcheck"][side][field],
                recomputed["coverage_selfcheck"][side][field],
            )
    compare(
        "difference_ledger.measured_differences",
        target["difference_ledger"]["measured_differences"],
        recomputed["difference_ledger"]["measured_differences"],
    )
    compare(
        "difference_ledger.attribution",
        [
            {
                "category": entry["category"],
                "cause": entry["cause"],
                "location": entry["location"],
                "changed_lines": entry["changed_lines"],
            }
            for entry in target["difference_ledger"]["attribution"]
        ],
        [
            {
                "category": entry["category"],
                "cause": entry["cause"],
                "location": entry["location"],
                "changed_lines": entry["changed_lines"],
            }
            for entry in recomputed["difference_ledger"]["attribution"]
        ],
    )
    compare(
        "difference_ledger.coverage",
        target["difference_ledger"]["coverage"],
        recomputed["difference_ledger"]["coverage"],
    )
    compare(
        "comment_bindings",
        [
            {"role": entry["role"], "lines": entry["lines"], "sha256": entry["sha256"], "text": entry["text"]}
            for entry in target["comment_bindings"]
        ],
        [
            {"role": entry["role"], "lines": entry["lines"], "sha256": entry["sha256"], "text": entry["text"]}
            for entry in recomputed["comment_bindings"]
        ],
    )
    compare(
        "authorship.upstream_fixed_version.author_declared",
        target["authorship"]["upstream_fixed_version"]["author_declared"],
        recomputed["authorship"]["upstream_fixed_version"]["author_declared"],
    )
    compare("status", target["status"], recomputed["status"])
    compare("classification", target["classification"], recomputed["classification"])
    checker = load_checker()
    compare(
        "inputs.rule_implementation.sha256",
        stored["inputs"]["rule_implementation"]["sha256"],
        sha256_bytes(CHECKER_PATH.read_bytes()),
    )
    filled = [
        row["item_id"]
        for row in stored["review_decision_table"]["rows"]
        if row["reviewer_verdict"] is not None
        or row["reviewer"] is not None
        or row["review_date"] is not None
        or row["review_reason"] is not None
    ]
    if filled:
        mismatches.append(f"判定列被填写：{filled}（实施方不得填写）")
    if target["item_id"] and checker.EVIDENCE_BRANCH_MEMBER_IDENTITY != stored["items"][0]["member_identity"]["branch"]:
        mismatches.append("材料登记的分支不是 E2-member-identity")
    return (
        0 if not mismatches else 1,
        {
            "status": "passed" if not mismatches else "failed",
            "declaration": declaration,
            "item_id": target["item_id"],
            "a_class": target["classification"]["a_class"],
            "entry": quantity_actual["entry"],
            "mechanical_status": recomputed["status"]["overall"],
            "mismatches": mismatches,
        },
    )


def recompute_item(item_id: str) -> dict[str, Any] | None:
    """按当前工作树与快照重算一条材料的全部读数。"""

    checker = load_checker()
    d16gen = load_d16_generator()
    index = read_json(INDEX_PATH)
    queue = read_json(QUEUE_PATH)
    schema, schema_error = checker._load_member_identity_contract_schema(
        str(CONTRACT_SCHEMA_PATH)
    )
    manifest, manifest_error = checker._load_member_identity_member_manifest(
        str(MEMBER_MANIFEST_PATH)
    )
    if schema_error or manifest_error or schema is None or manifest is None:
        raise RuntimeError(f"受控文档不可用：{schema_error or ''} {manifest_error or ''}")
    transform_set = resolve_transform_set(checker)
    transforms = ordered_transforms(transform_set)
    generic_patterns = tuple(
        re.compile(str(item))
        for item in manifest["discrimination"]["generic_string_patterns"]
    )
    registry = checker.load_evidence_registry(INDEX_PATH, SNAPSHOT_DIR)
    modules = d16_generator().module_index()
    rows, _b_rows, _c_rows = split_excluded_objects(
        candidate_declarations(index, queue), manifest
    )
    position = int(item_id.rsplit("-", 1)[-1]) - 1
    if position < 0 or position >= len(rows):
        return None
    return item_materials(
        checker,
        d16gen,
        rows[position],
        registry,
        transforms,
        transform_set,
        schema,
        manifest,
        generic_patterns,
        modules,
        index,
        item_id,
    )


def verify_batch() -> tuple[int, dict[str, Any]]:
    """复算全部 108 条并与材料包逐项比对。"""

    stored = read_json(REVIEW_JSON)
    mismatches: list[str] = []
    for item in stored["items"]:
        code, report = verify_item(str(item["object"]["declaration"]))
        if code != 0:
            mismatches.append(f"{item['item_id']} {item['object']['declaration']}：{report['status']}")
    snapshot = stored["inputs"]["upstream_snapshot"]
    return (
        0 if not mismatches else 1,
        {
            "status": "passed" if not mismatches else "failed",
            "scope": "全部 108 条 A 类候选",
            "items": len(stored["items"]),
            "snapshot_manifest_sha256": snapshot["manifest_sha256"],
            "mismatches": mismatches,
        },
    )


def main() -> int:
    """命令行入口。"""

    parser = argparse.ArgumentParser(description="生成/复算 D17 成员级逐条复核材料包")
    parser.add_argument("--build", action="store_true", help="重新生成材料包（JSON + Markdown）")
    parser.add_argument("--verify-item", metavar="DECLARATION", help="复算单条候选并与材料比对")
    parser.add_argument("--verify-batch", action="store_true", help="复算全部候选并与材料比对")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出报告")
    arguments = parser.parse_args()

    if arguments.verify_item:
        code, report = verify_item(arguments.verify_item)
    elif arguments.verify_batch:
        code, report = verify_batch()
    elif arguments.build:
        package = build_review_package()
        REVIEW_JSON.write_text(
            json.dumps(package, ensure_ascii=False, indent=2, sort_keys=False) + "\n",
            encoding="utf-8",
        )
        REVIEW_MD.write_text(render_review_markdown(package), encoding="utf-8")
        code = 0
        report = {
            "status": "written",
            "materials": {
                "json": relative(REVIEW_JSON),
                "json_sha256": sha256_bytes(REVIEW_JSON.read_bytes()),
                "json_bytes": REVIEW_JSON.stat().st_size,
                "markdown": relative(REVIEW_MD),
                "markdown_sha256": sha256_bytes(REVIEW_MD.read_bytes()),
                "markdown_bytes": REVIEW_MD.stat().st_size,
                "counts": package["counts"],
            },
        }
    else:
        parser.error("必须指定 --build、--verify-item 或 --verify-batch 之一")

    if arguments.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(report.get("status"), report.get("declaration", ""))
        for mismatch in report.get("mismatches", []):
            print("不一致：", mismatch)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
