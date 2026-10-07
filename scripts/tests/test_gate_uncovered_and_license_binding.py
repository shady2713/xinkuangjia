"""验证第三处同源对账缺陷已关闭，并验证不可解析的 `license_path` 已可真正校验。

固化两个已复现的缺陷：

1. **`uncovered_acceptance_records` 的文件前缀折叠**
   规则原用 `record_id.startswith(f"{path}#")` 判断“该文件已覆盖”，于是同一文件里
   多个 public/嵌套类型时，**只用其中一个类型的逐项记录就能声称覆盖整个文件**，另一个
   类型实际没有逐项状态也不报。修法改为按 `(文件, 类型)` 唯一键双向对账，与
   `run_checks`／`ci_gate` 的既有口径一致：索引登记的键缺逐项状态、索引把同一个键
   重复登记、报告出现索引里不存在的键，都按范围漏项拒绝并以退出码 1 结束。

2. **`license_path` 登记为不可解析形态且从未被消费**
   受控索引把许可证登记为 `yudao/LICENSE@<commit>`，而定位规则是
   `<仓库名>@<提交>/<上游相对路径>`；该值不是任何可解析形态，检查器也从不读取它。
   仓内受控快照已按上游树真实位置交付许可证并在哈希清单登记同一指纹，因此该字段可以
   被真正解析与校验：缺文件、指纹不符、指向清单外的文件、形态不可解析，一律以
   `EvidenceError` 受控失败（退出码 2）。

全部用例都在 ``tmp_path`` 下的隔离仓库根或独立 Git 仓库里运行真实 CLI
（``check_staged_java_comments.py`` 与 ``check_full_java_comments.py``），不依赖网络、
不读取本机 ``.bf-local``，也不修改真实索引、源码或暂存区。

@author 门禁方向执行代理
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path

import pytest

from scripts.code.java import check_staged_java_comments as java
from scripts.common.quality_common import DEFAULT_ROOT, CheckError
from scripts.workflow import ci_gate, run_checks

REPO = "YunaiV/ruoyi-vue-pro"
COMMIT = "ac022b15a094cf9cf82903d429b9729e72309da5"
REPO_NAME = "ruoyi-vue-pro"
UPSTREAM_PATH = "yudao-framework/yudao-common/src/main/java/example/ProbeDemo.java"
UPSTREAM_SOURCE = "/**\n * 上游类型。\n */\npublic class ProbeDemo {\n}\n"
LICENSE_SOURCE = "The MIT License (MIT)\n\nCopyright (c) 2021 ruoyi-vue-pro\n"
LICENSE_SHA256 = hashlib.sha256(LICENSE_SOURCE.encode("utf-8")).hexdigest()
# 修复前索引登记的不可解析取值；测试直接用它证明“形态不可解析”会被拒绝。
UNRESOLVABLE_LICENSE_PATH = f"yudao/LICENSE@{COMMIT}"
RESOLVABLE_LICENSE_PATH = f"{REPO_NAME}@{COMMIT}/LICENSE"
LOCAL_DIR = (
    "后端代码/basic-framework-boot/basic-framework-core/basic-framework-common/"
    "src/main/java/example"
)
LOCAL_PATH = f"{LOCAL_DIR}/ProbeDemo.java"
INDEX_RELATIVE = "docs/测试与可靠性/来源证据/d12-source-index.json"
BLOCKED = "证据不足，保持原状并登记阻断"
ACCEPTED = "已按 D12 格式写入来源说明并撤回无依据署名"
MARKER = "来源验收：尚未验收"
BLOCKER_REASON = "只有 1 个独立定位对应点。"
CHECKER = DEFAULT_ROOT / "scripts/code/java/check_staged_java_comments.py"
FULL = DEFAULT_ROOT / "scripts/code/java/check_full_java_comments.py"
TOP_LEVEL = "example.ProbeDemo"


def digest(value: str) -> str:
    """返回文本的 SHA-256。"""

    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def qualified(name: str, *, nested: bool) -> str:
    """返回类型限定名；嵌套类型带外层类型链。"""

    return f"example.ProbeDemo.{name}" if nested else TOP_LEVEL


def type_javadoc(name: str, marker: str = MARKER) -> str:
    """生成绑定到指定 public 类型的来源说明 JavaDoc。"""

    body = [
        f" * {name} 的职责说明。",
        " *",
        f" * 来源：{REPO} @ {COMMIT}（该版本未声明作者）",
        f" * 上游文件：{UPSTREAM_PATH}",
        " * 来源依据：固定见证版本；历史引入版本未核实。",
        " * 本地修改：调整包名与类名。",
    ]
    if marker:
        body.append(f" * {marker}")
    body.append(" * 说明：来源说明例外测试片段。")
    return "\n".join(["/**", *body, " */"])


def local_source(names: Sequence[str], *, marker: str = MARKER) -> str:
    """生成含给定 public 类型的 Java 源码；首个为顶层，其余为静态嵌套。"""

    head = (
        f"package example;\n\n{type_javadoc(names[0], marker)}\n"
        f"public class {names[0]} {{\n"
    )
    nested = "".join(
        f"\n{type_javadoc(name, marker)}\n    public static class {name} {{\n    }}\n"
        for name in names[1:]
    )
    return head + nested + "}\n"


def javadoc_of(source: str, name: str) -> str:
    """取出绑定到指定类型名的 JavaDoc 原文。"""

    start = source.rindex("/**", 0, source.index(f"class {name} {{"))
    return source[start : source.index("*/", start) + 2]


def type_entry(
    source: str, name: str, *, nested: bool, qualified_name: str | None = None
) -> dict[str, object]:
    """构造 ``type_evidence.types`` 中的一条逐类型映射。

    Args:
        source: 当前源码。
        name: 类型简单名。
        nested: 是否为嵌套类型。
        qualified_name: 覆盖登记的限定名，用于制造“同一个键重复登记”的反例。

    Returns:
        单条逐类型映射。
    """

    try:
        javadoc = javadoc_of(source, name)
    except ValueError:
        javadoc = type_javadoc(name)
    return {
        "qualified_name": qualified_name or qualified(name, nested=nested),
        "simple_name": name,
        "kind": "class",
        "nested": nested,
        "enclosing_type": TOP_LEVEL if nested else None,
        "upstream_type": f"cn.iocoder.yudao.example.{name}",
        "upstream_author_declared": False,
        "javadoc_sha256": digest(javadoc),
        "review_by": "门禁对账回归",
        "review_date": "2026-10-06",
        "review_conclusion": f"逐项复核 {name}：来源、指纹与无作者结论一致。",
    }


def type_evidence_value(
    source: str,
    names: Sequence[str],
    *,
    duplicate: bool = False,
) -> str:
    """按类型名列表展开逐类型映射；``duplicate`` 时把同一个键登记两次。"""

    entries = [
        type_entry(source, name, nested=index > 0)
        for index, name in enumerate(names)
    ]
    if duplicate:
        entries.append(type_entry(source, names[0], nested=False))
    return json.dumps(
        {
            "schema": java.EVIDENCE_SCHEMA,
            "file": {"local_sha256_final": digest(source)},
            "types": entries,
        },
        ensure_ascii=False,
    )


def record(
    source: str,
    names: Sequence[str],
    *,
    verdict: str = BLOCKED,
    duplicate: bool = False,
    license_path: str | None = RESOLVABLE_LICENSE_PATH,
    license_sha256: str | None = LICENSE_SHA256,
) -> dict[str, object]:
    """构造一条受控索引记录。

    Args:
        source: 该对象当前源码。
        names: ``type_evidence`` 登记的类型简单名列表。
        verdict: ``d12_verdict`` 取值。
        duplicate: 是否把同一个 ``(文件, 类型)`` 键重复登记一次。
        license_path: 登记的许可证定位；空串表示不声明。
        license_sha256: 登记的许可证指纹；空串表示不声明。

    Returns:
        可直接写入受控索引的记录对象。
    """

    value: dict[str, object] = {
        "local_path": LOCAL_PATH,
        "local_sha256_after": digest(source),
        "upstream_repo_url": f"https://github.com/{REPO}.git",
        "upstream_repo_id": REPO,
        "upstream_path": UPSTREAM_PATH,
        "upstream_commit": COMMIT,
        "upstream_file_url": f"https://github.com/{REPO}/blob/{COMMIT}/{UPSTREAM_PATH}",
        "upstream_sha256": digest(UPSTREAM_SOURCE),
        "upstream_author_lines": "",
        "history_basis": "固定见证版本；历史引入版本未核实。",
        "evidence_route": "路线 3",
        "evidence_points": (
            "P1 内容点（共享有区分力字符串字面量）：来源说明例外测试片段 本地 L1 / 上游 L1；"
            "P2 注释点（共享独特注释正文）：说明：来源说明例外测试片段 本地 L2 / 上游 L2"
        ),
        "author_status": "已核实来源但作者未声明",
        "local_modification_facts": "调整包名与类名。",
        "open_gap": "上游该版本未声明作者；历史引入版本未核实。",
        "review_by": "门禁对账回归",
        "review_date": "2026-10-06",
        "review_conclusion": "逐项复核 " + "、".join(names) + "：来源、指纹与无作者结论一致。",
        "type_evidence": type_evidence_value(source, names, duplicate=duplicate),
        "d12_verdict": verdict,
        "d12_blocker_reason": BLOCKER_REASON if verdict != ACCEPTED else "",
        "d12_correspondence_points": json.dumps(
            [
                {
                    "kind": "P1 内容点（共享有区分力字符串字面量）",
                    "fragment": "来源说明例外测试片段",
                    "discrimination_reason": "具体业务事实，非类名/方法名/通用惯例。",
                    "corpus_binding": f"上游固定快照 {COMMIT} 语料；该片段出现 1 次，df=1",
                },
                {
                    "kind": "P2 注释点（共享独特注释正文）",
                    "fragment": "说明：来源说明例外测试片段",
                    "discrimination_reason": "共享独特注释正文，非通用模板描述。",
                    "corpus_binding": f"上游固定快照 {COMMIT} 语料；该片段在本文件出现 1 次，df=1",
                },
            ],
            ensure_ascii=False,
        ),
    }
    if license_path is not None:
        value["license_path"] = license_path
    if license_sha256 is not None:
        value["license_sha256"] = license_sha256
    return value


def write_snapshot(root: Path) -> None:
    """在受控快照根目录写入上游来源文件与许可证原文。"""

    material = root / f"{REPO_NAME}@{COMMIT}" / UPSTREAM_PATH
    material.parent.mkdir(parents=True, exist_ok=True)
    material.write_text(UPSTREAM_SOURCE, encoding="utf-8")
    license_file = root / RESOLVABLE_LICENSE_PATH
    license_file.parent.mkdir(parents=True, exist_ok=True)
    license_file.write_text(LICENSE_SOURCE, encoding="utf-8")


def write_snapshot_manifest(
    root: Path, *, license_relatives: Sequence[str] = (RESOLVABLE_LICENSE_PATH,)
) -> Path:
    """在受控快照根目录写出机器可读哈希清单。"""

    material = root / f"{REPO_NAME}@{COMMIT}" / UPSTREAM_PATH
    entries: list[dict[str, object]] = [
        {
            "path": f"{REPO_NAME}@{COMMIT}/{UPSTREAM_PATH}",
            "kind": "upstream-source",
            "bytes": len(UPSTREAM_SOURCE.encode("utf-8")),
            "sha256": digest(UPSTREAM_SOURCE),
            "upstream_commit": COMMIT,
            "upstream_path": UPSTREAM_PATH,
            "upstream_file_url": (
                f"https://github.com/{REPO}/blob/{COMMIT}/{UPSTREAM_PATH}"
            ),
            "declared_upstream_sha256": digest(UPSTREAM_SOURCE),
            "matches_declared_upstream_sha256": True,
        }
    ]
    for relative in license_relatives:
        raw = (root / relative).read_bytes()
        entries.append(
            {
                "path": relative,
                "kind": "license",
                "bytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(),
            }
        )
    path = root / java.SNAPSHOT_MANIFEST_NAME
    path.write_text(
        json.dumps(
            {"manifest_schema": java.SNAPSHOT_MANIFEST_SCHEMA, "files": entries},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return path


def write_root(
    base: Path,
    name: str,
    *,
    source_names: Sequence[str],
    index_names: Sequence[str] | None = None,
    verdict: str = BLOCKED,
    duplicate: bool = False,
    license_path: str | None = RESOLVABLE_LICENSE_PATH,
    license_sha256: str | None = LICENSE_SHA256,
    manifest: bool = True,
    license_relative: str = RESOLVABLE_LICENSE_PATH,
    license_relatives: Sequence[str] | None = None,
    extra_license: tuple[str, str] | None = None,
    license_bytes: bytes | None = None,
) -> tuple[Path, Path]:
    """写出隔离仓库根、受控索引与受控快照。

    Args:
        base: pytest 提供的隔离工作区。
        name: 用例目录名。
        source_names: Java 源码实际声明的 public 类型。
        index_names: 索引 ``type_evidence`` 登记的类型；默认与源码相同。
        verdict: 索引登记的 ``d12_verdict``。
        duplicate: 索引是否重复登记同一个唯一键。
        license_path: 登记的许可证定位。
        license_sha256: 登记的许可证指纹。
        manifest: 是否写出快照哈希清单。
        license_relative: 快照清单里许可证条目的相对路径。
        license_relatives: 快照清单里全部许可证条目的相对路径。
        extra_license: 额外写入快照并在清单中登记的 ``(相对路径, 原文)``。
        license_bytes: 覆盖快照里许可证原文的实际字节，用于制造指纹不符。

    Returns:
        ``(隔离仓库根, 快照目录)``。
    """

    names = list(index_names) if index_names is not None else list(source_names)
    text = local_source(source_names, marker="" if verdict == ACCEPTED else MARKER)
    root = base / name
    target = root / LOCAL_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    index = root / INDEX_RELATIVE
    index.parent.mkdir(parents=True, exist_ok=True)
    index.write_text(
        json.dumps(
            {
                "index_schema": "d12-source-index/v1",
                "records": [
                    record(
                        text,
                        names,
                        verdict=verdict,
                        duplicate=duplicate,
                        license_path=license_path,
                        license_sha256=license_sha256,
                    )
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    snapshots = base / f"{name}-snapshots"
    snapshots.mkdir(parents=True, exist_ok=True)
    write_snapshot(snapshots)
    relatives = list(license_relatives) if license_relatives else [license_relative]
    for relative in relatives:
        if relative == RESOLVABLE_LICENSE_PATH:
            continue
        moved = snapshots / relative
        moved.parent.mkdir(parents=True, exist_ok=True)
        moved.write_bytes((snapshots / RESOLVABLE_LICENSE_PATH).read_bytes())
    if extra_license is not None:
        extra = snapshots / extra_license[0]
        extra.parent.mkdir(parents=True, exist_ok=True)
        extra.write_text(extra_license[1], encoding="utf-8")
        relatives = [*relatives, extra_license[0]]
    if license_bytes is not None:
        (snapshots / RESOLVABLE_LICENSE_PATH).write_bytes(license_bytes)
    if manifest:
        write_snapshot_manifest(snapshots, license_relatives=relatives)
    return root, snapshots


def run_checker(
    root: Path, snapshots: Path, *extra: str
) -> subprocess.CompletedProcess[str]:
    """用真实暂存入口 CLI 在隔离根上运行分支复核（同样会加载受控快照清单）。"""

    environment = {**os.environ}
    environment.pop("JAVA_COMMENT_EVIDENCE_REGISTRY", None)
    environment.pop("JAVA_COMMENT_EVIDENCE_SNAPSHOTS", None)
    return subprocess.run(
        [
            sys.executable, "-B", "-X", "utf8", str(CHECKER),
            "--validate-evidence-branches", "--json",
            "--evidence-registry", str(root / INDEX_RELATIVE),
            "--evidence-snapshots", str(snapshots),
            *extra,
        ],
        cwd=str(DEFAULT_ROOT),
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=300,
    )


def staged_cli(root: Path, snapshots: Path) -> subprocess.CompletedProcess[str]:
    """用真实暂存入口 CLI 扫描隔离仓库的暂存差异（工作目录即隔离仓库根）。"""

    environment = {**os.environ}
    environment.pop("JAVA_COMMENT_EVIDENCE_REGISTRY", None)
    environment.pop("JAVA_COMMENT_EVIDENCE_SNAPSHOTS", None)
    return subprocess.run(
        [
            sys.executable, "-B", "-X", "utf8", str(CHECKER),
            "--json", "--maintenance",
            "--evidence-registry", str(root / INDEX_RELATIVE),
            "--evidence-snapshots", str(snapshots),
        ],
        cwd=str(root),
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=300,
    )


def full_cli(
    root: Path, snapshots: Path, *extra: str
) -> subprocess.CompletedProcess[str]:
    """用真实全量入口 CLI 在隔离根上运行一次检查。"""

    environment = {**os.environ, "JAVA_COMMENT_EVIDENCE_SNAPSHOTS": str(snapshots)}
    environment.pop("JAVA_COMMENT_EVIDENCE_REGISTRY", None)
    return subprocess.run(
        [
            sys.executable, "-B", "-X", "utf8", str(FULL),
            "--root", str(root), "--json", *extra,
        ],
        cwd=str(DEFAULT_ROOT),
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=300,
    )


def acceptance_of(result: subprocess.CompletedProcess[str]) -> dict[str, object]:
    """从全量入口的 JSON 输出里取出验收段。"""

    return json.loads(result.stdout)["acceptance"]


def gate() -> run_checks.Gate:
    """返回调度器登记的全量 Java 注释检查配置。"""

    return run_checks.Gate(
        "java-comments-full", "code/java/check_full_java_comments.py", "comments",
        acceptance=True, acceptance_flag=True, acceptance_report=True,
    )


# ---------------------------------------------------------------------------
# 任务 1：范围漏项必须按 (文件, 类型) 唯一键对账
# ---------------------------------------------------------------------------


def test_partial_type_coverage_is_rejected_by_real_cli(tmp_path: Path) -> None:
    """① 索引登记 2 个 public 类型、报告只提供 1 个类型的记录，必须按漏项拒绝。"""

    root, snapshots = write_root(
        tmp_path, "one-of-two", source_names=["ProbeDemo"], index_names=["ProbeDemo", "Api"]
    )
    result = full_cli(root, snapshots, "--maintenance")
    acceptance = acceptance_of(result)
    assert result.returncode == 1, result.stdout + result.stderr
    assert acceptance["counts"]["uncovered_records"] == 1
    uncovered = acceptance["uncovered_records"][0]
    assert uncovered["type_name"] == "example.ProbeDemo.Api"
    assert uncovered["reason_code"] == "missing-state"
    assert uncovered["record_id"] == f"{LOCAL_PATH}#example.ProbeDemo.Api"
    # 报告里只有一个类型的逐项状态，不能声称整个文件已覆盖。
    assert [
        item["type_name"]
        for item in acceptance["registered_blockers"] + acceptance["hard_failures"]
    ] == [TOP_LEVEL]


def test_partial_type_coverage_is_rejected_by_staged_cli(tmp_path: Path) -> None:
    """① 同一反例在暂存入口同样被拒：独立 Git 暂存区，真实退出码非零。"""

    root, snapshots = write_root(
        tmp_path, "staged-one-of-two",
        source_names=["ProbeDemo"], index_names=["ProbeDemo", "Api"],
    )
    git(root, "init", "-q")
    git(root, "add", LOCAL_PATH, INDEX_RELATIVE)
    result = staged_cli(root, snapshots)
    acceptance = acceptance_of(result)
    assert result.returncode == 1, result.stdout + result.stderr
    assert [item["type_name"] for item in acceptance["uncovered_records"]] == [
        "example.ProbeDemo.Api"
    ]


def test_nested_types_are_reconciled_one_by_one(tmp_path: Path) -> None:
    """② 多声明文件（嵌套类型）逐类型核对：只报真正缺的那一个，不多报不少报。"""

    root, snapshots = write_root(
        tmp_path, "nested-three",
        source_names=["ProbeDemo", "Api"], index_names=["ProbeDemo", "Api", "Ui"],
    )
    result = full_cli(root, snapshots, "--maintenance")
    acceptance = acceptance_of(result)
    assert result.returncode == 1, result.stdout + result.stderr
    assert [item["type_name"] for item in acceptance["uncovered_records"]] == [
        "example.ProbeDemo.Ui"
    ]
    covered = sorted(
        item["type_name"]
        for item in acceptance["registered_blockers"] + acceptance["hard_failures"]
    )
    assert covered == [TOP_LEVEL, "example.ProbeDemo.Api"]


def test_duplicate_index_key_is_rejected(tmp_path: Path) -> None:
    """③ 索引把同一个 (文件, 类型) 键重复登记，唯一键不成立，必须拒绝。"""

    root, snapshots = write_root(
        tmp_path, "duplicate-key",
        source_names=["ProbeDemo", "Api"], index_names=["ProbeDemo", "Api"], duplicate=True,
    )
    result = full_cli(root, snapshots, "--maintenance")
    acceptance = acceptance_of(result)
    assert result.returncode == 1, result.stdout + result.stderr
    codes = {item["reason_code"] for item in acceptance["uncovered_records"]}
    assert codes == {"index-duplicate"}
    assert acceptance["uncovered_records"][0]["type_name"] == TOP_LEVEL


def test_report_key_absent_from_index_is_rejected(tmp_path: Path) -> None:
    """④ 报告里出现索引中不存在的 (文件, 类型) 键，必须拒绝而不是忽略。"""

    root, snapshots = write_root(
        tmp_path, "undeclared-key",
        source_names=["ProbeDemo", "Api", "Ghost"], index_names=["ProbeDemo", "Api"],
    )
    result = full_cli(root, snapshots, "--maintenance")
    acceptance = acceptance_of(result)
    assert result.returncode == 1, result.stdout + result.stderr
    uncovered = acceptance["uncovered_records"]
    assert [item["type_name"] for item in uncovered] == ["example.ProbeDemo.Ghost"]
    assert uncovered[0]["reason_code"] == "undeclared-state"


def test_legitimate_full_coverage_still_passes(tmp_path: Path) -> None:
    """⑤ 合法覆盖：索引登记的类型全部有逐项状态时，漏项为 0 且维护入口退出 0。"""

    root, snapshots = write_root(
        tmp_path, "legit", source_names=["ProbeDemo", "Api", "Ui"],
        index_names=["ProbeDemo", "Api", "Ui"],
    )
    result = full_cli(root, snapshots, "--maintenance")
    acceptance = acceptance_of(result)
    assert result.returncode == 0, result.stdout + result.stderr
    assert acceptance["counts"]["uncovered_records"] == 0
    assert acceptance["counts"]["registered_blockers"] == 3
    assert acceptance["status"] if "status" in acceptance else True


def test_accepted_record_is_not_subject_to_uncovered_check(tmp_path: Path) -> None:
    """⑤ 已验收记录（判词在已验收集合内）不进入漏项对账，正例仍然通过。"""

    root, snapshots = write_root(
        tmp_path, "accepted", source_names=["ProbeDemo"], verdict=ACCEPTED,
    )
    result = full_cli(root, snapshots)
    acceptance = acceptance_of(result)
    assert result.returncode == 0, result.stdout + result.stderr
    assert acceptance["counts"]["uncovered_records"] == 0
    assert acceptance["counts"]["accepted"] == 1


def test_checker_agrees_with_run_checks_and_ci_gate(tmp_path: Path) -> None:
    """⑥ 同一输入，检查器、调度器与发布汇总三者判定必须一致。"""

    root, snapshots = write_root(
        tmp_path, "three-consumers",
        source_names=["ProbeDemo"], index_names=["ProbeDemo", "Api"],
    )
    report = json.loads(full_cli(root, snapshots, "--maintenance").stdout)
    acceptance = report["acceptance"]
    # 检查器：自身就把漏项算出来并以非零退出。
    checker_failed = bool(acceptance["uncovered_records"])
    # 调度器：同一份 v2 报告交给真实对账入口必须被拒。
    scheduler_failed = _rejects(
        lambda: run_checks.verify_acceptance_report(gate(), report, True, root)
    )
    # 发布汇总：同一份 v2 报告按同一唯一键双向对账，同样被拒。
    report["revision"] = "0" * 40
    acceptance["revision"] = "0" * 40
    written = tmp_path / "source-acceptance.json"
    written.write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")
    aggregator_failed = _rejects(lambda: ci_gate.source_acceptance(written, root, "0" * 40))
    assert checker_failed
    assert scheduler_failed
    assert aggregator_failed
    # 正例输入下三者同样一致：都不判为漏项。
    ok_root, ok_snapshots = write_root(
        tmp_path, "three-consumers-ok",
        source_names=["ProbeDemo", "Api"], index_names=["ProbeDemo", "Api"],
    )
    ok_report = json.loads(full_cli(ok_root, ok_snapshots, "--maintenance").stdout)
    ok_acceptance = ok_report["acceptance"]
    assert not ok_acceptance["uncovered_records"]
    ok_report["revision"] = "0" * 40
    ok_acceptance["revision"] = "0" * 40
    ok_written = tmp_path / "source-acceptance-ok.json"
    ok_written.write_text(json.dumps(ok_report, ensure_ascii=False), encoding="utf-8")
    ci_gate.source_acceptance(ok_written, ok_root, "0" * 40)


def _rejects(action) -> bool:
    """执行一次消费者对账；被拒返回 ``True``（调度器抛 ``CheckError``，发布汇总抛 ``ValueError``）。"""

    try:
        action()
    except (CheckError, ValueError):
        return True
    return False


def git(root: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    """在隔离仓库内执行 git 命令。"""

    environment = {**os.environ}
    environment.update(
        {
            "GIT_AUTHOR_NAME": "gatefix3",
            "GIT_AUTHOR_EMAIL": "gatefix3@example.invalid",
            "GIT_COMMITTER_NAME": "gatefix3",
            "GIT_COMMITTER_EMAIL": "gatefix3@example.invalid",
        }
    )
    return subprocess.run(
        ["git", *arguments],
        cwd=str(root),
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )


# ---------------------------------------------------------------------------
# 任务 2：license_path 真正被解析并复算
# ---------------------------------------------------------------------------


def test_license_path_is_parsed_and_verified_by_real_cli(tmp_path: Path) -> None:
    """④ 合法形态：可解析定位、清单条目与文件实际字节三者一致时通过。"""

    root, snapshots = write_root(
        tmp_path, "license-ok", source_names=["ProbeDemo"],
    )
    result = run_checker(root, snapshots)
    assert result.returncode == 0, result.stdout + result.stderr
    summary = json.loads(result.stdout)["evidence"]["snapshot_manifest"]
    assert summary["licenses"] == 1


def test_license_file_missing_is_rejected(tmp_path: Path) -> None:
    """① 许可证文件缺失必须以受控失败拒绝（退出码 2）。"""

    root, snapshots = write_root(
        tmp_path, "license-missing", source_names=["ProbeDemo"],
    )
    (snapshots / RESOLVABLE_LICENSE_PATH).unlink()
    result = run_checker(root, snapshots)
    assert result.returncode == 2, result.stdout + result.stderr
    assert "上游快照文件缺失" in result.stderr
    assert "LICENSE" in result.stderr


def test_license_fingerprint_mismatch_is_rejected(tmp_path: Path) -> None:
    """② 记录声明的许可证指纹与 license_path 指向的文件的实际字节不符，必须被拒。"""

    other = "Apache License 2.0\n"
    other_digest = hashlib.sha256(other.encode("utf-8")).hexdigest()
    root, snapshots = write_root(
        tmp_path, "license-hash", source_names=["ProbeDemo"],
        license_relatives=[RESOLVABLE_LICENSE_PATH, f"{REPO_NAME}@{COMMIT}/LICENSE.other"],
        extra_license=(f"{REPO_NAME}@{COMMIT}/LICENSE.other", other),
        license_sha256=other_digest,
    )
    result = run_checker(root, snapshots)
    assert result.returncode == 2, result.stdout + result.stderr
    assert "许可证指纹与声明不符" in result.stderr
    assert LICENSE_SHA256 in result.stderr
    assert other_digest in result.stderr


def test_license_bytes_tampered_in_snapshot_is_rejected(tmp_path: Path) -> None:
    """② 快照里许可证原文在清单登记之后被改写时，定位到的文件字节不符，必须被拒。"""

    root, snapshots = write_root(
        tmp_path, "license-bytes", source_names=["ProbeDemo"],
    )
    tampered = LICENSE_SOURCE.replace("2021", "2022")
    (snapshots / RESOLVABLE_LICENSE_PATH).write_bytes(tampered.encode("utf-8"))
    result = run_checker(root, snapshots)
    assert result.returncode == 2, result.stdout + result.stderr
    assert "上游快照指纹不符" in result.stderr
    assert LICENSE_SHA256 in result.stderr


def test_license_path_outside_manifest_is_rejected(tmp_path: Path) -> None:
    """③ license_path 指向清单外的文件必须被拒（退出码 2）。"""

    root, snapshots = write_root(
        tmp_path, "license-outside", source_names=["ProbeDemo"],
        license_path=f"{REPO_NAME}@{COMMIT}/NOTICE",
    )
    result = run_checker(root, snapshots)
    assert result.returncode == 2, result.stdout + result.stderr
    assert "指向清单外的文件" in result.stderr
    assert "NOTICE" in result.stderr


def test_unresolvable_license_path_form_is_rejected(tmp_path: Path) -> None:
    """修复前的登记值不是可解析形态，必须按形态非法拒绝，而不是静默跳过。"""

    root, snapshots = write_root(
        tmp_path, "license-unresolvable", source_names=["ProbeDemo"],
        license_path=UNRESOLVABLE_LICENSE_PATH,
    )
    result = run_checker(root, snapshots)
    assert result.returncode == 2, result.stdout + result.stderr
    assert "不是可解析形态" in result.stderr
    assert UNRESOLVABLE_LICENSE_PATH in result.stderr


def test_license_path_repository_must_match_record(tmp_path: Path) -> None:
    """license_path 的仓库名必须等于记录自己的上游仓库，不能指向别的仓库。"""

    root, snapshots = write_root(
        tmp_path, "license-repo", source_names=["ProbeDemo"],
        license_path=f"other-vue-pro@{COMMIT}/LICENSE",
    )
    result = run_checker(root, snapshots)
    assert result.returncode == 2, result.stdout + result.stderr
    assert "仓库名" in result.stderr


def test_license_binding_is_enforced_by_the_full_entry(tmp_path: Path) -> None:
    """全量入口同样消费该判据：许可证定位不可解析时整次检查受控失败。"""

    root, snapshots = write_root(
        tmp_path, "license-full-entry", source_names=["ProbeDemo"],
        license_path=UNRESOLVABLE_LICENSE_PATH,
    )
    result = full_cli(root, snapshots, "--maintenance")
    assert result.returncode == 2, result.stdout + result.stderr
    assert "不是可解析形态" in result.stderr


def test_repository_index_declares_a_resolvable_license_path() -> None:
    """真实索引：186 条记录的 license_path 全部是可解析形态且与清单条目一致。"""

    index = json.loads(
        (DEFAULT_ROOT / java.DEFAULT_EVIDENCE_REGISTRY).read_text(encoding="utf-8")
    )
    manifest = json.loads(
        (
            DEFAULT_ROOT / java.DEFAULT_EVIDENCE_SNAPSHOTS / java.SNAPSHOT_MANIFEST_NAME
        ).read_text(encoding="utf-8")
    )
    licenses = {
        entry["path"]: entry["sha256"]
        for entry in manifest["files"]
        if entry.get("kind") == "license"
    }
    records = index["records"]
    assert records, "真实索引不应为空"
    for record_value in records:
        relative = java.resolve_license_relative_path(
            record_value, record_value["local_path"]
        )
        assert relative == RESOLVABLE_LICENSE_PATH
        assert licenses[relative] == record_value["license_sha256"]
        target = DEFAULT_ROOT / java.DEFAULT_EVIDENCE_SNAPSHOTS / relative
        assert hashlib.sha256(target.read_bytes()).hexdigest() == record_value["license_sha256"]