"""打包、核验并隔离检查当前前端的静态站点制品，不发布、不部署。

运行 python -B -X utf8 scripts/quality/release_artifacts.py pack|verify|smoke。
pack 要求 build:recorded 的来源与产物仍有效，输出 .cache/release/前端交付包.zip。
verify/smoke 仅读取压缩包；smoke 只在私有临时目录和环回随机端口检查静态资源。
@author 李杰
"""

from __future__ import annotations

import argparse
import functools
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import threading
import zipfile
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import quote, unquote, urlsplit
from urllib.request import ProxyHandler, build_opener

import build_record
import verify_workspace_constraints as workspace

ARCHIVE = Path(".cache/release/前端交付包.zip")
MANIFEST = "交付清单.json"
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from delivery_rules import ALLOWED, ALLOWED_EXACT, MAX_FILE, MAX_FILES, MAX_TOTAL


def safe_name(name: str) -> str:
    """校验可移植归档路径，拒绝穿越、Windows 设备名、隐藏配置及未知文件类型。"""
    parts = PurePosixPath(name).parts
    if (
        not parts
        or name.startswith("/")
        or "\\" in name
        or any(
            part in (".", "..")
            or part.startswith(".")
            or part.endswith((" ", "."))
            or re.search(r'[:*?"<>|\x00-\x1f]', part)
            or re.fullmatch(r"(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?", part)
            for part in parts
        )
    ):
        raise ValueError("交付路径不安全")
    # 许可材料既可能带后缀（licenses/…txt），也可能无后缀（LICENSE、THIRD-PARTY-NOTICES），
    # 两类都放行；其余文件仍必须命中后缀白名单。
    allowed = name in ALLOWED_EXACT or PurePosixPath(name).suffix in ALLOWED
    if "/".join(parts) != name or (name != MANIFEST and not allowed):
        raise ValueError("交付文件不在允许范围")
    return name


def archive_path(root: Path) -> Path:
    """限定输出位于当前前端真实缓存目录，拒绝任何路径段为链接。"""
    path = root / ARCHIVE
    for part in (path, *path.parents):
        if part == root:
            break
        if (part.exists() or part.is_symlink()) and workspace._link(part):
            raise ValueError("交付目录不允许链接")
    return path


def base_path(root: Path) -> str:
    """从当前生产配置读取已登记的站点前缀，不执行环境文件。"""
    content = workspace._read(root / "apps/web-ele/.env.production", root)
    found = re.findall(r"(?m)^VITE_BASE\s*=\s*([^\r\n]+)", content)
    if len(found) != 1:
        raise ValueError("生产站点前缀缺失或重复")
    value = found[0].strip().strip("'\"")
    if not re.fullmatch(r"/(?:[a-zA-Z0-9_-]+/)*", value):
        raise ValueError("站点前缀必须是同源绝对目录")
    return value


