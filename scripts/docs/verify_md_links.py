"""检查仓库 Markdown 的相对链接、图片及标题锚点。

用法：python scripts/docs/verify_md_links.py [--json] [docs]
不访问外部网址，不检查冻结笔记的出站链接，不自动修复。
@author 李杰
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import unquote

# 直接按文件路径运行时定位工具所属仓库，不依赖调用者的当前目录。
if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.common.quality_common import Finding, discover, entry, parser, read_text, report
from scripts.docs.markdown_support import Markdown, parse


def decode_path(value: str) -> str:
    """严格解码 URL；无效 UTF-8 转义保留原文，避免替换字符改变文件名。"""
    try:
        return unquote(value, errors="strict")
    except UnicodeError:
        return value


def collect(root: Path, paths: list[str]) -> tuple[int, list[Finding]]:
    """检查选中文档的目标和锚点；越界链接报告错误，不读取仓库外文件。

    Args:
        root: 仓库根目录。
        paths: 需要检查的相对路径，空列表表示全量 Markdown。
    Returns:
        实际源文档数和所有失效链接；目标文档仅在需要时解析。
    """
    files = discover(root, {".md"}, paths)
    cache: dict[Path, Markdown] = {}
    findings: list[Finding] = []
    for path in files:
        if path not in cache:
            cache[path] = parse(read_text(path))
        for link in cache[path].destinations:
            # 与原脚本一致：根绝对 URL、协议和协议相对地址归渲染器负责。
            if re.match(r"^(?:[a-zA-Z][a-zA-Z\d+.-]*:|/)", link.url):
                continue
            base, separator, fragment = link.url.partition("#")
            base = decode_path(base.split("?", 1)[0])
            target = (path.parent / base).resolve() if base else path.resolve()
            reason = ""
            if not target.is_relative_to(root):
                reason = "相对链接超出仓库"
            elif not target.exists():
                reason = "目标不存在"
            elif separator and fragment and target.suffix.lower() == ".md" and target.is_file():
                # 归档内容仅作为入站链接目标读取；不递归验证其出站引用。
                if target not in cache:
                    cache[target] = parse(read_text(target))
                if decode_path(fragment) not in cache[target].anchors:
                    reason = "目标中没有此锚点"
            if reason:
                findings.append(
                    Finding(
                        path.relative_to(root).as_posix(),
                        link.line,
                        "md-link",
                        f"{reason}：{link.url}",
                    )
                )
    return len(files), findings


def main() -> int:
    """解析命令行并输出链接诊断，失败不修改源文档。"""
    args = parser(__doc__).parse_args()
    count, findings = collect(args.root.resolve(), args.paths)
    return report("Markdown 链接", count, findings, as_json=args.json)


if __name__ == "__main__":
    raise SystemExit(entry(main))
