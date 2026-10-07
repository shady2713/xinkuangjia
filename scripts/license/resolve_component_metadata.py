"""核实可执行 JAR 内每个第三方组件的坐标与许可证元数据，并逐条记录来源。

本工具是 [license_inventory.py](license_inventory.py) 的联网补充：盘点工具只读本机已有
缓存并把读不到的记为 `unknown`，本工具按**可核验来源**补齐三类缺口——

1. 构件内没有 `pom.properties` 时的坐标：先按文件名在本机 Maven 仓库索引中唯一匹配，
   并用 SHA-256 证明包内构件与仓库构件逐字节一致；本机没有再查 Maven Central，并用
   Central 上同坐标的构件做同样的逐字节比对后才认定。
2. 本机 POM（含父 POM 链）没有 `<licenses>` 时的许可证标识：改从 Maven Central 重新取同
   一坐标的 POM 与父 POM；Central 上仍没有就如实留空并写明原因。
3. 许可证标识与原文：标识符优先按 POM 自己声明的许可证 URL 映射（URL 由上游作者写出，
   指向哪份条款是明确的），URL 缺失时才按名称原文匹配；原文优先取构件自带的许可证文本，
   其次取 SPDX 官方许可证清单在固定 tag 上的标准文本，两者都没有就只登记原文地址。

工具只登记事实与来源，不做许可选择，也不改任何既有许可声明。默认**不联网**；只有显式传入
`--allow-network` 才会发起请求，便于离线复核与单元测试复用。

运行（仓库根）：

    python -B -X utf8 scripts/license/resolve_component_metadata.py \\
        --jar <后端JAR> --allow-network --cache-dir <仓库外目录> --out <元数据.json>

退出码：0 表示核实完成；2 表示输入不可读或参数不可用。

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
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence
from xml.etree import ElementTree

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
# Maven Central 仓库根：坐标确定后，构件的 POM 只能从这里取，不用其他镜像的二手内容。
CENTRAL_BASE = "https://repo1.maven.org/maven2"
# Central 检索接口只用于"连本机仓库都匹配不上、连 groupId 都不知道"的极端情况。
CENTRAL_SEARCH = "https://search.maven.org/solrsearch/select"
# SPDX 官方许可证清单；固定 tag，不用会漂移的默认分支，原文才有可复现的出处。
SPDX_REF = "v3.26.0"
SPDX_RAW = f"https://raw.githubusercontent.com/spdx/license-list-data/{SPDX_REF}"
# 组件 JAR 自带的许可证文本文件名判定，与盘点工具保持同一口径。
LICENSE_TEXT_NAMES = ("LICENSE", "LICENCE", "NOTICE", "COPYING", "LICENSE.txt", "LICENSE.md",
                     "THIRD-PARTY-NOTICES")
# 自有模块的 groupId：这些构件的许可状态是权利决定未决，不按第三方缺口统计。
FIRST_PARTY_GROUP = "com.basicframework"
RESOLUTION_SCHEMA = "component-license-metadata/v1"
USER_AGENT = "basic-framework-license-metadata/1.0 (offline-verifiable audit)"
# 版本号片段：坐标解析只在坐标缺失时按文件名兜底，且必须与本机仓库唯一匹配才算数。
VERSION_PATTERN = re.compile(r"^(?P<artifact>.+?)-(?P<version>\d[^-]*(?:[-.][A-Za-z0-9]+)*)$")

# 许可证 URL 到 SPDX 标识符的对应关系。键是去掉协议与 www. 之后的 host+path，全小写。
# 只登记本轮实际遇到的写法；未登记的 URL 一律不产生标识符，改为列入待复核。
LICENSE_URL_TO_SPDX: dict[str, str] = {
    "aws.amazon.com/apache2.0": "Apache-2.0",
    "apache.org/licenses/license-2.0": "Apache-2.0",
    "apache.org/licenses/license-2.0.txt": "Apache-2.0",
    "apache.org/licenses/license-2.0.html": "Apache-2.0",
    "repository.jboss.org/licenses/apache-2.0.txt": "Apache-2.0",
    "eclipse.org/org/documents/edl-v10.php": "BSD-3-Clause",
    "opensource.org/licenses/bsd-3-clause": "BSD-3-Clause",
    "opensource.org/license/mit": "MIT",
    "eclipse.org/legal/epl-v20.html": "EPL-2.0",
    "eclipse.org/legal/epl-2.0": "EPL-2.0",
    "eclipse.org/org/documents/epl-2.0/epl-2.0.txt": "EPL-2.0",
    "gnu.org/licenses/old-licenses/lgpl-2.1.html": "LGPL-2.1-only",
    "gnu.org/software/classpath/license.html": "GPL-2.0-with-classpath-exception",
    "jsoup.org/license": "MIT",
    "projectlombok.org/license": "MIT",
    "github.com/webjars/webjars-locator-lite/blob/main/license.md": "MIT",
    "github.com/oblac/jodd-util/blob/master/license": "BSD-2-Clause",
    "license.coscl.org.cn/mulanpsl2": "MulanPSL-2.0",
    "spdx.org/licenses/mit-0.html": "MIT-0",
    "creativecommons.org/licenses/by/2.5": "CC-BY-2.5",
}
# URL 缺失或未登记时才按名称原文匹配，同样只登记指向明确条款的写法。
LICENSE_NAME_TO_SPDX: dict[str, str] = {
    "Apache-2.0": "Apache-2.0",
    "Apache 2.0": "Apache-2.0",
    "Apache License 2.0": "Apache-2.0",
    "Apache License 2": "Apache-2.0",
    "Apache-2": "Apache-2.0",
    "Apache v2": "Apache-2.0",
    "BSD-2-Clause": "BSD-2-Clause",
    "BSD-3-Clause": "BSD-3-Clause",
    "EPL-2.0": "EPL-2.0",
    "EPL 2.0": "EPL-2.0",
    "LGPL-2.1-only": "LGPL-2.1-only",
    "MIT": "MIT",
    "MIT License": "MIT",
    "The MIT License": "MIT",
    "MIT-0": "MIT-0",
    "Mulan Permissive Software License，Version 2": "MulanPSL-2.0",
    "Mulan Permissive Software License, Version 2": "MulanPSL-2.0",
}
# 名称写法不是 SPDX 标准名称、但上游明确指向某一版本的条款：只登记候选并标记需人工确认。
# `GNU Lesser Public License` 指向 gnu.org 的通用 LGPL 页面且未写版本号，因此不给候选。
LICENSE_NAME_VARIANT_CANDIDATES: dict[str, str] = {
    "GNU Library or Lesser General Public License (LGPL) V2.1": "LGPL-2.1-only",
}
# EDL 1.0 在 SPDX 标识符表中不是独立条目，与 BSD-3-Clause 条款文本一致；登记时保留 POM 原文。
SPDX_EQUIVALENT_NOTE = "EDL 1.0 由 SPDX 收录为 BSD-3-Clause 的等价项，两者条款文本一致。"


class MetadataFailure(RuntimeError):
    """输入不可读或参数不可用；不代表任何合规结论。"""


def log(message: str) -> None:
    """输出一行进度，不打印凭据与本机绝对路径。

    Args:
        message: 进度文本。
    """

    print(f"[许可元数据] {message}", flush=True)


def sha256_bytes(payload: bytes) -> str:
    """计算字节内容的摘要，用于把解析结果绑定到具体构件。

    Args:
        payload: 原始字节。
    Returns:
        十六进制 SHA-256。
    """

    return hashlib.sha256(payload).hexdigest()


def central_pom_url(group: str, artifact: str, version: str) -> str:
    """拼出 Maven Central 上该坐标 POM 的规范地址。

    Args:
        group: 构件 groupId。
        artifact: 构件 artifactId。
        version: 构件版本。
    Returns:
        可直接下载的 POM 地址。
    """

    path = f"{group.replace('.', '/')}/{artifact}/{version}/{artifact}-{version}.pom"
    return f"{CENTRAL_BASE}/{path}"


def central_jar_url(group: str, artifact: str, version: str) -> str:
    """拼出 Maven Central 上该坐标构件 JAR 的规范地址。

    Args:
        group: 构件 groupId。
        artifact: 构件 artifactId。
        version: 构件版本。
    Returns:
        可直接下载的 JAR 地址。
    """

    path = f"{group.replace('.', '/')}/{artifact}/{version}/{artifact}-{version}.jar"
    return f"{CENTRAL_BASE}/{path}"


def spdx_text_url(identifier: str) -> str:
    """拼出 SPDX 官方标准许可证文本在固定 tag 上的地址。

    Args:
        identifier: SPDX 许可证标识符。
    Returns:
        固定 tag 下的标准文本地址。
    """

    return f"{SPDX_RAW}/text/{identifier}.txt"


def normalize_license_url(url: str) -> str:
    """把许可证 URL 归一化成便于查表的 host+path。

    Args:
        url: POM 中声明的许可证地址。
    Returns:
        去掉协议、`www.` 前缀、末尾斜杠并转小写后的字符串；空地址返回空串。
    """

    text = url.strip()
    if not text:
        return ""
    parsed = urllib.parse.urlsplit(text)
    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    path = parsed.path.rstrip("/").lower()
    return f"{host}{path}"


def is_license_text(name: str) -> bool:
    """判断构件内部条目是否为许可证文本。

    Args:
        name: 构件内部条目名。
    Returns:
        命中许可证文件名时为真。
    """

    upper = name.upper().rsplit("/", 1)[-1]
    return any(upper == candidate or upper.startswith(candidate + ".") for candidate in LICENSE_TEXT_NAMES)


# --------------------------------------------------------------------------- 网络


@dataclass
class Fetcher:
    """带磁盘缓存的 HTTP 取数器：同一地址只真正下载一次。

    Attributes:
        allowed: 是否允许联网；为假时任何请求都按"未核实"处理。
        cache: 下载内容缓存目录，为空时只做内存缓存。
        timeout: 单次请求超时秒数。
        retrieved: 每个地址的取数结果，供报告如实引用。
    """

    allowed: bool
    cache: Path | None = None
    timeout: int = 30
    retrieved: dict[str, str] = field(default_factory=dict)
    _memory: dict[str, bytes] = field(default_factory=dict)

    def read(self, url: str) -> bytes | None:
        """取回地址内容，取不到时如实返回 None，不使用任何占位内容。

        Args:
            url: 目标地址。
        Returns:
            响应字节；未联网、404 或传输失败时为 None。
        """

        if not self.allowed:
            return None
        if url in self._memory:
            return self._memory[url]
        if self.cache is not None:
            target = self.cache / hashlib.sha256(url.encode("utf-8")).hexdigest()[:32]
            if target.is_file():
                self.retrieved[url] = f"cache:{target.name}"
                self._memory[url] = target.read_bytes()
                return self._memory[url]
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        last_error = ""
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    payload = response.read()
            except (urllib.error.URLError, OSError, TimeoutError) as error:  # 网络不可用如实记录
                last_error = type(error).__name__
                time.sleep(1 + attempt)
                continue
            self._memory[url] = payload
            self.retrieved[url] = "network"
            if self.cache is not None:
                target = self.cache / hashlib.sha256(url.encode("utf-8")).hexdigest()[:32]
                target.write_bytes(payload)
            return payload
        self.retrieved[url] = f"failed:{last_error}"
        return None


# --------------------------------------------------------------------------- 坐标


@dataclass
class LocalRepository:
    """本机 Maven 仓库的构件名索引。

    Attributes:
        root: 仓库根目录。
        index: 文件名到唯一候选 JAR 路径的映射。
        ambiguous: 同一文件名出现在多个 groupId 下、不能据此判定的构件。
    """

    root: Path
    index: dict[str, Path] = field(default_factory=dict)
    ambiguous: dict[str, list[str]] = field(default_factory=dict)

    def build(self) -> None:
        """扫描仓库建立索引。

        文件名已含版本，所以同一 artifactId 的不同版本不会互相干扰；只有同一文件名落在
        多个 groupId 下才是真正无法判定的情况，这类构件记为歧义并不参与坐标判定。
        """

        for path in self.root.rglob("*.jar"):
            existing = self.index.get(path.name)
            if existing is None:
                self.index[path.name] = path
            elif existing != path:
                self.ambiguous.setdefault(path.name, [str(existing.relative_to(self.root))])
                self.ambiguous[path.name].append(str(path.relative_to(self.root)))
                self.index.pop(path.name, None)

    def coordinates_of(self, path: Path) -> tuple[str, str, str]:
        """从仓库内相对路径还原坐标。

        Args:
            path: 仓库内的 JAR 路径。
        Returns:
            groupId、artifactId、version。
        """

        version = path.parent.name
        artifact = path.parent.parent.name
        group = ".".join(path.parent.parent.parent.relative_to(self.root).parts)
        return group, artifact, version


def pom_properties_candidates(entries: Sequence[str], payload: bytes) -> list[str]:
    """列出构件内全部 `pom.properties` 声明的坐标。

    聚合打包的构件（shaded jar）里会同时出现多个模块的 `pom.properties`；按条目顺序取第一份
    会把被打包进去的模块当成构件自身，因此这里全部读出，交给调用方按构件文件名判定。

    Args:
        entries: 构件内部条目名。
        payload: 构件字节内容。
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


