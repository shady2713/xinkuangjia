"""把延迟测量报告与数据库查询数报告合并为一份可判定报告。

延迟轮必须运行在生产日志级别下，才能让计时不被调试日志干扰；查询数轮必须打开
MyBatis DEBUG 日志，才能逐条统计语句执行。两轮分开采集后在同一份报告中合并，
判定逻辑只消费合并结果，不需要知道采集分了几轮。

合并只允许两份报告描述同一负载、同一构件和同一并发度；任一不一致都拒绝合并，
避免把不同条件下的数字拼成看似可用的证据。

@author 李杰
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

REPORT_SCHEMA = "perf-report/v1"


class MergeFailure(RuntimeError):
    """输入报告不可读或不具备可比性；合并结果不可用于预算判定。"""


def _load(path: Path) -> dict[str, Any]:
    """读取并校验单份报告的结构与 schema。"""

    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise MergeFailure(f"无法读取 {path}：{error.strerror or error}") from error
    except json.JSONDecodeError as error:
        raise MergeFailure(f"{path} 不是合法 JSON：{error}") from error
    if not isinstance(document, dict) or document.get("schema") != REPORT_SCHEMA:
        raise MergeFailure(f"{path} 不是 {REPORT_SCHEMA} 报告")
    return document


def _identity(document: Mapping[str, Any]) -> tuple[Any, ...]:
    """提取可比性标识，用于拒绝把不同负载或不同构件的报告拼在一起。"""

    workload = document.get("workload") or {}
    build = document.get("build") or {}
    return (workload.get("id"), document.get("concurrency"),
            build.get("jar_sha256"), build.get("git_revision"))


def merge(latency: dict[str, Any], sql: dict[str, Any]) -> dict[str, Any]:
    """把查询数合并进延迟报告的场景条目。

    Args:
        latency: 延迟轮报告。
        sql: 查询数轮报告。
    Returns:
        合并后的报告对象；查询数轮缺少某个场景时该场景不写入 sql 字段。
    Raises:
        MergeFailure: 两份报告的可比性标识不一致。
    """

    if _identity(latency) != _identity(sql):
        raise MergeFailure(
            "两份报告的负载、并发度、构件摘要或修订不一致，数字不可比："
            f"{_identity(latency)} != {_identity(sql)}")

    merged = json.loads(json.dumps(latency))
    merged_scenarios = merged.get("scenarios") or {}
    sql_scenarios = sql.get("scenarios") or {}
    if not isinstance(merged_scenarios, dict) or not isinstance(sql_scenarios, dict):
        raise MergeFailure("报告缺少 scenarios 映射")
    for name, scenario in merged_scenarios.items():
        source = sql_scenarios.get(name)
        if not isinstance(source, dict) or not isinstance(source.get("sql"), dict):
            continue
        scenario["sql"] = source["sql"]
        scenario["sql_source"] = {
            "samples_ms_count": len(source.get("samples_ms") or []),
            "sql_log_parse": (sql.get("workload") or {}).get("sql_log_parse"),
        }
    merged["workload"]["sql_counter"] = (sql.get("workload") or {}).get("sql_counter")
    merged["workload"]["sql_log_parse"] = (sql.get("workload") or {}).get("sql_log_parse")
    merged["collector"] = {
        "latency_report": {"generated_at": latency.get("generated_at")},
        "sql_report": {"generated_at": sql.get("generated_at")},
    }
    return merged


def main(argv: Sequence[str] | None = None) -> int:
    """合并两份报告并写出结果；退出 0 表示合并完成，2 表示输入或可比性不可用。

    Args:
        argv: 命令行参数；省略时读取真实进程参数。
    Returns:
        0 表示已写出合并报告；2 表示输入不可读或不可比。
    """

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--latency", required=True, help="延迟轮生成的 perf-report/v1")
    parser.add_argument("--sql", required=True, help="查询数轮生成的 perf-report/v1")
    parser.add_argument("--out", required=True, help="合并结果输出路径")
    args = parser.parse_args(argv)
    try:
        merged = merge(_load(Path(args.latency)), _load(Path(args.sql)))
    except MergeFailure as error:
        print(f"报告合并无法完成：{error}", file=sys.stderr)
        return 2
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"合并报告已写入 {out}，场景 {len(merged.get('scenarios') or {})} 个")
    return 0


if __name__ == "__main__":
    sys.exit(main())
