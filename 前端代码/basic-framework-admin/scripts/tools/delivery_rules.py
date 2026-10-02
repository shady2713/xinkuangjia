"""维护当前前端的测试代理与静态交付范围，规则变更须同步验证。

仅包含 Python 常量，不读取环境、不执行命令。
@author 李杰
"""

PROXY_KEYS = frozenset(
    {
        "http_proxy",
        "https_proxy",
        "all_proxy",
        "ftp_proxy",
        "npm_config_proxy",
        "npm_config_https_proxy",
        "node_use_env_proxy",
    }
)
BYPASS = ("localhost", "127.0.0.1", "::1")

MAX_FILE = 64 * 1024 * 1024
MAX_TOTAL = 1024 * 1024 * 1024
MAX_FILES = 10000
ALLOWED = frozenset(
    {
        ".html",
        ".js",
        ".mjs",
        ".css",
        ".json",
        ".svg",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".ico",
        ".woff",
        ".woff2",
        ".ttf",
        ".otf",
        ".eot",
        ".txt",
        ".webm",
        ".mp4",
        ".br",
        ".gz",
    }
)
