"""验证 D15 验收状态链：检查器 → run_checks → verify_report → ci_gate。

全部用例用**真实 CLI** 在隔离根目录上运行，保留真实退出码与诊断：
① 合法 accepted 记录的严格链在 run_checks 与 verify_report 都通过；
② 已登记阻断在维护模式下进入独立清单、退出 0 且不计入 passed；严格入口退出 1；
③ run_checks 不接受子工具自造的 v2 声明：少报阻断、未显式维护模式都会被拒绝。

规则测试不读取本机 .bf-local，也不修改真实索引、源码或 D10 清单。

@author OpenAI Codex
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.common.quality_common import DEFAULT_ROOT
from scripts.workflow import run_checks

REPO = "YunaiV/ruoyi-vue-pro"
COMMIT = "ac022b15a094cf9cf82903d429b9729e72309da5"
UPSTREAM_PATH = "yudao-framework/yudao-common/src/main/java/example/ProbeDemo.java"
UPSTREAM_SOURCE = "/**\n * 上游类型。\n */\npublic class ProbeDemo {\n}\n"
LOCAL_DIR = (
    "后端代码/basic-framework-boot/basic-framework-core/basic-framework-common/"
    "src/main/java/example"
)
ACCEPTED = "已按 D12 格式写入来源说明并撤回无依据署名"
BLOCKED = "证据不足，保持原状并登记阻断"
UNACCEPTED_MARKER = "来源验收：尚未验收"
INDEX_RELATIVE = "docs/测试与可靠性/来源证据/d12-source-index.json"


def digest(value: str) -> str:
    """返回文本的 SHA-256。"""

    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def local_source(marker: str = "") -> str:
    """生成带来源说明（可选机读验收标注）的 Java 样本。"""

    body = [
        " * 演示来源说明的验收状态判据。",
        " *",
        f" * 来源：{REPO} @ {COMMIT}（该版本未声明作者）",
        f" * 上游文件：{UPSTREAM_PATH}",
        " * 来源依据：固定见证版本；历史引入版本未核实。",
        " * 本地修改：调整包名与类名。",
    ]
    if marker:
        body.append(f" * {marker}")
    body.append(" * 说明：来源说明例外测试片段。")
    return (
        "package example;\n\n"
        + "\n".join(["/**", *body, " */"])
        + "\npublic class ProbeDemo {\n}\n"
    )


def javadoc_of(source: str) -> str:
    """取出源码中第一段 JavaDoc 原文。"""

    start = source.index("/**")
    return source[start : source.index("*/", start) + 2]


def record(path: str, source: str, verdict: str, blocker: str) -> dict[str, object]:
    """构造一条隔离探针使用的受控索引记录。"""

    return {
        "local_path": path,
        "local_sha256_after": digest(source),
        "upstream_repo_url": f"https://github.com/{REPO}.git",
        "upstream_path": UPSTREAM_PATH,
        "upstream_commit": COMMIT,
        "upstream_file_url": f"https://github.com/{REPO}/blob/{COMMIT}/{UPSTREAM_PATH}",
        "upstream_sha256": digest(UPSTREAM_SOURCE),
        "upstream_author_lines": "",
        "history_basis": "引入提交未知，本行以固定见证版本作来源见证。",
        "evidence_route": "路线 3",
        "evidence_points": (
            "P1 内容点（共享有区分力字符串字面量）：来源说明例外测试片段 本地 L1 / 上游 L1；"
            "P2 注释点（共享独特注释正文）：演示来源说明的验收状态判据 本地 L2 / 上游 L2"
        ),
        "author_status": "已核实来源但作者未声明",
        "local_modification_facts": "调整包名与类名。",
        "open_gap": "上游该版本未声明作者；历史引入版本未核实。",
        "review_by": "D15 规则测试",
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
                        "review_by": "D15 规则测试",
                        "review_date": "2026-10-06",
                        "review_conclusion": "逐项复核 ProbeDemo：来源、指纹与无作者结论一致。",
                    }
                ],
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


def build_root(tmp_path: Path, name: str, *, marker: str, verdict: str, blocker: str) -> tuple[Path, Path]:
    """写出隔离根目录、受控索引与上游快照。"""

    path = f"{LOCAL_DIR}/ProbeDemo.java"
    source = local_source(marker)
    root = tmp_path / name
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(source, encoding="utf-8")
    index = root / INDEX_RELATIVE
    index.parent.mkdir(parents=True, exist_ok=True)
    index.write_text(
        json.dumps(
            {"index_schema": "d12-source-index/v1", "records": [record(path, source, verdict, blocker)]},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    snapshots = tmp_path / f"{name}-snapshots"
    snapshot = snapshots / f"ruoyi-vue-pro@{COMMIT}" / UPSTREAM_PATH
    snapshot.parent.mkdir(parents=True, exist_ok=True)
    snapshot.write_text(UPSTREAM_SOURCE, encoding="utf-8")
    return root, snapshots


def run_checks_cli(
    root: Path,
    snapshots: Path,
    tmp_path: Path,
    *extra: str,
) -> subprocess.CompletedProcess[str]:
    """用真实 run_checks CLI 在隔离根目录上运行全量 Java 注释检查。"""

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
        env={**os.environ, "JAVA_COMMENT_EVIDENCE_SNAPSHOTS": str(snapshots)},
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=180,
    )


def verify_cli(root: Path, tmp_path: Path) -> subprocess.CompletedProcess[str]:
    """用真实 verify_report CLI 复核 run_checks 写出的报告。"""

    return subprocess.run(
        [
            sys.executable,
            "-B",
            "-X",
            "utf8",
            str(DEFAULT_ROOT / "scripts/workflow/verify_report.py"),
            str(tmp_path / "report.json"),
            "--root",
            str(root),
            "--json",
        ],
        cwd=DEFAULT_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
    )


def report_document(tmp_path: Path) -> dict[str, object]:
    """读取 run_checks 写出的报告。"""

    return json.loads((tmp_path / "report.json").read_text(encoding="utf-8"))


def test_strict_chain_passes_on_isolated_root(tmp_path: Path) -> None:
    """正例：合法 accepted 记录在 run_checks 严格入口与 verify_report 都通过。"""

    root, snapshots = build_root(
        tmp_path, "chain-accepted", marker="", verdict=ACCEPTED, blocker=""
    )
    result = run_checks_cli(root, snapshots, tmp_path)
    assert result.returncode == 0, result.stdout + result.stderr
    summary = json.loads(result.stdout)
    assert summary["code"] == 0 and summary["status"] == "passed"
    assert summary["counts"]["passed"] == 1 and summary["counts"]["registered_blockers"] == 0
    verified = verify_cli(root, tmp_path)
    assert verified.returncode == 0, verified.stdout + verified.stderr
    assert json.loads(verified.stdout)["status"] == "valid"


def test_maintenance_chain_states_blockers_without_passing(tmp_path: Path) -> None:
    """正例：已登记阻断在维护模式下退出 0、独立成列且不计入 passed。"""

    root, snapshots = build_root(
        tmp_path,
        "chain-registered",
        marker=UNACCEPTED_MARKER,
        verdict=BLOCKED,
        blocker="只有 1 个独立定位对应点。",
    )
    acceptance_report = tmp_path / "acceptance.json"
    result = run_checks_cli(
        root,
        snapshots,
        tmp_path,
        "--maintenance",
        "--acceptance-report",
        str(acceptance_report),
    )
    assert result.returncode == 0, result.stdout + result.stderr
    summary = json.loads(result.stdout)
    assert summary["status"] == "completed-with-registered-blockers"
    assert summary["counts"]["passed"] == 0
    assert summary["counts"]["registered_blockers"] == 1
    assert summary["counts"]["hard_failures"] == 0
    assert summary["source_acceptance"]["counts"]["registered_blockers"] == 1
    # 报告制品必须真实写出，且逐项阻断不进入已验收清单。
    document = json.loads(acceptance_report.read_text(encoding="utf-8"))
    acceptance = document["acceptance"]
    assert acceptance["counts"]["registered_blockers"] == 1
    assert acceptance["counts"]["accepted"] == 0
    assert acceptance["registered_blockers"][0]["classification"] == "registered-blocker"
    assert acceptance["scope"]["files"] == [f"{LOCAL_DIR}/ProbeDemo.java"]
    assert document["acceptance"]["revision"] == document["revision"]
    # verify_report 必须同步 v2：维护完成态可复核，但 state 明示来源验收未通过。
    verified = verify_cli(root, tmp_path)
    assert verified.returncode == 0, verified.stdout + verified.stderr
    verified_value = json.loads(verified.stdout)
    assert verified_value["status"] == "valid"
    assert verified_value["state"] == "completed-with-registered-blockers"
    # 严格入口对同一输入仍然退出 1 并保留真实诊断。
    strict = run_checks_cli(root, snapshots, tmp_path)
    assert strict.returncode == 1, strict.stdout + strict.stderr
    strict_summary = json.loads(strict.stdout)
    assert strict_summary["status"] == "failed"
    assert strict_summary["counts"]["registered_blockers"] == 1
    # 维护完成态不得被当成通过：失败报告仍被 verify_report 拒绝。
    failed_verified = verify_cli(root, tmp_path)
    assert failed_verified.returncode == 1, failed_verified.stdout + failed_verified.stderr
    failed_value = json.loads(failed_verified.stdout)
    assert failed_value["status"] == "invalid"
    assert failed_value["state"] == "failed"
    assert "checks-not-passed" in failed_value["reasons"]


def test_run_checks_rejects_self_declared_maintenance(tmp_path: Path) -> None:
    """反例：调用方未显式选择维护模式时，子工具的维护完成态声明必须被拒绝。"""

    root, snapshots = build_root(
        tmp_path,
        "chain-declared",
        marker=UNACCEPTED_MARKER,
        verdict=BLOCKED,
        blocker="只有 1 个独立定位对应点。",
    )
    gate = run_checks.Gate(
        "java-comments-full", "code/java/check_full_java_comments.py", "comments", acceptance=True
    )
    value = {
        "protocol": "quality-check/v2",
        "check": "Java 注释（全量）",
        "checked": 1,
        "findings": [],
        "status": "completed-with-registered-blockers",
        "evidence": {
            "registry": str(root / INDEX_RELATIVE),
            "registry_sha256": hashlib.sha256((root / INDEX_RELATIVE).read_bytes()).hexdigest(),
            "records": 1,
        },
        "acceptance": {
            "schema": "source-acceptance-report/v1",
            "mode": "maintenance",
            "counts": {
                "scanned_files": 1,
                "accepted": 0,
                "registered_blockers": 1,
                "hard_failures": 0,
                "findings": 0,
                "uncovered_records": 0,
            },
            "accepted": [],
            "registered_blockers": [],
            "hard_failures": [],
            "uncovered_records": [],
        },
    }
    with pytest.raises(run_checks.CheckError) as failure:
        run_checks.verify_acceptance_report(gate, value, False, root)
    assert "维护模式" in str(failure.value)
    assert snapshots  # 夹具快照路径参与构造，避免未使用变量


def test_run_checks_rejects_hidden_blocker_in_v2_report(tmp_path: Path) -> None:
    """反例：v2 报告少报阻断（空清单但计数自洽）必须由索引复算拒绝。"""

    root, _snapshots = build_root(
        tmp_path,
        "chain-hidden",
        marker=UNACCEPTED_MARKER,
        verdict=BLOCKED,
        blocker="只有 1 个独立定位对应点。",
    )
    gate = run_checks.Gate(
        "java-comments-full", "code/java/check_full_java_comments.py", "comments", acceptance=True
    )
    value = {
        "protocol": "quality-check/v2",
        "check": "Java 注释（全量）",
        "checked": 1,
        "findings": [],
        "status": "passed",
        "evidence": {
            "registry": str(root / INDEX_RELATIVE),
            "registry_sha256": hashlib.sha256((root / INDEX_RELATIVE).read_bytes()).hexdigest(),
            "records": 1,
        },
        "acceptance": {
            "schema": "source-acceptance-report/v1",
            "mode": "strict",
            "counts": {
                "scanned_files": 1,
                "accepted": 0,
                "registered_blockers": 0,
                "hard_failures": 0,
                "findings": 0,
                "uncovered_records": 0,
            },
            "accepted": [],
            "registered_blockers": [],
            "hard_failures": [],
            "uncovered_records": [],
        },
    }
    with pytest.raises(run_checks.CheckError) as failure:
        run_checks.verify_acceptance_report(gate, value, False, root)
    assert "漏掉" in str(failure.value)


def test_run_checks_counts_acceptance_mismatch(tmp_path: Path) -> None:
    """反例：v2 计数与逐项清单长度不一致时不得按默认 0 降级。"""

    root, _snapshots = build_root(
        tmp_path,
        "chain-counts",
        marker=UNACCEPTED_MARKER,
        verdict=BLOCKED,
        blocker="只有 1 个独立定位对应点。",
    )
    gate = run_checks.Gate(
        "java-comments-full", "code/java/check_full_java_comments.py", "comments", acceptance=True
    )
    value = {
        "protocol": "quality-check/v2",
        "check": "Java 注释（全量）",
        "checked": 1,
        "findings": [],
        "status": "passed",
        "evidence": {
            "registry": str(root / INDEX_RELATIVE),
            "registry_sha256": hashlib.sha256((root / INDEX_RELATIVE).read_bytes()).hexdigest(),
            "records": 1,
        },
        "acceptance": {
            "schema": "source-acceptance-report/v1",
            "mode": "strict",
            "counts": {
                "scanned_files": 1,
                "accepted": 3,
                "registered_blockers": 0,
                "hard_failures": 0,
                "findings": 0,
                "uncovered_records": 0,
            },
            "accepted": [],
            "registered_blockers": [],
            "hard_failures": [],
            "uncovered_records": [],
        },
    }
    with pytest.raises(run_checks.CheckError) as failure:
        run_checks.verify_acceptance_report(gate, value, False, root)
    assert "计数" in str(failure.value)


def test_incremental_scope_is_reconciled_against_declared_files(tmp_path: Path) -> None:
    """正例：增量入口只声明本次改动范围，复算必须按该范围收窄而不是要求全库覆盖。"""

    root, _snapshots = build_root(
        tmp_path,
        "chain-scope",
        marker=UNACCEPTED_MARKER,
        verdict=BLOCKED,
        blocker="只有 1 个独立定位对应点。",
    )
    path = f"{LOCAL_DIR}/ProbeDemo.java"
    index = root / INDEX_RELATIVE
    document = json.loads(index.read_text(encoding="utf-8"))
    other = f"{LOCAL_DIR}/OtherDemo.java"
    document["records"].append(
        {**document["records"][0], "local_path": other, "local_sha256_after": "0" * 64}
    )
    index.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
    source = root / path
    gate = run_checks.Gate(
        "java-comments", "code/java/check_worktree_java_comments.py", "comments",
        acceptance=True, root_argument=False,
    )
    value = {
        "protocol": "quality-check/v2",
        "check": "Java 注释",
        "checked": 1,
        "findings": [],
        "status": "completed-with-registered-blockers",
        "evidence": {
            "registry": str(index),
            "registry_sha256": hashlib.sha256(index.read_bytes()).hexdigest(),
            "records": 2,
        },
        "acceptance": {
            "schema": "source-acceptance-report/v1",
            "mode": "maintenance",
            "counts": {
                "scanned_files": 1,
                "accepted": 0,
                "registered_blockers": 1,
                "hard_failures": 0,
                "findings": 0,
                "uncovered_records": 0,
            },
            "accepted": [],
            "registered_blockers": [
                {
                    "record_id": path,
                    "path": path,
                    "line": 4,
                    "type_name": "example.ProbeDemo",
                    "form": "来源说明",
                    "classification": "registered-blocker",
                    "verdict": BLOCKED,
                    "blocker_reason": "只有 1 个独立定位对应点。",
                    "open_gap": "上游该版本未声明作者；历史引入版本未核实。",
                    "local_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                }
            ],
            "hard_failures": [],
            "uncovered_records": [],
            "scope": {"files": [path], "count": 1},
        },
    }
    status, checked, blockers, summary = run_checks.verify_acceptance_report(
        gate, value, True, root
    )
    assert status == "completed-with-registered-blockers"
    assert checked == 1 and len(blockers) == 1
    assert summary["ledger"] == {"records": 2, "not_accepted": 1, "covered": 1}
