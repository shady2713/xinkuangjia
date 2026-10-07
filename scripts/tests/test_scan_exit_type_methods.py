"""用真实构造的 class 文件与真实 CLI 验证出口型方法判定。

夹具直接在内存中拼装合法 class 文件，因此判定依据是真实字节码而不是被测实现自己
的中间表示；每个反例都能独立让用例失败——把方法体改成带分支、带异常表、带 athrow，
或把返回指令挪离方法末尾，判定都会翻转。
@author DeepSeek
"""

from __future__ import annotations

import json
import os
import struct
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from scripts.code.java import scan_exit_type_methods as scanner
from scripts.common.quality_common import DEFAULT_ROOT

ACC_PUBLIC = 0x0001
SCRIPT = DEFAULT_ROOT / "scripts" / "code" / "java" / "scan_exit_type_methods.py"

# 真实 JVM 操作码，夹具只用这些常量拼装方法体，保证字节码可被 javac/JaCoCo 同样解读。
ALOAD_0, ALOAD_1, ILOAD_1, ASTORE_1 = 0x2A, 0x2B, 0x1B, 0x4B
INVOKEVIRTUAL, INVOKESPECIAL, DUP, NEW = 0xB6, 0xB7, 0x59, 0xBB
IRETURN, ARETURN, RETURN = 0xAC, 0xB0, 0xB1
IFEQ, ATHROW = 0x99, 0xBF

DELEGATE_CALL = bytes([ALOAD_0, ALOAD_1, INVOKEVIRTUAL, 0x00, 0x12, ARETURN])
OWN_THROW = bytes([NEW, 0x00, 0x0B, DUP, INVOKESPECIAL, 0x00, 0x0C, ATHROW])
BRANCHED = bytes([ALOAD_1, IFEQ, 0x00, 0x08, IRETURN, 0x00, 0x00, 0x04, IRETURN])
RETURN_THEN_CODE = bytes([ALOAD_0, IRETURN, 0x00])
EMPTY_BODY_RETURN = bytes([RETURN])
IRETURN_ONLY = bytes([ALOAD_0, IRETURN])


def tableswitch(default: int, low: int, high: int, at: int = 0) -> bytes:
    """拼装真实 tableswitch 指令；at 为它在方法体内的偏移，填充按绝对偏移对齐。"""
    body = bytearray([0xAA])
    while (at + len(body)) % 4:
        body.append(0)
    body += struct.pack(">iii", default, low, high)
    for target in range(high - low + 1):
        body += struct.pack(">i", 8 * target)
    return bytes(body)


def lookupswitch(default: int, pairs: tuple[tuple[int, int], ...], at: int = 0) -> bytes:
    """拼装真实 lookupswitch 指令；at 为它在方法体内的偏移，填充按绝对偏移对齐。"""
    body = bytearray([0xAB])
    while (at + len(body)) % 4:
        body.append(0)
    body += struct.pack(">ii", default, len(pairs))
    for match, target in pairs:
        body += struct.pack(">ii", match, target)
    return bytes(body)


def goto_w(target: int) -> bytes:
    """拼装真实 goto_w 指令。"""
    return bytes([0xC8]) + struct.pack(">i", target)


def wide_iload(index: int) -> bytes:
    """拼装真实 wide iload 指令。"""
    return bytes([0xC4, 0x15]) + struct.pack(">H", index)


