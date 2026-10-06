"""使用真实 Node 解析器验证 Web 注释与 Mermaid 检查，缺依赖时失败。

@author 李杰
"""

from pathlib import Path

import pytest
from scripts.code.web.check_worktree_web_comments import baseline_scope, changed_lines, collect
from scripts.common import node_bridge
from scripts.common.node_bridge import invoke
from scripts.common.quality_common import CheckError, ProcessResult
from scripts.docs.verify_mermaid import collect as mermaid


def web(source: str, *, path: str = "example.ts", lines: list[int] | None = None) -> list[dict]:
    """向真实桥接器发送单文件输入，返回定位后的规则问题。"""
    return invoke(
        "web", {"files": [{"path": path, "source": source, "lines": lines, "new": lines is None}]}
    )["findings"]


def test_complete_public_and_private_functions() -> None:
    """公开函数完整标签与私有函数单句说明可以共同通过。"""
    source = (
        "/** 模块负责计算数量。 */\n"
        "/** 计算累计数量。\n * @param value - 当前数量。\n * @returns 累计数量。\n */\n"
        "export function sum(value: number): number { return value + 1; }\n"
        "// 判断数量是否为正。\n"
        "function positive(value: number) { return value > 0; }\n"
    )
    assert not web(source)


def test_public_parameter_return_and_throw_failures() -> None:
    """职责文字不能替代公开 API 的参数、返回及实际异常说明。"""
    findings = web(
        "/** 计算数量。 */\n"
        "export function calculate(value: number): number { if (value < 0) throw new Error('bad'); return value; }"
    )
    assert {"web-param", "web-returns", "web-throws"} <= {item["rule"] for item in findings}


def test_private_function_and_expression_callback_are_checked() -> None:
    """内部函数与表达式位置的匿名函数也不能因未导出而缺少职责说明。

    实参位置的匿名回调归并到最近的具名承载声明，不再单独要求注释；本用例同时钉住这两侧，
    避免把"归并"退化成"豁免"。
    """
    findings = web(
        "/** 模块说明。 */\nconst value = 1;\nfunction hidden() {}\nvoid function () {};\n"
    )
    assert sum(item["rule"] == "web-doc" for item in findings) == 2
    assert sum(
        item["rule"] == "web-doc"
        for item in web("/** 模块说明。 */\nconst value = 1;\n[1].map(value => value + 1);\n")
    ) == 0
    assert not web("/** 模块计算数组。 */\n[1].map(/** 将数量增加一。 */ value => value + 1);")


def test_incremental_deletion_is_detected() -> None:
    """删除函数前注释会映射到当前声明行，并触发声明注释检查。"""
    before = "/** 模块职责。 */\nconst value = 1;\n// 执行任务。\nfunction run() {}\n"
    after = "/** 模块职责。 */\nconst value = 1;\nfunction run() {}\n"
    lines = changed_lines(before, after)
    assert lines == [3]
    assert any(item["rule"] == "web-doc" for item in web(after, lines=lines))


def test_unchanged_legacy_declaration_is_not_blocked() -> None:
    """只修改普通变量不会把无关注释缺失的历史函数一并阻断。"""
    source = "function legacy() {}\nconst value = 2;\n"
    assert not web(source, lines=[2])


def test_invalid_history_requires_complete_current_check() -> None:
    """旧编码不可解码时检查所有当前声明，合法基线仍保持增量边界。"""
    source = "/** 模块执行任务。 */\nconst marker = 1;\nfunction missing() {}\n"
    lines, whole_file = baseline_scope(b"\xff", source)
    assert lines is None and whole_file
    assert any(item["rule"] == "web-doc" for item in web(source, lines=lines))
    assert baseline_scope(source.encode("utf-8"), source) == ([], False)
    assert not web(source, lines=[])


def test_invalid_current_utf8_is_rejected(tmp_path: Path) -> None:
    """当前文件的无效 UTF-8 仍中止检查，不因历史恢复策略而被宽松解码。"""
    (tmp_path / "probe.ts").write_bytes(b"\xff")
    with pytest.raises(UnicodeDecodeError):
        collect(tmp_path, [], full=True)


def test_vue_script_location_and_syntax() -> None:
    """Vue 脚本块的诊断行号映射到原 SFC，结构错误不能假装通过。"""
    source = '<template><div /></template>\n<script setup lang="ts">\n/** 组件展示数量。 */\nconst count = 0;\nfunction missing() {}\n</script>\n'
    findings = web(source, path="组件.vue")
    assert any(item["rule"] == "web-doc" and item["line"] == 5 for item in findings)
    assert web("<script>const =</script>", path="错误.vue")


