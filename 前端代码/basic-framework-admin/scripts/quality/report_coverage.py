"""将 Vitest/Istanbul JSON 覆盖率转换为未覆盖位置，不更改覆盖率阈值。

运行 python -B -X utf8 scripts/quality/report_coverage.py。
默认读取本前端 coverage/coverage-final.json；没有报告或格式无效返回 2。
@author 李杰
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import verify_workspace_constraints as workspace


def uncovered(data: object, root: Path) -> list[dict[str, object]]:
    """读取语句、函数及每条分支的零计数，保留原始行列位置。

    Args:
        data: Istanbul JSON 顶层对象。
        root: 所属前端根目录，用于限制报告中的源码路径。
    Returns:
        稳定排序的未覆盖位置；列号转换为从 1 开始。
    Raises:
        ValueError: 报告缺字段、计数不合法、位置无效或源码路径越界。
    """
    if not isinstance(data, dict) or not data:
        raise ValueError("覆盖率报告为空或无效")
    result: list[dict[str, object]] = []
    for filename, item in sorted(data.items()):
        path = Path(filename)
        path = (root / path).resolve() if not path.is_absolute() else path.resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError("报告引用不存在或越界的源码")
        if not isinstance(item, dict):
            raise TypeError("文件覆盖率必须为对象")
        for counts_key, map_key, label in (
            ("s", "statementMap", "statement"),
            ("f", "fnMap", "function"),
            ("b", "branchMap", "branch"),
        ):
            counts, locations = item[counts_key], item[map_key]
            if (
                not isinstance(counts, dict)
                or not isinstance(locations, dict)
                or counts.keys() != locations.keys()
            ):
                raise ValueError("计数与位置映射不一致")
            for key, value in counts.items():
                location = locations[key]
                pairs = (
                    list(zip(value, location["locations"], strict=True))
                    if counts_key == "b"
                    else [(value, location["loc"] if counts_key == "f" else location)]
                )
                for branch, (count, position) in enumerate(pairs):
                    if type(count) is not int or count < 0:
                        raise ValueError("覆盖率计数无效")
                    start = position["start"]
                    if (
                        type(start["line"]) is not int
                        or start["line"] < 1
                        or type(start["column"]) is not int
                        or start["column"] < -1
                    ):
                        raise ValueError("覆盖率位置无效")
                    if count == 0:
                        result.append(
                            {
                                "path": path.relative_to(root).as_posix(),
                                "line": start["line"],
                                # Vue 映射可能以 -1 表示未知列；保留未知状态，不伪造精确位置。
                                "column": None
                                if start["column"] == -1
                                else start["column"] + 1,
                                "kind": label,
                                "id": key,
                                "branch": branch,
                            }
                        )
    return sorted(
        result,
        key=lambda row: (
            row["path"],
            row["line"],
            row["column"] or 0,
            row["kind"],
            row["id"],
            row["branch"],
        ),
    )


def main() -> int:
    """输出未覆盖位置；报告工具本身不将缺口数量转换为新的覆盖率门槛。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    try:
        data = json.loads(workspace._read(root / "coverage/coverage-final.json", root))
        rows = uncovered(data, root)
        if args.json:
            print(json.dumps({"uncovered": rows}, ensure_ascii=False, indent=2))
        else:
            for row in rows:
                column = (
                    f":{row['column']}" if row["column"] is not None else "（列号未知）"
                )
                print(f"{row['path']}:{row['line']}{column} [{row['kind']}] 未覆盖")
            print(f"共 {len(rows)} 个未覆盖位置；测试是否成功请以测试命令退出码为准。")
        return 0
    except (workspace.InputError, ValueError, KeyError, TypeError, OSError):
        print("覆盖率报告缺失或无效，请先执行 test:coverage。", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