def class_bytes(name: str, methods: list[tuple[int, str, str, bytes | None, int, tuple[int, ...]]],
                access_flags: int = ACC_PUBLIC) -> bytes:
    """拼装一个 class 文件；methods 的元素顺序即为方法表顺序。

    Args:
        name: 类的内部名（斜杠分隔）。
        methods: (访问标志, 方法名, 描述符, 方法体, 异常表条数, 行号元组)。
        access_flags: 类访问标志。
    Returns:
        合法的 class 文件字节。
    """
    entries: list[bytes] = []
    utf8_pool_index: dict[str, int] = {}

    def utf8_index(text: str) -> int:
        """登记 utf8 常量并返回它在常量池中的真实索引。"""
        if text not in utf8_pool_index:
            raw = text.encode("utf-8")
            entries.append(struct.pack(">BH", 1, len(raw)) + raw)
            utf8_pool_index[text] = len(entries)
        return utf8_pool_index[text]

    def class_index(internal: str) -> int:
        """登记 CONSTANT_Class 并返回它在常量池中的真实索引。"""
        entries.append(struct.pack(">BH", 7, utf8_index(internal)))
        return len(entries)

    this_class = class_index(name)
    method_bytes = bytearray()
    for flags, method_name, descriptor, code, handlers, lines in methods:
        attributes = b""
        if code is not None:
            table = struct.pack(">H", len(lines))
            for line in lines:
                table += struct.pack(">HH", 0, line)
            payload = struct.pack(">HHI", 16, 8, len(code)) + code
            payload += struct.pack(">H", handlers) + bytes(8 * handlers)
            payload += struct.pack(">H", 1)
            payload += struct.pack(">HI", utf8_index("LineNumberTable"), len(table)) + table
            attributes = struct.pack(">HI", utf8_index("Code"), len(payload)) + payload
        method_bytes += struct.pack(">HHHH", flags, utf8_index(method_name),
                                    utf8_index(descriptor), 1 if code is not None else 0) + attributes
    header = (struct.pack(">IHH", 0xCAFEBABE, 0, 61)
              + struct.pack(">H", len(entries) + 1) + b"".join(entries)
              + struct.pack(">HHHH", access_flags, this_class, 0, 0) + struct.pack(">H", 0))
    return header + struct.pack(">H", len(methods)) + bytes(method_bytes) + struct.pack(">H", 0)


def shape_of(code: bytes | None, handlers: int = 0, flags: int = ACC_PUBLIC,
             descriptor: str = "(Ljava/lang/Long;)Ljava/lang/Object;",
             class_access: int = ACC_PUBLIC, lines: tuple[int, ...] = (10,),
             method_name: str = "sample") -> scanner.MethodShape:
    """对单个形状跑一次判定，返回带依据的形状记录。"""
    parsed = scanner.parse_class_file(class_bytes("demo/Shape",
                                                 [(flags, method_name, descriptor, code, handlers, lines)],
                                                 class_access))
    method_flags, name, method_descriptor, method_code, method_handlers, first, last = parsed.methods[0]
    return scanner.classify_method(parsed, method_flags, name, method_descriptor,
                                   method_code, method_handlers, first, last)


def run_cli(arguments: list[str], directory: Path) -> subprocess.CompletedProcess[str]:
    """在独立工作目录启动真实 CLI，保留退出码与 UTF-8 输出。

    Args:
        arguments: 脚本之后的参数，不经 Shell 拼接。
        directory: 子进程工作目录，不作为工具导入路径。
    Returns:
        退出状态与输出。
    """
    environment = {key: value for key, value in os.environ.items() if key != "PYTHONPATH"}
    return subprocess.run([sys.executable, "-B", "-X", "utf8", str(SCRIPT), *arguments],
                          cwd=directory, env=environment, capture_output=True, text=True,
                          encoding="utf-8", timeout=60, check=False)


def classes_root(directory: Path, source: bytes, name: str = "demo/Shape") -> Path:
    """把 class 字节写进临时目录树，返回该目录。"""
    root = directory / "classes"
    target = root / (name + ".class")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(source)
    return root


def jacoco_report(path: Path, package_name: str, file_name: str, method_name: str,
                  descriptor: str, line: int, missed: int, covered: int) -> Path:
    """写出只含一条方法读数的 JaCoCo 报告；逐方法计数在 class 节点下，与真实报告同构。"""
    report = ET.Element("report")
    package = ET.SubElement(report, "package", name=package_name)
    entry = ET.SubElement(package, "class",
                          name=package_name.replace(".", "/") + "/" + file_name[:-5],
                          sourcefilename=file_name)
    method = ET.SubElement(entry, "method", name=method_name, desc=descriptor, line=str(line))
    ET.SubElement(method, "counter", type="METHOD", missed=str(missed), covered=str(covered))
    path.write_bytes(ET.tostring(report))
    return path


def test_single_exit_delegate_method_is_exit_type() -> None:
    """单出口直线方法：出口只有末尾 areturn，判定为出口型并给出行范围。"""
    result = shape_of(DELEGATE_CALL, lines=(249, 249))
    assert result.exit_only is True
    assert (result.first_line, result.last_line) == (249, 249)
    assert result.instructions == 4
    assert "areturn" in result.reason


def test_two_returns_break_single_exit() -> None:
    """多条返回指令说明出口不唯一，不能按出口型上报。"""
    result = shape_of(BRANCHED)
    assert result.exit_only is False
    assert "跳转" in result.reason


