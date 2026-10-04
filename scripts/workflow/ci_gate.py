"""核对 CI 作业与真实 JUnit 用例，拒绝跳过、空报告、缺失集成测试及无证据的发布结论。

@author OpenAI Codex
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

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
COVERAGE_THRESHOLDS = {"per_file": True, "lines": 100, "methods_or_functions": 100}
REVISION_TEXT = re.compile(r"[0-9a-f]{40}")
DIGEST_TEXT = re.compile(r"[0-9a-f]{64}")
RELEASE_JOBS = {
    "backend": {"evidence": "release-backend.json", "coverage_kind": "backend",
                "coverage_file": "coverage-backend.json"},
    "frontend": {"evidence": "release-frontend.json", "coverage_kind": "web",
                 "coverage_file": "coverage-web.json"},
}
# 检查名 -> 计数核对方式：job_count 等于该作业上报的真实用例数，coverage_count 等于
# 覆盖率裁决的实测文件数，no_count 表示该检查没有机器可读对象计数，只能声明 null。
RELEASE_CHECKS = {
    "backend": {"backend-tests-and-integration": "job_count",
                "backend-release-coverage": "coverage_count"},
    "frontend": {"frontend-unit-tests": "job_count",
                 "frontend-release-coverage": "coverage_count",
                 "frontend-typecheck": "no_count",
                 "frontend-production-build": "no_count",
                 "frontend-production-scan": "no_count"},
}


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


def coverage_document(directory: Path, name: str, kind: str) -> dict[str, object]:
    """核对一份发布阶段覆盖率裁决，拒绝审计结论、零对象、阈值放宽和缺口。

    Args:
        directory: 发布检查写入证据的目录。
        name: 覆盖率证据文件名。
        kind: 期望的覆盖率范围，backend 或 web。
    Returns:
        已确认属于该范围发布门槛且已通过的真实裁决文档。
    Raises:
        ValueError: 阶段或范围不符、未通过、零实测对象、存在缺口或阈值被改变。
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
    return document


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


def release_evidence(directory: Path | None, counts: dict[str, int], revision: str | None) -> dict[str, object]:
    """核验发布阶段的真实检查证据，缺少或不合格时拒绝给出发布结论。

    证据由 workflow 中的真实命令产出：每个作业的覆盖率裁决原始 JSON，
    以及该作业在本次提交上真实执行检查的清单。计数必须与聚合门禁独立核对的
    作业计数、覆盖率裁决的实测文件数一致，避免用标签或空报告冒充发布。
    Args:
        directory: 发布检查写入证据的目录，缺失即拒绝。
        counts: 四个必需作业上报的正整数用例数。
        revision: 本次验证的提交标识。
    Returns:
        只包含文件名、提交标识、实测文件数和检查名的可公开发布证据摘要。
    Raises:
        ValueError: 缺少证据目录或文件、阶段/范围/阈值不符、检查未通过、计数不一致或提交不匹配。
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
        for check, mode in RELEASE_CHECKS[job].items():
            if mode == "no_count":
                continue
            expected = counts[job] if mode == "job_count" else coverage["measured_files"]
            if checks[check]["checked"] != expected:
                raise ValueError(f"发布检查计数与真实结果不一致：{job}/{check}")
        released[job] = {"evidence": spec["evidence"], "coverage": spec["coverage_file"],
                         "measured_files": coverage["measured_files"], "checks": sorted(RELEASE_CHECKS[job])}
    return {"directory": str(directory), "revision": revision, "jobs": released}


def aggregate(needs: object, stage: str, evidence: Path | None = None,
              revision: str | None = None) -> dict[str, object]:
    """验证全部固定作业实际成功且有正整数用例，发布阶段还必须有真实发布证据。

    Args:
        needs: GitHub needs 上下文的 JSON 对象，不执行其中任何值。
        stage: 本次入口的固定验证阶段。
        evidence: release 阶段由真实发布检查写出的证据目录；其他阶段忽略。
        revision: 本次验证的提交标识；release 阶段必须提供并与证据一致。
    Returns:
        可公开的阶段、状态、用例数及发布证据摘要，不含环境或测试正文。
    Raises:
        ValueError: 作业缺失、额外作业、失败、跳过、零用例、outputs 非字典、阶段不一致，
            或 release 阶段缺少真实发布证据。
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
    return {"schema": "ci-summary/v1", "stage": stage, "status": "passed", "tests": counts,
            "release_verified": released is not None, "release_evidence": released}


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
    """从固定环境消费 needs 或报告；失败只输出结构错误，不泄露测试正文。"""
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    sub = parser.add_subparsers(dest="command", required=True)
    final = sub.add_parser("aggregate")
    final.add_argument("--stage", choices=sorted(STAGES), required=True)
    final.add_argument("--release-evidence", type=Path, help="发布检查实际写出的证据目录")
    final.add_argument("--revision", help="本次验证的提交标识，缺省取 CI_REVISION")
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
            result = aggregate(json.loads(os.environ.get("NEEDS_JSON", "null")), args.stage, directory, revision)
        else:
            paths = args.path + (list(args.backend.glob("**/target/surefire-reports/TEST-*.xml")) if args.backend else [])
            result = reports(paths, BACKEND_REQUIRED if args.backend else set())
            if output := os.environ.get("GITHUB_OUTPUT"):
                with Path(output).open("a", encoding="utf-8") as stream:
                    stream.write(f"checked={result['checked']}\n")
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (OSError, ValueError, TypeError):
        print("CI 证据核对失败：必需作业或真实测试未完整成功。", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
