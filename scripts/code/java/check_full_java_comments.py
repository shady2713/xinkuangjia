#!/usr/bin/env python3
"""对全部纳管 Java 源码执行注释检查，覆盖增量门禁看不到的历史欠账。

暂存区检查只覆盖本次改动涉及的声明，干净检出上的“零对象”不能证明全库注释
合格。本入口把每个纳管 Java 文件的全部声明交给同一套规则，因此检查对象数
固定等于仓库中的 Java 文件数，规则失败会直接阻断。

受控来源证据按“仓库内默认索引 → 环境变量 → 命令行参数”之外的优先级解析：
显式配置优先，未配置时读取被检查仓库内的受控来源索引；清单不可读时以非零
退出报告原因。JSON 与非 JSON 输出都报告本次采用的清单路径、指纹与记录数。

用法：python scripts/code/java/check_full_java_comments.py [--json] [文件或目录...]

@author 李杰
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scripts.code.java.check_staged_java_comments import (
    EvidenceRegistry,
    Finding,
    configured_evidence,
    describe_evidence,
    resolve_evidence,
    scan_full_source,
)
from scripts.common.check_protocol import payload
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
) -> tuple[int, list[Finding]]:
    """读取全部纳管 Java 文件并检查其全部声明。

    Args:
        paths: 可选的仓库相对文件或目录；为空时检查整个仓库。
        root: 仓库根目录；省略时使用本工具所属仓库。
        evidence: 受控来源证据清单；省略时只按环境变量解析，不启用仓库内默认索引。
    Returns:
        实际读取的文件数与该范围内全部注释问题。
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
    for path in selected:
        relative = path.relative_to(repository).as_posix()
        findings.extend(scan_full_source(relative, read_text(path), evidence=registry))
    return len(selected), sorted(set(findings), key=lambda item: (item.path, item.line, item.rule))


def main() -> int:
    """按统一协议输出全量 Java 注释诊断与本次采用的证据输入指纹。

    Returns:
        没有问题时返回 0，存在问题时返回 1，检查无法完成时返回 2。
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
    args = arguments.parse_args()
    repository = (args.root or Path(__file__).resolve().parents[3]).resolve()
    try:
        registry = resolve_evidence(args.evidence_registry, args.evidence_snapshots, repository)
        count, findings = scan_all_java_comments(args.paths, args.root, registry)
    except CheckError as error:
        print(f"Java 全量注释检查失败：{error}", file=sys.stderr)
        return 2
    if not args.json:
        print(describe_evidence(registry))
    if args.json:
        result = payload("Java 注释（全量）", count, findings)
        # 未配置证据时也显式报告 null，消费者不能把“没有指纹”当成“已验证”。
        result["evidence"] = registry.describe() if registry is not None else None
        print(json.dumps(result, ensure_ascii=False))
        return 1 if findings else 0
    if not findings:
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
