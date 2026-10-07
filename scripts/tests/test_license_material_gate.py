"""验证第三方许可材料门禁：只用合成可执行 JAR，不读取真实交付物。

门禁的意义是"漏生成就发布不出去"，因此用例必须能构造出**几种看起来能发布**的情形并证明
它们都被拦下：材料完全缺失、材料少登记一条、材料里的坐标被改写、许可证正文被替换、
材料与产物不是同一份；同时证明正常产物通过、"未准备状态"被 `--require-prepared` 拒绝。

闭包摘要按材料生成器的同一口径在用例里**独立重算**，避免门禁与生成器共用一处实现而互相
掩盖缺陷；每份合成构件都放进真实的 `BOOT-INF/lib` 条目，门禁读的是与真实交付物同样的字节。

@author 李杰
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

import pytest

from scripts.license import verify_license_materials as gate

# 合成第三方构件：一个包内能自证坐标，一个没有 pom.properties（真实聚合件的形态）。
SELF_DECLARED = ("org.example", "widget", "1.0.0")
OPAQUE = ("", "", "")
# 自有模块坐标：与真实交付物一样以 `com.basicframework` 开头、文件名以 basic-framework- 开头。
OWN = ("com.basicframework", "basic-framework-demo-common", "1.0.0")
LICENSE_TEXT = b"Apache License\nVersion 2.0\n"


def component_jar(group: str, artifact: str, version: str) -> bytes:
    """构造一个只含 pom.properties 与一个标记类的合成第三方构件。

    Args:
        group: groupId；空串表示不写 pom.properties，模拟包内无法自证的构件。
        artifact: artifactId。
        version: 版本。
    Returns:
        构件字节。
    """

    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w") as inner:
        inner.writestr("com/example/Marker.class", b"\xca\xfe\xba\xbe")
        if group:
            inner.writestr(
                f"META-INF/maven/{group}/{artifact}/pom.properties",
                f"groupId={group}\nartifactId={artifact}\nversion={version}\n",
            )
    return payload.getvalue()


def closure_digest(payloads: dict[str, bytes]) -> str:
    """按材料生成器的同一口径计算第三方构件闭包摘要。

    Args:
        payloads: 构件条目名到字节的映射。
    Returns:
        十六进制 SHA-256。
    """

    lines = sorted(hashlib.sha256(value).hexdigest() for value in payloads.values())
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def render_notices(components: list[tuple[str, str]], digest: str, reference: str,
                   *, declared: int | None = None, own: list[str] | None = None) -> str:
    """渲染一份合成材料正文，格式与真实材料一致。

    Args:
        components: (坐标, 包内条目) 列表。
        digest: 头部记录的闭包摘要。
        reference: 被引用的许可证正文摘要短前缀。
        declared: 头部声明的第三方组件数；缺省取列表长度。
        own: 自有模块坐标列表。
    Returns:
        材料正文。
    """

    own_coordinates = own if own is not None else [":".join(OWN)]
    lines = [
        "THIRD-PARTY-NOTICES",
        "====================",
        "",
        "适用构件：demo.jar",
        f"第三方构件闭包 SHA-256：{digest}",
        f"第三方组件数：{declared if declared is not None else len(components)}；"
        f"自有模块数：{len(own_coordinates)}",
        "",
        "一、第三方组件",
        "",
    ]
    for coordinates, entry in components:
        lines.extend([f"--- {coordinates} ---", f"包内条目：{entry}",
                      "许可证标识符：Apache-2.0", "许可证原文位置：",
                      f"  LICENSE → licenses/{reference}.txt", ""])
    lines.extend(["二、本项目自有模块（许可待有权者决定，本文件不作授予）", ""])
    lines.extend(f"- {item}" for item in own_coordinates)
    lines.extend(["", "三、生成方式", ""])
    return "\n".join(lines)


def build_jar(directory: Path, *, notices: str | None, payloads: dict[str, bytes],
              texts: dict[str, bytes] | None = None) -> Path:
    """把合成材料与构件写成一个可执行 JAR。

    Args:
        directory: 输出目录。
        notices: 材料正文；`None` 表示完全不随包材料。
        payloads: 第三方构件条目名到字节的映射。
        texts: 许可证正文摘要短前缀到字节的映射。
    Returns:
        JAR 路径。
    """

    directory.mkdir(parents=True, exist_ok=True)
    jar_path = directory / "demo.jar"
    with zipfile.ZipFile(jar_path, "w") as jar:
        jar.writestr("META-INF/MANIFEST.MF", "Manifest-Version: 1.0\n")
        for entry, payload in payloads.items():
            jar.writestr(entry, payload)
        jar.writestr(f"{gate.LIBRARY_PREFIX}{OWN[1]}-{OWN[2]}.jar", component_jar(*OWN))
        if notices is not None:
            jar.writestr(gate.NOTICES_ENTRY, notices)
        for digest, payload in (texts or {}).items():
            jar.writestr(f"{gate.LICENSES_PREFIX}{digest}.txt", payload)
    return jar_path


def run(jar: Path, *arguments: str) -> tuple[int, dict[str, object]]:
    """执行门禁主函数并返回退出码与证据。

    Args:
        jar: 被核验的 JAR。
        arguments: 追加命令行参数。
    Returns:
        (退出码, 证据结构)。
    """

    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(io.StringIO()):
        code = gate.main(["--jar", str(jar), "--json", *arguments])
    text = buffer.getvalue()
    return code, json.loads(text) if "{" in text else {}


def failures(document: dict[str, object]) -> set[str]:
    """取出证据里未通过的检查名。

    Args:
        document: 门禁证据结构。
    Returns:
        未通过的检查名集合。
    """

    return {str(item["name"]) for item in document.get("checks", [])
            if item["status"] == "failed"}


@pytest.fixture(name="delivery")
def delivery_fixture(tmp_path: Path) -> dict[str, object]:
    """构造一份材料齐全、与构件闭包一致的合成交付物作为各用例起点。

    Args:
        tmp_path: pytest 提供的临时目录。
    Returns:
        含 JAR、构件字节、材料正文与正文摘要的可变字典。
    """

    payloads = {
        "BOOT-INF/lib/widget-1.0.0.jar": component_jar(*SELF_DECLARED),
        "BOOT-INF/lib/opaque-2.0.0.jar": component_jar(*OPAQUE),
    }
    digest = hashlib.sha256(LICENSE_TEXT).hexdigest()[:16]
    components = [
        ("org.example:widget:1.0.0", "BOOT-INF/lib/widget-1.0.0.jar"),
        ("org.example:opaque:2.0.0", "BOOT-INF/lib/opaque-2.0.0.jar"),
    ]
    body = render_notices(components, closure_digest(payloads), digest)
    jar = build_jar(tmp_path / "ok", notices=body, payloads=payloads, texts={digest: LICENSE_TEXT})
    return {"jar": jar, "payloads": payloads, "components": components,
            "notices": body, "digest": digest, "root": tmp_path}


def test_complete_materials_pass(delivery: dict[str, object]) -> None:
    """材料齐全且与构件闭包一致时门禁通过，正常路径不能被误伤。

    Args:
        delivery: 合成交付物。
    """

    code, document = run(delivery["jar"])
    assert code == 0
    assert document["status"] == "passed"
    assert document["measurements"]["third_party_components"] == 2
    assert document["measurements"]["own_modules"] == 1


def test_missing_notices_is_rejected(delivery: dict[str, object]) -> None:
    """产物完全没有随包材料时必须失败，这正是本门禁要拦的漏生成场景。

    Args:
        delivery: 合成交付物。
    """

    jar = build_jar(delivery["root"] / "absent", notices=None, payloads=delivery["payloads"])
    code, document = run(jar)
    assert code == 1
    assert "notices-present" in failures(document)


def test_one_entry_short_is_rejected(delivery: dict[str, object]) -> None:
    """材料少登记一条时，条数与条目覆盖都必须失败。

    Args:
        delivery: 合成交付物。
    """

    body = render_notices(delivery["components"][:1],
                          closure_digest(delivery["payloads"]), delivery["digest"])
    jar = build_jar(delivery["root"] / "short", notices=body, payloads=delivery["payloads"],
                    texts={delivery["digest"]: LICENSE_TEXT})
    code, document = run(jar)
    assert code == 1
    assert {"component-count", "entry-coverage"} <= failures(document)


def test_declared_count_must_match_entries(delivery: dict[str, object]) -> None:
    """头部声明条数与实际条目不一致时同样失败，不能只靠头部自述通过。

    Args:
        delivery: 合成交付物。
    """

    body = render_notices(delivery["components"], "0" * 64, delivery["digest"], declared=5)
    jar = build_jar(delivery["root"] / "declared", notices=body, payloads=delivery["payloads"],
                    texts={delivery["digest"]: LICENSE_TEXT})
    code, document = run(jar)
    assert code == 1
    assert {"component-count", "closure-digest"} <= failures(document)


def test_tampered_coordinate_is_rejected(delivery: dict[str, object]) -> None:
    """材料里的坐标被改写时，构件自身声明不一致的门禁必须失败。

    Args:
        delivery: 合成交付物。
    """

    components = [("com.attacker:widget:1.0.0", delivery["components"][0][1]),
                  delivery["components"][1]]
    body = render_notices(components, closure_digest(delivery["payloads"]), delivery["digest"])
    jar = build_jar(delivery["root"] / "tampered", notices=body, payloads=delivery["payloads"],
                    texts={delivery["digest"]: LICENSE_TEXT})
    code, document = run(jar)
    assert code == 1
    assert "coordinates" in failures(document)


def test_altered_license_text_is_rejected(delivery: dict[str, object]) -> None:
    """正文内容与文件名摘要不符时必须失败，正文被替换不能蒙混过关。

    Args:
        delivery: 合成交付物。
    """

    jar = build_jar(delivery["root"] / "altered", notices=delivery["notices"],
                    payloads=delivery["payloads"],
                    texts={delivery["digest"]: LICENSE_TEXT + "（已被替换）\n".encode()})
    code, document = run(jar)
    assert code == 1
    assert "license-texts" in failures(document)


def test_missing_license_text_is_rejected(delivery: dict[str, object]) -> None:
    """材料引用的正文在产物里缺失时必须失败。

    Args:
        delivery: 合成交付物。
    """

    jar = build_jar(delivery["root"] / "missing-text", notices=delivery["notices"],
                    payloads=delivery["payloads"], texts={})
    code, document = run(jar)
    assert code == 1
    assert "license-texts" in failures(document)


def test_compiled_artifact_in_license_texts_is_rejected(delivery: dict[str, object]) -> None:
    """条款目录里混进编译产物时必须失败。

    这棵目录会被 Maven 当作资源复制进 `target/classes`；第三方类文件一旦落进去，
    覆盖率报告就会出现第三方包名，发布链被 report-source-unmanaged 卡死。
    门禁必须在材料层就拦住，而不是等覆盖率门禁报出第三方包名。

    Args:
        delivery: 合成交付物。
    """

    compiled = b"\xca\xfe\xba\xbe\x00\x01third-party-class-body"
    digest = hashlib.sha256(compiled).hexdigest()[:16]
    notices = render_notices(delivery["components"], closure_digest(delivery["payloads"]), digest)
    jar = build_jar(delivery["root"] / "compiled-text", notices=notices,
                    payloads=delivery["payloads"], texts={digest: compiled})
    code, document = run(jar)
    assert code == 1
    assert "license-texts" in failures(document)


def test_own_modules_must_match_artifacts(delivery: dict[str, object]) -> None:
    """自有模块漏登记时必须失败，第三方与自有的划分不能只靠声明。

    Args:
        delivery: 合成交付物。
    """

    body = render_notices(delivery["components"], closure_digest(delivery["payloads"]),
                          delivery["digest"], own=[])
    jar = build_jar(delivery["root"] / "own", notices=body, payloads=delivery["payloads"],
                    texts={delivery["digest"]: LICENSE_TEXT})
    code, document = run(jar)
    assert code == 1
    assert "own-modules" in failures(document)


def test_require_prepared_rejects_unprepared_state(delivery: dict[str, object]) -> None:
    """要求已准备时，缺准备目录必须失败。

    Args:
        delivery: 合成交付物。
    """

    code, document = run(delivery["jar"], "--require-prepared",
                         "--prepared-dir", str(delivery["root"] / "not-prepared"))
    assert code == 1
    assert "prepared-state" in failures(document)


def test_require_prepared_rejects_stale_materials(delivery: dict[str, object]) -> None:
    """准备目录与 JAR 内材料不是同一份时必须失败，避免打包用到旧材料。

    Args:
        delivery: 合成交付物。
    """

    notices_file = delivery["root"] / "stale" / "META-INF" / "THIRD-PARTY-NOTICES"
    notices_file.parent.mkdir(parents=True)
    notices_file.write_text("上一轮的材料\n", encoding="utf-8")
    code, document = run(delivery["jar"], "--require-prepared",
                         "--prepared-dir", str(notices_file.parent.parent))
    assert code == 1
    assert "prepared-state" in failures(document)


def test_require_prepared_accepts_matching_materials(delivery: dict[str, object]) -> None:
    """准备目录与 JAR 内材料一致时通过，发布链的正向形态不能被误伤。

    Args:
        delivery: 合成交付物。
    """

    notices_file = delivery["root"] / "prepared" / "META-INF" / "THIRD-PARTY-NOTICES"
    notices_file.parent.mkdir(parents=True)
    with zipfile.ZipFile(delivery["jar"]) as jar:
        notices_file.write_bytes(jar.read(gate.NOTICES_ENTRY))
    code, document = run(delivery["jar"], "--require-prepared",
                         "--prepared-dir", str(notices_file.parent.parent))
    assert code == 0
    assert document["status"] == "passed"


def test_missing_jar_is_environment_error(tmp_path: Path) -> None:
    """产物不存在时按环境故障退出 2，不与门禁失败混为一谈。

    Args:
        tmp_path: pytest 提供的临时目录。
    """

    code, document = run(tmp_path / "absent.jar")
    assert code == 2
    assert document.get("status") == "unavailable"


def test_json_output_is_machine_readable(delivery: dict[str, object]) -> None:
    """`--json` 时标准输出只输出证据，人读摘要不得污染机器可读输出。

    Args:
        delivery: 合成交付物。
    """

    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(io.StringIO()):
        code = gate.main(["--jar", str(delivery["jar"]), "--json"])
    assert code == 0
    assert json.loads(buffer.getvalue())["status"] == "passed"


def test_summary_goes_to_stderr_in_json_mode(delivery: dict[str, object]) -> None:
    """`--json` 时人读摘要改走标准错误，CI 重定向证据文件时才不会解析失败。

    Args:
        delivery: 合成交付物。
    """

    buffer = io.StringIO()
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(buffer):
        gate.main(["--jar", str(delivery["jar"]), "--json"])
    assert "第三方许可材料门禁" in buffer.getvalue()


def test_plain_mode_prints_summary_to_stdout(delivery: dict[str, object]) -> None:
    """不带 `--json` 时摘要在标准输出，构建日志里能直接看到读数。

    Args:
        delivery: 合成交付物。
    """

    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(io.StringIO()):
        gate.main(["--jar", str(delivery["jar"])])
    assert "第三方许可材料门禁：passed" in buffer.getvalue()
    assert sys.modules[gate.__name__] is not None