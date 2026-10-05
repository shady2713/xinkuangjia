#!/usr/bin/env bash
# 在 Java 工程根目录启动应用，使 application.yaml 能读取被忽略的 .env；与 start_java.ps1 等价。
# 用法：bash scripts/runtime/start_java.sh [-b|--build]
set -euo pipefail

build=false
for argument in "$@"; do
  case "$argument" in
    -b | --build) build=true ;;
    *)
      printf '未知参数：%s\n用法：bash scripts/runtime/start_java.sh [-b|--build]\n' "$argument" >&2
      exit 2
      ;;
  esac
done

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$script_directory/../.." && pwd)"
java_root="$repository_root/后端代码/basic-framework-boot"
cd "$java_root"

if [[ ! -f .env ]]; then
  printf '缺少 Java .env，请按 .env.example 配置数据库、Redis 和 MinIO。\n' >&2
  exit 1
fi

# 打包失败直接以 Maven 的退出码结束，不使用旧产物继续启动。
if [[ "$build" == true ]]; then
  mvn -q -DskipTests package
fi

jar_file="$java_root/basic-framework-server/target/basic-framework-server.jar"
if [[ ! -f "$jar_file" ]]; then
  printf '缺少应用 Jar，请使用 -b/--build 或先执行 Maven 打包。\n' >&2
  exit 1
fi

exec java -Dfile.encoding=UTF-8 -jar "$jar_file"
