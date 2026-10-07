"""验证许可元数据核实与许可材料生成：只用合成构件，不访问网络、不读取真实交付物。

反例覆盖四类"看起来通过"的情形：把聚合构件里别的模块当成构件自身坐标、把读不到声明当成
声明为某个许可证、把没取到的原文当成随包提供，以及拿旧报告配新构件照样生成材料。
用例全部使用合成 JAR、合成 POM 与本地临时 Maven 仓库，联网路径用替身拦截并断言未被调用。

@author 李杰
"""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import pytest

from scripts.license import generate_third_party_notices as notices
from scripts.license import resolve_component_metadata as metadata

POM_NAMESPACED = b"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>org.example</groupId>
  <artifactId>widget</artifactId>
  <version>1.0.0</version>
  <licenses>
    <license>
      <name>Apache License, Version 2.0</name>
      <url>https://www.apache.org/licenses/LICENSE-2.0.txt</url>
    </license>
  </licenses>
</project>
"""
# 真实存在的历史写法：org.apache.xmlbeans 5.3.0 的 POM 根元素没有 Maven 命名空间。
POM_WITHOUT_NAMESPACE = b"""<?xml version="1.0" encoding="UTF-8"?>
<project>
    <modelVersion>4.0.0</modelVersion>
    <groupId>org.example</groupId>
    <artifactId>legacy</artifactId>
    <version>2.0</version>
    <licenses>
        <license>
            <name>The Apache Software License, Version 2.0</name>
            <url>https://www.apache.org/licenses/LICENSE-2.0.txt</url>
        </license>
    </licenses>
</project>
"""
POM_PARENT = b"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.example</groupId>
    <artifactId>parent</artifactId>
    <version>1.0.0</version>
  </parent>
  <artifactId>widget</artifactId>
  <version>1.0.0</version>
</project>
"""
POM_PARENT_DECLARING = b"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>org.example</groupId>
  <artifactId>parent</artifactId>
  <version>1.0.0</version>
  <licenses>
    <license>
      <name>MIT License</name>
      <url>https://opensource.org/license/mit</url>
    </license>
  </licenses>
</project>
"""
POM_WITHOUT_LICENSE = b"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>org.example</groupId>
  <artifactId>widget</artifactId>
  <version>1.0.0</version>
</project>
"""


def write_pom(repository: Path, group: str, artifact: str, version: str, content: bytes) -> Path:
    """在合成 Maven 仓库中写入一份 POM。

    Args:
        repository: 合成仓库根目录。
        group: 构件 groupId。
        artifact: 构件 artifactId。
        version: 构件版本。
        content: POM 内容。
    Returns:
        实际写入的 POM 路径。
    """

    directory = repository / group.replace(".", "/") / artifact / version
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{artifact}-{version}.pom"
    path.write_bytes(content)
    return path


def write_local_artifact(repository: Path, group: str, artifact: str, version: str,
                         payload: bytes) -> Path:
    """在合成 Maven 仓库中写入一份构件 JAR。

    Args:
        repository: 合成仓库根目录。
        group: 构件 groupId。
        artifact: 构件 artifactId。
        version: 构件版本。
        payload: JAR 字节内容。
    Returns:
        实际写入的 JAR 路径。
    """

    directory = repository / group.replace(".", "/") / artifact / version
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{artifact}-{version}.jar"
    path.write_bytes(payload)
    return path


def component_jar(entries: dict[str, str]) -> bytes:
    """构造一个合成第三方构件 JAR。

    Args:
        entries: 构件内条目名到文本内容的映射。
    Returns:
        JAR 字节。
    """

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def application_jar(components: dict[str, bytes]) -> bytes:
    """构造一个合成可执行 JAR。

    Args:
        components: `BOOT-INF/lib/*.jar` 条目名到字节内容的映射。
    Returns:
        JAR 字节。
    """

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, payload in components.items():
            archive.writestr(name, payload)
    return buffer.getvalue()


def properties_of(group: str, artifact: str, version: str) -> str:
    """构造与真实构件一致的 pom.properties 内容。

    Args:
        group: 构件 groupId。
        artifact: 构件 artifactId。
        version: 构件版本。
    Returns:
        文本内容。
    """

    return f"groupId={group}\nartifactId={artifact}\nversion={version}\n"


