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

用法：python scripts/code/java/check_full_java_comments.py [--json] [文件或目录...]

@author 李杰
"""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

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
) -> dict[str, object]:
    """组装 v2 报告并附上提交、规则、账本指纹与实际扫描范围（裁决 D15 §66/§69）。"""

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
    acceptance = report["acceptance"]
    assert isinstance(acceptance, dict)
    acceptance["scope"] = {"files": scanned, "count": len(scanned)}
    acceptance["revision"] = report["revision"]
    acceptance["scanner"] = report["scanner"]
    acceptance["index_schema"] = report["index_schema"]
    acceptance["check"] = report["check"]
    acceptance["protocol"] = report["protocol"]
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
        漏项时返回 1，检查无法完成时返回 2。
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
    try:
        registry = resolve_evidence(args.evidence_registry, args.evidence_snapshots, repository)
        ledger = AcceptanceLedger()
        count, findings, scanned = scan_all_java_comments(
            args.paths,
            args.root,
            registry,
            acceptance=ledger,
            maintenance=args.maintenance,
        )
    except CheckError as error:
        print(f"Java 全量注释检查失败：{error}", file=sys.stderr)
        return 2
    report = build_report(registry, ledger, count, findings, scanned, args.maintenance)
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
