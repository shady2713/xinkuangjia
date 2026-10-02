"""在启动 Node 前隔离测试子进程代理，保留调用者环境及真实测试退出码。

运行 python -B -X utf8 scripts/quality/run_frontend_tests.py --suite unit [--coverage]。
--proxy inherit 用于代理专项或真实外部接口测试；默认 local 不继承机器代理。
@author 李杰
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from delivery_rules import BYPASS, PROXY_KEYS


def test_environment(environment: dict[str, str], profile: str) -> dict[str, str]:
    """复制环境并按测试场景移除代理，不修改父进程或打印代理凭据。

    Args:
        environment: 父进程环境快照。
        profile: local 清除代理；inherit 保留显式测试环境。
    Returns:
        独立子进程环境；local 合并大小写 NO_PROXY 并保留原例外。
    """
    result = dict(environment)
    if profile == "inherit":
        return result
    if profile != "local":
        raise ValueError("未知代理隔离模式")
    values: list[str] = list(BYPASS)
    for key in tuple(result):
        if key.lower() in PROXY_KEYS:
            del result[key]
        elif key.lower() == "no_proxy":
            values.extend(
                part.strip() for part in result.pop(key).split(",") if part.strip()
            )
    bypass = ",".join(dict.fromkeys(values))
    result.update(NO_PROXY=bypass, no_proxy=bypass)
    return result


def run_process(
    command: list[str], root: Path, environment: dict[str, str], timeout: int
) -> int:
    """执行测试并继承输出；超时或取消时停止进程树并回收，防止遗留预览服务。

    Args:
        command: 已分离的 Node 与测试入口参数，不经 Shell 拼接。
        root: 当前前端目录。
        environment: 仅用于子进程的环境。
        timeout: 整组测试的秒数上限。
    Returns:
        真实退出码，超时返回 124，中断返回 130。
    """
    import signal

    process = subprocess.Popen(
        command, cwd=root, env=environment, start_new_session=os.name != "nt"
    )
    try:
        return process.wait(timeout=timeout)
    except (subprocess.TimeoutExpired, KeyboardInterrupt) as exc:
        if os.name == "nt":
            # 固定 taskkill 参数仅指向当前创建的进程树，不终止其他测试任务。
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                capture_output=True,
                timeout=15,
                check=False,
            )
        else:
            os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=15)
        return 130 if isinstance(exc, KeyboardInterrupt) else 124


def main() -> int:
    """调用所属前端已有 Vitest 或 Playwright；环境失败返回 2。"""
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--suite", choices=("unit", "e2e"), default="unit")
    parser.add_argument("--proxy", choices=("local", "inherit"), default="local")
    parser.add_argument("--coverage", action="store_true")
    parser.add_argument("--timeout", type=int, default=600)
    # pnpm 可能移除第一层 --；未知参数继续交给测试运行器验证，保持原顺序。
    args, arguments = parser.parse_known_args()
    if args.timeout < 1 or (args.coverage and args.suite != "unit"):
        parser.error("超时必须为正数，coverage 仅用于 unit")
    root = Path(__file__).resolve().parents[2]
    node = shutil.which("node")
    if not node:
        print("缺少 Node.js。", file=sys.stderr)
        return 2
    if args.suite == "unit":
        command = [node, str(root / "node_modules/vitest/vitest.mjs"), "run", "--dom"]
        if args.coverage:
            command.append("--coverage")
    else:
        config = (
            "playwright.config.ts"
            if (root / "playwright.config.ts").exists()
            else "apps/web-ele/playwright.config.ts"
        )
        command = [
            node,
            str(root / "node_modules/@playwright/test/cli.js"),
            "test",
            "--config",
            config,
        ]
    command.extend(arguments[1:] if arguments[:1] == ["--"] else arguments)
    try:
        return run_process(
            command, root, test_environment(dict(os.environ), args.proxy), args.timeout
        )
    except (OSError, subprocess.TimeoutExpired):
        print("测试进程无法启动或未能及时清理。", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
