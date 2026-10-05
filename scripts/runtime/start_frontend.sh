#!/usr/bin/env bash
# 从仓库入口启动管理前端，实际端口由应用开发配置决定；与 start_frontend.ps1 等价。
# 用法：bash scripts/runtime/start_frontend.sh
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$script_directory/../.." && pwd)"
frontend_root="$repository_root/前端代码/basic-framework-admin"
cd "$frontend_root"

exec pnpm dev:ele