def write_jar(path: Path, components: dict[str, bytes]) -> Path:
    """把合成可执行 JAR 写入磁盘。

    Args:
        path: 目标路径。
        components: 构件条目名到字节内容的映射。
    Returns:
        实际写入的路径。
    """

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(application_jar(components))
    return path


def write_report(path: Path, jar: Path, records: list[dict[str, object]]) -> Path:
    """写入一份结构与真实产物一致的核实报告。

    Args:
        path: 报告路径。
        jar: 报告所绑定的 JAR。
        records: 逐组件记录。
    Returns:
        实际写入的路径。
    """

    document = {
        "schema": metadata.RESOLUTION_SCHEMA,
        "status": "metadata-only",
        "artifact": jar.name,
        "artifact_sha256": metadata.sha256_bytes(jar.read_bytes()),
        "components_closure_sha256": metadata.closure_digest(records),
        "spdx_reference": metadata.SPDX_REF,
        "sources": {"spdx_license_list": metadata.SPDX_RAW, "maven_central": metadata.CENTRAL_BASE},
        "components": records,
    }
    path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
    return path


def digest_of(payload: bytes) -> str:
    """返回构件字节的摘要，供测试记录与闭包摘要保持一致。

    Args:
        payload: 构件字节内容。
    Returns:
        十六进制 SHA-256。
    """

    return metadata.sha256_bytes(payload)


def record_of(entry: str, coordinates: str, *, licenses: list[dict[str, str]] | None = None,
              spdx_ids: list[str] | None = None, embedded: list[dict[str, str]] | None = None,
              classification: str = "third-party", license_source: str = "local-pom",
              needs_review: list[dict[str, str]] | None = None,
              sha256: str = "", spdx_texts: list[dict[str, str]] | None = None) -> dict[str, object]:
    """构造一条与真实报告同构的组件记录。

    Args:
        entry: 包内条目名。
        coordinates: 组件坐标。
        licenses: 上游声明的许可证条目。
        spdx_ids: 映射出的 SPDX 标识符。
        embedded: 构件自带许可证文本条目。
        classification: 第三方或自有。
        license_source: 许可证声明来源。
        needs_review: 需人工确认的条目。
        sha256: 构件摘要；为空时按条目名生成占位值。
        spdx_texts: SPDX 标准文本记录。
    Returns:
        组件记录。
    """

    return {
        "jar_entry": entry,
        "file_name": entry.rsplit("/", 1)[-1],
        "sha256": sha256 or entry,
        "coordinates": coordinates,
        "coordinate_source": "jar-pom-properties",
        "coordinate_evidence": "构件内 META-INF/maven/**/pom.properties",
        "classification": classification,
        "embedded_license_texts": embedded or [],
        "licenses": licenses or [],
        "license_source": license_source,
        "license_pom_url": f"{metadata.CENTRAL_BASE}/example/{coordinates.split(':')[1]}/pom.xml",
        "license_chain": [],
        "spdx_ids": spdx_ids or [],
        "spdx_mappings": [],
        "needs_legal_review": needs_review or [],
        "spdx_texts": spdx_texts or [],
        "unresolved": [],
    }


# --------------------------------------------------------------------------- POM 解析


def test_pom_without_namespace_still_reads_licenses() -> None:
    """无命名空间的历史 POM 也必须读出声明，否则会把"没读出来"记成"上游没声明"。"""

    licenses, parent = metadata.parse_pom(POM_WITHOUT_NAMESPACE)

    assert [item["name"] for item in licenses] == ["The Apache Software License, Version 2.0"]
    assert parent is None


def test_pom_parent_is_read_without_namespace() -> None:
    """父构件坐标按本地名读取，命名空间缺失不影响父链上溯。"""

    licenses, parent = metadata.parse_pom(POM_PARENT)

    assert licenses == []
    assert parent == ("org.example", "parent", "1.0.0")


def test_pom_license_url_drives_spdx_mapping() -> None:
    """SPDX 标识符按上游声明的许可证 URL 映射，并记录映射依据。"""

    result = metadata.map_license_to_spdx(
        [{"name": "Apache License, Version 2.0", "url": "https://www.apache.org/licenses/LICENSE-2.0.txt"}])

    assert result["identifiers"] == ["Apache-2.0"]
    assert result["mappings"][0]["mapping_basis"] == "POM 声明的许可证 URL"
    assert result["needs_review"] == []


