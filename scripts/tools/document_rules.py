"""集中配置文档检查的范围、分类和禁用引用。

检查器以 AST 字面量读取 RULES，不导入或执行本文件。路径均相对于待查仓库，
通配符采用 fnmatch，星号可跨目录；排除项必须记录理由。修改后运行文档工具测试。
@author 李杰
"""

RULES = {
    "path_prefixes": ["docs/", "scripts/", "tools/", ".agents/", "前端代码/", "后端代码/", "数据库文件/"],
    "path_placeholders": ["相对路径", "文件名", "目录名"],
    "structure_exclusions": {
        "AGENTS.md": "智能体指令有独立格式",
        "AGENTS.zh.md": "中文智能体指令入口有独立格式",
        "*/AGENTS.md": "目录指令有独立格式",
        ".agents/notes/*": "决策记录由笔记格式检查负责",
        ".agents/skills/*/SKILL.md": "技能主文件有独立格式",
        ".agents/skills/*/templates/*": "模板包含示例骨架，不是普通页面",
        ".github/pull_request_template.md": "GitHub 拉取请求清单由评审章节组织，不是普通页面",
    },
    "package_manifests": ["package.json", "pom.xml", "pyproject.toml"],
    "package_readmes": [],
    "readme_sections": {
        "package-group": ["摘要", "目录", "包", "相关文档"],
        "package-reference": ["摘要", "目录", "已知限制与暂缓工作"],
        "package-library": ["摘要", "目录", "已知限制与暂缓工作"],
        "package-bundle": ["摘要", "目录", "已知限制与暂缓工作"],
    },
    "runtime_kinds": ["package-reference", "package-library", "package-bundle"],
    "developer_headings": ["理解实现", "实现细节", "开发者细节", "运行原理与维护"],
    "forbidden_terms": ["AIMaster", "xinkuangjia", "yudao", "ruoyi", "芋道", "胖友", "代码生成器"],
    "forbidden_skill_prefixes": [],
    "forbidden_skill_names": [],
    "forbidden_reference_dirs": [".agents/notes/implemented/process/"],
}
