"""验证 Web 全量注释门禁：注册形态、真实负对照、零对象与环境错误。

用真实 CLI 子进程与真实 Node 解析器，不使用替身；每条负对照都必须让对应用例失败。
@author 李杰
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from scripts.code.web.check_full_web_comments import scan_all_web_comments
from scripts.common.quality_common import CheckError, discover
from scripts.code.web.check_worktree_web_comments import EXTENSIONS
from scripts.workflow import run_checks
from scripts.workflow.run_checks import Gate, command_for, select_gates

ROOT = Path(__file__).resolve().parents[2]
FULL_ENTRY = "scripts/code/web/check_full_web_comments.py"
# 调度注册表里的脚本路径以 scripts/ 为基准，与命令行展开用的仓库相对路径不同。
FULL_GATE_SCRIPT = "code/web/check_full_web_comments.py"
INCREMENTAL_GATE_SCRIPT = "code/web/check_worktree_web_comments.py"
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"

# 受管 Web 文件全量的下限：真实仓库当前为 1530 个受管文件，低于该量说明范围被意外缩小。
MINIMUM_MANAGED_FILES = 1500
COMPLIANT_SOURCE = "/** 模块负责说明数量。 */\n/** 计算累计数量。\n * @param value - 当前数量。\n * @returns 累计数量。\n */\nexport function sum(value: number): number { return value + 1; }\n"
UNDOCUMENTED_SOURCE = "export function missing(value: number): number { return value; }\n"


def run_entry(arguments: list[str], root: Path, *, env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    """以真实解释器运行仓库内入口，保留退出码与输出。

    Args:
        arguments: 入口相对路径与命令行参数；入口按绝对路径展开，--root 可指向临时目录。
        root: 子进程工作目录。
        env: 可选环境覆盖，用于制造缺少 Node 的真实环境故障。
    Returns:
        已回收子进程的真实退出码与输出。
    """
    entry, *rest = arguments
    script = entry if Path(entry).is_absolute() else str(ROOT / entry)
    return subprocess.run(
        [sys.executable, "-B", "-X", "utf8", script, *rest],
        cwd=root,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=300,
    )


def gate(name: str) -> Gate:
    """取回登记在调度器里的固定检查配置。"""
    return next(item for item in run_checks.GATES if item.name == name)


def test_full_gate_is_registered_as_a_full_scope_comments_check() -> None:
    """全量子检查必须真实存在于调度注册表，且不登记任何零对象理由。"""
    full = gate("web-comments-full")
    assert full.script == FULL_GATE_SCRIPT
    assert full.group == "comments"
    assert full.scope == "worktree-full"
    assert full.root_argument is True
    # 登记零对象理由会让零范围被当成「不适用」而通过；全量入口不允许这条退路。
    assert full.zero_reason is None
    assert "web-comments-full" in [item.name for item in select_gates([], "comments")]
    assert select_gates(["web-comments-full"], "all") == [full]
    assert gate("web-comments").script == INCREMENTAL_GATE_SCRIPT
    assert gate("web-comments").scope == "worktree-incremental"


def test_gate_command_runs_the_full_entrypoint_with_root_and_json() -> None:
    """命令形态与 java-comments-full 一致：脚本路径、--root 与 --json 全部由调度器固定。"""
    full = command_for(gate("web-comments-full"), ROOT)
    assert full[1:5] == ["-B", "-X", "utf8", str(ROOT / "scripts" / FULL_GATE_SCRIPT)]
    assert full[5:] == ["--root", str(ROOT), "--json"]
    # 增量入口与全量入口必须不同文件，否则「全量」只是改名的增量。
    assert str(ROOT / "scripts" / INCREMENTAL_GATE_SCRIPT) not in full


def test_repository_scope_is_the_whole_managed_web_file_set() -> None:
    """真实仓库的全量范围必须覆盖整个受管文件集，不能只看本次改动。"""
    managed = [
        path for path in discover(ROOT, EXTENSIONS) if not path.name.endswith(".d.ts")
    ]
    assert len(managed) >= MINIMUM_MANAGED_FILES


def test_full_entrypoint_cli_passes_on_the_real_repository() -> None:
    """真实仓库全量扫描必须退出 0 并给出 1530 量级的正整数对象数。"""
    result = run_entry([FULL_ENTRY, "--root", str(ROOT), "--json"], ROOT)
    assert result.returncode == 0, result.stdout + result.stderr
    document = json.loads(result.stdout)
    assert document["status"] == "passed"
    assert document["findings"] == []
    assert type(document["checked"]) is int
    assert document["checked"] >= MINIMUM_MANAGED_FILES


def test_full_mode_rejects_a_real_comment_violation(tmp_path: Path) -> None:
    """负对照①：真实违规必须让全量入口非零退出，并点名文件与行。"""
    (tmp_path / "违规.ts").write_text(UNDOCUMENTED_SOURCE, encoding="utf-8")
    result = run_entry([FULL_ENTRY, "--root", str(tmp_path), "--json"], tmp_path)
    assert result.returncode == 1, result.stdout + result.stderr
    document = json.loads(result.stdout)
    assert document["status"] == "failed"
    assert document["checked"] == 1
    findings = [item for item in document["findings"] if item["path"] == "违规.ts"]
    assert findings, document["findings"]
    assert {"web-doc", "web-param", "web-returns"} <= {item["rule"] for item in findings}
    assert all(type(item["line"]) is int and item["line"] >= 1 for item in findings)

    # 补齐合规注释后同一命令必须恢复退出 0，证明判据来自真实规则而不是环境。
    (tmp_path / "违规.ts").write_text(COMPLIANT_SOURCE, encoding="utf-8")
    restored = run_entry([FULL_ENTRY, "--root", str(tmp_path), "--json"], tmp_path)
    assert restored.returncode == 0, restored.stdout + restored.stderr
    assert json.loads(restored.stdout)["checked"] == 1


def test_full_mode_does_not_pass_on_zero_objects(tmp_path: Path) -> None:
    """负对照②：零对象必须按环境错误失败，不能以「无适用对象」通过。"""
    (tmp_path / "说明.md").write_text("# 无 Web 源码\n", encoding="utf-8")
    result = run_entry([FULL_ENTRY, "--root", str(tmp_path), "--json"], tmp_path)
    assert result.returncode == 2, result.stdout + result.stderr
    assert "没有枚举到任何受管 Web 文件" in result.stderr

    # 调度层同样不能把它记成通过：零对象且没有登记理由时必须是 environment-error。
    assert run_checks.zero_scope_confirmed(gate("web-comments-full"), tmp_path) is False
    with pytest.raises(CheckError, match="没有枚举到任何受管 Web 文件"):
        scan_all_web_comments([], tmp_path)


def git(arguments: list[str], cwd: Path) -> None:
    """在隔离目录内执行真实 Git 写操作，用于构造可复现的历史状态。"""
    subprocess.run(["git", *arguments], cwd=cwd, check=True, capture_output=True, timeout=60)


def test_full_gate_catches_violations_in_unchanged_committed_files(tmp_path: Path) -> None:
    """真实 Git 仓库里未改动的历史违规：增量零对象，全量必须真实阻断。"""
    (tmp_path / "历史遗留.ts").write_text(UNDOCUMENTED_SOURCE, encoding="utf-8")
    git(["init", "-q"], tmp_path)
    git(["config", "user.email", "gate@example.com"], tmp_path)
    git(["config", "user.name", "gate"], tmp_path)
    git(["add", "历史遗留.ts"], tmp_path)
    git(["commit", "-q", "-m", "提交一个本来就违规的 Web 文件"], tmp_path)

    result = run_entry(
        [
            str(ROOT / "scripts" / "workflow" / "run_checks.py"),
            "--root", str(tmp_path),
            "--checks", "web-comments", "web-comments-full",
            "--timeout", "600", "--json",
        ],
        tmp_path,
    )
    assert result.returncode == 1, result.stdout + result.stderr
    document = json.loads(result.stdout)
    outcomes = {item["name"]: item for item in document["results"]}
    # 增量入口在未改动文件上零对象；全量入口必须把同一文件当作对象并阻断。
    assert outcomes["web-comments"]["status"] == "not-applicable"
    assert outcomes["web-comments"]["checked"] == 0
    assert outcomes["web-comments-full"]["status"] == "failed"
    assert outcomes["web-comments-full"]["checked"] == 1
    assert {
        "path": "历史遗留.ts",
        "line": 1,
        "rule": "web-doc",
    } in outcomes["web-comments-full"]["diagnostics"]


def test_full_mode_reports_missing_node_as_environment_error(tmp_path: Path) -> None:
    """负对照③：缺少 Node 运行时必须明确报环境错误（退出 2），不得记为通过。"""
    (tmp_path / "服务.ts").write_text(COMPLIANT_SOURCE, encoding="utf-8")
    environment = {**os.environ, "PATH": str(tmp_path / "无 node 目录")}
    result = run_entry([FULL_ENTRY, "--root", str(tmp_path), "--json"], tmp_path, env=environment)
    assert result.returncode == 2, result.stdout + result.stderr
    assert "需要 Node" in result.stderr
    assert "checked" not in result.stdout


def test_scheduler_reports_environment_error_instead_of_pass(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """子检查环境失败时汇总状态必须是 environment-error，且退出码为 2。"""
    monkeypatch.setattr(
        run_checks,
        "execute",
        lambda gate_config, root, timeout, cancel, **options: run_checks.Outcome(
            gate_config.name, "environment-error", 2, 0.0, "", checked=None, scope=gate_config.scope
        ),
    )
    outcomes = run_checks.schedule([gate("web-comments-full")], tmp_path, 1, 5)
    assert outcomes[0].status == "environment-error"
    assert run_checks.combined_code(outcomes) == 2


def test_release_chain_runs_the_full_web_check_with_pinned_node() -> None:
    """CI 发布链上的文档作业必须固定 Node 版本，并对全量子检查做真实断言。"""
    text = WORKFLOW.read_text(encoding="utf-8")
    section = text.split("\n  docs_tools:", 1)[1].split("\n  frontend:", 1)[0]
    assert "actions/setup-node@v4" in section and "node-version: 22" in section
    comments_step = section.split("- name: 运行注释检查", 1)[1].split("- name: 上传注释检查报告", 1)[0]
    assert "run_checks.py --group comments" in comments_step
    assert '"web-comments-full"' in comments_step
    assert "Web 全量注释子检查没有正整数的实测对象数" in comments_step
    assert "continue-on-error:" not in comments_step