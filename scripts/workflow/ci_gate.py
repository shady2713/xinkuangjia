"""核对 CI 作业与真实 JUnit 用例，拒绝跳过、空报告、缺失集成测试及无证据的发布结论。

发布结论还必须包含真实静态检查证据：覆盖率裁决文档里的静态检查段由
scripts/workflow/static_gate.py 在作业内从真实 PMD/lint 报告生成，本模块独立复核
其执行状态、零违规、工具与命令、配置指纹、检查范围与真实源码清单是否一致。

按裁决 D15 §69/§80/§82，发布汇总还必须直接消费来源验收状态：本模块取回本次
`source-acceptance-report/v1` 报告，核对提交、规则指纹、受控账本指纹、扫描范围、
逐项状态与计数，并用仓库内索引与真实文件独立复算一遍。报告缺失、未知 schema、
旧提交、计数不符、范围漏项或仍有适用阻断时，来源验收不通过；只要存在未解决阻断，
release 汇总就退出 1 且 `release_verified=false`，不得因为“已登记”而转绿。

发布汇总还必须消费性能预算的实测结论：判定由 scripts/perf/perf_budget.py 完成，
本模块按受版本控制的预算文件独立复核「用的是哪一份预算、是否已获有权者批准、实测
覆盖多少场景、读数是否绑定本次发布的提交」。**未获批准的预算不是门槛而是提案**，
缺项、未通过、换预算、未批准或绑定到别的提交都直接拒绝发布证据；本模块不提供豁免
开关，也不代替有权者批准任何预算。

@author OpenAI Codex
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.common.quality_common import CheckError
from scripts.workflow import static_gate
from scripts.workflow.run_checks import ledger_entry_key, ledger_expected_keys

# 四个必需作业：文档与工具、管理前端、Java 后端、浏览器业务端到端。
# 浏览器业务用例同样必须真实成功并上报正整数用例数，跳过或零用例一律拒绝。
JOBS = {"docs_tools", "frontend", "backend", "browser_e2e"}
STAGES = {"functional", "audit", "release"}
BACKEND_REQUIRED = {
    "AuthenticationSessionMySqlIT", "PermissionObjectMySqlIT", "FileUploadMySqlS3IT",
    "OAuth2MachinePrincipalHttpMySqlIT",
}

# 发布结论只能引用真实命令生成的证据。文件名、检查名、计数核对方式和阈值都在此固定：
# 编排必须产出同名文件，阶段标签本身不再产生 release_verified。
RELEASE_SCHEMA = "ci-release-evidence/v1"
COVERAGE_SCHEMA = "coverage-gate/v1"
STATIC_SCHEMA = static_gate.SCHEMA
COVERAGE_THRESHOLDS = {"per_file": True, "lines": 100, "methods_or_functions": 100}
REVISION_TEXT = re.compile(r"[0-9a-f]{40}")
DIGEST_TEXT = re.compile(r"[0-9a-f]{64}")
# 每个发布范围必须真实执行过的静态检查工具；名字、版本与命令缺一即拒绝。
STATIC_TOOLS = {"backend": ("pmd",), "web": ("eslint", "prettier", "stylelint")}
# 静态检查工具识别仓库的根目录；发布证据固定对应本仓库的模块与配置。
ROOT = Path(__file__).resolve().parents[2]
RELEASE_JOBS = {
    "backend": {"evidence": "release-backend.json", "coverage_kind": "backend",
                "coverage_file": "coverage-backend.json"},
    "frontend": {"evidence": "release-frontend.json", "coverage_kind": "web",
                 "coverage_file": "coverage-web.json"},
}
# 检查名 -> 计数核对方式：job_count 等于该作业上报的真实用例数，coverage_count 等于
# 覆盖率裁决的实测文件数，own_count 的计数没有第二份声明可比，由本模块独立枚举受管
# 范围复算（见 release_evidence），no_count 表示该检查没有机器可读对象计数，只能声明 null。
RELEASE_CHECKS = {
    "backend": {"backend-tests-and-integration": "job_count",
                "backend-release-coverage": "coverage_count",
                # 第三方许可材料必须随 JAR 分发且与实际依赖闭包一致。门禁按交付 JAR 的字节
                # 裁决，没有可与作业用例数比对的第二份声明，因此只能声明 null；缺少这一项
                # 会让发布汇总直接拒绝发布证据，"漏生成许可材料"不再可能发布出去。
                "backend-license-materials": "no_count",
                # 性能预算：判定由 scripts/perf/perf_budget.py 在真实测量后给出，门禁这一侧
                # 不读报告、只复核结论，并按受控预算文件独立复算实测场景数（perf_count），
                # 换一份预算、少测一个场景或漏写这一项都会让发布汇总直接拒绝。
                "backend-performance-budget": "perf_count"},
    "frontend": {"frontend-unit-tests": "job_count",
                 "frontend-release-coverage": "coverage_count",
                 "frontend-typecheck": "no_count",
                 "frontend-production-build": "no_count",
                 "frontend-production-scan": "no_count",
                 # 前端同样按产物字节实查：材料条目数必须与产物分块实际引用的包集合一致。
                 "frontend-license-materials": "no_count",
                 # 全库 Web 注释合格只有这一个依据：docs_tools 作业里那次执行不进入发布
                 # 制品，发布结论必须自己重新执行并把实测对象数写进证据。
                 "web-comments-full": "own_count"},
}
# 来源验收报告（裁决 D15 §65/§69）：由全量 Java 注释检查在真实扫描后写出，
# 发布汇总必须取回并独立复核，不能用作业成功、默认 0 或旧账本代替。
SOURCE_REPORT_SCHEMA = "source-acceptance-report/v1"
SOURCE_PROTOCOL = "quality-check/v2"
SOURCE_INDEX_DEFAULT = "docs/测试与可靠性/来源证据/d12-source-index.json"
SOURCE_ACCEPTED_VERDICTS = (
    "已按 D12 格式写入来源说明并撤回无依据署名",
    "已按 D12 格式写入来源说明（D10b 改判）",
    "A1（E1-author-only）成立，恢复上游证据支持的作者",
)

# 性能预算门禁：判定本身由 scripts/perf/perf_budget.py 消费「实测报告 + 受控预算文件」
# 完成，汇总这一侧不读报告，只复核结论，并独立回答四个问题——用的是哪一份受控预算、
# 这份预算是否已获有权者批准、实测实际覆盖了多少场景、这次读数是不是本次发布的那个提交
# 量出来的。四项都不采信证据自述。
# 预算在获批准前必须让发布红灯：「还没批准」不是「通过」的理由，汇总也不提供豁免开关；
# 批准只能由人改受控预算文件本身，这里只如实读它的状态。
PERF_EVIDENCE = "perf-budget.json"
PERF_BUDGET_FILE = "scripts/perf/budgets/baseline-2026-10-07.json"
PERF_SCHEMA = "perf-budget/v2"
PERF_PROTOCOL = "quality-check/v1"
PERF_CHECK = "性能预算"
PERF_APPROVED = "approved"
# 构件绑定方法由 scripts/perf/source_identity.py 单点定义，这里只固定期望值核对结论：
# 构件字节摘要不可复现，按它绑定会让 build-mismatch 在任何干净检出的 CI 上必现，因此
# 性能读数只认「Git 修订 + 源码内容摘要」，并要求它等于本次发布的提交。
PERF_BINDING_METHOD = "git-source-id/v1"
# 声明了性能预算检查项的作业及其固定证据文件名；表外作业不参与性能复核。
RELEASE_PERF_EVIDENCE = {"backend": PERF_EVIDENCE}


def known_source_verdicts() -> tuple[str, ...]:
    """按需取回判词词表的唯一定义处（检查器 → 调度器 → 本汇总共用同一份）。

    Returns:
        已定义判词的全集；表外取值一律按未知判词硬失败，不当成“尚未验收”。
    """

    from scripts.code.java import check_full_java_comments

    return tuple(check_full_java_comments.KNOWN_SOURCE_VERDICTS)
SOURCE_REPORT_NAME = "source-acceptance-report.json"
SOURCE_ROOT = Path(__file__).resolve().parents[2]



def json_document(directory: Path, name: str) -> dict[str, object]:
    """读取发布证据目录内的单个 JSON 对象，缺失、不可读或结构不符都受控拒绝。

    Args:
        directory: 发布检查写入证据的目录。
        name: 目录内固定的证据文件名。
    Returns:
        解析后的 JSON 对象。
    Raises:
        ValueError: 文件缺失、不是 UTF-8 JSON 或顶层不是对象。
    """
    path = directory / name
    if not path.is_file():
        raise ValueError(f"缺少发布证据文件：{name}")
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"发布证据不是可读的 JSON：{name}") from error
    if not isinstance(document, dict):
        raise ValueError(f"发布证据必须是 JSON 对象：{name}")
    return document


def static_section(document: dict[str, object], name: str, kind: str) -> dict[str, object]:
    """复核发布证据里的静态检查段，拒绝跳过、零对象、违规、范围缩水与旧配置。

    静态检查段由作业内的 static_gate.py 从真实报告生成；本函数不信任其中的自述，
    重新按当前仓库枚举模块与配置指纹，并要求模块清单、源码对象数与生产清单匹配。

    Args:
        document: 已确认阶段的覆盖率裁决文档。
        name: 证据文件名，用于错误定位。
        kind: 期望的静态检查范围，backend 或 web。
    Returns:
        已复核的静态检查段。
    Raises:
        ValueError: 缺少静态检查段，或执行状态、工具、命令、配置、范围、计数任一项不符。
    """
    section = document.get("static_analysis")
    if not isinstance(section, dict):
        raise ValueError(f"覆盖率证据缺少静态检查结论：{name}")
    if section.get("schema") != STATIC_SCHEMA or section.get("kind") != kind \
            or section.get("stage") != document.get("stage"):
        raise ValueError(f"静态检查证据的阶段、范围或结构不正确：{name}")
    if section.get("status") != "passed" or section.get("code") != 0:
        raise ValueError(f"静态检查未真实通过，不能作为发布证据：{name}")
    if section.get("executed") is not True or section.get("skipped") is not False:
        raise ValueError(f"静态检查被跳过或未真实执行：{name}")
    objects, violations = section.get("objects"), section.get("violations")
    # 布尔值是 int 的子类，必须先按精确类型拒绝，避免 True 冒充正整数检查对象。
    if type(objects) is not int or objects <= 0:
        raise ValueError(f"静态检查没有正整数的真实检查对象：{name}")
    if type(violations) is not int or violations != 0:
        raise ValueError(f"静态检查仍声明违规：{name}")
    tools = section.get("tools")
    if not isinstance(tools, list) or not tools:
        raise ValueError(f"静态检查证据没有工具记录：{name}")
    found: dict[str, dict[str, object]] = {}
    for item in tools:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str) or item["name"] in found:
            raise ValueError(f"静态检查工具名缺失或重复：{name}")
        found[item["name"]] = item
    if set(found) != set(STATIC_TOOLS[kind]):
        raise ValueError(f"静态检查工具集合与范围要求不一致：{name}")
    for tool, item in found.items():
        if item.get("status") != "passed" or item.get("exit_code") != 0:
            raise ValueError(f"静态检查工具未真实通过：{kind}/{tool}")
        if not str(item.get("version", "")).strip() or not str(item.get("command", "")).strip():
            raise ValueError(f"静态检查工具缺少版本或可核对命令：{kind}/{tool}")
    try:
        expected_config = {static_gate.repository_path(ROOT, path): static_gate.digest(path)
                           for path in (static_gate.backend_configs(ROOT) if kind == "backend"
                                        else static_gate.web_configs(ROOT))}
    except (CheckError, OSError, ValueError) as error:
        raise ValueError(f"无法核对静态检查配置：{name}") from error
    declared = section.get("config")
    if not isinstance(declared, list) or not declared:
        raise ValueError(f"静态检查证据缺少配置指纹：{name}")
    recorded: dict[str, str] = {}
    for item in declared:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str) \
                or not DIGEST_TEXT.fullmatch(str(item.get("sha256", ""))):
            raise ValueError(f"静态检查配置指纹不合法：{name}")
        recorded[item["path"]] = str(item["sha256"])
    if recorded != expected_config:
        raise ValueError(f"静态检查配置与当前仓库不一致，证据可能来自旧版本或被改动：{name}")
    reports = section.get("reports")
    if not isinstance(reports, list) or not reports:
        raise ValueError(f"静态检查证据缺少真实报告清单：{name}")
    for item in reports:
        if not isinstance(item, dict) or not str(item.get("path", "")).strip() \
                or not DIGEST_TEXT.fullmatch(str(item.get("sha256", ""))):
            raise ValueError(f"静态检查报告清单缺少路径或指纹：{name}")
    if kind == "backend":
        try:
            expected_modules = {static_gate.repository_path(ROOT, module)
                                for module in static_gate.production_modules(ROOT)}
        except (OSError, ValueError) as error:
            raise ValueError(f"无法枚举后端静态检查范围：{name}") from error
        modules = section.get("modules")
        if not isinstance(modules, list) or not modules:
            raise ValueError(f"静态检查证据缺少逐模块结论：{name}")
        sources = 0
        for item in modules:
            if not isinstance(item, dict) or item.get("module") not in expected_modules \
                    or item.get("violations") != 0 or type(item.get("sources")) is not int \
                    or int(item["sources"]) <= 0 or not DIGEST_TEXT.fullmatch(str(item.get("sha256", ""))):
                raise ValueError(f"静态检查的模块结论不完整或范围不符：{name}")
            sources += int(item["sources"])
        if {str(item["module"]) for item in modules} != expected_modules:
            raise ValueError(f"静态检查范围与当前后端模块不一致：{name}")
        if len(reports) != len(modules) or sources != objects:
            raise ValueError(f"静态检查对象数与模块结论不一致：{name}")
    else:
        workspace = section.get("workspace")
        if not isinstance(workspace, dict) or workspace.get("files") != objects \
                or workspace.get("errors") != 0 or workspace.get("fatal") != 0:
            raise ValueError(f"静态检查的工作区自述不合法：{name}")
        # 三个工具都在真实执行中退出 0 才写出证据；未格式化文件与 stylelint 问题数必须为 0。
        if workspace.get("unformatted") != 0 or workspace.get("stylelint_problems") not in (0, None):
            raise ValueError(f"静态检查仍存在未通过的工具结果：{name}")
        inventory = document.get("inventory")
        if not isinstance(inventory, list) or len(inventory) > objects:
            raise ValueError(f"静态检查范围小于生产源码清单：{name}")
    return section


def coverage_document(directory: Path, name: str, kind: str) -> dict[str, object]:
    """核对一份发布阶段覆盖率裁决，拒绝审计结论、零对象、阈值放宽和缺口。

    Args:
        directory: 发布检查写入证据的目录。
        name: 覆盖率证据文件名。
        kind: 期望的覆盖率范围，backend 或 web。
    Returns:
        已确认属于该范围发布门槛且已通过的真实裁决文档，并已复核其中的静态检查段。
    Raises:
        ValueError: 阶段或范围不符、未通过、零实测对象、存在缺口或阈值被改变，
            或缺少真实静态检查证据。
    """
    document = json_document(directory, name)
    if document.get("schema") != COVERAGE_SCHEMA or document.get("kind") != kind or document.get("stage") != "release":
        raise ValueError(f"覆盖率证据不是该范围的发布阶段真实裁决：{name}")
    if document.get("status") != "passed" or document.get("code") != 0:
        raise ValueError(f"覆盖率证据未通过发布门槛：{name}")
    measured, failed, problems = document.get("measured_files"), document.get("failed_files"), document.get("problems")
    # 布尔值是 int 的子类，必须先按精确类型拒绝，避免 True 冒充正整数计数。
    if type(measured) is not int or measured <= 0:
        raise ValueError(f"覆盖率证据没有实测文件：{name}")
    if type(failed) is not int or failed != 0 or problems != []:
        raise ValueError(f"覆盖率证据仍有未达门槛的文件或完整性问题：{name}")
    if document.get("thresholds") != COVERAGE_THRESHOLDS:
        raise ValueError(f"覆盖率证据的阈值不是逐文件行与方法/函数 100%：{name}")
    # 覆盖率只裁决已有数据；该字段一旦被改成 True 就是在冒充测试执行证据。
    if document.get("validates_test_execution") is not False:
        raise ValueError(f"覆盖率证据不得声称已验证测试执行：{name}")
    files, reports, inventory = document.get("files"), document.get("reports"), document.get("inventory")
    if not isinstance(files, list) or not files or not isinstance(inventory, list) or not inventory:
        raise ValueError(f"覆盖率证据缺少实测分母：{name}")
    if any(not isinstance(item, dict) or item.get("status") not in {"passed", "not-applicable"} for item in files):
        raise ValueError(f"覆盖率证据包含未达门槛的文件：{name}")
    if not isinstance(reports, list) or not reports or not all(
            isinstance(item, dict) and DIGEST_TEXT.fullmatch(str(item.get("sha256", ""))) for item in reports):
        raise ValueError(f"覆盖率证据缺少报告内容指纹：{name}")
    static_section(document, name, kind)
    return document


def perf_budget_source() -> dict[str, object]:
    """独立读取受版本控制的性能预算文件；权威状态与场景范围都不采信证据自述。

    门禁固定复核同一份预算文件，因此「换一份宽松预算再发一份证据」在这里就会被发现：
    证据声明的状态必须与本文件一致，场景数也按本文件复算。

    Returns:
        解析后的 perf-budget/v1 预算对象。
    Raises:
        ValueError: 文件缺失、不是可读 JSON 对象、schema 不符或场景预算为空。
    """

    path = ROOT / PERF_BUDGET_FILE
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"无法读取受控性能预算文件：{PERF_BUDGET_FILE}") from error
    if not isinstance(document, dict) or document.get("schema") != PERF_SCHEMA:
        raise ValueError(f"受控性能预算文件不是 {PERF_SCHEMA}：{PERF_BUDGET_FILE}")
    scenarios = document.get("scenarios")
    if not isinstance(scenarios, dict) or not scenarios:
        raise ValueError(f"受控性能预算文件没有场景预算：{PERF_BUDGET_FILE}")
    return document


def perf_budget_document(directory: Path, job: str, revision: str) -> dict[str, object]:
    """复核发布证据里的性能预算结论：判定、权威状态、实测范围与构件绑定缺一不可。

    结论由 ``scripts/perf/perf_budget.py`` 在真实测量后写出，本函数不读报告本身，
    只核对结论并把「用的是哪一份预算」独立重算一遍。**未获有权者批准的预算一律拒绝**：
    ``proposed-awaiting-authority`` 只是提案，不是门槛，本模块不提供默认放行、豁免开关，
    也不代替任何人把状态改成 ``approved``。

    构件绑定独立复核：结论必须带 ``binding`` 段，绑定方法为 ``git-source-id/v1``，且实测
    提交的源码修订等于本次发布的提交。少了这一项，「性能通过」可能来自别的提交甚至别的
    工作区，发布结论不能签发；结论里只写一句 ``build-mismatch`` 文字也不算数。

    Args:
        directory: 发布检查写入证据的目录。
        job: 期望声明该检查的作业名，用于错误定位。
        revision: 本次验证的提交标识，性能读数必须绑定到同一提交。
    Returns:
        含预算文件、实测场景数、批准人、负载标识与构件绑定的摘要。
    Raises:
        ValueError: 证据缺失、结构不符、判定未通过、预算未获批准、构件绑定不符或缺失，
            或实测范围与受控预算声明的场景数、适用范围不一致。
    """

    document = json_document(directory, PERF_EVIDENCE)
    if document.get("protocol") != PERF_PROTOCOL or document.get("check") != PERF_CHECK:
        raise ValueError(f"性能预算证据不是预算核对的结构化结果：{job}")
    if document.get("schema") != PERF_SCHEMA:
        raise ValueError(f"性能预算证据的结构版本不正确：{job}")
    # 判定未通过或仍有任何问题时都不构成发布证据；超预算、未测量、证据不可比在
    # 结论里已经分列，这里不再按「问题种类」放行任何一种。
    if document.get("status") != "passed" or document.get("findings") != []:
        raise ValueError(f"性能预算核对未通过：{job}")
    checked = document.get("checked")
    # 布尔值是 int 的子类，必须先按精确类型拒绝，避免 True 冒充实测场景数。
    if type(checked) is not int or checked <= 0:
        raise ValueError(f"性能预算核对没有正整数的实测场景数：{job}")
    binding = document.get("binding")
    if not isinstance(binding, dict):
        raise ValueError(f"性能预算证据没有构件绑定，无法确认读数来自哪个提交：{job}")
    if binding.get("method") != PERF_BINDING_METHOD or binding.get("matched") is not True:
        raise ValueError(
            f"性能预算证据的构件绑定不可用：{job}"
            f"（方法 {binding.get('method')!r}，相符 {binding.get('matched')!r}）"
        )
    observed = binding.get("observed")
    if not isinstance(observed, dict) or observed.get("git_revision") != revision:
        raise ValueError(
            f"性能预算证据绑定的源码修订与本次发布提交不一致：{job}"
            f"（证据 {observed.get('git_revision') if isinstance(observed, dict) else None!r}，"
            f"发布 {revision}）"
        )
    budget = perf_budget_source()
    if document.get("budget_status") != budget.get("status"):
        raise ValueError(f"性能预算证据采用的预算状态与仓库内受控预算不一致：{job}")
    if budget.get("status") != PERF_APPROVED or not str(budget.get("approved_by") or "").strip():
        raise ValueError(
            f"性能预算未获有权者批准，不能作为发布门槛：{job}"
            f"（{PERF_BUDGET_FILE} 状态 {budget.get('status')!r}，"
            f"批准人 {budget.get('approved_by')!r}）"
        )
    if checked != len(budget["scenarios"]):
        raise ValueError(
            f"性能预算实测范围与受控预算的场景数不一致：{job}"
            f"（声明 {checked}，受控预算 {len(budget['scenarios'])}）"
        )
    applies = budget.get("applies_to")
    if not isinstance(applies, dict) or document.get("workload") != applies.get("workload"):
        raise ValueError(f"性能预算证据的负载与受控预算声明的适用范围不一致：{job}")
    return {
        "budget": PERF_BUDGET_FILE,
        "checked": checked,
        "approved_by": budget.get("approved_by"),
        "workload": document.get("workload"),
        "binding_method": binding.get("method"),
        "source_revision": observed.get("git_revision"),
    }


def release_manifest(directory: Path, name: str, job: str,
                     revision: str) -> tuple[dict[str, dict[str, object]], object]:
    """核对单个作业写出的发布证据，要求提交绑定、检查集合和通过状态都真实完整。

    Args:
        directory: 发布检查写入证据的目录。
        name: 该作业的证据文件名。
        job: 期望的作业名，同时决定必需的检查集合。
        revision: 本次验证的提交标识，证据必须绑定到同一提交。
    Returns:
        检查名到已核对检查项的映射，以及原样读出的覆盖率声明，供调用者继续与
        作业计数和真实覆盖率裁决交叉核对。
    Raises:
        ValueError: 阶段或作业不符、提交未绑定或不一致、检查缺失、重复或未真实通过。
    """
    document = json_document(directory, name)
    if document.get("schema") != RELEASE_SCHEMA or document.get("job") != job or document.get("stage") != "release":
        raise ValueError(f"发布证据的阶段或作业不正确：{name}")
    declared = document.get("revision")
    if not isinstance(declared, str) or not REVISION_TEXT.fullmatch(declared):
        raise ValueError(f"发布证据没有绑定本次提交：{name}")
    if declared != revision:
        raise ValueError(f"发布证据绑定的提交与本次验证不一致：{name}")
    checks = document.get("checks")
    if not isinstance(checks, list) or not checks:
        raise ValueError(f"发布证据的检查清单为空：{name}")
    found: dict[str, dict[str, object]] = {}
    for item in checks:
        if not isinstance(item, dict):
            raise ValueError(f"发布证据的检查项必须是对象：{name}")
        check, command = item.get("name"), item.get("command")
        if not isinstance(check, str) or not check or check in found:
            raise ValueError(f"发布证据的检查名缺失或重复：{name}")
        if item.get("status") != "passed":
            raise ValueError(f"发布检查未真实通过：{job}/{check}")
        if not isinstance(command, str) or not command.strip():
            raise ValueError(f"发布检查没有可核对命令：{job}/{check}")
        found[check] = item
    for check, mode in RELEASE_CHECKS[job].items():
        item = found.get(check)
        if item is None:
            raise ValueError(f"缺少发布检查证据：{job}/{check}")
        checked = item.get("checked")
        if mode == "no_count":
            # 类型检查和生产构建没有机器可读对象计数，只能声明 null，不得编造数字。
            if checked is not None:
                raise ValueError(f"无机器可读计数的发布检查不得声明计数：{job}/{check}")
        elif type(checked) is not int or checked <= 0:
            raise ValueError(f"发布检查没有正整数实际对象：{job}/{check}")
    return found, document.get("coverage")


def coverage_declaration(declared: object, job: str, spec: dict[str, str], coverage: dict[str, object]) -> None:
    """核对证据自带的覆盖率声明与真实裁决一致，防止只改声明或复用其它范围结论。

    Args:
        declared: 作业证据中声明的覆盖率来源对象。
        job: 作业名，用于错误定位。
        spec: 该作业固定的证据文件名与覆盖率范围。
        coverage: 已核对的真实覆盖率裁决文档。
    Raises:
        ValueError: 声明缺失，文件名、范围或阶段不符，实测或缺口计数与裁决不一致。
    """
    if not isinstance(declared, dict):
        raise ValueError(f"发布证据没有声明覆盖率来源：{job}")
    if declared.get("kind") != spec["coverage_kind"] or declared.get("stage") != "release" \
            or declared.get("evidence") != spec["coverage_file"]:
        raise ValueError(f"发布证据的覆盖率声明范围、阶段或文件不正确：{job}")
    if declared.get("measured_files") != coverage["measured_files"] or declared.get("failed_files") != 0:
        raise ValueError(f"发布证据的覆盖率声明与真实裁决不一致：{job}")


def managed_web_files(root: Path) -> int:
    """独立枚举纳管 Web 源码数量，用于复算 Web 全量注释声明的实测范围。

    与检查器同源：受管扩展名、Git 忽略与固定排除规则都取自
    ``scripts.common.quality_common.discover``，类型声明文件（``*.d.ts``）按
    ``check_worktree_web_comments.collect`` 的同一规则排除，避免汇总与检查器各自
    解释「全量」而让范围漂移不可见。

    Args:
        root: 待检查仓库根目录。
    Returns:
        纳管 Web 文件数；与 ``check_full_web_comments.py`` 上报的 checked 同口径。
    Raises:
        CheckError: 仓库根目录不可读、显式目标非法或文件发现失败。
    """

    from scripts.code.web.check_worktree_web_comments import EXTENSIONS
    from scripts.common.quality_common import discover

    return sum(1 for path in discover(root, EXTENSIONS) if not path.name.endswith(".d.ts"))


def release_evidence(directory: Path | None, counts: dict[str, int], revision: str | None) -> dict[str, object]:
    """核验发布阶段的真实检查证据，缺少或不合格时拒绝给出发布结论。

    证据由 workflow 中的真实命令产出：每个作业的覆盖率裁决原始 JSON（含作业内
    static_gate.py 从真实 PMD/lint 报告生成的静态检查段），以及该作业在本次提交上
    真实执行检查的清单。计数必须与聚合门禁独立核对的作业计数、覆盖率裁决的实测文件数
    一致，避免用标签或空报告冒充发布；没有第二份声明可比的自有计数（Web 全量注释）
    则由本模块独立枚举受管源码范围复算，缩范围或编造数字同样被拒绝。
    性能预算另按受控预算文件复核：结论未通过、采用的预算不是仓库内那一份、实测场景数
    与受控预算对不上、构件绑定不是本次发布的提交，或**预算尚未获有权者批准**，都在这里
    直接拒绝发布证据。

    Args:
        directory: 发布检查写入证据的目录，缺失即拒绝。
        counts: 四个必需作业上报的正整数用例数。
        revision: 本次验证的提交标识。
    Returns:
        只包含文件名、提交标识、实测文件数、检查名与受控预算依据的可公开发布证据摘要。
    Raises:
        ValueError: 缺少证据目录或文件、阶段/范围/阈值不符、检查未通过、计数不一致、
            受管范围无法复算、性能预算未通过或未获批准，或提交不匹配。
    """
    if not isinstance(directory, Path) or not directory.is_dir():
        raise ValueError("发布阶段缺少真实发布证据目录")
    if not isinstance(revision, str) or not REVISION_TEXT.fullmatch(revision):
        raise ValueError("发布验证没有绑定本次提交标识")
    released: dict[str, object] = {}
    for job, spec in RELEASE_JOBS.items():
        coverage = coverage_document(directory, spec["coverage_file"], spec["coverage_kind"])
        checks, declared = release_manifest(directory, spec["evidence"], job, revision)
        coverage_declaration(declared, job, spec, coverage)
        # 性能预算：结论已由 perf_budget.py 在真实测量后给出，这里只复核，不重测。
        # 复核包含「这份预算是否已获批准」与「读数是否绑定本次发布的提交」，因此预算
        # 处于提案状态、或证据来自别的提交时本函数直接拒绝，不会因为作业成功或检查项
        # 存在就签发发布结论。
        performance = (perf_budget_document(directory, job, revision)
                       if job in RELEASE_PERF_EVIDENCE else None)
        # 自有计数没有第二份声明可比（既不是作业用例数，也不是覆盖率实测文件数）：
        # 这里独立枚举受管范围复算一次，声明值与真实范围不符一律拒绝。
        own_checks = [check for check, mode in RELEASE_CHECKS[job].items() if mode == "own_count"]
        if own_checks:
            try:
                own_scope = managed_web_files(ROOT)
            except (CheckError, OSError, ValueError) as error:
                raise ValueError("无法独立复算纳管 Web 源码范围") from error
        for check, mode in RELEASE_CHECKS[job].items():
            if mode == "no_count":
                continue
            if mode == "own_count":
                if checks[check]["checked"] != own_scope:
                    raise ValueError(
                        f"发布检查计数与汇总独立复算的受管范围不一致：{job}/{check}"
                        f"（声明 {checks[check]['checked']}，实测 {own_scope}）"
                    )
                continue
            if mode == "perf_count":
                # 实测场景数同样没有第二份声明可比（既不是作业用例数，也不是覆盖率
                # 实测文件数）：按受控预算文件复算，证据少报场景同样被拒绝。
                if performance is None or checks[check]["checked"] != performance["checked"]:
                    raise ValueError(
                        f"发布检查计数与受控预算复算的实测场景数不一致：{job}/{check}"
                        f"（声明 {checks[check]['checked']}，"
                        f"复算 {performance['checked'] if performance else '无性能预算证据'}）"
                    )
                continue
            expected = counts[job] if mode == "job_count" else coverage["measured_files"]
            if checks[check]["checked"] != expected:
                raise ValueError(f"发布检查计数与真实结果不一致：{job}/{check}")
        released[job] = {"evidence": spec["evidence"], "coverage": spec["coverage_file"],
                         "measured_files": coverage["measured_files"], "checks": sorted(RELEASE_CHECKS[job]),
                         "static": {"objects": coverage["static_analysis"]["objects"],
                                    "tools": sorted(item["name"] for item in coverage["static_analysis"]["tools"])}}
        if performance is not None:
            released[job]["performance"] = performance
    return {"directory": str(directory), "revision": revision, "jobs": released}


def managed_java_files(root: Path) -> set[str]:
    """独立枚举纳管 Java 源码，用于核对来源报告的扫描范围是否漏项。

    Args:
        root: 待检查仓库根目录。
    Returns:
        仓库相对路径集合；枚举失败时抛出 ``ValueError``。
    Raises:
        ValueError: 目录不可读或布局规则无法加载。
    """

    from scripts.common.repository_layout import is_java_source

    try:
        files = {
            path.relative_to(root).as_posix()
            for path in root.rglob("*.java")
            if path.is_file()
        }
    except OSError as error:
        raise ValueError(f"无法枚举纳管 Java 源码：{root}") from error
    return {name for name in files if is_java_source(name)}


def load_source_index(index: Path) -> tuple[dict[str, dict[str, object]], str]:
    """独立读取受控来源索引，返回 ``local_path`` 记录映射与文件指纹。

    Args:
        index: 索引文件路径。
    Returns:
        记录映射与索引原始字节的 SHA-256。
    Raises:
        ValueError: 文件缺失、不是合法 JSON 对象、未声明派生 schema 或记录结构异常。
    """

    if not index.is_file():
        raise ValueError(f"缺少受控来源索引：{index}")
    raw = index.read_bytes()
    try:
        document = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeError) as error:
        raise ValueError(f"受控来源索引不是可读的 JSON：{index}") from error
    if not isinstance(document, dict) or document.get("index_schema") != "d12-source-index/v1":
        raise ValueError("受控来源索引没有声明 d12-source-index/v1 schema")
    records = document.get("records")
    if not isinstance(records, list) or not records:
        raise ValueError("受控来源索引没有记录")
    mapped: dict[str, dict[str, object]] = {}
    for record in records:
        if not isinstance(record, dict) or not str(record.get("local_path", "")).strip():
            raise ValueError("受控来源索引记录缺少 local_path")
        mapped[str(record["local_path"])] = record
    return mapped, hashlib.sha256(raw).hexdigest()


def source_blockers_from_index(
    root: Path, index: Path
) -> tuple[list[dict[str, object]], dict[str, object]]:
    """没有报告时按索引独立推导适用阻断，供非发布阶段如实呈现（裁决 D15 §78）。

    Args:
        root: 待检查仓库根目录。
        index: 受控来源索引路径。
    Returns:
        适用阻断摘要列表与该索引的指纹摘要。
    Raises:
        ValueError: 索引不可读或结构不符。
    """

    records, digest = load_source_index(index)
    blockers: list[dict[str, object]] = []
    for path, record in sorted(records.items()):
        verdict = str(record.get("d12_verdict") or "").strip()
        if verdict in SOURCE_ACCEPTED_VERDICTS:
            continue
        if not (root / path).is_file():
            continue
        blockers.append(
            {
                "record_id": path,
                "path": path,
                "form": "来源说明" if str(record.get("evidence_points") or "").strip() else "作者标签",
                "classification": "registered-blocker",
                "verdict": verdict,
                "blocker_reason": str(record.get("d12_blocker_reason") or ""),
                "open_gap": str(record.get("open_gap") or ""),
            }
        )
    return blockers, {"registry": str(index), "registry_sha256": digest, "records": len(records)}


def source_acceptance(
    report_path: Path | None,
    root: Path,
    revision: str | None,
) -> dict[str, object]:
    """取回并独立复核来源验收报告（裁决 D15 §69/§80/§82）。

    Args:
        report_path: 本次来源验收报告路径；为 ``None`` 时按索引独立推导。
        root: 待检查仓库根目录。
        revision: 本次验证的提交标识。
    Returns:
        含来源、账本指纹、计数、逐项阻断与结论的来源验收摘要。
    Raises:
        ValueError: 报告缺失、schema/协议不符、提交或规则指纹不符、账本指纹不符、
            范围漏项、计数不一致或复算不一致。
    """

    index = root / SOURCE_INDEX_DEFAULT
    if report_path is None:
        blockers, registry_info = source_blockers_from_index(root, index)
        return {
            "source": "index",
            "report": None,
            "status": "blocked" if blockers else "passed",
            "registry": registry_info,
            "counts": {"registered_blockers": 0, "hard_failures": 0, "uncovered_records": 0},
            "registered_blockers": [],
            "hard_failures": [],
            "uncovered_records": [],
            "index_blockers": len(blockers),
            "applicable_blockers": len(blockers),
        }
    if not report_path.is_file():
        raise ValueError(f"缺少来源验收报告：{report_path}")
    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"来源验收报告不是可读的 JSON：{report_path}") from error
    if not isinstance(report, dict) or report.get("protocol") != SOURCE_PROTOCOL:
        raise ValueError("来源验收报告的协议版本不正确")
    if report.get("check") != "Java 注释（全量）":
        raise ValueError("来源验收报告不是全量 Java 注释检查的结果")
    acceptance = report.get("acceptance")
    if not isinstance(acceptance, dict) or acceptance.get("schema") != SOURCE_REPORT_SCHEMA:
        raise ValueError("来源验收报告的 schema 不正确")
    if not isinstance(revision, str) or not REVISION_TEXT.fullmatch(revision):
        raise ValueError("来源验收复核没有绑定本次提交标识")
    if report.get("revision") != revision:
        raise ValueError("来源验收报告绑定的提交与本次验证不一致")
    scanner = report.get("scanner")
    if not isinstance(scanner, dict):
        raise ValueError("来源验收报告缺少规则实现指纹")
    scanner_path = str(scanner.get("path", "")).strip()
    if scanner_path != "scripts/code/java/check_staged_java_comments.py":
        raise ValueError(f"来源验收报告的规则实现路径不正确：{scanner_path or '空'}")
    # 规则指纹绑定本工具所属仓库的当前实现：报告必须由当前规则产出，不能用旧规则结论。
    implementation = SOURCE_ROOT / scanner_path
    if not implementation.is_file():
        raise ValueError("来源验收报告声明的规则实现不存在")
    if hashlib.sha256(implementation.read_bytes()).hexdigest() != str(
        scanner.get("sha256", "")
    ).lower():
        raise ValueError("来源验收报告的规则实现指纹与当前规则不一致")
    records, digest = load_source_index(index)
    evidence = report.get("evidence")
    if not isinstance(evidence, dict):
        raise ValueError("来源验收报告缺少账本指纹")
    if Path(str(evidence.get("registry", ""))).resolve() != index.resolve():
        raise ValueError("来源验收报告采用的账本不是仓库内受控索引")
    if str(evidence.get("registry_sha256", "")).lower() != digest:
        raise ValueError("来源验收报告的账本指纹与当前索引不一致")
    if int(evidence.get("records", -1)) != len(records):
        raise ValueError("来源验收报告的账本记录数与当前索引不一致")
    if acceptance.get("index_schema") != "d12-source-index/v1":
        raise ValueError("来源验收报告没有声明受控派生索引 schema")
    scope = acceptance.get("scope")
    if not isinstance(scope, dict) or not isinstance(scope.get("files"), list):
        raise ValueError("来源验收报告缺少扫描范围清单")
    declared_scope = {str(item) for item in scope["files"]}
    expected_scope = managed_java_files(root)
    if declared_scope != expected_scope:
        raise ValueError(
            "来源验收报告的扫描范围与当前纳管 Java 源码不一致："
            f"报告 {len(declared_scope)} 个，实测 {len(expected_scope)} 个"
        )
    counts = acceptance.get("counts")
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
            raise ValueError(f"来源验收报告的 {name} 必须是数组")
    if not isinstance(counts, dict):
        raise ValueError("来源验收报告缺少逐项计数")
    expected_counts = {
        "scanned_files": len(declared_scope),
        "accepted": len(accepted),
        "registered_blockers": len(blockers),
        "hard_failures": len(hard),
        "uncovered_records": len(uncovered),
    }
    if any(counts.get(key) != value for key, value in expected_counts.items()):
        raise ValueError("来源验收报告的计数与逐项清单长度不一致")
    if int(report.get("checked", -1)) != len(declared_scope):
        raise ValueError("来源验收报告的 checked 与扫描范围不一致")
    if acceptance.get("revision") != revision:
        raise ValueError("来源验收报告的验收段没有绑定本次提交")
    # 独立复算：按 (文件, 类型) 唯一键把非验收记录集合与阻断/硬失败/已验收三张清单做
    # 双向对账。按文件折叠会让同一文件里的嵌套类型漏报不被发现，也会让重复条目与跨
    # 清单互斥失效；“少报一条 + 同步改计数”在这里同样因双向差集而被拒。
    all_keys = ledger_expected_keys(records, None)
    expected_blocked = {
        key: verdict
        for key, verdict in all_keys.items()
        if verdict not in SOURCE_ACCEPTED_VERDICTS
    }
    covered: set[tuple[str, str]] = set()
    declared_in: dict[tuple[str, str], str] = {}
    for label, items in (("阻断", blockers), ("硬失败", hard), ("已验收", accepted)):
        for item in items:
            key = ledger_entry_key(item, f"来源验收报告的{label}条目")
            path = key[0]
            record = records.get(path)
            if record is None:
                raise ValueError(f"来源验收报告引用了索引中不存在的对象：{path}")
            if key not in all_keys:
                raise ValueError(
                    f"来源验收报告的{label}条目在索引中没有对应的（文件,类型）唯一键："
                    f"{path}#{key[1]}"
                )
            if key in declared_in:
                raise ValueError(
                    f"同一个对象不能同时出现在{declared_in[key]}与{label}清单："
                    f"{path}#{key[1]}"
                )
            declared_in[key] = label
            if label != "已验收":
                covered.add(key)
            if label == "已验收":
                if (
                    str(record.get("d12_verdict") or "").strip()
                    not in SOURCE_ACCEPTED_VERDICTS
                ):
                    raise ValueError(f"索引未验收的记录不能出现在已验收清单：{path}")
                continue
            verdict = str(record.get("d12_verdict") or "").strip()
            if verdict not in known_source_verdicts():
                raise ValueError(
                    f"来源验收索引的判词不在已定义判词集合内：{path}：{verdict or '空'}"
                )
            if verdict in SOURCE_ACCEPTED_VERDICTS:
                raise ValueError(f"索引已验收的记录不能出现在阻断清单：{path}")
            if str(item.get("verdict") or "") != verdict:
                raise ValueError(f"来源验收报告的逐项判词与当前索引不一致：{path}")
            if not str(item.get("blocker_reason") or "").strip():
                raise ValueError(f"来源验收报告的阻断条目缺少原因：{path}")
            if not str(item.get("open_gap") or "").strip():
                raise ValueError(f"来源验收报告的阻断条目缺少缺口：{path}")
            source = root / path
            if not source.is_file():
                raise ValueError(f"来源验收报告的阻断条目指向不存在的对象：{path}")
            if hashlib.sha256(source.read_bytes()).hexdigest() != str(
                item.get("local_sha256", "")
            ).lower():
                raise ValueError(f"来源验收报告的最终对象指纹与当前文件不符：{path}")
    missing = sorted(key for key in expected_blocked if key not in covered)
    extra = sorted(key for key in covered if key not in expected_blocked)
    if missing or extra:
        shown_missing = f"{missing[0][0]}#{missing[0][1]}" if missing else "无"
        shown_extra = f"{extra[0][0]}#{extra[0][1]}" if extra else "无"
        raise ValueError(
            "来源验收报告的阻断清单与索引复算不一致："
            f"漏项 {shown_missing}，多余 {shown_extra}"
        )
    if uncovered:
        raise ValueError("来源验收报告存在未覆盖的索引记录，范围漏项不能按空集合降级")
    blocking = len(blockers) + len(hard)
    return {
        "source": "report",
        "report": str(report_path),
        "status": "blocked" if blocking else "passed",
        "registry": dict(evidence),
        "scope_files": len(declared_scope),
        "counts": {
            "accepted": len(accepted),
            "registered_blockers": len(blockers),
            "hard_failures": len(hard),
            "uncovered_records": len(uncovered),
        },
        "registered_blockers": [_source_brief(item) for item in blockers],
        "hard_failures": [_source_brief(item) for item in hard],
        "uncovered_records": list(uncovered),
        "applicable_blockers": blocking,
    }


def _source_brief(item: object) -> dict[str, object]:
    """取出逐项来源状态的摘要，不含任何源码正文。"""

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


def aggregate(
    needs: object,
    stage: str,
    evidence: Path | None = None,
    revision: str | None = None,
    *,
    source_report: Path | None = None,
    source_root: Path | None = None,
    maintenance: bool = False,
) -> dict[str, object]:
    """验证全部固定作业实际成功且有正整数用例，发布阶段还必须有真实发布证据。

    Args:
        needs: GitHub needs 上下文的 JSON 对象，不执行其中任何值。
        stage: 本次入口的固定验证阶段。
        evidence: release 阶段由真实发布检查写出的证据目录；其他阶段忽略。
        revision: 本次验证的提交标识；release 阶段必须提供并与证据一致。
        source_report: 本次来源验收报告路径；release 阶段必须存在。
        source_root: 来源报告与被扫描 Java 源码所在的仓库根目录。
        maintenance: 是否显式选择维护模式。维护模式不改变 release 的拒绝语义。
    Returns:
        可公开的阶段、状态、用例数、来源验收摘要及发布证据摘要，不含环境或测试正文。
    Raises:
        ValueError: 作业缺失、额外作业、失败、跳过、零用例、outputs 非字典、阶段不一致、
            缺少真实发布证据，或来源验收报告缺失/不可复核。
    """
    if stage not in STAGES or not isinstance(needs, dict) or set(needs) != JOBS:
        raise ValueError("阶段或必需作业集合不正确")
    counts: dict[str, int] = {}
    for name in sorted(JOBS):
        result = needs[name]
        if not isinstance(result, dict) or result.get("result") != "success":
            raise ValueError(f"必需作业未成功：{name}")
        # outputs 由上游 job 的 $GITHUB_OUTPUT 生成，类型不受本函数控制；
        # 非字典必须在取值前显式拒绝，否则后续 .get 会抛出未捕获的 AttributeError。
        outputs = result.get("outputs")
        if not isinstance(outputs, dict):
            raise ValueError(f"作业没有本阶段实际验证计数：{name}")
        count = outputs.get("checked")
        if outputs.get("stage") != stage or not isinstance(count, str) or not re.fullmatch(r"[1-9][0-9]*", count):
            raise ValueError(f"作业没有本阶段实际验证计数：{name}")
        counts[name] = int(count)
    # 发布结论只能来自真实发布检查产出的证据；标签匹配不构成发布证据。
    released = release_evidence(evidence, counts, revision) if stage == "release" else None
    root = source_root if source_root is not None else SOURCE_ROOT
    if source_report is None and isinstance(evidence, Path):
        # 发布作业把来源验收报告与发布证据一起上传到同一目录；缺失即视为没有本次报告。
        candidate = evidence / SOURCE_REPORT_NAME
        source_report = candidate if candidate.is_file() else None
    if stage == "release":
        # 发布必须取回本次来源验收报告；无报告、旧提交或不可复核一律受控失败，
        # 不能用默认 0、空集合或作业成功代替本次来源验收。
        if source_report is None:
            raise ValueError(
                "发布阶段缺少来源验收报告（source-acceptance-report/v1）；"
                "作业成功与阶段标签都不能代替来源验收"
            )
        acceptance = source_acceptance(source_report, root, revision)
    elif source_report is not None:
        acceptance = source_acceptance(source_report, root, revision)
    else:
        acceptance = source_acceptance(None, root, revision)
    blocking = int(acceptance.get("applicable_blockers", 0))
    if blocking:
        # 存在适用阻断时不得转绿：维护模式只允许非发布汇总退出 0，release 仍必须退出 1。
        status = (
            "blocked"
            if stage == "release" or not maintenance
            else "completed-with-registered-blockers"
        )
    else:
        status = "passed"
    release_verified = released is not None and not blocking
    return {
        "schema": "ci-summary/v1",
        "stage": stage,
        "status": status,
        "tests": counts,
        "release_verified": release_verified,
        "release_evidence": released,
        "source_acceptance": acceptance,
        "exit_code": 1 if (stage == "release" and blocking) or (blocking and not maintenance) else 0,
    }


def reports(paths: list[Path], required: set[str]) -> dict[str, object]:
    """消费 JUnit/Surefire 叶用例与汇总，阻断零计数、重复、跳过和关键类遗漏。

    Args:
        paths: 本次命令新产生的报告文件，调用者负责清理或使用全新输出位置。
        required: 必须实际执行的 Java 测试类简称集合。
    Returns:
        只包含报告路径、实际用例数量及类名的可公开摘要。
    Raises:
        ValueError: XML 不可信、声明计数与真实用例不符、未通过或必需类缺失。
        OSError: 报告无法读取。
    """
    if not paths or len(set(paths)) != len(paths):
        raise ValueError("报告为空或路径重复")
    seen: set[tuple[str, str]] = set()
    classes: set[str] = set()
    count = 0
    for path in sorted(paths):
        try:
            document = ET.fromstring(path.read_bytes())
        except ET.ParseError as error:
            raise ValueError("测试报告不是有效 XML") from error
        if document.tag not in {"testsuite", "testsuites"}:
            raise ValueError("测试报告根节点不正确")
        suites = list(document.iter("testsuite"))
        if not suites:
            raise ValueError("测试报告没有套件")
        for suite in suites:
            children = list(suite.iter("testcase"))
            for key in ("tests", "failures", "errors", "skipped"):
                raw = suite.get(key, "0" if key != "tests" else "")
                if not re.fullmatch(r"[0-9]+", raw) or int(raw) != (len(children) if key == "tests" else 0):
                    raise ValueError("报告汇总与实际用例不符或存在失败/跳过")
            # 嵌套 suite 只在最内层收集，外层仍核对其完整计数。
            if suite.findall("testsuite"):
                continue
            if not children:
                raise ValueError("测试套件没有实际用例")
            for case in children:
                identity = (case.get("classname", ""), case.get("name", ""))
                if not identity[1] or identity in seen or any(case.find(tag) is not None for tag in ("failure", "error", "skipped")):
                    raise ValueError("用例重名、无名称、失败或被跳过")
                seen.add(identity)
                classes.add(identity[0].rsplit(".", 1)[-1])
                count += 1
    if not count or not required.issubset(classes):
        raise ValueError("没有实际用例或缺少必需真实集成测试类")
    return {"schema": "ci-tests/v1", "checked": count, "reports": [str(p) for p in paths],
            "required_classes": sorted(required), "status": "passed"}


def main() -> int:
    """从固定环境消费 needs 或报告；失败只输出结构错误，不泄露测试正文。

    存在适用来源阻断时仍然输出完整汇总（含 ``release_verified=false`` 与逐项阻断），
    但退出码为非零；报告缺失或不可复核时按受控失败退出，不输出成功结论。
    """

    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    sub = parser.add_subparsers(dest="command", required=True)
    final = sub.add_parser("aggregate")
    final.add_argument("--stage", choices=sorted(STAGES), required=True)
    final.add_argument("--release-evidence", type=Path, help="发布检查实际写出的证据目录")
    final.add_argument("--revision", help="本次验证的提交标识，缺省取 CI_REVISION")
    final.add_argument("--source-report", type=Path, help="本次来源验收报告（source-acceptance-report/v1）")
    final.add_argument("--source-root", type=Path, help="被扫描的仓库根目录；缺省取本工具所属仓库")
    final.add_argument(
        "--maintenance",
        action="store_true",
        help="显式维护模式：非发布阶段可退出 0，但状态明示存在已登记阻断且 release_verified=false",
    )
    report = sub.add_parser("reports")
    report.add_argument("--path", type=Path, action="append", default=[])
    report.add_argument("--backend", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "aggregate":
            directory = args.release_evidence
            if directory is None and (value := os.environ.get("RELEASE_EVIDENCE")):
                directory = Path(value)
            revision = args.revision or os.environ.get("CI_REVISION") or None
            source_report = args.source_report
            if source_report is None and (value := os.environ.get("SOURCE_ACCEPTANCE_REPORT")):
                source_report = Path(value)
            if source_report is None and directory is not None:
                candidate = directory / SOURCE_REPORT_NAME
                source_report = candidate if candidate.is_file() else None
            result = aggregate(
                json.loads(os.environ.get("NEEDS_JSON", "null")),
                args.stage,
                directory,
                revision,
                source_report=source_report,
                source_root=args.source_root,
                maintenance=args.maintenance,
            )
        else:
            paths = args.path + (list(args.backend.glob("**/target/surefire-reports/TEST-*.xml")) if args.backend else [])
            result = reports(paths, BACKEND_REQUIRED if args.backend else set())
            if output := os.environ.get("GITHUB_OUTPUT"):
                with Path(output).open("a", encoding="utf-8") as stream:
                    stream.write(f"checked={result['checked']}\n")
        print(json.dumps(result, ensure_ascii=False))
        if args.command == "aggregate":
            return int(result.get("exit_code", 0))
        return 0
    except (OSError, ValueError, TypeError, CheckError) as error:
        print(
            "CI 证据核对失败：必需作业或真实测试未完整成功；"
            f"来源验收与发布证据必须可复核（{type(error).__name__}: {error}）。",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