def test_overloads_and_void_are_respected() -> None:
    """公开重载声明仍需参数标签，明确 void 不被强制要求返回说明。"""
    source = "/** 执行任务。\n * @param value - 输入数量。\n */\nexport function execute(value: number): void {}\n"
    assert not web(source)
    assert any(
        item["rule"] == "web-param"
        for item in web("/** 执行任务。 */\nexport function execute(value: number): void;\n")
    )


def test_types_and_exported_values_require_documentation() -> None:
    """导出类型和常量都属于需说明的公开声明。"""
    source = "/** 模块定义配置。 */\nconst marker = 0;\nexport interface Config {}\nexport const limit = 5;\n"
    findings = web(source)
    assert sum(item["rule"] == "web-doc" for item in findings) >= 2


def test_stale_parameter_is_reported() -> None:
    """签名改名后遗留的参数标签必须被发现。"""
    findings = web(
        "/** 执行任务。\n * @param old - 输入数量。\n */\nexport function run(current: number): void {}"
    )
    assert any(item["rule"] == "web-param-stale" for item in findings)


def test_caught_exception_and_exported_callable_type() -> None:
    """函数内已处理的异常不要求对外 throws，导出的函数类型仍需参数契约。"""
    assert not web(
        "/** 执行任务并处理失败。 */\n"
        "export function run(): void { try { throw new Error('handled'); } catch (error) {} }"
    )
    findings = web("/** 定义计算接口。 */\nexport type Compute = (value: number) => number;")
    assert {"web-param", "web-returns"} <= {item["rule"] for item in findings}


def test_full_mode_and_non_git_error(tmp_path: Path) -> None:
    """全量可用于非 Git 目录，增量则明确拒绝缺少仓库上下文。"""
    (tmp_path / "test.ts").write_text(
        "/** 执行任务。 */\nexport function run(): void {}", encoding="utf-8"
    )
    count, findings = collect(tmp_path, [], full=True)
    assert count == 1 and not findings
    with pytest.raises(RuntimeError, match="Git"):
        collect(tmp_path, [])


def test_mermaid_real_parser(tmp_path: Path) -> None:
    """同一文档的合法图通过，非法图由 Mermaid 真正拒绝。"""
    (tmp_path / "图.md").write_text(
        "```mermaid\nflowchart LR\n  A --> B\n```\n\n```mermaid\nflowchart LR\n  A --> [\n```\n",
        encoding="utf-8",
    )
    count, findings = mermaid(tmp_path, [])
    assert count == 2 and len(findings) == 1
    assert findings[0].line == 7 and findings[0].rule == "mermaid-syntax"


def test_missing_node_is_an_environment_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """缺少 Node 时明确失败，不把图表或 Web 检查当成零问题通过。"""
    monkeypatch.setattr(node_bridge.shutil, "which", lambda _: None)
    with pytest.raises(CheckError, match="需要 Node"):
        invoke("web", {"files": []})


def test_invalid_bridge_diagnostic_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    """解析桥接返回结构错误时不能直接构造或输出无效诊断。"""
    monkeypatch.setattr(
        node_bridge,
        "run_process",
        lambda *args, **kwargs: ProcessResult(0, b'{"findings":[{"line":true}]}', b""),
    )
    with pytest.raises(CheckError, match="无效诊断"):
        invoke("web", {"files": []})


def test_frontends_do_not_borrow_each_others_dependencies(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """来源工程依赖可用不能掩盖框架缺依赖，当前工程必须独立准备。"""
    monkeypatch.setattr(node_bridge, "FRONTEND_ROOT", tmp_path)
    (tmp_path / "业务系统/node_modules/mermaid").mkdir(parents=True)
    payload = {"files": [{"path": "前端代码/basic-framework-admin/apps/web-ele/src/example.ts"}]}
    with pytest.raises(CheckError, match="前端依赖"):
        node_bridge.frontend_directory("web", payload)
    (tmp_path / "basic-framework-admin/node_modules/mermaid").mkdir(parents=True)
    assert (
        node_bridge.frontend_directory(
            "web", payload
        )
        == tmp_path / "basic-framework-admin"
    )


def test_repository_mermaid_uses_installed_framework_frontend(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """仓库图表使用本框架已安装的解析器，不依赖来源工程。"""
    monkeypatch.setattr(node_bridge, "FRONTEND_ROOT", tmp_path)
    (tmp_path / "basic-framework-admin/node_modules/mermaid").mkdir(parents=True)
    assert node_bridge.frontend_directory("mermaid", {"blocks": []}) == tmp_path / "basic-framework-admin"