def test_own_throw_is_not_exit_type() -> None:
    """方法体内 athrow 的出口由方法末尾兜底探针覆盖，不是出口型。"""
    result = shape_of(OWN_THROW)
    assert result.exit_only is False
    assert "athrow" in result.reason


def test_exception_table_is_not_exit_type() -> None:
    """带异常表说明存在 catch 出口，异常被本地接住时探针仍会置位。"""
    result = shape_of(DELEGATE_CALL, handlers=1)
    assert result.exit_only is False
    assert "异常表" in result.reason


def test_synthetic_and_bridge_are_filtered_out() -> None:
    """合成与桥接方法被 JaCoCo 整体移除，不进分母，不能报成出口型缺口。"""
    for flags in (scanner.ACC_SYNTHETIC, scanner.ACC_BRIDGE):
        result = shape_of(DELEGATE_CALL, flags=flags)
        assert result.exit_only is False, flags
        assert "SyntheticFilter" in result.reason


def test_abstract_and_enum_removed_methods_are_not_candidates() -> None:
    """抽象方法没有方法体，枚举 values() 被 EnumFilter 移除，两者都不算出口型。"""
    abstract = shape_of(None, flags=ACC_PUBLIC | scanner.ACC_ABSTRACT)
    assert abstract.exit_only is False
    assert "抽象" in abstract.reason
    bodiless = shape_of(None)
    assert bodiless.exit_only is False and "没有 Code 属性" in bodiless.reason
    enum_values = shape_of(DELEGATE_CALL, descriptor="()[Ldemo/Shape;",
                           class_access=ACC_PUBLIC | scanner.ACC_ENUM, method_name="values")
    assert enum_values.exit_only is False
    assert "EnumFilter" in enum_values.reason
    record_hash = shape_of(IRETURN_ONLY, descriptor="()I",
                           class_access=ACC_PUBLIC | scanner.ACC_RECORD, method_name="hashCode")
    assert record_hash.exit_only is False
    assert "RecordsFilter" in record_hash.reason


def test_synchronized_method_is_not_candidate() -> None:
    """ACC_SYNCHRONIZED 会让 JaCoCo 同步过滤器改写出口形状，判定必须拒绝猜测。"""
    result = shape_of(DELEGATE_CALL, flags=ACC_PUBLIC | scanner.ACC_SYNCHRONIZED)
    assert result.exit_only is False
    assert "SynchronizedFilter" in result.reason


def test_return_before_last_instruction_is_not_exit_type() -> None:
    """返回指令之后仍有代码时出口不是方法末尾，不能按出口型上报。"""
    result = shape_of(RETURN_THEN_CODE)
    assert result.exit_only is False
    assert "之后仍有代码" in result.reason


def test_missing_line_numbers_are_not_candidates() -> None:
    """没有源码行号就无法定位到源文件，判定必须拒绝而不是猜位置。"""
    result = shape_of(DELEGATE_CALL, lines=())
    assert result.exit_only is False
    assert "行号" in result.reason


def test_switch_and_wide_instructions_are_split_correctly() -> None:
    """变长指令必须整体消费，否则后续指令全部错位。"""
    cases = (
        bytes([ILOAD_1]) + tableswitch(0, 1, 3, at=1) + bytes([IRETURN]),
        bytes([ILOAD_1]) + lookupswitch(0, ((7, 8), (9, 12)), at=1) + bytes([IRETURN]),
        bytes([ILOAD_1]) + goto_w(8) + bytes([IRETURN]),
        bytes([ILOAD_1]) + wide_iload(300) + bytes([IRETURN]),
    )
    for code in cases:
        instructions = scanner.disassemble(code)
        assert instructions[0].opcode == ILOAD_1, code.hex()
        assert instructions[-1].opcode == IRETURN, code.hex()


def test_truncated_bytecode_is_rejected() -> None:
    """指令流无法覆盖方法体时必须报错，不能给出未经证实的判定。"""
    with pytest.raises(scanner.ClassFileError):
        scanner.disassemble(bytes([ALOAD_0, INVOKEVIRTUAL, 0x00]))
    with pytest.raises(scanner.ClassFileError):
        scanner.parse_class_file(b"not a class file at all")


