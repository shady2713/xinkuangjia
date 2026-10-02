"""通过 JSON 标准输入调用锁定版本的 Node 语法解析桥接器。

不会自动安装依赖或运行目标仓库代码；缺少工具时明确返回环境错误。
@author 李杰
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from scripts.common.quality_common import CheckError, run_process

FRONTEND_ROOT = Path(__file__).resolve().parents[2] / "前端代码"


def frontend_directory(mode: str, payload: dict[str, object]) -> Path:
    """选择已安装依赖的独立前端；单工程 Web 请求优先使用所属工程。

    Args:
        mode: Web 或 Mermaid 解析模式。
        payload: 带仓库相对路径的解析请求。
    Returns:
        本次解析所属的前端目录。
    Raises:
        CheckError: 所选前端尚未安装依赖。
    """
    projects = ["basic-framework-admin"]
    files = payload.get("files", []) if mode == "web" else []
    if isinstance(files, list) and files:
        # Web 解析使用本框架管理前端的依赖，不借用来源项目的运行环境。
        owners = {
            name
            for name in projects
            if any(
                isinstance(item, dict) and str(item.get("path", "")).startswith(f"前端代码/{name}/")
                for item in files
            )
        }
        if len(owners) == 1:
            projects = list(owners)
    for name in projects:
        directory = FRONTEND_ROOT / name
        if (directory / "node_modules" / "mermaid").exists():
            return directory
    raise CheckError(
        "需要 Node 20.19+ 及前端依赖，请在相应前端工程执行 pnpm install --frozen-lockfile"
    )


def invoke(mode: str, payload: dict[str, object]) -> dict[str, Any]:
    """调用内部解析器并校验 JSON 响应，不执行被检查的源码。

    Args:
        mode: web 或 mermaid，由检查入口确定。
        payload: 待解析文本及定位数据。
    Returns:
        桥接器返回的对象。
    Raises:
        CheckError: 依赖缺失、超时、进程失败或输出协议无效。
    """
    executable = shutil.which("node")
    if executable is None:
        raise CheckError(
            "需要 Node 20.19+ 及前端依赖，请在相应前端工程执行 pnpm install --frozen-lockfile"
        )
    directory = frontend_directory(mode, payload)
    request = json.dumps({"mode": mode, **payload}, ensure_ascii=False).encode("utf-8")
    if len(request) > 32 * 1024 * 1024:
        raise CheckError("语法解析请求超过 32 MiB，请缩小检查范围")
    result = run_process(
        [executable, str(directory / "scripts" / "quality-bridge.mjs")],
        directory,
        input_bytes=request,
        timeout=120,
    )
    if result.code:
        raise CheckError(
            "语法解析器执行失败：" + result.stderr.decode("utf-8", errors="replace")[:2000]
        )
    try:
        value = json.loads(result.stdout)
    except (ValueError, UnicodeError) as exc:
        raise CheckError("语法解析器未返回有效 JSON") from exc
    if not isinstance(value, dict) or not isinstance(value.get("findings"), list):
        raise CheckError("语法解析器响应结构不正确")
    # JSON 是异构边界；在返回给诊断数据类前逐项收窄，避免假成功或未捕获异常。
    for finding in value["findings"]:
        if (
            not isinstance(finding, dict)
            or set(finding) != {"path", "line", "rule", "message"}
            or not isinstance(finding["line"], int)
            or isinstance(finding["line"], bool)
            or finding["line"] < 1
            or any(not isinstance(finding[key], str) for key in ("path", "rule", "message"))
        ):
            raise CheckError("语法解析器返回无效诊断")
    return value
