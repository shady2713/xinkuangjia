#!/bin/bash
# Vue Vben CRUD 代码质量检查脚本（Bash 包装，委托跨平台 Python 实现）
# 用法: 在管理前端工作区根目录 前端代码/basic-framework-admin 下执行
#   bash ../../.agents/skills/weetion-development-web-standards/scripts/check.sh <api-path> <views-path>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  PYTHON_BIN="python"
fi

exec "$PYTHON_BIN" -B -X utf8 "$SCRIPT_DIR/check_crud.py" "$@"
