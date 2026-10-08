"""钉住暂存入口（增量）的维护模式契约：已登记阻断放行、硬失败仍然失败。

`check_staged_quality.py` 明文声明提交路径属于裁决 D15 所说的「维护检查」，允许以
「执行完成 + 存在已登记阻断」结束。但增量入口额外调用 ``_new_documentation_findings``
做全量重扫再与旧版本求差，该辅助函数早期**既不接受也不接收** ``maintenance``，
固定以严格模式重扫并对 ``evidence_bound`` 诊断无条件保留。已登记阻断因此在维护
模式下重新变成硬失败诊断，使增量入口与全量入口 ``scan_full_source`` 的维护语义
相反：只要改动触碰任何已登记阻断文件，暂存门禁必然退出 1。

本文件在**隔离 Git 仓库**上用真实 CLI 保留真实退出码，覆盖：
① 维护模式 + 只改已登记阻断文件 → 退出 0，且如实显示仍是 registered-blocker、
   没有变成 accepted；
② 严格模式（不加 ``--maintenance``）→ 与修复前逐字相同，仍然退出 1；
③ 维护模式 + 硬失败（缺 JavaDoc / 指纹不符）→ 仍然退出 1；
④ 提交门禁自身同时给出命令行开关与环境变量，两条路径都不能失效。

不读取本机 .bf-local，不修改真实索引、源码或 D10 清单。

@author OpenAI Codex
"""

from __future__ import annotations

import json
from pathlib import Path

from scripts.code.java import check_staged_java_comments as java
from scripts.common.quality_common import DEFAULT_ROOT
from scripts.tests.git_sandbox import GitSandbox, create_sandbox
from scripts.tests.test_java_author_evidence import (
    JAVA_PATH,
    UPSTREAM_SOURCE,
    checker_args,
    demo_source,
    digest,
    evidence_record,
    note_lines,
    run_checker,
    write_snapshot,
)

BLOCKED_VERDICT = "证据不足，保持原状并登记阻断"
BLOCKER_REASON = "只有 1 个独立定位对应点，不足两个相互独立且有区分力的非通用事实。"
INDEX_RELATIVE = "docs/测试与可靠性/来源证据/d12-source-index.json"


def blocker_source(revision: str) -> str:
    """生成一份带完整来源说明、索引判为已登记阻断的 Java 样本。

    Args:
        revision: 写进职责说明的本次修订标记，用来制造一次真实的暂存内容变化。
    Returns:
        仅改动职责说明、来源说明其余部分保持不变的 Java 源码。
    """

    return demo_source(
        notes=[
            *note_lines(),
            # 已登记阻断必须带就地验收标注，否则会被判成硬失败而不是阻断。
            f" * {java.SOURCE_REVIEW_UNACCEPTED_MARKER}",
            f" * 本次修订：{revision}",
        ]
    )


