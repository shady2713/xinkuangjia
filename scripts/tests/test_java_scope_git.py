"""用独立 Git 仓库验证真实目录、暂存语义及工作区检查的写入隔离。

路径样本来自仓库工程契约，故意不导入被测模块的目录常量。
@author OpenAI Codex
"""

from __future__ import annotations

import shutil
import json
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.code.java import check_staged_java_comments as java
from scripts.common.quality_common import DEFAULT_ROOT
from scripts.common.staged_content import Change
from scripts.security import scan_staged_secrets as secrets
from scripts.tests.git_sandbox import GitSandbox, create_sandbox
from scripts.workflow import check_staged_quality as runner

JAVA_PATH = "后端代码/basic-framework-boot/basic-framework-module-system/src/main/java/example/Demo.java"
VALID = "/** 验证真实模块路径。\n * @author OpenAI Codex\n */\npublic class Demo {\n    /** 执行测试动作。 */\n    void run() {}\n}\n"
INVALID = VALID.replace("    /** 执行测试动作。 */\n", "")


def execute(sandbox: GitSandbox, script: str, *args: str) -> subprocess.CompletedProcess[str]:
    """以真实 Python CLI 检查私有仓库，保留受控失败状态与脱敏诊断。"""
    return subprocess.run(
        [sys.executable, "-B", "-X", "utf8", str(DEFAULT_ROOT / script), *args],
        cwd=sandbox.root,
        env=sandbox.env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
    )


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        (JAVA_PATH, True),
        ("后端代码/basic-framework-boot/module/src/test/java/DemoTest.java", True),
        ("后端/java服务/Demo.java", False),
        ("后端代码/other-service/Demo.java", False),
        ("后端代码/basic-framework-boot/target/generated-sources/Demo.java", False),
        ("后端代码/basic-framework-boot/module/generated-sources/Demo.java", False),
        ("后端代码/basic-framework-boot/README.md", False),
    ],
)
def test_real_layout_routes_same_objects(
    monkeypatch: pytest.MonkeyPatch, path: str, expected: bool
) -> None:
    """分发器和检查器按独立路径样本纳管实际工程，保留生成产物的边界。"""
    monkeypatch.setattr(java, "_run_git", lambda *args, **kwargs: (path + "\0").encode())
    assert java._staged_java_paths() == ([path] if expected else [])
    names = [name for name, _, _ in runner.core_jobs([Change(path, "0" * 40, "a" * 40, "A")])]
    assert ("java-comments" in names) is expected


def test_wrong_path_mapping_fails_independent_expectation(monkeypatch: pytest.MonkeyPatch) -> None:
    """把目录判定替换为旧路径后，真实工程反例变为漏扫，独立期望能够发现。"""
    monkeypatch.setattr(java, "_run_git", lambda *args, **kwargs: (JAVA_PATH + "\0").encode())
    assert java._staged_java_paths() == [JAVA_PATH]
    monkeypatch.setattr(java, "is_java_source", lambda name: name.startswith("后端/java服务/"))
    assert java._staged_java_paths() != [JAVA_PATH]


@pytest.mark.parametrize("baseline", [False, True])
@pytest.mark.parametrize("staged_valid", [False, True])
def test_staged_java_reads_index_with_or_without_head(
    tmp_path: Path, baseline: bool, staged_valid: bool
) -> None:
    """无 HEAD 或单提交时都检查暂存版本，工作区的相反结果不能改变判定。"""
    sandbox = create_sandbox(tmp_path / "repository")
    if baseline:
        sandbox.stage(JAVA_PATH, VALID)
        sandbox.record_baseline()
    source = VALID.replace("void run()", "void changed()") if staged_valid else INVALID
    sandbox.stage(JAVA_PATH, source)
    worktree = sandbox.root / JAVA_PATH
    worktree.parent.mkdir(parents=True)
    worktree.write_text(INVALID if staged_valid else VALID, encoding="utf-8")
    result = execute(sandbox, "scripts/code/java/check_staged_java_comments.py")
    assert result.returncode == (0 if staged_valid else 1), result.stdout + result.stderr
    assert "1 个暂存文件" in result.stdout
    assert ("method-javadoc" in result.stderr) is (not staged_valid)


