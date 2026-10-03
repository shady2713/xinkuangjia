"""定义质量检查子进程的计数与诊断协议，避免通过文本猜测检查是否执行。

@author OpenAI Codex
"""

from __future__ import annotations

import json
from dataclasses import asdict
from typing import Any

PROTOCOL = "quality-check/v1"


def payload(name: str, checked: int, findings: list[Any]) -> dict[str, object]:
    """按实际对象计数生成结果；零对象没有诊断时属于不适用而不是通过。

    Args:
        name: 检查器身份，供调用者核对输出归属。
        checked: 实际消费对象数量，不能以计划数量代替。
        findings: 各语言检查器自己的诊断数据类实例，不执行被检查内容。
    Returns:
        带版本、计数、状态及诊断的 JSON 可序列化结果。
    """
    return {
        "protocol": PROTOCOL,
        "check": name,
        "checked": checked,
        "findings": [asdict(item) for item in findings],
        "status": "failed" if findings else "passed" if checked else "not-applicable",
    }


def emit(name: str, checked: int, findings: list[Any]) -> int:
    """输出一份结构化结果并返回规则退出码，不把零对象描述为成功验证。

    Args:
        name: 检查器身份。
        checked: 实际消费对象数量。
        findings: 待输出的诊断数据类实例。
    Returns:
        存在规则问题时为 1，否则为 0；零对象的 N/A 状态由结构化结果表达。
    """
    print(json.dumps(payload(name, checked, findings), ensure_ascii=False))
    return 1 if findings else 0
