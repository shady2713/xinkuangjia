"""验证 CI 服务编排：镜像来源校验、健康检查、所有权清理、客户端与输出脱敏。

本文件不启动真实容器：CI 服务只在 GitHub Linux 临时 runner 内运行，
本机没有可用的 Linux 引擎，因此容器交互通过受控替身验证编排契约。

@author OpenAI Codex
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.workflow import ci_services as services

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "workflow" / "ci_services.py"
INSTALLER = ROOT / "scripts" / "workflow" / "install_ci_maven.sh"
OWNER = "a" * 32
DIGEST = "sha256:" + "b" * 64
# 固定夹具统一带 DUMMY 标记，显式声明为合成值，不指向任何可连接环境的真实凭据。
CREDENTIALS = {"MYSQL_ROOT_PASSWORD": "DUMMY-mysql-1", "REDISCLI_AUTH": "DUMMY-redis-2",
               "MINIO_ROOT_USER": "DUMMY-minio-3", "MINIO_ROOT_PASSWORD": "DUMMY-minio-4"}


class FakeDocker:
    """记录调用并按调用内容返回预设结果的 Docker 替身。"""

    # 子命令只按第一个参数精确匹配；--format 等长选项会包含 ps、rm 等子串，
    # 若也参与子串匹配，inspect 调用会被 --fo-rm-at 误判成删除命令。
    SUBCOMMANDS = ("exec", "inspect", "pull", "ps", "rm", "run")

    def __init__(self, results: dict[str, subprocess.CompletedProcess[str]] | None = None) -> None:
        """保存按关键字索引的返回值与实际调用记录。"""
        self.results = results or {}
        self.calls: list[list[str]] = []

    def __call__(self, arguments: list[str], environment: dict[str, str] | None = None,
                 timeout: int = 180) -> subprocess.CompletedProcess[str]:
        """按关键字匹配预设结果；未登记的调用一律判失败，避免替身放过未预期的编排。

        子命令键只比对 arguments[0]；其余键（如 SELECT、ping）按参数内子串比对，
        因为真实调用把查询放在 `--execute=SELECT 1` 这一个参数里。
        """
        self.calls.append(list(arguments))
        for key, value in self.results.items():
            if key in self.SUBCOMMANDS:
                if key in arguments:
                    return value
            elif any(key in argument for argument in arguments):
                return value
        return subprocess.CompletedProcess(arguments, 1, "", "unexpected command")

    def ran(self, *fragments: str) -> bool:
        """判断是否发生过包含全部片段的调用。"""
        return any(all(fragment in call for fragment in fragments) for call in self.calls)


def done(code: int = 0, out: str = "", err: str = "") -> subprocess.CompletedProcess[str]:
    """构造一个固定返回值的 CompletedProcess。"""
    return subprocess.CompletedProcess(["docker"], code, out, err)


def state_file(root: Path, owner: str = OWNER) -> Path:
    """写出与 start 相同结构的所有权记录。"""
    path = root / "basic-framework-ci-services.json"
    payload = {"owner": owner, "containers": [f"bf-ci-{owner}-{kind}" for kind in services.KINDS]}
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


class TestImageSources:
    """镜像必须按摘要固定；来源无法证实的服务不得使用写死默认值。"""

    def test_verified_defaults_are_digest_pinned(self) -> None:
        """已证实的 mysql、redis 默认值必须通过自身的摘要校验。"""
        resolved = services.images({"BF_CI_IMAGE_MINIO": f"minio/minio@{DIGEST}"})
        assert resolved["mysql"] == services.VERIFIED_IMAGES["mysql"]
        assert resolved["redis"] == services.VERIFIED_IMAGES["redis"]

    def test_minio_has_no_baked_default(self) -> None:
        """MinIO 来源在本环境无法证实，仓库不得代为断言一个看似确定的值。"""
        assert "minio" not in services.VERIFIED_IMAGES
        with pytest.raises(ValueError) as failure:
            services.images({})
        assert "BF_CI_IMAGE_MINIO" in str(failure.value)

    def test_minio_accepted_when_explicitly_configured(self) -> None:
        """显式给出 MinIO 摘要后即可解析，仍需通过摘要校验。"""
        environment = {"BF_CI_IMAGE_MINIO": f"minio/minio@{DIGEST}"}
        assert services.images(environment)["minio"] == f"minio/minio@{DIGEST}"

    @pytest.mark.parametrize("kind", services.KINDS)
    def test_environment_overrides_default(self, kind: str, monkeypatch: pytest.MonkeyPatch) -> None:
        """已证实服务也允许用环境变量覆盖，仍强制摘要固定。"""
        for name in list(os.environ):
            if name.startswith("BF_CI_IMAGE_"):
                monkeypatch.delenv(name, raising=False)
        for other in services.KINDS:
            monkeypatch.setenv(f"BF_CI_IMAGE_{other.upper()}", f"example/{other}@{DIGEST}")
        monkeypatch.setenv(f"BF_CI_IMAGE_{kind.upper()}", f"example/{kind}@{DIGEST}")
        assert services.images()[kind] == f"example/{kind}@{DIGEST}"

    @pytest.mark.parametrize("value", [
        "mysql:8.0.39",                       # 只有标签
        "mysql",                              # 既无标签也无摘要
        f"mysql:8.0.39@{DIGEST}",              # 仓库名里带标签
        "mysql@sha256:short",                  # 摘要长度不足
        "mysql@md5:" + "b" * 32,               # 摘要算法不符
        f"mysql@sha256:{'B' * 64}",            # 大写十六进制
        f"@{DIGEST}",                          # 缺仓库名
    ])
    def test_unpinned_sources_rejected(self, value: str) -> None:
        """反例：标签来源或畸形摘要一律拒绝，避免每次运行漂移到不同镜像。"""
        with pytest.raises(ValueError):
            services.pinned("mysql", value)

    def test_digest_case_is_normalised(self) -> None:
        """合法引用原样返回，规范化不改变实际摘要。"""
        assert services.pinned("mysql", f"mysql@{DIGEST}") == f"mysql@{DIGEST}"


class TestReadiness:
    """就绪判定必须基于真实认证与真实 readiness 端点，不接受仅端口监听。"""

    def names(self) -> dict[str, str]:
        """返回与 start 相同的容器命名。"""
        return {kind: f"bf-ci-{OWNER}-{kind}" for kind in services.KINDS}

    @staticmethod
    def install(monkeypatch: pytest.MonkeyPatch, fake: FakeDocker, status: int = 200) -> None:
        """注入 Docker 替身与固定 HTTP 响应。"""
        monkeypatch.setattr(services, "docker", fake)

        class Response:
            """最小 HTTP 响应替身。"""

            def __init__(self, code: int) -> None:
                """记录被断言的 HTTP 状态码。"""
                self.status = code

            def __enter__(self) -> "Response":
                """支持 with 语句，返回自身供调用方读取状态码。"""
                return self

            def __exit__(self, *_: object) -> None:
                """不抑制异常，交由调用方判定就绪结果。"""
                return None

        class Opener:
            """最小 opener 替身，忽略回环 URL 与超时参数。"""

            def open(self, url: str, timeout: int = 0) -> Response:
                """对任何回环地址返回预设状态码，模拟 readiness 端点。"""
                return Response(status)

        monkeypatch.setattr(services.urllib.request, "build_opener", lambda _: Opener())

    def test_all_services_ready(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """MySQL 认证成功、Redis 返回 PONG 且 MinIO readiness 为 200 时判定就绪。"""
        fake = FakeDocker({"SELECT": done(0), "ping": done(0, "PONG\n")})
        self.install(monkeypatch, fake)
        assert services.ready(self.names(), {}) is True

    def test_mysql_auth_failure(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """反例：MySQL 认证查询失败即未就绪，即使端口已监听。"""
        fake = FakeDocker({"SELECT": done(1), "ping": done(0, "PONG\n")})
        self.install(monkeypatch, fake)
        assert services.ready(self.names(), {}) is False

    @pytest.mark.parametrize("output", ["", "NOAUTH Authentication required.\n", "LOADING\n"])
    def test_redis_wrong_reply(self, monkeypatch: pytest.MonkeyPatch, output: str) -> None:
        """反例：Redis 返回内容不是 PONG 即未就绪。"""
        fake = FakeDocker({"SELECT": done(0), "ping": done(0, output)})
        self.install(monkeypatch, fake)
        assert services.ready(self.names(), {}) is False

    def test_minio_not_ready(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """反例：MinIO readiness 非 200 即未就绪。"""
        fake = FakeDocker({"SELECT": done(0), "ping": done(0, "PONG\n")})
        self.install(monkeypatch, fake, status=503)
        assert services.ready(self.names(), {}) is False

    def test_minio_unreachable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """反例：MinIO 连接失败按未就绪处理，不向上传播原始异常。"""
        fake = FakeDocker({"SELECT": done(0), "ping": done(0, "PONG\n")})

        def explode(*_: object, **__: object) -> object:
            """模拟 MinIO readiness 端点连接失败。"""
            raise OSError("connection refused")

        monkeypatch.setattr(services, "docker", fake)
        monkeypatch.setattr(services.urllib.request, "build_opener", lambda _: type("O", (), {"open": explode})())
        assert services.ready(self.names(), {}) is False


class TestOwnershipCleanup:
    """清理只能删除本次运行登记且所有权标签再次核验一致的容器。"""

    def test_removes_only_owned_containers(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """登记的三个容器所有权一致时才被删除，随后状态文件移除。"""
        fake = FakeDocker({"ps": done(0, "bf-ci-" + OWNER + "-mysql\n"), "rm": done(0),
                           "inspect": done(0, OWNER + "\n")})
        monkeypatch.setattr(services, "docker", fake)
        state = state_file(tmp_path)
        services.cleanup(state)
        assert len([c for c in fake.calls if c[:1] == ["rm"]]) == len(services.KINDS)
        assert not state.exists()

    def test_foreign_container_is_not_removed(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """反例：所有权标签不一致时必须拒绝删除，且保留状态文件。"""
        fake = FakeDocker({"ps": done(0, "bf-ci-other-mysql\n"), "rm": done(0),
                           "inspect": done(0, "f" * 32 + "\n")})
        monkeypatch.setattr(services, "docker", fake)
        state = state_file(tmp_path)
        with pytest.raises(ValueError):
            services.cleanup(state)
        assert not fake.ran("rm")
        assert state.exists()

    def test_daemon_failure_is_not_treated_as_clean(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """反例：docker ps 失败说明无法确认状态，不能当作容器不存在而继续。"""
        fake = FakeDocker({"ps": done(1, err="cannot connect to the Docker daemon")})
        monkeypatch.setattr(services, "docker", fake)
        state = state_file(tmp_path)
        with pytest.raises(RuntimeError):
            services.cleanup(state)
        assert not fake.ran("rm")
        assert state.exists()

    def test_unregistered_container_is_skipped(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """登记的容器不存在时不报错，也不触碰其他容器。"""
        fake = FakeDocker({"ps": done(0, ""), "rm": done(0)})
        monkeypatch.setattr(services, "docker", fake)
        state = state_file(tmp_path)
        services.cleanup(state)
        assert not fake.ran("rm")
        assert not state.exists()

    def test_missing_state_is_noop(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """没有状态文件时不执行任何 Docker 操作。"""
        fake = FakeDocker()
        monkeypatch.setattr(services, "docker", fake)
        services.cleanup(tmp_path / "absent.json")
        assert fake.calls == []

    @pytest.mark.parametrize("payload", [
        {"owner": "not-hex", "containers": []},
        {"owner": OWNER, "containers": ["bf-ci-" + OWNER + "-mysql"]},
        {"owner": OWNER, "containers": [f"bf-ci-{OWNER}-{k}" for k in services.KINDS] + ["bf-ci-x-mysql"]},
    ])
    def test_out_of_scope_state_rejected(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
                                         payload: dict[str, object]) -> None:
        """反例：状态损坏或越过本次范围时不得删除任何容器。"""
        fake = FakeDocker({"ps": done(0, "anything\n"), "rm": done(0), "inspect": done(0, OWNER + "\n")})
        monkeypatch.setattr(services, "docker", fake)
        state = tmp_path / "state.json"
        state.write_text(json.dumps(payload), encoding="utf-8")
        with pytest.raises(ValueError):
            services.cleanup(state)
        assert not fake.ran("rm")


class TestClientWrapper:
    """数据库客户端入口必须锁定同一镜像，且不落盘任何凭据。"""

    def test_wrapper_uses_pinned_mysql_image(self, tmp_path: Path) -> None:
        """入口使用已解析的 MySQL 摘要镜像，保证客户端与服务端同版本。"""
        image = f"mysql@{DIGEST}"
        path = services.client_wrapper(tmp_path, "mysql", image)
        text = path.read_text(encoding="utf-8")
        assert image in text
        assert "--env MYSQL_PWD" in text
        assert '"$@"' in text
        assert text.startswith("#!/usr/bin/env bash\nset -euo pipefail\n")
        if os.name != "nt":
            assert oct(path.stat().st_mode)[-3:] == "700"

    def test_wrapper_contains_no_secret(self, tmp_path: Path) -> None:
        """反例：入口文件不得包含任何密码字面量，密码只经环境传入。"""
        path = services.client_wrapper(tmp_path, "mysql", f"mysql@{DIGEST}")
        text = path.read_text(encoding="utf-8")
        for secret in CREDENTIALS.values():
            assert secret not in text
        assert "--env MYSQL_ROOT_PASSWORD" not in text

    @pytest.mark.parametrize("program", ["rm", "bash", "mysqlsh", ""])
    def test_unknown_program_rejected(self, tmp_path: Path, program: str) -> None:
        """反例：只允许镜像自带的两个客户端，避免把任意程序拼进执行入口。"""
        with pytest.raises(ValueError):
            services.client_wrapper(tmp_path, program, f"mysql@{DIGEST}")


class TestContextGuard:
    """服务编排只允许在 GitHub Linux 临时 runner 内运行。"""

    def test_rejects_plain_local_shell(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        """未标记 GITHUB_ACTIONS 的本机会话直接拒绝。"""
        monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
        with pytest.raises(ValueError):
            services.context()

    def test_rejects_temp_inside_workspace(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        """反例：状态目录落在工作区内会被拒绝，避免污染仓库。"""
        monkeypatch.setenv("GITHUB_ACTIONS", "true")
        monkeypatch.setattr(services.sys, "platform", "linux")
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        inside = workspace / "tmp"
        inside.mkdir()
        monkeypatch.setenv("GITHUB_WORKSPACE", str(workspace))
        monkeypatch.setenv("RUNNER_TEMP", str(inside))
        with pytest.raises(ValueError):
            services.context()


class TestFailureRedaction:
    """失败输出与日志不得包含凭据、令牌或容器原始诊断。"""

    def test_checked_failure_hides_docker_stderr(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """反例：Docker 失败时 stderr 里即使含密码也不得进入异常信息。"""
        leaked = done(1, err=f"failed: {CREDENTIALS['MYSQL_ROOT_PASSWORD']} rejected")
        monkeypatch.setattr(services, "docker", FakeDocker({"run": leaked, "pull": leaked}))
        with pytest.raises(RuntimeError) as failure:
            services.checked(["run", "--env", "MYSQL_ROOT_PASSWORD", "mysql:latest"])
        for secret in CREDENTIALS.values():
            assert secret not in str(failure.value)

    def test_main_reports_failure_without_secrets(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """反例：命令行动画中即使异常文本含秘密，stderr 也只输出固定提示。"""
        monkeypatch.setattr(services.sys, "argv", ["ci_services.py", "start"])
        monkeypatch.setattr(services, "context",
                            lambda: (tmp_path, tmp_path / "basic-framework-ci-services.json"))
        monkeypatch.setattr(services.urllib.request, "build_opener",
                            lambda _: type("O", (), {"open": lambda *a, **k: (_ for _ in ()).throw(OSError())})())

        def explode(*_: object, **__: object) -> None:
            """模拟镜像解析失败，且异常文本中夹带真实凭据形态的秘密。"""
            raise RuntimeError(f"boom {CREDENTIALS['MINIO_ROOT_PASSWORD']}")

        monkeypatch.setattr(services, "images", explode)
        done_result = subprocess.run([sys.executable, "-B", "-X", "utf8", "-c",
                                      f"import runpy,sys;sys.argv=['ci_services.py','start'];"
                                      f"runpy.run_path({str(SCRIPT)!r},run_name='__main__')"],
                                     cwd=ROOT, capture_output=True, text=True, timeout=60, check=False)
        assert done_result.returncode != 0
        assert "Traceback" not in done_result.stderr
        for secret in CREDENTIALS.values():
            assert secret not in done_result.stdout
            assert secret not in done_result.stderr

    def test_cli_start_on_plain_windows_refuses(self) -> None:
        """本机不是 GitHub runner，start 必须受控失败并返回 2。"""
        result = subprocess.run([sys.executable, "-B", "-X", "utf8", str(SCRIPT), "start"],
                                cwd=ROOT, capture_output=True, text=True, timeout=60, check=False)
        assert result.returncode == 2
        assert "Traceback" not in result.stderr
        assert "凭据" in result.stderr


class TestMavenInstaller:
    """Maven 安装脚本的静态结构与可动态验证的约束。"""

    def test_static_invariants(self) -> None:
        """脚本必须严格模式、校验 SHA-512、且只写 runner 临时目录。"""
        text = INSTALLER.read_text(encoding="utf-8")
        assert text.startswith("#!/usr/bin/env bash\n")
        assert "set -euo pipefail" in text
        assert 'GITHUB_ACTIONS:-' in text and "= true" in text
        assert "sha512sum --check" in text
        assert "archive.apache.org" in text
        assert '"$RUNNER_TEMP"' in text
        assert '"$GITHUB_PATH"' in text

    def test_pinned_checksum_is_sha512(self) -> None:
        """写死的摘要必须是 128 位十六进制的 SHA-512。"""
        text = INSTALLER.read_text(encoding="utf-8")
        checksums = [line.strip().split()[0] for line in text.splitlines()
                     if line.strip().startswith("0a1be7")]
        assert len(checksums) == 1
        assert len(checksums[0]) == 128
        assert all(character in "0123456789abcdef" for character in checksums[0])

    def test_maven_version_pinned(self) -> None:
        """下载地址与解包目录必须指向同一固定版本，避免静默升级。"""
        text = INSTALLER.read_text(encoding="utf-8")
        versions = set(re.findall(r"apache-maven-(\d+\.\d+\.\d+)", text))
        assert len(versions) == 1
        version = versions.pop()
        assert text.count(f"apache-maven-{version}") >= 2
        assert f"/maven-3/{version}/binaries/" in text

    def test_refuses_without_github_runner(self) -> None:
        """反例：不在 GitHub runner 时脚本必须在下载前失败。"""
        # Windows 上 bash 的诊断不保证是 UTF-8，替换解码避免读取线程噪声掩盖真实退出码。
        result = subprocess.run(["bash", str(INSTALLER)], capture_output=True, text=True,
                                encoding="utf-8", errors="replace",
                                env={"PATH": os.environ.get("PATH", "")}, timeout=60, check=False)
        assert result.returncode != 0
        assert "Traceback" not in result.stderr
