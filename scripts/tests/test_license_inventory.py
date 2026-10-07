"""验证许可盘点：只登记交付物中可核实的事实，读不到的缺口如实留空而不是猜测。

反例覆盖三类"看起来通过"的情形：把读不到的许可证当成已知、把自有模块误算成第三方缺口，
以及把锁文件口径的构建期依赖当成交付物实际包含的组件。用例全部使用合成 JAR、合成压缩包
与合成锁文件，不读取真实交付物，也不访问网络。

@author 李杰
"""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import pytest

from scripts.license import license_inventory as inventory

POM_WITH_LICENSE = b"""<?xml version="1.0" encoding="UTF-8"?>
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
POM_WITH_PARENT = b"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.example</groupId>
    <artifactId>parent</artifactId>
    <version>1.0.0</version>
  </parent>
  <artifactId>widget</artifactId>
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
POM_PROPERTIES = b"groupId=org.example\nartifactId=widget\nversion=1.0.0\n"


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


def properties_of(group: str, artifact: str, version: str) -> bytes:
    """构造与真实构件一致的 pom.properties 内容。

    Args:
        group: 构件 groupId。
        artifact: 构件 artifactId。
        version: 构件版本。
    Returns:
        pom.properties 字节内容。
    """

    return f"groupId={group}\nartifactId={artifact}\nversion={version}\n".encode("utf-8")


def make_component(group: str, artifact: str, *, version: str = "1.0.0",
                   license_text: str | None = "LICENSE") -> bytes:
    """构造一个合成第三方组件 JAR。

    Args:
        group: 写入 pom.properties 的 groupId；为空表示不写坐标。
        artifact: 写入 pom.properties 的 artifactId。
        version: 写入 pom.properties 的版本。
        license_text: 组件内自带的许可证文本文件名；为空表示不带。
    Returns:
        组件 JAR 字节。
    """

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("META-INF/services/org.example.Service", "")
        if group and artifact:
            archive.writestr(f"META-INF/maven/{group}/{artifact}/pom.properties",
                             properties_of(group, artifact, version))
        if license_text:
            archive.writestr(f"META-INF/{license_text}", "synthetic license text")
    return buffer.getvalue()


def make_application_jar(components: dict[str, bytes]) -> bytes:
    """构造一个合成可执行 JAR。

    Args:
        components: JAR 内条目名到字节内容的映射。
    Returns:
        JAR 字节。
    """

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, payload in components.items():
            archive.writestr(name, payload)
    return buffer.getvalue()


def write_jar(path: Path, components: dict[str, bytes]) -> Path:
    """把合成可执行 JAR 写入磁盘。

    Args:
        path: 目标路径。
        components: JAR 内条目名到字节内容的映射。
    Returns:
        实际写入的路径。
    """

    path.write_bytes(make_application_jar(components))
    return path


def test_license_text_detection_matches_names_only() -> None:
    """只有按名称提供的许可证文件才算随包声明，目录名含 license 不算。"""

    assert inventory.is_license_text("META-INF/LICENSE")
    assert inventory.is_license_text("META-INF/maven/x/pom.xml/NOTICE.txt")
    assert inventory.is_license_text("LICENSE")
    assert not inventory.is_license_text("js/license-banner.js")
    assert not inventory.is_license_text("assets/licenses-index.json")


def test_license_text_detection_also_requires_text_content() -> None:
    """名字命中但内容是编译产物的条目不是许可证文本，盘点不得据此声称"随包提供"。"""

    assert inventory.is_license_text("io/swagger/v3/oas/models/info/License.class")
    assert not inventory.is_text_content(b"\xca\xfe\xba\xbe\x00\x01class-body")
    assert not inventory.is_text_content(b"")
    assert not inventory.is_text_content(b"\xff\xfe not utf8")
    assert inventory.is_text_content("条款\n".encode("utf-8"))


def test_backend_scan_excludes_class_files_from_embedded_texts(tmp_path: Path) -> None:
    """第三方类文件不得被登记为"构件自带的许可证文本"。"""

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as component:
        component.writestr("META-INF/maven/org.example/widget/pom.properties",
                           properties_of("org.example", "widget", "1.0.0"))
        component.writestr("META-INF/LICENSE.txt", "synthetic license text")
        component.writestr("io/swagger/v3/core/jackson/mixin/LicenseMixin.class",
                           b"\xca\xfe\xba\xbe\x00\x01class-body")
    jar = write_jar(tmp_path / "app.jar", {"BOOT-INF/lib/widget-1.0.0.jar": buffer.getvalue()})
    repository = tmp_path / "repository"
    repository.mkdir()

    backend = inventory.scan_backend_jar(jar, repository)

    assert backend["components"][0]["embedded_license_texts"] == ["META-INF/LICENSE.txt"]


def test_pom_licenses_reads_declared_names(tmp_path: Path) -> None:
    """POM 中直接声明的许可证名必须按原文读出。"""

    assert inventory.pom_licenses(POM_WITH_LICENSE) == ["Apache License, Version 2.0"]


def test_pom_licenses_absent_returns_empty_not_default(tmp_path: Path) -> None:
    """未声明许可证时返回空列表，不填入任何默认许可证。"""

    assert inventory.pom_licenses(POM_WITHOUT_LICENSE) == []


def test_pom_parent_is_optional() -> None:
    """父构件坐标只在真实声明时返回。"""

    assert inventory.pom_parent(POM_WITH_PARENT) == ("org.example", "parent", "1.0.0")
    assert inventory.pom_parent(POM_WITHOUT_LICENSE) is None


def test_resolve_licenses_uses_own_pom(tmp_path: Path) -> None:
    """自身 POM 声明的许可证优先，来源标记为 own-pom。"""

    write_pom(tmp_path, "org.example", "widget", "1.0.0", POM_WITH_LICENSE)

    licenses, source = inventory.resolve_licenses(tmp_path, "org.example", "widget", "1.0.0")

    assert licenses == ["Apache License, Version 2.0"]
    assert source == "own-pom"


def test_resolve_licenses_follows_parent_chain(tmp_path: Path) -> None:
    """自身未声明时沿父 POM 链解析，并如实标记继承来源。"""

    write_pom(tmp_path, "org.example", "parent", "1.0.0", POM_WITH_LICENSE)
    write_pom(tmp_path, "org.example", "widget", "1.0.0", POM_WITH_PARENT)

    licenses, source = inventory.resolve_licenses(tmp_path, "org.example", "widget", "1.0.0")

    assert licenses == ["Apache License, Version 2.0"]
    assert source == "inherited-from-parent"


def test_resolve_licenses_missing_pom_is_unknown(tmp_path: Path) -> None:
    """本机读不到 POM 时如实记为 unknown，不做推测填充。"""

    licenses, source = inventory.resolve_licenses(tmp_path, "org.absent", "widget", "9.9.9")

    assert licenses == []
    assert source == "unknown"


def test_resolve_licenses_pom_without_license_is_distinct(tmp_path: Path) -> None:
    """读得到 POM 但没有许可证声明，与完全读不到 POM 是两种不同缺口。"""

    write_pom(tmp_path, "org.example", "widget", "1.0.0", POM_WITHOUT_LICENSE)

    licenses, source = inventory.resolve_licenses(tmp_path, "org.example", "widget", "1.0.0")

    assert licenses == []
    assert source == "own-pom-without-licenses"


def test_component_coordinates_reads_embedded_properties() -> None:
    """组件坐标以构件内 pom.properties 为准，不按文件名猜测。"""

    payload = make_component("org.example", "widget")

    assert inventory.component_coordinates(["META-INF/maven/org.example/widget/pom.properties"],
                                          payload, "widget-1.0.0.jar") == "org.example:widget:1.0.0"


def test_component_coordinates_absent_is_empty_string() -> None:
    """构件内没有坐标信息时返回空串，不从文件名反推。"""

    assert inventory.component_coordinates(["META-INF/services/x"], make_component("", ""),
                                           "widget-1.0.0.jar") == ""


def test_component_coordinates_ignore_bundled_modules_of_shaded_jar() -> None:
    """聚合打包的构件内有多个 pom.properties，只有与文件名对齐的才是构件自身。"""

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("META-INF/maven/org.example.inside/inside/pom.properties",
                         properties_of("org.example.inside", "inside", "1.0.0"))
        archive.writestr("META-INF/maven/org.example/widget/pom.properties",
                         properties_of("org.example", "widget", "1.0.0"))
    payload = buffer.getvalue()

    assert inventory.component_coordinates(
        ["META-INF/maven/org.example.inside/inside/pom.properties",
         "META-INF/maven/org.example/widget/pom.properties"],
        payload, "widget-1.0.0.jar") == "org.example:widget:1.0.0"
    # 构件自身的属性文件缺失时不能把被打包进去的模块当成构件坐标。
    assert inventory.component_coordinates(
        ["META-INF/maven/org.example.inside/inside/pom.properties"],
        payload, "widget-1.0.0.jar") == ""


def test_backend_scan_reports_no_license_text_and_unresolved_component(tmp_path: Path) -> None:
    """交付 JAR 内没有任何许可证文本时必须如实报告为空。"""

    write_pom(tmp_path, "org.example", "widget", "1.0.0", POM_WITH_LICENSE)
    jar = write_jar(tmp_path / "app.jar", {
        "BOOT-INF/lib/widget-1.0.0.jar": make_component("org.example", "widget"),
        "BOOT-INF/lib/mystery-1.2.3.jar": make_component("", ""),
        "BOOT-INF/classes/com/example/App.class": b"\xca\xfe",
    })

    backend = inventory.scan_backend_jar(jar, tmp_path)
    by_entry = {item["jar_entry"]: item for item in backend["components"]}

    assert backend["license_text_entries_in_artifact"] == []
    assert backend["bundled_libraries"] == 2
    assert backend["third_party_components"] == 2
    assert by_entry["BOOT-INF/lib/widget-1.0.0.jar"]["license_names"] == [
        "Apache License, Version 2.0"]
    assert by_entry["BOOT-INF/lib/widget-1.0.0.jar"]["license_source"] == "own-pom"
    assert by_entry["BOOT-INF/lib/mystery-1.2.3.jar"]["license_names"] == []
    assert by_entry["BOOT-INF/lib/mystery-1.2.3.jar"]["license_source"] == "unknown"
    assert backend["components_with_unresolved_coordinates"] == ["BOOT-INF/lib/mystery-1.2.3.jar"]
    assert backend["components_without_license_metadata"] == ["BOOT-INF/lib/mystery-1.2.3.jar"]


def test_backend_scan_separates_first_party_modules(tmp_path: Path) -> None:
    """自有模块没有许可证声明属权利决定，不能算成第三方合规缺口。"""

    own = inventory.JarComponent(jar_entry="BOOT-INF/lib/basic-framework-common-1.0.0.jar",
                                 coordinates=f"{inventory.FIRST_PARTY_GROUP}:basic-framework-common:1.0",
                                 size_bytes=1)
    other = inventory.JarComponent(jar_entry="BOOT-INF/lib/widget-1.0.0.jar",
                                   coordinates="org.example:widget:1.0", size_bytes=1)
    write_pom(tmp_path, "org.example", "widget", "1.0.0", POM_WITH_LICENSE)
    jar = write_jar(tmp_path / "app.jar", {
        "BOOT-INF/lib/basic-framework-common-1.0.0.jar": make_component(
            inventory.FIRST_PARTY_GROUP, "basic-framework-common", license_text=None),
        "BOOT-INF/lib/widget-1.0.0.jar": make_component("org.example", "widget"),
    })

    backend = inventory.scan_backend_jar(jar, tmp_path)

    classifications = {item["jar_entry"]: item["classification"] for item in backend["components"]}
    assert classifications["BOOT-INF/lib/basic-framework-common-1.0.0.jar"] == "first-party"
    assert classifications["BOOT-INF/lib/widget-1.0.0.jar"] == "third-party"
    assert own.first_party and not other.first_party
    assert backend["first_party_modules"] == [
        f"{inventory.FIRST_PARTY_GROUP}:basic-framework-common:1.0.0"]
    # 自有模块不计入第三方缺口：那是许可选择未决，不是第三方声明缺失。
    assert backend["components_without_license_metadata"] == []
    assert backend["third_party_components"] == 1


def test_backend_scan_flags_copyleft_metadata(tmp_path: Path) -> None:
    """LGPL/GPL 类条款必须单独列出，其再分发条件与 Apache-2.0 不同。"""

    write_pom(tmp_path, "org.example", "widget", "1.0.0", POM_WITH_LICENSE.replace(
        b"Apache License, Version 2.0", b"LGPL-2.1-only"))
    jar = write_jar(tmp_path / "app.jar", {
        "BOOT-INF/lib/widget-1.0.0.jar": make_component("org.example", "widget")})

    backend = inventory.scan_backend_jar(jar, tmp_path)

    assert backend["components_with_copyleft_license_metadata"] == [
        "org.example:widget:1.0.0：LGPL-2.1-only"]
    assert any("LGPL" in item for item in backend["needs_authority"])


def test_backend_scan_rejects_unreadable_jar(tmp_path: Path) -> None:
    """JAR 不可读时如实失败，不产出空清单冒充已盘点。"""

    broken = tmp_path / "broken.jar"
    broken.write_bytes(b"not a zip")

    with pytest.raises(inventory.InventoryFailure):
        inventory.scan_backend_jar(broken, tmp_path)


def test_frontend_archive_reports_missing_license_and_unknown_assets(tmp_path: Path) -> None:
    """前端交付包没有许可证文本、且含来源不明的字体图像时必须如实登记。"""

    archive_path = tmp_path / "前端交付包.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("index.html", "<html></html>")
        archive.writestr("ttf/iconfont.ttf", b"\x00\x01")
        archive.writestr("brand-logo.png", b"\x89PNG")
        archive.writestr("交付清单.json", json.dumps({"build": {"context": {"mode": "production"}}}))
    archive_path.write_bytes(archive_path.read_bytes())

    frontend = inventory.scan_frontend_archive(archive_path)

    assert frontend["license_text_entries"] == []
    assert frontend["entries"] == 4
    assert {item["kind"] for item in frontend["assets"]} == {"字体", "图像"}
    assert all(item["provenance"] == "unrecorded" for item in frontend["assets"])
    assert frontend["declared_build"] == {"context": {"mode": "production"}}


def test_frontend_archive_records_license_text_when_present(tmp_path: Path) -> None:
    """交付包确实携带许可证文件时必须登记，不能只报缺口。"""

    archive_path = tmp_path / "frontend.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("index.html", "<html></html>")
        archive.writestr("LICENSE", "synthetic license text")

    frontend = inventory.scan_frontend_archive(archive_path)

    assert frontend["license_text_entries"] == ["LICENSE"]


def test_lockfile_scope_is_explicit_and_unknown_packages_are_listed(tmp_path: Path) -> None:
    """锁文件口径必须写明含构建期依赖，读不到 license 的包如实列出。"""

    lock = tmp_path / "pnpm-lock.yaml"
    lock.write_text(
        "lockfileVersion: '9.0'\n"
        "packages:\n"
        "  '@scope/known@1.0.0':\n"
        "    resolution: {integrity: sha512-x}\n"
        "  'missing@2.0.0':\n"
        "    resolution: {integrity: sha512-y}\n",
        encoding="utf-8")
    modules = tmp_path / "node_modules"
    (modules / ".pnpm" / "@scope+known@1.0.0" / "node_modules" / "@scope" / "known").mkdir(parents=True)
    (modules / ".pnpm" / "@scope+known@1.0.0" / "node_modules" / "@scope" / "known"
     / "package.json").write_text(json.dumps({"name": "@scope/known", "license": "MIT"}),
                                  encoding="utf-8")

    result = inventory.scan_lockfile(lock, modules)

    assert result["packages"] == 2
    assert "构建期" in result["scope"]
    assert result["packages_without_license"] == ["missing"]
    licenses = {record["package"]: record["license"] for record in result["records"]}
    assert licenses["@scope/known"] == "MIT"
    assert licenses["missing"] == "unknown"


def test_main_requires_at_least_one_target(tmp_path: Path) -> None:
    """没有盘点目标时入口必须退出 2。"""

    assert inventory.main(["--out", str(tmp_path / "out.json")]) == 2


def test_main_writes_inventory_for_real_inputs(tmp_path: Path) -> None:
    """入口必须把清单写到指定路径并返回 0。"""

    jar = write_jar(tmp_path / "app.jar", {"BOOT-INF/lib/widget.jar": make_component("", "")})
    out = tmp_path / "out.json"

    assert inventory.main(["--jar", str(jar), "--out", str(out),
                           "--maven-repo", str(tmp_path)]) == 0
    document = json.loads(out.read_text(encoding="utf-8"))
    assert document["schema"] == inventory.INVENTORY_SCHEMA
    assert document["status"] == "inventory-only"
    assert document["backend"]["bundled_libraries"] == 1
    assert "不构成合规结论" in document["disclaimer"]


def test_inventory_never_marks_itself_as_a_gate(tmp_path: Path) -> None:
    """盘点结果不得出现"合规/通过"这类判定词，避免被误当成门禁结论。"""

    jar = write_jar(tmp_path / "app.jar", {"BOOT-INF/lib/widget.jar": make_component("", "")})
    out = tmp_path / "out.json"

    assert inventory.main(["--jar", str(jar), "--out", str(out),
                           "--maven-repo", str(tmp_path)]) == 0
    document = json.loads(out.read_text(encoding="utf-8"))
    serialized = json.dumps(document, ensure_ascii=False).replace("不构成合规结论", "")

    assert "合规" not in serialized
    assert "已批准" not in serialized
    assert document["status"] == "inventory-only"


def test_manifest_of_the_tool_does_not_claim_authority() -> None:
    """入口文档必须写明本工具不代替有权者判断，避免被当成已批准结论。"""

    source = Path(inventory.__file__).read_text(encoding="utf-8")

    assert "不代替有权者判断" in source
    assert "inventory-only" in source
