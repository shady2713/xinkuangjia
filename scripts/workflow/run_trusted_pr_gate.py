"""从受信发布包运行独立 PR 审查及密钥扫描门禁。

使用隔离 Python，从本文件的真实路径定位代码，并从单独取得的裸 Git 仓库读取候选对象。

@author Claude Code
"""

import argparse
import json
import os
import re
import subprocess
import sys

SHA_RE = re.compile(r"[0-9a-f]{40}")
TRUSTED_DIR = os.path.dirname(os.path.realpath(__file__))
VERIFIER = os.path.join(TRUSTED_DIR, "verify_pr_review.py")
SCANNER_DIR = os.path.join(os.path.dirname(TRUSTED_DIR), "security")
SCANNER = os.path.join(SCANNER_DIR, "scan_staged_secrets.py")
# Child runner: under -I only the trusted scanner directory is importable (rules_scope).
RUNNER = (
    "import runpy, sys; path, script = sys.argv[1:3]; sys.path.insert(0, path); "
    "sys.argv = [script, *sys.argv[3:]]; runpy.run_path(script, run_name='__main__')"
)


def clean_env() -> dict[str, str]:
    """移除继承的 Git 和 Python 覆盖，并禁用全局配置及替换引用。"""
    env = {k: v for k, v in os.environ.items() if not k.startswith(("GIT_", "PYTHON"))}
    env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull, GIT_NO_REPLACE_OBJECTS="1",
               GIT_TERMINAL_PROMPT="0", GIT_OPTIONAL_LOCKS="0")
    return env


def git(repo: str, *args: str) -> str:
    """在裸仓库对象存储中执行只读 Git 命令。"""
    done = subprocess.run(["git", *args], cwd=repo, env=clean_env(), capture_output=True,
                          text=True, check=False, timeout=60)
    if done.returncode != 0:
        raise SystemExit(f"trusted gate: git {args[0]} failed")
    return done.stdout.strip()


def sha(value: object, label: str) -> str:
    """返回校验过的完整小写 SHA。"""
    if not isinstance(value, str) or not SHA_RE.fullmatch(value):
        raise SystemExit(f"trusted gate: invalid {label} sha")
    return value


def pr_sha(event: object, side: str) -> str:
    """从事件读取指定侧的 PR 版本。"""
    pr = event.get("pull_request") if isinstance(event, dict) else None
    ref = pr.get(side) if isinstance(pr, dict) else None
    return sha(ref.get("sha") if isinstance(ref, dict) else None, f"pull_request {side}")


def run_trusted(script: str, repo: str, args: list[str]) -> int:
    """在隔离 Python 中运行受信同级脚本并返回退出码。"""
    command = [sys.executable, "-I", "-B", "-X", "utf8", "-c", RUNNER, SCANNER_DIR, script, *args]
    return subprocess.run(command, cwd=repo, env=clean_env(), check=False, timeout=600).returncode


def main(argv: list[str] | None = None) -> int:
    """核对裸仓库及 PR 对象，然后执行两个受信门禁。"""
    parser = argparse.ArgumentParser(description="Run trusted PR review and secret gates.")
    for flag in ("--repo", "--event", "--checkout-sha", "--comments", "--reviews"):
        parser.add_argument(flag, required=True)
    parser.add_argument("--mode", required=True, choices=("solo", "team"))
    parser.add_argument("--maintainer", action="append", default=[])
    args = parser.parse_args(argv)
    repo = os.path.realpath(args.repo)
    bare = git(repo, "rev-parse", "--is-bare-repository") == "true"
    if not bare or os.path.realpath(git(repo, "rev-parse", "--absolute-git-dir")) != repo:
        raise SystemExit("trusted gate: --repo must be a bare Git object store")
    checkout = sha(args.checkout_sha, "checkout")
    try:
        with open(args.event, encoding="utf-8") as handle:
            event = json.load(handle)
    except (OSError, ValueError):
        raise SystemExit("trusted gate: event unreadable") from None
    base, head = pr_sha(event, "base"), pr_sha(event, "head")
    for value in (checkout, base, head):
        git(repo, "cat-file", "-e", f"{value}^{{commit}}")
    review = ["--repo", repo, "--event-name", "pull_request", "--checkout-sha", checkout]
    for flag in ("event", "comments", "reviews"):
        review += [f"--{flag}", os.path.abspath(getattr(args, flag))]
    review += ["--mode", args.mode]
    for login in args.maintainer:
        review += ["--maintainer", login]
    verified = run_trusted(VERIFIER, repo, review)
    scanned = run_trusted(SCANNER, repo, ["--base", base, "--head", head])
    print(json.dumps({"review": verified, "secrets": scanned}, sort_keys=True), file=sys.stderr)
    return 0 if verified == 0 and scanned == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
