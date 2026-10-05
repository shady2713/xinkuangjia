"""验证前端工作区分层检查器：合法消费方被接受，违规消费方被拒绝。

所有写入只发生在 pytest 临时目录构造的最小 pnpm 工作区内，不修改真实仓库。
用例覆盖别名导入、相对路径、动态导入与包根构建配置四条真实引用路径。

@author DeepSeek
"""

from __future__ import annotations

from pathlib import Path

import pytest
from scripts.code.web import verify_workspace_layering as layering
from scripts.common.quality_common import DEFAULT_ROOT, CheckError

FRONTEND = layering.FRONTEND


def write(root: Path, relative: str, content: str) -> Path:
    """在临时工作区内写入 UTF-8 文件，返回真实路径。

    Args:
        root: 临时仓库根目录。
        relative: 相对根目录的 POSIX 路径。
        content: 完整文件内容。
    Returns:
        已写入文件的绝对路径。
    """
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


WORKSPACE_PATTERNS = (
    "internal/*",
    "internal/lint-configs/*",
    "packages/*",
    "packages/@core/base/*",
    "packages/@core/ui-kit/*",
    "packages/@core/*",
    "packages/effects/*",
    "apps/*",
    "scripts/*",
)


def workspace(root: Path, patterns: tuple[str, ...] = WORKSPACE_PATTERNS) -> None:
    """写入工作区清单与根清单，声明构建配置包的统一归属。

    Args:
        root: 临时仓库根目录。
        patterns: `packages:` 段的 glob 模式。
    """
    lines = ["packages:"]
    lines.extend(f"  - {pattern}" for pattern in patterns)
    lines.append("")
    write(root, f"{FRONTEND}/pnpm-workspace.yaml", "\n".join(lines))
    write(
        root,
        f"{FRONTEND}/package.json",
        '{\n  "name": "admin-console-workspace",\n'
        '  "devDependencies": { "@vben/tailwind-config": "workspace:*" }\n}\n',
    )


def package(
    root: Path,
    directory: str,
    name: str,
    *,
    dependencies: tuple[str, ...] = (),
    dev_dependencies: tuple[str, ...] = (),
    tsconfig: str | None = None,
) -> None:
    """写入一个 workspace 包的清单与可选 tsconfig。

    Args:
        root: 临时仓库根目录。
        directory: 相对前端工程根的包目录。
        name: 包名。
        dependencies: `dependencies` 中声明的 workspace 包名。
        dev_dependencies: `devDependencies` 中声明的 workspace 包名。
        tsconfig: 可选的 tsconfig 文本，用于声明路径别名。
    """
    import json

    manifest: dict[str, object] = {"name": name, "version": "1.0.0"}
    if dependencies:
        manifest["dependencies"] = {item: "workspace:*" for item in dependencies}
    if dev_dependencies:
        manifest["devDependencies"] = {item: "workspace:*" for item in dev_dependencies}
    write(root, f"{FRONTEND}/{directory}/package.json", json.dumps(manifest, indent=2) + "\n")
    if tsconfig is not None:
        write(root, f"{FRONTEND}/{directory}/tsconfig.json", tsconfig)


def declare(
    root: Path,
    directory: str,
    name: str,
    dependencies: tuple[str, ...] = (),
    dev_dependencies: tuple[str, ...] = (),
) -> None:
    """重写一个包的清单，用于让用例精确控制“已声明依赖”这一侧。

    Args:
        root: 临时仓库根目录。
        directory: 相对前端工程根的包目录。
        name: 包名。
        dependencies: `dependencies` 中声明的 workspace 包名。
        dev_dependencies: `devDependencies` 中声明的 workspace 包名。
    """
    package(
        root,
        directory,
        name,
        dependencies=dependencies,
        dev_dependencies=dev_dependencies,
    )


def add_orphan_effects(root: Path, layer_directory: str = "packages/effects/orphan") -> None:
    """加入一个 effects 层次、没有任何入边的包，用作跨层违规的目标。

    目标包没有入边时，用例能够把“跨层引用”与“引用成环”两类缺陷分开验证，
    避免同一处注入同时触发多条规则而无法判断哪条规则真正生效。

    Args:
        root: 临时仓库根目录。
        layer_directory: 目标包相对前端工程根的目录。
    """
    package(root, layer_directory, "@vben/orphan")
    write(
        root,
        f"{FRONTEND}/{layer_directory}/src/index.ts",
        "export const orphan = 1;\n",
    )


