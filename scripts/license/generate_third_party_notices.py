"""按已核实的元数据生成随交付物分发的第三方许可材料。

输入是 [resolve_component_metadata.py](resolve_component_metadata.py) 的核实报告（离线可读），
输出是一份 `THIRD-PARTY-NOTICES` 与一个按内容去重的 `licenses/` 目录，两者都会被 Maven 打进
可执行 JAR 的 `META-INF/` 下，因此交付方拿到 JAR 就能看到每个组件的坐标、版本、许可证标识，
以及许可证原文本身或原文的可核验位置。

三条硬约束：

1. **不联网**：所有原文都来自构件自身 JAR 内自带的文本条目，或核实报告里已记录的 SPDX 标准
   文本；取不到就如实写"原文未随包提供"并列出 POM 声明的地址，绝不代写条款。
2. **绑定构件**：报告里记录了**第三方**构件闭包的 SHA-256（只由各第三方构件自身的 SHA-256
   决定），与实际 JAR 重算结果不一致、或报告登记的构件在产物里缺失时直接失败，防止把旧报告配
   新构件。用闭包摘要而不是产物摘要，是因为本文件被打进 JAR 后产物摘要必然变化，闭包摘要才
   不会自指失效；排除自有模块是因为它们每次重新构建的字节都不同，算进来就永远核对不上。
3. **不代替权利决定**：自有模块只列出坐标并注明"许可待有权者决定"，本工具不生成任何对自有
   代码的许可授予。

运行（仓库根）：

    python -B -X utf8 scripts/license/generate_third_party_notices.py \\
        --metadata <核实报告.json> --jar <后端JAR> --out-dir <目标目录>

退出码：0 表示材料已生成；2 表示输入不可读或报告与构件不匹配。

@author 李杰
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path
from typing import Any, Mapping, Sequence

NOTICES_NAME = "THIRD-PARTY-NOTICES"
LICENSES_DIR = "licenses"
# 报告结构版本：结构变了就拒绝拿旧报告生成材料，避免静默漏项。
EXPECTED_SCHEMA = "component-license-metadata/v1"
DISCLAIMER = (
    "本文件只登记交付物中实际存在的第三方组件及其许可证声明与原文位置，"
    "不构成合规结论，也不代表任何许可选择已获批准；"
    "本项目自有代码的许可由有权者另行决定，本文件不构成对自有代码的许可授予。"
)


class NoticeFailure(RuntimeError):
    """输入不可读或报告与构件不匹配；不代表任何合规结论。"""


def log(message: str) -> None:
    """输出一行进度，不打印凭据与本机绝对路径。

    Args:
        message: 进度文本。
    """

    print(f"[第三方许可材料] {message}", flush=True)


def sha256_of(path: Path) -> str:
    """计算文件摘要，用于把材料绑定到具体交付物。

    Args:
        path: 目标文件。
    Returns:
        十六进制 SHA-256。
    """

    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class TextStore:
    """按内容摘要去重的许可证原文仓库。

    同一个 Apache-2.0 文本在 100 多个构件里重复出现，逐份内联会让材料大出一个量级；
    按内容去重后只存一份，材料正文按构件指向对应文件，义务信息不丢。

    Attributes:
        items: 摘要到文本记录的映射。
    """

    def __init__(self) -> None:
        """建立空仓库。"""

        self.items: dict[str, dict[str, Any]] = {}

    def add(self, content: bytes, origin: str, component: str) -> str:
        """登记一份文本并返回其摘要。

        Args:
            content: 文本字节内容。
            origin: 文本来源说明，写进材料供复核。
            component: 使用该文本的组件标识。
        Returns:
            十六进制 SHA-256 摘要。
        """

        digest = hashlib.sha256(content).hexdigest()
        record = self.items.setdefault(digest, {"content": content, "used_by": []})
        if component not in record["used_by"]:
            record["used_by"].append(component)
        if origin not in record["used_by"]:
            record["used_by"].append(origin)
        return digest

    def write(self, directory: Path) -> dict[str, str]:
        """把去重后的文本写入目录。

        Args:
            directory: 目标目录；不存在时创建。
        Returns:
            摘要到文件名的映射。
        """

        directory.mkdir(parents=True, exist_ok=True)
        written: dict[str, str] = {}
        for digest, record in sorted(self.items.items()):
            name = f"{digest[:16]}.txt"
            (directory / name).write_bytes(record["content"])
            written[digest] = name
        return written


def load_metadata(path: Path) -> dict[str, Any]:
    """读取核实报告并检查结构版本。

    Args:
        path: 报告路径。
    Returns:
        报告内容。
    Raises:
        NoticeFailure: 报告不可读或结构版本不符。
    """

    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise NoticeFailure(f"核实报告不可读：{error}") from error
    if not isinstance(document, Mapping) or document.get("schema") != EXPECTED_SCHEMA:
        raise NoticeFailure(f"核实报告结构版本不符，期望 {EXPECTED_SCHEMA}")
    if not isinstance(document.get("components"), list):
        raise NoticeFailure("核实报告缺少 components 列表")
    return dict(document)


def closure_digest_from_jar(jar_path: Path, entries: Sequence[str]) -> str:
    """直接从 JAR 重算第三方构件闭包摘要。

    Args:
        jar_path: 可执行 JAR。
        entries: 报告登记的第三方构件条目名。
    Returns:
        十六进制 SHA-256。
    Raises:
        NoticeFailure: 报告登记的构件在产物里不存在。
    """

    with zipfile.ZipFile(jar_path) as jar:
        present = set(jar.namelist())
        missing = [entry for entry in entries if entry not in present]
        if missing:
            raise NoticeFailure(f"报告登记的 {len(missing)} 个第三方构件不在产物内，例如 {missing[0]}")
        lines = sorted(hashlib.sha256(jar.read(entry)).hexdigest() for entry in entries)
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def embedded_texts(jar: zipfile.ZipFile, entry: str) -> list[tuple[str, bytes]]:
    """读出单个第三方构件自带的许可证文本条目。

    Args:
        jar: 已打开的可执行 JAR。
        entry: 构件在 JAR 内的条目名。
    Returns:
        (构件内条目名, 文本字节) 列表；构件不可读时为空列表。
    """

    try:
        payload = jar.read(entry)
        with zipfile.ZipFile(io.BytesIO(payload)) as inner:
            names = [name for name in sorted(inner.namelist())
                     if name.rsplit("/", 1)[-1].upper().startswith(("LICENSE", "LICENCE", "NOTICE", "COPYING"))
                     and not name.endswith("/")]
            return [(name, inner.read(name)) for name in names]
    except (KeyError, zipfile.BadZipFile):
        return []


def render_notices(metadata: Mapping[str, Any], jar_path: Path, store: TextStore,
                   written: Mapping[str, str]) -> str:
    """渲染 THIRD-PARTY-NOTICES 正文。

    Args:
        metadata: 核实报告。
        jar_path: 被绑定的可执行 JAR。
        store: 已收集的许可证原文。
        written: 摘要到文本文件名的映射。
    Returns:
        完整正文文本。
    """

    components = sorted(
        (item for item in metadata["components"] if item.get("classification") == "third-party"),
        key=lambda item: (item.get("coordinates") or item.get("file_name", "")),
    )
    first_party = sorted(item.get("coordinates") or item.get("file_name", "")
                         for item in metadata["components"]
                         if item.get("classification") == "first-party")
    lines: list[str] = [
        "THIRD-PARTY-NOTICES",
        "====================",
        "",
        f"适用构件：{jar_path.name}",
        f"第三方构件闭包 SHA-256：{metadata.get('components_closure_sha256', '')}"
        "（只由各第三方构件自身的 SHA-256 决定；核对方可从 JAR 直接重算，"
        "本文件被打包进产物后该值不变）",
        f"生成时的产物 SHA-256：{metadata.get('artifact_sha256', '')}"
        "（本文件与 licenses/ 被打包后产物摘要会随之变化）",
        f"第三方组件数：{len(components)}；自有模块数：{len(first_party)}",
        f"许可证标识符标准文本来源：{metadata.get('sources', {}).get('spdx_license_list', '')}"
        f"（tag {metadata.get('spdx_reference', '')}）",
        f"坐标与许可证元数据来源：{metadata.get('sources', {}).get('maven_central', '')}",
        "",
        DISCLAIMER,
        "",
        "阅读方式：每个组件给出坐标、版本、包内条目、许可证标识符与上游声明原文；"
        "许可证正文放在 licenses/ 目录下，本文件按 SHA-256 短摘要引用，"
        "同一份文本只存一份。标为“原文未随包提供”的组件，其条款文本地址见该组件条目。",
        "",
        "一、第三方组件",
        "",
    ]
    for item in components:
        coordinates = item.get("coordinates") or ""
        lines.append(f"--- {coordinates or '(坐标未确定)'} ---")
        if item.get("coordinate_source") and item["coordinate_source"] != "jar-pom-properties":
            lines.append(f"坐标来源：{item['coordinate_source']}；{item.get('coordinate_evidence', '')}")
        lines.append(f"包内条目：{item.get('jar_entry', '')}")
        identifiers = item.get("spdx_ids") or []
        lines.append(f"许可证标识符：{'、'.join(identifiers) if identifiers else '未能确定'}")
        lines.append(f"许可证声明来源：{item.get('license_source', 'unknown')}"
                     f"{('；' + item['license_pom_url']) if item.get('license_pom_url') else ''}")
        for declared in item.get("licenses") or []:
            distribution = f"，distribution={declared.get('distribution')}" if declared.get("distribution") else ""
            lines.append(f"上游声明：{declared.get('name', '')}；{declared.get('url') or '未给出 URL'}{distribution}")
        quote = item.get("license_evidence_quote") or ""
        if quote:
            lines.append("来源逐字引文：")
            lines.extend(f"  {row}" for row in quote.splitlines())
        if item.get("license_evidence_note"):
            lines.append(f"来源说明：{item['license_evidence_note']}")
        references: list[str] = []
        for entry in item.get("embedded_license_texts") or []:
            target = written.get(entry.get("sha256", ""), "")
            if target:
                references.append(f"构件自带 {entry.get('entry', '')} → licenses/{target}")
        for text in item.get("spdx_texts") or []:
            target = written.get(text.get("sha256", ""), "")
            if text.get("retrieved") == "已取回" and target:
                references.append(f"SPDX 标准文本 {text.get('spdx_id', '')} → licenses/{target}")
            else:
                references.append(f"SPDX 标准文本 {text.get('spdx_id', '')} 未取回，原文地址 {text.get('url', '')}")
        if references:
            lines.append("许可证原文位置：")
            lines.extend(f"  {item}" for item in references)
        else:
            lines.append("许可证原文位置：原文未随包提供；条款地址见上方“上游声明”。")
        for review in item.get("needs_legal_review") or []:
            candidate = f"，候选标识符 {review['candidate_spdx_id']}" if review.get("candidate_spdx_id") else ""
            lines.append(f"需人工确认：{review.get('name', '')}{candidate} —— {review.get('reason', '')}")
        lines.append("")
    lines.extend([
        "二、本项目自有模块（许可待有权者决定，本文件不作授予）",
        "",
    ])
    lines.extend(f"- {coordinates}" for coordinates in first_party)
    lines.extend([
        "",
        "三、生成方式",
        "",
        "本文件由 scripts/license/generate_third_party_notices.py 从核实报告生成；"
        "核实报告由 scripts/license/resolve_component_metadata.py 产生，"
        "每条坐标、许可证标识符与原文位置都带来源。Maven 把本文件与 licenses/ 目录打进"
        "可执行 JAR 的 META-INF/ 下，随交付物一起分发。",
        "",
    ])
    return "\n".join(lines)


def collect_texts(metadata: Mapping[str, Any], jar_path: Path, store: TextStore) -> None:
    """收集所有第三方构件的许可证原文。

    Args:
        metadata: 核实报告。
        jar_path: 被绑定的可执行 JAR。
        store: 文本仓库，原地写入。
    """

    with zipfile.ZipFile(jar_path) as jar:
        for item in metadata["components"]:
            if item.get("classification") != "third-party":
                continue
            coordinates = item.get("coordinates") or item.get("file_name", "")
            for name, content in embedded_texts(jar, item.get("jar_entry", "")):
                store.add(content, f"构件自带 {name}", coordinates)
            for text in item.get("spdx_texts") or []:
                if text.get("retrieved") == "已取回" and text.get("text"):
                    store.add(text["text"].encode("utf-8"),
                              f"SPDX {text.get('spdx_id', '')}", coordinates)


def generate(metadata_path: Path, jar_path: Path, out_dir: Path,
             copy_to: Path | None = None) -> dict[str, Any]:
    """生成许可材料并返回统计信息。

    Args:
        metadata_path: 核实报告路径。
        jar_path: 被绑定的可执行 JAR。
        out_dir: 材料输出目录。
        copy_to: 可选的第二输出位置，供离线部署包把材料放在 JAR 旁边。
    Returns:
        条目数、文本文件数与实际写出的路径。
    Raises:
        NoticeFailure: 输入不可读或报告与构件不匹配。
    """

    metadata = load_metadata(metadata_path)
    if not jar_path.is_file():
        raise NoticeFailure(f"后端 JAR 不存在：{jar_path}")
    third_party_entries = [str(item.get("jar_entry", ""))
                           for item in metadata["components"]
                           if item.get("classification") == "third-party"]
    expected = str(metadata.get("components_closure_sha256", ""))
    if expected:
        actual = closure_digest_from_jar(jar_path, third_party_entries)
        if actual != expected:
            raise NoticeFailure(
                f"核实报告的第三方构件闭包摘要为 {expected[:12]}…，"
            f"与实际 JAR 重算的 {actual[:12]}… 不一致")
    store = TextStore()
    collect_texts(metadata, jar_path, store)
    licenses_dir = out_dir / "META-INF" / LICENSES_DIR
    written = store.write(licenses_dir)
    notices_path = out_dir / "META-INF" / NOTICES_NAME
    notices_path.parent.mkdir(parents=True, exist_ok=True)
    notices_path.write_text(render_notices(metadata, jar_path, store, written), encoding="utf-8")
    if copy_to is not None:
        copy_to.parent.mkdir(parents=True, exist_ok=True)
        copy_to.write_text(notices_path.read_text(encoding="utf-8"), encoding="utf-8")
    third_party = sum(1 for item in metadata["components"]
                      if item.get("classification") == "third-party")
    return {
        "third_party": third_party,
        "first_party": sum(1 for item in metadata["components"]
                           if item.get("classification") == "first-party"),
        "license_texts": len(written),
        "notices": notices_path,
        "notices_sha256": sha256_of(notices_path),
        "notices_bytes": notices_path.stat().st_size,
        "licenses_dir": licenses_dir,
    }


def parse_arguments(argv: Sequence[str] | None = None) -> argparse.Namespace:
    """解析命令行参数。

    Args:
        argv: 原始命令行参数；省略时读取进程参数。
    Returns:
        已解析的参数。
    """

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata", type=Path, required=True,
                        help="resolve_component_metadata.py 生成的核实报告")
    parser.add_argument("--jar", type=Path, required=True, help="报告所绑定的后端可执行 JAR")
    parser.add_argument("--out-dir", type=Path, required=True,
                        help="材料输出目录；文件写入其 META-INF/ 下")
    parser.add_argument("--copy-to", type=Path,
                        help="可选的第二输出位置，例如 JAR 同目录下的同名文件")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    """生成材料并输出统计。

    Args:
        argv: 原始命令行参数；省略时读取进程参数。
    Returns:
        进程退出码；0 表示材料已生成，2 表示输入不可用。
    """

    arguments = parse_arguments(argv)
    try:
        result = generate(arguments.metadata, arguments.jar, arguments.out_dir, arguments.copy_to)
    except NoticeFailure as error:
        print(f"第三方许可材料无法生成：{error}", file=sys.stderr)
        return 2
    log(f"第三方组件 {result['third_party']} 个、自有模块 {result['first_party']} 个，"
        f"去重后许可证文本 {result['license_texts']} 份")
    log(f"材料已写入 {result['notices']}（{result['notices_bytes']} 字节，"
        f"SHA-256 {result['notices_sha256'][:16]}…）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
