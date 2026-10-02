"""验证拆分后的独立入口和真实调度，不依赖启动目录或 PYTHONPATH。

子进程只读取工具，测试文档仅写入 pytest 私有目录。
@author 李杰
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from scripts.common.quality_common import DEFAULT_ROOT

CLI_SCRIPTS = (
    "docs/verify_md_links.py",
    "docs/verify_doc_refs.py",
    "docs/verify_doc_structure.py",
    "docs/verify_doc_policy.py",
    "docs/verify_package_readmes.py",
    "docs/verify_mermaid.py",
    "docs/verify_agent_note_format.py",
    "docs/verify_agent_note_classification.py",
    "skills/verify_skill_metadata.py",
    "code/web/check_worktree_web_comments.py",
    "workflow/change_scope.py",
    "workflow/run_checks.py",
)


def run_entry(arguments: list[str], directory: Path) -> subprocess.CompletedProcess[str]:
    """在独立工作目录启动入口，保留真实输出和退出码，最多等待 15 秒。

    Args:
        arguments: Python 后面的独立参数，不通过 Shell 拼接。
        directory: 子进程工作目录，不作为工具导入路径。
    Returns:
        退出状态和 UTF-8 输出。
    Raises:
        subprocess.TimeoutExpired: 入口未在时限内退出。
    """
    environment = {key: value for key, value in os.environ.items() if key != "PYTHONPATH"}
    return subprocess.run(
        [sys.executable, "-B", "-X", "utf8", *arguments],
        cwd=directory,
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=15,
        check=False,
    )


@pytest.mark.parametrize("script", CLI_SCRIPTS)
def test_direct_entry_outside_repository(script: str, tmp_path: Path) -> None:
    """从仓库外按绝对路径运行入口，确认跨目录导入和参数解析可用。"""
    result = run_entry([str(DEFAULT_ROOT / "scripts" / script), "--help"], tmp_path)
    assert result.returncode == 0, result.stderr
    assert "usage:" in result.stdout


@pytest.mark.parametrize("broken", [False, True])
def test_dispatcher_preserves_real_result(broken: bool, tmp_path: Path) -> None:
    """真实调度检查，对有效文档和失效链接分别保留通过或失败状态。"""
    content = "# 测试\n" + ("[失效](missing.md)\n" if broken else "")
    (tmp_path / "说明.md").write_text(content, encoding="utf-8")
    result = run_entry(
        [
            str(DEFAULT_ROOT / "scripts/workflow/run_checks.py"),
            "--root",
            str(tmp_path),
            "--checks",
            "md-links",
            "--json",
        ],
        tmp_path,
    )
    expected = 1 if broken else 0
    assert result.returncode == expected, result.stderr
    report = json.loads(result.stdout)
    assert report["code"] == expected
    assert report["results"][0]["status"] == ("failed" if broken else "passed")


def test_module_entrypoint_lists_gates() -> None:
    """包方式运行使用同一调度注册表，且登记路径均指向真实入口。"""
    result = run_entry(["-m", "scripts.workflow.run_checks", "--list"], DEFAULT_ROOT)
    assert result.returncode == 0, result.stderr
    gates = json.loads(result.stdout)
    assert {gate["name"] for gate in gates} >= {"java-comments", "python-comments", "web-comments"}
    assert all((DEFAULT_ROOT / "scripts" / gate["script"]).is_file() for gate in gates)
