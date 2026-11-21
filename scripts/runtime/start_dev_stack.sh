#!/bin/sh
# 启动本地中间件，应用并读回桶策略，再执行显式指定的后续命令。
# 可从任意目录调用，Compose 项目名读取 COMPOSE_PROJECT_NAME。
set -eu

fail() { echo "error: $1" >&2; exit 1; }

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd) || fail "cannot resolve repository root"
if [ "$#" -gt 0 ]; then
  [ "$1" = "--" ] || fail "usage: $0 [-- COMMAND [ARG...]]"
  shift
  [ "$#" -gt 0 ] || fail "missing COMMAND after --"
fi

for f in .env.dev .e2e-env/minio-bucket-policy.json; do
  [ -f "$root/$f" ] || fail "$f missing; run: python -B -X utf8 scripts/runtime/init_local_dev.py --apply"
  if git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$root" check-ignore -q -- "$f" || fail "$f must be gitignored"
  fi
done

dc() { docker compose -f "$root/docker-compose.dev.yml" --env-file "$root/.env.dev" "$@"; }
dc up --build -d --wait mysql redis minio || fail "mysql/redis/minio did not become healthy"
# 旧卷也启动一次新的初始化容器并等待策略读回。
dc run --rm --no-deps minio-init || fail "minio-init policy apply/readback failed"

if [ "$#" -gt 0 ]; then
  exec "$@"
fi