def test_cli_lists_candidates_with_lines_and_reason(tmp_path: Path) -> None:
    """真实 CLI 输出候选文件、方法、行范围与判定依据，且不改动被扫描目录。"""
    source = class_bytes("demo/Shape", [
        (ACC_PUBLIC, "single", "(Ljava/lang/Long;)Ljava/lang/Object;", DELEGATE_CALL, 0, (249, 249)),
        (ACC_PUBLIC, "branched", "(Ljava/lang/Long;)Ljava/lang/Object;", BRANCHED, 0, (260, 260)),
    ])
    root = classes_root(tmp_path, source)
    before = (root / "demo" / "Shape.class").read_bytes()
    result = run_cli(["--root", str(tmp_path), "--classes", str(root), "--json"], tmp_path)
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["schema"] == "exit-type-methods/v1"
    assert report["status"] == "passed"
    assert report["class_files_scanned"] == 1 and report["methods_scanned"] == 2
    assert [item["method"] for item in report["candidates"]] == ["single"]
    candidate = report["candidates"][0]
    assert candidate["class"] == "demo/Shape"
    assert (candidate["first_line"], candidate["last_line"]) == (249, 249)
    assert "唯一出口" in candidate["reason"]
    assert (root / "demo" / "Shape.class").read_bytes() == before


def test_cli_annotates_jacoco_reading_without_changing_it(tmp_path: Path) -> None:
    """候选清单可以附上 JaCoCo 当前读数供人工判断，形状判定本身不依赖该读数。"""
    root = classes_root(tmp_path, class_bytes("demo/Shape", [
        (ACC_PUBLIC, "single", "(Ljava/lang/Long;)Ljava/lang/Object;", DELEGATE_CALL, 0, (249,))]))
    report = jacoco_report(tmp_path / "jacoco.xml", "demo", "Shape.java", "single",
                           "(Ljava/lang/Long;)Ljava/lang/Object;", 249, 1, 0)
    result = run_cli(["--root", str(tmp_path), "--classes", str(root),
                      "--report", str(report), "--json"], tmp_path)
    assert result.returncode == 0, result.stderr
    candidate = json.loads(result.stdout)["candidates"][0]
    assert candidate["jacoco_method"] == {"line": 249, "missed": 1, "covered": 0}
    assert candidate["exit_only"] is True


def test_cli_reports_unreadable_class_with_exit_one(tmp_path: Path) -> None:
    """遇到无法解析的 class 文件时如实失败并列出位置，不静默跳过。"""
    root = classes_root(tmp_path, class_bytes("demo/Shape", [
        (ACC_PUBLIC, "single", "(Ljava/lang/Long;)Ljava/lang/Object;", DELEGATE_CALL, 0, (10,))]))
    (root / "demo" / "Broken.class").write_bytes(b"\xca\xfe\xba\xbe truncated")
    result = run_cli(["--root", str(tmp_path), "--classes", str(root), "--json"], tmp_path)
    assert result.returncode == 1
    report = json.loads(result.stdout)
    assert report["status"] == "unreadable-class-files"
    assert report["unreadable"] and "Broken.class" in report["unreadable"][0]["file"]


def test_cli_without_class_directory_fails_loudly(tmp_path: Path) -> None:
    """没有可扫描目录时以退出码 2 报出原因，不返回空清单冒充通过。"""
    result = run_cli(["--root", str(tmp_path), "--json"], tmp_path)
    assert result.returncode == 2
    assert "没有可扫描的 class 目录" in result.stderr


def test_cli_requires_report_per_class_root(tmp_path: Path) -> None:
    """--report 与 --classes 不成对时拒绝执行，避免把读数配到错误的范围。"""
    root = classes_root(tmp_path, class_bytes("demo/Shape", [
        (ACC_PUBLIC, "single", "()V", EMPTY_BODY_RETURN, 0, (10,))]))
    result = run_cli(["--root", str(tmp_path), "--classes", str(root),
                      "--report", str(tmp_path / "a.xml"), "--report", str(tmp_path / "b.xml"), "--json"],
                     tmp_path)
    assert result.returncode == 2
    assert "一一对应" in result.stderr


def test_cli_prints_human_readable_lines(tmp_path: Path) -> None:
    """默认输出是可读的一行一条候选，保留行范围与判定依据。"""
    root = classes_root(tmp_path, class_bytes("demo/Shape", [
        (ACC_PUBLIC, "single", "()V", EMPTY_BODY_RETURN, 0, (12, 12))]))
    result = run_cli(["--root", str(tmp_path), "--classes", str(root)], tmp_path)
    assert result.returncode == 0, result.stderr
    assert "出口型候选 1" in result.stdout
    assert "classes/demo/Shape.class:12-12 single()V" in result.stdout
    assert "唯一出口是末尾 return" in result.stdout