def test_rename_and_deleted_comment_checked_at_destination(tmp_path: Path) -> None:
    """重命名同时删除注释时报告新路径，旧文件删除不会让新声明漏检。"""
    sandbox = create_sandbox(tmp_path / "repository")
    sandbox.stage(JAVA_PATH, VALID)
    sandbox.record_baseline()
    destination = JAVA_PATH.replace("example/Demo.java", "renamed/Demo.java")
    sandbox.git("update-index", "--force-remove", JAVA_PATH)
    sandbox.stage(destination, INVALID)
    result = execute(sandbox, "scripts/code/java/check_staged_java_comments.py")
    assert result.returncode == 1, result.stdout + result.stderr
    assert destination in result.stderr and "method-javadoc" in result.stderr


@pytest.mark.parametrize("baseline", [False, True])
@pytest.mark.parametrize("language", ["java", "python"])
@pytest.mark.parametrize("staged_only", [False, True])
def test_worktree_comments_do_not_write_original_objects_or_index(
    tmp_path: Path, baseline: bool, language: str, staged_only: bool
) -> None:
    """两语言在无 HEAD、单提交及仅暂存变更时均检查私有快照，原索引和对象不变。"""
    sandbox = create_sandbox(tmp_path / "repository")
    source_path = JAVA_PATH if language == "java" else "src/service.py"
    valid = VALID if language == "java" else '\"\"\"提供测试服务。\n@author OpenAI Codex\n\"\"\"\nVALUE = 1\n'
    invalid = INVALID if language == "java" else valid + "def missing():\n    pass\n"
    for script in (
        f"scripts/code/{language}/check_staged_{language}_comments.py",
        "scripts/common/repository_layout.py",
        "scripts/common/check_protocol.py",
        # Java 检查器复用公共检查错误类型，把证据不可读映射为退出码 2。
        "scripts/common/quality_common.py",
    ):
        target = sandbox.root / script
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(DEFAULT_ROOT / script, target)
    (sandbox.root / ".git/info").mkdir(exist_ok=True)
    (sandbox.root / ".git/info/exclude").write_text("scripts/\n", encoding="utf-8")
    if baseline:
        sandbox.stage(source_path, valid)
        sandbox.record_baseline()
    target = sandbox.root / source_path
    target.parent.mkdir(parents=True)
    target.write_text(invalid, encoding="utf-8")
    if staged_only:
        sandbox.git("add", "--", source_path)
    index = sandbox.root / ".git/index"
    before_index = index.read_bytes() if index.exists() else None
    objects = sandbox.root / ".git/objects"
    before_objects = {path.relative_to(objects): path.read_bytes() for path in objects.rglob("*") if path.is_file()}
    result = execute(sandbox, f"scripts/code/{language}/check_worktree_{language}_comments.py")
    assert result.returncode == 1, result.stdout + result.stderr
    assert ("method-javadoc" if language == "java" else "function-docstring") in result.stderr
    assert (index.read_bytes() if index.exists() else None) == before_index
    after_objects = {path.relative_to(objects): path.read_bytes() for path in objects.rglob("*") if path.is_file()}
    assert after_objects == before_objects


