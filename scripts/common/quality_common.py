"""提供只读质量检查的文件发现、诊断输出及受控子进程。

入口默认定位当前工具所属仓库，可用 --root 指定测试仓库。
不修改被检查文件或 Git 索引；临时输出文件由本模块创建并清理。
@author 李杰
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Sequence

# 质量入口只维护 Python 源码，导入及派生检查不在 scripts 下生成字节码。
sys.dont_write_bytecode = True
os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")

# 排除依赖、生成物和冻结笔记；显式指定路径也不能绕过这些范围。
EXCLUDED_DIRS = frozenset(
    {
        ".git",
        ".venv",
        "venv",
        "node_modules",
        "__pycache__",
        ".pytest_cache",
        ".ruff_cache",
        "vendor",
        "dist",
        "build",
        "target",
        ".worktrees",
    }
)
ARCHIVED = (".agents", "notes", "archived")
MAX_TEXT_BYTES = 16 * 1024 * 1024
MAX_OUTPUT_BYTES = 32 * 1024 * 1024
DEFAULT_ROOT = Path(__file__).resolve().parents[2]


class CheckError(RuntimeError):
    """表示检查无法完成的环境、输入或解析错误，退出码为 2。"""


@dataclass(frozen=True)
class Finding:
    """保存可定位的规则问题；line 为一基行号，不携带完整源码。"""

    path: str
    line: int
    rule: str
    message: str


@dataclass(frozen=True)
class ProcessResult:
    """保存已回收子进程的退出码和 UTF-8 解码前的标准流。"""

    code: int
    stdout: bytes
    stderr: bytes


def _terminate(process: subprocess.Popen[bytes]) -> None:
    """终止本次创建的进程树并回收父进程，不按名称匹配其他进程。"""
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=15,
            check=False,
        )
    else:
        os.killpg(process.pid, signal.SIGKILL)
    if process.poll() is None:
        process.kill()
    process.wait(timeout=15)


def run_process(
    arguments: Sequence[str],
    cwd: Path,
    *,
    input_bytes: bytes | None = None,
    timeout: float = 120,
    env: dict[str, str] | None = None,
    cancel: threading.Event | None = None,
) -> ProcessResult:
    """执行参数数组并回收子进程，返回原始输出。

    Args:
        arguments: 可执行程序及独立参数，不经过 Shell。
        cwd: 子进程工作目录。
        input_bytes: 可选标准输入，不解释为代码或命令。
        timeout: 完成和通信的最长秒数。
        env: 子进程环境；未传时继承当前环境。
        cancel: 调度器的取消信号，触发后终止并回收当前子进程树。
    Returns:
        已结束进程的退出状态和输出。
    Raises:
        CheckError: 启动失败、超时或输出超过上限。
    """
    try:
        # 临时文件承接输出，防止检查较大仓库时管道死锁和内存无限增长。
        with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
            process = subprocess.Popen(
                list(arguments),
                cwd=cwd,
                env=env,
                stdin=subprocess.PIPE if input_bytes is not None else subprocess.DEVNULL,
                stdout=stdout,
                stderr=stderr,
                start_new_session=os.name != "nt",
            )
            try:
                deadline = time.monotonic() + timeout
                pending_input = input_bytes
                while True:
                    if cancel is not None and cancel.is_set():
                        _terminate(process)
                        raise CheckError("检查已取消，子进程已终止")
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise subprocess.TimeoutExpired(arguments, timeout)
                    try:
                        process.communicate(pending_input, timeout=min(0.2, remaining))
                        break
                    except subprocess.TimeoutExpired:
                        # communicate 会保留尚未发送的输入，后续调用不能重复写入。
                        pending_input = None
                        if stdout.tell() + stderr.tell() > MAX_OUTPUT_BYTES:
                            _terminate(process)
                            raise CheckError("子进程输出超过 32 MiB，已终止")
            except (subprocess.TimeoutExpired, KeyboardInterrupt):
                _terminate(process)
                raise
            if stdout.tell() + stderr.tell() > MAX_OUTPUT_BYTES:
                raise CheckError("子进程输出超过 32 MiB，检查未完成")
            stdout.seek(0)
            stderr.seek(0)
            return ProcessResult(process.returncode, stdout.read(), stderr.read())
    except subprocess.TimeoutExpired as exc:
        raise CheckError(f"子进程超过 {timeout:g} 秒，已终止") from exc
    except OSError as exc:
        raise CheckError(f"无法启动子进程 {arguments[0]}：{exc}") from exc


def git(root: Path, *arguments: str) -> bytes:
    """只读调用 Git；命令失败抛出 CheckError，返回 NUL 安全的原始输出。"""
    env = {**os.environ, "GIT_OPTIONAL_LOCKS": "0", "LC_ALL": "C", "LANG": "C"}
    result = run_process(
        ["git", "-C", str(root), "-c", "core.fsmonitor=false", *arguments],
        root,
        env=env,
    )
    if result.code:
        raise CheckError(result.stderr.decode("utf-8", errors="replace").strip())
    if b"ambiguous" in result.stderr.lower():
        raise CheckError("Git 引用有歧义，请使用完整引用名")
    return result.stdout


def excluded(path: Path) -> bool:
    """判断仓库相对路径是否属于依赖、生成物或冻结笔记。"""
    parts = path.parts
    return any(part in EXCLUDED_DIRS for part in parts) or parts[:3] == ARCHIVED


def safe_path(root: Path, relative: str) -> Path:
    """解析仓库内路径；越界或链接指向排除区域时抛出 CheckError。"""
    candidate = root / relative
    resolved = candidate.resolve()
    if not resolved.is_relative_to(root) or excluded(resolved.relative_to(root)):
        raise CheckError(f"路径越界或指向排除区域：{relative}")
    return candidate


def discover(root: Path, suffixes: set[str], paths: Sequence[str] = ()) -> list[Path]:
    """发现可检查文件并按真实路径去重；显式目标缺失时报错。

    Args:
        root: 已解析的仓库根目录。
        suffixes: 允许的小写扩展名。
        paths: 相对于根目录的文件或目录；空值表示整个仓库。
    Returns:
        稳定排序的文件列表，遵守 Git 忽略和固定排除规则。
    Raises:
        CheckError: 显式目标不存在、越界，或文件发现失败。
    """
    if not root.is_dir():
        raise CheckError(f"仓库根目录不存在：{root}")
    selected = [safe_path(root, item) for item in paths]
    for item in selected:
        if not item.exists():
            raise CheckError(f"指定目标不存在：{item}")
    # 显式文件直接命中；目录范围只遍历候选文件的祖先，避免逐对比较全部路径。
    selected_paths = set(selected)
    if (root / ".git").exists():
        names = git(root, "ls-files", "--cached", "--others", "--exclude-standard", "-z")
        candidates = [root / name for name in names.decode("utf-8").split("\0") if name]
    else:
        candidates = []
        for folder, dirs, files in os.walk(root, followlinks=False):
            parent = Path(folder)
            dirs[:] = [
                name
                for name in dirs
                if not excluded((parent / name).relative_to(root))
                and not (parent / name).is_symlink()
                and not getattr(parent / name, "is_junction", lambda: False)()
            ]
            candidates.extend(parent / name for name in files)
    result: list[Path] = []
    seen: set[Path] = set()
    for item in sorted(set(candidates)):
        rel = item.relative_to(root)
        if excluded(rel) or item.suffix.lower() not in suffixes:
            continue
        if (
            selected_paths
            and item not in selected_paths
            and not any(parent in selected_paths for parent in item.parents)
        ):
            continue
        real = item.resolve()
        if not real.is_relative_to(root) or excluded(real.relative_to(root)):
            continue
        if item.is_file() and real not in seen:
            seen.add(real)
            result.append(item)
    return result


def read_text(path: Path) -> str:
    """读取有上限的 UTF-8 文本，接受 BOM，拒绝乱码而不替换字符。"""
    if path.stat().st_size > MAX_TEXT_BYTES:
        raise CheckError(f"文件超过 16 MiB：{path}")
    return path.read_text(encoding="utf-8-sig")


def parser(description: str) -> argparse.ArgumentParser:
    """创建公共命令行参数；路径均相对于 --root 解释。"""
    result = argparse.ArgumentParser(description=description)
    result.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="待检查仓库根目录")
    result.add_argument("--json", action="store_true", help="输出结构化 JSON")
    result.add_argument("paths", nargs="*", help="可选的仓库相对文件或目录")
    return result


def report(name: str, checked: int, findings: list[Finding], *, as_json: bool) -> int:
    """输出计数和诊断，规则问题返回 1，无问题返回 0。"""
    if as_json:
        print(
            json.dumps(
                {
                    "check": name,
                    "checked": checked,
                    "findings": [asdict(f) for f in findings],
                    "status": "failed" if findings else "passed",
                },
                ensure_ascii=False,
            )
        )
    else:
        print(f"{name}：检查 {checked} 个对象，发现 {len(findings)} 个问题。")
        for finding in findings:
            print(f"{finding.path}:{finding.line} [{finding.rule}] {finding.message}")
    return 1 if findings else 0


def entry(action: Callable[[], int]) -> int:
    """配置中文输出并把可预期环境失败转换为退出码 2，中断返回 130。"""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    try:
        return action()
    except (CheckError, OSError, UnicodeError, ImportError) as exc:
        print(f"检查未完成：{exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("检查已中断。", file=sys.stderr)
        return 130
