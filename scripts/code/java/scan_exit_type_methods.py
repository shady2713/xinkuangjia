#!/usr/bin/env python3
"""按字节码形状识别"只有异常出口、没有正常返回出口"的方法，并输出候选清单。

JaCoCo 0.8.x 把方法探针插在**基本块出口**而不是方法入口：一个没有分支的直线方法，
其唯一出口是方法末尾的 `xreturn`，探针只出现在 `xreturn` 之前。当这个出口被
"被调方抛出的异常"截断时探针永不置位，于是**真实执行过的代码被记为未覆盖**。
逐文件 100% 行 + 100% 方法的门禁会因此把"被测过"读成"没测过"，补再多异常出口用例
也不会让读数变化，而"补一条走正常返回的用例"能让它立刻翻转。

本工具只做**可观测性**：读 `target/classes` 的真实字节码判定方法形状，输出
文件 + 方法 + 行范围 + 判定依据。它不改任何阈值、不改退出码、不自动豁免任何文件，
候选是否补正常返回用例由人决定。

判定规则（全部满足才算候选）：
1. 有方法体，且不是 abstract/native；
2. 不是 synthetic/bridge（JaCoCo 的 SyntheticFilter 整体移除这类方法，根本不计入分母）；
3. 不在 JaCoCo 的 EnumFilter / RecordsFilter / PrivateEmptyNoArgConstructorFilter 移除范围内；
4. 异常表为空：没有 try/catch/finally，catch 分支本身就是 JaCoCo 的另一条正常出口；
5. 方法体不含 `athrow`：本方法内抛出的异常会被方法末尾的兜底探针记录，语义正确；
6. 方法体不含任何跳转（`goto`/`if*`/`*switch`/`jsr`），也没有 ACC_SYNCHRONIZED：
   有分支就存在多个基本块出口，异常截断某个出口不影响其它出口置位；
7. 恰好一条 `xreturn`，且它是方法体的最后一条指令。

只有同时满足 1-7 的方法，其覆盖率完全取决于"正常返回出口是否被驱动过"。
本工具刻意不读取也不改写任何覆盖率结论，也不写入仓库产物。

用法：
    python -B -X utf8 scripts/code/java/scan_exit_type_methods.py [--root 仓库根] [--json]

@author DeepSeek
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

if __package__ in (None, ""):
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scripts.common.quality_common import DEFAULT_ROOT, CheckError

# 后端编译产物根：模块级 target/classes；构建输出不纳管其他位置。
BACKEND = Path("后端代码/basic-framework-boot")
CLASSES_DIRNAME = "classes"

SCHEMA = "exit-type-methods/v1"

# 访问标志（JVMS 4.1/4.5/4.6）。
ACC_ENUM = 0x4000
ACC_RECORD = 0x0010
ACC_SYNTHETIC = 0x1000
ACC_BRIDGE = 0x0040
ACC_ABSTRACT = 0x0400
ACC_NATIVE = 0x0100
ACC_SYNCHRONIZED = 0x0020
ACC_PRIVATE = 0x0002
ACC_STATIC = 0x0008

RETURN_OPCODES = frozenset({0xAC, 0xAD, 0xAE, 0xAF, 0xB0, 0xB1})  # ireturn..return
RETURN_NAMES = {0xAC: "ireturn", 0xAD: "lreturn", 0xAE: "freturn",
                0xAF: "dreturn", 0xB0: "areturn", 0xB1: "return"}
BRANCH_OPCODES = frozenset({
    0x99, 0x9A, 0x9B, 0x9C, 0x9D, 0x9E, 0x9F, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5,
    0xA6, 0xA7, 0xA8, 0xAA, 0xAB, 0xC6, 0xC7, 0xC8, 0xC9,
})
BRANCH_NAMES = {
    0x99: "ifeq", 0x9A: "ifne", 0x9B: "iflt", 0x9C: "ifge", 0x9D: "ifgt", 0x9E: "ifle",
    0x9F: "if_icmpeq", 0xA0: "if_icmpne", 0xA1: "if_icmplt", 0xA2: "if_icmpge",
    0xA3: "if_icmpgt", 0xA4: "if_icmple", 0xA5: "if_acmpeq", 0xA6: "if_acmpne",
    0xA7: "goto", 0xA8: "jsr", 0xAA: "tableswitch", 0xAB: "lookupswitch",
    0xC6: "ifnull", 0xC7: "ifnonnull", 0xC8: "goto_w", 0xC9: "jsr_w",
}

# 固定操作数长度的操作码；未列出的操作码没有操作数，长度为 1。
FIXED_OPERANDS: dict[int, int] = {
    0x10: 1, 0x11: 2, 0x12: 1, 0x13: 2, 0x14: 2,
    0x15: 1, 0x16: 1, 0x17: 1, 0x18: 1, 0x19: 1,
    0x36: 1, 0x37: 1, 0x38: 1, 0x39: 1, 0x3A: 1,
    0x84: 2,
    0x99: 2, 0x9A: 2, 0x9B: 2, 0x9C: 2, 0x9D: 2, 0x9E: 2, 0x9F: 2,
    0xA0: 2, 0xA1: 2, 0xA2: 2, 0xA3: 2, 0xA4: 2, 0xA5: 2, 0xA6: 2,
    0xA7: 2, 0xA8: 2, 0xA9: 1,
    0xB2: 2, 0xB3: 2, 0xB4: 2, 0xB5: 2,
    0xB6: 2, 0xB7: 2, 0xB8: 2, 0xB9: 4, 0xBA: 4,
    0xBB: 2, 0xBC: 1, 0xBD: 2, 0xC0: 2, 0xC1: 2, 0xC5: 3,
    0xC6: 2, 0xC7: 2, 0xC8: 4, 0xC9: 4,
}
VARIABLE_OPCODES = frozenset({0xAA, 0xAB, 0xC4})  # tableswitch/lookupswitch/wide


class ClassFileError(CheckError):
    """表示 class 文件无法按 JVM 规范解析，扫描器拒绝猜测而不是给出错误结论。"""


@dataclass(frozen=True)
class Instruction:
    """表示方法体中的一条字节码指令及其在方法体内的偏移。"""

    offset: int
    opcode: int


@dataclass(frozen=True)
class MethodShape:
    """表示一个方法的字节码形状判定结果与判定依据。"""

    name: str
    descriptor: str
    first_line: int | None
    last_line: int | None
    instructions: int
    exit_only: bool
    reason: str

    def as_record(self) -> dict[str, object]:
        """把判定结果转成不含方法体的结构化记录。"""
        return {"method": self.name, "descriptor": self.descriptor,
                "first_line": self.first_line, "last_line": self.last_line,
                "instructions": self.instructions, "exit_only": self.exit_only,
                "reason": self.reason}


@dataclass
class ClassFile:
    """表示一个 class 文件的结构化解码结果。"""

    access_flags: int
    this_name: str
    methods: list[tuple[int, str, str, bytes | None, int, int | None, int | None]] = field(default_factory=list)


class _Reader:
    """按大端序顺序读取 class 文件字节，越界即拒绝继续。"""

    def __init__(self, data: bytes) -> None:
        """把读取游标置于字节流开头，后续按 JVM 固定宽度顺序消费。"""
        self._data = data
        self._offset = 0

    def take(self, size: int) -> bytes:
        """读取下一个 size 字节并前移游标。"""
        if size < 0 or self._offset + size > len(self._data):
            raise ClassFileError("class 文件在解析过程中提前结束")
        chunk = self._data[self._offset:self._offset + size]
        self._offset += size
        return chunk

    def u1(self) -> int:
        """读取一个无符号字节。"""
        return self.take(1)[0]

    def u2(self) -> int:
        """读取一个无符号短整型。"""
        return struct.unpack(">H", self.take(2))[0]

    def u4(self) -> int:
        """读取一个无符号整型。"""
        return struct.unpack(">I", self.take(4))[0]

    def skip(self, size: int) -> None:
        """跳过 size 字节。"""
        self.take(size)


def _constant_pool(reader: _Reader) -> list[tuple[int, ...]]:
    """读取常量池，返回每项的 (tag, 载荷) 便于后续按索引取 utf8 与类名。"""
    count = reader.u2()
    pool: list[tuple[int, ...]] = [(0,)]  # 下标 0 恒为空，长度索引无关
    index = 1
    while index < count:
        tag = reader.u1()
        if tag == 1:
            length = reader.u2()
            pool.append((tag, reader.take(length)))
        elif tag in (7, 8, 16, 19, 20):
            pool.append((tag, reader.u2()))
        elif tag in (15,):
            pool.append((tag, reader.u1(), reader.u2()))
        elif tag in (3, 4):
            pool.append((tag, reader.take(4)))
        elif tag in (5, 6):
            pool.append((tag, reader.take(8)))
            pool.append((0,))  # long/double 占两个常量池槽位
            index += 1
        elif tag in (9, 10, 11, 12, 17, 18):
            pool.append((tag, reader.u2(), reader.u2()))
        else:
            raise ClassFileError(f"class 文件出现未知常量池标签 {tag}")
        index += 1
    return pool


def _utf8(pool: list[tuple[int, ...]], index: int) -> str:
    """按索引取出 CONSTANT_Utf8 的文本。"""
    if index <= 0 or index >= len(pool) or pool[index][0] != 1:
        raise ClassFileError("class 文件引用了非 utf8 常量")
    return pool[index][1].decode("utf-8", "replace")


def _class_name(pool: list[tuple[int, ...]], index: int) -> str:
    """把 CONSTANT_Class 索引解析成内部名（斜杠分隔）。"""
    if index <= 0 or index >= len(pool) or pool[index][0] != 7:
        raise ClassFileError("class 文件引用了非类常量")
    return _utf8(pool, pool[index][1])


def _attributes(reader: _Reader, pool: list[tuple[int, ...]]) -> list[tuple[str, bytes]]:
    """读取属性表，返回 (属性名, 属性体)。"""
    found: list[tuple[str, bytes]] = []
    for _ in range(reader.u2()):
        name = _utf8(pool, reader.u2())
        found.append((name, reader.take(reader.u4())))
    return found


def _code_attribute(body: bytes, pool: list[tuple[int, ...]]) -> tuple[bytes, int, int | None, int | None]:
    """解析 Code 属性，返回 (方法体, 异常表条数, 首行, 末行)。

    Args:
        body: Code 属性的原始字节。
        pool: 已解析的常量池，用于把嵌套属性名还原成 utf8。
    Returns:
        方法体字节、异常表条数与源码行号范围；没有行号时后两项为 None。
    """
    reader = _Reader(body)
    reader.u2()  # max_stack
    reader.u2()  # max_locals
    code = reader.take(reader.u4())
    handlers = reader.u2()
    reader.skip(8 * handlers)
    first_line: int | None = None
    last_line: int | None = None
    for name, payload in _attributes(reader, pool):
        if name != "LineNumberTable":
            continue
        table = _Reader(payload)
        for _ in range(table.u2()):
            table.u2()
            line = table.u2()
            first_line = line if first_line is None else min(first_line, line)
            last_line = line if last_line is None else max(last_line, line)
    return code, handlers, first_line, last_line


def parse_class_file(data: bytes) -> ClassFile:
    """解析一个 class 文件，取出方法体、异常表条数与源码行号范围。

    Args:
        data: class 文件原始字节。
    Returns:
        解码后的类访问标志、类名与逐方法记录。
    Raises:
        ClassFileError: 字节不是合法 class 文件，或结构在解析中越界。
    """
    reader = _Reader(data)
    if reader.u4() != 0xCAFEBABE:
        raise ClassFileError("不是 JVM class 文件")
    reader.u2()  # minor_version
    reader.u2()  # major_version
    pool = _constant_pool(reader)
    access_flags = reader.u2()
    this_name = _class_name(pool, reader.u2())
    reader.u2()  # super_class
    reader.skip(2 * reader.u2())  # interfaces
    for _ in range(reader.u2()):  # fields
        reader.skip(6)
        _attributes(reader, pool)
    methods: list[tuple[int, str, str, bytes | None, int, int | None, int | None]] = []
    for _ in range(reader.u2()):
        flags = reader.u2()
        name = _utf8(pool, reader.u2())
        descriptor = _utf8(pool, reader.u2())
        code: bytes | None = None
        handlers = 0
        first_line: int | None = None
        last_line: int | None = None
        for attribute_name, payload in _attributes(reader, pool):
            if attribute_name != "Code":
                continue
            code, handlers, first_line, last_line = _code_attribute(payload, pool)
        methods.append((flags, name, descriptor, code, handlers, first_line, last_line))
    return ClassFile(access_flags=access_flags, this_name=this_name, methods=methods)


def disassemble(code: bytes) -> list[Instruction]:
    """把方法体拆成指令序列，并校验指令流恰好落在方法体末尾。

    Args:
        code: Code 属性的方法体字节。
    Returns:
        按偏移升序的指令列表。
    Raises:
        ClassFileError: 指令长度无法确定，或指令流越界/未覆盖方法体。
    """
    instructions: list[Instruction] = []
    offset = 0
    while offset < len(code):
        opcode = code[offset]
        if opcode in VARIABLE_OPCODES:
            length = _variable_length(code, offset, opcode)
        else:
            length = 1 + FIXED_OPERANDS.get(opcode, 0)
        if offset + length > len(code):
            raise ClassFileError(f"操作码 0x{opcode:02x} 的指令越过方法体末尾")
        instructions.append(Instruction(offset=offset, opcode=opcode))
        offset += length
    if offset != len(code):
        raise ClassFileError("指令流没有精确覆盖方法体")
    return instructions


def _variable_length(code: bytes, offset: int, opcode: int) -> int:
    """计算 switch 与 wide 指令的变长长度。

    Args:
        code: 方法体字节。
        offset: 指令在方法体内的偏移。
        opcode: 指令操作码。
    Returns:
        指令总长度，含操作码本身与 4 字节对齐填充。
    Raises:
        ClassFileError: 操作数不完整或 switch 表项数为负，指令流无法确定边界。
    """
    base = offset + 1
    padding = (4 - (base % 4)) % 4
    if opcode == 0xC4:
        return 6 if base + 1 < len(code) and code[base + 1] == 0x84 else 4
    cursor = base + padding
    if opcode == 0xAA:
        default, low, high = struct.unpack(">iii", code[cursor:cursor + 12])
        if high < low:
            raise ClassFileError("tableswitch 的 high 小于 low")
        return (cursor - offset) + 12 + 4 * (high - low + 1)
    _default, pairs = struct.unpack(">ii", code[cursor:cursor + 8])
    if pairs < 0:
        raise ClassFileError("lookupswitch 的表项数为负")
    return (cursor - offset) + 8 + 8 * pairs


def _enum_or_record_removed(access_flags: int, name: str, descriptor: str) -> str:
    """判断方法是否落在 JaCoCo 的 EnumFilter 或 RecordsFilter 整体移除范围内。"""
    if access_flags & ACC_ENUM:
        if name == "values" and descriptor.startswith("()["):
            return "枚举 values()：JaCoCo EnumFilter 整体移除"
        if name == "valueOf" and descriptor.startswith("(Ljava/lang/String;)L"):
            return "枚举 valueOf()：JaCoCo EnumFilter 整体移除"
    if access_flags & ACC_RECORD and (name, descriptor) in (
            ("equals", "(Ljava/lang/Object;)Z"),
            ("hashCode", "()I"),
            ("toString", "()Ljava/lang/String;")):
        return "record 默认实现：JaCoCo RecordsFilter 整体移除"
    return ""


def classify_method(class_file: ClassFile, flags: int, name: str, descriptor: str,
                    code: bytes | None, handlers: int, first_line: int | None,
                    last_line: int | None) -> MethodShape:
    """判定单个方法是否属于"只有异常出口"形状，并给出可核对的判定依据。

    Args:
        class_file: 方法所属类，用于核对 JaCoCo 的整体移除规则。
        flags: 方法访问标志。
        name: 方法名。
        descriptor: 方法描述符。
        code: 方法体字节；None 表示没有方法体。
        handlers: 异常表条数。
        first_line: 源码首个行号。
        last_line: 源码末个行号。
    Returns:
        带判定结果、行范围与依据的形状记录。
    Raises:
        ClassFileError: 方法体无法拆成完整指令序列。
    """

    def shape(exit_only: bool, reason: str, instructions: int = 0) -> MethodShape:
        """按当前方法的行范围与指令数组装形状记录，供各判定分支统一返回。"""
        return MethodShape(name=name, descriptor=descriptor, first_line=first_line,
                           last_line=last_line, instructions=instructions,
                           exit_only=exit_only, reason=reason)

    if flags & (ACC_ABSTRACT | ACC_NATIVE):
        return shape(False, "抽象或原生方法，没有方法体")
    if flags & (ACC_SYNTHETIC | ACC_BRIDGE):
        return shape(False, "合成或桥接方法：JaCoCo SyntheticFilter 整体移除")
    removed = _enum_or_record_removed(class_file.access_flags, name, descriptor)
    if removed:
        return shape(False, removed)
    if name == "<init>" and descriptor == "()V" and class_file.access_flags & ACC_PRIVATE:
        return shape(False, "私有无参构造器：JaCoCo PrivateEmptyNoArgConstructorFilter 整体移除")
    if code is None:
        return shape(False, "没有 Code 属性，方法体不可执行")
    if flags & ACC_SYNCHRONIZED:
        return shape(False, "ACC_SYNCHRONIZED 方法：JaCoCo SynchronizedFilter 会改写出口形状")
    instructions = disassemble(code)
    branch = next((item for item in instructions if item.opcode in BRANCH_OPCODES), None)
    if branch is not None:
        return shape(False, f"方法体有跳转 {BRANCH_NAMES[branch.opcode]}（偏移 {branch.offset}）",
                     len(instructions))
    if handlers:
        return shape(False, f"方法体有 {handlers} 条异常表项（try/catch/finally）", len(instructions))
    athrow = next((item for item in instructions if item.opcode == 0xBF), None)
    if athrow is not None:
        return shape(False, f"方法体在偏移 {athrow.offset} 有 athrow，方法末尾兜底探针可正常置位",
                     len(instructions))
    returns = [item for item in instructions if item.opcode in RETURN_OPCODES]
    if not returns:
        return shape(False, "方法体没有返回指令，出口不唯一", len(instructions))
    if len(returns) > 1:
        return shape(False, f"方法体有 {len(returns)} 条返回指令，出口不唯一", len(instructions))
    if instructions[-1].opcode not in RETURN_OPCODES:
        return shape(False, "唯一返回指令之后仍有代码，出口不是方法末尾", len(instructions))
    if first_line is None:
        return shape(False, "方法体没有源码行号，无法定位到源文件", len(instructions))
    return shape(True,
                 f"直线单出口方法：无跳转、无异常表、无 athrow，唯一出口是末尾 "
                 f"{RETURN_NAMES[returns[0].opcode]}（偏移 {returns[0].offset}）",
                 len(instructions))


def scan_classes(directory: Path) -> tuple[list[dict[str, object]], list[dict[str, str]], int, int]:
    """扫描一个 class 文件根目录，返回候选方法清单与无法解析的文件。

    Args:
        directory: 含 .class 文件的目录树根。
    Returns:
        候选方法记录、无法解析文件、扫描过的 class 文件数与其中的方法数。
    """
    candidates: list[dict[str, object]] = []
    problems: list[dict[str, str]] = []
    classes = 0
    methods = 0
    for path in sorted(directory.rglob("*.class")):
        classes += 1
        try:
            class_file = parse_class_file(path.read_bytes())
            instructions_cache: list[MethodShape] = []
            for flags, name, descriptor, code, handlers, first_line, last_line in class_file.methods:
                methods += 1
                instructions_cache.append(
                    classify_method(class_file, flags, name, descriptor, code, handlers, first_line, last_line))
            for shape in instructions_cache:
                if shape.exit_only:
                    candidates.append({"class": class_file.this_name, "file": path.as_posix(), **shape.as_record()})
        except (ClassFileError, IndexError, struct.error) as error:
            problems.append({"file": path.as_posix(), "detail": f"{type(error).__name__}: {error}"})
    return candidates, problems, classes, methods


def jacoco_missed_methods(report: Path) -> dict[tuple[str, str, str], dict[str, object]]:
    """从 JaCoCo XML 报告读出逐方法的当前读数，仅用于给候选清单标注。

    Args:
        report: jacoco.xml 报告路径。
    Returns:
        以 (包名, 源文件名, 方法名+描述符) 为键的方法计数；报告不存在时返回空映射。
    Raises:
        CheckError: 报告存在但不是合法 XML。
    """
    if not report.is_file():
        return {}
    result: dict[tuple[str, str, str], dict[str, object]] = {}
    for package in ET.fromstring(report.read_bytes()).findall("package"):
        package_name = package.attrib.get("name", "")
        for entry in package.findall("class"):
            source_name = entry.attrib.get("sourcefilename", "")
            for method in entry.findall("method"):
                signature = method.attrib.get("name", "") + method.attrib.get("desc", "")
                counter = next((item for item in method.findall("counter")
                                if item.attrib.get("type") == "METHOD"), None)
                if counter is None:
                    continue
                result[(package_name, source_name, signature)] = {
                    "line": int(method.attrib.get("line", "0") or 0),
                    "missed": int(counter.attrib.get("missed", "0")),
                    "covered": int(counter.attrib.get("covered", "0"))}
    return result


def default_class_roots(root: Path) -> list[Path]:
    """列出后端全部已编译的 target/classes，按路径排序。

    模块目录可能嵌套（core 下还有 11 个 starter 子模块），因此按 ``pom.xml`` 判定模块，
    只收录真实参与构建的模块；没有 ``target/classes`` 的模块不会被编造为空清单。

    Args:
        root: 仓库根目录。
    Returns:
        已编译模块的 class 目录列表；后端不存在时返回空列表。
    """
    backend = root / BACKEND
    if not backend.is_dir():
        return []
    found = [path for path in backend.rglob(CLASSES_DIRNAME)
             if path.is_dir() and path.parent.name == "target"
             and (path.parent.parent / "pom.xml").is_file()]
    return sorted(found)


def source_of(classes_root: Path, class_file: Path) -> Path | None:
    """由 target/classes 下的 class 文件定位同包同名源码，映射不成立时返回 None。

    Args:
        classes_root: 模块的 target/classes 目录。
        class_file: 该目录下的 class 文件。
    Returns:
        对应的 src/main/java 源码路径；不存在时返回 None。
    """
    module = classes_root.parent.parent
    source_root = module / "src/main/java"
    candidate = source_root / class_file.relative_to(classes_root).with_suffix(".java")
    return candidate if candidate.is_file() else None


def scan(root: Path, directories: list[Path], reports: dict[Path, Path]) -> dict[str, object]:
    """对给定 class 目录执行扫描，并按可选的 JaCoCo 报告补充当前读数。

    Args:
        root: 仓库根目录，用于给出可核对的相对路径。
        directories: 待扫描的 class 目录。
        reports: class 目录到 jacoco.xml 的映射；缺项表示不标注读数。
    Returns:
        候选清单、无法解析文件与扫描统计组成的结构化结果。
    """
    candidates: list[dict[str, object]] = []
    problems: list[dict[str, str]] = []
    classes = 0
    methods = 0
    for directory in directories:
        found, failed, seen, total = scan_classes(directory)
        methods += total
        classes += seen
        problems.extend(failed)
        measured = jacoco_missed_methods(reports[directory]) if directory in reports else {}
        for record in found:
            class_file = Path(str(record["file"]))
            source = source_of(directory, class_file)
            package_name, _, _ = str(record["class"]).rpartition("/")
            key = (package_name, class_file.stem + ".java",
                   f"{record['method']}{record['descriptor']}")
            located = source or class_file
            if directory in reports:
                record["jacoco_method"] = measured.get(key)
            candidates.append({
                "path": located.relative_to(root).as_posix() if located.is_relative_to(root) else located.as_posix(),
                "class_file": class_file.relative_to(root).as_posix() if class_file.is_relative_to(root) else class_file.as_posix(),
                "source_found": source is not None,
                "class_root": directory.relative_to(root).as_posix() if directory.is_relative_to(root) else directory.as_posix(),
                **{name: value for name, value in record.items() if name != "file"},
            })
    candidates.sort(key=lambda item: (str(item["path"]), int(item["first_line"] or 0), str(item["method"])))
    return {"schema": SCHEMA, "status": "passed" if not problems else "unreadable-class-files",
            "class_files_scanned": classes, "methods_scanned": methods,
            "candidates": candidates, "unreadable": problems}


def main() -> int:
    """解析范围参数并输出候选清单，只报告形状判定，不改变任何覆盖率结论。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--classes", type=Path, action="append",
                        help="待扫描的 class 目录；可重复，缺省用后端各模块的 target/classes")
    parser.add_argument("--report", type=Path, action="append",
                        help="与 --classes 一一对应的 jacoco.xml；缺省不标注当前读数")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        directories = [path.resolve() for path in args.classes] if args.classes else default_class_roots(root)
        if not directories:
            raise CheckError("没有可扫描的 class 目录，请先编译后端或显式指定 --classes")
        reports: dict[Path, Path] = {}
        if args.report:
            if len(args.report) != len(directories):
                raise CheckError("--report 必须与 --classes 一一对应")
            reports = {directory: path.resolve() for directory, path in zip(directories, args.report)}
        result = scan(root, directories, reports)
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print(f"出口型候选 {len(result['candidates'])}；已扫描 class 文件 "
                  f"{result['class_files_scanned']}、方法 {result['methods_scanned']}；"
                  f"无法解析 {len(result['unreadable'])}")
            for record in result["candidates"]:
                counter = record.get("jacoco_method")
                reading = ""
                if isinstance(counter, dict):
                    missed = counter.get("missed")
                    covered = counter.get("covered")
                    reading = f" jacoco_method covered={covered}/{covered + missed}" if missed is not None else ""
                print(f"{record['path']}:{record['first_line']}-{record['last_line']} "
                      f"{record['method']}{record['descriptor']}{reading} :: {record['reason']}")
            for issue in result["unreadable"]:
                print(f"无法解析 {issue['file']}: {issue['detail']}")
        return 1 if result["unreadable"] else 0
    except (OSError, ValueError, KeyError, TypeError, CheckError) as error:
        detail = str(error).strip() or type(error).__name__
        print(f"出口型方法扫描无法完成：{type(error).__name__}: {detail}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