def coordinates_from_pom_properties(entries: Sequence[str], payload: bytes,
                                    file_name: str) -> tuple[str, list[str]]:
    """从构件自带的 `pom.properties` 读取坐标。

    只有当声明的 `artifactId-version` 与包内文件名一致时才采信：聚合打包的构件内部带有多个
    模块的 `pom.properties`，不对齐文件名的那些属于被打包进去的模块，不是构件自身。

    Args:
        entries: 构件内部条目名。
        payload: 构件字节内容。
        file_name: 包内的构件文件名，含 `.jar` 后缀。
    Returns:
        采信的坐标与全部候选坐标；没有可用属性文件时坐标为空串。
    """

    candidates = pom_properties_candidates(entries, payload)
    stem = file_name[:-4] if file_name.endswith(".jar") else file_name
    for coordinate in candidates:
        _, artifact, version = coordinate.split(":", 2)
        if f"{artifact}-{version}" == stem:
            return coordinate, candidates
    return "", candidates


def central_search_groups(artifact: str, fetcher: Fetcher, version: str | None = None) -> list[str]:
    """用 Central 检索接口列出某个 artifactId 对应的全部 groupId。

    Args:
        artifact: 构件 artifactId。
        fetcher: 取数器。
        version: 指定版本时按版本一并过滤；为空时只按 artifactId 检索。
    Returns:
        命中的 groupId 列表（去重排序）；检索不可用时为空列表。
    """

    clause = f'a:"{artifact}"' if version is None else f'a:"{artifact}" AND v:"{version}"'
    query = urllib.parse.urlencode({"q": clause, "rows": "40", "wt": "json"})
    payload = fetcher.read(f"{CENTRAL_SEARCH}?{query}")
    if payload is None:
        return []
    try:
        documents = json.loads(payload.decode("utf-8")).get("response", {}).get("docs", [])
    except (ValueError, AttributeError):
        return []
    return sorted({item.get("g", "") for item in documents
                   if item.get("a") == artifact and item.get("g")
                   and (version is None or item.get("v") == version)})


