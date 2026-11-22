#!/bin/sh
# 启动本地开发中间件（MySQL + Redis），可选执行后续命令。
set -eu

fail() { echo "error: $1" >&2; exit 1; }

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd) || fail "cannot resolve repository root"
if [ "$#" -gt 0 ]; then
  [ "$1" = "--" ] || fail "usage: $0 [-- COMMAND [ARG...]]"
  shift
  [ "$#" -gt 0 ] || fail "missing COMMAND after --"
fi

backend_env=后端代码/basic-framework-boot/.env
for f in .env.dev "$backend_env"; do
  [ -f "$root/$f" ] || fail "$f missing; run: python -B -X utf8 scripts/runtime/init_local_dev.py --apply"
  if git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$root" check-ignore -q -- "$f" || fail "$f must be gitignored"
  fi
done

docker compose -f "$root/docker-compose.dev.yml" --env-file "$root/.env.dev" up -d --wait mysql redis \
  || fail "mysql/redis did not become healthy"

if [ "$#" -gt 0 ]; then
  exec "$@"
fi
