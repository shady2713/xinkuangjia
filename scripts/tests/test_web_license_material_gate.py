"""验证前端交付物许可材料门禁：只用合成的产物目录、工作区安装与分块模块表。

门禁的价值在于"产物里没有材料、材料与产物对不上、材料与真实安装对不上"都能拦住，因此用例
逐条构造这些情形并要求非零退出；正向用例证明正常产物不会被误伤。

模块标识到包名的解析在门禁里是**独立实现**，用例同时固定它的作用域、Windows 分隔符与
虚拟模块前缀行为，避免门禁与构建期插件共享同一处判断而互相背书。

@author 李杰
"""

from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import json
import sys
import zipfile
from pathlib import Path
from types import ModuleType

import pytest

ROOT = Path(__file__).resolve().parents[2]
GATE_PATH = ROOT / "前端代码" / "basic-framework-admin" / "scripts" / "quality" / \
    "license_materials_gate.py"
LICENSE_TEXT = b"MIT License\n\nCopyright (c) 2024 Someone\n"


def load_gate() -> ModuleType:
    """按真实路径加载前端门禁模块。

    Returns:
        门禁模块对象。
    """

    spec = importlib.util.spec_from_file_location("web_license_materials_gate", GATE_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


gate = load_gate()


def install(root: Path, name: str, version: str, license_value: str | None) -> Path:
    """在工作区里造一个 pnpm 布局的已安装包。

    Args:
        root: 前端工作区根目录。
        name: 包名，支持 `@scope/name`。
        version: 版本。
        license_value: `package.json` 的 license 字段；`None` 表示不写该字段。
    Returns:
        包根目录。
    """

    location = root / "node_modules" / ".pnpm" / f"{name.replace('/', '+')}@{version}" / \
        "node_modules" / name
    location.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, object] = {"name": name, "version": version}
    if license_value is not None:
        manifest["license"] = license_value
    (location / "package.json").write_text(json.dumps(manifest), encoding="utf-8")
    return location


def module_id(location: Path) -> str:
    """生成指向包内文件的 Rollup 模块标识。

    Args:
        location: 包根目录。
    Returns:
        带虚拟查询后缀的绝对路径标识。
    """

    return f"{location}/index.js?v=1"


def write_dist(root: Path, entries: list[tuple[str, str, str]],
               texts: dict[str, bytes], *, declared: int | None = None) -> Path:
    """写出合成的生产产物目录。

    Args:
        root: 前端工作区根目录。
        entries: (包名, 版本, 许可证声明) 列表。
        texts: 许可证正文摘要短前缀到字节的映射。
        declared: 头部声明的包数；缺省按条目数。
    Returns:
        产物目录。
    """

    dist = root / "apps" / "web-ele" / "dist"
    (dist / gate.LICENSES_DIR).mkdir(parents=True, exist_ok=True)
    (root / gate.LICENSE_NAME).write_bytes(LICENSE_TEXT)
    (dist / gate.LICENSE_NAME).write_bytes(LICENSE_TEXT)
    digest = hashlib.sha256(LICENSE_TEXT).hexdigest()[:16]
    lines = ["THIRD-PARTY-NOTICES", "====================", "",
             f"适用产物：合成站点",
             f"本次构建实际包含的第三方包：{declared if declared is not None else len(entries)} 个",
             "", "一、第三方包", ""]
    for name, version, declared_license in entries:
        lines.extend([f"--- {name}@{version} ---", f"许可证声明：{declared_license}",
                      f"安装位置：{name}@{version}/node_modules/{name}",
                      "许可证原文位置：", f"  LICENSE → licenses/{digest}.txt", ""])
    lines.extend(["二、工作区许可证原文", "", "三、生成方式", ""])
    (dist / gate.NOTICES_NAME).write_text("\n".join(lines), encoding="utf-8")
    for name, payload in texts.items():
        (dist / gate.LICENSES_DIR / f"{name}.txt").write_bytes(payload)
    return dist


def write_closure(root: Path, names: list[Path]) -> Path:
    """写出合成的分块模块表记录。

    Args:
        root: 前端工作区根目录。
        names: 各分块引用的包根目录列表。
    Returns:
        记录路径。
    """

    chunks = {f"js/chunk-{index}.js": [module_id(item), f"{item}/other.js"]
              for index, item in enumerate(names)}
    chunks["js/app.js"] = [str(root / "apps" / "web-ele" / "src" / "main.ts")]
    path = root / ".cache" / "build-record" / "license-closure.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"schema": gate.CLOSURE_SCHEMA, "chunks": chunks}),
                    encoding="utf-8")
    return path


def run(root: Path, *arguments: str) -> tuple[int, dict[str, object]]:
    """执行门禁主函数并返回退出码与证据。

    Args:
        root: 前端工作区根目录。
        arguments: 追加命令行参数。
    Returns:
        (退出码, 证据结构)。
    """

    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(io.StringIO()):
        code = gate.main(["--root", str(root), "--json", *arguments])
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


