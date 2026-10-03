"""集中声明实际工程目录，供检查分发与源码筛选使用。

@author OpenAI Codex
"""

from __future__ import annotations

JAVA_SOURCE_ROOT = "后端代码/basic-framework-boot/"


def is_java_source(path: str) -> bool:
    """识别后端工程的手写 Java 源文件，排除 Maven 输出与生成源码目录。"""
    normalized = path.replace("\\", "/")
    return (
        normalized.startswith(JAVA_SOURCE_ROOT)
        and normalized.endswith(".java")
        and "/target/" not in normalized
        and "/generated-sources/" not in normalized
    )