def build_project(root: Path) -> None:
    """构造一套合法的最小工作区：core-base → core → shared → effects → app。

    该骨架对应真实仓库的合法消费方：应用引用共享包与 effects，共享包引用 @core，
    @core 只引用 core-base，core-base 不引用任何其它包。

    Args:
        root: 临时仓库根目录。
    """
    workspace(root)
    package(root, "packages/@core/base/shared", "@vben-core/shared")
    package(
        root,
        "packages/@core/composables",
        "@vben-core/composables",
        dependencies=("@vben-core/shared",),
    )
    package(root, "packages/utils", "@vben/utils", dependencies=("@vben-core/shared",))
    package(root, "packages/stores", "@vben/stores", dependencies=("@vben-core/composables",))
    package(
        root,
        "packages/effects/hooks",
        "@vben/hooks",
        dependencies=("@vben/utils", "@vben/stores"),
    )
    package(
        root,
        "apps/web-ele",
        "@vben/web-ele",
        dependencies=("@vben/hooks", "@vben/utils"),
        tsconfig='{\n  "compilerOptions": { "paths": { "#/*": ["./src/*"] } }\n}\n',
    )
    write(
        root,
        f"{FRONTEND}/packages/@core/base/shared/src/index.ts",
        "export const shared = 1;\n",
    )
    write(
        root,
        f"{FRONTEND}/packages/@core/composables/src/index.ts",
        "import { shared } from '@vben-core/shared';\n\nexport const composable = shared + 1;\n",
    )
    write(
        root,
        f"{FRONTEND}/packages/utils/src/index.ts",
        "import { shared } from '@vben-core/shared';\n\nexport const util = shared + 2;\n",
    )
    write(
        root,
        f"{FRONTEND}/packages/stores/src/index.ts",
        "import { composable } from '@vben-core/composables';\n\nexport const store = composable;\n",
    )
    write(
        root,
        f"{FRONTEND}/packages/effects/hooks/src/index.ts",
        "import { store } from '@vben/stores';\nimport { util } from '@vben/utils';\n\n"
        "export const hook = store + util;\n",
    )
    write(
        root,
        f"{FRONTEND}/apps/web-ele/src/main.ts",
        "import { hook } from '@vben/hooks';\n\nconsole.log(hook);\n",
    )


def test_legal_layout_passes(tmp_path: Path) -> None:
    """合法消费方全部被接受：应用引用共享包，共享包引用 @core 与 core-base。"""
    build_project(tmp_path)
    checked, findings = layering.verify(tmp_path)
    assert checked > 0
    assert findings == []


def test_shared_package_referencing_app_is_rejected(tmp_path: Path) -> None:
    """共享包反向引用应用时被拒绝，这是必须红的一侧。

    应用本来就引用共享包，反向边同时构成环，因此两类规则都会命中；
    这里断言反向依赖规则确实定位到该文件，而不是被别的诊断掩盖。
    """
    build_project(tmp_path)
    write(
        tmp_path,
        f"{FRONTEND}/packages/utils/src/leak.ts",
        "import '@vben/web-ele';\n\nexport const leak = 1;\n",
    )
    _, findings = layering.verify(tmp_path)
    rules = {item.rule for item in findings}
    assert "reverse-dependency" in rules
    assert "workspace-dependency-cycle" in rules
    reverse = [item for item in findings if item.rule == "reverse-dependency"]
    assert len(reverse) == 1
    assert reverse[0].path.endswith("packages/utils/src/leak.ts")


def test_core_referencing_effects_is_rejected(tmp_path: Path) -> None:
    """@core 包引用 effects 包时被拒绝，核心层不得依赖业务无关特性层。"""
    build_project(tmp_path)
    add_orphan_effects(tmp_path)
    declare(
        tmp_path,
        "packages/@core/composables",
        "@vben-core/composables",
        ("@vben-core/shared", "@vben/orphan"),
    )
    write(
        tmp_path,
        f"{FRONTEND}/packages/@core/composables/src/leak.ts",
        "import { orphan } from '@vben/orphan';\n\nexport const leak = orphan;\n",
    )
    _, findings = layering.verify(tmp_path)
    assert [item.rule for item in findings] == ["cross-layer-dependency"]


