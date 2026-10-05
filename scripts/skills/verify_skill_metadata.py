"""检查技能名称、YAML 结构及跨宿主调用策略。

用法：python scripts/skills/verify_skill_metadata.py [技能目录]
允许不提供 openai.yaml；已有配置必须合法且默认提示引用当前技能。
@author 李杰
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# 直接按文件路径运行时定位工具所属仓库，不依赖调用者的当前目录。
if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.common.quality_common import (
    CheckError,
    Finding,
    discover,
    entry,
    parser,
    read_text,
    report,
)


def load_mapping(source: str) -> dict:
    """安全加载单个 YAML 映射，拒绝重复字段以避免策略被静默覆盖。

    Args:
        source: YAML 文本，不允许自定义 Python 对象标签。
    Returns:
        顶层字段映射。
    Raises:
        ValueError: YAML 语法、重复键或顶层结构不合法。
        CheckError: 未安装 YAML 依赖。
    """
    try:
        import yaml
    except ImportError as exc:
        raise CheckError(
            "缺少 PyYAML，请安装 scripts/workflow/requirements-ci.txt 中锁定的 PyYAML==6.0.3") from exc

    class UniqueLoader(yaml.SafeLoader):
        """为单次调用隔离映射构造器，不改变全局 YAML 加载行为。"""

    def mapping(loader: UniqueLoader, node: object) -> dict:
        """构造映射并拒绝重复字段；复杂键由 YAML 构造器拒绝。"""
        result: dict = {}
        for key_node, value_node in node.value:
            key = loader.construct_object(key_node)
            if not isinstance(key, str):
                raise ValueError("YAML 字段名必须是字符串")
            if key in result:
                raise ValueError(f"YAML 字段重复：{key}")
            result[key] = loader.construct_object(value_node)
        return result

    UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, mapping)
    try:
        value = yaml.load(source, Loader=UniqueLoader)
    except yaml.YAMLError as exc:
        raise ValueError(f"YAML 格式错误：{exc.problem}") from exc
    if not isinstance(value, dict):
        raise ValueError("YAML 顶层必须是映射")
    return value


def frontmatter(source: str) -> dict:
    """提取完整 YAML 前置元数据，缺失或未闭合时抛出 ValueError。"""
    lines = source.splitlines()
    if not lines or lines[0] != "---":
        raise ValueError("SKILL.md 必须以 YAML 前置元数据开始")
    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise ValueError("YAML 前置元数据没有闭合") from exc
    return load_mapping("\n".join(lines[1:end]))


def validate(skill_file: Path, openai_file: Path, root: Path) -> list[Finding]:
    """核对一个技能的命名和调用配置，收集规则错误而不改写文件。

    Args:
        skill_file: 技能主文件，允许缺失以诊断孤立的配置文件。
        openai_file: 对应的可选 Codex 配置。
        root: 诊断路径的仓库根目录。
    Returns:
        此技能所有已发现问题；结构无效时停止依赖该结构的后续检查。
    """
    findings: list[Finding] = []

    def fail(path: Path, message: str) -> None:
        """添加指向所属元数据文件的诊断。"""
        findings.append(Finding(path.relative_to(root).as_posix(), 1, "skill-metadata", message))

    if not skill_file.is_file():
        fail(openai_file, "配置缺少同级技能的 SKILL.md")
        return findings
    for file in (skill_file, openai_file):
        if file.exists() and not file.resolve().is_relative_to(root):
            fail(file, "元数据链接指向仓库外，拒绝读取")
            return findings
    try:
        metadata = frontmatter(read_text(skill_file))
    except ValueError as exc:
        fail(skill_file, str(exc))
        return findings
    name = skill_file.parent.name
    if metadata.get("name") != name or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name):
        fail(skill_file, "name 必须与目录名相同，并使用小写字母、数字和连字符")
    if not isinstance(metadata.get("description"), str) or not metadata["description"].strip():
        fail(skill_file, "description 必须是非空文字")
    for field in ("disable-model-invocation", "user-invocable"):
        if field in metadata and not isinstance(metadata[field], bool):
            fail(skill_file, f"{field} 必须是布尔值")
    manual = metadata.get("disable-model-invocation") is True
    if manual and metadata.get("user-invocable") is False:
        fail(skill_file, "仅手动调用的技能必须允许用户调用")
    if not openai_file.exists():
        return findings
    try:
        config = load_mapping(read_text(openai_file))
    except ValueError as exc:
        fail(openai_file, str(exc))
        return findings
    policy = config.get("policy", {})
    if not isinstance(policy, dict):
        fail(openai_file, "policy 必须是映射")
        return findings
    implicit = policy.get("allow_implicit_invocation", True)
    if not isinstance(implicit, bool):
        fail(openai_file, "allow_implicit_invocation 必须是布尔值")
    elif manual != (implicit is False):
        fail(openai_file, "Claude 与 Codex 的仅手动调用策略不一致")
    interface = config.get("interface")
    if not isinstance(interface, dict):
        fail(openai_file, "interface 必须是映射")
        return findings
    prompt = interface.get("default_prompt")
    if not isinstance(prompt, str) or f"${name}" not in re.findall(r"\$[a-z0-9-]+", prompt):
        fail(openai_file, f"default_prompt 必须引用 ${name}")
    elif any(
        not (skill_file.parent.parent / token[1:] / "SKILL.md").is_file()
        for token in re.findall(r"\$weetion-[a-z0-9-]+", prompt)
    ):
        fail(openai_file, "default_prompt 引用了不存在的 weetion 技能")
    return findings


def collect(root: Path, paths: list[str]) -> tuple[int, list[Finding]]:
    """发现技能主文件及孤立配置，允许完全没有技能的仓库返回零计数。"""
    files = discover(
        root,
        {".md", ".yaml"},
        paths or [".agents/skills"] if (root / ".agents/skills").exists() else paths,
    )
    skill_roots: set[Path] = set()
    for file in files:
        parts = file.relative_to(root).parts
        if parts[:2] != (".agents", "skills"):
            continue
        if len(parts) == 4 and parts[-1] == "SKILL.md":
            skill_roots.add(file.parent)
        elif len(parts) == 5 and parts[-2:] == ("agents", "openai.yaml"):
            skill_roots.add(file.parent.parent)
    findings = []
    for folder in sorted(skill_roots):
        findings.extend(validate(folder / "SKILL.md", folder / "agents/openai.yaml", root))
    return len(skill_roots), findings


def main() -> int:
    """读取参数并输出技能元数据检查结果。"""
    args = parser(__doc__).parse_args()
    count, findings = collect(args.root.resolve(), args.paths)
    return report("技能元数据", count, findings, as_json=args.json)


if __name__ == "__main__":
    raise SystemExit(entry(main))
