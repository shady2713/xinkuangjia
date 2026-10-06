#!/usr/bin/env python3
"""对全部纳管 Java 源码执行注释检查，覆盖增量门禁看不到的历史欠账。

暂存区检查只覆盖本次改动涉及的声明，干净检出上的“零对象”不能证明全库注释
合格。本入口把每个纳管 Java 文件的全部声明交给同一套规则，因此检查对象数
固定等于仓库中的 Java 文件数，规则失败会直接阻断。

受控来源证据按“仓库内默认索引 → 环境变量 → 命令行参数”之外的优先级解析：
显式配置优先，未配置时读取被检查仓库内的受控来源索引；清单不可读时以非零
退出报告原因。JSON 与非 JSON 输出都报告本次采用的清单路径、指纹与记录数。

按裁决 D15 §65/§74，本入口输出 `quality-check/v2` 报告：硬失败诊断、已验收
来源（含独立 A1 分支）与已登记阻断分列；维护完成态使用独立状态
`completed-with-registered-blockers`，绝不再写成 `passed`。显式维护模式必须由
调用方给出，未显式选择时保持严格拒绝。`--acceptance-report` 另写一份可直接被
`ci_gate` 复核的来源验收报告（含提交、规则指纹、账本指纹、范围与逐项清单）。

上游内容**取不回**（网络不可达、HTTP 错误、超时）与**内容不符**是两类完全不同的
事实。本入口在取回边界上记录真实故障，把“取不回”的记录从逐项硬失败里分离成独立
的“证据不可得”集合，报告写明固定地址与原因并以退出码 2 受控失败结束；指纹或内容
不符仍按内容不符硬失败，判据与阈值不放宽。

用法：python scripts/code/java/check_full_java_comments.py [--json] [文件或目录...]

@author 李杰
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scripts.code.java import check_staged_java_comments
from scripts.code.java.check_staged_java_comments import (
    ACCEPTANCE_REPORT_SCHEMA,
    AcceptanceLedger,
    EvidenceRegistry,
    Finding,
    acceptance_payload,
    configured_evidence,
    describe_evidence,
    resolve_evidence,
    scan_full_source,
    uncovered_acceptance_records,
)
from scripts.common.quality_common import CheckError, discover, entry, parser, read_text
from scripts.common.repository_layout import is_java_source

# Windows Git Hook 可能继承非 UTF-8 控制台编码，统一输出编码以保证中文提示可读。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# 规则实现把固定地址取回失败写成逐记录拒绝原因，其前缀由该模块固定；本入口按同一
# 前缀把环境故障与内容不符分开，避免“网络取不回”被说成“这条内容不对”。前缀与
# 规则实现的一致性由 scripts/tests/test_upstream_evidence_unavailable.py 断言。
UPSTREAM_UNAVAILABLE_PREFIX = "无法从固定地址取回上游内容"
UPSTREAM_UNAVAILABLE_PATTERN = re.compile(
    re.escape(UPSTREAM_UNAVAILABLE_PREFIX) + r"\s+(?P<url>\S+?)（(?P<detail>.*?)）"
)
# 逐项状态里“证据不可得”的独立分类：它既不是已验收、也不是已登记阻断或内容硬失败。
ACCEPTANCE_STATE_EVIDENCE_UNAVAILABLE = "evidence-unavailable"
# 诊断与报告里“取不回”的统一表述：消费者按该前缀识别环境故障。
UPSTREAM_UNAVAILABLE_MESSAGE = "上游内容取不回"


def scan_all_java_comments(
    paths: list[str] | None = None,
    root: Path | None = None,
    evidence: EvidenceRegistry | None = None,
    acceptance: AcceptanceLedger | None = None,
    maintenance: bool = False,
) -> tuple[int, list[Finding], list[str]]:
    """读取全部纳管 Java 文件并检查其全部声明。

    Args:
        paths: 可选的仓库相对文件或目录；为空时检查整个仓库。
        root: 仓库根目录；省略时使用本工具所属仓库。
        evidence: 受控来源证据清单；省略时只按环境变量解析，不启用仓库内默认索引。
        acceptance: 逐项验收状态收集器；为 ``None`` 时不登记状态。
        maintenance: 是否处于显式维护模式。
    Returns:
        实际读取的文件数、该范围内全部注释问题与该范围内实际扫描的仓库相对路径。
    Raises:
        CheckError: 根目录无效、路径越界或文件无法严格按 UTF-8 读取。
    """

    repository = (root or Path(__file__).resolve().parents[3]).resolve()
    registry = evidence if evidence is not None else configured_evidence()
    selected = [
        path
        for path in discover(repository, {".java"}, paths or ())
        if is_java_source(path.relative_to(repository).as_posix())
    ]
    findings: list[Finding] = []
    scanned: list[str] = []
    for path in selected:
        relative = path.relative_to(repository).as_posix()
        scanned.append(relative)
        findings.extend(
            scan_full_source(
                relative,
                read_text(path),
                evidence=registry,
                acceptance=acceptance,
                maintenance=maintenance,
            )
        )
    return (
        len(selected),
        sorted(set(findings), key=lambda item: (item.path, item.line, item.rule)),
        sorted(scanned),
    )


def scanner_identity() -> dict[str, object]:
    """返回本次实际使用的规则实现路径与整文件指纹，供报告版本绑定。"""

    implementation = Path(__file__).resolve().parent / "check_staged_java_comments.py"
    return {
        "path": "scripts/code/java/check_staged_java_comments.py",
        "sha256": hashlib.sha256(implementation.read_bytes()).hexdigest(),
    }


def parse_upstream_unavailable(reason: str) -> tuple[str, str] | None:
    """判断一条拒绝原因是否只是“上游内容取不回”，并取出地址与真实故障。

    规则实现对网络不可达、HTTP 错误、超时与超限统一写成
    ``无法从固定地址取回上游内容 <地址>（<故障>）``；这属于证据不可得的环境错误，
    不是该条记录的证据内容不符。本函数只做判别，不改变任何判据。

    Args:
        reason: 单条拒绝原因原文。

    Returns:
        ``(固定地址, 故障说明)``；不是取不回时返回 ``None``。
    """

    match = UPSTREAM_UNAVAILABLE_PATTERN.search(reason)
    if match is None:
        return None
    return match.group("url"), match.group("detail").strip()


def unavailable_message(url: str, detail: str) -> str:
    """返回消费者可直接展示的“取不回”诊断文本。"""

    return f"{UPSTREAM_UNAVAILABLE_MESSAGE}：{url}：{detail}"


@contextmanager
def upstream_fetch_recorder() -> Iterator[list[dict[str, str]]]:
    """在本次扫描期间记录取回失败的上游固定地址，退出时恢复原实现。

    记录发生在真实取回边界上，因此只登记“实际尝试过且确实取不回”的地址，不会把
    未经尝试的对象也算成环境故障；成功取回的地址不登记，内容指纹照旧由规则实现复算。

    Yields:
        追加写入的故障条目列表，每项含固定地址与真实故障文本。
    """

    failures: list[dict[str, str]] = []
    original = check_staged_java_comments._fetch_upstream_bytes

    def recording(url: str) -> bytes:
        """透传真实取回实现；只在失败时登记地址与原因后原样抛出。"""

        try:
            return original(url)
        except (OSError, ValueError) as error:
            detail = getattr(error, "reason", None) or str(error) or type(error).__name__
            entry = {"url": str(url), "reason": f"{type(error).__name__}: {detail}"}
            if entry not in failures:
                failures.append(entry)
            raise

    check_staged_java_comments._fetch_upstream_bytes = recording
    try:
        yield failures
    finally:
        check_staged_java_comments._fetch_upstream_bytes = original


def split_evidence_unavailability(
    ledger: AcceptanceLedger, findings: list[Finding], fetch_failures: list[dict[str, str]]
) -> list[dict[str, object]]:
    """把“取不回”造成的逐项硬失败分离成独立的证据不可得集合。

    只有当一条记录的**全部**拒绝原因都来自取不回时才改判为证据不可得，并同步移除
    只由取不回产生的诊断；同一条记录若还有真实的内容问题（指纹不符、标注缺失、判词
    冲突等），一律保留原硬失败，不因环境故障放过任何内容判据。

    Args:
        ledger: 本次扫描收集的逐项验收状态，命中时按对象就地改写分类。
        findings: 本次扫描的硬失败诊断，返回值中已剔除只由取不回产生的条目。
        fetch_failures: ``upstream_fetch_recorder`` 记录的取回失败地址。

    Returns:
        逐项证据不可得摘要；没有取回失败时为空列表。
    """

    for index, state in enumerate(ledger.states):
        content_reasons = tuple(
            reason for reason in state.reasons if parse_upstream_unavailable(reason) is None
        )
        if len(content_reasons) == len(state.reasons):
            continue
        if content_reasons:
            # 同一条记录还有真实的内容问题：保留硬失败，并把取不回原因逐字留在
            # reasons 里，供消费者区分环境故障与内容不符，不改写任何既有内容判据。
            continue
        ledger.states[index] = replace(
            state, classification=ACCEPTANCE_STATE_EVIDENCE_UNAVAILABLE, reasons=()
        )
    moved = {
        state.path
        for state in ledger.states
        if state.classification == ACCEPTANCE_STATE_EVIDENCE_UNAVAILABLE
    }
    if moved:
        kept: list[Finding] = []
        for finding in findings:
            if finding.path in moved and parse_upstream_unavailable(finding.detail):
                continue
            kept.append(finding)
        findings[:] = kept
    return [
        {
            **state.summary(),
            "unavailable": [
                {"url": item["url"], "reason": item["reason"]}
                for item in fetch_failures
                if state.path in moved
            ],
        }
        for state in ledger.states
        if state.classification == ACCEPTANCE_STATE_EVIDENCE_UNAVAILABLE
    ]


def evidence_error_text(unavailable: list[dict[str, object]]) -> str:
    """把证据不可得集合汇总成一条可核对的“取不回”诊断；为空集合返回空串。"""

    messages: list[str] = []
    for item in unavailable:
        for entry in item.get("unavailable") or []:  # type: ignore[union-attr]
            messages.append(
                unavailable_message(str(entry["url"]), str(entry["reason"]))
            )
    if not messages:
        return ""
    unique = list(dict.fromkeys(messages))
    if len(unique) > 3:
        return "；".join(unique[:3]) + f"；……（共 {len(unique)} 个固定地址取不回）"
    return "；".join(unique)


def write_acceptance_report(path: Path, report: dict[str, object]) -> None:
    """把来源验收报告写成 UTF-8 JSON 文件，失败以非零退出而不是静默丢弃。"""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(report, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )


def build_report(
    registry: EvidenceRegistry | None,
    ledger: AcceptanceLedger,
    count: int,
    findings: list[Finding],
    scanned: list[str],
    maintenance: bool,
    unavailable: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    """组装 v2 报告并附上提交、规则、账本指纹与实际扫描范围（裁决 D15 §66/§69）。

    ``unavailable`` 非空时报告额外写出独立的“证据不可得”集合与 ``evidence_error``，
    并把状态改回 ``failed``、退出码改为 2：证据没取回来既不是已验收，也不是内容不符，
    也不是维护完成态。
    """

    uncovered = uncovered_acceptance_records(registry, set(scanned), ledger)
    report = acceptance_payload(
        "Java 注释（全量）",
        count,
        findings,
        registry,
        ledger,
        maintenance,
        uncovered,
        scanned,
    )
    report["revision"] = git_revision()
    report["scanner"] = scanner_identity()
    report["scope"] = {"files": scanned, "count": len(scanned)}
    report["index_schema"] = (
        "d12-source-index/v1"
        if registry is not None and registry.requires_acceptance_state
        else None
    )
    report["generated_at"] = datetime.now(timezone.utc).isoformat()
    unavailable = list(unavailable or [])
    report["evidence_error"] = evidence_error_text(unavailable)
    acceptance = report["acceptance"]
    assert isinstance(acceptance, dict)
    acceptance["scope"] = {"files": scanned, "count": len(scanned)}
    acceptance["revision"] = report["revision"]
    acceptance["scanner"] = report["scanner"]
    acceptance["index_schema"] = report["index_schema"]
    acceptance["check"] = report["check"]
    acceptance["protocol"] = report["protocol"]
    counts = acceptance["counts"]
    assert isinstance(counts, dict)
    counts["evidence_unavailable"] = len(unavailable)
    acceptance["evidence_unavailable"] = unavailable
    if unavailable:
        report["status"] = "failed"
        report["process_exit_code"] = 2
    return report


def git_revision() -> str | None:
    """读取当前仓库 HEAD 提交；不是 Git 检出时返回 ``None``。"""

    import subprocess

    try:
        output = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=Path(__file__).resolve().parents[3],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
            check=True,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return output.stdout.strip() or None


def main() -> int:
    """按统一协议输出全量 Java 注释诊断与本次采用的证据输入指纹。

    Returns:
        没有硬失败时返回 0（维护完成态同样返回 0 但不是通过），存在硬失败或范围
        漏项时返回 1，证据不可得或检查无法完成时返回 2。
    """

    arguments = parser(__doc__)
    arguments.add_argument(
        "--evidence-registry",
        type=Path,
        default=None,
        help="受控来源证据清单路径（TSV 或 JSON）；默认读取环境变量或仓库内受控索引",
    )
    arguments.add_argument(
        "--evidence-snapshots",
        type=Path,
        default=None,
        help="受控上游快照根目录；未配置时按清单的固定地址取回",
    )
    arguments.add_argument(
        "--maintenance",
        action="store_true",
        help=(
            "显式维护模式：完整消费未验收状态后，已登记阻断进入独立清单，状态为"
            " completed-with-registered-blockers；不加此开关保持严格拒绝"
        ),
    )
    arguments.add_argument(
        "--acceptance-report",
        type=Path,
        default=None,
        help="另写一份来源验收报告（source-acceptance-report/v1），供 ci_gate 独立复核",
    )
    args = arguments.parse_args()
    repository = (args.root or Path(__file__).resolve().parents[3]).resolve()
    unavailable: list[dict[str, object]] = []
    try:
        registry = resolve_evidence(args.evidence_registry, args.evidence_snapshots, repository)
        ledger = AcceptanceLedger()
        with upstream_fetch_recorder() as fetch_failures:
            count, findings, scanned = scan_all_java_comments(
                args.paths,
                args.root,
                registry,
                acceptance=ledger,
                maintenance=args.maintenance,
            )
            unavailable = split_evidence_unavailability(ledger, findings, fetch_failures)
    except CheckError as error:
        print(f"Java 全量注释检查失败：{error}", file=sys.stderr)
        return 2
    report = build_report(
        registry, ledger, count, findings, scanned, args.maintenance, unavailable
    )
    evidence_error = str(report["evidence_error"])
    if evidence_error:
        print(f"证据不可得：{evidence_error}", file=sys.stderr)
        for item in unavailable:
            print(
                f"- {item['path']} [{item['record_id']}] 判词 {item['verdict'] or '空'}："
                f"本次未能复核上游内容，既不计为已验收，也不按内容不符拒绝",
                file=sys.stderr,
            )
    if args.acceptance_report is not None:
        try:
            write_acceptance_report(args.acceptance_report.resolve(), report)
        except OSError as error:
            print(f"来源验收报告写入失败：{error}", file=sys.stderr)
            return 2
    if not args.json:
        print(describe_evidence(registry))
    if args.json:
        print(json.dumps(report, ensure_ascii=False))
        return int(report["process_exit_code"])
    if evidence_error:
        # 证据不可得时不能输出“通过”或“维护完成”：内容复核没有真正完成。
        return 2
    if not findings:
        blockers = ledger.registered_blockers()
        if args.maintenance and blockers:
            print(
                "Java 全量注释检查完成（维护模式）：执行完成，存在已登记阻断 "
                f"{len(blockers)} 项，来源尚未验收；不计为通过。"
            )
            return 0
        print(f"Java 全量注释检查通过：{count} 个纳管文件")
        return 0
    print(f"Java 全量注释检查范围：{count} 个纳管文件", file=sys.stderr)
    for finding in findings:
        print(
            f"- {finding.path}:{finding.line} [{finding.rule}] {finding.detail}",
            file=sys.stderr,
        )
    return 1


if __name__ == "__main__":
    raise SystemExit(entry(main))
