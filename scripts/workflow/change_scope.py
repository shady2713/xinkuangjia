"""以 JSON 报告 Git 变更范围，不更改索引、分支或工作区。

用法：python scripts/workflow/change_scope.py --base HEAD
--base 与 --head 采用唯一共同祖先计算已提交范围，后者默认 HEAD。
@author 李杰
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# 直接按文件路径运行时定位工具所属仓库，不依赖调用者的当前目录。
if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.common.quality_common import DEFAULT_ROOT, CheckError, entry, git


def _paths(raw: bytes) -> list[str]:
    """解析 NUL 分隔 UTF-8 路径，保留文件名中的空格和换行。"""
    if raw and not raw.endswith(b"\0"):
        raise CheckError("Git 路径列表缺少 NUL 终止符")
    return sorted(set(raw.decode("utf-8").split("\0")) - {""})


def resolve_commit(root: Path, reference: str) -> str:
    """将引用解析成唯一提交；拒绝歧义、选项注入和无效引用。"""
    value = git(
        root,
        "-c",
        "core.warnAmbiguousRefs=true",
        "rev-parse",
        "--verify",
        "--end-of-options",
        f"{reference}^{{commit}}",
    )
    lines = value.decode("utf-8").splitlines()
    if len(lines) != 1:
        raise CheckError("引用未解析成唯一提交")
    return lines[0]


def diff_paths(root: Path, *arguments: str) -> list[str]:
    """读取禁用外部 diff 和文本转换后的改动路径，不识别重命名配对。"""
    return _paths(
        git(
            root,
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            "--ignore-submodules=none",
            "--name-only",
            "-z",
            *arguments,
            "--",
        )
    )


def collect(root: Path, base: str, head: str = "HEAD") -> dict[str, object]:
    """解析共同祖先并返回四类范围；没有唯一祖先时失败而不猜测。

    Args:
        root: Git 工作区根目录。
        base: 必须明确提供的基线引用。
        head: 待比较的提交引用，默认 HEAD。
    Returns:
        带版本、解析引用和四种路径数组的 JSON 兼容报告。
    Raises:
        CheckError: Git 失败、引用无效或共同祖先不唯一。
    """
    actual = Path(
        git(root, "rev-parse", "--show-toplevel").decode("utf-8").rstrip("\r\n")
    ).resolve()
    base_sha = resolve_commit(actual, base)
    head_sha = resolve_commit(actual, head)
    merge_bases = (
        git(actual, "merge-base", "--all", base_sha, head_sha).decode("utf-8").splitlines()
    )
    if len(merge_bases) != 1:
        raise CheckError("基线和目标没有唯一共同祖先")
    return {
        "formatVersion": 1,
        "repositoryRoot": str(actual),
        "input": {"base": base, "head": head},
        "resolved": {"baseSha": base_sha, "headSha": head_sha, "mergeBaseSha": merge_bases[0]},
        "paths": {
            "committed": diff_paths(actual, merge_bases[0], head_sha),
            "staged": diff_paths(actual, "--cached"),
            "unstaged": diff_paths(actual),
            "untracked": _paths(
                git(actual, "ls-files", "--others", "--exclude-standard", "-z", "--")
            ),
        },
    }


def main() -> int:
    """要求明确基线并输出版本化 JSON 报告。"""
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    arguments.add_argument("--base", required=True)
    arguments.add_argument("--head", default="HEAD")
    args = arguments.parse_args()
    print(
        json.dumps(collect(args.root.resolve(), args.base, args.head), ensure_ascii=False, indent=2)
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(entry(main))