@pytest.mark.parametrize("language", ["java", "python"])
def test_worktree_help_has_no_snapshot_side_effects(tmp_path: Path, language: str) -> None:
    """帮助请求在没有 Git 仓库的目录也成功，不触发源码检查或索引初始化。"""
    result = subprocess.run(
        [sys.executable, "-B", "-X", "utf8", str(DEFAULT_ROOT / f"scripts/code/{language}/check_worktree_{language}_comments.py"), "--help"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "usage:" in result.stdout
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("language", ["java", "python"])
@pytest.mark.parametrize("populated", [False, True])
def test_real_worktree_json_protocol(tmp_path: Path, language: str, populated: bool) -> None:
    """真实两语言工作树入口返回对象计数协议，空范围和有问题源码均不输出成功文本。"""
    sandbox = create_sandbox(tmp_path / "repository")
    for script in (
        f"scripts/code/{language}/check_staged_{language}_comments.py",
        "scripts/common/repository_layout.py",
        "scripts/common/check_protocol.py",
        # Java 检查器复用公共检查错误类型，把证据不可读映射为退出码 2。
        "scripts/common/quality_common.py",
    ):
        target = sandbox.root / script
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(DEFAULT_ROOT / script, target)
    (sandbox.root / ".git/info").mkdir(exist_ok=True)
    (sandbox.root / ".git/info/exclude").write_text("scripts/\n", encoding="utf-8")
    if populated:
        target = sandbox.root / (JAVA_PATH if language == "java" else "src/service.py")
        target.parent.mkdir(parents=True)
        target.write_text(INVALID if language == "java" else "def missing():\n    pass\n", encoding="utf-8")
    result = execute(sandbox, f"scripts/code/{language}/check_worktree_{language}_comments.py", "--json")
    assert result.returncode == (1 if populated else 0), result.stdout + result.stderr
    value = json.loads(result.stdout)
    assert value["protocol"] == "quality-check/v1"
    assert value["checked"] == int(populated)
    assert value["status"] == ("failed" if populated else "not-applicable")


def test_no_applicable_java_reports_no_validation(tmp_path: Path) -> None:
    """合理的无 Java 变更不阻断其他文件提交，但不能声称验证过 Java。"""
    sandbox = create_sandbox(tmp_path / "repository")
    sandbox.stage("notes.txt", "text\n")
    result = execute(sandbox, "scripts/code/java/check_staged_java_comments.py")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "不适用" in result.stdout and "未验证 Java 声明" in result.stdout
    assert "检查通过" not in result.stdout


def test_empty_secret_scope_reports_no_validation(tmp_path: Path) -> None:
    """空暂存范围只表明本次无适用对象，不冒充已经检查完整仓库。"""
    sandbox = create_sandbox(tmp_path / "repository")
    result = execute(sandbox, "scripts/security/scan_staged_secrets.py")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "不适用" in result.stdout and "未验证任何文件内容" in result.stdout
    assert "扫描通过" not in result.stdout


@pytest.mark.parametrize(
    ("path", "forbidden"),
    [
        ("后端代码/basic-framework-boot/.env", True),
        ("后端代码/basic-framework-boot/basic-framework-server/.env", True),
        ("docs/部署/.env", True),
        ("前端代码/basic-framework-admin/.env.local", True),
        ("前端代码/basic-framework-admin/.env", False),
        ("后端代码/basic-framework-boot/.env.example", False),
    ],
)
def test_real_env_paths(path: str, forbidden: bool) -> None:
    """后端真实环境不能提交，示例文件与受控前端构建环境保持原有契约。"""
    assert secrets._is_forbidden_env_path(path) is forbidden


@pytest.mark.parametrize("baseline", [False, True])
def test_real_runner_rejects_backend_env_with_or_without_head(tmp_path: Path, baseline: bool) -> None:
    """通过真实分发入口拒绝后端 .env，即使内容没有凭据且没有历史提交。"""
    sandbox = create_sandbox(tmp_path / "repository")
    if baseline:
        sandbox.stage("baseline.txt", "baseline\n")
        sandbox.record_baseline()
    sandbox.stage("后端代码/basic-framework-boot/.env", "MODE=development\n")
    result = execute(sandbox, "scripts/workflow/check_staged_quality.py", "--root", str(sandbox.root))
    assert result.returncode == 1, result.stdout + result.stderr
    assert "forbidden-env-file" in result.stderr