def test_core_base_referencing_core_is_rejected(tmp_path: Path) -> None:
    """core-base 包引用 @core 包时被拒绝，最底层只能引用同层。"""
    build_project(tmp_path)
    package(tmp_path, "packages/@core/orphan-core", "@vben-core/orphan-core")
    write(
        tmp_path,
        f"{FRONTEND}/packages/@core/orphan-core/src/index.ts",
        "export const orphanCore = 1;\n",
    )
    declare(
        tmp_path,
        "packages/@core/base/shared",
        "@vben-core/shared",
        ("@vben-core/orphan-core",),
    )
    write(
        tmp_path,
        f"{FRONTEND}/packages/@core/base/shared/src/leak.ts",
        "import { orphanCore } from '@vben-core/orphan-core';\n\nexport const leak = orphanCore;\n",
    )
    _, findings = layering.verify(tmp_path)
    assert [item.rule for item in findings] == ["cross-layer-dependency"]


def test_shared_package_referencing_effects_is_rejected(tmp_path: Path) -> None:
    """共享包引用 effects 包时被拒绝，方向只能由 effects 指向共享包。"""
    build_project(tmp_path)
    add_orphan_effects(tmp_path)
    declare(
        tmp_path,
        "packages/stores",
        "@vben/stores",
        ("@vben-core/composables", "@vben/orphan"),
    )
    write(
        tmp_path,
        f"{FRONTEND}/packages/stores/src/leak.ts",
        "import { orphan } from '@vben/orphan';\n\nexport const leak = orphan;\n",
    )
    _, findings = layering.verify(tmp_path)
    assert [item.rule for item in findings] == ["cross-layer-dependency"]


def test_workspace_cycle_is_rejected(tmp_path: Path) -> None:
    """真实引用成环时被拒绝，环路径必须完整出现在诊断里。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{FRONTEND}/packages/stores/src/loop.ts",
        "import { util } from '@vben/utils';\n\nexport const loop = util;\n",
    )
    write(
        tmp_path,
        f"{FRONTEND}/packages/utils/src/loop.ts",
        "import { store } from '@vben/stores';\n\nexport const loop = store;\n",
    )
    _, findings = layering.verify(tmp_path)
    cycles = [item for item in findings if item.rule == "workspace-dependency-cycle"]
    assert len(cycles) == 1
    assert "@vben/utils" in cycles[0].message
    assert "@vben/stores" in cycles[0].message


def test_dynamic_import_participates_in_cycle_detection(tmp_path: Path) -> None:
    """动态 import() 也计入真实引用图，只用动态导入构成的环同样被拒绝。"""
    build_project(tmp_path)
    declare(tmp_path, "packages/utils", "@vben/utils", ("@vben-core/shared", "@vben/stores"))
    declare(
        tmp_path,
        "packages/stores",
        "@vben/stores",
        ("@vben-core/composables", "@vben/utils"),
    )
    write(
        tmp_path,
        f"{FRONTEND}/packages/utils/src/lazy.ts",
        "export const lazy = () => import('@vben/stores');\n",
    )
    write(
        tmp_path,
        f"{FRONTEND}/packages/stores/src/lazy.ts",
        "export const lazy = () => import('@vben/utils');\n",
    )
    _, findings = layering.verify(tmp_path)
    assert [item.rule for item in findings] == ["workspace-dependency-cycle"]


def test_undeclared_runtime_dependency_is_rejected(tmp_path: Path) -> None:
    """src 运行时代码引用未声明的 workspace 包时被拒绝。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{FRONTEND}/packages/utils/src/sneak.ts",
        "import { store } from '@vben/stores';\n\nexport const sneak = store;\n",
    )
    _, findings = layering.verify(tmp_path)
    assert [item.rule for item in findings] == ["undeclared-workspace-dependency"]