def staged_case(
    tmp_path: Path,
    name: str,
    *,
    after: str,
    record_source: str,
    record_fields: dict[str, object] | None = None,
) -> tuple[GitSandbox, list[str]]:
    """构造“先有基线、再改已登记阻断文件”的隔离暂存场景。

    先 ``record_baseline()`` 再改写索引，使 ``_previous_source`` 能读到旧版本，
    这样 ``_new_documentation_findings`` 的全量重扫分支才是真正被执行的路径。
    受控清单写成 ``d12-source-index/v1`` JSON：只有该 schema 携带验收状态，
    TSV 账本不携带，已登记阻断分类在 TSV 下根本不会被求值。

    Args:
        tmp_path: pytest 分配的临时目录。
        name: 隔离仓库目录名。
        after: 本次暂存的 Java 源码。
        record_source: 受控清单记录所绑定的源码（决定 local_sha256 与 JavaDoc 指纹）。
        record_fields: 覆盖清单记录的额外字段，用于制造指纹不符。
    Returns:
        隔离仓库与检查器证据参数。
    """

    sandbox = create_sandbox(tmp_path / name)
    sandbox.stage(JAVA_PATH, blocker_source("基线"))
    sandbox.record_baseline()
    sandbox.stage(JAVA_PATH, after)
    target = sandbox.root / JAVA_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(after, encoding="utf-8")
    evidence = tmp_path / f"{name}-evidence"
    evidence.mkdir()
    write_snapshot(evidence / "snapshots", UPSTREAM_SOURCE)
    record = evidence_record(record_source)
    record["d12_verdict"] = BLOCKED_VERDICT
    record["d12_blocker_reason"] = BLOCKER_REASON
    if record_fields:
        record.update(record_fields)
    index = sandbox.root / INDEX_RELATIVE
    index.parent.mkdir(parents=True, exist_ok=True)
    index.write_text(
        json.dumps(
            {"index_schema": "d12-source-index/v1", "records": [record]},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return sandbox, checker_args(index, evidence / "snapshots")


def run_maintenance(
    sandbox: GitSandbox, arguments: list[str], *extra: str
) -> "tuple[int, dict[str, object]]":
    """以真实 CLI 运行暂存入口并解析 v2 报告。

    Args:
        sandbox: 隔离 Git 仓库。
        arguments: 检查器证据参数。
        extra: 追加的 CLI 参数（例如 ``--maintenance``）。
    Returns:
        真实退出码与解析后的 JSON 报告。
    """

    result = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        "--json",
        *arguments,
        *extra,
    )
    return result.returncode, json.loads(result.stdout)


def test_maintenance_lets_registered_blockers_finish_without_passing(tmp_path: Path) -> None:
    """正例（契约 a）：只改已登记阻断文件时维护模式退出 0，且条目仍是 registered-blocker。

    这是本轮修复的核心断言：增量入口的维护模式必须与全量入口一致，已登记阻断
    不再产生诊断，但**不得**变成 accepted，也不得被写成 passed。
    """

    after = blocker_source("本次修订")
    sandbox, arguments = staged_case(
        tmp_path, "maintenance-blocker", after=after, record_source=after
    )
    code, report = run_maintenance(sandbox, arguments, "--maintenance")
    acceptance = report["acceptance"]
    assert code == 0, report
    assert report["status"] == "completed-with-registered-blockers"
    assert acceptance["mode"] == "maintenance"
    assert acceptance["counts"]["findings"] == 0
    assert acceptance["counts"]["registered_blockers"] == 1
    assert acceptance["counts"]["hard_failures"] == 0
    # 如实显示：条目仍是已登记阻断，来源依然未验收。
    assert acceptance["registered_blockers"][0]["classification"] == "registered-blocker"
    assert acceptance["accepted"] == []
    assert acceptance["counts"]["accepted"] == 0


def test_maintenance_mode_environment_variable_is_equivalent(tmp_path: Path) -> None:
    """环境变量与命令行开关表达同一个契约，任一路径失效都必须被发现。"""

    after = blocker_source("本次修订")
    sandbox, arguments = staged_case(
        tmp_path, "maintenance-env", after=after, record_source=after
    )
    environment = run_checker(
        sandbox,
        "scripts/code/java/check_staged_java_comments.py",
        "--json",
        *arguments,
        extra_env={java.ACCEPTANCE_MODE_ENV: java.ACCEPTANCE_MODE_MAINTENANCE},
    )
    assert environment.returncode == 0, environment.stdout + environment.stderr
    assert json.loads(environment.stdout)["status"] == "completed-with-registered-blockers"


def test_strict_entry_is_unchanged_for_registered_blocker(tmp_path: Path) -> None:
    """契约 b：不加 ``--maintenance`` 时严格拒绝行为与修复前逐字相同。

    同一份夹具在严格模式下必须仍然退出 1、保留真实 ``type-author`` 诊断，
    并且已登记阻断条目同样如实列出（不得因为严格模式就不报告）。
    """

    after = blocker_source("本次修订")
    sandbox, arguments = staged_case(
        tmp_path, "strict-blocker", after=after, record_source=after
    )
    code, report = run_maintenance(sandbox, arguments)
    acceptance = report["acceptance"]
    assert code == 1, report
    assert report["status"] == "failed"
    assert acceptance["mode"] == "strict"
    assert acceptance["counts"]["findings"] == 1
    assert acceptance["counts"]["registered_blockers"] == 1
    assert acceptance["counts"]["accepted"] == 0
    assert report["findings"][0]["rule"] == "type-author"
    assert report["findings"][0]["evidence_bound"] is True


def test_maintenance_still_fails_when_javadoc_is_removed(tmp_path: Path) -> None:
    """负对照：维护模式只豁免已登记阻断，硬失败（缺 JavaDoc）必须仍然退出 1。"""

    after = "package example;\n\npublic class EvidenceDemo {\n}\n"
    sandbox, arguments = staged_case(
        tmp_path,
        "maintenance-hard-failure",
        after=after,
        record_source=blocker_source("基线"),
    )
    code, report = run_maintenance(sandbox, arguments, "--maintenance")
    assert code == 1, report
    assert report["status"] == "failed"
    rules = {finding["rule"] for finding in report["findings"]}
    assert "type-javadoc" in rules, report["findings"]


def test_maintenance_still_fails_on_fingerprint_mismatch(tmp_path: Path) -> None:
    """负对照：来源指纹与受控清单不符属于硬失败，维护模式不得放行。"""

    after = blocker_source("本次修订")
    sandbox, arguments = staged_case(
        tmp_path,
        "maintenance-fingerprint",
        after=after,
        record_source=after,
        record_fields={"local_sha256_after": digest("与暂存内容不同的源码")},
    )
    code, report = run_maintenance(sandbox, arguments, "--maintenance")
    assert code == 1, report
    assert report["status"] == "failed"
    assert report["acceptance"]["counts"]["findings"] >= 1


def test_staged_gate_declares_maintenance_through_both_channels() -> None:
    """提交门禁必须同时给出 ``--maintenance`` 与等价环境变量，两条路径都不能失效。

    这里直接读真实源码断言调用面：早期维护模式在增量入口从未生效，正是因为
    门禁声明的契约没有一路透传到检查器，所以声明本身必须被钉住。
    """

    source = (
        DEFAULT_ROOT / "scripts/workflow/check_staged_quality.py"
    ).read_text(encoding="utf-8")
    assert '"--maintenance"' in source, "提交门禁没有显式给出维护模式命令行开关"
    assert 'JAVA_COMMENT_ACCEPTANCE_MODE": "maintenance"' in source, (
        "提交门禁没有显式给出等价的环境变量"
    )