def resolve_coordinate_from_central(entry_name: str, payload: bytes, artifact: str, version: str,
                                    fetcher: Fetcher) -> tuple[str, str]:
    """在 Central 上按 artifactId 与版本确定坐标，并要求构件逐字节一致。

    检索索引可能还没收录刚发布的版本，因此先按 artifactId 与版本检索，未命中再退化为只按
    artifactId 检索；无论哪条路径，都必须下载该坐标的构件并与包内构件 SHA-256 一致才认定，
    否则如实记为未确定。

    Args:
        entry_name: 包内条目文件名。
        payload: 包内构件字节内容。
        artifact: 构件 artifactId。
        version: 构件版本。
        fetcher: 取数器。
    Returns:
        坐标与证据说明；无法确定时坐标为空串。
    """

    digest = sha256_bytes(payload)
    attempts = [("artifactId+版本", central_search_groups(artifact, fetcher, version)),
                ("仅 artifactId", central_search_groups(artifact, fetcher))]
    for basis, groups in attempts:
        if len(groups) != 1:
            continue
        group = groups[0]
        remote = fetcher.read(central_jar_url(group, artifact, version))
        if remote is None:
            continue
        if sha256_bytes(remote) != digest:
            continue
        return (f"{group}:{artifact}:{version}",
                f"Maven Central 检索接口按{basis}唯一命中 groupId={group}，"
                f"且 {central_jar_url(group, artifact, version)} 与包内构件 SHA-256 逐字节一致")
    return "", f"{entry_name}：Central 检索未唯一命中或构件不一致，坐标不作认定"


