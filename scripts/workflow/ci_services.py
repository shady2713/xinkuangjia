"""为 GitHub Linux runner 提供独立 MySQL、Redis、MinIO，凭据仅留在临时环境。

@author OpenAI Codex
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shlex
import subprocess
import sys
import time
import urllib.request
import uuid
from pathlib import Path

# 三个服务种类固定；顺序决定启动顺序、状态文件登记顺序与客户端镜像选择。
KINDS = ("mysql", "redis", "minio")
# 只有实际解析过 linux/amd64 清单的来源才允许写死摘要，更新版本需重新核对并重跑真实集成测试。
# 下列 mysql、redis 摘要已用 `docker manifest inspect <引用>` 核对过 amd64 清单。
# MinIO 在本仓库开发环境无法证实：Docker Hub 匿名访问返回 401，dl.min.io 官方二进制端点返回 410，
# 因此不提供默认值；必须由 BF_CI_IMAGE_MINIO 显式给出并通过摘要校验，仓库不代为断言其可下载。
VERIFIED_IMAGES = {
    "mysql": "mysql@sha256:6b143fc1f4eab6fc9d20f383cd108c680170ff22678c5cd28551d35247fed0b3",  # 8.0.39
    "redis": "redis@sha256:28bd5e15c3674c48a472a3dd475ba446d0a3cd876e7addb988b5840a286b2256",  # 7.4.7
}
LABEL = "basic-framework.ci-owner"
PORTS = {"mysql": 13306, "redis": 16379, "minio": 19000}


def pinned(kind: str, value: str) -> str:
    """确认镜像按 sha256 摘要固定；可漂移的标签来源不得进入本次运行。

    Args:
        kind: 服务种类，仅用于错误定位。
        value: 外部提供的镜像引用。
    Returns:
        规范化后的 <仓库>@sha256:<64 位十六进制> 引用。
    Raises:
        ValueError: 缺少仓库名或摘要、仓库仍带标签、摘要算法或长度不符。
    """
    repository, separator, digest = value.rpartition("@")
    if (not separator or not repository or ":" in repository
            or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest)):
        raise ValueError(f"{kind} 镜像必须按 sha256 摘要固定")
    return f"{repository}@{digest}"


def images(environment: dict[str, str] | None = None) -> dict[str, str]:
    """解析本次运行固定的镜像来源，已证实来源才允许省略变量。

    Args:
        environment: 覆盖用环境映射；缺省读取进程环境。
    Returns:
        与 KINDS 等长且顺序一致的镜像引用。
    Raises:
        ValueError: 某服务既无已证实默认值又未显式配置，或来源不是摘要固定的引用。
    """
    source = dict(os.environ if environment is None else environment)
    resolved: dict[str, str] = {}
    for kind in KINDS:
        variable = f"BF_CI_IMAGE_{kind.upper()}"
        value = source.get(variable) or VERIFIED_IMAGES.get(kind)
        if not value:
            raise ValueError(f"{kind} 镜像来源未证实，必须显式设置 {variable}")
        resolved[kind] = pinned(kind, value)
    return resolved


def docker(arguments: list[str], environment: dict[str, str] | None = None, timeout: int = 180) -> subprocess.CompletedProcess[str]:
    """捕获 Docker 输出避免容器参数泄露；失败由调用方转换为不含凭据的错误。"""
    return subprocess.run(["docker", *arguments], env=environment, capture_output=True,
                          text=True, timeout=timeout, check=False)


def checked(arguments: list[str], environment: dict[str, str] | None = None) -> None:
    """执行必须成功的容器命令，不把可能含环境信息的原始错误写入日志。"""
    if docker(arguments, environment).returncode:
        raise RuntimeError("容器准备失败")


def context() -> tuple[Path, Path]:
    """限制服务操作只在 GitHub Linux 临时 runner，避免误停本机容器。

    Returns:
        已存在的 runner 临时目录及固定状态文件。
    Raises:
        ValueError: 环境不受支持、目录不真实或状态目录指向项目内部。
    """
    root = Path(os.environ.get("RUNNER_TEMP", "")).resolve()
    workspace = Path(os.environ.get("GITHUB_WORKSPACE", ".")).resolve()
    if (os.environ.get("GITHUB_ACTIONS") != "true" or sys.platform != "linux"
            or not os.environ.get("RUNNER_TEMP") or not root.is_dir() or root.is_relative_to(workspace)):
        raise ValueError("服务启动仅支持 GitHub Linux 临时 runner")
    return root, root / "basic-framework-ci-services.json"


def cleanup(state: Path) -> None:
    """仅删除状态中登记且所有权标签再次核验一致的本次随机容器。

    Args:
        state: 临时 runner 内由 start 以独占方式写入的状态文件，不存凭据。
    Raises:
        ValueError: 状态损坏或容器所有权不匹配；此时不删除该容器。
        RuntimeError: Docker 无法检查或删除已登记容器。
    """
    if not state.exists():
        return
    data = json.loads(state.read_text("utf-8"))
    owner = data.get("owner")
    if not isinstance(owner, str) or not re.fullmatch(r"[0-9a-f]{32}", owner):
        raise ValueError("无效服务所有权")
    names = data.get("containers")
    expected = {f"bf-ci-{owner}-{kind}" for kind in KINDS}
    if not isinstance(names, list) or set(names) != expected or len(names) != len(KINDS):
        raise ValueError("服务清单越过本次范围")
    for name in names:
        # 列表查询区分从未创建的容器和 daemon 故障，不能把故障视为已清理。
        listing = docker(["ps", "--all", "--filter", f"name=^/{name}$", "--format", "{{.Names}}"])
        if listing.returncode:
            raise RuntimeError("无法确认服务清理状态")
        if not listing.stdout.strip():
            continue
        found = docker(["inspect", "--format", '{{index .Config.Labels "' + LABEL + '"}}', name])
        if found.returncode or found.stdout.strip() != owner:
            raise ValueError("容器所有权不一致")
        checked(["rm", "--force", "--volumes", name])
    state.unlink()


def client_wrapper(root: Path, program: str, image: str) -> Path:
    """生成固定 MySQL 镜像客户端入口，沿用宿主端口及 stdin，密码只从环境传入。

    Args:
        root: runner 临时目录，入口只写在这里。
        program: 客户端程序名，只允许镜像自带的 mysql 与 mysqldump。
        image: 已按摘要固定的 MySQL 镜像，避免客户端与服务端版本漂移。
    Returns:
        新建的 0700 可执行入口路径。
    Raises:
        ValueError: 客户端名称不在允许集合内。
    """
    if program not in {"mysql", "mysqldump"}:
        raise ValueError("未知数据库客户端")
    path = root / f"bf-ci-{program}"
    command = ["docker", "run", "--rm", "--interactive", "--network", "host", "--env", "MYSQL_PWD",
               "--entrypoint", program, image]
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write("#!/usr/bin/env bash\nset -euo pipefail\nexec " + shlex.join(command) + ' "$@"\n')
    path.chmod(0o700)
    return path


def ready(names: dict[str, str], environment: dict[str, str]) -> bool:
    """用实际认证查询和 MinIO readiness 核验服务，不接受单纯端口已监听。"""
    mysql = docker(["exec", "--env", "MYSQL_PWD", names["mysql"], "mysql", "--protocol=TCP",
                    "--host=127.0.0.1", "--user=root", "--execute=SELECT 1"], environment, 15)
    redis = docker(["exec", "--env", "REDISCLI_AUTH", names["redis"], "redis-cli", "ping"], environment, 15)
    try:
        # 回环地址不得交给机器代理。
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f"http://127.0.0.1:{PORTS['minio']}/minio/health/ready", timeout=5) as response:
            minio = response.status == 200
    except OSError:
        minio = False
    return mysql.returncode == 0 and redis.returncode == 0 and redis.stdout.strip() == "PONG" and minio


def start(root: Path, state: Path) -> None:
    """创建三个固定镜像服务并写入仅供后续步骤使用的环境；失败清理本次容器。

    Args:
        root: GitHub runner 的独立临时目录。
        state: 尚不存在的所有权记录；重复启动会失败，不复用旧服务。
    Raises:
        OSError: 临时文件或环境输出无法写入。
        ValueError: 镜像来源缺失或不是摘要固定的引用。
        RuntimeError: Docker 操作失败或真实就绪查询超时。
    """
    resolved = images()
    owner = uuid.uuid4().hex
    names = {kind: f"bf-ci-{owner}-{kind}" for kind in KINDS}
    with state.open("x", encoding="utf-8") as stream:
        json.dump({"owner": owner, "containers": list(names.values())}, stream)
    environment = dict(os.environ)
    credentials = {name: secrets.token_hex(24) for name in ("MYSQL_ROOT_PASSWORD", "REDISCLI_AUTH", "MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD")}
    for value in credentials.values():
        print(f"::add-mask::{value}", flush=True)
    environment.update(credentials, MYSQL_ROOT_HOST="%", MYSQL_PWD=credentials["MYSQL_ROOT_PASSWORD"])
    try:
        redis_config = root / "bf-ci-redis.conf"
        with redis_config.open("x", encoding="utf-8") as stream:
            stream.write('bind 0.0.0.0\nprotected-mode yes\nsave ""\nappendonly no\nrequirepass ' + credentials["REDISCLI_AUTH"] + "\n")
        redis_config.chmod(0o600)
        for kind in KINDS:
            image = resolved[kind]
            checked(["pull", "--platform", "linux/amd64", image])
            port = {"mysql": 3306, "redis": 6379, "minio": 9000}[kind]
            command = ["run", "--detach", "--platform", "linux/amd64", "--name", names[kind], "--label", f"{LABEL}={owner}",
                       "--publish", f"127.0.0.1:{PORTS[kind]}:{port}"]
            if kind == "mysql":
                command += ["--env", "MYSQL_ROOT_PASSWORD", "--env", "MYSQL_ROOT_HOST", image]
            elif kind == "redis":
                command += ["--user", f"{os.getuid()}:{os.getgid()}", "--mount", f"type=bind,src={redis_config},dst=/redis.conf,readonly",
                            image, "redis-server", "/redis.conf"]
            else:
                command += ["--env", "MINIO_ROOT_USER", "--env", "MINIO_ROOT_PASSWORD", image, "server", "/data"]
            checked(command, environment)
        deadline = time.monotonic() + 180
        while not ready(names, environment):
            if time.monotonic() >= deadline:
                raise RuntimeError("真实服务未在时限内就绪")
            time.sleep(2)
        exports = {
            "AUTH_TEST_MYSQL_URL": f"jdbc:mysql://127.0.0.1:{PORTS['mysql']}/",
            "AUTH_TEST_MYSQL_USERNAME": "root", "AUTH_TEST_MYSQL_PASSWORD": credentials["MYSQL_ROOT_PASSWORD"],
            "BF_TEST_REDIS_PORT": str(PORTS["redis"]), "BF_TEST_REDIS_PASSWORD": credentials["REDISCLI_AUTH"],
            "BF_TEST_S3_ENDPOINT": f"http://127.0.0.1:{PORTS['minio']}",
            "BF_TEST_S3_ACCESS_KEY": credentials["MINIO_ROOT_USER"], "BF_TEST_S3_SECRET_KEY": credentials["MINIO_ROOT_PASSWORD"],
            "BF_TEST_MYSQL_CLIENT": str(client_wrapper(root, "mysql", resolved["mysql"])),
            "BF_TEST_MYSQL_DUMP": str(client_wrapper(root, "mysqldump", resolved["mysql"])),
        }
        with Path(os.environ["GITHUB_ENV"]).open("a", encoding="utf-8") as stream:
            stream.writelines(f"{name}={value}\n" for name, value in exports.items())
        # 只报告实际解析到的摘要，不复述未经证实的版本号。
        print("真实 CI 服务就绪：" + "、".join(f"{kind}@{resolved[kind].split('@')[-1][:19]}" for kind in KINDS)
              + "；3 个独立容器。")
    except BaseException:
        cleanup(state)
        raise


def main() -> int:
    """执行显式启动或清理；错误信息不带容器输出、凭据或完整环境。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("start", "stop"))
    args = parser.parse_args()
    try:
        root, state = context()
        if args.command == "start":
            start(root, state)
        else:
            cleanup(state)
        return 0
    except (OSError, ValueError, RuntimeError, KeyError, subprocess.TimeoutExpired):
        print("CI 服务操作失败；没有输出任何凭据或原始容器诊断。", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
