"""统一调度仓库质量检查，保留依赖顺序、并发上限和真实失败状态。

消费 Java 注释检查的 ``quality-check/v2`` 计数协议：硬失败诊断、已验收对象与已登记
阻断分列统计，维护完成态使用 ``completed-with-registered-blockers`` 而不是 ``passed``，
既不计入通过检查数，也不增加已验收对象数。所有 v2 声明都要用仓库内受控索引与真实
文件独立复算一遍，子工具自造状态、少报阻断或未显式选择维护模式都会被拒绝。

用法：python scripts/workflow/run_checks.py --group docs
默认运行全部已登记质量检查，不自动执行构建、提交或业务测试。
@author 李杰
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

# 直接按文件路径运行时定位工具所属仓库，不依赖调用者的当前目录。
if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.common.quality_common import DEFAULT_ROOT, CheckError, CheckTimeout, discover, entry, git, read_text, run_process
from scripts.common.check_protocol import PROTOCOL
from scripts.workflow import check_evidence

SCRIPT_DIRECTORY = Path(__file__).resolve().parents[1]

# v2 计数协议的消费者侧常量。规则实现（scripts/code/java/check_staged_java_comments.py）
# 是唯一事实来源，这里只按需读取，不在导入期建立跨脚本依赖。
CHECK_STATUS_MAINTENANCE = "completed-with-registered-blockers"
ACCEPTANCE_MODE_ENV = "JAVA_COMMENT_ACCEPTANCE_MODE"
ACCEPTANCE_MODE_MAINTENANCE = "maintenance"

# Java 注释规则实现对“固定地址取回失败”写出的固定前缀（网络不可达、HTTP 错误、
# 超时）。这是**环境故障**：证据没取回来既不是内容不符，也不是已验收，与逐项清单
# 对撞得到的“已验收记录不能出现在阻断/硬失败清单”会误导整改方向。本消费者按同一
# 前缀识别它，并把结论表达为受控的环境失败；内容不符、判词冲突等真实不一致仍照旧拒绝。
# 前缀与规则实现的一致性由 scripts/tests/test_upstream_evidence_unavailable.py 断言。
UPSTREAM_UNAVAILABLE_PREFIX = "无法从固定地址取回上游内容"
UPSTREAM_UNAVAILABLE_PATTERN = re.compile(
    re.escape(UPSTREAM_UNAVAILABLE_PREFIX) + r"\s+(?P<url>\S+?)（(?P<detail>.*?)）"
)


def upstream_unavailable(text: object) -> tuple[str, str] | None:
    """判断一段诊断文本是否只说明“上游内容取不回”，并取出地址与真实故障。

    Args:
        text: 子检查写出的单条拒绝原因或整段诊断文本。

    Returns:
        ``(固定地址, 故障说明)``；不是取不回时返回 ``None``。
    """

    if not isinstance(text, str):
        return None
    match = UPSTREAM_UNAVAILABLE_PATTERN.search(text)
    if match is None:
        return None
    return match.group("url"), match.group("detail").strip()


def unavailable_reason(path: str, unavailable: tuple[str, str]) -> str:
    """返回可直接定位的“证据不可得”诊断，说明该条本次没有被按内容复核。"""

    url, detail = unavailable
    return (
        f"证据不可得：上游内容取不回：{url}：{detail}；{path} 本次未能复核上游内容，"
        "不能据此判为内容不符，也不能按已验收对撞"
    )


def declared_evidence_error(source: bytes) -> str:
    """读取子检查自报的“证据不可得”文本；没有或不是 v2 报告时返回空串。

    该字段是检查器对“证据没取回来”的显式声明，与内容失败、协议错误分开；调度器
    据此给出可定位的环境失败原因，而不是笼统的“未完成”。
    """

    try:
        value = json.loads(source.decode("utf-8"))
    except (ValueError, UnicodeError):
        return ""
    if not isinstance(value, dict):
        return ""
    declared = value.get("evidence_error")
    return declared.strip() if isinstance(declared, str) else ""


def _acceptance_module():
    """按需取回 Java 注释检查器的版本化协议常量与索引加载实现。"""

    from scripts.code.java import check_staged_java_comments

    return check_staged_java_comments


@dataclass(frozen=True)
class Gate:
    """定义固定的检查入口及其前置检查，不接受任意 Shell 命令。"""

    name: str
    script: str
    group: str
    dependencies: tuple[str, ...] = ()
    root_argument: bool = True
    zero_reason: str | None = None
    scope: str = "worktree-full"
    acceptance: bool = False
    # 子检查是否接受维护模式与来源报告命令行开关；工作区入口只转发私有索引，
    # 因此它通过 JAVA_COMMENT_ACCEPTANCE_MODE 环境变量表达同一选择。
    acceptance_flag: bool = False
    # 该子检查是否负责写出来源验收报告制品；只有它才检查报告是否真的产出。
    acceptance_report: bool = False


@dataclass(frozen=True)
class Outcome:
    """记录单项检查的状态、退出码、耗时与输出，跳过不能算成功。

    ``blockers`` 是该检查独立上报的已登记阻断清单（只来自 v2 协议）；它不进入
    ``passed`` 计数，只在汇总中单独统计与展示。
    """

    name: str
    status: str
    code: int
    seconds: float
    output: str
    checked: int | None = None
    command: tuple[str, ...] = ()
    cwd: str = ""
    reason: str = ""
    scope: str = "worktree-full"
    diagnostics: tuple[dict[str, object], ...] = ()
    attempted: bool = True
    process_code: int | None = None
    blockers: tuple[dict[str, object], ...] = ()
    acceptance: dict[str, object] | None = None
    acceptance_mode: str = ""
    # 子检查自报的“证据不可得”文本；非空表示环境故障，不是内容或数据不一致。
    evidence_error: str = ""



# 允许作为后续检查前置的真实状态：维护完成态同样表示检查真的执行过。
ACCEPTABLE_DEPENDENCY_STATES = frozenset(
    {"passed", "not-applicable", CHECK_STATUS_MAINTENANCE}
)

GATES = (
    Gate("md-links", "docs/verify_md_links.py", "docs"),
    Gate("skills", "skills/verify_skill_metadata.py", "docs"),
    Gate("doc-refs", "docs/verify_doc_refs.py", "docs"),
    Gate("package-readmes", "docs/verify_package_readmes.py", "docs"),
    Gate("doc-structure", "docs/verify_doc_structure.py", "docs"),
    Gate("doc-policy", "docs/verify_doc_policy.py", "docs"),
    Gate("note-classification", "docs/verify_agent_note_classification.py", "docs", zero_reason="没有活动 Agent Notes；框架分发不要求维护历史笔记"),
    Gate("note-format", "docs/verify_agent_note_format.py", "docs", ("note-classification",), zero_reason="没有活动 Agent Notes，未执行笔记正文验证"),
    Gate("mermaid", "docs/verify_mermaid.py", "docs", zero_reason="没有 Mermaid 围栏，未执行图表解析"),
    Gate("web-comments", "code/web/check_worktree_web_comments.py", "comments", zero_reason="没有适用的 Web 增量文件，未验证 Web 声明", scope="worktree-incremental"),
    Gate(
        "java-comments",
        "code/java/check_worktree_java_comments.py",
        "comments",
        root_argument=False,
        zero_reason="没有适用的 Java 增量文件，未验证 Java 声明",
        scope="worktree-private-index-incremental",
        acceptance=True,
    ),
    # 增量入口只覆盖本次改动；全量入口把 900+ 个纳管文件的全部声明都作为对象，
    # 使“干净工作区零对象”无法再被当成全库注释合格。
    Gate(
        "java-comments-full",
        "code/java/check_full_java_comments.py",
        "comments",
        acceptance=True,
        acceptance_flag=True,
        acceptance_report=True,
    ),
    Gate("backend-boundaries", "code/java/verify_backend_boundaries.py", "boundaries"),
    Gate("workspace-layering", "code/web/verify_workspace_layering.py", "boundaries"),
    Gate("api-contracts", "code/java/verify_api_contracts.py", "boundaries"),
    Gate(
        "python-comments",
        "code/python/check_worktree_python_comments.py",
        "comments",
        root_argument=False,
        zero_reason="没有适用的 Python 增量文件，未验证 Python 声明",
        scope="worktree-private-index-incremental",
    ),
)


def select_gates(names: list[str], group: str) -> list[Gate]:
    """选择检查及其递归前置条件；未知名称或依赖环视为配置错误。"""
    registry = {gate.name: gate for gate in GATES}
    selected: set[str] = set()
    visiting: set[str] = set()

    def include(name: str) -> None:
        """递归补齐依赖并拒绝循环或未知检查名。"""
        if name not in registry:
            raise CheckError(f"未知检查：{name}")
        if name in visiting:
            raise CheckError(f"检查依赖成环：{name}")
        if name in selected:
            return
        visiting.add(name)
        for dependency in registry[name].dependencies:
            include(dependency)
        visiting.remove(name)
        selected.add(name)

    for name in names or [gate.name for gate in GATES if group == "all" or gate.group == group]:
        include(name)
    return [gate for gate in GATES if gate.name in selected]


def command_for(
    gate: Gate,
    root: Path,
    *,
    maintenance: bool = False,
    acceptance_report: Path | None = None,
) -> list[str]:
    """生成固定检查的真实参数数组，所有子检查必须返回结构化计数协议。

    Args:
        gate: 已登记的固定检查配置。
        root: 待检查仓库目录。
        maintenance: 是否显式选择维护模式。只有声明支持验收状态的子检查才接受该开关；
            未显式选择时保持严格拒绝。
        acceptance_report: 由支持验收状态的子检查写出的来源验收报告路径。

    Returns:
        子进程参数数组；不改变任何判定标准。
    """

    command = [sys.executable, "-B", "-X", "utf8", str(SCRIPT_DIRECTORY / gate.script)]
    if gate.root_argument:
        command.extend(["--root", str(root)])
    if gate.acceptance and gate.acceptance_flag and maintenance:
        command.append("--maintenance")
    if gate.acceptance_report and acceptance_report is not None:
        command.extend(["--acceptance-report", str(acceptance_report)])
    return [*command, "--json"]



def evidence_environment(root: Path) -> dict[str, str]:
    """解析本次 Java 注释检查采用的受控来源证据位置，显式配置优先。

    只导出真正解析到的位置；仓库内默认索引缺失时不导出任何变量，子检查按
    “未提供证据”拒绝来源说明，不会因此放行。
    """
    from scripts.code.java.check_staged_java_comments import (
        EVIDENCE_REGISTRY_ENV,
        EVIDENCE_SNAPSHOTS_ENV,
        resolve_evidence_paths,
    )

    registry, snapshots, _ = resolve_evidence_paths(root=root)
    if registry is None:
        return {}
    environment = {EVIDENCE_REGISTRY_ENV: str(registry)}
    if snapshots is not None:
        environment[EVIDENCE_SNAPSHOTS_ENV] = str(snapshots)
    return environment


def evidence_report(root: Path) -> dict[str, object]:
    """报告本次检查采用的受控来源证据输入，不含任何证据正文。

    清单不可读时保留真实原因而不抛出：真正消费证据的 Java 子检查会以环境
    错误退出，未选择该类检查时报告仍如实标记本次输入不可用。
    """
    from scripts.code.java.check_staged_java_comments import EvidenceError, resolve_evidence

    try:
        registry = resolve_evidence(None, None, root)
    except EvidenceError as error:
        return {"status": "unusable", "reason": str(error)}
    if registry is None:
        return {
            "status": "absent",
            "reason": "未配置受控清单与快照，来源说明一律按无逐项依据拒绝",
        }
    return {"status": "configured", **registry.describe()}


def zero_scope_confirmed(gate: Gate, root: Path) -> bool:
    """独立枚举可适用对象来确认 N/A，不能只依靠子检查的零计数及登记理由。

    Args:
        gate: 固定注册的可无适用对象检查。
        root: 当前工作树根目录。
    Returns:
        对象清单确实为空时为 True；存在候选对象或政策未知时为 False。
    Raises:
        CheckError: 对象发现或 Git 差异依据无法读取。
    """
    if gate.name in {"note-classification", "note-format"}:
        from scripts.docs.agent_note_support import collect_notes
        notes, findings = collect_notes(root, [])
        return not notes and not findings
    if gate.name == "mermaid":
        from scripts.docs.markdown_support import parse
        return not any(fence.language.lower() == "mermaid" for path in discover(root, {".md"}) for fence in parse(read_text(path)).fences)
    suffixes = {
        "java-comments": {".java"}, "python-comments": {".py"},
        "web-comments": {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue"},
    }.get(gate.name)
    if suffixes is None:
        return False
    files = {path.relative_to(root).as_posix() for path in discover(root, suffixes)}
    if gate.name == "java-comments":
        from scripts.common.repository_layout import is_java_source
        files = {name for name in files if is_java_source(name)}
    elif gate.name == "python-comments":
        from scripts.code.python.check_staged_python_comments import _is_checkable_python_path
        files = {name for name in files if _is_checkable_python_path(name)}
    else:
        files = {name for name in files if not name.endswith(".d.ts")}
    if not git(root, "rev-parse", "--revs-only", "HEAD").strip():
        return not files
    changes = git(root, "diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", "HEAD", "--")
    untracked = git(root, "ls-files", "--others", "--exclude-standard", "-z")
    selected = set((changes + untracked).decode("utf-8").split("\0"))
    return not files.intersection(selected)


def acceptance_status(checked: int, findings: list[object], blockers: list[object]) -> str:
    """按 v2 协议由计数推出唯一状态，禁止消费者自造状态（裁决 D15 §74）。"""

    if findings:
        return "failed"
    if not checked:
        return "not-applicable"
    if blockers:
        return CHECK_STATUS_MAINTENANCE
    return "passed"


def _blocker_brief(item: object) -> dict[str, object]:
    """取出一条已登记阻断的最小可复核摘要，不含源码正文。"""

    if not isinstance(item, dict):
        return {"record_id": "", "verdict": "", "form": "", "classification": ""}
    return {
        key: item.get(key)
        for key in (
            "record_id",
            "path",
            "line",
            "type_name",
            "form",
            "classification",
            "verdict",
            "blocker_reason",
            "open_gap",
        )
    }


def _verify_acceptance_ledger(
    root: Path,
    registry_info: object,
    blockers: list[object],
    hard: list[object],
    accepted: list[object],
    scope_files: set[str] | None,
) -> dict[str, object]:
    """用受控索引与真实文件复算逐项验收状态（裁决 D15 §68/§72）。

    子工具声明不能作为唯一依据：本函数重新读取报告声明的索引，复算**该报告声明范围内**
    的非验收记录集合，逐条核对阻断/硬失败条目的判词、阻断原因、缺口与最终对象指纹，
    并确认已验收条目确实对应索引里已验收的记录。增量入口的范围是本次改动文件，
    因此复算必须按报告范围收窄，不能拿全库账本要求增量报告逐一覆盖。

    Raises:
        CheckError: 索引不可读、指纹不符、判词不符、登记字段缺失或对象缺失。
    """

    module = _acceptance_module()
    registry = _load_report_registry(root, registry_info)
    accepted_verdicts = (
        *module.SOURCE_NOTE_ACCEPTED_VERDICTS,
        *module.AUTHOR_TAG_ACCEPTED_VERDICTS,
    )
    seen: set[str] = set()
    for item in [*blockers, *hard]:
        if not isinstance(item, dict):
            raise CheckError("逐项验收状态必须是结构化对象")
        path = str(item.get("path", ""))
        record = registry.records.get(path)
        if record is None:
            raise CheckError(f"逐项验收状态指向索引中不存在的对象：{path}")
        verdict = str(record.get(module.SOURCE_NOTE_VERDICT_FIELD) or "").strip()
        if verdict in accepted_verdicts:
            # 先分清“证据没取回来”与“内容确实不对”：上游取不回属于环境故障，
            # 按内容不符报“已验收却进清单”会把整改指向错误方向，且会掩盖真实故障。
            unavailable = next(
                (
                    found
                    for reason in item.get("reasons") or ()
                    if (found := upstream_unavailable(reason)) is not None
                ),
                None,
            )
            if unavailable is not None:
                raise CheckError(unavailable_reason(path, unavailable))
            content = next(
                (
                    str(reason).strip()
                    for reason in item.get("reasons") or ()
                    if str(reason).strip() and upstream_unavailable(reason) is None
                ),
                "",
            )
            raise CheckError(
                f"已验收记录不能出现在阻断/硬失败清单：{path}"
                + (f"（逐项原因：{content[:160]}）" if content else "")
            )
        if str(item.get("verdict") or "") != verdict:
            raise CheckError(f"逐项判词与当前索引不一致：{path}")
        if not str(item.get("blocker_reason") or "").strip():
            raise CheckError(f"逐项验收状态缺少阻断原因：{path}")
        if not str(item.get("open_gap") or "").strip():
            raise CheckError(f"逐项验收状态缺少缺口登记：{path}")
        source = root / path
        if not source.is_file():
            raise CheckError(f"逐项验收状态指向的对象不存在：{path}")
        recorded = str(item.get("local_sha256") or "").lower()
        if hashlib.sha256(source.read_bytes()).hexdigest() != recorded:
            raise CheckError(f"逐项验收状态的最终对象指纹与当前文件不符：{path}")
        if scope_files is not None and path not in scope_files:
            raise CheckError(f"逐项验收状态超出本次声明的扫描范围：{path}")
        seen.add(path)
    for item in accepted:
        if not isinstance(item, dict):
            raise CheckError("已验收条目必须是结构化对象")
        path = str(item.get("path", ""))
        record = registry.records.get(path)
        if record is None:
            raise CheckError(f"已验收条目指向索引中不存在的对象：{path}")
        if str(record.get(module.SOURCE_NOTE_VERDICT_FIELD) or "").strip() not in accepted_verdicts:
            raise CheckError(f"索引未验收的记录不能出现在已验收清单：{path}")
    expected = {
        path
        for path, record in registry.records.items()
        if str(record.get(module.SOURCE_NOTE_VERDICT_FIELD) or "").strip()
        not in accepted_verdicts
        and (scope_files is None or path in scope_files)
    }
    missing = sorted(expected - seen)
    if missing:
        raise CheckError(f"来源验收报告漏掉了索引中的未验收对象：{missing[0]}")
    return {
        "records": len(registry.records),
        "not_accepted": len(expected),
        "covered": len(seen),
    }


def _load_report_registry(root: Path, registry_info: object):
    """按报告声明的账本路径与指纹加载受控索引，供逐项复算使用。

    Args:
        root: 被检查仓库根目录。
        registry_info: 报告 ``evidence`` 段声明的账本信息。

    Returns:
        已加载的受控索引对象。

    Raises:
        CheckError: 声明缺失、路径不可读或指纹与当前账本不一致。
    """

    module = _acceptance_module()
    if not isinstance(registry_info, dict):
        raise CheckError("来源验收报告缺少账本指纹")
    path_text = str(registry_info.get("registry", "")).strip()
    digest_text = str(registry_info.get("registry_sha256", "")).strip().lower()
    if not path_text or not re.fullmatch(r"[0-9a-f]{64}", digest_text):
        raise CheckError("来源验收报告缺少可核对的账本路径或 SHA-256")
    index = Path(path_text)
    if not index.is_file():
        raise CheckError(f"来源验收报告声明的索引不存在：{index}")
    if hashlib.sha256(index.read_bytes()).hexdigest() != digest_text:
        raise CheckError("来源验收报告声明的索引指纹与当前账本不一致")
    registry = module.load_evidence_registry(index, None)
    if registry is None or not registry.requires_acceptance_state:
        raise CheckError("来源验收报告声明的索引未启用验收状态")
    return registry


def _verify_unavailable_records(
    root: Path,
    registry_info: object,
    unavailable: list[object],
    blockers: list[object],
    hard: list[object],
    accepted: list[object],
    scope: object,
) -> None:
    """复核声明为“证据不可得”的记录本身真实存在且绑定成立。

    子检查把取不回上游内容的记录移出逐项清单是受控失败的一部分，不是绕过复核的手段：
    每条都必须能在受控索引里找到、判词与索引一致、本地最终指纹与当前文件一致、在
    本次扫描范围内，并且不得同时出现在已验收、已登记阻断或硬失败清单里。

    Raises:
        CheckError: 任一条件不成立。
    """

    module = _acceptance_module()
    registry = _load_report_registry(root, registry_info)
    scope_files: set[str] | None = None
    if isinstance(scope, dict) and isinstance(scope.get("files"), list):
        scope_files = {str(item) for item in scope["files"]}
    declared = {
        str(item.get("path", ""))
        for item in (*blockers, *hard, *accepted)
        if isinstance(item, dict)
    }
    seen: set[str] = set()
    for item in unavailable:
        if not isinstance(item, dict):
            raise CheckError("证据不可得条目必须是结构化对象")
        path = str(item.get("path", ""))
        if path in declared or path in seen:
            raise CheckError(f"同一记录不能同时出现在证据不可得与逐项清单：{path}")
        record = registry.records.get(path)
        if record is None:
            raise CheckError(f"证据不可得条目指向索引中不存在的对象：{path}")
        verdict = str(record.get(module.SOURCE_NOTE_VERDICT_FIELD) or "").strip()
        if str(item.get("verdict") or "").strip() != verdict:
            raise CheckError(f"证据不可得条目的判词与当前索引不一致：{path}")
        source = root / path
        if not source.is_file():
            raise CheckError(f"证据不可得条目指向的对象不存在：{path}")
        recorded = str(item.get("local_sha256") or "").lower()
        if hashlib.sha256(source.read_bytes()).hexdigest() != recorded:
            raise CheckError(f"证据不可得条目的最终对象指纹与当前文件不符：{path}")
        if scope_files is not None and path not in scope_files:
            raise CheckError(f"证据不可得条目超出本次声明的扫描范围：{path}")
        entries = item.get("unavailable")
        if not isinstance(entries, list) or not entries:
            raise CheckError(f"证据不可得条目缺少取回失败的固定地址与原因：{path}")
        for entry in entries:
            if not isinstance(entry, dict) or not str(entry.get("url", "")).strip():
                raise CheckError(f"证据不可得条目缺少取回失败的固定地址：{path}")
            if not str(entry.get("reason", "")).strip():
                raise CheckError(f"证据不可得条目缺少取回失败的真实原因：{path}")
        seen.add(path)


def verify_acceptance_report(
    gate: Gate,
    value: dict[str, object],
    maintenance: bool,
    root: Path | None = None,
) -> tuple[str, int, tuple[dict[str, object], ...], dict[str, object]]:
    """独立复核 v2 报告，不能只信子工具声明（裁决 D15 §68）。

    复核内容：协议与 schema 版本、模式与调用方选择一致、计数与逐项清单长度一致、
    未覆盖漏项为空，并用仓库内受控索引复算非验收记录集合，逐条核对阻断条目的判词、
    阻断原因、缺口与最终对象指纹。任何不一致都按环境/协议错误拒绝，不降级为已登记阻断。

    Args:
        gate: 已登记的固定检查配置。
        value: 子检查返回的 v2 报告。
        maintenance: 调用方是否显式选择了维护模式。
        root: 被检查仓库根目录，用于按仓库相对路径复核最终对象指纹。

    Returns:
        ``(状态, 实际对象数, 阻断清单, 验收摘要)``。

    Raises:
        CheckError: 协议、模式、计数、逐项清单或索引复算任一不一致。
    """

    module = _acceptance_module()
    acceptance = value.get("acceptance")
    if value.get("protocol") != module.ACCEPTANCE_PROTOCOL or not isinstance(acceptance, dict):
        raise CheckError("v2 报告缺少来源验收段或协议版本不匹配")
    if acceptance.get("schema") != module.ACCEPTANCE_REPORT_SCHEMA:
        raise CheckError("v2 报告的来源验收 schema 不正确")
    mode = acceptance.get("mode")
    if mode not in {"strict", "maintenance"}:
        raise CheckError("v2 报告缺少合法验收模式")
    if mode == "maintenance" and not maintenance:
        raise CheckError("子检查声称维护完成态，但调用方未显式选择维护模式")
    checked, findings = value.get("checked"), value.get("findings")
    if type(checked) is not int or checked < 0 or not isinstance(findings, list):
        raise CheckError("v2 报告缺少合法对象计数或诊断集合")
    blockers = acceptance.get("registered_blockers")
    hard = acceptance.get("hard_failures")
    accepted = acceptance.get("accepted")
    uncovered = acceptance.get("uncovered_records")
    for name, items in (
        ("registered_blockers", blockers),
        ("hard_failures", hard),
        ("accepted", accepted),
        ("uncovered_records", uncovered),
    ):
        if not isinstance(items, list):
            raise CheckError(f"v2 报告的 {name} 必须是数组")
    counts = acceptance.get("counts")
    if not isinstance(counts, dict):
        raise CheckError("v2 报告缺少逐项计数")
    expected_counts = {
        "scanned_files": checked,
        "accepted": len(accepted),
        "registered_blockers": len(blockers),
        "hard_failures": len(hard),
        "findings": len(findings),
        "uncovered_records": len(uncovered),
    }
    declared_unavailable = counts.get("evidence_unavailable")
    if declared_unavailable is not None:
        expected_counts["evidence_unavailable"] = declared_unavailable
    if counts != expected_counts:
        raise CheckError("v2 报告的逐项计数与清单长度不一致")
    if uncovered:
        raise CheckError("v2 报告存在未覆盖的索引记录，范围漏项不能按空集合降级")
    # 证据不可得（上游内容取不回）是环境失败：逐项清单按声明就是不完备的，因此
    # 不能拿它去做“已验收却进清单”的对撞，也不能据此签发通过；改为按受控失败
    # 结束，并先核对被移出逐项清单的记录确实真实存在且绑定成立。
    unavailable = acceptance.get("evidence_unavailable", [])
    if not isinstance(unavailable, list):
        raise CheckError("v2 报告的 evidence_unavailable 必须是数组")
    if declared_unavailable is not None and declared_unavailable != len(unavailable):
        raise CheckError("v2 报告的证据不可得计数与清单长度不一致")
    evidence_error = value.get("evidence_error")
    if evidence_error not in (None, ""):
        if not isinstance(evidence_error, str) or not unavailable:
            raise CheckError("v2 报告声明了证据不可得却没有逐项清单")
        _verify_unavailable_records(
            root if root is not None else Path.cwd(),
            value.get("evidence"),
            unavailable,
            blockers,
            hard,
            accepted,
            acceptance.get("scope"),
        )
        raise CheckError(
            f"证据不可得：{evidence_error}；本次不能按内容不符或已验收对撞复核这些记录"
        )
    status = acceptance_status(checked, findings, blockers)
    if value.get("status") != status:
        raise CheckError("v2 报告的声明状态与计数不一致")
    if not maintenance and status == CHECK_STATUS_MAINTENANCE:
        raise CheckError("未显式选择维护模式时不得以维护完成态结束")
    # 已登记阻断/硬失败必须能由受控索引复算；索引缺失时按协议错误拒绝而不是默认通过。
    scope = acceptance.get("scope")
    scope_files: set[str] | None = None
    if isinstance(scope, dict) and isinstance(scope.get("files"), list):
        scope_files = {str(item) for item in scope["files"]}
        if scope.get("count") != len(scope_files):
            raise CheckError("v2 报告的扫描范围计数与清单长度不一致")
        if counts.get("scanned_files") != len(scope_files):
            raise CheckError("v2 报告的扫描范围与对象计数不一致")
    registry_info = value.get("evidence")
    if not isinstance(registry_info, dict):
        # 没有受控索引时只能允许“本次范围确实没有适用对象”的报告；
        # 一旦存在逐项状态或索引被声明，就必须能按账本复算。
        if blockers or hard or accepted or any(
            int(counts.get(key) or 0)
            for key in ("accepted", "registered_blockers", "hard_failures")
        ):
            raise CheckError("v2 报告缺少本次采用的账本指纹，逐项状态无法复算")
        ledger = {"records": 0, "not_accepted": 0, "covered": 0}
    else:
        ledger = _verify_acceptance_ledger(
            root if root is not None else Path.cwd(),
            registry_info,
            blockers,
            hard,
            accepted,
            scope_files,
        )
    summary = {
        "mode": mode,
        "counts": dict(counts),
        "blockers": [_blocker_brief(item) for item in blockers],
        "ledger": ledger,
    }
    return status, checked, tuple(dict(item) for item in blockers), summary


def parse_result(
    gate: Gate,
    code: int,
    source: bytes,
    *,
    maintenance: bool = False,
    root: Path | None = None,
) -> tuple[str, int | None, str, tuple[dict[str, object], ...], dict[str, object] | None]:
    """核对计数、诊断与退出码的一致性；零对象必须由登记理由明确解释。

    Args:
        gate: 已登记的检查及其零对象政策。
        code: 实际子进程退出码。
        source: 子进程标准输出，错误输出不能充当结构化结果。
        maintenance: 调用方是否显式选择了维护模式。
        root: 被检查仓库根目录，用于按仓库相对路径复核最终对象指纹。
    Returns:
        状态、实际计数、原因、不含原文的诊断位置，以及 v2 验收摘要（v1 为 ``None``）。
    Raises:
        CheckError: 协议缺失、格式无效或子进程状态自相矛盾。
    """

    try:
        value = json.loads(source.decode("utf-8"))
    except (ValueError, UnicodeError) as error:
        raise CheckError("检查未返回有效的结构化计数协议") from error
    if not isinstance(value, dict):
        raise CheckError("检查结果必须是结构化对象")
    acceptance_summary: dict[str, object] | None = None
    module = _acceptance_module()
    protocol = value.get("protocol")
    if protocol == module.ACCEPTANCE_PROTOCOL:
        if not gate.acceptance:
            raise CheckError("未登记接受验收状态的检查不得返回 v2 报告")
        status, checked, _blockers, acceptance_summary = verify_acceptance_report(
            gate, value, maintenance, root
        )
        findings = value["findings"]
        if code != (1 if findings else 0):
            raise CheckError("检查退出码与声明状态不一致")
    elif protocol == PROTOCOL:
        checked, findings = value.get("checked"), value.get("findings")
        if type(checked) is not int or checked < 0 or not isinstance(findings, list):
            raise CheckError("检查结果缺少合法对象计数或诊断集合")
        expected = "failed" if findings else "passed" if checked else "not-applicable"
        if value.get("status") != expected or code != (1 if findings else 0):
            raise CheckError("检查退出码、对象计数和声明状态不一致")
        status = expected
    else:
        raise CheckError("检查结果协议版本不匹配")
    if not isinstance(value.get("check"), str) or not value["check"]:
        raise CheckError("检查结果缺少检查身份")
    diagnostics = []
    for finding in findings:
        if (
            not isinstance(finding, dict)
            or any(not isinstance(finding.get(key), str) for key in ("path", "rule"))
            or type(finding.get("line")) is not int or finding["line"] < 0
        ):
            raise CheckError("检查诊断缺少可复核的位置")
        diagnostics.append({key: finding[key] for key in ("path", "line", "rule")})
    if status == "not-applicable":
        if gate.zero_reason is None:
            return "environment-error", 0, "已选择检查未发现任何对象；请核对根目录和扫描范围", (), acceptance_summary
        return status, 0, gate.zero_reason, (), acceptance_summary
    return status, checked, "", tuple(diagnostics), acceptance_summary


def execute(
    gate: Gate,
    root: Path,
    timeout: float,
    cancel: threading.Event | None = None,
    *,
    maintenance: bool = False,
    acceptance_report: Path | None = None,
) -> Outcome:
    """在受控子进程中执行单项检查，错误与规则失败分别保留。

    Args:
        gate: 已登记的固定检查配置。
        root: 待检查仓库目录。
        timeout: 单项检查的秒数上限。
        cancel: 用户中断时由调度器设置的取消信号。
        maintenance: 是否显式选择维护模式。
        acceptance_report: 来源验收报告写出路径（只对支持验收状态的全量检查生效）。
    Returns:
        包含真实命令、对象计数、阻断清单和耗时；环境问题和超时分别保留。
    """
    started = time.monotonic()
    arguments = command_for(
        gate, root, maintenance=maintenance, acceptance_report=acceptance_report
    )
    checked = None
    diagnostics: tuple[dict[str, object], ...] = ()
    blockers: tuple[dict[str, object], ...] = ()
    acceptance_summary: dict[str, object] | None = None
    reason = ""
    process_code = None
    evidence_error = ""
    try:
        result = run_process(
            arguments,
            root,
            timeout=timeout,
            env={
                **os.environ,
                **evidence_environment(root),
                # 不接受开关的转发入口用等价环境变量表达同一维护模式选择。
                **(
                    {ACCEPTANCE_MODE_ENV: ACCEPTANCE_MODE_MAINTENANCE}
                    if maintenance and gate.acceptance and not gate.acceptance_flag
                    else {}
                ),
                "PYTHONIOENCODING": "utf-8",
                "PYTHONDONTWRITEBYTECODE": "1",
            },
            cancel=cancel,
        )
        code = result.code
        process_code = result.code
        output = (result.stdout + result.stderr).decode("utf-8", errors="replace")
        if code in {0, 1}:
            status, checked, reason, diagnostics, acceptance_summary = parse_result(
                gate, code, result.stdout, maintenance=maintenance, root=root
            )
            if acceptance_summary is not None:
                blockers = tuple(acceptance_summary.get("blockers") or ())
            if status == "not-applicable" and not zero_scope_confirmed(gate, root):
                status, reason = "environment-error", "子检查报告零对象，但独立范围清单仍存在适用对象"
        else:
            status, reason = "environment-error", "子检查未完成，保留实际非规则退出码"
            declared = declared_evidence_error(result.stdout)
            if declared and gate.acceptance:
                # 子检查自报“证据不可得”（上游内容取不回）：按环境故障表达真实原因，
                # 不能降级成内容失败，也不能因为退出码非 0/1 就丢掉可定位的诊断。
                evidence_error = declared
                reason = f"证据不可得：{declared}"
        if acceptance_report is not None and gate.acceptance_report:
            if not acceptance_report.is_file():
                status, reason = (
                    "environment-error",
                    f"已要求写出来源验收报告，但检查未实际产出：{acceptance_report}",
                )
    except CheckTimeout as exc:
        code, output, status, reason = 2, str(exc), "timeout", "检查超过约定时限，子进程已终止"
    except CheckError as exc:
        code, output, status, reason = 2, str(exc), "environment-error", str(exc)
    except (OSError, UnicodeError) as exc:
        # 输出与原因都保留真实异常文本，避免"检查未完成"无法定位到具体路径或编码问题。
        detail = str(exc).strip() or type(exc).__name__
        code, output, status, reason = 2, detail, "environment-error", f"独立范围清单无法读取，检查未完成：{detail}"
    return Outcome(
        gate.name,
        status,
        code,
        round(time.monotonic() - started, 3),
        output,
        checked,
        tuple(arguments),
        str(root),
        reason,
        gate.scope,
        diagnostics,
        process_code=process_code,
        blockers=blockers,
        acceptance=acceptance_summary,
        acceptance_mode=str((acceptance_summary or {}).get("mode", "")),
        evidence_error=evidence_error,
    )


def schedule(
    gates: list[Gate],
    root: Path,
    jobs: int,
    timeout: float,
    *,
    maintenance: bool = False,
    acceptance_report: Path | None = None,
) -> list[Outcome]:
    """有界并发运行独立检查；前置失败则明确跳过依赖项。

    Args:
        gates: 已补齐依赖的检查集合。
        root: 待检查仓库根目录。
        jobs: 最大同时运行的检查数。
        timeout: 每项检查的秒数上限。
        maintenance: 是否显式选择维护模式。
        acceptance_report: 来源验收报告写出路径。
    Returns:
        按登记顺序排列的全部结果，包括因依赖失败跳过的项。
    Raises:
        CheckError: 调度图无法继续前进。
    """
    pending = {gate.name: gate for gate in gates}
    outcomes: dict[str, Outcome] = {}
    cancel = threading.Event()
    pool = ThreadPoolExecutor(max_workers=jobs)
    try:
        running = {}
        while pending or running:
            for name, gate in list(pending.items()):
                if not all(dependency in outcomes for dependency in gate.dependencies):
                    continue
                if any(outcomes[dependency].status not in ACCEPTABLE_DEPENDENCY_STATES for dependency in gate.dependencies):
                    outcomes[name] = Outcome(name, "not-run", 1, 0, "前置检查未通过", command=tuple(command_for(gate, root)), cwd=str(root), reason="dependency-failed", scope=gate.scope, attempted=False)
                    del pending[name]
                elif len(running) < jobs:
                    running[
                        pool.submit(
                            execute,
                            gate,
                            root,
                            timeout,
                            cancel,
                            maintenance=maintenance,
                            acceptance_report=acceptance_report,
                        )
                    ] = name
                    del pending[name]
            if running:
                finished, _ = wait(running, return_when=FIRST_COMPLETED)
                for future in finished:
                    name = running.pop(future)
                    outcomes[name] = future.result()
            elif pending:
                raise CheckError("检查依赖不完整或存在循环")
    finally:
        cancel.set()
        pool.shutdown(wait=True, cancel_futures=True)
    return [outcomes[gate.name] for gate in gates]


def combined_code(outcomes: list[Outcome]) -> int:
    """环境或超时返回 2，失败/未执行/全组无实测对象返回 1，其余返回 0。

    维护完成态（``completed-with-registered-blockers``）计入“有实际对象”但不计入
    “通过检查数”，因此它既不能被当成失败而阻止维护汇总，也不能让来源验收通过数增加。
    """
    if any(result.status in {"environment-error", "timeout"} for result in outcomes):
        return 2
    if any(
        result.status in {"passed", CHECK_STATUS_MAINTENANCE}
        and (type(result.checked) is not int or result.checked <= 0)
        or result.status == "not-applicable" and result.checked != 0
        for result in outcomes
    ):
        return 2
    if any(result.status not in ACCEPTABLE_DEPENDENCY_STATES for result in outcomes):
        return 1
    if not any(
        result.status in {"passed", CHECK_STATUS_MAINTENANCE}
        and type(result.checked) is int
        and result.checked > 0
        for result in outcomes
    ):
        return 1
    return 0


def persisted_outcome(outcome: Outcome) -> dict[str, object]:
    """保存结果与输出摘要，去除可能含有源码片段或凭据的原始输出正文。"""
    value = asdict(outcome)
    output = value.pop("output")
    value["output_sha256"] = hashlib.sha256(str(output).encode("utf-8")).hexdigest()
    return value


def run_with_evidence(
    gates: list[Gate],
    root: Path,
    jobs: int,
    timeout: float,
    *,
    maintenance: bool = False,
    acceptance_report: Path | None = None,
) -> tuple[dict[str, object], list[Outcome]]:
    """在执行前后核对同一工作树及规则内容，输入变化时拒绝签发有效成功。

    Args:
        gates: 完整预期检查集合，包含已补齐的依赖。
        root: 实际检查工作目录。
        jobs: 子检查并发上限。
        timeout: 单项检查超时秒数。
        maintenance: 是否显式选择维护模式。
        acceptance_report: 来源验收报告写出路径。
    Returns:
        不含源码正文的证据与用于本次终端显示的原始结果；失败也保留真实状态。
    """
    started = datetime.now(timezone.utc).isoformat()
    before: dict[str, object] | None = None
    after: dict[str, object] | None = None
    evidence_error = ""
    try:
        before = check_evidence.snapshot(root, DEFAULT_ROOT)
    except (CheckError, OSError, UnicodeError) as error:
        # 快照失败必须能定位到具体原因，否则"未运行检查"无法与真实规则失败区分。
        evidence_error = f"input-snapshot-failed:{type(error).__name__}:{(str(error).strip() or '无附加信息')}"
        outcomes = [Outcome(gate.name, "not-run", 2, 0, "输入快照失败，未运行检查", command=tuple(command_for(gate, root)), cwd=str(root), reason=evidence_error, scope=gate.scope, attempted=False) for gate in gates]
    else:
        outcomes = schedule(
            gates,
            root,
            jobs,
            timeout,
            maintenance=maintenance,
            acceptance_report=acceptance_report,
        )
        try:
            after = check_evidence.snapshot(root, DEFAULT_ROOT)
        except (CheckError, OSError, UnicodeError) as error:
            evidence_error = f"final-snapshot-failed:{type(error).__name__}:{(str(error).strip() or '无附加信息')}"
    consistent = before is not None and after is not None and before == after
    if not consistent and not evidence_error:
        evidence_error = "inputs-changed-during-checks"
    unavailable = [
        f"{result.name}:{result.evidence_error}"
        for result in outcomes
        if result.evidence_error
    ]
    if unavailable and not evidence_error:
        # 子检查自报“证据不可得”时，汇总层同样按证据无效表达，而不是内容失败。
        evidence_error = ";".join(unavailable)
    code = combined_code(outcomes) if consistent else 2
    registered = [
        blocker
        for result in outcomes
        for blocker in result.blockers
    ]
    report: dict[str, object] = {
        "schema": check_evidence.SCHEMA,
        "started_at": started,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "root": str(root),
        "input_mode": "worktree",
        "selection": [asdict(gate) for gate in gates],
        "execution": {
            "jobs": jobs,
            "timeout_seconds": timeout,
            "mode": "maintenance" if maintenance else "strict",
        },
        "evidence": evidence_report(root),
        "before": before, "after": after,
        "inputs_consistent": consistent,
        "evidence_error": evidence_error,
        "code": code,
        "status": run_status(code, consistent, outcomes),
        # 已登记阻断独立成列：它不进入 passed 计数，也不增加已验收对象数。
        "counts": {
            "results": len(outcomes),
            "passed": sum(result.status == "passed" for result in outcomes),
            "registered_blockers": len(registered),
            "hard_failures": sum(len(result.diagnostics) for result in outcomes),
            "not_applicable": sum(result.status == "not-applicable" for result in outcomes),
            "not_run": sum(not result.attempted for result in outcomes),
        },
        "registered_blockers": registered,
        "source_acceptance": source_acceptance_report(outcomes),
        "results": [persisted_outcome(result) for result in outcomes],
    }
    return report, outcomes


def run_status(code: int, consistent: bool, outcomes: list[Outcome]) -> str:
    """按真实退出码与逐项状态给出汇总状态，维护完成态与 passed 分开表达。"""

    if code == 0 and any(
        result.status == CHECK_STATUS_MAINTENANCE for result in outcomes
    ):
        return CHECK_STATUS_MAINTENANCE
    if code == 0:
        return "passed"
    if not consistent:
        return "invalid-evidence"
    if all(result.status == "not-applicable" for result in outcomes):
        return "not-verified"
    return "failed"


def source_acceptance_report(outcomes: list[Outcome]) -> dict[str, object] | None:
    """汇总支持验收状态的子检查结果，供报告与上游消费者直接取用。"""

    entries = [result for result in outcomes if result.acceptance is not None]
    if not entries:
        return None
    return {
        "checks": [result.name for result in entries],
        "mode": entries[0].acceptance_mode,
        "registered_blockers": [
            blocker for result in entries for blocker in result.blockers
        ],
        "counts": {
            "registered_blockers": sum(
                len(result.blockers) for result in entries
            ),
            "hard_failures": sum(len(result.diagnostics) for result in entries),
        },
    }


def positive_integer(value: str) -> int:
    """解析正整数参数，拒绝零和负值以防无限等待或无法启动工作池。"""
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("必须是正整数")
    return number


def main() -> int:
    """输出检查清单或运行已选择检查，并保留完整汇总状态。"""
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    arguments.add_argument(
        "--group", choices=("all", "docs", "comments", "boundaries"), default="all"
    )
    arguments.add_argument("--checks", nargs="+", default=[], help="指定检查名，自动补齐前置检查")
    arguments.add_argument("--jobs", type=positive_integer, default=3)
    arguments.add_argument("--timeout", type=positive_integer, default=180)
    arguments.add_argument("--list", action="store_true")
    arguments.add_argument("--json", action="store_true")
    arguments.add_argument("--report", type=Path, help="显式保存可复核 JSON 证据，路径必须位于输入目录外")
    arguments.add_argument(
        "--maintenance",
        action="store_true",
        help=(
            "显式维护模式：完整消费未验收状态后，已登记阻断单独列出并以"
            " completed-with-registered-blockers 结束；不加此开关保持严格拒绝"
        ),
    )
    arguments.add_argument(
        "--acceptance-report",
        type=Path,
        help="由全量 Java 注释检查写出来源验收报告（source-acceptance-report/v1）",
    )
    args = arguments.parse_args()
    gates = select_gates(args.checks, args.group)
    if args.list:
        print(json.dumps([asdict(gate) for gate in gates], ensure_ascii=False, indent=2))
        return 0
    root = args.root.resolve()
    if args.report is not None:
        check_evidence.validate_destination(args.report.resolve(), root, DEFAULT_ROOT)
    acceptance_report = args.acceptance_report.resolve() if args.acceptance_report else None
    if acceptance_report is not None:
        producers = [gate for gate in gates if gate.acceptance_report]
        if not producers:
            print(
                "来源验收报告请求失败：本次选择中没有全量 Java 注释检查，"
                "不能用空文件代替本次来源验收",
                file=sys.stderr,
            )
            return 2
    report, outcomes = run_with_evidence(
        gates,
        root,
        args.jobs,
        args.timeout,
        maintenance=args.maintenance,
        acceptance_report=acceptance_report,
    )
    code = int(report["code"])
    if args.report is not None:
        check_evidence.write_report(args.report.resolve(), report)
    counts = report["counts"]
    assert isinstance(counts, dict)
    if args.json:
        print(
            json.dumps(
                {"code": code, "status": report["status"], "inputs_consistent": report["inputs_consistent"], "evidence_error": report["evidence_error"], "evidence": report["evidence"], "counts": counts, "registered_blockers": report["registered_blockers"], "source_acceptance": report["source_acceptance"], "results": [asdict(result) for result in outcomes]},
                ensure_ascii=False,
            )
        )
    else:
        for result in outcomes:
            print(f"{result.name}: {result.status} ({result.seconds:.3f}s)")
            if result.output:
                print(result.output.rstrip())
            if result.reason:
                print(result.reason)
        evidence = report["evidence"]
        if evidence.get("status") == "configured":
            print(
                "受控来源证据：清单 "
                f"{evidence.get('registry')}（SHA-256 {evidence.get('registry_sha256')}，"
                f"{evidence.get('records')} 条记录）；受控快照 {evidence.get('snapshots') or '未配置'}"
            )
        else:
            print(f"受控来源证据：{evidence.get('reason')}")
        print(
            f"汇总：{report['status']}；{counts['passed']}/{len(outcomes)} 项有实际对象并通过，"
            f"已登记阻断 {counts['registered_blockers']} 项，硬失败 {counts['hard_failures']} 项，"
            f"未覆盖漏项 0 项，退出码 {code}。"
        )
        for blocker in report["registered_blockers"]:
            print(
                f"- 已登记阻断（不计为通过）：{blocker.get('path')} "
                f"[{blocker.get('form')}] {blocker.get('verdict')}"
            )
        if report["evidence_error"]:
            print(f"证据无效：{report['evidence_error']}")
    return code


if __name__ == "__main__":
    raise SystemExit(entry(main))