# --------------------------------------------------------------------------- 许可证元数据


def local_name(tag: str) -> str:
    """去掉 XML 命名空间，只留元素本地名。

    相当一部分历史 POM 的根元素没有 Maven 命名空间，按命名空间精确匹配会漏掉它们的
    `<licenses>`；统一按本地名查找才不会把"上游没声明"误判成"我们没读出来"。

    Args:
        tag: 元素标签，可能带 `{uri}` 前缀。
    Returns:
        去掉命名空间后的本地名。
    """

    return tag.rsplit("}", 1)[-1]


def find_local(element: ElementTree.Element, name: str) -> ElementTree.Element | None:
    """按本地名查找直接子元素。

    Args:
        element: 父元素。
        name: 子元素本地名。
    Returns:
        命中的子元素；没有时为 None。
    """

    for child in element:
        if local_name(child.tag) == name:
            return child
    return None


def text_local(element: ElementTree.Element, name: str) -> str:
    """按本地名读取直接子元素文本。

    Args:
        element: 父元素。
        name: 子元素本地名。
    Returns:
        子元素文本并去除首尾空白；没有该子元素时为空串。
    """

    child = find_local(element, name)
    return (child.text or "").strip() if child is not None else ""


def parse_pom(payload: bytes) -> tuple[list[dict[str, str]], tuple[str, str, str] | None]:
    """读取一份 POM 的许可证声明与父构件坐标。

    Args:
        payload: POM 字节内容。
    Returns:
        许可证条目列表与父构件坐标；父构件未声明时为 None。
    """

    root = ElementTree.fromstring(payload)
    licenses: list[dict[str, str]] = []
    block = find_local(root, "licenses")
    if block is not None:
        for element in block:
            if local_name(element.tag) != "license":
                continue
            name = text_local(element, "name")
            if not name:
                continue
            licenses.append({
                "name": name,
                "url": text_local(element, "url"),
                "distribution": text_local(element, "distribution"),
            })
    parent_element = find_local(root, "parent")
    parent = None
    if parent_element is not None:
        values = tuple(text_local(parent_element, tag)
                       for tag in ("groupId", "artifactId", "version"))
        if all(values):
            parent = values  # type: ignore[assignment]
    return licenses, parent


def local_pom(repository: Path, group: str, artifact: str, version: str) -> bytes | None:
    """读取本机 Maven 仓库中的构件 POM。

    Args:
        repository: 本机 Maven 仓库根目录。
        group: 构件 groupId。
        artifact: 构件 artifactId。
        version: 构件版本。
    Returns:
        POM 字节；仓库中没有该构件时为 None。
    """

    path = repository / group.replace(".", "/") / artifact / version / f"{artifact}-{version}.pom"
    try:
        return path.read_bytes()
    except OSError:
        return None


