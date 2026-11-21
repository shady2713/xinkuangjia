"""列出扫描器规则门禁共同保护的仓库相对路径。

按完整路径匹配。将本清单也纳入保护，避免对目录或文件名称做推断。

@author Claude Code
"""

SCANNER_RULES_PATHS = frozenset(
    {
        "scripts/security/scan_staged_secrets.py",
        "scripts/security/rules_scope.py",
    }
)
