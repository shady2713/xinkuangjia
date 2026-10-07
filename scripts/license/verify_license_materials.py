"""按**交付 JAR 自身的字节**核验第三方许可材料是否真的存在且与依赖闭包一致。

生成许可材料的两个脚本（[resolve_component_metadata.py](resolve_component_metadata.py) 与
[generate_third_party_notices.py](generate_third_party_notices.py)）都是**可选前置步骤**：
目录不存在时 Maven 的 `<resources>` 会静默跳过，构建照样成功，交付物里只是零份许可材料。
本门禁是发布链上的独立裁决者，它**只读交付物、不生成任何材料**：材料缺失、条目数与实际
`BOOT-INF/lib` 闭包不一致、或材料里的坐标被篡改时一律非零退出，让"漏生成"不再可能悄悄发布。

七项核对全部落在交付 JAR 的实际字节上：

1. `notices-present`：JAR 根目录必须真的带 `META-INF/THIRD-PARTY-NOTICES`，零份材料即失败。
2. `closure-digest`：材料里记录的第三方构件闭包摘要必须等于从 JAR 内 192 个第三方构件
   逐字节重算的值——材料与产物因此双向绑定。
3. `component-count`：材料头部声明的组件数、材料里实际解析出的条目数、JAR 里实际的第三方
   构件数三者必须相等；少登记一条即失败。
4. `entry-coverage`：材料登记的 `包内条目` 集合必须与实际第三方构件集合完全相等。
5. `coordinates`：构件内 `pom.properties` 能自证坐标时，材料里的坐标必须与构件自述一致，
   坐标被改写即失败；无法自证的只如实计数，不冒充已核对。
6. `own-modules`：自有模块的声明数、列出的坐标与 `BOOT-INF/lib` 里的自有构件必须对齐。
7. `license-texts`：材料引用的每一份 `licenses/*.txt` 都必须在 JAR 内存在且内容摘要与文件名
   前缀一致，正文被替换或删除同样失败。

`--require-prepared` 追加第 8 项 `prepared-state`：发布链路要求"先准备材料再打包"，
因此还必须确认准备目录存在，且其材料与 JAR 内材料逐字节一致；未准备状态直接失败。

运行（仓库根）：

    python -B -X utf8 scripts/license/verify_license_materials.py \\
        --jar 后端代码/basic-framework-boot/basic-framework-server/target/basic-framework-server.jar \\
        --require-prepared --json

退出码：0 表示交付物与材料一致；1 表示门禁失败（材料缺失、与闭包不符或被篡改）；2 表示
输入不可读（产物不存在或不是合法 JAR）。

@author 李杰
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import zipfile
from pathlib import Path
from typing import Any, Mapping, Sequence

# 证据结构版本：结构变了就拒绝拿旧证据汇总发布结论。
SCHEMA = "license-material-gate/v1"

NOTICES_ENTRY = "META-INF/THIRD-PARTY-NOTICES"
LICENSES_PREFIX = "META-INF/licenses/"
LIBRARY_PREFIX = "BOOT-INF/lib/"
# 自有模块的 JAR 文件名前缀；`BOOT-INF/classes` 是本模块自身，不参与第三方闭包。
OWN_MODULE_PREFIX = "basic-framework-"

CLOSURE_DIGEST_PATTERN = re.compile(r"^第三方构件闭包 SHA-256：([0-9a-f]{64})")
COUNT_PATTERN = re.compile(r"^第三方组件数：(\d+)；自有模块数：(\d+)")
COMPONENT_PATTERN = re.compile(r"^--- (.+) ---$")
JAR_ENTRY_PATTERN = re.compile(r"^包内条目：(.+)$")
LICENSE_REFERENCE_PATTERN = re.compile(r"licenses/([0-9a-f]{16})\.txt")
OWN_MODULE_PATTERN = re.compile(r"^- (\S+)$")
# 材料里第一节与第二节的标题；解析只在这两节内取条目，避免把说明文字当成登记项。
THIRD_PARTY_HEADING = "一、第三方组件"
OWN_MODULE_HEADING = "二、本项目自有模块"
CLOSING_HEADING = "三、"
PROPERTY_PATTERN = re.compile(r"^([^=]+)=(.*)$")


class GateInputError(RuntimeError):
    """产物不存在或不可读；属于环境故障，不表示材料内容有问题。"""


def parse_arguments(argv: Sequence[str] | None = None) -> argparse.Namespace:
    """解析命令行参数。

    Args:
        argv: 原始命令行参数；省略时读取进程参数。
    Returns:
        已解析的参数。
    """

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jar", type=Path, required=True, help="被核验的后端可执行 JAR")
    parser.add_argument("--prepared-dir", type=Path,
                        help="许可材料准备目录，缺省取 JAR 同级的 generated-license-materials")
    parser.add_argument("--require-prepared", action="store_true",
                        help="要求先完成材料准备：准备目录必须存在且与 JAR 内材料逐字节一致")
    parser.add_argument("--json", action="store_true", help="输出机器可读证据")
    return parser.parse_args(argv)


def open_jar(jar_path: Path) -> zipfile.ZipFile:
    """打开待核验的 JAR，并对不可读输入给出明确诊断。

    Args:
        jar_path: 可执行 JAR 路径。
    Returns:
        已打开的归档。
    Raises:
        GateInputError: 文件不存在、不是文件或不是合法 ZIP。
    """

    if not jar_path.is_file():
        raise GateInputError(f"后端 JAR 不存在：{jar_path}")
    try:
        return zipfile.ZipFile(jar_path)
    except (OSError, zipfile.BadZipFile) as error:
        raise GateInputError(f"后端 JAR 不可读：{error}") from error


def library_entries(jar: zipfile.ZipFile) -> tuple[list[str], list[str]]:
    """把 `BOOT-INF/lib` 内的构件按第三方与自有模块分开。

    Args:
        jar: 已打开的可执行 JAR。
    Returns:
        (第三方构件条目名列表, 自有模块构件条目名列表)，两者都按条目名排序。
    """

    third_party: list[str] = []
    own: list[str] = []
    for name in jar.namelist():
        if not name.startswith(LIBRARY_PREFIX) or not name.endswith(".jar"):
            continue
        file_name = name[len(LIBRARY_PREFIX):]
        if file_name.startswith(OWN_MODULE_PREFIX):
            own.append(name)
        else:
            third_party.append(name)
    return sorted(third_party), sorted(own)


def read_properties(payload: bytes) -> dict[str, str]:
    """解析 Java `.properties` 文本，忽略注释与空行。

    Args:
        payload: 文件字节内容。
    Returns:
        键到值的映射。
    """

    values: dict[str, str] = {}
    for row in payload.decode("utf-8", errors="replace").splitlines():
        line = row.strip()
        if not line or line.startswith(("#", "!")):
            continue
        matched = PROPERTY_PATTERN.match(line)
        if matched:
            values[matched.group(1).strip()] = matched.group(2).strip()
    return values


def self_declared_coordinates(jar: zipfile.ZipFile, entry: str, payload: bytes) -> str | None:
    """从单个第三方构件自身读取坐标，读取不到或无法对齐时返回空值。

    只有当构件内 `pom.properties` 的 `artifactId-version` 与包内构件文件名对齐时才采信：
    聚合打包的构件内部带多个模块的坐标，不对齐的那份不是构件自身。

    Args:
        jar: 外层可执行 JAR。
        entry: 第三方构件在 JAR 内的条目名。
        payload: 第三方构件字节。
    Returns:
        `groupId:artifactId:version`；不可自证时返回 `None`。
    """

    stem = entry[len(LIBRARY_PREFIX):-len(".jar")]
    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as inner:
            candidates: list[dict[str, str]] = []
            for name in sorted(inner.namelist()):
                if not name.endswith("/pom.properties"):
                    continue
                if not name.startswith("META-INF/maven/"):
                    continue
                values = read_properties(inner.read(name))
                if f"{values.get('artifactId', '')}-{values.get('version', '')}" == stem:
                    candidates.append(values)
    except (KeyError, OSError, zipfile.BadZipFile):
        return None
    if len(candidates) != 1:
        return None
    values = candidates[0]
    if not values.get("groupId"):
        return None
    return f"{values['groupId']}:{values['artifactId']}:{values['version']}"


def parse_notices(text: str) -> dict[str, Any]:
    """解析材料正文，得到头部声明、组件条目、自有模块与原文引用。

    Args:
        text: `THIRD-PARTY-NOTICES` 正文。
    Returns:
        含 `closure_digest`、`declared_third_party`、`declared_own`、`components`、
        `own_modules` 与 `license_references` 的结构。
    """

    parsed: dict[str, Any] = {
        "closure_digest": "",
        "declared_third_party": -1,
        "declared_own": -1,
        "components": [],
        "own_modules": [],
        "license_references": [],
    }
    section = ""
    current: dict[str, str] | None = None
    for raw in text.splitlines():
        line = raw.strip()
        # 头部声明写在正文开头而不是某一节里，因此先于分节判断解析，避免漏读。
        digest = CLOSURE_DIGEST_PATTERN.match(line)
        if digest:
            parsed["closure_digest"] = digest.group(1)
        counts = COUNT_PATTERN.match(line)
        if counts:
            parsed["declared_third_party"] = int(counts.group(1))
            parsed["declared_own"] = int(counts.group(2))
        if line == THIRD_PARTY_HEADING:
            section, current = "third-party", None
            continue
        # 第二节标题带括号说明，按前缀匹配而不是整行相等。
        if line.startswith(OWN_MODULE_HEADING):
            section, current = "own", None
            continue
        if line.startswith(CLOSING_HEADING):
            section, current = "", None
            continue
        if section == "third-party":
            header = COMPONENT_PATTERN.match(line)
            if header:
                current = {"coordinates": header.group(1).strip(), "entry": ""}
                parsed["components"].append(current)
                continue
            entry = JAR_ENTRY_PATTERN.match(line)
            if entry and current is not None:
                current["entry"] = entry.group(1).strip()
            for referenced in LICENSE_REFERENCE_PATTERN.finditer(line):
                parsed["license_references"].append(referenced.group(1))
        elif section == "own":
            own = OWN_MODULE_PATTERN.match(line)
            if own:
                parsed["own_modules"].append(own.group(1).strip())
    return parsed


def closure_digest(jar: zipfile.ZipFile, entries: Sequence[str]) -> str:
    """按材料记录的同一口径，从 JAR 内构件字节重算第三方闭包摘要。

    Args:
        jar: 已打开的可执行 JAR。
        entries: 第三方构件条目名。
    Returns:
        十六进制 SHA-256。
    """

    lines = sorted(hashlib.sha256(jar.read(entry)).hexdigest() for entry in entries)
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


def coordinates_of(entry: str) -> tuple[str, str, str]:
    """把材料里的坐标拆成 groupId、artifactId 与 version 三段。

    Args:
        entry: 坐标原文，形如 `group:artifact:version`。
    Returns:
        三段值；不构成三段时原样返回，交给调用方判定失败。
    """

    parts = entry.split(":")
    if len(parts) == 3:
        return parts[0], parts[1], parts[2]
    return parts[0], "", ""


def own_module_entries(notices: Mapping[str, Any]) -> set[str]:
    """按材料登记的坐标推出自有模块在 JAR 内应当存在的条目名。

    版本号本身可能含连字符（如 `2026.01-SNAPSHOT`），因此不从文件名反推坐标，
    而是按坐标正向拼出 `artifactId-version.jar`，再与 JAR 内条目做集合比较。

    Args:
        notices: 解析后的材料结构。
    Returns:
        材料登记的自有模块条目名集合；坐标不构成三段时返回空集，交由调用方判定失败。
    """

    entries: set[str] = set()
    for item in notices["own_modules"]:
        _, artifact, version = coordinates_of(str(item))
        if artifact and version:
            entries.add(f"{LIBRARY_PREFIX}{artifact}-{version}.jar")
    return entries


def check_notices_present(jar: zipfile.ZipFile) -> dict[str, Any]:
    """核对交付 JAR 是否真的随包第三方许可材料。

    Args:
        jar: 已打开的可执行 JAR。
    Returns:
        单项检查结论。
    """

    if NOTICES_ENTRY in jar.namelist():
        return {"name": "notices-present", "status": "passed",
                "detail": f"JAR 内含 {NOTICES_ENTRY}"}
    return {"name": "notices-present", "status": "failed",
             "detail": f"JAR 内没有 {NOTICES_ENTRY}：许可材料未生成或未被打进交付物，"
                       "发布前必须先执行 resolve_component_metadata.py 与 "
                       "generate_third_party_notices.py 再重新打包"}


def check_closure_digest(jar: zipfile.ZipFile, notices: Mapping[str, Any],
                         third_party: Sequence[str]) -> dict[str, Any]:
    """核对材料记录的闭包摘要与 JAR 内构件字节重算结果是否一致。

    Args:
        jar: 已打开的可执行 JAR。
        notices: 解析后的材料结构。
        third_party: 实际第三方构件条目名。
    Returns:
        单项检查结论。
    """

    declared = str(notices.get("closure_digest", ""))
    if not declared:
        return {"name": "closure-digest", "status": "failed",
                 "detail": "材料里没有记录第三方构件闭包 SHA-256，无法把材料绑定到本次产物"}
    actual = closure_digest(jar, third_party)
    if actual != declared:
        return {"name": "closure-digest", "status": "failed",
                 "detail": f"材料记录的闭包摘要 {declared[:16]}… 与 JAR 内 {len(third_party)} 个"
                           f"第三方构件重算的 {actual[:16]}… 不一致"}
    return {"name": "closure-digest", "status": "passed",
             "detail": f"闭包摘要与 JAR 内 {len(third_party)} 个第三方构件重算结果一致"}


def check_component_count(notices: Mapping[str, Any], third_party: Sequence[str]) -> dict[str, Any]:
    """核对声明条数、解析条数与实际第三方构件数三者相等。

    Args:
        notices: 解析后的材料结构。
        third_party: 实际第三方构件条目名。
    Returns:
        单项检查结论。
    """

    parsed = len(notices["components"])
    declared = int(notices["declared_third_party"])
    actual = len(third_party)
    if declared != actual or parsed != actual:
        return {"name": "component-count", "status": "failed",
                 "detail": f"材料头部声明 {declared} 个、材料里解析出 {parsed} 条、"
                           f"JAR 内实际 {actual} 个第三方构件，三者必须相等"}
    return {"name": "component-count", "status": "passed",
             "detail": f"材料条目数与 JAR 内实际第三方构件数一致：{actual} 个"}


def check_entry_coverage(notices: Mapping[str, Any], third_party: Sequence[str]) -> dict[str, Any]:
    """核对材料登记的包内条目集合与实际第三方构件集合完全相等。

    Args:
        notices: 解析后的材料结构。
        third_party: 实际第三方构件条目名。
    Returns:
        单项检查结论。
    """

    declared = {str(item.get("entry", "")) for item in notices["components"]}
    actual = set(third_party)
    missing = sorted(actual - declared)
    extra = sorted(declared - actual)
    if missing or extra:
        detail = []
        if missing:
            detail.append(f"{len(missing)} 个构件未登记，例如 {missing[0]}")
        if extra:
            detail.append(f"{len(extra)} 条登记在产物里不存在，例如 {extra[0]}")
        return {"name": "entry-coverage", "status": "failed", "detail": "；".join(detail)}
    return {"name": "entry-coverage", "status": "passed",
             "detail": f"材料登记的 {len(actual)} 条包内条目与 JAR 内第三方构件集合完全相等"}


def check_coordinates(jar: zipfile.ZipFile, notices: Mapping[str, Any]) -> dict[str, Any]:
    """核对能由构件自证的坐标是否与材料登记一致。

    Args:
        jar: 已打开的可执行 JAR。
        notices: 解析后的材料结构。
    Returns:
        单项检查结论。
    """

    verified = 0
    unverifiable = 0
    mismatches: list[str] = []
    for item in notices["components"]:
        entry = str(item.get("entry", ""))
        if entry not in jar.namelist():
            continue
        declared = str(item.get("coordinates", ""))
        actual = self_declared_coordinates(jar, entry, jar.read(entry))
        if actual is None:
            unverifiable += 1
            continue
        if actual != declared:
            mismatches.append(f"{entry} 构件自述 {actual}，材料登记 {declared}")
            continue
        verified += 1
    if mismatches:
        return {"name": "coordinates", "status": "failed",
                 "detail": f"{len(mismatches)} 个构件的坐标与材料登记不一致：{mismatches[0]}"}
    return {"name": "coordinates", "status": "passed",
             "detail": f"{verified} 个构件坐标由构件自身 pom.properties 核对一致；"
                       f"另有 {unverifiable} 个构件包内无法自证，按设计不冒充已核对"}


def check_own_modules(notices: Mapping[str, Any], own: Sequence[str]) -> dict[str, Any]:
    """核对自有模块的声明数、登记坐标与实际自有构件三者一致。

    自有模块的许可由权利方决定，本门禁不判断其条款，只保证材料没有把它们与第三方组件
    混算，也没有把实际打包的自有构件漏记。

    Args:
        notices: 解析后的材料结构。
        own: 实际自有模块构件条目名。
    Returns:
        单项检查结论。
    """

    listed = [str(item) for item in notices["own_modules"]]
    declared = int(notices["declared_own"])
    expected = own_module_entries(notices)
    actual = set(own)
    if declared != len(listed) or declared != len(own) or expected != actual:
        detail = f"材料头部声明 {declared} 个自有模块、列出 {len(listed)} 条坐标，JAR 内实际 {len(own)} 个自有构件"
        if expected != actual:
            missing = sorted(actual - expected)
            detail += f"；{len(missing)} 个自有构件没有对应坐标"
        return {"name": "own-modules", "status": "failed", "detail": detail + "，三者必须一致"}
    return {"name": "own-modules", "status": "passed",
            "detail": f"{declared} 个自有模块坐标与 JAR 内自有构件条目一一对应"}


def check_license_texts(jar: zipfile.ZipFile, notices: Mapping[str, Any]) -> dict[str, Any]:
    """核对材料引用的每一份许可证正文都在 JAR 内存在且内容摘要与文件名一致。

    Args:
        jar: 已打开的可执行 JAR。
        notices: 解析后的材料结构。
    Returns:
        单项检查结论。
    """

    present = {name[len(LICENSES_PREFIX):-len(".txt")]
               for name in jar.namelist()
               if name.startswith(LICENSES_PREFIX) and name.endswith(".txt")}
    referenced = set(str(item) for item in notices["license_references"])
    missing = sorted(referenced - present)
    altered: list[str] = []
    for digest in sorted(referenced & present):
        payload = jar.read(f"{LICENSES_PREFIX}{digest}.txt")
        if not hashlib.sha256(payload).hexdigest().startswith(digest):
            altered.append(f"{digest}.txt")
    if missing or altered:
        detail = []
        if missing:
            detail.append(f"{len(missing)} 份被引用但缺失的许可证正文，例如 {missing[0]}.txt")
        if altered:
            detail.append(f"{len(altered)} 份正文内容与文件名摘要不符，例如 {altered[0]}")
        return {"name": "license-texts", "status": "failed", "detail": "；".join(detail)}
    if not referenced:
        return {"name": "license-texts", "status": "failed",
                 "detail": "材料没有引用任何一份许可证正文，随包材料不完整"}
    return {"name": "license-texts", "status": "passed",
             "detail": f"材料引用的 {len(referenced)} 份许可证正文全部存在且内容摘要一致"}


def check_prepared(prepared_dir: Path | None, jar: zipfile.ZipFile) -> dict[str, Any]:
    """核对发布链要求的"先准备材料"状态是否成立。

    Args:
        prepared_dir: 许可材料准备目录；为空时只按缺省约定推断。
        jar: 已打开的可执行 JAR。
    Returns:
        单项检查结论。
    """

    if prepared_dir is None:
        return {"name": "prepared-state", "status": "failed",
                 "detail": "未提供许可材料准备目录路径，无法确认本次发布已按流程准备材料"}
    notices_path = prepared_dir / "META-INF" / "THIRD-PARTY-NOTICES"
    if not notices_path.is_file():
        return {"name": "prepared-state", "status": "failed",
                 "detail": f"许可材料准备目录里没有 META-INF/THIRD-PARTY-NOTICES：{prepared_dir}，"
                           "发布链要求先执行核实与生成步骤再打包"}
    if NOTICES_ENTRY not in jar.namelist():
        return {"name": "prepared-state", "status": "failed",
                 "detail": "材料已准备但没有打进 JAR，说明打包发生在生成之前，必须重新打包"}
    if notices_path.read_bytes() != jar.read(NOTICES_ENTRY):
        return {"name": "prepared-state", "status": "failed",
                 "detail": "准备目录里的材料与 JAR 内材料不是同一份，打包使用的不是本次生成的材料"}
    return {"name": "prepared-state", "status": "passed",
             "detail": "准备目录存在且其材料与 JAR 内材料逐字节一致"}


def verify(jar_path: Path, prepared_dir: Path | None,
           require_prepared: bool) -> dict[str, Any]:
    """对交付 JAR 执行全部核对并返回机器可读证据。

    Args:
        jar_path: 被核验的可执行 JAR。
        prepared_dir: 许可材料准备目录；`require_prepared` 为假时允许为空。
        require_prepared: 是否要求先完成材料准备。
    Returns:
        含状态、逐项结论与实测读数的证据结构。
    Raises:
        GateInputError: 产物不可读或材料正文无法解析。
    """

    jar = open_jar(jar_path)
    try:
        if NOTICES_ENTRY not in jar.namelist():
            return {"schema": SCHEMA, "status": "failed",
                    "checks": [check_notices_present(jar)],
                    "measurements": {"third_party": 0, "own_modules": 0}}
        text = jar.read(NOTICES_ENTRY).decode("utf-8")
    except (KeyError, OSError, UnicodeDecodeError, zipfile.BadZipFile) as error:
        raise GateInputError(f"许可材料正文不可读：{error}") from error
    finally:
        jar.close()

    notices = parse_notices(text)
    with open_jar(jar_path) as opened:
        third_party, own = library_entries(opened)
        checks = [check_notices_present(opened),
                  check_closure_digest(opened, notices, third_party),
                  check_component_count(notices, third_party),
                  check_entry_coverage(notices, third_party),
                  check_coordinates(opened, notices),
                  check_own_modules(notices, own),
                  check_license_texts(opened, notices)]
        if require_prepared:
            checks.append(check_prepared(prepared_dir, opened))
    status = "passed" if all(item["status"] == "passed" for item in checks) else "failed"
    return {
        "schema": SCHEMA,
        "status": status,
        "checks": checks,
        "measurements": {
            "third_party_components": len(third_party),
            "declared_components": int(notices["declared_third_party"]),
            "own_modules": len(own),
            "license_texts": len(set(str(item) for item in notices["license_references"])),
            "closure_digest": str(notices["closure_digest"]),
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
        print(f"[第三方许可材料门禁] 未通过：{item['name']} —— {item['detail']}", file=sys.stderr)


def report_summary(evidence: Mapping[str, Any], *, stream: Any = None) -> None:
    """打印一行总体读数，便于在构建日志里直接核对。

    Args:
        evidence: 门禁证据结构。
        stream: 输出流；`--json` 时传标准错误，避免污染机器可读证据。
    """

    measurements = evidence["measurements"]
    print(f"第三方许可材料门禁：{evidence['status']}；检查 {len(evidence['checks'])} 项，"
          f"第三方构件 {measurements['third_party_components']} 个、"
          f"自有模块 {measurements['own_modules']} 个、"
          f"许可证正文 {measurements['license_texts']} 份",
          file=stream or sys.stdout, flush=True)


def main(argv: Sequence[str] | None = None) -> int:
    """执行门禁并输出结论。

    Args:
        argv: 原始命令行参数；省略时读取进程参数。
    Returns:
        进程退出码；0 表示一致，1 表示门禁失败，2 表示输入不可读。
    """

    arguments = parse_arguments(argv)
    prepared_dir = arguments.prepared_dir
    if arguments.require_prepared and prepared_dir is None:
        prepared_dir = arguments.jar.parent / "generated-license-materials"
    try:
        evidence = verify(arguments.jar.resolve(), prepared_dir, arguments.require_prepared)
    except GateInputError as error:
        if arguments.json:
            print(json.dumps({"schema": SCHEMA, "status": "unavailable",
                              "reason": str(error)}, ensure_ascii=False))
        print(f"第三方许可材料门禁无法执行：{error}", file=sys.stderr)
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