def walk_pom_chain(group: str, artifact: str, version: str, repository: Path | None,
                   fetcher: Fetcher, prefer_local: bool) -> dict[str, Any]:
    """沿父 POM 链找到第一处声明了 `<licenses>` 的 POM，并记录整条链。

    Args:
        group: 构件 groupId。
        artifact: 构件 artifactId。
        version: 构件版本。
        repository: 本机 Maven 仓库根目录；为空时只走网络。
        fetcher: 取数器。
        prefer_local: 为真时优先使用本机 POM；为假时只用 Maven Central。
    Returns:
        含 `licenses`、`chain` 与 `stopped_reason` 的结果；没有声明时 `licenses` 为空。
    """

    chain: list[dict[str, str]] = []
    seen: set[str] = set()
    for depth in range(9):
        key = f"{group}:{artifact}:{version}"
        if key in seen:
            return {"licenses": [], "chain": chain, "stopped_reason": "父 POM 链出现循环，已停止上溯"}
        seen.add(key)
        url = central_pom_url(group, artifact, version)
        payload: bytes | None = None
        origin = ""
        local_path = repository / group.replace(".", "/") / artifact / version / f"{artifact}-{version}.pom"
        if prefer_local and repository is not None:
            payload = local_pom(repository, group, artifact, version)
            origin = "local-maven-repository" if payload is not None else ""
        if payload is None and (not prefer_local or fetcher.allowed):
            payload = fetcher.read(url)
            origin = "maven-central" if payload is not None else ""
        if payload is None:
            return {"licenses": [], "chain": chain,
                    "stopped_reason": "该坐标的 POM 在本机与 Maven Central 都取不到"}
        try:
            licenses, parent = parse_pom(payload)
        except ElementTree.ParseError as error:
            return {"licenses": [], "chain": chain, "stopped_reason": f"POM 解析失败：{error}"}
        # 对外只登记 Central 上该坐标 POM 的规范地址：交付出去的许可材料不该带构建机路径。
        chain.append({
            "coordinates": key,
            "origin": origin,
            "url": url,
            "local_path": f"file:{local_path}" if origin == "local-maven-repository" else "",
            "sha256": sha256_bytes(payload),
            "declares_licenses": bool(licenses),
        })
        if licenses:
            return {"licenses": licenses, "chain": chain, "stopped_reason": "",
                    "declared_at": key, "declared_origin": origin, "declared_depth": depth}
        if parent is None:
            return {"licenses": [], "chain": chain,
                    "stopped_reason": f"{origin} 上 {key} 自身的 POM 未声明 <licenses> 且无父构件可继承"}
        group, artifact, version = parent
    return {"licenses": [], "chain": chain, "stopped_reason": "父 POM 链超过 8 层，未能确定声明来源"}


def resolve_license_declaration(group: str, artifact: str, version: str, repository: Path,
                                 fetcher: Fetcher) -> dict[str, Any]:
    """确定组件的许可证声明来源：本机优先，本机没有结论时改用 Maven Central 复核。

    Args:
        group: 构件 groupId。
        artifact: 构件 artifactId。
        version: 构件版本。
        repository: 本机 Maven 仓库根目录。
        fetcher: 取数器。
    Returns:
        许可证声明结果，含 `licenses`、`source`、`chain`、`local_chain` 与未解决原因。
    """

    local_result = walk_pom_chain(group, artifact, version, repository, fetcher, prefer_local=True)
    if local_result["licenses"]:
        return {
            "licenses": local_result["licenses"],
            "source": "local-pom" if local_result.get("declared_depth") == 0
            else "inherited-from-parent-pom",
            "chain": local_result["chain"],
            "pom_url": local_result["chain"][0]["url"] if local_result["chain"] else "",
            "unresolved_reason": "",
        }
    if not fetcher.allowed:
        return {
            "licenses": [], "source": local_result["stopped_reason"] and "unknown" or "unknown",
            "chain": local_result["chain"],
            "pom_url": local_result["chain"][0]["url"] if local_result["chain"] else "",
            "unresolved_reason": local_result["stopped_reason"] or "本机 POM 未声明 <licenses>，且未启用联网核实",
        }
    central_result = walk_pom_chain(group, artifact, version, repository, fetcher, prefer_local=False)
    if central_result["licenses"]:
        return {
            "licenses": central_result["licenses"],
            "source": "maven-central-pom" if central_result.get("declared_depth") == 0
            else "maven-central-inherited-from-parent-pom",
            "chain": central_result["chain"],
            "pom_url": central_result["chain"][0]["url"] if central_result["chain"] else "",
            "unresolved_reason": "",
            "local_chain": local_result["chain"],
            "local_stopped_reason": local_result["stopped_reason"],
        }
    return {
        "licenses": [], "source": "own-pom-without-licenses", "chain": central_result["chain"],
        "pom_url": central_result["chain"][0]["url"] if central_result["chain"] else "",
        "unresolved_reason": central_result["stopped_reason"],
        "local_chain": local_result["chain"],
        "local_stopped_reason": local_result["stopped_reason"],
    }


def map_license_to_spdx(licenses: Sequence[Mapping[str, str]]) -> dict[str, Any]:
    """把 POM 声明映射为 SPDX 标识符，并记录每一条的映射依据。

    Args:
        licenses: POM 中的许可证条目。
    Returns:
        含 `identifiers`、`mappings` 与 `needs_review` 的映射结果。
    """

    identifiers: list[str] = []
    mappings: list[dict[str, str]] = []
    needs_review: list[dict[str, str]] = []
    for entry in licenses:
        name = entry.get("name", "").strip()
        url = entry.get("url", "").strip()
        normalized = normalize_license_url(url)
        identifier = LICENSE_URL_TO_SPDX.get(normalized, "")
        basis = "POM 声明的许可证 URL"
        evidence = url
        if not identifier:
            identifier = LICENSE_NAME_TO_SPDX.get(name, "")
            basis = "POM 声明的许可证名称原文"
            evidence = name
        if identifier:
            if identifier not in identifiers:
                identifiers.append(identifier)
            mappings.append({"name": name, "url": url, "spdx_id": identifier,
                             "mapping_basis": basis, "evidence": evidence})
            continue
        variant = LICENSE_NAME_VARIANT_CANDIDATES.get(name, "")
        needs_review.append({
            "name": name,
            "url": url,
            "reason": ("名称写法不是 SPDX 标准名称，登记为候选待人工确认" if variant
                       else "POM 声明的 URL 与名称都未登记对应关系，不作标识符映射"),
            "candidate_spdx_id": variant,
        })
    return {"identifiers": identifiers, "mappings": mappings, "needs_review": needs_review}


