"""核对 CI 作业与真实 JUnit 用例，拒绝跳过、空报告及缺失的必需集成测试。

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

JOBS = {"docs_tools", "frontend", "backend"}
STAGES = {"functional", "audit", "release"}
BACKEND_REQUIRED = {
    "AuthenticationSessionMySqlIT", "PermissionObjectMySqlIT", "FileUploadMySqlS3IT",
    "OAuth2MachinePrincipalHttpMySqlIT",
}


def aggregate(needs: object, stage: str) -> dict[str, object]:
    """验证全部固定作业实际成功且有正整数用例，阶段标识不能交叉替代。

    Args:
        needs: GitHub needs 上下文的 JSON 对象，不执行其中任何值。
        stage: 本次入口的固定验证阶段。
    Returns:
        可公开的阶段、状态及用例数，不含环境或测试正文。
    Raises:
        ValueError: 作业缺失、额外作业、失败、跳过、零用例、outputs 非字典或阶段不一致。
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
    return {"schema": "ci-summary/v1", "stage": stage, "status": "passed", "tests": counts,
            "release_verified": stage == "release"}


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
    report = sub.add_parser("reports")
    report.add_argument("--path", type=Path, action="append", default=[])
    report.add_argument("--backend", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "aggregate":
            result = aggregate(json.loads(os.environ.get("NEEDS_JSON", "null")), args.stage)
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
