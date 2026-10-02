"""只读检查当前前端的工作区包、内部依赖协议及 catalog 引用。

在所属前端运行 python -B -X utf8 scripts/quality/verify_workspace_constraints.py。
需要 Python 3.10+ 和 PyYAML 6.0.3；--root 可选择独立工作区，--json 输出结构化结果。
退出码：0 无问题，1 规则问题，2 环境或输入错误；不安装依赖或修改任何清单。
@author 李杰
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import sys
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path

# 工具及测试导入均不得在 scripts 下写入字节码缓存。
sys.dont_write_bytecode = True
SECTIONS = ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies")
EXCLUDED = frozenset(
    {
        ".git",
        ".agents",
        ".venv",
        "venv",
        "node_modules",
        "__pycache__",
        ".cache",
        ".turbo",
        "dist",
        "build",
        "target",
        "vendor",
    }
)
MAX_BYTES = 16 * 1024 * 1024
ALIAS = re.compile(r"^((?:@[^/@:]+/)?[^/@:]+)@(.+)$")


class InputError(ValueError):
    """表示输入无法可靠解析；检查必须失败，不能作为空工作区通过。"""


@dataclass(frozen=True)
class Finding:
    """记录相对文件路径、字段位置、稳定规则标识与中文原因。"""

    path: str
    field: str
    rule: str
    message: str


@dataclass(frozen=True)
class Package:
    """保存一个已发现包的清单位置和经边界校验的名称。"""

    path: Path
    name: str
    manifest: dict[str, object]


def _mapping(value: object, context: str) -> dict[str, object]:
    """收窄外部对象为字符串键映射，不接受空值、列表或数值键。"""
    if not isinstance(value, dict) or any(not isinstance(key, str) for key in value):
        raise InputError(f"{context} 必须是字符串键映射")
    return value


def _pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    """拒绝 JSON 重复字段，避免后值覆盖前值而使检查遗漏。"""
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise InputError(f"JSON 字段重复：{key}")
        result[key] = value
    return result


def _read(path: Path, root: Path) -> str:
    """只读取根目录内的 UTF-8 文本，拒绝链接越界及过大的输入。

    Args:
        path: 待读文件，解析链接后的路径必须仍在 root 内。
        root: 已解析的工作区根目录。
    Returns:
        去除可选 UTF-8 BOM 后的完整文本。
    Raises:
        InputError: 文件越界、过大、缺失、不可读或编码错误。
    """
    try:
        if not path.resolve().is_relative_to(root):
            raise InputError("输入文件指向工作区外")
        with path.open("rb") as stream:
            data = stream.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise InputError("输入文件超过 16 MiB")
        return data.decode("utf-8-sig")
    except (OSError, UnicodeError) as exc:
        raise InputError(f"{path.relative_to(root).as_posix()}：读取失败或非 UTF-8") from exc


def _yaml(path: Path, root: Path) -> dict[str, object]:
    """安全解析工作区 YAML，拒绝自定义对象标签、重复键与合并键。

    Args:
        path: 工作区配置路径。
        root: 已解析的工作区目录。
    Returns:
        顶层配置映射。
    Raises:
        InputError: 缺少 PyYAML，或 YAML 无法按明确字段可靠解析。
    """
    try:
        import yaml
    except ImportError as exc:
        raise InputError("缺少 PyYAML；请为当前 Python 安装 PyYAML==6.0.3") from exc

    class UniqueLoader(yaml.SafeLoader):
        """隔离映射构造规则，不修改 PyYAML 全局解析行为。"""

    def construct(loader: UniqueLoader, node: yaml.MappingNode) -> dict[str, object]:
        """拒绝重复键及隐式合并，避免配置来源不明确。"""
        result: dict[str, object] = {}
        for key_node, value_node in node.value:
            key = loader.construct_object(key_node)
            if not isinstance(key, str) or key in result:
                raise InputError("YAML 字段必须是唯一字符串")
            result[key] = loader.construct_object(value_node)
        return result

    UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, construct)
    try:
        return _mapping(yaml.load(_read(path, root), Loader=UniqueLoader), path.name)
    except yaml.YAMLError as exc:
        raise InputError(f"{path.name}：YAML 格式或标签不支持") from exc


def _patterns(config: dict[str, object]) -> tuple[list[str], list[str]]:
    """解析包含与排除目录模式；不支持的 glob 语法直接报错，避免静默漏扫。"""
    raw = config.get("packages")
    if not isinstance(raw, list) or not raw:
        raise InputError("packages 必须是非空目录模式列表")
    include: list[str] = []
    exclude: list[str] = []
    for item in raw:
        if not isinstance(item, str) or not item:
            raise InputError("packages 的每个模式必须为非空字符串")
        negative = item.startswith("!")
        pattern = item[1:] if negative else item
        pattern = pattern.removeprefix("./").rstrip("/")
        parts = pattern.split("/")
        # 仅实现当前工作区需要的 glob 子集；扩展语法须先增加行为测试。
        if (
            not pattern
            or pattern.startswith("/")
            or ".." in parts
            or any(char in pattern for char in "\\:{}()")
            or any("**" in part and part != "**" for part in parts)
        ):
            raise InputError(f"不支持或越界的工作区模式：{item}")
        (exclude if negative else include).append(pattern)
    if not include:
        raise InputError("packages 至少需要一个包含模式")
    return include, exclude


def _matches(path: str, pattern: str) -> bool:
    """按路径段匹配 *, ?, [] 与独立 **；星号不能跨越目录分隔符。"""
    parts, patterns = tuple(path.split("/")), tuple(pattern.split("/"))

    @lru_cache(maxsize=None)
    def match(i: int, j: int) -> bool:
        """缓存双星分支，避免嵌套 glob 导致重复递归。"""
        if j == len(patterns):
            return i == len(parts)
        if patterns[j] == "**":
            return match(i, j + 1) or (i < len(parts) and match(i + 1, j))
        return i < len(parts) and fnmatch.fnmatchcase(parts[i], patterns[j]) and match(i + 1, j + 1)

    return match(0, 0)


def _link(path: Path) -> bool:
    """识别符号链接和 Windows 重解析目录，避免遍历 junction 目标。"""
    attributes = getattr(path.lstat(), "st_file_attributes", 0)
    return path.is_symlink() or bool(attributes & 0x400)


def _packages(root: Path, config: dict[str, object]) -> list[Package]:
    """按包含和排除模式发现包，根包始终纳入；不进入依赖、产物或链接目录。"""
    include, exclude = _patterns(config)
    paths = [root / "package.json"]

    def walk_error(error: OSError) -> None:
        """遍历失败必须中止，防止部分扫描被误报为完整通过。"""
        raise InputError("工作区目录无法读取") from error

    for directory, names, files in os.walk(root, followlinks=False, onerror=walk_error):
        parent = Path(directory)
        kept: list[str] = []
        for name in sorted(names):
            candidate = parent / name
            if name in EXCLUDED:
                continue
            if _link(candidate):
                relative = candidate.relative_to(root).as_posix()
                raise InputError(f"{relative}：不支持链接目录，请使用真实工作区目录")
            kept.append(name)
        names[:] = kept
        if parent == root or "package.json" not in files:
            continue
        relative = parent.relative_to(root).as_posix()
        if any(_matches(relative, p) for p in include) and not any(
            _matches(relative, p) for p in exclude
        ):
            paths.append(parent / "package.json")
    packages: list[Package] = []
    for path in sorted(paths):
        try:
            manifest = _mapping(json.loads(_read(path, root), object_pairs_hook=_pairs), path.name)
        except json.JSONDecodeError as exc:
            raise InputError(f"{path.relative_to(root).as_posix()}：JSON 格式错误") from exc
        name = manifest.get("name")
        if not isinstance(name, str) or not name.strip():
            raise InputError(f"{path.relative_to(root).as_posix()}：缺少有效包名")
        packages.append(Package(path, name, manifest))
    return packages


def _catalogs(config: dict[str, object]) -> dict[str, dict[str, object]]:
    """解析默认与命名 catalog；缺少默认目录不阻止命名目录单独使用。"""
    result: dict[str, dict[str, object]] = {}
    if "catalog" in config:
        result["default"] = _mapping(config["catalog"], "catalog")
    for name, value in _mapping(config.get("catalogs", {}), "catalogs").items():
        if name in result:
            raise InputError(f"catalog 名称重复：{name}")
        result[name] = _mapping(value, f"catalogs.{name}")
    return result


def _dependency(
    package: Package,
    name: str,
    spec: str,
    names: dict[str, Path],
    paths: set[Path],
    catalogs: dict[str, dict[str, object]],
    root: Path,
) -> tuple[str, str] | None:
    """检查一条依赖的目标和协议，不执行安装或 semver 求值。

    Args:
        package: 声明依赖的包。
        name: 依赖字段名称，可为别名。
        spec: 经校验的非空依赖声明。
        names: 当前工作区包名到清单路径的映射。
        paths: 当前工作区所有包目录的解析路径集合。
        catalogs: 默认与命名 catalog。
        root: 已解析的工作区根目录。
    Returns:
        首个规则问题的标识与原因；合法时为 None。
    """
    alias_spec = spec
    if spec.startswith("catalog:"):
        catalog = spec[len("catalog:") :] or "default"
        value = catalogs.get(catalog, {}).get(name)
        if not isinstance(value, str) or not value.strip():
            return "catalog-missing", f"catalog {catalog} 未定义有效条目 {name}"
        if value.startswith("catalog:"):
            return "catalog-recursive", f"catalog {catalog} 的 {name} 不能递归引用 catalog"
        # catalog 中的 npm 别名也可能间接指向内部包。
        alias_spec = value
    if spec.startswith("workspace:"):
        target = spec[len("workspace:") :]
        if target.startswith(("./", "../")):
            resolved = (package.path.parent / target).resolve()
            if not resolved.is_relative_to(root) or resolved not in paths:
                return "workspace-target", f"{name} 的相对目标不是当前工作区包"
            return None
        alias = ALIAS.fullmatch(target)
        target_name = alias.group(1) if alias else name
        if target_name not in names:
            return "workspace-target", f"当前工作区缺少目标包 {target_name}"
        return None
    # npm 别名同样可能引用内部包，不只按依赖字段名称判断协议。
    alias = (
        ALIAS.fullmatch(alias_spec.removeprefix("npm:")) if alias_spec.startswith("npm:") else None
    )
    target_name = alias.group(1) if alias else name
    if target_name in names:
        return "workspace-protocol", f"内部包 {target_name} 必须使用 workspace: 协议"
    return None


def inspect(root: Path) -> dict[str, object]:
    """只读检查一个工作区，返回完整规则诊断及包数量。

    Args:
        root: 包含 package.json 和 pnpm-workspace.yaml 的独立前端根目录。
    Returns:
        包含 packages、findings、code 的报告；规则问题返回 code 1。
    Raises:
        InputError: 配置、编码、路径或解析错误导致检查无法完整执行。
    """
    root = root.resolve()
    config = _yaml(root / "pnpm-workspace.yaml", root)
    packages = _packages(root, config)
    catalogs = _catalogs(config)
    names: dict[str, Path] = {}
    paths = {package.path.parent.resolve() for package in packages}
    findings: list[Finding] = []
    for package in packages:
        relative = package.path.relative_to(root).as_posix()
        if package.name in names:
            other = names[package.name].relative_to(root).as_posix()
            findings.append(
                Finding(relative, "name", "duplicate-name", f"包名 {package.name} 与 {other} 重复")
            )
        else:
            names[package.name] = package.path
    for package in packages:
        for section in SECTIONS:
            dependencies = _mapping(package.manifest.get(section, {}), section)
            for name, value in sorted(dependencies.items()):
                if not isinstance(value, str) or not value.strip():
                    raise InputError(f"{package.path.relative_to(root)}：{section}.{name} 声明无效")
                issue = _dependency(package, name, value, names, paths, catalogs, root)
                if issue:
                    findings.append(
                        Finding(
                            package.path.relative_to(root).as_posix(), f"{section}.{name}", *issue
                        )
                    )
    return {
        "packages": len(packages),
        "findings": [asdict(item) for item in findings],
        "code": 1 if findings else 0,
    }


def main(argv: list[str] | None = None) -> int:
    """运行当前前端检查并输出中文或 JSON；输入失败返回 2，无任何写入。

    Args:
        argv: 显式参数列表；None 时读取命令行。
    Returns:
        0 表示无问题，1 表示规则问题，2 表示检查无法完成。
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    try:
        report = inspect(args.root)
    except (InputError, OSError, RecursionError) as exc:
        report = {"packages": 0, "findings": [], "code": 2, "error": str(exc)}
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    elif report["code"] == 2:
        print(f"工作区检查未完成：{report['error']}", file=sys.stderr)
    else:
        for item in report["findings"]:
            print(f"{item['path']} [{item['field']}] {item['rule']}：{item['message']}")
        print(
            f"工作区依赖：检查 {report['packages']} 个包，发现 {len(report['findings'])} 个问题。"
        )
    return int(report["code"])


if __name__ == "__main__":
    raise SystemExit(main())
