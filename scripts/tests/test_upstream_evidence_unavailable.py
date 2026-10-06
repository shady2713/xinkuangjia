"""验证“上游内容取不回”与“内容不符”是两类事实，不能互相冒充。

真实缺陷：云端 run 37453344259 的 `文档与工具检查` 在“运行注释检查”步骤返回
code 2，诊断是“已验收记录不能出现在阻断/硬失败清单：…/DictDataCommonApi.java”。
该记录在受控索引里已验收且登记完整，真实原因是 CI 上固定地址取回上游内容失败
（未配置 `JAVA_COMMENT_EVIDENCE_SNAPSHOTS`），网络故障被转成了逐记录的硬失败，
再与索引判词对撞，才产生指向错误整改方向的诊断。

本模块用**真实 CLI** 在隔离根目录上覆盖：
① 取不回 → 退出 2，诊断写“取不回”，记录进入独立“证据不可得”集合而不是硬失败；
② 取回但内容被篡改 → 仍按内容不符硬失败，退出 1；
③ 真实不一致（accepted 记录的对象绑定失效）→ 仍被 run_checks 非零拒绝；
④ 声明证据不可得的报告不能靠删记录绕过逐项复核。

规则测试不读取本机 .bf-local，也不修改真实索引、源码或 D10 清单。

@author 上游取回修复方向执行代理
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.code.java import check_full_java_comments as full
from scripts.code.java import check_staged_java_comments as java
from scripts.common.quality_common import DEFAULT_ROOT, CheckError
from scripts.workflow import run_checks

REPO = "YunaiV/ruoyi-vue-pro"
COMMIT = "ac022b15a094cf9cf82903d429b9729e72309da5"
UPSTREAM_PATH = "yudao-framework/yudao-common/src/main/java/example/ProbeDemo.java"
UPSTREAM_SOURCE = "/**\n * 上游类型。\n */\npublic class ProbeDemo {\n}\n"
LOCAL_PATH = (
    "后端代码/basic-framework-boot/basic-framework-core/basic-framework-common/"
    "src/main/java/example/ProbeDemo.java"
)
ACCEPTED = "已按 D12 格式写入来源说明并撤回无依据署名"
# 固定地址不可达：连接立即被拒绝，与真实 CI 上“取不回”同属一类环境故障。
UNREACHABLE = "127.0.0.1:9"
INDEX_RELATIVE = "docs/测试与可靠性/来源证据/d12-source-index.json"
COLLUSION = "已验收记录不能出现在阻断/硬失败清单"


def digest(value: str) -> str:
    """返回文本的 SHA-256。"""

    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def local_source() -> str:
    """生成一条合法已验收来源说明的 Java 样本（正文无验收标注）。"""

    body = [
        " * 演示来源说明的验收状态判据。",
        " *",
        f" * 来源：{REPO} @ {COMMIT}（该版本未声明作者）",
        f" * 上游文件：{UPSTREAM_PATH}",
        " * 来源依据：固定见证版本；历史引入版本未核实。",
        " * 本地修改：调整包名与类名。",
        " * 说明：来源说明例外测试片段。",
    ]
    return "package example;\n\n" + "\n".join(["/**", *body, " */"]) + "\npublic class ProbeDemo {\n}\n"


def javadoc_of(source: str) -> str:
    """取出源码中第一段 JavaDoc 原文。"""

    start = source.index("/**")
    return source[start : source.index("*/", start) + 2]


def record(source: str, *, reachable: bool = True, local_sha256: str | None = None) -> dict[str, object]:
    """构造一条受控索引记录；``reachable=False`` 时把固定地址指向不可达主机。"""

    host = f"https://github.com/{REPO}" if reachable else f"https://{UNREACHABLE}"
    return {
        "local_path": LOCAL_PATH,
        "local_sha256_after": local_sha256 or digest(source),
        "upstream_repo_url": f"https://github.com/{REPO}.git",
        "upstream_path": UPSTREAM_PATH,
        "upstream_commit": COMMIT,
        "upstream_file_url": f"{host}/blob/{COMMIT}/{UPSTREAM_PATH}",
        "upstream_sha256": digest(UPSTREAM_SOURCE),
        "upstream_author_lines": "",
        "history_basis": "引入提交未知，本行以固定见证版本作来源见证。",
        "evidence_route": "路线 3",
        "evidence_points": "P1 片段 本地 L1 / 上游 L1；P2 注释点 本地 L2 / 上游 L2",
        "author_status": "已核实来源但作者未声明",
        "local_modification_facts": "调整包名与类名。",
        "open_gap": "上游该版本未声明作者；历史引入版本未核实。",
        "review_by": "上游取回规则测试",
        "review_date": "2026-10-06",
        "review_conclusion": "逐项复核 ProbeDemo：来源、指纹与无作者结论一致。",
        "type_evidence": json.dumps(
            {
                "schema": "d12-type-evidence/v1",
                "file": {"local_sha256_final": digest(source)},
                "types": [
                    {
                        "qualified_name": "example.ProbeDemo",
                        "simple_name": "ProbeDemo",
                        "kind": "class",
                        "nested": False,
                        "enclosing_type": None,
                        "upstream_type": "cn.iocoder.yudao.example.ProbeDemo",
                        "upstream_author_declared": False,
                        "javadoc_sha256": digest(javadoc_of(source)),
                        "review_by": "上游取回规则测试",
                        "review_date": "2026-10-06",
                        "review_conclusion": "逐项复核 ProbeDemo：来源、指纹与无作者结论一致。",
                    }
                ],
            },
            ensure_ascii=False,
        ),
        "d12_verdict": ACCEPTED,
        "d12_blocker_reason": "",
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


def build_root(
    tmp_path: Path,
    name: str,
    *,
    reachable: bool = True,
    snapshot: str | None = UPSTREAM_SOURCE,
    local_sha256: str | None = None,
) -> tuple[Path, Path]:
    """写出隔离根目录、受控索引与上游快照目录。

    ``snapshot`` 为 ``None`` 表示不提供受控快照：本次只能按固定地址取回，正好覆盖
    CI 未配置 ``JAVA_COMMENT_EVIDENCE_SNAPSHOTS`` 的真实情形。

    Returns:
        ``(仓库根, 快照根)``；快照根在未写出任何快照时是已存在的空目录。
    """

    source = local_source()
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
                        reachable=reachable,
                        **({"local_sha256": local_sha256} if local_sha256 else {}),
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
        path = snapshots / f"ruoyi-vue-pro@{COMMIT}" / UPSTREAM_PATH
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(snapshot, encoding="utf-8")
    return root, snapshots


def full_cli(root: Path, snapshots: Path, tmp_path: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    """以真实 CLI 运行全量 Java 注释检查并保留真实退出码与报告。"""

    report = tmp_path / "acceptance-report.json"
    return subprocess.run(
        [
            sys.executable,
            "-B",
            "-X",
            "utf8",
            str(DEFAULT_ROOT / "scripts/code/java/check_full_java_comments.py"),
            "--root",
            str(root),
            "--json",
            "--acceptance-report",
            str(report),
            *extra,
        ],
        cwd=DEFAULT_ROOT,
        env={**os.environ, java.EVIDENCE_SNAPSHOTS_ENV: str(snapshots)},
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=180,
    )


def run_checks_cli(root: Path, snapshots: Path, tmp_path: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    """以真实 CLI 运行 CI 同款调度（run_checks 的全量 Java 注释检查）。"""

    return subprocess.run(
        [
            sys.executable,
            "-B",
            "-X",
            "utf8",
            str(DEFAULT_ROOT / "scripts/workflow/run_checks.py"),
            "--checks",
            "java-comments-full",
            "--root",
            str(root),
            "--json",
            "--report",
            str(tmp_path / "report.json"),
            *extra,
        ],
        cwd=DEFAULT_ROOT,
        env={**os.environ, java.EVIDENCE_SNAPSHOTS_ENV: str(snapshots)},
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=180,
    )


def test_upstream_unavailable_is_environment_error_not_content_failure(tmp_path: Path) -> None:
    """负对照①：固定地址取不回 → 退出 2、独立证据不可得集合、硬失败仍为 0。"""

    root, snapshots = build_root(tmp_path, "unavailable", reachable=False, snapshot=None)
    result = full_cli(root, snapshots, tmp_path, "--maintenance")
    assert result.returncode == 2, result.stdout + result.stderr
    report = json.loads(result.stdout)
    assert "上游内容取不回" in report["evidence_error"]
    assert UNREACHABLE in report["evidence_error"]
    assert COLLUSION not in result.stdout + result.stderr
    counts = report["acceptance"]["counts"]
    assert counts["evidence_unavailable"] == 1
    assert counts["hard_failures"] == 0 and counts["findings"] == 0
    assert counts["accepted"] == 0, "没取回证据的记录不得计入已验收"
    unavailable = report["acceptance"]["evidence_unavailable"]
    assert [item["path"] for item in unavailable] == [LOCAL_PATH]
    assert unavailable[0]["verdict"] == ACCEPTED
    assert unavailable[0]["unavailable"][0]["url"].startswith(f"https://{UNREACHABLE}/")
    assert "Connection refused" in unavailable[0]["unavailable"][0]["reason"]
    assert report["status"] == "failed"
    # 写出的来源验收报告必须同样区分两类事实，供 ci_gate 与作业摘要复核。
    artifact = json.loads((tmp_path / "acceptance-report.json").read_text(encoding="utf-8"))
    assert artifact["evidence_error"] == report["evidence_error"]
    assert artifact["acceptance"]["evidence_unavailable"][0]["path"] == LOCAL_PATH


def test_run_checks_reports_unavailability_instead_of_collision(tmp_path: Path) -> None:
    """负对照①的消费者侧：run_checks 退出 2，诊断是“取不回”而不是“已验收却阻断”。"""

    root, snapshots = build_root(tmp_path, "unavailable-runchecks", reachable=False, snapshot=None)
    result = run_checks_cli(root, snapshots, tmp_path, "--maintenance")
    assert result.returncode == 2, result.stdout + result.stderr
    summary = json.loads(result.stdout)
    assert summary["code"] == 2
    assert "上游内容取不回" in summary["evidence_error"]
    outcome = next(item for item in summary["results"] if item["name"] == "java-comments-full")
    assert outcome["status"] == "environment-error"
    assert outcome["process_code"] == 2
    assert "上游内容取不回" in outcome["reason"]
    assert COLLUSION not in outcome["reason"]


def test_tampered_upstream_content_remains_hard_failure(tmp_path: Path) -> None:
    """负对照②：取回得到但内容被篡改 1 字节 → 仍按内容不符硬失败并退出 1。"""

    tampered = UPSTREAM_SOURCE.replace("ProbeDemo", "ProbeDem0")
    assert len(tampered) == len(UPSTREAM_SOURCE) and tampered != UPSTREAM_SOURCE
    root, snapshots = build_root(tmp_path, "tampered", snapshot=tampered)
    result = full_cli(root, snapshots, tmp_path, "--maintenance")
    assert result.returncode == 1, result.stdout + result.stderr
    report = json.loads(result.stdout)
    assert report["evidence_error"] == "", "内容不符不是证据不可得"
    counts = report["acceptance"]["counts"]
    assert counts["evidence_unavailable"] == 0
    assert counts["hard_failures"] == 1 and counts["findings"] == 1
    assert "实测指纹" in report["acceptance"]["hard_failures"][0]["reasons"][0]


def test_run_checks_still_rejects_accepted_record_with_broken_binding(tmp_path: Path) -> None:
    """负对照③：真实数据不一致（对象绑定失效）仍被非零拒绝，不被新逻辑放过。"""

    root, snapshots = build_root(tmp_path, "broken-binding", local_sha256="0" * 64)
    result = run_checks_cli(root, snapshots, tmp_path, "--maintenance")
    assert result.returncode != 0, result.stdout + result.stderr
    summary = json.loads(result.stdout)
    assert summary["evidence_error"] == "", "真实不一致不得被表述成证据不可得"
    outcome = next(item for item in summary["results"] if item["name"] == "java-comments-full")
    assert COLLUSION in outcome["reason"]
    assert LOCAL_PATH in outcome["reason"]


def test_evidence_error_report_cannot_hide_records(tmp_path: Path) -> None:
    """反例：声明证据不可得的报告若把同一条记录同时写进已验收或硬失败清单必须被拒。"""

    root, snapshots = build_root(tmp_path, "hide", reachable=False, snapshot=None)
    index = root / INDEX_RELATIVE
    source = local_source()
    common = {
        "registry": str(index),
        "registry_sha256": hashlib.sha256(index.read_bytes()).hexdigest(),
        "records": 1,
    }
    entry = {
        "record_id": f"{LOCAL_PATH}#example.ProbeDemo",
        "path": LOCAL_PATH,
        "line": 12,
        "type_name": "example.ProbeDemo",
        "form": "来源说明",
        "classification": "evidence-unavailable",
        "verdict": ACCEPTED,
        "blocker_reason": "",
        "open_gap": "上游该版本未声明作者；历史引入版本未核实。",
        "local_sha256": digest(source),
        "unavailable": [{"url": f"https://{UNREACHABLE}/x.java", "reason": "URLError: refused"}],
    }
    value = {
        "protocol": java.ACCEPTANCE_PROTOCOL,
        "check": "Java 注释（全量）",
        "checked": 1,
        "findings": [],
        "status": "failed",
        "executed": True,
        "process_exit_code": 2,
        "evidence": common,
        "evidence_error": "上游内容取不回：https://127.0.0.1:9/x.java：URLError: refused",
        "acceptance": {
            "schema": java.ACCEPTANCE_REPORT_SCHEMA,
            "mode": "maintenance",
            "counts": {
                "scanned_files": 1,
                "accepted": 1,
                "registered_blockers": 0,
                "hard_failures": 0,
                "findings": 0,
                "uncovered_records": 0,
                "evidence_unavailable": 1,
            },
            "accepted": [{**entry, "classification": "accepted"}],
            "registered_blockers": [],
            "hard_failures": [],
            "uncovered_records": [],
            "evidence_unavailable": [entry],
            "scope": {"files": [LOCAL_PATH], "count": 1},
        },
    }
    gate = run_checks.Gate(
        "java-comments-full", "code/java/check_full_java_comments.py", "comments", acceptance=True
    )
    with pytest.raises(CheckError) as error:
        run_checks.verify_acceptance_report(gate, value, True, root)
    assert "同一记录不能同时出现在证据不可得与逐项清单" in str(error.value)


def test_declared_evidence_error_is_not_a_verdict(tmp_path: Path) -> None:
    """正例：证据不可得报告本身被按环境失败拒绝，绝不签发通过或维护完成。"""

    root, snapshots = build_root(tmp_path, "declared", reachable=False, snapshot=None)
    index = root / INDEX_RELATIVE
    source = local_source()
    value = {
        "protocol": java.ACCEPTANCE_PROTOCOL,
        "check": "Java 注释（全量）",
        "checked": 1,
        "findings": [],
        "status": "failed",
        "executed": True,
        "process_exit_code": 2,
        "evidence": {
            "registry": str(index),
            "registry_sha256": hashlib.sha256(index.read_bytes()).hexdigest(),
            "records": 1,
        },
        "evidence_error": "上游内容取不回：https://127.0.0.1:9/x.java：URLError: refused",
        "acceptance": {
            "schema": java.ACCEPTANCE_REPORT_SCHEMA,
            "mode": "maintenance",
            "counts": {
                "scanned_files": 1,
                "accepted": 0,
                "registered_blockers": 0,
                "hard_failures": 0,
                "findings": 0,
                "uncovered_records": 0,
                "evidence_unavailable": 1,
            },
            "accepted": [],
            "registered_blockers": [],
            "hard_failures": [],
            "uncovered_records": [],
            "evidence_unavailable": [
                {
                    "record_id": f"{LOCAL_PATH}#example.ProbeDemo",
                    "path": LOCAL_PATH,
                    "line": 12,
                    "type_name": "example.ProbeDemo",
                    "form": "来源说明",
                    "classification": "evidence-unavailable",
                    "verdict": ACCEPTED,
                    "blocker_reason": "",
                    "open_gap": "上游该版本未声明作者；历史引入版本未核实。",
                    "local_sha256": digest(source),
                    "unavailable": [
                        {"url": "https://127.0.0.1:9/x.java", "reason": "URLError: refused"}
                    ],
                }
            ],
            "scope": {"files": [LOCAL_PATH], "count": 1},
        },
    }
    gate = run_checks.Gate(
        "java-comments-full", "code/java/check_full_java_comments.py", "comments", acceptance=True
    )
    with pytest.raises(CheckError) as error:
        run_checks.verify_acceptance_report(gate, value, True, root)
    message = str(error.value)
    assert "证据不可得" in message and "上游内容取不回" in message
    assert COLLUSION not in message


def test_ledger_recomputation_distinguishes_unavailable_from_mismatch(tmp_path: Path) -> None:
    """消费者复算：已验收记录只因“取不回”进了硬失败清单时，诊断必须是证据不可得。"""

    root, _snapshots = build_root(tmp_path, "ledger-recompute")
    source = local_source()
    unavailable_reason = (
        f"E1-author-only 上游比较输入未通过核验：{full.UPSTREAM_UNAVAILABLE_PREFIX} "
        "https://x/y.java（URLError: Connection refused）"
    )
    entry = {
        "record_id": f"{LOCAL_PATH}#example.ProbeDemo",
        "path": LOCAL_PATH,
        "line": 12,
        "type_name": "example.ProbeDemo",
        "form": "来源说明",
        "classification": "hard-failure",
        "verdict": ACCEPTED,
        "blocker_reason": "上游内容未能复核",
        "open_gap": "上游该版本未声明作者；历史引入版本未核实。",
        "local_sha256": digest(source),
        "reasons": [unavailable_reason],
    }
    index = root / INDEX_RELATIVE

    def report_with(reasons: list[str]) -> dict[str, object]:
        """按给定逐项原因构造一份“已验收记录被算成硬失败”的 v2 报告。"""

        return {
            "protocol": java.ACCEPTANCE_PROTOCOL,
            "check": "Java 注释",
            "checked": 1,
            "findings": [
                {
                    "path": LOCAL_PATH,
                    "line": 12,
                    "rule": "type-author",
                    "detail": "；".join(reasons),
                }
            ],
            "status": "failed",
            "executed": True,
            "process_exit_code": 1,
            "evidence": {
                "registry": str(index),
                "registry_sha256": hashlib.sha256(index.read_bytes()).hexdigest(),
                "records": 1,
            },
            "acceptance": {
                "schema": java.ACCEPTANCE_REPORT_SCHEMA,
                "mode": "maintenance",
                "counts": {
                    "scanned_files": 1,
                    "accepted": 0,
                    "registered_blockers": 0,
                    "hard_failures": 1,
                    "findings": 1,
                    "uncovered_records": 0,
                },
                "accepted": [],
                "registered_blockers": [],
                "hard_failures": [{**entry, "reasons": reasons}],
                "uncovered_records": [],
                "scope": {"files": [LOCAL_PATH], "count": 1},
            },
        }

    gate = run_checks.Gate(
        "java-comments",
        "code/java/check_worktree_java_comments.py",
        "comments",
        acceptance=True,
    )
    with pytest.raises(CheckError) as unavailable:
        run_checks.verify_acceptance_report(gate, report_with([unavailable_reason]), True, root)
    message = str(unavailable.value)
    assert "证据不可得" in message and "上游内容取不回" in message
    assert COLLUSION not in message

    content_reason = "本地最终指纹不符：清单 0000，实测 5af1"
    with pytest.raises(CheckError) as mismatch:
        run_checks.verify_acceptance_report(gate, report_with([content_reason]), True, root)
    assert COLLUSION in str(mismatch.value)
    assert content_reason in str(mismatch.value), "真实内容不符必须给出可定位的逐项原因"


def test_mixed_record_keeps_content_hard_failure() -> None:
    """单元判据：同一条记录既有取不回又有真实内容问题时，必须仍是硬失败。"""

    unavailable = f"{full.UPSTREAM_UNAVAILABLE_PREFIX} https://x/y.java（URLError: refused）"
    content = "本地最终指纹不符：清单 a，实测 b"
    state = java.AcceptanceState(
        record_id=f"{LOCAL_PATH}#example.ProbeDemo",
        path=LOCAL_PATH,
        line=12,
        type_name="example.ProbeDemo",
        form="来源说明",
        classification=java.ACCEPTANCE_STATE_HARD_FAILURE,
        verdict=ACCEPTED,
        blocker_reason="",
        open_gap="缺口",
        route="路线 3",
        branch="",
        local_sha256="0" * 64,
        upstream_commit=COMMIT,
        upstream_sha256="1" * 64,
        review_by="判据测试",
        review_conclusion="逐项复核",
        reasons=(unavailable, content),
    )
    ledger = java.AcceptanceLedger()
    ledger.add(state)
    findings = [
        java.Finding(LOCAL_PATH, 12, "type-author", f"署名未被独立验收：{unavailable}；{content}", True)
    ]
    summary = full.split_evidence_unavailability(
        ledger, findings, [{"url": "https://x/y.java", "reason": "URLError: refused"}]
    )
    assert summary == []
    assert ledger.hard_failures()[0].reasons == (unavailable, content), "既有原因必须逐字保留"
    assert len(findings) == 1, "真实内容问题不能因为同时存在环境故障而被移除"


def test_unavailable_record_leaves_content_lists() -> None:
    """单元判据：只有取不回原因的记录才移出硬失败集合并移除对应诊断。"""

    unavailable = f"{full.UPSTREAM_UNAVAILABLE_PREFIX} https://x/y.java（URLError: refused）"
    state = java.AcceptanceState(
        record_id=f"{LOCAL_PATH}#example.ProbeDemo",
        path=LOCAL_PATH,
        line=12,
        type_name="example.ProbeDemo",
        form="来源说明",
        classification=java.ACCEPTANCE_STATE_HARD_FAILURE,
        verdict=ACCEPTED,
        blocker_reason="",
        open_gap="缺口",
        route="路线 3",
        branch="",
        local_sha256="0" * 64,
        upstream_commit=COMMIT,
        upstream_sha256="1" * 64,
        review_by="判据测试",
        review_conclusion="逐项复核",
        reasons=(unavailable,),
    )
    ledger = java.AcceptanceLedger()
    ledger.add(state)
    findings = [
        java.Finding(LOCAL_PATH, 12, "type-author", f"署名未被独立验收：{unavailable}", True)
    ]
    summary = full.split_evidence_unavailability(
        ledger, findings, [{"url": "https://x/y.java", "reason": "URLError: refused"}]
    )
    assert [item["path"] for item in summary] == [LOCAL_PATH]
    assert ledger.hard_failures() == [] and ledger.accepted() == []
    assert findings == []
    assert "上游内容取不回：https://x/y.java：URLError: refused" == full.evidence_error_text(summary)


def test_mirrored_prefix_still_matches_the_rule_module() -> None:
    """耦合守卫：两个入口镜像的“取不回”前缀必须仍存在于规则实现中。"""

    rules = (DEFAULT_ROOT / "scripts/code/java/check_staged_java_comments.py").read_text(
        encoding="utf-8"
    )
    assert full.UPSTREAM_UNAVAILABLE_PREFIX in rules
    assert run_checks.UPSTREAM_UNAVAILABLE_PREFIX == full.UPSTREAM_UNAVAILABLE_PREFIX
    sample = f"{full.UPSTREAM_UNAVAILABLE_PREFIX} https://x/y.java（TimeoutError: timed out）"
    assert full.parse_upstream_unavailable(sample) == ("https://x/y.java", "TimeoutError: timed out")
    assert run_checks.upstream_unavailable(sample) == ("https://x/y.java", "TimeoutError: timed out")
    assert full.parse_upstream_unavailable("上游内容实测指纹 a 与清单 b 不符") is None