def load_additional_evidence(path: Path | None) -> dict[str, dict[str, Any]]:
    """读取人工核实补充证据表。

    有些构件的许可证声明根本不在 POM 里，只能从官方仓库对应文件读到。这类结论不写死在
    工具里，而是放在可复核的证据表中：每条都必须带来源 URL 与逐字引文，工具只负责合并。

    Args:
        path: 证据表路径；为空时返回空表。
    Returns:
        以包内构件文件名为键的补充证据。
    Raises:
        MetadataFailure: 证据表不可读或结构不合法。
    """

    if path is None:
        return {}
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise MetadataFailure(f"补充证据表不可读：{error}") from error
    entries = document.get("components") if isinstance(document, Mapping) else None
    if not isinstance(entries, Mapping):
        raise MetadataFailure("补充证据表缺少 components 映射")
    for name, evidence in entries.items():
        if not isinstance(evidence, Mapping) or not evidence.get("source_url"):
            raise MetadataFailure(f"补充证据条目 {name} 缺少 source_url")
    return dict(entries)


def apply_additional_evidence(records: list[dict[str, Any]],
                              evidence: Mapping[str, Mapping[str, Any]],
                              fetcher: Fetcher) -> None:
    """把人工核实的补充证据合并进组件记录。

    Args:
        records: 逐组件核实结果，原地修改。
        evidence: 以构件文件名为键的补充证据。
        fetcher: 取数器，用于取补充证据指向的标准文本。
    """

    for record in records:
        entry = evidence.get(record["file_name"])
        if entry is None:
            continue
        licenses = [dict(item) for item in entry.get("licenses", [])]
        mapping = map_license_to_spdx(licenses)
        record["licenses"] = licenses
        record["license_source"] = entry.get("source", "additional-evidence")
        record["license_pom_url"] = entry.get("source_url", "")
        record["license_evidence_quote"] = entry.get("quote", "")
        record["license_evidence_note"] = entry.get("note", "")
        record["spdx_ids"] = mapping["identifiers"]
        record["spdx_mappings"] = mapping["mappings"]
        record["needs_legal_review"] = mapping["needs_review"] + [
            dict(item) for item in entry.get("needs_legal_review", [])
        ]
        record["unresolved"] = [item for item in record["unresolved"]
                                if not item.startswith("maven-central")]
        record["spdx_texts"] = []
        for identifier in record["spdx_ids"]:
            url = spdx_text_url(identifier)
            text = fetcher.read(url)
            record["spdx_texts"].append({
                "spdx_id": identifier, "url": url,
                "sha256": sha256_bytes(text) if text is not None else "",
                "bytes": len(text) if text is not None else 0,
                "retrieved": "已取回" if text is not None
                else ("未取回" if fetcher.allowed else "未联网核实"),
                "text": text.decode("utf-8", "replace") if text is not None else "",
            })


# --------------------------------------------------------------------------- 扫描


