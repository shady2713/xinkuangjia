"""验证门禁侧三个反例已被真实拒绝：逐项状态对账、未知判词、已登记阻断的绑定材料。

本模块固化的三个真实缺陷：

1. **状态对账不完整、不互斥、不拒绝“同步删除条目和计数”**
   逐项状态原按 `path` 折叠，同一文件的多个 public/嵌套类型被合并成一条；漏报一个
   嵌套类型、重复登记同一个 `file+type`、让同一个键同时出现在阻断与硬失败清单，或
   在已验收清单里塞入本次扫描范围之外的记录，都能让 ``run_checks`` 签发“覆盖完整”。
   少报一条并同步把 ``counts`` 改小同样自洽，因此被掩盖。
2. **未知判词未硬失败**
   索引 ``d12_verdict`` 出现词表之外的取值时，检查器把它当成“已登记阻断”，维护入口
   因此退出 0；严格入口虽退出 1，诊断却指向“尚未验收”，把拼写错误说成合法判词。
3. **已登记阻断未校验绑定材料的实际字节**
   规则实现在“未验收”分支提前返回，绑定材料的 SHA-256 只做格式匹配，从不复算实际
   字节：上游内容已被改写、或根本取不回，都只留下一个“格式合法”的指纹。

全部用例都在 ``tmp_path`` 下的隔离仓库根上运行真实 CLI（``check_full_java_comments.py``
与 ``run_checks.py``），固定地址取回一律指向受控快照或不可达的本机端口，不依赖网络。
不读取本机 ``.bf-local``，也不修改真实索引、源码或暂存区。

@author 门禁方向执行代理
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path

import pytest

from scripts.code.java import check_full_java_comments as full
from scripts.code.java import check_staged_java_comments as java
from scripts.common.quality_common import DEFAULT_ROOT, CheckError
from scripts.workflow import ci_gate, run_checks

REPO = "YunaiV/ruoyi-vue-pro"
COMMIT = "ac022b15a094cf9cf82903d429b9729e72309da5"
UPSTREAM_PATH = "yudao-framework/yudao-common/src/main/java/example/ProbeDemo.java"
UPSTREAM_SOURCE = "/**\n * 上游类型。\n */\npublic class ProbeDemo {\n}\n"
LOCAL_DIR = (
    "后端代码/basic-framework-boot/basic-framework-core/basic-framework-common/"
    "src/main/java/example"
)
LOCAL_PATH = f"{LOCAL_DIR}/ProbeDemo.java"
# 放在 Maven 输出目录下：本不会被全量入口扫到，用来构造“报告声明范围之外的记录”。
OTHER_PATH = (
    "后端代码/basic-framework-boot/basic-framework-core/basic-framework-common/"
    "target/other/OtherDemo.java"
)
INDEX_RELATIVE = "docs/测试与可靠性/来源证据/d12-source-index.json"
ACCEPTED = "已按 D12 格式写入来源说明并撤回无依据署名"
BLOCKED = "证据不足，保持原状并登记阻断"
ROLLBACK = "复核回退，保持来源说明并登记阻断（尚未验收）"
NEED_PROOF = "需补证，尚未验收"
UNKNOWN_VERDICT = "已按未知模板验收并登记阻断"
BLOCKER_REASON = "只有 1 个独立定位对应点。"
UNACCEPTED_MARKER = "来源验收：尚未验收"
# 固定地址指向本机未监听端口：连接立即被拒绝，与真实 CI 上“取不回”同属环境故障。
UNREACHABLE = "127.0.0.1:9"
TOP_LEVEL = "example.ProbeDemo"
NESTED_API = "example.ProbeDemo.Api"
NESTED_UI = "example.ProbeDemo.Ui"


def digest(value: str) -> str:
    """返回文本的 SHA-256。"""

    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def type_javadoc(name: str, marker: str = UNACCEPTED_MARKER) -> str:
    """生成绑定到指定 public 类型的 JavaDoc 文本（来源说明 + 可选未验收标注）。

    Args:
        name: 类型简单名。
        marker: 就地验收标注；为空串表示不写标注（合法已验收记录必须没有标注）。

    Returns:
        完整 JavaDoc 文本。
    """

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


def local_source(names: Sequence[str], *, marker: str = UNACCEPTED_MARKER) -> str:
    """生成含给定 public 类型的 Java 源码；首个为顶层，其余为静态嵌套类型。

    Args:
        names: 类型简单名列表。
        marker: 就地验收标注；为空串表示不写标注。

    Returns:
        完整 Java 源码文本。
    """

    head = f"package example;\n\n{type_javadoc(names[0], marker)}\npublic class {names[0]} {{\n"
    nested = ""
    for name in names[1:]:
        nested += (
            f"\n{type_javadoc(name, marker)}\n"
            f"    public static class {name} {{\n    }}\n"
        )
    return head + nested + "}\n"


def javadoc_of(source: str, name: str) -> str:
    """从源码中取出绑定到指定类型名的 JavaDoc 原文。"""

    start = source.rindex("/**", 0, source.index(f"class {name} {{"))
    return source[start : source.index("*/", start) + 2]


def qualified(name: str, *, nested: bool = False) -> str:
    """返回类型限定名；嵌套类型带外层类型链。"""

    return f"example.ProbeDemo.{name}" if nested else f"example.{name}"


def plain_source(name: str) -> str:
    """生成单个 public 类型、没有验收标注的 Java 源码（合法已验收记录形状）。"""

    return local_source((name,), marker="")


def type_entry(source: str, name: str, *, nested: bool = False) -> dict[str, object]:
    """构造 ``type_evidence.types`` 中的一条逐类型映射。

    索引可以登记源码里还不存在的类型（用于“漏项”反例），此时绑定 JavaDoc 的指纹按
    同一生成规则取期望值，报告里因此永远缺这一条。

    Args:
        source: 当前源码。
        name: 类型简单名。
        nested: 是否为嵌套类型。

    Returns:
        单条逐类型映射。
    """

    try:
        javadoc = javadoc_of(source, name)
    except ValueError:
        javadoc = type_javadoc(name)
    return {
        "qualified_name": qualified(name, nested=nested),
        "simple_name": name,
        "kind": "class",
        "nested": nested,
        "enclosing_type": qualified("ProbeDemo") if nested else None,
        "upstream_type": f"cn.iocoder.yudao.example.{name}",
        "upstream_author_declared": False,
        "javadoc_sha256": digest(javadoc),
        "review_by": "门禁对账回归",
        "review_date": "2026-10-06",
        "review_conclusion": f"逐项复核 {name}：来源、指纹与无作者结论一致。",
    }


def index_types_for(source: str, names: Sequence[str]) -> list[dict[str, object]]:
    """按类型名列表展开逐类型映射，首个为顶层、其余为嵌套。"""

    return [
        type_entry(source, name, nested=index > 0) for index, name in enumerate(names)
    ]


def record(
    source: str,
    names: Sequence[str],
    verdict: str,
    *,
    local_path: str = LOCAL_PATH,
    blocker: str = BLOCKER_REASON,
    upstream_sha256: str | None = None,
    unreachable: bool = False,
) -> dict[str, object]:
    """构造一条受控索引记录。

    Args:
        source: 该对象当前源码。
        names: ``type_evidence`` 登记的类型简单名列表。
        verdict: ``d12_verdict`` 取值。
        local_path: 记录的仓库相对路径。
        blocker: ``d12_blocker_reason`` 取值。
        upstream_sha256: 覆盖登记的上游内容指纹，用于制造哈希不符。
        unreachable: 把固定地址指向不可达的本机端口，用于制造“取不回”。

    Returns:
        可直接写入受控索引的记录对象。
    """

    host = f"https://{UNREACHABLE}" if unreachable else f"https://github.com/{REPO}"
    return {
        "local_path": local_path,
        "local_sha256_after": digest(source),
        "upstream_repo_url": f"https://github.com/{REPO}.git",
        "upstream_path": UPSTREAM_PATH,
        "upstream_commit": COMMIT,
        "upstream_file_url": f"{host}/blob/{COMMIT}/{UPSTREAM_PATH}",
        "upstream_sha256": upstream_sha256 or digest(UPSTREAM_SOURCE),
        "upstream_author_lines": "",
        "history_basis": "引入提交未知，本行以固定见证版本作来源见证。",
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
        "review_conclusion": (
            "逐项复核 " + "、".join(names) + "：来源、指纹与无作者结论一致。"
        ),
        "type_evidence": json.dumps(
            {
                "schema": "d12-type-evidence/v1",
                "file": {"local_sha256_final": digest(source)},
                "types": index_types_for(source, names),
            },
            ensure_ascii=False,
        ),
        "d12_verdict": verdict,
        "d12_blocker_reason": blocker,
        "d12_correspondence_points": json.dumps(
            [
                {
                    "kind": "P1 内容点（共享有区分力字符串字面量）",
                    "fragment": "来源说明例外测试片段",
                    "discrimination_reason": "具体业务事实，非类名/方法名/通用惯例。",
                    "corpus_binding": f"上游固定快照 {COMMIT} 语料；该片段出现 1 次，df=1",
                }
            ],
            ensure_ascii=False,
        ),
    }


def write_root(
    tmp_path: Path,
    name: str,
    *,
    verdict: str = BLOCKED,
    blocker: str = BLOCKER_REASON,
    source_names: Sequence[str] = ("ProbeDemo", "Api", "Ui"),
    index_names: Sequence[str] | None = None,
    upstream_sha256: str | None = None,
    unreachable: bool = False,
    snapshot: str | None = UPSTREAM_SOURCE,
) -> tuple[Path, Path]:
    """写出隔离仓库根、受控索引与受控快照。

    Args:
        tmp_path: pytest 提供的隔离工作区。
        name: 本次构造的名字，决定根目录与快照目录。
        verdict: 索引登记的 ``d12_verdict``。
        blocker: 索引登记的阻断原因；合法已验收记录传空串。
        source_names: Java 源码里实际声明的 public 类型。
        index_names: 索引 ``type_evidence`` 登记的类型；默认与 ``source_names`` 相同。
        upstream_sha256: 覆盖登记的上游内容指纹。
        unreachable: 固定地址是否指向不可达端口。
        snapshot: 受控快照内容；``None`` 表示不提供快照文件（按固定地址取回）。

    Returns:
        ``(隔离仓库根, 快照目录)``。
    """

    names = list(index_names) if index_names is not None else list(source_names)
    source = local_source(source_names, marker="" if verdict == ACCEPTED else UNACCEPTED_MARKER)
    root = tmp_path / name
    target = root / LOCAL_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(source, encoding="utf-8")
    index = root / INDEX_RELATIVE
    index.parent.mkdir(parents=True, exist_ok=True)
    index.write_text(
        json.dumps(
            {
                "index_schema": "d12-source-index/v1",
                "records": [
                    record(
                        source,
                        names,
                        verdict,
                        blocker=blocker,
                        upstream_sha256=upstream_sha256,
                        unreachable=unreachable,
                    )
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    snapshots = tmp_path / f"{name}-snapshots"
    snapshots.mkdir(parents=True, exist_ok=True)
    if snapshot is not None:
        material = snapshots / f"ruoyi-vue-pro@{COMMIT}" / UPSTREAM_PATH
        material.parent.mkdir(parents=True, exist_ok=True)
        material.write_text(snapshot, encoding="utf-8")
    return root, snapshots


def full_cli(root: Path, snapshots: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    """用真实全量入口 CLI 在隔离根上运行一次检查。"""

    environment = {**os.environ, "JAVA_COMMENT_EVIDENCE_SNAPSHOTS": str(snapshots)}
    environment.pop("JAVA_COMMENT_EVIDENCE_REGISTRY", None)
    return subprocess.run(
        [
            sys.executable, "-B", "-X", "utf8",
            str(DEFAULT_ROOT / "scripts/code/java/check_full_java_comments.py"),
            "--root", str(root), "--json", *extra,
        ],
        cwd=DEFAULT_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=300,
    )


def run_checks_cli(
    root: Path, snapshots: Path, *extra: str
) -> subprocess.CompletedProcess[str]:
    """用真实调度器 CLI 在隔离根上运行全量 Java 注释检查。"""

    environment = {**os.environ, "JAVA_COMMENT_EVIDENCE_SNAPSHOTS": str(snapshots)}
    environment.pop("JAVA_COMMENT_EVIDENCE_REGISTRY", None)
    return subprocess.run(
        [
            sys.executable, "-B", "-X", "utf8",
            str(DEFAULT_ROOT / "scripts/workflow/run_checks.py"),
            "--checks", "java-comments-full", "--root", str(root), "--json", *extra,
        ],
        cwd=DEFAULT_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=300,
    )


def gate() -> run_checks.Gate:
    """返回调度器登记的全量 Java 注释检查配置。"""

    return run_checks.Gate(
        "java-comments-full", "code/java/check_full_java_comments.py", "comments",
        acceptance=True, acceptance_flag=True, acceptance_report=True,
    )


def real_report(root: Path, snapshots: Path) -> dict[str, object]:
    """用真实 CLI 取一份未经篡改的 v2 报告，作为反例的构造基线。"""

    result = full_cli(root, snapshots, "--maintenance")
    assert result.returncode == 0, result.stdout + result.stderr
    return json.loads(result.stdout)


def reconcile(root: Path, report: dict[str, object]) -> None:
    """把报告交给调度器的对账入口；未被拒绝时直接让用例失败。

    Args:
        root: 隔离仓库根。
        report: 待复核的 v2 报告。

    Raises:
        AssertionError: 报告被接受。
    """

    try:
        run_checks.verify_acceptance_report(gate(), report, True, root)
    except CheckError:
        return
    raise AssertionError("逐项状态对账接受了被篡改的 v2 报告")


def drop(report: dict[str, object], type_name: str) -> dict[str, object]:
    """删除某个 ``file+type`` 条目并把三张清单的计数同步改小。"""

    value = copy.deepcopy(report)
    acceptance = value["acceptance"]
    for name in ("registered_blockers", "accepted", "hard_failures"):
        kept = [
            item
            for item in acceptance[name]
            if not (item["path"] == LOCAL_PATH and item["type_name"] == type_name)
        ]
        acceptance["counts"][name] = len(kept)
        acceptance[name] = kept
    return value


def entry_of(report: dict[str, object], list_name: str, type_name: str) -> dict[str, object]:
    """按类型限定名取出一条逐项状态条目。"""

    for item in report["acceptance"][list_name]:
        if item["path"] == LOCAL_PATH and item["type_name"] == type_name:
            return copy.deepcopy(item)
    raise AssertionError(f"报告中没有 {type_name} 的条目")


# ---------------------------------------------------------------------------
# 漏洞 1：按 (文件, 类型) 唯一键双向对账
# ---------------------------------------------------------------------------


def test_missing_nested_type_entry_is_rejected(tmp_path: Path) -> None:
    """反例·漏项：少报嵌套类型条目（计数同步改小）必须被拒。"""

    root, snapshots = write_root(tmp_path, "ledger-missing-nested")
    report = real_report(root, snapshots)
    assert len(report["acceptance"]["registered_blockers"]) == 3
    with pytest.raises(CheckError) as failure:
        run_checks.verify_acceptance_report(
            gate(), drop(report, NESTED_UI), True, root
        )
    assert NESTED_UI in str(failure.value)


def test_missing_top_level_type_entry_is_rejected(tmp_path: Path) -> None:
    """反例·漏项：少报顶层类型条目必须被拒。"""

    root, snapshots = write_root(tmp_path, "ledger-missing-top")
    with pytest.raises(CheckError) as failure:
        run_checks.verify_acceptance_report(
            gate(), drop(real_report(root, snapshots), TOP_LEVEL), True, root
        )
    assert TOP_LEVEL in str(failure.value)


def test_missing_type_entry_is_rejected_by_real_cli(tmp_path: Path) -> None:
    """反例·漏项：索引登记的类型在报告里没有条目时，真实调度器 CLI 必须非零退出。"""

    root, snapshots = write_root(
        tmp_path, "ledger-missing-cli", index_names=("ProbeDemo", "Api", "Ui", "Ghost")
    )
    checked = full_cli(root, snapshots, "--maintenance")
    assert checked.returncode == 0, checked.stdout + checked.stderr
    assert len(json.loads(checked.stdout)["acceptance"]["registered_blockers"]) == 3
    done = run_checks_cli(root, snapshots, "--maintenance")
    assert done.returncode != 0, done.stdout
    assert "example.ProbeDemo.Ghost" in done.stdout + done.stderr


def test_dropping_entry_and_counts_together_is_rejected(tmp_path: Path) -> None:
    """反例·少报+同步改计数：整体自洽的少报仍必须被拒。"""

    root, snapshots = write_root(tmp_path, "ledger-under-report")
    report = real_report(root, snapshots)
    value = drop(report, NESTED_API)
    assert value["acceptance"]["counts"]["registered_blockers"] == 2
    with pytest.raises(CheckError) as failure:
        run_checks.verify_acceptance_report(gate(), value, True, root)
    assert "漏掉" in str(failure.value) and NESTED_API in str(failure.value)


def test_short_report_with_zeroed_counts_is_rejected(tmp_path: Path) -> None:
    """反例·少报+同步改计数：清单清空并把计数改成 0 也必须被拒。"""

    root, snapshots = write_root(tmp_path, "ledger-zeroed")
    value = real_report(root, snapshots)
    acceptance = value["acceptance"]
    acceptance["registered_blockers"] = []
    acceptance["counts"]["registered_blockers"] = 0
    acceptance["counts"]["findings"] = 0
    value["findings"] = []
    value["status"] = "passed"
    with pytest.raises(CheckError) as failure:
        run_checks.verify_acceptance_report(gate(), value, True, root)
    assert "漏掉" in str(failure.value)


def test_short_report_with_zeroed_counts_is_rejected_by_cli(tmp_path: Path) -> None:
    """反例·少报+同步改计数：真实调度器 CLI 对同构报告非零退出。"""

    root, snapshots = write_root(tmp_path, "ledger-zeroed-cli")
    checked = full_cli(root, snapshots, "--maintenance")
    assert checked.returncode == 0, checked.stdout + checked.stderr
    report = json.loads(checked.stdout)
    report["acceptance"]["registered_blockers"] = []
    report["acceptance"]["counts"]["registered_blockers"] = 0
    report["acceptance"]["mode"] = "strict"
    report["status"] = "failed"
    report["process_exit_code"] = 1
    report["findings"] = [
        {"path": LOCAL_PATH, "line": 1, "rule": "type-author", "detail": "已登记阻断未验收"}
        for _ in range(3)
    ]
    report["acceptance"]["counts"]["findings"] = 3
    with pytest.raises(CheckError) as failure:
        run_checks.verify_acceptance_report(gate(), report, False, root)
    assert "漏掉" in str(failure.value)


def test_fabricated_type_entry_is_rejected(tmp_path: Path) -> None:
    """反例·多项：清单里多出索引没有的 ``file+type`` 条目必须被拒。"""

    root, snapshots = write_root(tmp_path, "ledger-extra")
    value = real_report(root, snapshots)
    ghost = entry_of(value, "registered_blockers", NESTED_API)
    ghost["record_id"] = f"{LOCAL_PATH}#example.ProbeDemo.NotInIndex"
    ghost["type_name"] = "example.ProbeDemo.NotInIndex"
    value["acceptance"]["registered_blockers"].append(ghost)
    value["acceptance"]["counts"]["registered_blockers"] += 1
    with pytest.raises(CheckError) as failure:
        run_checks.verify_acceptance_report(gate(), value, True, root)
    assert "NotInIndex" in str(failure.value)


def test_accepted_entry_outside_declared_scope_is_rejected(tmp_path: Path) -> None:
    """反例·多项：已验收清单里出现本次扫描范围之外的记录必须被拒。"""

    root, snapshots = write_root(tmp_path, "ledger-out-of-scope")
    other = plain_source("OtherDemo")
    target = root / OTHER_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(other, encoding="utf-8")
    index = root / INDEX_RELATIVE
    document = json.loads(index.read_text(encoding="utf-8"))
    document["records"].append(record(other, ["OtherDemo"], ACCEPTED, blocker="",
                                     local_path=OTHER_PATH))
    index.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
    report = real_report(root, snapshots)
    acceptance = report["acceptance"]
    acceptance["scope"] = {"files": [LOCAL_PATH], "count": 1}
    acceptance["accepted"] = [
        {
            "record_id": f"{OTHER_PATH}#example.OtherDemo",
            "path": OTHER_PATH,
            "line": 5,
            "type_name": "example.OtherDemo",
            "form": "来源说明",
            "classification": "accepted",
            "verdict": ACCEPTED,
            "blocker_reason": "",
            "open_gap": "",
            "local_sha256": digest(other),
        }
    ]
    acceptance["counts"]["accepted"] = 1
    with pytest.raises(CheckError) as failure:
        run_checks.verify_acceptance_report(gate(), report, True, root)
    assert "扫描范围" in str(failure.value)


def test_entry_without_type_name_is_rejected(tmp_path: Path) -> None:
    """反例·多项：缺少类型限定名、无法构成唯一键的条目必须被拒。"""

    root, snapshots = write_root(tmp_path, "ledger-no-type")
    value = real_report(root, snapshots)
    value["acceptance"]["registered_blockers"][0].pop("type_name")
    with pytest.raises(CheckError) as failure:
        run_checks.verify_acceptance_report(gate(), value, True, root)
    assert "类型限定名" in str(failure.value)


def test_duplicate_entry_in_blockers_is_rejected(tmp_path: Path) -> None:
    """反例·重复：同一个 ``file+type`` 在阻断清单里出现两次必须被拒。"""

    root, snapshots = write_root(tmp_path, "ledger-duplicate-blockers")
    value = real_report(root, snapshots)
    value["acceptance"]["registered_blockers"].append(
        entry_of(value, "registered_blockers", NESTED_API)
    )
    value["acceptance"]["counts"]["registered_blockers"] += 1
    with pytest.raises(CheckError) as failure:
        run_checks.verify_acceptance_report(gate(), value, True, root)
    assert NESTED_API in str(failure.value) and "同时" in str(failure.value)


def test_duplicate_entry_in_hard_failures_is_rejected(tmp_path: Path) -> None:
    """反例·重复：硬失败清单里重复登记同一个 ``file+type`` 必须被拒。"""

    root, snapshots = write_root(tmp_path, "ledger-duplicate-hard")
    value = real_report(root, snapshots)
    hard = entry_of(value, "registered_blockers", NESTED_UI)
    value["acceptance"]["hard_failures"] = [hard, copy.deepcopy(hard)]
    value["acceptance"]["counts"]["hard_failures"] = 2
    with pytest.raises(CheckError) as failure:
        run_checks.verify_acceptance_report(gate(), value, True, root)
    assert "同时" in str(failure.value)


def test_duplicate_nested_entry_is_rejected(tmp_path: Path) -> None:
    """反例·重复：同一文件的不同嵌套类型不会被折叠，必须逐个对账。"""

    root, snapshots = write_root(tmp_path, "ledger-duplicate-nested")
    value = real_report(root, snapshots)
    ui = entry_of(value, "registered_blockers", NESTED_UI)
    api = entry_of(value, "registered_blockers", NESTED_API)
    value["acceptance"]["registered_blockers"] = [ui, api, copy.deepcopy(ui)]
    value["acceptance"]["counts"]["registered_blockers"] = 3
    with pytest.raises(CheckError) as failure:
        run_checks.verify_acceptance_report(gate(), value, True, root)
    assert NESTED_UI in str(failure.value)


def test_same_key_in_blockers_and_hard_is_rejected(tmp_path: Path) -> None:
    """反例·互斥：同一个 ``file+type`` 同时出现在阻断与硬失败清单必须被拒。"""

    root, snapshots = write_root(tmp_path, "ledger-mutual-blockers")
    value = real_report(root, snapshots)
    value["acceptance"]["hard_failures"] = [
        entry_of(value, "registered_blockers", NESTED_API)
    ]
    value["acceptance"]["counts"]["hard_failures"] = 1
    with pytest.raises(CheckError) as failure:
        run_checks.verify_acceptance_report(gate(), value, True, root)
    assert "同时" in str(failure.value)


def test_same_key_in_accepted_and_blockers_is_rejected(tmp_path: Path) -> None:
    """反例·互斥：已验收条目不得同时出现在阻断清单。"""

    root, snapshots = write_root(tmp_path, "ledger-mutual-accepted", verdict=ACCEPTED,
                                 source_names=("ProbeDemo",))
    value = real_report(root, snapshots)
    assert value["acceptance"]["accepted"]
    value["acceptance"]["registered_blockers"] = [
        entry_of(value, "accepted", TOP_LEVEL)
    ]
    value["acceptance"]["counts"]["registered_blockers"] = 1
    value["status"] = run_checks.CHECK_STATUS_MAINTENANCE
    with pytest.raises(CheckError) as failure:
        run_checks.verify_acceptance_report(gate(), value, True, root)
    assert "已验收记录不能出现在阻断/硬失败清单" in str(failure.value)


def test_same_key_in_accepted_and_hard_is_rejected(tmp_path: Path) -> None:
    """反例·互斥：已验收条目不得同时出现在硬失败清单。"""

    root, snapshots = write_root(tmp_path, "ledger-mutual-hard", verdict=ACCEPTED,
                                 source_names=("ProbeDemo",))
    value = real_report(root, snapshots)
    value["acceptance"]["hard_failures"] = [entry_of(value, "accepted", TOP_LEVEL)]
    value["acceptance"]["counts"]["hard_failures"] = 1
    with pytest.raises(CheckError) as failure:
        run_checks.verify_acceptance_report(gate(), value, True, root)
    assert "已验收记录不能出现在阻断/硬失败清单" in str(failure.value)


def test_release_aggregator_applies_the_same_unique_key(tmp_path: Path) -> None:
    """正例·发布汇总：ci_gate 按同一唯一键双向对账，漏项同样被拒。"""

    root, snapshots = write_root(tmp_path, "ledger-ci-gate")
    report = real_report(root, snapshots)
    report["revision"] = "0" * 40
    report["acceptance"]["revision"] = "0" * 40
    written = tmp_path / "source-acceptance.json"
    written.write_text(
        json.dumps(drop(report, NESTED_UI), ensure_ascii=False), encoding="utf-8"
    )
    with pytest.raises(ValueError) as failure:
        ci_gate.source_acceptance(written, root, "0" * 40)
    assert "漏项" in str(failure.value)


# ---------------------------------------------------------------------------
# 漏洞 2：未知判词必须硬失败
# ---------------------------------------------------------------------------


def test_unknown_verdict_fails_maintenance_entry(tmp_path: Path) -> None:
    """反例·未知判词：维护入口必须硬失败，且诊断逐字指出该未知判词。"""

    root, snapshots = write_root(tmp_path, "verdict-maintenance", verdict=UNKNOWN_VERDICT)
    result = full_cli(root, snapshots, "--maintenance")
    assert result.returncode == 1, result.stdout + result.stderr
    report = json.loads(result.stdout)
    assert report["status"] == "failed"
    assert report["acceptance"]["counts"]["registered_blockers"] == 0
    assert report["acceptance"]["counts"]["hard_failures"] == 3
    assert UNKNOWN_VERDICT in result.stdout + result.stderr
    assert "不在已定义判词集合内" in result.stdout + result.stderr


def test_unknown_verdict_fails_strict_entry(tmp_path: Path) -> None:
    """反例·未知判词：严格入口必须硬失败，且诊断逐字指出该未知判词。"""

    root, snapshots = write_root(tmp_path, "verdict-strict", verdict=UNKNOWN_VERDICT)
    result = full_cli(root, snapshots)
    assert result.returncode == 1, result.stdout + result.stderr
    assert UNKNOWN_VERDICT in result.stdout + result.stderr
    assert "不在已定义判词集合内" in result.stdout + result.stderr
    assert json.loads(result.stdout)["acceptance"]["counts"]["hard_failures"] == 3


def test_unknown_verdict_fails_run_checks_maintenance(tmp_path: Path) -> None:
    """反例·未知判词：维护模式下调度器必须非零退出。"""

    root, snapshots = write_root(tmp_path, "verdict-run-maint", verdict=UNKNOWN_VERDICT)
    result = run_checks_cli(root, snapshots, "--maintenance")
    assert result.returncode != 0, result.stdout + result.stderr
    assert "不在已定义判词集合内" in result.stdout + result.stderr


def test_unknown_verdict_fails_run_checks_strict(tmp_path: Path) -> None:
    """反例·未知判词：严格模式下调度器必须非零退出。"""

    root, snapshots = write_root(tmp_path, "verdict-run-strict", verdict=UNKNOWN_VERDICT)
    result = run_checks_cli(root, snapshots)
    assert result.returncode != 0, result.stdout + result.stderr
    assert "不在已定义判词集合内" in result.stdout + result.stderr


@pytest.mark.parametrize("verdict", [BLOCKED, ROLLBACK, NEED_PROOF])
def test_known_blocker_verdicts_still_pass_maintenance(
    tmp_path: Path, verdict: str
) -> None:
    """正例：词表内的已登记阻断判词不受影响，维护入口仍然退出 0。"""

    root, snapshots = write_root(tmp_path, f"verdict-known-{abs(hash(verdict))}", verdict=verdict)
    result = full_cli(root, snapshots, "--maintenance")
    assert result.returncode == 0, result.stdout + result.stderr
    report = json.loads(result.stdout)
    assert report["acceptance"]["counts"]["registered_blockers"] == 3
    assert report["acceptance"]["counts"]["hard_failures"] == 0


def test_blank_verdict_fails_both_entries(tmp_path: Path) -> None:
    """反例·未知判词：判词为空同样按未知处理，两个入口都硬失败。"""

    root, snapshots = write_root(tmp_path, "verdict-blank")
    index = root / INDEX_RELATIVE
    document = json.loads(index.read_text(encoding="utf-8"))
    document["records"][0]["d12_verdict"] = "   "
    index.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
    for extra in ((), ("--maintenance",)):
        result = full_cli(root, snapshots, *extra)
        assert result.returncode == 1, result.stdout + result.stderr
        assert "d12_verdict" in result.stdout + result.stderr


# ---------------------------------------------------------------------------
# 漏洞 3：已登记阻断必须校验绑定材料的实际字节
# ---------------------------------------------------------------------------


def test_blocker_material_hash_mismatch_fails_maintenance(tmp_path: Path) -> None:
    """反例·哈希不符：维护入口必须按内容不符硬失败，并给出实测指纹。"""

    root, snapshots = write_root(
        tmp_path, "material-hash", upstream_sha256=digest("完全不同的上游内容")
    )
    result = full_cli(root, snapshots, "--maintenance")
    assert result.returncode == 1, result.stdout + result.stderr
    report = json.loads(result.stdout)
    assert report["acceptance"]["counts"]["registered_blockers"] == 0
    assert report["acceptance"]["counts"]["hard_failures"] == 3
    assert "实测指纹" in result.stdout + result.stderr


def test_blocker_material_hash_mismatch_fails_strict(tmp_path: Path) -> None:
    """反例·哈希不符：严格入口同样按内容不符硬失败。"""

    root, snapshots = write_root(
        tmp_path, "material-hash-strict", upstream_sha256=digest("完全不同的上游内容")
    )
    result = full_cli(root, snapshots)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "实测指纹" in result.stdout + result.stderr


def test_blocker_material_hash_mismatch_fails_run_checks(tmp_path: Path) -> None:
    """反例·哈希不符：调度器对被改判后的报告非零退出。"""

    root, snapshots = write_root(
        tmp_path, "material-hash-run", upstream_sha256=digest("完全不同的上游内容")
    )
    result = run_checks_cli(root, snapshots, "--maintenance")
    assert result.returncode != 0, result.stdout + result.stderr


def test_blocker_material_unavailable_is_evidence_unavailable(tmp_path: Path) -> None:
    """反例·材料不可得：进入独立“证据不可得”集合并以退出码 2 受控失败。"""

    root, snapshots = write_root(
        tmp_path, "material-unavailable", unreachable=True, snapshot=None
    )
    result = full_cli(root, snapshots, "--maintenance")
    assert result.returncode == 2, result.stdout + result.stderr
    report = json.loads(result.stdout)
    assert report["evidence_error"]
    assert report["acceptance"]["counts"]["evidence_unavailable"] == 3
    assert report["acceptance"]["counts"]["registered_blockers"] == 0
    assert "上游内容取不回" in result.stdout + result.stderr


def test_blocker_material_unavailable_differs_from_hash_mismatch(tmp_path: Path) -> None:
    """反例·两类错误分别报错：取不回是环境故障，内容不符是数据不一致。"""

    unavailable_root, unavailable_snapshots = write_root(
        tmp_path, "material-two-unavailable", unreachable=True, snapshot=None
    )
    mismatch_root, mismatch_snapshots = write_root(
        tmp_path, "material-two-mismatch", upstream_sha256=digest("完全不同的上游内容")
    )
    unavailable = full_cli(unavailable_root, unavailable_snapshots, "--maintenance")
    mismatch = full_cli(mismatch_root, mismatch_snapshots, "--maintenance")
    assert unavailable.returncode == 2 and mismatch.returncode == 1
    unavailable_report = json.loads(unavailable.stdout)
    mismatch_report = json.loads(mismatch.stdout)
    assert unavailable_report["acceptance"]["counts"]["evidence_unavailable"] == 3
    assert mismatch_report["acceptance"]["counts"]["evidence_unavailable"] == 0
    assert mismatch_report["acceptance"]["counts"]["hard_failures"] == 3


def test_matching_blocker_material_still_passes_maintenance(tmp_path: Path) -> None:
    """正例：绑定材料与登记指纹一致时，已登记阻断不受影响。"""

    root, snapshots = write_root(tmp_path, "material-ok")
    result = full_cli(root, snapshots, "--maintenance")
    assert result.returncode == 0, result.stdout + result.stderr
    report = json.loads(result.stdout)
    assert report["acceptance"]["counts"]["registered_blockers"] == 3
    assert report["acceptance"]["counts"]["hard_failures"] == 0


def test_unavailable_reason_matches_rule_implementation(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """正例：本入口的“取不回”措辞与规则实现逐字一致，消费者前缀识别不会失效。"""

    root, snapshots = write_root(tmp_path, "material-reason", unreachable=True, snapshot=None)
    registry = full.resolve_evidence(None, snapshots, root)
    url = f"https://{UNREACHABLE}/blob/{COMMIT}/{UPSTREAM_PATH}"

    def refuse(target: str) -> bytes:
        """模拟一次真实的取回失败。"""

        raise OSError("boom")

    monkeypatch.setattr(java, "_fetch_upstream_bytes", refuse)
    reason, _ = java._verify_upstream_snapshot(
        registry,
        repository=REPO,
        commit=COMMIT,
        upstream_path=UPSTREAM_PATH,
        expected_sha256=digest(UPSTREAM_SOURCE),
        file_url=url,
    )
    assert reason is not None
    assert full.bound_material_unavailable_reason(url, "OSError: boom") == reason
    assert full.parse_upstream_unavailable(reason) == (url, "OSError: boom")