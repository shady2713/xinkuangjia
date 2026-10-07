"""按**交付产物自身的字节**核验前端第三方许可材料是否真的存在且与产物闭包一致。

生产构建里的 ``vite:third-party-notices`` 插件负责**生成**材料，但生成器自述
（"本次构建实际包含的第三方包：N 个"）不能作为门禁依据：本门禁只读交付物与工作区事实，
重新独立算一遍，任何一处对不上就非零退出。它**不生成、不补写任何材料**。

六项核对：

1. ``notices-present``：产物根目录必须真的带 ``THIRD-PARTY-NOTICES`` 与 ``LICENSE``，
   零份材料即失败。
2. ``license-origin``：随包 ``LICENSE`` 必须与工作区根目录同名文件逐字节一致，
   防止材料与来源脱节。
3. ``declared-count``：材料头部声明的包数必须与材料里实际解析出的条目数相等。
4. ``package-resolution``：每条登记的 ``name@version`` 都必须在工作区里真实安装，
   且其 ``package.json`` 声明的许可证与材料登记一致——坐标或声明被改写即失败。
5. ``license-texts``：材料引用的每一份 ``licenses/*.txt`` 都必须随包存在且内容摘要与文件名一致。
6. ``chunk-closure``：按生产构建记录的**分块模块表**独立反推包集合（压缩后的产物不再保留
   模块标识，只能在构建期留痕），与材料条目数、包名集合必须完全一致。

``--require-prepared`` 追加第 7 项 ``delivery-archive``：交付压缩包必须存在，且其中的
``THIRD-PARTY-NOTICES`` 与产物目录里的逐字节一致，确保真正发出去的那份带上材料。

运行（前端工作区根）：

    python -B -X utf8 ./scripts/quality/license_materials_gate.py --require-prepared --json

退出码：0 表示材料与产物一致；1 表示门禁失败；2 表示输入不可读（产物或构建记录缺失）。

@author 李杰
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path
from typing import Any, Mapping, Sequence

# 证据结构版本：结构变了就拒绝拿旧证据汇总发布结论。
SCHEMA = "web-license-material-gate/v1"
# 生产构建写出的闭包记录结构版本，与插件常量保持一致。
CLOSURE_SCHEMA = "web-license-closure/v1"

NOTICES_NAME = "THIRD-PARTY-NOTICES"
LICENSE_NAME = "LICENSE"
LICENSES_DIR = "licenses"
# 闭包记录默认位置：前端工作区 `.cache` 下的构建记录目录，不随交付包分发。
CLOSURE_RECORD = Path(".cache") / "build-record" / "license-closure.json"
DELIVERY_ARCHIVE = Path(".cache") / "release" / "前端交付包.zip"
DIST_DIRECTORY = Path("apps") / "web-ele" / "dist"

UNDECLARED = "包清单未声明"
COUNT_PATTERN = re.compile(r"^本次构建实际包含的第三方包：(\d+) 个")
COMPONENT_PATTERN = re.compile(r"^--- (.+) ---$")
LICENSE_DECLARATION_PATTERN = re.compile(r"^许可证声明：(.*)$")
LICENSE_REFERENCE_PATTERN = re.compile(r"licenses/([0-9a-f]{16})\.txt")
DIGEST_TEXT = re.compile(r"[0-9a-f]{16}")


class GateInputError(RuntimeError):
    """产物或构建记录不可读；属于环境故障，不表示材料内容有问题。"""


def parse_arguments(argv: Sequence[str] | None = None) -> argparse.Namespace:
    """解析命令行参数。

    Args:
        argv: 原始命令行参数；省略时读取进程参数。
    Returns:
        已解析的参数。
    """

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="前端工作区根目录")
    parser.add_argument("--dist", type=Path, help="生产产物目录，缺省取 apps/web-ele/dist")
    parser.add_argument("--closure-record", type=Path, help=f"分块模块表记录，缺省取 {CLOSURE_RECORD}")
    parser.add_argument("--require-prepared", action="store_true",
                        help="要求交付压缩包已生成且其中的材料与产物目录逐字节一致")
    parser.add_argument("--json", action="store_true", help="输出机器可读证据")
    return parser.parse_args(argv)


def read_text(path: Path, label: str) -> str:
    """读取 UTF-8 文本并把不可读输入转成明确诊断。

    Args:
        path: 文件路径。
        label: 诊断里使用的文件用途名称。
    Returns:
        文件正文。
    Raises:
        GateInputError: 文件缺失或无法按 UTF-8 解码。
    """

    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        raise GateInputError(f"{label}不可读：{path}（{error}）") from error


def parse_notices(text: str) -> dict[str, Any]:
    """解析材料正文，得到头部声明数、包条目与正文引用。

    Args:
        text: ``THIRD-PARTY-NOTICES`` 正文。
    Returns:
        含 ``declared_count``、``packages`` 与 ``license_references`` 的结构。
    """

    parsed: dict[str, Any] = {"declared_count": -1, "packages": [], "license_references": []}
    current: dict[str, str] | None = None
    for raw in text.splitlines():
        line = raw.strip()
        count = COUNT_PATTERN.match(line)
        if count:
            parsed["declared_count"] = int(count.group(1))
        header = COMPONENT_PATTERN.match(line)
        if header:
            identifier = header.group(1).strip()
            name, _, version = identifier.rpartition("@")
            current = {"identifier": identifier, "name": name or identifier,
                       "version": version, "license": ""}
            parsed["packages"].append(current)
            continue
        if line.startswith("二、"):
            current = None
            continue
        declaration = LICENSE_DECLARATION_PATTERN.match(line)
        if declaration and current is not None:
            current["license"] = declaration.group(1).strip()
        for referenced in LICENSE_REFERENCE_PATTERN.finditer(line):
            parsed["license_references"].append(referenced.group(1))
    return parsed


def package_of_module(identifier: str) -> str:
    """把 Rollup 模块标识独立解析成包名。

    本实现与构建期插件的解析**不共享代码**：门禁不能靠生成器的判断给自己作证。
    压缩后的产物已不保留模块标识，因此模块表由生产构建留痕，这里重算一遍。

    Args:
        identifier: Rollup 模块标识。
    Returns:
        包名；标识不在 ``node_modules`` 下或结构异常时返回空串。
    """

    path = identifier.split("\0")[0].replace("\\", "/")
    marker = "node_modules/"
    index = path.rfind(marker)
    if index == -1:
        return ""
    segments = [item for item in path[index + len(marker):].split("/") if item]
    if not segments:
        return ""
    if segments[0].startswith("@"):
        return f"{segments[0]}/{segments[1]}" if len(segments) > 1 else ""
    return segments[0]


def installed_packages(root: Path) -> dict[str, dict[str, str]]:
    """读取 pnpm 虚拟存储里每个已安装包的名称、版本与许可证声明。

    Args:
        root: 前端工作区根目录。
    Returns:
        `name@version` 到包清单字段的映射。
    """

    store = root / "node_modules" / ".pnpm"
    packages: dict[str, dict[str, str]] = {}
    if not store.is_dir():
        return packages
    for manifest in sorted(store.glob("*/node_modules/**/package.json")):
        try:
            document = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(document, Mapping):
            continue
        name = str(document.get("name", ""))
        version = str(document.get("version", ""))
        if not name or not version:
            continue
        declared = document.get("license")
        if isinstance(declared, Mapping):
            declared = declared.get("type")
        packages[f"{name}@{version}"] = {"name": name, "version": version,
                                         "license": str(declared) if isinstance(declared, str) else ""}
    return packages


def load_closure(path: Path) -> set[str]:
    """读取构建期留痕的分块模块表，独立反推本次产物真正引用的包集合。

    Args:
        path: 闭包记录路径。
    Returns:
        包名集合。
    Raises:
        GateInputError: 记录缺失、不可读或结构版本不符。
    """

    document = json.loads(read_text(path, "分块模块表记录"))
    if not isinstance(document, Mapping) or document.get("schema") != CLOSURE_SCHEMA:
        raise GateInputError(f"分块模块表记录结构版本不符，期望 {CLOSURE_SCHEMA}")
    chunks = document.get("chunks")
    if not isinstance(chunks, Mapping) or not chunks:
        raise GateInputError("分块模块表记录里没有分块模块列表，无法核对产物闭包")
    names: set[str] = set()
    for modules in chunks.values():
        if not isinstance(modules, list):
            raise GateInputError("分块模块表记录里的分块模块列表不是数组")
        for identifier in modules:
            if isinstance(identifier, str) and package_of_module(identifier):
                names.add(package_of_module(identifier))
    return names


def check_notices_present(dist: Path) -> dict[str, Any]:
    """核对产物根目录是否真的随包许可材料。

    Args:
        dist: 生产产物目录。
    Returns:
        单项检查结论。
    """

    missing = [name for name in (NOTICES_NAME, LICENSE_NAME) if not (dist / name).is_file()]
    if missing:
        return {"name": "notices-present", "status": "failed",
                "detail": f"产物缺少 {'、'.join(missing)}：许可材料未生成或未随产物输出，"
                          "发布前必须先执行生产构建（pnpm build:ele）"}
    empty = [name for name in (NOTICES_NAME, LICENSE_NAME) if (dist / name).stat().st_size == 0]
    if empty:
        return {"name": "notices-present", "status": "failed",
                "detail": f"产物里的 {'、'.join(empty)} 是空文件，不构成许可材料"}
    return {"name": "notices-present", "status": "passed",
            "detail": f"产物根目录含 {NOTICES_NAME} 与 {LICENSE_NAME}"}


def check_license_origin(root: Path, dist: Path) -> dict[str, Any]:
    """核对随包 LICENSE 与工作区根目录的许可证原文逐字节一致。

    Args:
        root: 前端工作区根目录。
        dist: 生产产物目录。
    Returns:
        单项检查结论。
    """

    source = root / LICENSE_NAME
    if not source.is_file():
        return {"name": "license-origin", "status": "failed",
                "detail": f"工作区根目录没有 {LICENSE_NAME} 原文，无法确认随包文件的来源"}
    if source.read_bytes() != (dist / LICENSE_NAME).read_bytes():
        return {"name": "license-origin", "status": "failed",
                "detail": f"随包 {LICENSE_NAME} 与工作区根目录的原文不一致，材料与来源脱节"}
    return {"name": "license-origin", "status": "passed",
            "detail": f"随包 {LICENSE_NAME} 与工作区原文逐字节一致"}


def check_declared_count(notices: Mapping[str, Any]) -> dict[str, Any]:
    """核对材料头部声明的包数与实际解析出的条目数相等。

    Args:
        notices: 解析后的材料结构。
    Returns:
        单项检查结论。
    """

    declared = int(notices["declared_count"])
    parsed = len(notices["packages"])
    if declared != parsed or declared <= 0:
        return {"name": "declared-count", "status": "failed",
                "detail": f"材料头部声明 {declared} 个、材料里解析出 {parsed} 条，两者必须相等且大于 0"}
    return {"name": "declared-count", "status": "passed",
            "detail": f"材料声明 {declared} 个包，与条目数一致"}


def check_package_resolution(notices: Mapping[str, Any],
                             packages: Mapping[str, Mapping[str, str]]) -> dict[str, Any]:
    """核对每条登记的包都真实安装，且许可证声明与包清单一致。

    Args:
        notices: 解析后的材料结构。
        packages: 工作区已安装包的 `name@version` 映射。
    Returns:
        单项检查结论。
    """

    unknown: list[str] = []
    mismatched: list[str] = []
    for item in notices["packages"]:
        identifier = f"{item['name']}@{item['version']}"
        manifest = packages.get(identifier)
        if manifest is None:
            unknown.append(identifier)
            continue
        expected = manifest["license"] or UNDECLARED
        if expected != item["license"]:
            mismatched.append(f"{identifier} 包清单声明 {expected}，材料登记 {item['license']}")
    if unknown or mismatched:
        detail = []
        if unknown:
            detail.append(f"{len(unknown)} 条登记在产物里但工作区没有对应安装，例如 {unknown[0]}")
        if mismatched:
            detail.append(f"{len(mismatched)} 条许可证声明与包清单不一致，例如 {mismatched[0]}")
        return {"name": "package-resolution", "status": "failed", "detail": "；".join(detail)}
    return {"name": "package-resolution", "status": "passed",
            "detail": f"{len(notices['packages'])} 个登记包均真实安装且许可证声明与包清单一致"}


def check_license_texts(dist: Path, notices: Mapping[str, Any]) -> dict[str, Any]:
    """核对随包许可证正文的存在性与内容摘要。

    Args:
        dist: 生产产物目录。
        notices: 解析后的材料结构。
    Returns:
        单项检查结论。
    """

    directory = dist / LICENSES_DIR
    present = {path.stem for path in directory.glob("*.txt")} if directory.is_dir() else set()
    referenced = set(str(item) for item in notices["license_references"])
    if not referenced:
        return {"name": "license-texts", "status": "failed",
                "detail": "材料没有引用任何一份许可证正文，随包材料不完整"}
    missing = sorted(referenced - present)
    altered = sorted(digest for digest in referenced & present
                     if not DIGEST_TEXT.fullmatch(digest)
                     or not hashlib.sha256((directory / f"{digest}.txt").read_bytes())
                     .hexdigest().startswith(digest))
    orphans = sorted(present - referenced)
    if missing or altered or orphans:
        detail = []
        if missing:
            detail.append(f"{len(missing)} 份被引用但缺失的正文，例如 {missing[0]}.txt")
        if altered:
            detail.append(f"{len(altered)} 份正文内容与文件名摘要不符，例如 {altered[0]}.txt")
        if orphans:
            detail.append(f"{len(orphans)} 份正文未被材料引用，例如 {orphans[0]}.txt")
        return {"name": "license-texts", "status": "failed", "detail": "；".join(detail)}
    return {"name": "license-texts", "status": "passed",
            "detail": f"材料引用的 {len(referenced)} 份许可证正文全部存在、摘要一致且无多余文件"}


def check_chunk_closure(notices: Mapping[str, Any], closure: set[str]) -> dict[str, Any]:
    """核对材料条目集合与产物分块实际引用的包集合完全一致。

    Args:
        notices: 解析后的材料结构。
        closure: 由分块模块表独立反推的包名集合。
    Returns:
        单项检查结论。
    """

    listed = {str(item["name"]) for item in notices["packages"]}
    missing = sorted(closure - listed)
    extra = sorted(listed - closure)
    if missing or extra:
        detail = []
        if missing:
            detail.append(f"{len(missing)} 个被产物实际引用却未登记，例如 {missing[0]}")
        if extra:
            detail.append(f"{len(extra)} 个已登记但产物没有引用，例如 {extra[0]}")
        return {"name": "chunk-closure", "status": "failed", "detail": "；".join(detail)}
    return {"name": "chunk-closure", "status": "passed",
            "detail": f"材料 {len(listed)} 个包与产物分块实际引用的 {len(closure)} 个包完全一致"}


def check_delivery_archive(archive_path: Path, dist: Path) -> dict[str, Any]:
    """核对真正交付的压缩包确实带着同一份材料。

    Args:
        archive_path: 交付压缩包路径。
        dist: 生产产物目录。
    Returns:
        单项检查结论。
    """

    if not archive_path.is_file():
        return {"name": "delivery-archive", "status": "failed",
                "detail": f"交付压缩包不存在：{archive_path}，发布前必须先执行 pnpm release:pack"}
    try:
        with zipfile.ZipFile(archive_path) as archive:
            names = set(archive.namelist())
            if NOTICES_NAME not in names or LICENSE_NAME not in names:
                return {"name": "delivery-archive", "status": "failed",
                        "detail": "交付压缩包里没有第三方许可材料，打包规则或构建产物缺项"}
            if archive.read(NOTICES_NAME) != (dist / NOTICES_NAME).read_bytes():
                return {"name": "delivery-archive", "status": "failed",
                        "detail": f"交付压缩包里的 {NOTICES_NAME} 与产物目录不是同一份"}
    except (OSError, zipfile.BadZipFile) as error:
        return {"name": "delivery-archive", "status": "failed",
                "detail": f"交付压缩包不可读：{error}"}
    return {"name": "delivery-archive", "status": "passed",
            "detail": f"交付压缩包内的 {NOTICES_NAME} 与产物目录逐字节一致"}


def verify(root: Path, dist: Path, closure_path: Path,
           archive_path: Path | None) -> dict[str, Any]:
    """对生产产物执行全部核对并返回机器可读证据。

    Args:
        root: 前端工作区根目录。
        dist: 生产产物目录。
        closure_path: 分块模块表记录路径。
        archive_path: 交付压缩包路径；`require_prepared` 为假时允许为空。
    Returns:
        含状态、逐项结论与实测读数的证据结构。
    Raises:
        GateInputError: 产物或闭包记录不可读。
    """

    presence = check_notices_present(dist)
    if presence["status"] == "failed":
        # 材料本身不在产物里时，其余核对都无从谈起；在这里如实失败，
        # 而不是让后续检查抛出与"材料缺失"无关的异常掩盖真实原因。
        return {"schema": SCHEMA, "status": "failed", "checks": [presence],
                "measurements": {"declared_packages": 0, "listed_packages": 0,
                                 "chunk_referenced_packages": 0, "license_texts": 0}}
    notices = parse_notices(read_text(dist / NOTICES_NAME, "第三方许可材料"))
    closure = load_closure(closure_path)
    packages = installed_packages(root)
    checks = [presence, check_license_origin(root, dist),
              check_declared_count(notices), check_package_resolution(notices, packages),
              check_license_texts(dist, notices), check_chunk_closure(notices, closure)]
    if archive_path is not None:
        checks.append(check_delivery_archive(archive_path, dist))
    status = "passed" if all(item["status"] == "passed" for item in checks) else "failed"
    return {
        "schema": SCHEMA,
        "status": status,
        "checks": checks,
        "measurements": {
            "declared_packages": int(notices["declared_count"]),
            "listed_packages": len(notices["packages"]),
            "chunk_referenced_packages": len(closure),
            "license_texts": len(set(str(item) for item in notices["license_references"])),
        },
    }


def report_failures(evidence: Mapping[str, Any]) -> None:
    """把未通过的检查逐条打印成可操作的诊断。

    Args:
        evidence: 门禁证据结构。
    """

    for item in evidence["checks"]:
        if item["status"] == "passed":
            continue
        print(f"[前端第三方许可材料门禁] 未通过：{item['name']} —— {item['detail']}", file=sys.stderr)


def report_summary(evidence: Mapping[str, Any], *, stream: Any = None) -> None:
    """打印一行总体读数，便于在构建日志里直接核对。

    Args:
        evidence: 门禁证据结构。
        stream: 输出流；`--json` 时传标准错误，避免污染机器可读证据。
    """

    measurements = evidence["measurements"]
    print(f"前端第三方许可材料门禁：{evidence['status']}；检查 {len(evidence['checks'])} 项，"
          f"材料登记 {measurements['listed_packages']} 个包、"
          f"产物分块实际引用 {measurements['chunk_referenced_packages']} 个包、"
          f"许可证正文 {measurements['license_texts']} 份",
          file=stream or sys.stdout, flush=True)


def resolve(root: Path, value: Path | None, default: Path) -> Path:
    """把命令行路径解析成实际路径，缺省按前端工作区内的固定位置推断。

    Args:
        root: 前端工作区根目录。
        value: 命令行给出的路径；`None` 表示使用缺省位置。
        default: 缺省位置。
    Returns:
        实际使用的路径。
    """

    chosen = value if value is not None else default
    return chosen if chosen.is_absolute() else root / chosen


def main(argv: Sequence[str] | None = None) -> int:
    """执行门禁并输出结论。

    Args:
        argv: 原始命令行参数；省略时读取进程参数。
    Returns:
        进程退出码；0 表示一致，1 表示门禁失败，2 表示输入不可读。
    """

    arguments = parse_arguments(argv)
    root = arguments.root.resolve()
    dist = resolve(root, arguments.dist, DIST_DIRECTORY)
    closure = resolve(root, arguments.closure_record, CLOSURE_RECORD)
    archive = resolve(root, None, DELIVERY_ARCHIVE) if arguments.require_prepared else None
    try:
        evidence = verify(root, dist, closure, archive)
    except GateInputError as error:
        if arguments.json:
            print(json.dumps({"schema": SCHEMA, "status": "unavailable",
                              "reason": str(error)}, ensure_ascii=False))
        print(f"前端第三方许可材料门禁无法执行：{error}", file=sys.stderr)
        return 2
    if arguments.json:
        # `--json` 时标准输出只保留机器可读证据：CI 把它直接重定向进证据文件，
        # 任何附加文本都会让证据不可解析，因此人读摘要改走标准错误。
        print(json.dumps(evidence, ensure_ascii=False, indent=2))
    if evidence["status"] != "passed":
        report_failures(evidence)
        return 1
    report_summary(evidence, stream=sys.stderr if arguments.json else None)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())