def test_dev_dependency_declaration_is_accepted(tmp_path: Path) -> None:
    """在 devDependencies 中声明同样属于已声明依赖，合法消费方必须被接受。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{FRONTEND}/packages/stores/src/declared.ts",
        "import { util } from '@vben/utils';\n\nexport const declared = util;\n",
    )
    manifest = tmp_path / FRONTEND / "packages/stores/package.json"
    manifest.write_text(
        '{\n  "name": "@vben/stores",\n  "version": "1.0.0",\n'
        '  "dependencies": { "@vben-core/composables": "workspace:*" },\n'
        '  "devDependencies": { "@vben/utils": "workspace:*" }\n}\n',
        encoding="utf-8",
    )
    _, findings = layering.verify(tmp_path)
    assert findings == []


def test_relative_cross_package_import_is_rejected(tmp_path: Path) -> None:
    """相对路径跨越包边界同样计入引用图并被方向规则拒绝。"""
    build_project(tmp_path)
    add_orphan_effects(tmp_path)
    declare(tmp_path, "packages/utils", "@vben/utils", ("@vben-core/shared", "@vben/orphan"))
    write(
        tmp_path,
        f"{FRONTEND}/packages/utils/src/leak.ts",
        "export { orphan } from '../../effects/orphan/src/index';\n",
    )
    _, findings = layering.verify(tmp_path)
    assert [item.rule for item in findings] == ["cross-layer-dependency"]
    assert findings[0].path.endswith("packages/utils/src/leak.ts")


def test_build_config_dependency_satisfied_by_root_is_accepted(tmp_path: Path) -> None:
    """包根构建配置引用的构建配置包由工作区根声明时属于既有约定，必须被接受。"""
    build_project(tmp_path)
    write(
        root=tmp_path,
        relative=f"{FRONTEND}/packages/utils/postcss.config.mjs",
        content="export { default } from '@vben/tailwind-config/postcss';\n",
    )
    write(
        tmp_path,
        f"{FRONTEND}/internal/tailwind-config/package.json",
        '{\n  "name": "@vben/tailwind-config",\n  "version": "1.0.0"\n}\n',
    )
    _, findings = layering.verify(tmp_path)
    assert findings == []


def test_build_config_dependency_missing_everywhere_is_rejected(tmp_path: Path) -> None:
    """包根构建配置引用的构建配置包连工作区根都没有声明时被拒绝。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{FRONTEND}/packages/utils/postcss.config.mjs",
        "export { default } from '@vben/stylelint-config';\n",
    )
    write(
        tmp_path,
        f"{FRONTEND}/internal/lint-configs/stylelint-config/package.json",
        '{\n  "name": "@vben/stylelint-config",\n  "version": "1.0.0"\n}\n',
    )
    write(
        tmp_path,
        f"{FRONTEND}/package.json",
        '{\n  "name": "admin-console-workspace",\n  "devDependencies": {}\n}\n',
    )
    _, findings = layering.verify(tmp_path)
    assert [item.rule for item in findings] == ["undeclared-build-config-dependency"]


