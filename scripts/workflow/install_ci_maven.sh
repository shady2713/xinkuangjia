#!/usr/bin/env bash
# 仅在 GitHub 临时 runner 内安装固定 Maven，校验官方 SHA-512 后再解包。
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test -n "${RUNNER_TEMP:-}"
test -n "${GITHUB_PATH:-}"
archive="$RUNNER_TEMP/apache-maven-3.9.12-bin.tar.gz"
curl --fail --silent --show-error --location --retry 3 \
  https://archive.apache.org/dist/maven/maven-3/3.9.12/binaries/apache-maven-3.9.12-bin.tar.gz \
  --output "$archive"
printf '%s  %s\n' \
  0a1be79f02466533fc1a80abbef8796e4f737c46c6574ede5658b110899942a94db634477dfd3745501c80aef9aac0d4f841d38574373f7e2d24cce89d694f70 \
  "$archive" | sha512sum --check --status
tar -xzf "$archive" -C "$RUNNER_TEMP"
printf '%s\n' "$RUNNER_TEMP/apache-maven-3.9.12/bin" >> "$GITHUB_PATH"