@pytest.fixture(name="site")
def site_fixture(tmp_path: Path) -> dict[str, object]:
    """构造一份材料齐全、与分块闭包和真实安装都一致的前端工作区。

    Args:
        tmp_path: pytest 提供的临时目录。
    Returns:
        含工作区根、包目录与正文摘要的可变字典。
    """

    root = tmp_path / "site"
    alpha = install(root, "@scope/alpha", "1.0.0", "MIT")
    beta = install(root, "beta", "2.0.0", "Apache-2.0")
    digest = hashlib.sha256(LICENSE_TEXT).hexdigest()[:16]
    entries = [("@scope/alpha", "1.0.0", "MIT"), ("beta", "2.0.0", "Apache-2.0")]
    write_dist(root, entries, {digest: LICENSE_TEXT})
    write_closure(root, [alpha, beta])
    return {"root": root, "digest": digest, "entries": entries, "alpha": alpha, "beta": beta}


def test_complete_materials_pass(site: dict[str, object]) -> None:
    """材料齐全且与分块闭包、真实安装都一致时门禁通过。

    Args:
        site: 合成前端工作区。
    """

    code, document = run(site["root"])
    assert code == 0
    assert document["status"] == "passed"
    assert document["measurements"]["chunk_referenced_packages"] == 2


def test_missing_notices_is_rejected(site: dict[str, object]) -> None:
    """产物没有随包材料时必须失败，这正是发布链要拦的漏生成场景。

    Args:
        site: 合成前端工作区。
    """

    (site["root"] / "apps" / "web-ele" / "dist" / gate.NOTICES_NAME).unlink()
    code, document = run(site["root"])
    assert code == 1
    assert "notices-present" in failures(document)


def test_missing_license_file_is_rejected(site: dict[str, object]) -> None:
    """产物缺少随包 LICENSE 原文时必须失败。

    Args:
        site: 合成前端工作区。
    """

    (site["root"] / "apps" / "web-ele" / "dist" / gate.LICENSE_NAME).unlink()
    code, document = run(site["root"])
    assert code == 1
    assert "notices-present" in failures(document)


def test_empty_material_is_rejected(site: dict[str, object]) -> None:
    """材料文件存在但为空时不构成许可材料，必须失败。

    Args:
        site: 合成前端工作区。
    """

    (site["root"] / "apps" / "web-ele" / "dist" / gate.NOTICES_NAME).write_text("", encoding="utf-8")
    code, document = run(site["root"])
    assert code == 1
    assert "notices-present" in failures(document)


def test_license_origin_must_match_workspace(site: dict[str, object]) -> None:
    """随包 LICENSE 与工作区原文不一致时必须失败，材料不能与来源脱节。

    Args:
        site: 合成前端工作区。
    """

    (site["root"] / "apps" / "web-ele" / "dist" / gate.LICENSE_NAME).write_bytes(
        LICENSE_TEXT + "（另一份）\n".encode())
    code, document = run(site["root"])
    assert code == 1
    assert "license-origin" in failures(document)


def test_declared_count_must_match_entries(site: dict[str, object]) -> None:
    """头部声明的包数与实际条目数不一致时必须失败。

    Args:
        site: 合成前端工作区。
    """

    write_dist(site["root"], site["entries"], {site["digest"]: LICENSE_TEXT}, declared=7)
    code, document = run(site["root"])
    assert code == 1
    assert "declared-count" in failures(document)


def test_package_not_installed_is_rejected(site: dict[str, object]) -> None:
    """材料登记了工作区里不存在的包时必须失败，坐标不能凭空出现。

    Args:
        site: 合成前端工作区。
    """

    entries = [*site["entries"], ("ghost", "9.9.9", "MIT")]
    write_dist(site["root"], entries, {site["digest"]: LICENSE_TEXT})
    code, document = run(site["root"])
    assert code == 1
    assert {"package-resolution", "chunk-closure"} <= failures(document)


def test_license_declaration_must_match_manifest(site: dict[str, object]) -> None:
    """材料里的许可证声明与包清单不一致时必须失败。

    Args:
        site: 合成前端工作区。
    """

    entries = [("@scope/alpha", "1.0.0", "Apache-2.0"), ("beta", "2.0.0", "Apache-2.0")]
    write_dist(site["root"], entries, {site["digest"]: LICENSE_TEXT})
    code, document = run(site["root"])
    assert code == 1
    assert "package-resolution" in failures(document)


def test_undeclared_license_is_reported(site: dict[str, object]) -> None:
    """包清单没有 license 字段时材料应如实写未声明，且该写法本身能通过。

    Args:
        site: 合成前端工作区。
    """

    gamma = install(site["root"], "gamma", "3.0.0", None)
    write_dist(site["root"], [*site["entries"], ("gamma", "3.0.0", gate.UNDECLARED)],
               {site["digest"]: LICENSE_TEXT})
    write_closure(site["root"], [site["alpha"], site["beta"], gamma])
    code, document = run(site["root"])
    assert code == 0
    assert document["measurements"]["listed_packages"] == 3


