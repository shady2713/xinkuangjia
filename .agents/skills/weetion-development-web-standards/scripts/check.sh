#!/bin/bash
# Vue Vben CRUD 代码质量检查脚本
# 用法: 在管理前端工作区根目录 前端代码/basic-framework-admin 下执行
#   bash ../../.agents/skills/weetion-development-web-standards/scripts/check.sh <api-path> <views-path>
# 示例: bash ../../.agents/skills/weetion-development-web-standards/scripts/check.sh apps/web-ele/src/api/system/push apps/web-ele/src/views/system/push

API_PATH=$1
VIEW_PATH=$2

if [ -z "$API_PATH" ] || [ -z "$VIEW_PATH" ]; then
  echo "❌ 请提供实际路径"
  echo "用法: bash check.sh <api-path> <views-path>"
  echo "示例: bash check.sh apps/web-ele/src/api/system/push apps/web-ele/src/views/system/push"
  exit 1
fi

echo "🔍 开始检查"
echo "   API  路径: $API_PATH"
echo "   Views 路径: $VIEW_PATH"
ERRORS=0

# ── 1. TypeScript 类型检查 ──────────────────────────
echo ""
echo "📌 步骤 1: TypeScript 类型检查"

# vue-tsc 必须在含 tsconfig.json 的应用包目录下执行；
# 在 monorepo 根目录直接运行会因找不到 tsconfig 而只打印帮助信息并误判为失败。
TYPECHECK_DIR=""
search_dir=$(dirname "$VIEW_PATH")
while [ "$search_dir" != "." ] && [ "$search_dir" != "/" ]; do
  if [ -f "$search_dir/tsconfig.json" ]; then
    TYPECHECK_DIR="$search_dir"
    break
  fi
  search_dir=$(dirname "$search_dir")
done

if [ -z "$TYPECHECK_DIR" ]; then
  echo "⚠️  未找到 $VIEW_PATH 所属应用包的 tsconfig.json，跳过类型检查"
elif ! command -v pnpm &> /dev/null; then
  echo "⚠️  未找到 pnpm，跳过类型检查"
else
  echo "   在 $TYPECHECK_DIR 下执行 vue-tsc"
  (cd "$TYPECHECK_DIR" && pnpm exec vue-tsc --noEmit --skipLibCheck) 2>&1
  if [ $? -ne 0 ]; then
    echo "❌ TypeScript 类型检查失败，请修复以上错误"
    ERRORS=$((ERRORS + 1))
  else
    echo "✅ TypeScript 类型检查通过"
  fi
fi

# ── 2. 检查必需文件 ─────────────────────────
echo ""
echo "📌 步骤 2: 检查是否生成了所有必需文件"

FILES=(
  "$API_PATH/types.ts"
  "$API_PATH/index.ts"
  "$VIEW_PATH/index.vue"
  "$VIEW_PATH/modules/form.vue"
  "$VIEW_PATH/data.ts"
)

for FILE in "${FILES[@]}"; do
  if [ ! -f "$FILE" ]; then
    echo "❌ 缺少文件: $FILE"
    ERRORS=$((ERRORS + 1))
  else
    echo "✅ $FILE"
  fi
done

# ── 3. 检查相对路径 ─────────────────────────────────
echo ""
echo "📌 步骤 3: 检查相对路径（应使用 #/ 别名）"
RELATIVE=$(grep -rn "\.\.\/" "$VIEW_PATH" "$API_PATH" --include="*.ts" --include="*.vue" 2>/dev/null)
if [ -n "$RELATIVE" ]; then
  echo "❌ 发现相对路径，请替换为 #/ 别名:"
  echo "$RELATIVE"
  ERRORS=$((ERRORS + 1))
else
  echo "✅ 未发现相对路径"
fi

# ── 4. 检查 'any' 类型滥用 ────────────────────────────
echo ""
echo "📌 步骤 4: 检查 'any' 类型滥用"
ANY_USAGE=$(grep -rn ": any" "$API_PATH" "$VIEW_PATH" --include="*.ts" --include="*.vue" 2>/dev/null)
if [ -n "$ANY_USAGE" ]; then
  echo "⚠️  发现 'any' 类型，建议替换为具体类型:"
  echo "$ANY_USAGE"
else
  echo "✅ 未发现 'any' 类型滥用"
fi

# ── 5. 总结 ─────────────────────────────────────
echo ""
echo "════════════════════════════════"
if [ $ERRORS -gt 0 ]; then
  echo "❌ 检查失败，发现 $ERRORS 个错误，请修复后重新运行脚本"
  exit 1
fi
echo "🎉 全部检查通过，可以输出最终总结"
