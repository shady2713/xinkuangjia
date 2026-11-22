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

backend_env=后端代码/basic-framework-boot/.env
for f in .env.dev "$backend_env" .e2e-env/minio-bucket-policy.json; do
  [ -f "$root/$f" ] || fail "$f missing; run: python -B -X utf8 scripts/runtime/init_local_dev.py --apply"
  if git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$root" check-ignore -q -- "$f" || fail "$f must be gitignored"
  fi
done

# 每次启动读取一次有效配置。独立快照使初始化过程不受后来生成的策略文件影响。
python_bin=
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c "import sys" >/dev/null 2>&1; then
    python_bin=$candidate
    break
  fi
done
[ -n "$python_bin" ] || fail "python3 or python is required"

policy=$(mktemp "$root/.e2e-env/validated-policy.XXXXXXXX") || fail "cannot create policy snapshot"
trap 'rm -f "$policy"' EXIT INT TERM HUP
settings=$("$python_bin" -B -X utf8 "$root/scripts/runtime/init_local_dev.py" --check-bucket-policy "$policy" -- "$@") \
  || fail "MinIO settings or policy do not match"
IFS=' ' read -r MINIO_BUCKET MINIO_PUBLIC_ACCESS MINIO_ENDPOINT MINIO_API_PORT <<EOF
$settings
EOF
BASICFRAMEWORK_FILE_MINIO_BUCKET=$MINIO_BUCKET
BASICFRAMEWORK_FILE_MINIO_PUBLICACCESS=$MINIO_PUBLIC_ACCESS
BASICFRAMEWORK_FILE_MINIO_ENDPOINT=$MINIO_ENDPOINT
export MINIO_BUCKET MINIO_PUBLIC_ACCESS MINIO_ENDPOINT MINIO_API_PORT
export BASICFRAMEWORK_FILE_MINIO_BUCKET BASICFRAMEWORK_FILE_MINIO_PUBLICACCESS BASICFRAMEWORK_FILE_MINIO_ENDPOINT
chmod a+r "$policy"
policy_for_docker=$policy
if command -v cygpath >/dev/null 2>&1; then
  policy_for_docker=$(cygpath -m "$policy")
fi

# 后端使用宿主机环回端口，要求 Compose 连接本地 Docker。
docker_endpoint=${DOCKER_HOST:-}
if [ -n "${DOCKER_CONTEXT:-}" ] || [ -z "$docker_endpoint" ]; then
  docker_endpoint=$(docker context inspect --format '{{.Endpoints.docker.Host}}') || fail "cannot resolve Docker endpoint"
fi
case "$docker_endpoint" in
  unix:///*|npipe:////./pipe/*) ;;
  *) fail "local Docker socket required" ;;
esac

dc() {
  DOCKER_CONTEXT= DOCKER_HOST="$docker_endpoint" MINIO_POLICY_FILE="$policy_for_docker" \
    docker compose -f "$root/docker-compose.dev.yml" --env-file "$root/.env.dev" "$@"
}
dc up --build -d --wait mysql redis minio || fail "mysql/redis/minio did not become healthy"
published=$(dc port minio 9000) || fail "cannot read published MinIO endpoint"
[ "$published" = "${MINIO_ENDPOINT#http://}" ] || fail "published MinIO endpoint differs from backend configuration"
# 旧卷也启动一次新的初始化容器并等待策略读回。
dc run --rm --no-deps minio-init || fail "minio-init policy apply/readback failed"

rm -f "$policy"
trap - EXIT INT TERM HUP
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