def scan_jar(jar_path: Path, repository: Path, fetcher: Fetcher,
             additional: Mapping[str, Mapping[str, Any]] | None = None) -> list[dict[str, Any]]:
    """逐个核实 JAR 内打包组件的坐标与许可证元数据。

    Args:
        jar_path: 打包后的可执行 JAR。
        repository: 本机 Maven 仓库根目录。
        fetcher: 取数器。
        additional: 人工核实的补充证据；为空时不合并。
    Returns:
        每个打包组件的核实结果，按 JAR 内条目名排序。
    Raises:
        MetadataFailure: JAR 不可读。
    """

    local = LocalRepository(root=repository)
    local.build()
    try:
        outer = zipfile.ZipFile(jar_path)
    except (OSError, zipfile.BadZipFile) as error:
        raise MetadataFailure(f"后端 JAR 不可读：{error}") from error
    records: list[dict[str, Any]] = []
    with outer:
        libraries = sorted(name for name in outer.namelist()
                           if name.startswith("BOOT-INF/lib/") and name.endswith(".jar"))
        for entry in libraries:
            payload = outer.read(entry)
            entry_name = entry.rsplit("/", 1)[-1]
            try:
                with zipfile.ZipFile(io.BytesIO(payload)) as inner:
                    inner_entries = inner.namelist()
                    embedded = [name for name in inner_entries
                                if is_license_text(name) and not name.endswith("/")]
                    embedded_payloads = {name: inner.read(name) for name in embedded}
                    coordinates, candidates = coordinates_from_pom_properties(
                        inner_entries, payload, entry_name)
            except zipfile.BadZipFile:
                embedded, embedded_payloads, coordinates, candidates = [], {}, "", []
            source = "jar-pom-properties" if coordinates else ""
            evidence = "构件内 META-INF/maven/**/pom.properties" if coordinates else ""
            if not coordinates:
                coordinates, source, evidence = resolve_coordinate(entry_name, payload,
                                                                  local, repository, fetcher)
            record: dict[str, Any] = {
                "jar_entry": entry,
                "file_name": entry_name,
                "sha256": sha256_bytes(payload),
                "size_bytes": len(payload),
                "coordinates": coordinates,
                "coordinate_source": source or "unresolved",
                "coordinate_evidence": evidence,
                "pom_properties_candidates": candidates,
                "embedded_license_texts": [
                    {"entry": name, "sha256": sha256_bytes(embedded_payloads[name]),
                     "bytes": len(embedded_payloads[name])}
                    for name in sorted(embedded_payloads)
                ],
                "licenses": [],
                "license_source": "unknown",
                "license_pom_url": "",
                "license_chain": [],
                "spdx_ids": [],
                "spdx_mappings": [],
                "needs_legal_review": [],
                "spdx_texts": [],
                "unresolved": [],
            }
            if not coordinates:
                record["unresolved"].append("坐标未确定")
            else:
                group, artifact, version = coordinates.split(":", 2)
                record["version"] = version
                declaration = resolve_license_declaration(group, artifact, version,
                                                           repository, fetcher)
                record["licenses"] = declaration["licenses"]
                record["license_source"] = declaration["source"]
                record["license_chain"] = declaration["chain"]
                record["license_pom_url"] = declaration["pom_url"]
                if declaration.get("unresolved_reason"):
                    record["unresolved"].append(declaration["unresolved_reason"])
                mapping = map_license_to_spdx(declaration["licenses"])
                record["spdx_ids"] = mapping["identifiers"]
                record["spdx_mappings"] = mapping["mappings"]
                record["needs_legal_review"] = mapping["needs_review"]
                for identifier in record["spdx_ids"]:
                    url = spdx_text_url(identifier)
                    text = fetcher.read(url)
                    record["spdx_texts"].append({
                        "spdx_id": identifier, "url": url,
                        "sha256": sha256_bytes(text) if text is not None else "",
                        "bytes": len(text) if text is not None else 0,
                        "retrieved": "已取回" if text is not None
                        else ("未取回" if fetcher.allowed else "未联网核实"),
                        # 标准文本一并写进报告：生成许可材料时不必再联网，材料与报告同源可复核。
                        "text": text.decode("utf-8", "replace") if text is not None else "",
                    })
            record["classification"] = ("first-party" if coordinates.startswith(f"{FIRST_PARTY_GROUP}:")
                                       else "third-party")
            records.append(record)
    if additional:
        apply_additional_evidence(records, additional, fetcher)
    return records


def resolve_coordinate(entry_name: str, payload: bytes, local: LocalRepository,
                       repository: Path, fetcher: Fetcher) -> tuple[str, str, str]:
    """为缺少 `pom.properties` 的构件确定坐标。

    顺序是本机 Maven 仓库唯一匹配并逐字节比对，再退到 Maven Central 检索并逐字节比对；
    两条路都要求构件内容一致，否则如实记为未确定。

    Args:
        entry_name: 包内条目文件名。
        payload: 包内构件字节内容。
        local: 本机 Maven 仓库索引。
        repository: 本机 Maven 仓库根目录。
        fetcher: 取数器。
    Returns:
        坐标、来源与证据说明。
    """

    candidate = local.index.get(entry_name)
    if candidate is not None:
        local_hash = sha256_bytes(candidate.read_bytes())
        if local_hash == sha256_bytes(payload):
            group, artifact, version = local.coordinates_of(candidate)
            return (f"{group}:{artifact}:{version}", "local-maven-repository",
                    f"本机仓库 {candidate.relative_to(repository)} 与包内构件 SHA-256 逐字节一致")
        return ("", "unresolved",
                f"本机仓库同名构件 SHA-256 不一致（{local_hash[:12]}…），不作坐标证据")
    if entry_name in local.ambiguous:
        return ("", "unresolved", "本机仓库存在同名构件：" + "、".join(local.ambiguous[entry_name]))
    parsed = VERSION_PATTERN.match(entry_name[:-4])
    if parsed is None:
        return ("", "unresolved", "文件名无法拆出 artifactId 与版本")
    coordinates, evidence = resolve_coordinate_from_central(entry_name, payload,
                                                            parsed["artifact"], parsed["version"], fetcher)
    if coordinates:
        return coordinates, "maven-central", evidence
    return "", "unresolved", evidence


# --------------------------------------------------------------------------- 入口


def closure_digest(records: Sequence[Mapping[str, Any]]) -> str:
    """计算打包构件闭包的摘要。

    摘要只由"打包进产物的**第三方**构件自身的 SHA-256"决定，与产物里额外放了多少文件无关：
    许可材料本身被打进 JAR 后产物摘要会变，但闭包摘要不变。只用构件摘要、不掺坐标，
    是为了让核对方不依赖任何坐标解析手段也能从产物本身重算出同一个值。
    自有模块不计入：它们每次重新构建都会产生不同的 JAR 字节，把它们算进来会让
    "材料是否还对应当前依赖"永远无法核对。

    Args:
        records: 逐组件核实结果。
    Returns:
        十六进制 SHA-256。
    """

    lines = sorted(str(item.get("sha256", "")) for item in records
                   if item.get("classification") != "first-party")
    return sha256_bytes("\n".join(lines).encode("utf-8"))


