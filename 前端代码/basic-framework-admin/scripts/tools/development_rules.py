"""当前前端开发检查的归属规则，与既有 ESLint 分层约束对应。

@author 李杰
"""

# API 端点解析由此公共 hook 负责；业务调用方应使用 useAppConfig 的结果。
CONFIG_OWNER = "packages/effects/hooks/src/use-app-config.ts"
# 基础包禁止向上依赖聚合包；base 层额外禁止依赖其他 core 包。
BASE_PACKAGES = frozenset(
    {
        "types",
        "utils",
        "icons",
        "constants",
        "styles",
        "stores",
        "preferences",
        "locales",
    }
)
# 仅包根的明确构建输出可进入清理计划，禁止任意深度按目录名删除。
BUILD_OUTPUTS = ("dist", "dist.zip", ".turbo")
SOURCE_SUFFIXES = frozenset({".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".vue"})
