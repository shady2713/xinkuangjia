"""验证本地开发引导脚本、容器环回配置与 CI 文档无漂移门禁。

覆盖默认只读预览、--apply 幂等生成、SM2 私钥合法范围、容器端口绑定及 CI 描述一致性。
@author shady2713
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest
import yaml
from scripts.common.quality_common import DEFAULT_ROOT
from scripts.runtime import init_local_dev

COMPOSE_FILE = DEFAULT_ROOT / "docker-compose.dev.yml"
WORKFLOW_FILE = DEFAULT_ROOT / ".github" / "workflows" / "ci.yml"
SCRIPT_INDEX_DOC = DEFAULT_ROOT / "docs" / "开发指南" / "脚本使用索引.md"
ROOT_README = DEFAULT_ROOT / "README.md"


def _parse_env_map(text: str) -> dict[str, str]:
    """将键值形式的 .env 文本解析为字典，忽略空行与井号注释。"""
    entries: dict[str, str] = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        entries[key] = value
    return entries


def _prepare_fake_repo(root: Path, *, init_git: bool = False) -> Path:
    """在临时目录建立含后端 .env.example 的最小仓库骨架。"""
    backend = root / "后端代码" / "basic-framework-boot"
    backend.mkdir(parents=True, exist_ok=True)
    (backend / ".env.example").write_text(
        "# 示例模板\n"
        "SERVER_PORT=48080\n"
        "DB_HOST=127.0.0.1\n"
        "DB_PORT=3306\n"
        "DB_NAME=basic_framework\n"
        "DB_USERNAME=your_db_username\n"
        "DB_PASSWORD=CHANGE_ME_DB_PASSWORD\n"
        "REDIS_PASSWORD=CHANGE_ME_REDIS_PASSWORD\n"
        "SM2_PRIVATE_KEY=\n"
        "MINIO_ACCESS_KEY=\n"
        "MINIO_SECRET_KEY=\n",
        encoding="utf-8",
        newline="\n",
    )
    if init_git:
        subprocess.run(["git", "init", "-b", "main", str(root)], check=True, capture_output=True)
    return root


def check_ci_doc_alignment(workflow_data: dict, index_text: str, readme_text: str) -> list[str]:
    """核对 CI 工作流中的前端 lint 与 pytest 门禁未在文档中被误标为未启用或非必过。

    Args:
        workflow_data: 解析后的 CI 工作流字典。
        index_text: 脚本使用索引文档全文。
        readme_text: 仓库根 README 全文。
    Returns:
        发现的漂移错误描述列表；无漂移时返回空列表。
    """
    errors: list[str] = []
    jobs = workflow_data.get("jobs", {})
    frontend_steps = [step.get("run", "") for step in jobs.get("frontend", {}).get("steps", [])]
    if any(
        cmd in frontend_steps
        for cmd in ("pnpm lint", "pnpm run quality:gates", "pnpm quality:gates")
    ):
        if "lint 暂不作为必过门禁" in index_text:
            errors.append("脚本使用索引仍声称前端 lint 暂不作为必过门禁，与 ci.yml 冲突")
        if "lint" not in index_text.lower():
            errors.append("脚本使用索引未登记前端 lint 必过门禁")
        if "lint" not in readme_text.lower():
            errors.append("根 README 的 CI 说明未包含前端 lint 门禁")
    if "pytest" in jobs:
        if "pytest" not in index_text:
            errors.append("脚本使用索引未在 CI 说明中登记 pytest 门禁")
        if "pytest" not in readme_text:
            errors.append("根 README 的 CI 说明未登记 pytest 门禁")
    return errors


def test_dry_run_never_writes_files_or_exposes_secrets(tmp_path: Path) -> None:
    """默认只读模式与显式 --dry-run 不得写入本地环境文件，且拒绝 --apply 冲突或单独 --force。"""
    repo = _prepare_fake_repo(tmp_path / "repo")
    assert init_local_dev.main(["--root", str(repo)]) == 0
    assert init_local_dev.main(["--root", str(repo), "--dry-run"]) == 0
    assert not (repo / ".env.dev").exists()
    assert not (repo / "后端代码" / "basic-framework-boot" / ".env").exists()
    assert init_local_dev.main(["--root", str(repo), "--force"]) == 2
    assert init_local_dev.main(["--root", str(repo), "--dry-run", "--force"]) == 2
    with pytest.raises(SystemExit) as conflict:
        init_local_dev.main(["--root", str(repo), "--dry-run", "--apply"])
    assert conflict.value.code == 2


def test_apply_generates_valid_sm2_key_and_preserves_existing_files(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """--apply 生成合法 SM2 私钥并挂载 .githooks，重复执行不覆盖已有文件且不回显密钥。"""
    repo = _prepare_fake_repo(tmp_path / "repo", init_git=True)
    assert init_local_dev.main(["--root", str(repo), "--apply"]) == 0
    captured = capsys.readouterr()

    compose_env = (repo / ".env.dev").read_text(encoding="utf-8")
    backend_env = (repo / "后端代码" / "basic-framework-boot" / ".env").read_text(encoding="utf-8")
    compose_map = _parse_env_map(compose_env)
    backend_map = _parse_env_map(backend_env)

    private_key_hex = backend_map["SM2_PRIVATE_KEY"]
    assert len(private_key_hex) == 64
    scalar = int(private_key_hex, 16)
    assert 1 <= scalar < init_local_dev.SM2_CURVE_ORDER

    db_password = compose_map["DB_PASSWORD"]
    assert len(db_password) >= 16
    assert backend_map["DB_PASSWORD"] == db_password
    assert private_key_hex not in captured.out + captured.err
    assert db_password not in captured.out + captured.err
    assert init_local_dev.current_hooks_path(repo) == ".githooks"

    # 不带 --force 再次运行必须保留原密钥不变
    assert init_local_dev.main(["--root", str(repo), "--apply"]) == 0
    assert (repo / "后端代码" / "basic-framework-boot" / ".env").read_text(encoding="utf-8") == backend_env

    # 显式传入 --apply --force 时允许轮换本地密钥
    assert init_local_dev.main(["--root", str(repo), "--apply", "--force"]) == 0
    rotated_env = (repo / "后端代码" / "basic-framework-boot" / ".env").read_text(encoding="utf-8")
    assert rotated_env != backend_env


def test_dev_compose_binds_loopback_only_and_requires_env_file() -> None:
    """本地开发 Compose 栈必须仅绑定 127.0.0.1 且不硬编码明文密码。"""
    compose = yaml.safe_load(COMPOSE_FILE.read_text(encoding="utf-8"))
    services = compose["services"]
    assert {"mysql", "redis", "minio", "minio-init"} <= set(services)
    assert services["mysql"]["image"] == "mysql:8.0.46"
    assert services["redis"]["image"] == "redis:7.4.10-alpine"
    assert services["minio"]["image"] == "minio/minio:RELEASE.2025-09-07T16-13-09Z"
    assert services["minio-init"]["image"] == "minio/mc:RELEASE.2025-08-13T08-35-41Z"
    assert services["minio"]["ports"] == [
        "127.0.0.1:${MINIO_API_PORT:-19000}:9000",
        "127.0.0.1:${MINIO_CONSOLE_PORT:-19001}:9001",
    ]
    for service_name, service in services.items():
        for port_mapping in service.get("ports", []):
            assert str(port_mapping).startswith("127.0.0.1:"), (
                f"{service_name} 端口必须绑定 127.0.0.1，实际为 {port_mapping}"
            )
    assert services["mysql"]["environment"]["MYSQL_ROOT_PASSWORD"].startswith("${")
    assert services["redis"]["environment"]["REDIS_PASSWORD"].startswith("${")
    assert services["minio"]["environment"]["MINIO_ROOT_PASSWORD"].startswith("${")
    # Redis 启动命令必须通过 /bin/sh 展开环境变量，不能在 exec 数组中传入字面量 ${REDIS_PASSWORD}
    redis_cmd = services["redis"]["command"]
    assert redis_cmd[:2] == ["/bin/sh", "-c"]
    assert "exec redis-server" in redis_cmd[2]
    assert "$$REDIS_PASSWORD" in redis_cmd[2]
    # MinIO 容器健康检查不得依赖镜像已移除的 curl，应使用内置 mc ready local
    minio_health_test = services["minio"]["healthcheck"]["test"]
    assert minio_health_test == ["CMD", "mc", "ready", "local"]
    assert "curl" not in " ".join(minio_health_test)
    # MinIO 初始化容器必须为开发桶设置匿名下载策略，避免本地上传文件预览 403
    minio_init_ep = "\n".join(services["minio-init"]["entrypoint"])
    assert "mc anonymous set download" in minio_init_ep


def test_ci_workflow_and_documentation_have_no_drift() -> None:
    """真实仓库 CI 工作流与脚本使用索引、根 README 保持一致，反例漂移必须失败。"""
    workflow_data = yaml.safe_load(WORKFLOW_FILE.read_text(encoding="utf-8"))
    index_text = SCRIPT_INDEX_DOC.read_text(encoding="utf-8")
    readme_text = ROOT_README.read_text(encoding="utf-8")
    assert check_ci_doc_alignment(workflow_data, index_text, readme_text) == []

    # 反向证明：若文档回退为“全量前端 lint 暂不作为必过门禁”，检查必须报错
    drifted_index = index_text + "\n全量前端 lint 暂不作为必过门禁。\n"
    errors = check_ci_doc_alignment(workflow_data, drifted_index, "仅后端与单测")
    assert len(errors) >= 2


def test_cli_entrypoint_runs_outside_repository(tmp_path: Path) -> None:
    """直接按脚本路径从外部工作目录运行 --help 与预览均正常退出。"""
    repo = _prepare_fake_repo(tmp_path / "repo")
    result = subprocess.run(
        [
            sys.executable,
            "-B",
            "-X",
            "utf8",
            str(DEFAULT_ROOT / "scripts" / "runtime" / "init_local_dev.py"),
            "--root",
            str(repo),
        ],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=15,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "只读预览" in result.stdout