def test_unregistered_license_stays_unmapped() -> None:
    """未登记的声明写法不产生标识符，只列入待确认。"""

    result = metadata.map_license_to_spdx(
        [{"name": "GNU Lesser Public License", "url": "http://www.gnu.org/licenses/lgpl.html"}])

    assert result["identifiers"] == []
    assert result["needs_review"][0]["candidate_spdx_id"] == ""


def test_variant_license_name_is_flagged_for_review() -> None:
    """写法不是 SPDX 标准名称时只登记候选并标记待确认。"""

    result = metadata.map_license_to_spdx(
        [{"name": "GNU Library or Lesser General Public License (LGPL) V2.1",
          "url": "http://www.gnu.org/licenses/lgpl-2.1.html"}])

    assert result["identifiers"] == []
    assert result["needs_review"][0]["candidate_spdx_id"] == "LGPL-2.1-only"


# --------------------------------------------------------------------------- 坐标核实


def test_pom_properties_must_match_component_file_name() -> None:
    """聚合构件内部的 pom.properties 只有与文件名对齐的那份才属于构件自身。"""

    entries = [
        "META-INF/maven/org.example.inside/inside/pom.properties",
        "META-INF/maven/org.example/widget/pom.properties",
    ]
    payload = component_jar({
        entries[0]: properties_of("org.example.inside", "inside", "1.0.0"),
        entries[1]: properties_of("org.example", "widget", "1.0.0"),
    })

    chosen, candidates = metadata.coordinates_from_pom_properties(entries, payload, "widget-1.0.0.jar")

    assert chosen == "org.example:widget:1.0.0"
    assert candidates == ["org.example.inside:inside:1.0.0", "org.example:widget:1.0.0"]


def test_shaded_jar_without_own_properties_is_not_guessed() -> None:
    """聚合构件没有自身属性文件时不得把被打包进去的模块当成它的坐标。"""

    entry = "META-INF/maven/org.example.inside/inside/pom.properties"
    payload = component_jar({entry: properties_of("org.example.inside", "inside", "1.0.0")})

    chosen, candidates = metadata.coordinates_from_pom_properties([entry], payload, "widget-1.0.0.jar")

    assert chosen == ""
    assert candidates == ["org.example.inside:inside:1.0.0"]


def test_local_repository_match_requires_identical_bytes(tmp_path: Path) -> None:
    """本机仓库同名构件必须与包内构件逐字节一致才算坐标证据。"""

    payload = component_jar({"META-INF/services/x": "1"})
    repository = tmp_path / "m2"
    write_local_artifact(repository, "org.example", "widget", "1.0.0", payload)
    local = metadata.LocalRepository(root=repository)
    local.build()

    coordinates, source, evidence = metadata.resolve_coordinate(
        "widget-1.0.0.jar", payload, local, repository, metadata.Fetcher(allowed=False))

    assert coordinates == "org.example:widget:1.0.0"
    assert source == "local-maven-repository"
    assert "逐字节一致" in evidence


def test_local_repository_mismatch_is_not_evidence(tmp_path: Path) -> None:
    """同名构件内容不一致时不能据此认定坐标。"""

    payload = component_jar({"META-INF/services/x": "1"})
    repository = tmp_path / "m2"
    write_local_artifact(repository, "org.example", "widget", "1.0.0",
                         component_jar({"META-INF/services/x": "2"}))
    local = metadata.LocalRepository(root=repository)
    local.build()

    coordinates, source, evidence = metadata.resolve_coordinate(
        "widget-1.0.0.jar", payload, local, repository, metadata.Fetcher(allowed=False))

    assert coordinates == ""
    assert source == "unresolved"
    assert "不一致" in evidence


# --------------------------------------------------------------------------- 许可证核实


def test_license_chain_follows_parent(tmp_path: Path) -> None:
    """自身 POM 未声明时沿父 POM 链继承，并记录声明处。"""

    write_pom(tmp_path, "org.example", "parent", "1.0.0", POM_PARENT_DECLARING)
    write_pom(tmp_path, "org.example", "widget", "1.0.0", POM_PARENT)

    result = metadata.resolve_license_declaration(
        "org.example", "widget", "1.0.0", tmp_path, metadata.Fetcher(allowed=False))

    assert result["source"] == "inherited-from-parent-pom"
    assert [item["name"] for item in result["licenses"]] == ["MIT License"]
    assert [step["coordinates"] for step in result["chain"]] == [
        "org.example:widget:1.0.0", "org.example:parent:1.0.0"]


