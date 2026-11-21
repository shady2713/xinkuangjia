#!/bin/sh
# 为单个桶应用匿名策略并读回验证。调用方配置 mc 别名及 jq。
# 两种访问模式使用同一读回流程。发生错误时退出且只输出固定提示。
set -eu

fail() { echo "error: $1" >&2; exit 1; }

[ "$#" -eq 2 ] || fail "usage: $0 POLICY_FILE ALIAS/BUCKET"
policy_file=$1
target=$2
# 限定目标为一个别名下的单一桶。
jq -ne --arg t "$target" '$t | test("\\A[A-Za-z0-9_-]+/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\\z")' >/dev/null \
  || fail "target must be ALIAS/BUCKET"

# 递归排序数组，并通过 -S 排序对象字段，避免顺序差异影响读回。
canon='walk(if type == "array" then sort else . end)'
expected=$(jq -ecS "$canon" "$policy_file" 2>/dev/null) || fail "cannot parse $policy_file"
mc anonymous set-json "$policy_file" "$target" >/dev/null 2>&1 || fail "cannot apply policy to $target"
readback=$(mc --json anonymous get-json "$target" 2>/dev/null) || fail "cannot read back policy of $target"
actual=$(printf '%s\n' "$readback" | jq -ecS 'select(.status == "success") | .anonymous
  | if type == "object" then . else error("missing policy") end | '"$canon" 2>/dev/null) \
  || fail "readback of $target lacks status success or a policy"
[ "$expected" = "$actual" ] || fail "readback of $target does not match $policy_file"
echo "verified anonymous policy of $target"