def test_alias_escape_is_rejected(tmp_path: Path) -> None:
    """别名解析结果逃出所属应用时被拒绝。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{FRONTEND}/apps/web-ele/src/escape.ts",
        "export * from '#/../../../packages/utils/src/index';\n",
    )
    _, findings = layering.verify(tmp_path)
    assert [item.rule for item in findings] == ["alias-escape"]


def test_undeclared_alias_is_rejected(tmp_path: Path) -> None:
    """未声明 `#/*` 别名的包使用该别名时检查无法给出可信结论。"""
    build_project(tmp_path)
    write(
        tmp_path,
        f"{FRONTEND}/packages/utils/src/hash.ts",
        "import { util } from '#/index';\n\nexport const hash = util;\n",
    )
    with pytest.raises(CheckError, match="未声明 #/\\* 别名"):
        layering.verify(tmp_path)


def test_empty_workspace_is_not_a_pass(tmp_path: Path) -> None:
    """工作区清单不存在时返回零对象，由调用方按不适用处理，不能算通过。"""
    checked, findings = layering.verify(tmp_path)
    assert (checked, findings) == (0, [])


def test_workspace_without_patterns_is_rejected(tmp_path: Path) -> None:
    """工作区清单没有声明任何包时无法确定边界，检查不能静默通过。"""
    write(tmp_path, f"{FRONTEND}/pnpm-workspace.yaml", "packages:\n")
    with pytest.raises(CheckError, match="没有声明任何 workspace 包"):
        layering.verify(tmp_path)


def test_duplicate_package_name_is_rejected(tmp_path: Path) -> None:
    """两个目录使用同一包名时引用归属无法确定，直接报检查未完成。"""
    build_project(tmp_path)
    package(tmp_path, "packages/effects/hooks-copy", "@vben/hooks")
    with pytest.raises(CheckError, match="workspace 包名重复"):
        layering.verify(tmp_path)


def test_unknown_package_location_is_rejected(tmp_path: Path) -> None:
    """包目录不在既有分层内时无法判定边界，直接报检查未完成。"""
    build_project(tmp_path)
    package(tmp_path, "vendor/third-party", "@vendor/third-party")
    write(
        tmp_path,
        f"{FRONTEND}/pnpm-workspace.yaml",
        "packages:\n  - internal/*\n  - packages/*\n  - apps/*\n  - vendor/*\n",
    )
    with pytest.raises(CheckError, match="无法判定 workspace 包层次"):
        layering.verify(tmp_path)


def test_strip_json_comments_keeps_urls() -> None:
    """剔除 JSONC 注释时必须保留字符串里的 https 地址与 `//`。"""
    text = (
        '{\n'
        '  // 行注释\n'
        '  "$schema": "https://json.schemastore.org/tsconfig",\n'
        '  "paths": { "#/*": ["./src/*"] } /* 块注释 */\n'
        '}\n'
    )
    stripped = layering.strip_json_comments(text)
    assert "https://json.schemastore.org/tsconfig" in stripped
    assert "#/*" in stripped
    assert "行注释" not in stripped
    assert "块注释" not in stripped


def test_read_aliases_parses_commented_tsconfig(tmp_path: Path) -> None:
    """带注释与 https schema 的 tsconfig 仍能解析出别名根。"""
    package(tmp_path, "apps/web-ele", "@vben/web-ele")
    write(
        tmp_path,
        f"{FRONTEND}/apps/web-ele/tsconfig.json",
        '{\n  // 应用内别名\n  "$schema": "https://json.schemastore.org/tsconfig",\n'
        '  "compilerOptions": { "paths": { "#/*": ["./src/*"] } }\n}\n',
    )
    aliases = layering.read_aliases(tmp_path / FRONTEND / "apps/web-ele")
    assert aliases == {"#/*": "src/*"}


def test_repository_workspace_layering_passes() -> None:
    """真实仓库的合法消费方全部被接受，且包清单覆盖全部工作区包。"""
    # 检查目录被改错时零对象会被检查器当成“不适用”放行，这里必须以失败暴露，不能退化成跳过。
    assert (DEFAULT_ROOT / FRONTEND).is_dir(), "对象范围缺失：检查目录被改错或前端工程未随仓库提供"
    checked, findings = layering.verify(DEFAULT_ROOT)
    assert findings == []
    packages = layering.collect_packages(DEFAULT_ROOT)
    assert len(packages) == 37
    assert {package.layer for package in packages} == {
        "application",
        "core",
        "core-base",
        "effects",
        "shared",
        "tooling",
    }
    assert checked > len(packages)


def test_repository_references_are_actually_resolved() -> None:
    """真实仓库必须真的解析出跨包引用，避免空扫描伪装成通过。"""
    # 零对象不是通过路径；目录被改错时必须失败，避免跳过掩盖空扫描。
    assert (DEFAULT_ROOT / FRONTEND).is_dir(), "对象范围缺失：检查目录被改错或前端工程未随仓库提供"
    packages = layering.collect_packages(DEFAULT_ROOT)
    references, findings, file_count = layering.collect_references(DEFAULT_ROOT, packages)
    assert findings == []
    assert file_count > 1000
    assert len(references) > 200
    assert {reference.kind for reference in references} >= {"alias", "dynamic"}
    assert any(reference.source == "@vben/web-ele" for reference in references)
