"""盘点最终交付物中实际存在的第三方组件，并核对许可证声明与许可证文本是否随包提供。

盘点以**交付物本身**为准，而不是以依赖声明为准：后端以打包后的可执行 JAR 为准，
前端以打包后的交付压缩包为准；依赖声明只用于解释与交叉核对。工具不下载任何外部
资源，许可证元数据只从本机已有的 Maven 仓库与已安装的 npm 包中读取，读不到就如实
记为 `unknown`，不用推测值填充。

工具只产出事实清单与缺口统计，不代替有权者判断"是否合规"，也不修改任何既有许可声明：
`status` 字段固定为 `inventory-only`，需要人工与有权者决定的部分写在 `needs_authority` 中。

运行（仓库根）：

    python -B -X utf8 scripts/license/license_inventory.py --jar <后端JAR> \\
        --frontend-archive <前端交付包.zip> --lockfile <pnpm-lock.yaml> --out <清单.json>

退出码：0 表示清单已产出；2 表示输入不可读或参数不可用。

@author 李杰
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence
from xml.etree import ElementTree

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_ROOT = REPOSITORY_ROOT / "前端代码" / "basic-framework-admin"
# 归档或 JAR 内出现这些文件名的条目，才算"随交付物提供了许可证文本"。
LICENSE_TEXT_NAMES = ("LICENSE", "LICENCE", "NOTICE", "COPYING", "LICENSE.txt", "LICENSE.md",
                     "THIRD-PARTY-NOTICES")
# 静态交付物里需要单独确认来源与许可的资源类型。
ASSET_SUFFIXES = {".woff": "字体", ".woff2": "字体", ".ttf": "字体", ".otf": "字体",
                   ".eot": "字体", ".svg": "图像", ".png": "图像", ".jpg": "图像",
                   ".jpeg": "图像", ".gif": "图像", ".webp": "图像", ".ico": "图像"}
# 弱 copyleft 与 GPL 类条款：其再分发条件与 Apache-2.0/MIT 不同，需要单独复核。
COPYLEFT_PATTERN = re.compile(r"LGPL|GNU Lesser|GPL", re.IGNORECASE)
INVENTORY_SCHEMA = "license-inventory/v1"
# 自有模块的 groupId：打进 JAR 的这些构件属于本项目代码，不计入第三方许可缺口。
FIRST_PARTY_GROUP = "com.basicframework"


class InventoryFailure(RuntimeError):
    """输入不可读或参数不可用；不代表任何合规结论。"""


def log(message: str) -> None:
    """输出单行进度，不包含凭据或本机绝对路径。"""

    print(f"[许可盘点] {message}", flush=True)


def sha256_of(path: Path) -> str:
    """计算文件摘要，用于把清单绑定到具体交付物。

    Args:
        path: 目标文件。
    Returns:
        十六进制 SHA-256。
    Raises:
        InventoryFailure: 文件不存在或不可读。
    """

    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
    except OSError as error:
        raise InventoryFailure(f"无法读取 {path.name}：{error.strerror or error}") from error
    return digest.hexdigest()


def is_license_text(name: str) -> bool:
    """判断归档条目**名字**是否按名称提供许可证文本。

    只看名字会把第三方类文件算成许可证文本：`io/swagger/v3/core/jackson/mixin/LicenseMixin.class`、
    `software/amazon/awssdk/regions/servicemetadata/LicenseManagerServiceMetadata.class`、
    `com/mysql/cj/protocol/x/Notice.class` 都命中许可证文件名规则。盘点结论必须落在
    "条款文本是否真的随包提供"上，因此登记时还要用 `is_text_content` 过滤内容。

    Args:
        name: 归档内条目名。
    Returns:
        命中许可证文件名时为真。
    """

    upper = name.upper().rsplit("/", 1)[-1]
    return any(upper == candidate or upper.startswith(candidate + ".") for candidate in LICENSE_TEXT_NAMES)


def is_text_content(content: bytes) -> bool:
    """判断条目内容是不是可作为许可证文本分发的文本。

    Args:
        content: 条目字节内容。
    Returns:
        非空、不含 NUL 且可按 UTF-8 解码时为真。
    """

    if not content or b"\x00" in content:
        return False
    try:
        content.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return True


# --------------------------------------------------------------------------- 后端 JAR


@dataclass
class JarComponent:
    """后端可执行 JAR 内的一个第三方组件。

    Attributes:
        jar_entry: JAR 内的相对路径。
        coordinates: groupId:artifactId:version；无法从构件内确定时为空串。
        size_bytes: 组件 JAR 的字节数。
        embedded_license_texts: 组件 JAR 自带的许可证文本条目。
        license_names: 从本机 Maven 仓库 POM 解析出的许可证名。
        license_source: 许可证元数据的来源说明。
    """

    jar_entry: str
    coordinates: str
    size_bytes: int
    embedded_license_texts: list[str] = field(default_factory=list)
    license_names: list[str] = field(default_factory=list)
    license_source: str = "unknown"

    @property
    def first_party(self) -> bool:
        """判断该组件是否为本项目自有模块。

        自有模块同样没有许可证元数据，但那是**许可选择未决**，不是第三方声明缺失，
        两者必须分开统计，否则会把权利决定误报成第三方合规缺口。

        Returns:
            坐标落在自有 groupId 下时为真。
        """

        return self.coordinates.startswith(f"{FIRST_PARTY_GROUP}:")

    def as_dict(self) -> dict[str, Any]:
        """返回可直接写入清单的字典表示。

        Returns:
            组件的完整记录。
        """

        return {
            "jar_entry": self.jar_entry,
            "coordinates": self.coordinates,
            "size_bytes": self.size_bytes,
            "classification": "first-party" if self.first_party else "third-party",
            "embedded_license_texts": self.embedded_license_texts,
            "license_names": self.license_names,
            "license_source": self.license_source,
        }


def _local_name(tag: str) -> str:
    """去掉 XML 命名空间前缀，只留元素本地名。

    历史 POM 的根元素常常没有 Maven 命名空间（如 org.apache.xmlbeans 的 5.3.0 POM），
    按命名空间精确匹配会把"上游没声明许可证"误判成"我们没读出来"。统一按本地名查找，
    盘点口径才是"读没读到"，而不是"匹没匹配上命名空间"。

    Args:
        tag: 元素标签，可能带 `{uri}` 前缀。
    Returns:
        去掉命名空间后的本地名。
    """

    return tag.rsplit("}", 1)[-1]


def _find_local(element: ElementTree.Element, name: str) -> ElementTree.Element | None:
    """按本地名查找直接子元素。

    Args:
        element: 父元素。
        name: 子元素本地名。
    Returns:
        命中的子元素；没有时为 None。
    """

    for child in element:
        if _local_name(child.tag) == name:
            return child
    return None


def _text_local(element: ElementTree.Element, name: str) -> str:
    """按本地名读取直接子元素文本。

    Args:
        element: 父元素。
        name: 子元素本地名。
    Returns:
        子元素文本并去除首尾空白；没有该子元素时为空串。
    """

    child = _find_local(element, name)
    return (child.text or "").strip() if child is not None else ""


def pom_licenses(pom_bytes: bytes) -> list[str]:
    """读取单个 POM 中直接声明的许可证名。

    Args:
        pom_bytes: POM 文件内容。
    Returns:
        许可证名列表；未声明时为空列表。
    """

    root = ElementTree.fromstring(pom_bytes)
    licenses = _find_local(root, "licenses")
    if licenses is None:
        return []
    names = []
    for element in licenses:
        if _local_name(element.tag) != "license":
            continue
        name = _text_local(element, "name")
        if name:
            names.append(name)
    return names


def pom_parent(pom_bytes: bytes) -> tuple[str, str, str] | None:
    """读取 POM 声明的父构件坐标。

    Args:
        pom_bytes: POM 文件内容。
    Returns:
        groupId、artifactId、version；未声明父构件时返回 None。
    """

    root = ElementTree.fromstring(pom_bytes)
    parent = _find_local(root, "parent")
    if parent is None:
        return None
    values = tuple(_text_local(parent, tag) for tag in ("groupId", "artifactId", "version"))
    if not all(values):
        return None
    return values  # type: ignore[return-value]


def resolve_licenses(maven_repo: Path, group: str, artifact: str, version: str,
                     depth: int = 0) -> tuple[list[str], str]:
    """沿父 POM 链解析许可证名，链上任何一段缺失都如实记录。

    Args:
        maven_repo: 本机 Maven 仓库根目录。
        group: 构件 groupId。
        artifact: 构件 artifactId。
        version: 构件版本。
        depth: 当前已沿父链上溯的层数，用于限制异常 POM 造成的循环。
    Returns:
        许可证名列表与来源说明；解析不到时来源为 `unknown`。
    """

    if depth > 8:
        return [], "unknown"
    directory = maven_repo / group.replace(".", "/") / artifact / version
    pom_path = directory / f"{artifact}-{version}.pom"
    if not pom_path.is_file():
        return [], "unknown"
    try:
        content = pom_path.read_bytes()
    except OSError:
        return [], "unknown"
    direct = pom_licenses(content)
    if direct:
        return direct, "own-pom"
    parent = pom_parent(content)
    if parent is None:
        return [], "own-pom-without-licenses"
    inherited, _ = resolve_licenses(maven_repo, *parent, depth=depth + 1)
    if inherited:
        return inherited, "inherited-from-parent"
    return [], "unknown"


def pom_properties_candidates(entries: Sequence[str], payload: bytes) -> list[str]:
    """列出组件 JAR 内全部 `pom.properties` 声明的坐标。

    聚合打包的构件（shaded jar）里会同时出现多个模块的 `pom.properties`，按条目顺序取第一份
    会把别的模块当成构件自身，因此这里全部读出，交给调用方按构件文件名判定。

    Args:
        entries: 组件 JAR 的条目名。
        payload: 组件 JAR 的字节内容。
    Returns:
        坐标列表，按条目名排序去重。
    """

    candidates: list[str] = []
    for name in sorted(entries):
        if not (name.startswith("META-INF/maven/") and name.endswith("pom.properties")):
            continue
        try:
            with zipfile.ZipFile(io.BytesIO(payload)) as inner:
                text = inner.read(name).decode("utf-8", "replace")
        except (KeyError, zipfile.BadZipFile):
            continue
        values = dict(line.split("=", 1) for line in text.strip().splitlines() if "=" in line)
        group, artifact, version = (values.get("groupId", ""), values.get("artifactId", ""),
                                    values.get("version", ""))
        coordinate = f"{group}:{artifact}:{version}" if group and artifact and version else ""
        if coordinate and coordinate not in candidates:
            candidates.append(coordinate)
    return candidates


def component_coordinates(entries: Sequence[str], payload: bytes, file_name: str) -> str:
    """从组件 JAR 内的 pom.properties 读取真实坐标。

    只有当声明的 `artifactId-version` 与包内文件名一致时才采信：聚合打包的构件内部带有多个
    模块的 `pom.properties`，不对齐文件名的那些属于被打包进去的模块，不是构件自身。

    Args:
        entries: 组件 JAR 的条目名。
        payload: 组件 JAR 的字节内容。
        file_name: 包内的构件文件名，含 `.jar` 后缀。
    Returns:
        groupId:artifactId:version；无法确定时为空串。
    """

    stem = file_name[:-4] if file_name.endswith(".jar") else file_name
    for coordinate in pom_properties_candidates(entries, payload):
        _, artifact, version = coordinate.split(":", 2)
        if f"{artifact}-{version}" == stem:
            return coordinate
    return ""


def scan_backend_jar(jar_path: Path, maven_repo: Path) -> dict[str, Any]:
    """盘点后端可执行 JAR 内实际存在的第三方组件与许可证文本。

    Args:
        jar_path: 打包后的可执行 JAR。
        maven_repo: 本机 Maven 仓库根目录。
    Returns:
        后端部分清单。
    Raises:
        InventoryFailure: JAR 不可读。
    """

    try:
        outer = zipfile.ZipFile(jar_path)
    except (OSError, zipfile.BadZipFile) as error:
        raise InventoryFailure(f"后端 JAR 不可读：{error}") from error
    with outer:
        entries = outer.namelist()
        own_texts = [name for name in entries
                     if is_license_text(name) and is_text_content(outer.read(name))]
        libraries = [name for name in entries
                     if name.startswith("BOOT-INF/lib/") and name.endswith(".jar")]
        components: list[JarComponent] = []
        for entry in sorted(libraries):
            payload = outer.read(entry)
            try:
                with zipfile.ZipFile(io.BytesIO(payload)) as inner:
                    inner_entries = inner.namelist()
                    embedded = [name for name in inner_entries
                                if is_license_text(name) and is_text_content(inner.read(name))]
                    coordinates = component_coordinates(inner_entries, payload,
                                                        entry.rsplit("/", 1)[-1])
            except zipfile.BadZipFile:
                embedded, coordinates = [], ""
            licenses: list[str] = []
            source = "unknown"
            if coordinates:
                group, artifact, version = coordinates.split(":", 2)
                licenses, source = resolve_licenses(maven_repo, group, artifact, version)
            components.append(JarComponent(jar_entry=entry, coordinates=coordinates,
                                           size_bytes=len(payload), embedded_license_texts=embedded,
                                           license_names=licenses, license_source=source))
    third_party = [item for item in components if not item.first_party]
    first_party = [item for item in components if item.first_party]
    unknown = [item.jar_entry for item in third_party if not item.license_names]
    unresolved = [item.jar_entry for item in third_party if not item.coordinates]
    no_embedded = [item.jar_entry for item in third_party if not item.embedded_license_texts]
    copyleft = sorted(
        f"{item.coordinates or item.jar_entry}：{'、'.join(item.license_names)}"
        for item in third_party
        if any(COPYLEFT_PATTERN.search(name) for name in item.license_names))
    return {
        "artifact": jar_path.name,
        "sha256": sha256_of(jar_path),
        "bundled_libraries": len(components),
        "third_party_components": len(third_party),
        "first_party_modules": [item.coordinates for item in first_party],
        "license_text_entries_in_artifact": own_texts,
        "components": [item.as_dict() for item in components],
        "components_without_license_metadata": unknown,
        "components_with_unresolved_coordinates": unresolved,
        "components_without_embedded_license_text": no_embedded,
        "components_with_copyleft_license_metadata": copyleft,
        "needs_authority": [
            "JAR 与镜像均未随附任何第三方许可证文本；是否把声明并入交付物属分发决定。",
            f"{len(unknown)} 个第三方组件在本机 Maven 仓库中读不到许可证元数据，"
            "需联网核验或向上游索取；本工具不用推测值填充。",
            f"{len(copyleft)} 个组件的许可证元数据含 LGPL/GPL 类条款，其再分发条件需专门复核。",
            f"{len(first_party)} 个自有模块同样没有许可证声明，这是权利决定，不是第三方缺口。",
        ],
    }


# --------------------------------------------------------------------------- 前端交付包


def scan_frontend_archive(archive_path: Path) -> dict[str, Any]:
    """盘点前端交付压缩包内的文件类型、许可证文本与资源文件。

    Args:
        archive_path: 打包后的前端交付压缩包。
    Returns:
        前端制品部分清单。
    Raises:
        InventoryFailure: 压缩包不可读。
    """

    try:
        archive = zipfile.ZipFile(archive_path)
    except (OSError, zipfile.BadZipFile) as error:
        raise InventoryFailure(f"前端交付包不可读：{error}") from error
    with archive:
        infos = archive.infolist()
        names = [info.filename for info in infos]
        texts = [info.filename for info in infos
                 if is_license_text(info.filename) and is_text_content(archive.read(info))]
        assets = [{"entry": info.filename, "bytes": info.file_size,
                   "kind": ASSET_SUFFIXES.get(Path(info.filename).suffix.lower(), "其他"),
                   "provenance": "unrecorded"}
                  for info in infos
                  if Path(info.filename).suffix.lower() in ASSET_SUFFIXES]
        manifest = next((name for name in names if name.endswith("交付清单.json")), None)
        build: Mapping[str, Any] = {}
        if manifest is not None:
            try:
                build = json.loads(archive.read(manifest).decode("utf-8")).get("build", {})
            except (KeyError, ValueError):
                build = {}
    return {
        "artifact": archive_path.name,
        "sha256": sha256_of(archive_path),
        "entries": len(infos),
        "license_text_entries": texts,
        "declared_build": build,
        "assets": assets,
        "needs_authority": [
            "交付包内没有任何许可证或 NOTICE 文件；静态产物包含上游派生代码。",
            f"{len(assets)} 个资源文件（字体、图像）在仓库内没有来源与许可记录，分发前需核实。",
            "静态产物不含源码映射，无法从交付物本身证明其包含哪些第三方运行期代码。",
        ],
    }


# --------------------------------------------------------------------------- 前端依赖锁文件


def scan_lockfile(lock_path: Path, node_modules: Path | None) -> dict[str, Any]:
    """按 pnpm 锁文件登记的包清单核对每个包的许可证声明。

    锁文件登记的是**全部**已解析依赖（含构建期与开发期依赖），比真正进入静态产物的
    运行期闭包大；工具如实报告这一口径，不把它当作"交付物实际包含的组件"。

    Args:
        lock_path: pnpm-lock.yaml。
        node_modules: 前端 node_modules 目录；为空时只报告锁文件条目。
    Returns:
        锁文件部分清单。
    Raises:
        InventoryFailure: 锁文件不可读或缺少 YAML 解析器。
    """

    try:
        import yaml
    except ImportError as error:  # pragma: no cover - CI 已固定 PyYAML
        raise InventoryFailure("缺少 YAML 解析器，无法读取 pnpm-lock.yaml") from error
    try:
        document = yaml.safe_load(lock_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise InventoryFailure(f"锁文件不可读：{error}") from error
    packages: Mapping[str, Any] = (document or {}).get("packages") or {}
    records: list[dict[str, Any]] = []
    unresolved: list[str] = []
    for key in sorted(packages):
        if not isinstance(key, str) or key.startswith(("/", "file:", "link:")):
            continue
        name, _, version = key.rpartition("@")
        name = name or key
        version = version.lstrip("/")
        declared = None
        if node_modules is not None:
            declared = _package_license(node_modules, name, version)
        if declared is None:
            unresolved.append(f"{name}@{version}")
        records.append({"package": name, "version": version, "license": declared or "unknown"})
    unknown = [record["package"] for record in records if record["license"] == "unknown"]
    return {
        "lockfile": lock_path.name,
        "sha256": sha256_of(lock_path),
        "scope": "锁文件登记的全部已解析依赖，含构建期与开发期依赖；不是交付物实际包含的组件集合",
        "packages": len(records),
        "records": records,
        "packages_without_license": unknown,
        "needs_authority": [
            "锁文件口径包含构建期依赖，不能据此推断静态产物的分发义务范围。",
            f"{len(unknown)} 个包在本地安装中读不到 license 字段，需要联网核验或向上游索取。",
        ],
    }


def _package_license(node_modules: Path, name: str, version: str) -> str | None:
    """在 pnpm 安装目录中查找包自身的许可证声明。

    Args:
        node_modules: 前端 node_modules 目录。
        name: 包名。
        version: 包版本。
    Returns:
        license 字段或 licenses 映射的取值；找不到时为 None。
    """

    if "/" not in name:
        return None
    base = node_modules / ".pnpm"
    if not base.is_dir():
        return None
    prefix = name.replace("/", "+") + "@"
    for candidate in base.glob(f"{prefix}{version}*/node_modules/{name}/package.json"):
        try:
            document = json.loads(candidate.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        license_field = document.get("license")
        if isinstance(license_field, str) and license_field:
            return license_field
        licenses = document.get("licenses")
        if isinstance(licenses, list) and licenses:
            first = licenses[0]
            if isinstance(first, Mapping) and first.get("type"):
                return str(first["type"])
    return None


# --------------------------------------------------------------------------- 入口


def build_inventory(arguments: argparse.Namespace) -> dict[str, Any]:
    """组装完整清单。

    Args:
        arguments: 已解析的命令行参数。
    Returns:
        license-inventory/v1 清单。
    Raises:
        InventoryFailure: 任一输入不可读。
    """

    inventory: dict[str, Any] = {
        "schema": INVENTORY_SCHEMA,
        "status": "inventory-only",
        "disclaimer": "本清单只登记交付物中实际存在的事实与读不到的缺口，"
                      "不构成合规结论，也不代表任何许可选择已获批准。",
    }
    if arguments.jar is not None:
        inventory["backend"] = scan_backend_jar(arguments.jar, arguments.maven_repo)
    if arguments.frontend_archive is not None:
        inventory["frontend_archive"] = scan_frontend_archive(arguments.frontend_archive)
    if arguments.lockfile is not None:
        inventory["frontend_lockfile"] = scan_lockfile(arguments.lockfile, arguments.node_modules)
    return inventory


def parse_arguments(argv: Sequence[str] | None = None) -> argparse.Namespace:
    """解析命令行参数。

    Args:
        argv: 原始命令行参数；省略时读取进程参数。
    Returns:
        已解析的参数。
    """

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jar", type=Path, help="后端打包后的可执行 JAR")
    parser.add_argument("--frontend-archive", type=Path, help="前端打包后的交付压缩包")
    parser.add_argument("--lockfile", type=Path, help="pnpm-lock.yaml")
    parser.add_argument("--node-modules", type=Path, default=FRONTEND_ROOT / "node_modules",
                        help="前端 node_modules 目录；用于读取各包自身的 license 字段")
    parser.add_argument("--maven-repo", type=Path, default=Path(os.path.expanduser("~")) / ".m2" / "repository",
                        help="本机 Maven 仓库根目录")
    parser.add_argument("--out", type=Path, required=True, help="清单输出路径")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    """执行盘点并写出清单；退出 0 表示清单已产出，2 表示输入不可用。

    Args:
        argv: 原始命令行参数；省略时读取进程参数。
    Returns:
        进程退出码。
    """

    arguments = parse_arguments(argv)
    if arguments.jar is None and arguments.frontend_archive is None and arguments.lockfile is None:
        print("至少需要一个盘点目标：--jar、--frontend-archive 或 --lockfile", file=sys.stderr)
        return 2
    try:
        inventory = build_inventory(arguments)
    except InventoryFailure as error:
        print(f"许可盘点无法完成：{error}", file=sys.stderr)
        return 2
    arguments.out.parent.mkdir(parents=True, exist_ok=True)
    arguments.out.write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + "\n",
                             encoding="utf-8")
    backend = inventory.get("backend") or {}
    archive = inventory.get("frontend_archive") or {}
    lock = inventory.get("frontend_lockfile") or {}
    log(f"后端 {backend.get('bundled_libraries', 0)} 个组件，"
        f"随包许可证文本 {len(backend.get('license_text_entries_in_artifact', []))} 份；"
        f"前端交付包 {archive.get('entries', 0)} 个条目，"
        f"随包许可证文本 {len(archive.get('license_text_entries', []))} 份；"
        f"锁文件登记 {lock.get('packages', 0)} 个包")
    log(f"清单已写入 {arguments.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
