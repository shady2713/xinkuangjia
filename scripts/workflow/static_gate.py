"""执行并核验发布阶段的真实静态检查，产出可独立复核的证据。

后端核验 Maven PMD check 真实写出的各模块 target/pmd.xml：要求报告存在、晚于生产
源码、工具版本一致、只引用本模块源码且零违规。前端用与 `pnpm lint` 相同的 ESLint、
Prettier、Stylelint 真实命令执行检查，读取 ESLint JSON 报告并记录逐工具退出码、
版本与输出指纹。缺失报告、旧报告、跳过状态、零检查对象、范围不符和任何真实违规
都受控失败，调用方不能用一个写死的 passed 字段绕过真实执行与真实报告。

用法：
    python -B -X utf8 scripts/workflow/static_gate.py --kind backend [--json]
    python -B -X utf8 scripts/workflow/static_gate.py --kind web --execute [--evidence 路径]

@author DeepSeek
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.common.quality_common import DEFAULT_ROOT, CheckError, run_process

# 证据结构必须与 scripts/workflow/ci_gate.py 的发布汇总校验保持一致。
SCHEMA = "static-analysis/v1"
BACKEND = Path("后端代码/basic-framework-boot")
FRONTEND = Path("前端代码/basic-framework-admin")
BACKEND_POM = BACKEND / "pom.xml"
PMD_RULESET = BACKEND / "config/pmd/basic-framework-ruleset.xml"
PMD_NAMESPACE = "http://pmd.sourceforge.net/report/2.0.0"
PMD_COMMAND = ("mvn", "-B", "-ntp", "-Pquality-audit", "verify")
DEFAULT_ESLINT_REPORT = FRONTEND / ".cache/quality-static/eslint-report.json"
DEFAULT_WEB_EVIDENCE = FRONTEND / ".cache/quality-static/static-analysis-web.json"
WEB_TOOLS = ("eslint", "prettier", "stylelint")
# 三条命令与前端既有 `pnpm lint`（vsh lint）一致；这里直接调用仓库内已安装的入口，
# 避免 Windows 下 .cmd 包装器需要 Shell 才能启动。
WEB_COMMANDS = {
    "eslint": ("node_modules/eslint/bin/eslint.js", ".", "--format", "json"),
    "prettier": ("node_modules/prettier/bin/prettier.cjs", ".", "--ignore-unknown", "--check"),
    "stylelint": ("node_modules/stylelint/bin/stylelint.mjs", "**/*.{vue,css,less,scss}"),
}
WEB_TIMEOUTS = {"eslint": 1800.0, "prettier": 600.0, "stylelint": 900.0}
WEB_CONFIG_FILES = ("eslint.config.mjs", ".prettierrc.mjs", "stylelint.config.mjs", ".prettierignore")
CONFIG_EXTENSIONS = frozenset({".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json"})
PRETTIER_WARNING = re.compile(r"^\[warn\] (.+)$", re.MULTILINE)
STYLELINT_PROBLEMS = re.compile(r"(\d+) problems?")


class StaticEvidenceError(CheckError):
    """表示静态证据缺失、过期、越界或不可核验，退出码为 2。"""


class StaticViolationError(RuntimeError):
    """表示真实静态检查存在违规或检查未执行，退出码为 1。"""


def digest(path: Path) -> str:
    """计算文件内容的 SHA-256，把证据绑定到真实报告与配置。

    Args:
        path: 已存在的普通文件。
    Returns:
        64 位小写十六进制摘要。
    Raises:
        OSError: 文件缺失、是目录或不可读。
    """
    return hashlib.sha256(path.read_bytes()).hexdigest()


def repository_path(root: Path, path: Path) -> str:
    """把仓库内路径表示为相对 POSIX 路径，供证据公开且不泄露机器目录。

    Args:
        root: 仓库根目录。
        path: 仓库内文件或目录。
    Returns:
        相对根目录的 POSIX 路径。
    Raises:
        ValueError: 解析后的路径越过仓库边界。
    """
    resolved, base = path.resolve(), root.resolve()
    if not resolved.is_relative_to(base):
        raise ValueError(f"路径越过仓库边界：{path}")
    return resolved.relative_to(base).as_posix()


def production_modules(root: Path, module: Path | None = None) -> list[Path]:
    """枚举存在手写生产源码的后端 Maven 模块，作为 PMD 的独立对象清单。

    Args:
        root: 仓库根目录。
        module: 可选的单个模块目录；省略时覆盖整个后端 reactor。
    Returns:
        按路径排序、含 src/main/java 的模块目录；指定模块没有源码时返回空列表。
    Raises:
        ValueError: 指定模块不在后端工程内。
    """
    backend = (root / BACKEND).resolve()
    if module is not None:
        current = module.resolve()
        if not current.is_relative_to(backend):
            raise ValueError("模块必须位于后端工程内")
        return [current] if (current / "src/main/java").is_dir() else []
    return sorted({path.parents[2] for path in backend.rglob("src/main/java") if path.is_dir()
                   and "target" not in path.relative_to(backend).parts})


def production_sources(module: Path) -> list[Path]:
    """枚举模块 target 之外的手写生产 Java 源码，不把生成物计入分母。

    Args:
        module: 含 src/main/java 的 Maven 模块目录。
    Returns:
        按路径排序的 .java 文件列表。
    """
    return sorted((module / "src/main/java").rglob("*.java"))


def backend_configs(root: Path) -> list[Path]:
    """列出决定 PMD 结论的配置：规则集与绑定它的父 POM。

    Args:
        root: 仓库根目录。
    Returns:
        存在的配置文件列表，顺序固定。
    Raises:
        StaticEvidenceError: 任一配置文件缺失，此时无法解释报告来源。
    """
    targets = [root / PMD_RULESET, root / BACKEND_POM]
    missing = [repository_path(root, path) for path in targets if not path.is_file()]
    if missing:
        raise StaticEvidenceError(f"缺少 PMD 规则绑定配置：{'、'.join(missing)}")
    return targets


def web_configs(root: Path) -> list[Path]:
    """列出决定前端 lint 结论的配置：三条规则的根配置与共享规则源码。

    Args:
        root: 仓库根目录。
    Returns:
        按路径排序的配置文件列表。
    Raises:
        StaticEvidenceError: 根目录任一规则配置缺失。
    """
    frontend = (root / FRONTEND).resolve()
    targets = [frontend / name for name in WEB_CONFIG_FILES]
    missing = [name for name, path in zip(WEB_CONFIG_FILES, targets, strict=True) if not path.is_file()]
    if missing:
        raise StaticEvidenceError(f"缺少前端静态检查配置：{'、'.join(missing)}")
    config_root = frontend / "internal/lint-configs"
    for folder, directories, filenames in sorted(os.walk(config_root, followlinks=False)):
        directories[:] = [name for name in directories if name not in {"node_modules", "dist", ".turbo"}]
        for filename in sorted(filenames):
            path = Path(folder) / filename
            if path.suffix in CONFIG_EXTENSIONS:
                targets.append(path)
    return sorted(targets)


def pmd_module_record(root: Path, module: Path) -> dict[str, object]:
    """核验单个模块真实 PMD 报告的存在性、来源范围、时效与零违规。

    Args:
        root: 仓库根目录。
        module: 含生产源码的 Maven 模块目录。
    Returns:
        可公开的模块记录：报告路径与指纹、源码数、PMD 版本与执行时间。
    Raises:
        StaticEvidenceError: 报告缺失、结构不符、引用越界源码或早于生产源码。
        StaticViolationError: 报告包含真实违规。
    """
    sources = production_sources(module)
    if not sources:
        raise StaticEvidenceError(f"模块没有生产源码，无法核验 PMD 范围：{repository_path(root, module)}")
    report = module / "target/pmd.xml"
    if not report.is_file():
        raise StaticEvidenceError(f"缺少 PMD 报告：{repository_path(root, report)}")
    try:
        document = ET.fromstring(report.read_bytes())
    except (ET.ParseError, OSError) as error:
        raise StaticEvidenceError(f"PMD 报告不是有效 XML：{repository_path(root, report)}") from error
    if document.tag != f"{{{PMD_NAMESPACE}}}pmd":
        raise StaticEvidenceError(f"PMD 报告根节点不正确：{repository_path(root, report)}")
    version = (document.get("version") or "").strip()
    timestamp = (document.get("timestamp") or "").strip()
    if not version or not timestamp:
        raise StaticEvidenceError("PMD 报告缺少工具版本或执行时间，无法证明本次真实执行")
    allowed = (module / "src/main/java").resolve()
    for node in list(document.iter(f"{{{PMD_NAMESPACE}}}file")) + list(document.iter(f"{{{PMD_NAMESPACE}}}suppressedviolation")):
        referenced = node.get("name") or node.get("filename") or ""
        target = Path(referenced)
        if not referenced or not target.is_absolute() or not target.resolve().is_relative_to(allowed):
            raise StaticEvidenceError(f"PMD 报告引用了本模块源码之外的对象：{referenced or '<空>'}")
    violations: list[dict[str, str]] = []
    # PMD 7 的违规挂在 <file name="..."> 下，文件名在父节点、规则名在违规自身的 rule 属性。
    for file_node in document.iter(f"{{{PMD_NAMESPACE}}}file"):
        location = file_node.get("name") or ""
        for node in file_node.findall(f"{{{PMD_NAMESPACE}}}violation"):
            violations.append({"file": location, "rule": node.get("rule") or "",
                               "beginline": node.get("beginline") or "", "priority": node.get("priority") or ""})
    if violations:
        first = violations[0]
        raise StaticViolationError(
            f"PMD 存在 {len(violations)} 项违规，首个：{first['rule']} {first['file']}:{first['beginline']}"
        )
    newest = max(path.stat().st_mtime_ns for path in sources)
    if report.stat().st_mtime_ns < newest:
        raise StaticEvidenceError(f"PMD 报告早于生产源码，属于旧报告：{repository_path(root, report)}")
    suppressed = list(document.iter(f"{{{PMD_NAMESPACE}}}suppressedviolation"))
    return {"module": repository_path(root, module), "report": repository_path(root, report),
            "sha256": digest(report), "sources": len(sources), "violations": 0,
            "suppressed": len(suppressed), "pmd_version": version, "timestamp": timestamp}


def verify_backend(root: Path, stage: str, module: Path | None = None) -> dict[str, object]:
    """汇总全部在范围模块的 PMD 核验结果，生成后端静态检查证据段。

    Args:
        root: 仓库根目录。
        stage: 本次裁决阶段，release 或 full。
        module: 可选的单个模块目录；省略时覆盖整个后端 reactor。
    Returns:
        含工具、配置指纹、真实报告清单和独立源码对象的证据段；模块无源码时
        status 为 not-applicable，调用方不得当作通过。
    Raises:
        StaticEvidenceError: 报告缺失、过期、越界、版本不一致或配置缺失。
        StaticViolationError: 任何模块存在真实违规。
    """
    modules = production_modules(root, module)
    if not modules:
        return {"schema": SCHEMA, "kind": "backend", "stage": stage, "status": "not-applicable",
                "code": 1, "executed": True, "skipped": False, "objects": 0, "violations": 0,
                "tools": [{"name": "pmd", "version": "", "status": "not-applicable",
                           "command": " ".join(PMD_COMMAND), "exit_code": None}],
                "config": [], "reports": [], "modules": []}
    records = [pmd_module_record(root, current) for current in modules]
    versions = {record["pmd_version"] for record in records}
    if len(versions) != 1:
        raise StaticEvidenceError(f"各模块 PMD 版本不一致：{'、'.join(sorted(versions))}")
    configs = backend_configs(root)
    objects = sum(int(record["sources"]) for record in records)
    return {"schema": SCHEMA, "kind": "backend", "stage": stage, "status": "passed", "code": 0,
            "executed": True, "skipped": False, "objects": objects, "violations": 0,
            "tools": [{"name": "pmd", "version": records[0]["pmd_version"], "status": "passed",
                       "command": " ".join(PMD_COMMAND), "exit_code": 0}],
            "config": [{"path": repository_path(root, path), "sha256": digest(path)} for path in configs],
            "reports": [{"kind": "pmd", "path": record["report"], "sha256": record["sha256"]} for record in records],
            "modules": records}


def run_web_tool(name: str, frontend: Path, report: Path | None) -> dict[str, object]:
    """真实执行一条前端静态检查命令，记录退出码、版本和输出指纹。

    Args:
        name: eslint、prettier 或 stylelint。
        frontend: 管理前端根目录。
        report: ESLint JSON 报告输出路径；其他工具不需要。
    Returns:
        工具记录：命令、版本、退出码与标准流指纹。
    Raises:
        StaticEvidenceError: Node.js 或仓库内工具入口缺失、执行超时。
    """
    node = shutil.which("node")
    if not node:
        raise StaticEvidenceError("缺少 Node.js，无法执行前端静态检查")
    entry = frontend / WEB_COMMANDS[name][0]
    if not entry.is_file():
        raise StaticEvidenceError(f"缺少前端工具入口：{WEB_COMMANDS[name][0]}")
    arguments = [node, str(entry), *WEB_COMMANDS[name][1:]]
    if name == "eslint":
        report.parent.mkdir(parents=True, exist_ok=True)
        arguments.extend(["--output-file", str(report)])
    try:
        version = run_process([node, str(entry), "--version"], frontend, timeout=120)
        result = run_process(arguments, frontend, timeout=WEB_TIMEOUTS[name])
    except CheckError as error:
        raise StaticEvidenceError(f"{name} 无法完成真实执行：{error}") from error
    return {"name": name, "command": " ".join(WEB_COMMANDS[name]), "version": version.stdout.decode("utf-8", "replace").strip(),
            "exit_code": result.code, "stdout_sha256": hashlib.sha256(result.stdout).hexdigest(),
            "stderr_sha256": hashlib.sha256(result.stderr).hexdigest(),
            "stdout": result.stdout.decode("utf-8", "replace"), "stderr": result.stderr.decode("utf-8", "replace")}


def parse_eslint_report(report: Path, workspace: Path) -> dict[str, int]:
    """解析 ESLint JSON 报告并统计文件数、错误、警告与致命错误。

    Args:
        report: eslint --format json 真实写出的报告文件。
        workspace: 报告文件路径必须落在该工作区内。
    Returns:
        含 files、errors、warnings、fatal 的计数字典。
    Raises:
        StaticEvidenceError: 报告缺失、不是对象数组、路径越界或计数不合法。
    """
    if not report.is_file():
        raise StaticEvidenceError(f"缺少 ESLint JSON 报告：{report}")
    try:
        data = json.loads(report.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise StaticEvidenceError("ESLint 报告不是可读 JSON") from error
    if not isinstance(data, list) or not data:
        raise StaticEvidenceError("ESLint 报告为空，不能证明实际检查了文件")
    counts = {"files": 0, "errors": 0, "warnings": 0, "fatal": 0}
    for item in data:
        if not isinstance(item, dict):
            raise StaticEvidenceError("ESLint 报告条目必须是对象")
        location = item.get("filePath")
        if not isinstance(location, str) or not Path(location).resolve().is_relative_to(workspace.resolve()):
            raise StaticEvidenceError(f"ESLint 报告包含越界路径：{location!r}")
        for key, field in (("errors", "errorCount"), ("warnings", "warningCount"), ("fatal", "fatalErrorCount")):
            value = item.get(field, 0)
            if type(value) is not int or value < 0:
                raise StaticEvidenceError(f"ESLint 报告的 {field} 不是非负整数")
            counts[key] += value
        counts["files"] += 1
    return counts


def execute_web(root: Path, stage: str, report: Path, evidence: Path) -> dict[str, object]:
    """真实执行三条前端静态检查，核验结果并写出可复核证据文件。

    Args:
        root: 仓库根目录。
        stage: 本次裁决阶段，release 或 full。
        report: ESLint JSON 报告输出路径。
        evidence: 证据文件输出路径；其同级目录会被创建。
    Returns:
        已写出的证据段，含工具版本、配置指纹、真实报告摘要与检查对象数。
    Raises:
        StaticEvidenceError: 工作区、工具入口、报告或配置无法核验。
        StaticViolationError: 任一工具退出非零、存在 ESLint 错误或零检查对象。
    """
    frontend = (root / FRONTEND).resolve()
    if not (frontend / "package.json").is_file():
        raise StaticEvidenceError(f"前端工作区缺少 package.json：{frontend}")
    results = [run_web_tool(name, frontend, report if name == "eslint" else None) for name in WEB_TOOLS]
    counts = parse_eslint_report(report, frontend)
    failures = [item["name"] for item in results if item["exit_code"] != 0]
    if failures or counts["errors"] or counts["fatal"]:
        detail = "、".join(failures) or "eslint"
        raise StaticViolationError(
            f"前端静态检查未通过：{detail} 退出非零；ESLint 错误 {counts['errors']}、致命 {counts['fatal']}"
        )
    if counts["files"] <= 0:
        raise StaticViolationError("前端静态检查没有实际对象，不能计为通过")
    prettier_files = PRETTIER_WARNING.findall(str(results[1]["stdout"]))
    prettier_files = [line for line in prettier_files if not line.startswith("Code style issues found")]
    stylelint = STYLELINT_PROBLEMS.search(str(results[2]["stdout"]))
    configs = web_configs(root)
    tools = [{key: item[key] for key in ("name", "version", "command", "exit_code")} | {"status": "passed"}
             for item in results]
    section: dict[str, object] = {
        "schema": SCHEMA, "kind": "web", "stage": stage, "status": "passed", "code": 0,
        "executed": True, "skipped": False, "objects": counts["files"], "violations": 0,
        "tools": tools,
        "config": [{"path": repository_path(root, path), "sha256": digest(path)} for path in configs],
        "reports": [{"kind": "eslint", "path": str(report), "sha256": digest(report)}],
        "workspace": {"files": counts["files"], "errors": counts["errors"], "warnings": counts["warnings"],
                      "fatal": counts["fatal"], "unformatted": len(prettier_files),
                      "stylelint_problems": int(stylelint.group(1)) if stylelint else None},
    }
    evidence.parent.mkdir(parents=True, exist_ok=True)
    evidence.write_text(json.dumps(section, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    return section


def load_evidence(path: Path) -> dict[str, object]:
    """读取一份静态检查证据文件，缺失或结构不符时受控拒绝。

    Args:
        path: 证据文件路径。
    Returns:
        解析后的 JSON 对象。
    Raises:
        StaticEvidenceError: 文件缺失、不是 UTF-8 JSON 或顶层不是对象。
    """
    if not path.is_file():
        raise StaticEvidenceError(
            f"缺少静态检查证据：{path}；发布阶段必须先真实执行前端静态检查并写出证据"
        )
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise StaticEvidenceError(f"静态检查证据不是可读 JSON：{path}") from error
    if not isinstance(document, dict):
        raise StaticEvidenceError(f"静态检查证据必须是 JSON 对象：{path}")
    return document


def verify_web(root: Path, stage: str, evidence: Path, report: Path | None = None) -> dict[str, object]:
    """复核一份前端静态检查证据：来源、执行状态、范围与 ESLint 报告计数一致。

    Args:
        root: 仓库根目录。
        stage: 本次裁决阶段，release 或 full。
        evidence: static_gate.py --kind web --execute 写出的证据文件。
        report: 可选的 ESLint 报告路径覆盖，用于验证证据指向的报告确实存在且未变。
    Returns:
        通过复核的证据段；计数重新取自原始 ESLint 报告，不信任证据里的自述。
    Raises:
        StaticEvidenceError: 阶段、结构、执行状态、工具、配置、报告指纹或计数不符。
    """
    document = load_evidence(evidence)
    if document.get("schema") != SCHEMA or document.get("kind") != "web" or document.get("stage") != stage:
        raise StaticEvidenceError("静态检查证据的阶段、范围或结构不是本次发布要求")
    if document.get("status") != "passed" or document.get("code") != 0:
        raise StaticEvidenceError("静态检查证据未通过，不能作为发布依据")
    if document.get("executed") is not True or document.get("skipped") is not False:
        raise StaticEvidenceError("静态检查被跳过或未真实执行，不能作为发布依据")
    objects = document.get("objects")
    if type(objects) is not int or objects <= 0 or document.get("violations") != 0:
        raise StaticEvidenceError("静态检查证据没有正检查对象或仍声明违规")
    tools = {item.get("name"): item for item in document.get("tools", []) if isinstance(item, dict)}
    if set(tools) != set(WEB_TOOLS):
        raise StaticEvidenceError(f"静态检查证据的工具集合不完整：{'、'.join(sorted(WEB_TOOLS))}")
    for name, item in tools.items():
        if item.get("status") != "passed" or item.get("exit_code") != 0:
            raise StaticEvidenceError(f"静态检查工具未真实通过：{name}")
        if not str(item.get("version", "")).strip() or not str(item.get("command", "")).strip():
            raise StaticEvidenceError(f"静态检查工具缺少版本或命令：{name}")
    declared = {item.get("path"): item.get("sha256") for item in document.get("config", []) if isinstance(item, dict)}
    expected = {repository_path(root, path): digest(path) for path in web_configs(root)}
    if declared != expected:
        raise StaticEvidenceError("静态检查证据配置与当前仓库不一致，可能来自旧版本或已被修改")
    reports = [item for item in document.get("reports", []) if isinstance(item, dict)]
    if not reports:
        raise StaticEvidenceError("静态检查证据缺少真实报告清单")
    recorded = reports[0]
    location = Path(str(report or recorded.get("path", "")))
    if not location.is_absolute():
        # 证据里允许记录相对路径；依次按仓库根和前端根解释，两者都不存在时如实拒绝。
        candidates = [root / location, root / FRONTEND / location]
        location = next((item for item in candidates if item.is_file()), candidates[0])
    counts = parse_eslint_report(location, (root / FRONTEND).resolve())
    if recorded.get("sha256") != digest(location):
        raise StaticEvidenceError("ESLint 报告内容与证据指纹不一致，属于旧报告或被替换")
    workspace = document.get("workspace")
    if not isinstance(workspace, dict) or any(workspace.get(key) != counts[key] for key in ("files", "errors", "warnings", "fatal")):
        raise StaticEvidenceError("ESLint 报告计数与证据自述不一致")
    return document


def verify_static(root: Path, kind: str, stage: str, module: Path | None = None,
                  evidence: Path | None = None, report: Path | None = None) -> dict[str, object]:
    """按范围裁决静态检查：后端重新核验 PMD 报告，前端复核已写出的执行证据。

    Args:
        root: 仓库根目录。
        kind: backend 或 web。
        stage: 本次裁决阶段，release 或 full。
        module: 仅后端使用的可选单模块范围。
        evidence: 仅前端使用的证据路径；省略时用仓库默认位置。
        report: 仅前端使用的 ESLint 报告路径覆盖。
    Returns:
        通过核验的静态检查证据段。
    Raises:
        ValueError: kind 或 stage 不在受支持集合内。
        StaticEvidenceError: 证据缺失、过期、越界或不可核验。
        StaticViolationError: 存在真实静态违规或检查未执行。
    """
    if kind not in {"backend", "web"} or stage not in {"full", "release"}:
        raise ValueError("静态检查只裁决 backend/web 的 full 或 release 阶段")
    if kind == "backend":
        return verify_backend(root, stage, module)
    return verify_web(root, stage, evidence or root / DEFAULT_WEB_EVIDENCE, report)


def main() -> int:
    """解析范围与阶段，真实执行或复核静态检查；0 通过、1 违规、2 证据无效。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--kind", required=True, choices=("backend", "web"))
    parser.add_argument("--stage", choices=("full", "release"), default="release")
    parser.add_argument("--module", type=Path, help="仅后端：单个 Maven 模块范围")
    parser.add_argument("--execute", action="store_true", help="仅前端：真实执行三条静态检查命令")
    parser.add_argument("--report", type=Path, help="仅前端：ESLint JSON 报告路径")
    parser.add_argument("--evidence", type=Path, help="前端证据路径；省略时用仓库默认位置")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        if args.module and args.kind != "backend":
            raise ValueError("module 仅适用于后端")
        if args.kind == "backend" and args.execute:
            raise ValueError("后端 PMD 由 Maven 真实执行，本工具只核验报告")
        evidence = (args.evidence or root / DEFAULT_WEB_EVIDENCE)
        if args.kind == "web":
            report = args.report or root / DEFAULT_ESLINT_REPORT
            section = (execute_web(root, args.stage, report.resolve(), evidence.resolve())
                       if args.execute else verify_web(root, args.stage, evidence.resolve(), args.report))
        else:
            section = verify_backend(root, args.stage, args.module.resolve() if args.module else None)
    except StaticViolationError as error:
        print(f"静态检查未通过：{error}", file=sys.stderr)
        return 1
    except StaticEvidenceError as error:
        print(f"静态检查证据无法核验：{error}", file=sys.stderr)
        return 2
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"静态检查无法完成：{type(error).__name__}: {error}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(section, ensure_ascii=False, indent=2))
    else:
        print(f"静态检查 {section['kind']}/{section['stage']}: {section['status']}；"
              f"检查对象 {section['objects']}，违规 {section['violations']}")
    return 0 if section["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