def test_closure_missing_package_is_rejected(site: dict[str, object]) -> None:
    """产物分块实际引用了却没登记的包必须失败，这是"材料与真实闭包不一致"的反例。

    Args:
        site: 合成前端工作区。
    """

    gamma = install(site["root"], "gamma", "3.0.0", "MIT")
    write_closure(site["root"], [site["alpha"], site["beta"], gamma])
    code, document = run(site["root"])
    assert code == 1
    assert "chunk-closure" in failures(document)


def test_material_extra_package_is_rejected(site: dict[str, object]) -> None:
    """材料多登记了产物没有引用的包时同样失败。

    Args:
        site: 合成前端工作区。
    """

    write_closure(site["root"], [site["alpha"]])
    code, document = run(site["root"])
    assert code == 1
    assert "chunk-closure" in failures(document)


def test_altered_license_text_is_rejected(site: dict[str, object]) -> None:
    """正文内容与文件名摘要不符时必须失败。

    Args:
        site: 合成前端工作区。
    """

    text = site["root"] / "apps" / "web-ele" / "dist" / gate.LICENSES_DIR / f"{site['digest']}.txt"
    text.write_bytes(LICENSE_TEXT + "（已替换）\n".encode())
    code, document = run(site["root"])
    assert code == 1
    assert "license-texts" in failures(document)


def test_orphan_license_text_is_rejected(site: dict[str, object]) -> None:
    """产物里存在材料没有引用的多余正文时必须失败。

    Args:
        site: 合成前端工作区。
    """

    orphan = hashlib.sha256(b"orphan text").hexdigest()[:16]
    (site["root"] / "apps" / "web-ele" / "dist" / gate.LICENSES_DIR / f"{orphan}.txt").write_bytes(
        b"orphan text")
    code, document = run(site["root"])
    assert code == 1
    assert "license-texts" in failures(document)


def test_missing_closure_record_is_environment_error(site: dict[str, object]) -> None:
    """缺少构建期分块模块表记录时按环境故障退出 2，不与门禁失败混淆。

    Args:
        site: 合成前端工作区。
    """

    (site["root"] / ".cache" / "build-record" / "license-closure.json").unlink()
    code, document = run(site["root"])
    assert code == 2
    assert document.get("status") == "unavailable"


def test_require_prepared_rejects_missing_archive(site: dict[str, object]) -> None:
    """要求已准备时缺交付压缩包必须失败。

    Args:
        site: 合成前端工作区。
    """

    code, document = run(site["root"], "--require-prepared")
    assert code == 1
    assert "delivery-archive" in failures(document)


def test_require_prepared_accepts_archive(site: dict[str, object]) -> None:
    """交付压缩包带着同一份材料时通过，打包链路不漏材料。

    Args:
        site: 合成前端工作区。
    """

    dist = site["root"] / "apps" / "web-ele" / "dist"
    archive = site["root"] / ".cache" / "release" / "前端交付包.zip"
    archive.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.write(dist / gate.NOTICES_NAME, gate.NOTICES_NAME)
        bundle.write(dist / gate.LICENSE_NAME, gate.LICENSE_NAME)
    code, document = run(site["root"], "--require-prepared")
    assert code == 0
    assert document["status"] == "passed"


def test_archive_without_materials_is_rejected(site: dict[str, object]) -> None:
    """交付压缩包里没有许可材料时必须失败，发出去的包不能不含材料。

    Args:
        site: 合成前端工作区。
    """

    archive = site["root"] / ".cache" / "release" / "前端交付包.zip"
    archive.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("index.html", "<html />")
    code, document = run(site["root"], "--require-prepared")
    assert code == 1
    assert "delivery-archive" in failures(document)


@pytest.mark.parametrize(
    ("identifier", "expected"),
    [
        ("/repo/node_modules/.pnpm/vue@3.5.31/node_modules/vue/index.js", "vue"),
        ("/repo/node_modules/.pnpm/@scope+pkg@1.0.0/node_modules/@scope/pkg/index.js",
         "@scope/pkg"),
        ("\\repo\\node_modules\\.pnpm\\vue@3.5.31\\node_modules\\vue\\index.js", "vue"),
        ("/repo/node_modules/vue/index.js?v=1", "vue"),
        ("/repo/apps/web-ele/src/main.ts", ""),
        ("/repo/node_modules/", ""),
        ("/repo/node_modules/@scope", ""),
    ],
)
def test_module_identifier_parsing(identifier: str, expected: str) -> None:
    """模块标识到包名的解析必须覆盖作用域、Windows 分隔符、查询后缀与识别不出的情形。

    Args:
        identifier: Rollup 模块标识。
        expected: 期望解析出的包名。
    """

    assert gate.package_of_module(identifier) == expected


def test_json_output_is_machine_readable(site: dict[str, object]) -> None:
    """`--json` 时标准输出只输出证据，人读摘要不得污染机器可读输出。

    Args:
        site: 合成前端工作区。
    """

    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(io.StringIO()):
        code = gate.main(["--root", str(site["root"]), "--json"])
    assert code == 0
    assert json.loads(buffer.getvalue())["status"] == "passed"