def summarize(records: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """统计核实结果，用于命令行输出与报告摘要。

    Args:
        records: 逐组件核实结果。
    Returns:
        各类来源计数与仍需人工处理的条目。
    """

    third_party = [item for item in records if item["classification"] == "third-party"]
    coordinate_sources: dict[str, int] = {}
    license_sources: dict[str, int] = {}
    for item in third_party:
        coordinate_sources[item["coordinate_source"]] = coordinate_sources.get(
            item["coordinate_source"], 0) + 1
        license_sources[item["license_source"]] = license_sources.get(item["license_source"], 0) + 1
    return {
        "components": len(records),
        "third_party": len(third_party),
        "first_party": sum(1 for item in records if item["classification"] == "first-party"),
        "coordinate_sources": coordinate_sources,
        "license_sources": license_sources,
        "coordinates_unresolved": [item["file_name"] for item in third_party if not item["coordinates"]],
        "license_unresolved": [item["file_name"] for item in third_party if not item["licenses"]],
        "needs_legal_review": [
            {"component": item["file_name"], "entries": item["needs_legal_review"]}
            for item in third_party if item["needs_legal_review"]
        ],
        "without_embedded_license_text": [item["file_name"] for item in third_party
                                          if not item["embedded_license_texts"]],
        "spdx_text_retrieved": sorted({entry["spdx_id"] for item in third_party
                                       for entry in item["spdx_texts"]
                                       if entry["retrieved"] == "已取回"}),
    }


def build_report(records: Sequence[Mapping[str, Any]], jar_path: Path,
                 fetcher: Fetcher, network: bool) -> dict[str, Any]:
    """组装可写入磁盘的核实报告。

    Args:
        records: 逐组件核实结果。
        jar_path: 被核实的 JAR。
        fetcher: 取数器。
        network: 本次是否启用了联网核实。
    Returns:
        `component-license-metadata/v1` 报告。
    """

    return {
        "schema": RESOLUTION_SCHEMA,
        "status": "metadata-only",
        "disclaimer": "本报告只登记可核验的坐标与许可证元数据及其来源，"
                      "不构成合规结论，也不代表任何许可选择已获批准。",
        "artifact": jar_path.name,
        "artifact_sha256": sha256_bytes(jar_path.read_bytes()),
        "components_closure_sha256": closure_digest(records),
        "network_used": network,
        "spdx_reference": SPDX_REF,
        "spdx_equivalent_note": SPDX_EQUIVALENT_NOTE,
        "sources": {
            "maven_central": CENTRAL_BASE,
            "central_search": CENTRAL_SEARCH,
            "spdx_license_list": SPDX_RAW,
            "retrieved": fetcher.retrieved,
        },
        "summary": summarize(records),
        "components": list(records),
    }


def parse_arguments(argv: Sequence[str] | None = None) -> argparse.Namespace:
    """解析命令行参数。

    Args:
        argv: 原始命令行参数；省略时读取进程参数。
    Returns:
        已解析的参数。
    """

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jar", type=Path, required=True, help="打包后的后端可执行 JAR")
    parser.add_argument("--maven-repo", type=Path,
                        default=Path(os.path.expanduser("~")) / ".m2" / "repository",
                        help="本机 Maven 仓库根目录")
    parser.add_argument("--allow-network", action="store_true",
                        help="允许从 Maven Central 与 SPDX 取数；默认只读本机已有内容")
    parser.add_argument("--cache-dir", type=Path, help="下载内容缓存目录，用于事后复核取数结果")
    parser.add_argument("--additional-evidence", type=Path,
                        help="人工核实的补充证据表；每条必须带 source_url 与逐字引文")
    parser.add_argument("--out", type=Path, required=True, help="核实报告输出路径")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    """执行核实并写出报告。

    Args:
        argv: 原始命令行参数；省略时读取进程参数。
    Returns:
        进程退出码；0 表示报告已产出，2 表示输入不可用。
    """

    arguments = parse_arguments(argv)
    if not arguments.jar.is_file():
        print(f"后端 JAR 不存在：{arguments.jar}", file=sys.stderr)
        return 2
    if not arguments.maven_repo.is_dir():
        print(f"本机 Maven 仓库不存在：{arguments.maven_repo}", file=sys.stderr)
        return 2
    if arguments.cache_dir is not None:
        arguments.cache_dir.mkdir(parents=True, exist_ok=True)
    fetcher = Fetcher(allowed=arguments.allow_network, cache=arguments.cache_dir)
    try:
        records = scan_jar(arguments.jar, arguments.maven_repo, fetcher,
                          load_additional_evidence(arguments.additional_evidence))
    except MetadataFailure as error:
        print(f"许可元数据核实无法完成：{error}", file=sys.stderr)
        return 2
    report = build_report(records, arguments.jar, fetcher, arguments.allow_network)
    arguments.out.parent.mkdir(parents=True, exist_ok=True)
    arguments.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = report["summary"]
    log(f"组件 {summary['components']} 个（第三方 {summary['third_party']}、自有 {summary['first_party']}）")
    log(f"坐标来源：{summary['coordinate_sources']}")
    log(f"许可证来源：{summary['license_sources']}")
    log(f"坐标仍未确定 {len(summary['coordinates_unresolved'])} 个；"
        f"许可证声明仍未确定 {len(summary['license_unresolved'])} 个；"
        f"需人工确认 {len(summary['needs_legal_review'])} 个")
    log(f"核实报告已写入 {arguments.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
