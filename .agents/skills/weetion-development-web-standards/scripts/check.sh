#!/usr/bin/env bash
# 在管理前端根目录执行完整 CRUD 检查；保留 Python 检查器的真实退出码。
# 用法：bash ../../.agents/skills/weetion-development-web-standards/scripts/check.sh <api-path> <views-path>
set -eu

if [ "$#" -ne 2 ]; then
  echo "用法：bash check.sh <api-path> <views-path>" >&2
  exit 2
fi

if ! command -v python >/dev/null 2>&1; then
  echo "缺少 Python，CRUD 检查未执行。" >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../../../.." && pwd)
exec python -B -X utf8 "$repo_root/前端代码/basic-framework-admin/scripts/quality/check_crud.py" "$1" "$2"