def test_offline_run_never_touches_the_network(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """默认离线：取数器不得发起任何请求，读不到就如实留空。"""

    def fail(*_args: object, **_kwargs: object) -> bytes:
        """任何网络调用都让用例失败。"""
        raise AssertionError("离线模式不得访问网络")

    monkeypatch.setattr(metadata.Fetcher, "read", fail)
    write_pom(tmp_path, "org.example", "widget", "1.0.0", POM_WITHOUT_LICENSE)

    result = metadata.resolve_license_declaration(
        "org.example", "widget", "1.0.0", tmp_path, metadata.Fetcher(allowed=False))

    assert result["licenses"] == []
    assert result["unresolved_reason"]


def test_additional_evidence_requires_source_url(tmp_path: Path) -> None:
    """补充证据缺来源地址时直接失败，不允许"凭印象"补条款。"""

    table = tmp_path / "evidence.json"
    table.write_text(json.dumps({"components": {"widget-1.0.0.jar": {"licenses": []}}}),
                     encoding="utf-8")

    with pytest.raises(metadata.MetadataFailure, match="source_url"):
        metadata.load_additional_evidence(table)


def test_additional_evidence_merges_and_keeps_quote(tmp_path: Path) -> None:
    """补充证据合并后保留逐字引文，并按同一映射规则给出标识符。"""

    records = [record_of("BOOT-INF/lib/widget-1.0.0.jar", "org.example:widget:1.0.0",
                         license_source="own-pom-without-licenses")]
    table = tmp_path / "evidence.json"
    table.write_text(json.dumps({"components": {"widget-1.0.0.jar": {
        "licenses": [{"name": "Creative Commons Attribution License 2.5",
                      "url": "http://creativecommons.org/licenses/by/2.5", "distribution": ""}],
        "quote": "Released under the Creative Commons Attribution License",
        "source": "central-sources-jar-header",
        "source_url": "https://repo1.maven.org/maven2/x/y-sources.jar",
    }}}, ensure_ascii=False), encoding="utf-8")

    metadata.apply_additional_evidence(records, metadata.load_additional_evidence(table),
                                       metadata.Fetcher(allowed=False))

    assert records[0]["license_source"] == "central-sources-jar-header"
    assert records[0]["spdx_ids"] == ["CC-BY-2.5"]
    assert "Creative Commons" in records[0]["license_evidence_quote"]


# --------------------------------------------------------------------------- 材料生成


def test_notices_list_coordinates_identifiers_and_text_locations(tmp_path: Path) -> None:
    """材料必须给出坐标、标识符与原文位置，不能只写一句"第三方许可"。"""

    payload = component_jar({
        "META-INF/services/x": "1",
        "META-INF/LICENSE.txt": "widget license text",
    })
    jar = write_jar(tmp_path / "app.jar", {"BOOT-INF/lib/widget-1.0.0.jar": payload})
    text_sha = metadata.sha256_bytes(b"widget license text")
    records = [record_of(
        "BOOT-INF/lib/widget-1.0.0.jar", "org.example:widget:1.0.0", sha256=digest_of(payload),
        licenses=[{"name": "Apache License, Version 2.0",
                   "url": "https://www.apache.org/licenses/LICENSE-2.0.txt", "distribution": "repo"}],
        spdx_ids=["Apache-2.0"],
        embedded=[{"entry": "META-INF/LICENSE.txt", "sha256": text_sha, "bytes": "19"}],
    )]
    report = write_report(tmp_path / "report.json", jar, records)
    out = tmp_path / "out"

    result = notices.generate(report, jar, out)
    text = (out / "META-INF" / notices.NOTICES_NAME).read_text(encoding="utf-8")

    assert result["third_party"] == 1
    assert "org.example:widget:1.0.0" in text
    assert "Apache-2.0" in text
    assert "META-INF/LICENSE.txt → licenses/" in text
    assert (out / "META-INF" / notices.LICENSES_DIR / f"{text_sha[:16]}.txt").is_file()


def test_identical_license_texts_are_stored_once(tmp_path: Path) -> None:
    """同一份许可证原文只存一份，材料按摘要引用，避免体积无意义膨胀。"""

    shared = b"same license text"
    shared_sha = metadata.sha256_bytes(shared)
    first = component_jar({"META-INF/LICENSE.txt": shared.decode()})
    second = component_jar({"META-INF/LICENSE.txt": shared.decode()})
    jar = write_jar(tmp_path / "app.jar", {
        "BOOT-INF/lib/one-1.0.0.jar": first,
        "BOOT-INF/lib/two-1.0.0.jar": second,
    })
    embedded = [{"entry": "META-INF/LICENSE.txt", "sha256": shared_sha, "bytes": str(len(shared))}]
    records = [
        record_of("BOOT-INF/lib/one-1.0.0.jar", "org.example:one:1.0.0", embedded=embedded,
                  sha256=digest_of(first)),
        record_of("BOOT-INF/lib/two-1.0.0.jar", "org.example:two:1.0.0", embedded=embedded,
                  sha256=digest_of(second)),
    ]
    report = write_report(tmp_path / "report.json", jar, records)
    out = tmp_path / "out"

    result = notices.generate(report, jar, out)

    assert result["license_texts"] == 1
    assert len(list((out / "META-INF" / notices.LICENSES_DIR).iterdir())) == 1


def test_component_without_license_text_records_address_not_guess(tmp_path: Path) -> None:
    """构件没有自带原文时只登记条款地址，不得代写条款。"""

    payload = component_jar({"META-INF/services/x": "1"})
    jar = write_jar(tmp_path / "app.jar", {"BOOT-INF/lib/widget-1.0.0.jar": payload})
    records = [record_of(
        "BOOT-INF/lib/widget-1.0.0.jar", "org.example:widget:1.0.0", sha256=digest_of(payload),
        licenses=[{"name": "Apache License, Version 2.0",
                   "url": "https://www.apache.org/licenses/LICENSE-2.0.txt", "distribution": ""}],
        spdx_ids=["Apache-2.0"],
    )]
    report = write_report(tmp_path / "report.json", jar, records)
    out = tmp_path / "out"

    notices.generate(report, jar, out)
    text = (out / "META-INF" / notices.NOTICES_NAME).read_text(encoding="utf-8")

    assert "原文未随包提供" in text
    assert "https://www.apache.org/licenses/LICENSE-2.0.txt" in text


def test_first_party_modules_are_listed_without_license_grant(tmp_path: Path) -> None:
    """自有模块只列坐标并注明待决定，材料不替权利方授予许可。"""

    third = component_jar({"META-INF/services/x": "1"})
    own = component_jar({"com/basicframework/Own.class": "0"})
    jar = write_jar(tmp_path / "app.jar", {
        "BOOT-INF/lib/widget-1.0.0.jar": third,
        "BOOT-INF/lib/basic-framework-common-1.0.0.jar": own,
    })
    records = [
        record_of("BOOT-INF/lib/widget-1.0.0.jar", "org.example:widget:1.0.0",
                  sha256=digest_of(third)),
        record_of("BOOT-INF/lib/basic-framework-common-1.0.0.jar",
                  f"{metadata.FIRST_PARTY_GROUP}:basic-framework-common:1.0.0",
                  classification="first-party", sha256=digest_of(own)),
    ]
    report = write_report(tmp_path / "report.json", jar, records)
    out = tmp_path / "out"

    notices.generate(report, jar, out)
    text = (out / "META-INF" / notices.NOTICES_NAME).read_text(encoding="utf-8")

    assert "本项目自有模块（许可待有权者决定，本文件不作授予）" in text
    assert f"{metadata.FIRST_PARTY_GROUP}:basic-framework-common:1.0.0" in text


def test_stale_report_is_rejected(tmp_path: Path) -> None:
    """报告与构件的闭包摘要不一致时直接失败，不能拿旧报告生成新材料。"""

    jar = write_jar(tmp_path / "app.jar", {
        "BOOT-INF/lib/widget-1.0.0.jar": component_jar({"META-INF/services/x": "1"}),
    })
    records = [record_of("BOOT-INF/lib/widget-1.0.0.jar", "org.example:widget:1.0.0",
                         sha256="0" * 64)]
    report = write_report(tmp_path / "report.json", jar, records)

    with pytest.raises(notices.NoticeFailure, match="闭包摘要"):
        notices.generate(report, jar, tmp_path / "out")


def test_report_schema_mismatch_is_rejected(tmp_path: Path) -> None:
    """结构版本不符的旧报告不能继续生成材料。"""

    jar = write_jar(tmp_path / "app.jar", {})
    report = tmp_path / "report.json"
    report.write_text(json.dumps({"schema": "component-license-metadata/v0", "components": []}),
                      encoding="utf-8")

    with pytest.raises(notices.NoticeFailure, match="结构版本"):
        notices.generate(report, jar, tmp_path / "out")


def test_closure_digest_ignores_extra_assets(tmp_path: Path) -> None:
    """闭包摘要只由第三方构件决定：把许可材料放进产物后摘要不变，材料才能自证对应关系。"""

    payload = component_jar({"META-INF/services/x": "1"})
    jar = write_jar(tmp_path / "app.jar", {"BOOT-INF/lib/widget-1.0.0.jar": payload})
    entries = ["BOOT-INF/lib/widget-1.0.0.jar"]
    before = notices.closure_digest_from_jar(jar, entries)

    with zipfile.ZipFile(jar, "a") as archive:
        archive.writestr("META-INF/THIRD-PARTY-NOTICES", "material")

    assert notices.closure_digest_from_jar(jar, entries) == before


def test_closure_digest_excludes_first_party_modules(tmp_path: Path) -> None:
    """自有模块重新构建后字节必然变化，闭包摘要不能把它算进来，否则永远核对不上。"""

    third = component_jar({"META-INF/services/x": "1"})
    own = component_jar({"com/basicframework/Own.class": "0"})
    jar = write_jar(tmp_path / "app.jar", {
        "BOOT-INF/lib/widget-1.0.0.jar": third,
        "BOOT-INF/lib/basic-framework-common-1.0.0.jar": own,
    })
    records = [
        record_of("BOOT-INF/lib/widget-1.0.0.jar", "org.example:widget:1.0.0",
                  sha256=digest_of(third)),
        record_of("BOOT-INF/lib/basic-framework-common-1.0.0.jar",
                  f"{metadata.FIRST_PARTY_GROUP}:basic-framework-common:1.0.0",
                  classification="first-party", sha256=digest_of(own)),
    ]
    report = write_report(tmp_path / "report.json", jar, records)
    out = tmp_path / "out"

    notices.generate(report, jar, out)

    # 用同样的构件名重建，自有模块字节不同：材料内容与闭包摘要都应保持一致。
    rebuilt = write_jar(tmp_path / "rebuilt" / "app.jar", {
        "BOOT-INF/lib/widget-1.0.0.jar": third,
        "BOOT-INF/lib/basic-framework-common-1.0.0.jar": component_jar({"com/basicframework/Own.class": "1"}),
    })

    assert notices.generate(report, rebuilt, out)["notices_sha256"] == notices.generate(
        report, jar, out)["notices_sha256"]


def test_missing_component_in_artifact_is_rejected(tmp_path: Path) -> None:
    """报告登记的第三方构件在产物里缺失时直接失败，不能生成对不上的材料。"""

    payload = component_jar({"META-INF/services/x": "1"})
    jar = write_jar(tmp_path / "app.jar", {"BOOT-INF/lib/widget-1.0.0.jar": payload})
    records = [record_of("BOOT-INF/lib/widget-1.0.0.jar", "org.example:widget:1.0.0",
                         sha256=digest_of(payload))]
    report = write_report(tmp_path / "report.json", jar, records)
    stripped = write_jar(tmp_path / "stripped.jar", {})

    with pytest.raises(notices.NoticeFailure, match="不在产物内"):
        notices.generate(report, stripped, tmp_path / "out")


def test_main_reports_failure_exit_code(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """主入口在输入不可用时返回 2 并说明原因，不静默成功。"""

    report = tmp_path / "report.json"
    report.write_text("{}", encoding="utf-8")

    code = notices.main(["--metadata", str(report), "--jar", str(tmp_path / "missing.jar"),
                         "--out-dir", str(tmp_path / "out")])

    assert code == 2
    assert "无法生成" in capsys.readouterr().err