def pack(root: Path) -> Path:
    """仅打包已核验的生产产物，完整归档验证成功后原子发布到本地缓存。

    Args:
        root: 当前前端根目录。
    Returns:
        本地 ZIP 路径；不会上传或修改应用版本。
    Raises:
        ValueError: 文件范围、摘要或构建来源不一致。
    """
    record = build_record.run(root, "verify")
    directory = root / build_record.ARTIFACTS
    files: dict[str, dict[str, object]] = {}
    output = archive_path(root)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="打包-", dir=output.parent) as temporary:
        staging = Path(temporary) / "site.zip"
        with zipfile.ZipFile(staging, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            total = 0
            for path in sorted(directory.rglob("*")):
                if not path.is_file():
                    continue
                name = safe_name(path.relative_to(directory).as_posix())
                if name == MANIFEST or workspace._link(path):
                    raise ValueError("产物包含保留文件名或链接")
                size = path.stat().st_size
                total += size
                if size > MAX_FILE or total > MAX_TOTAL or len(files) >= MAX_FILES:
                    raise ValueError("交付产物超过资源上限")
                data = path.read_bytes()
                files[name] = {
                    "size": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                }
                archive.writestr(name, data)
            manifest = {
                "format": 1,
                "base": base_path(root),
                "build": record,
                "files": files,
            }
            archive.writestr(
                MANIFEST, json.dumps(manifest, ensure_ascii=False, indent=2)
            )
        # 打包期间来源及产物变化时拒绝认领；不会用新摘要掩盖旧构建记录。
        if build_record.run(root, "verify") != record:
            raise ValueError("打包期间构建记录变化")
        validate(staging)
        os.replace(staging, output)
    return output


def validate(path: Path, expected_version: str | None = None) -> dict[str, object]:
    """从 ZIP 自身验证路径、资源上限、内容摘要及构建版本，不依赖源码目录。

    Args:
        path: 待验证 ZIP。
        expected_version: 可选预期应用版本，不一致时失败。
    Returns:
        已验证交付清单。
    Raises:
        ValueError: 压缩包被篡改、不安全、不完整或版本不符。
    """
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        if (
            len(infos) > MAX_FILES + 1
            or sum(info.file_size for info in infos) > MAX_TOTAL
        ):
            raise ValueError("交付包超过资源上限")
        seen: set[str] = set()
        for info in infos:
            name = safe_name(info.filename)
            if (
                name.casefold() in seen
                or info.is_dir()
                or stat.S_ISLNK(info.external_attr >> 16)
            ):
                raise ValueError("交付包有重复路径、目录条目或链接")
            seen.add(name.casefold())
            if info.file_size > MAX_FILE or info.flag_bits & 1:
                raise ValueError("交付文件过大或被加密")
        manifest = json.loads(archive.read(MANIFEST))
        if (
            set(manifest) != {"format", "base", "build", "files"}
            or manifest["format"] != 1
        ):
            raise ValueError("交付清单格式无效")
        if not isinstance(manifest["base"], str) or not re.fullmatch(
            r"/(?:[a-zA-Z0-9_-]+/)*", manifest["base"]
        ):
            raise ValueError("交付站点前缀无效")
        files = manifest["files"]
        if not isinstance(files, dict) or set(files) | {MANIFEST} != {
            info.filename for info in infos
        }:
            raise ValueError("交付内容与清单不一致")
        if "index.html" not in files or "_app.config.js" not in files:
            raise ValueError("缺少站点入口或运行时配置")
        source = manifest["build"]["context"]["source"]
        if not re.fullmatch(r"[0-9a-f]{40,64}", source["commit"]) or not isinstance(
            source["version"], str
        ):
            raise ValueError("构建来源格式无效")
        if expected_version is not None and source["version"] != expected_version:
            raise ValueError("交付版本与预期不符")
        digest = hashlib.sha256()
        for name, metadata in sorted(files.items()):
            data = archive.read(name)
            if metadata != {
                "size": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
            }:
                raise ValueError("交付文件摘要不一致")
            relative = (build_record.ARTIFACTS / name).as_posix().encode("utf-8")
            digest.update(len(relative).to_bytes(8, "big"))
            digest.update(relative)
            digest.update(hashlib.sha256(data).digest())
        if manifest["build"]["artifacts"] != {
            "files": len(files),
            "sha256": digest.hexdigest(),
        }:
            raise ValueError("交付内容与原构建摘要不一致")
    return manifest


class EntryReferences(HTMLParser):
    """只提取页面静态脚本、样式和图标地址，不执行任何 HTML 或 JavaScript。"""

    def __init__(self) -> None:
        """初始化独立引用列表，避免跨制品共享状态。"""
        super().__init__()
        self.paths: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """收集浏览器入口资源，不把业务超链接当作静态文件。"""
        attributes = dict(attrs)
        value = (
            attributes.get("src")
            if tag == "script"
            else attributes.get("href")
            if tag == "link"
            else None
        )
        if value:
            self.paths.append(value)


class QuietHandler(SimpleHTTPRequestHandler):
    """仅供环回临时制品验证，关闭请求日志以避免暴露运行配置。"""

    def log_message(self, format: str, *args: object) -> None:
        """不记录临时验证请求，验证结果由调用方统一报告。"""


def smoke(path: Path, expected_version: str | None = None) -> dict[str, object]:
    """在私有临时目录验证已打包站点，不从工作区补文件或继承机器代理。

    Args:
        path: 已打包 ZIP。
        expected_version: 可选应用版本约束。
    Returns:
        文件数与已验证入口资源数。
    Raises:
        ValueError: 包不完整或入口引用不存在。
        OSError: 临时服务或资源请求失败。
    """
    manifest = validate(path, expected_version)
    with tempfile.TemporaryDirectory(prefix="交付隔离-") as temporary:
        directory = Path(temporary).resolve()
        site = directory / manifest["base"].strip("/")
        site.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(path) as archive:
            for name in manifest["files"]:
                target = site / safe_name(name)
                if not target.resolve().is_relative_to(directory):
                    raise ValueError("解包目标越界")
                target.parent.mkdir(parents=True, exist_ok=True)
                # 再次读取时仍核对上限和摘要，避免校验与解包之间的文件变化。
                with archive.open(name) as source:
                    data = source.read(MAX_FILE + 1)
                if len(data) > MAX_FILE or manifest["files"][name] != {
                    "size": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                }:
                    raise ValueError("解包内容与校验结果不一致")
                with target.open("xb") as destination:
                    destination.write(data)
        parser = EntryReferences()
        parser.feed((site / "index.html").read_text(encoding="utf-8"))
        urls = [manifest["base"] + "index.html"]
        for reference in parser.paths:
            parsed = urlsplit(reference)
            if parsed.scheme or parsed.netloc:
                raise ValueError("入口依赖外部资源，不能完成离线静态验收")
            decoded = unquote(parsed.path)
            if decoded.startswith("/"):
                if not decoded.startswith(manifest["base"]):
                    raise ValueError("入口资源不属于站点前缀")
                name = decoded[len(manifest["base"]) :]
            else:
                name = decoded
            if safe_name(name) not in manifest["files"]:
                raise ValueError("入口引用的资源缺失")
            urls.append(manifest["base"] + name)
        handler = functools.partial(QuietHandler, directory=str(directory))
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            opener = build_opener(ProxyHandler({}))
            for url in urls:
                with opener.open(
                    f"http://127.0.0.1:{server.server_port}{quote(url, safe='/')}",
                    timeout=5,
                ) as response:
                    body = response.read(MAX_FILE + 1)
                    name = url[len(manifest["base"]) :]
                    if (
                        response.status != 200
                        or hashlib.sha256(body).hexdigest()
                        != manifest["files"][name]["sha256"]
                    ):
                        raise ValueError("制品静态资源不可读取")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
            if thread.is_alive():
                raise RuntimeError("临时服务未退出")
    return {"files": len(manifest["files"]), "entryResources": len(urls)}


def main() -> int:
    """提供本地打包、校验与静态冒烟入口；失败返回 2，不上传任何产物。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("pack", "verify", "smoke"))
    parser.add_argument("--expected-version")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    try:
        path = archive_path(root)
        if args.action == "pack":
            print(pack(root))
        elif args.action == "smoke":
            print(json.dumps(smoke(path, args.expected_version), ensure_ascii=False))
        else:
            result = validate(path, args.expected_version)
            print(
                json.dumps(
                    {
                        "version": result["build"]["context"]["source"]["version"],
                        "files": len(result["files"]),
                    },
                    ensure_ascii=False,
                )
            )
        return 0
    except (
        ValueError,
        KeyError,
        TypeError,
        OSError,
        RuntimeError,
        zipfile.BadZipFile,
        subprocess.TimeoutExpired,
    ):
        print(
            "交付检查失败：请核对构建记录、压缩包内容、版本或静态资源。",
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
