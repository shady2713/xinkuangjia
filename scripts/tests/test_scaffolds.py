"""验证后端业务模块/实体 CRUD 脚手架、前端 CRUD 脚手架与本地演示种子安全门禁。

直接将脚手架产物送入 Java/Web 真实注释检查器、check_crud 与 SchemaDoRbacParityTest 菜单正则，
覆盖 12 模块递增分配（Map.ofEntries 无 10 项上限）、Java 关键字拒绝、相对路径越界阻断与回环主机强校验。
@author shady2713
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path

import pytest
from scripts.code.java import check_staged_java_comments
from scripts.common.node_bridge import invoke as invoke_node_bridge
from scripts.common.quality_common import DEFAULT_ROOT
from scripts.runtime import seed_local_dev
from scripts.scaffold import new_java_crud, new_java_module, new_web_crud

SCHEMA_MENU_INSERT_RE = re.compile(
    r"INSERT\s+INTO\s+`system_menu`\s+VALUES\s*\((\d+),\s*'[^']*',\s*'([^']*)',\s*\d+,\s*'([^']*)'"
)
SCHEMA_ROLE_MENU_INSERT_RE = re.compile(
    r"INSERT\s+INTO\s+`system_role_menu`\s+VALUES\s*\(\d+,\s*1,\s*(\d+),"
)


def _prepare_scaffold_repo(root: Path) -> Path:
    """构建最小可用的前后端脚手架测试仓库结构。"""
    boot = root / "后端代码" / "basic-framework-boot"
    (boot / "basic-framework-dependencies").mkdir(parents=True)
    (boot / "basic-framework-server").mkdir(parents=True)
    range_dir = (
        boot
        / "basic-framework-core"
        / "basic-framework-common"
        / "src/main/java/com/basicframework/framework/common/exception/enums"
    )
    range_dir.mkdir(parents=True)

    (boot / "pom.xml").write_text(
        "<project>\n    <modules>\n"
        "        <module>basic-framework-module-system</module>\n"
        "        <module>basic-framework-module-infra</module>\n"
        "    </modules>\n</project>\n",
        encoding="utf-8",
        newline="\n",
    )
    (boot / "basic-framework-dependencies" / "pom.xml").write_text(
        "<project>\n    <dependencyManagement>\n        <dependencies>\n"
        "            <dependency>\n"
        "                <groupId>com.basicframework</groupId>\n"
        "                <artifactId>basic-framework-common</artifactId>\n"
        "                <version>${revision}</version>\n"
        "            </dependency>\n"
        "        </dependencies>\n    </dependencyManagement>\n</project>\n",
        encoding="utf-8",
        newline="\n",
    )
    (boot / "basic-framework-server" / "pom.xml").write_text(
        "<project>\n    <dependencies>\n"
        "        <dependency>\n"
        "            <groupId>com.basicframework</groupId>\n"
        "            <artifactId>basic-framework-module-infra</artifactId>\n"
        "            <version>${revision}</version>\n"
        "        </dependency>\n\n"
        "        <!-- 测试基础能力 -->\n"
        "    </dependencies>\n</project>\n",
        encoding="utf-8",
        newline="\n",
    )
    (range_dir / "ServiceErrorCodeRange.java").write_text(
        "package com.basicframework.framework.common.exception.enums;\n\n"
        "import java.util.Map;\n\n"
        "public final class ServiceErrorCodeRange {\n\n"
        "    public static final int INFRA_BEGIN = 1_001_000_000;\n"
        "    public static final int INFRA_END = 1_002_000_000;\n"
        "    public static final int SYSTEM_BEGIN = 1_002_000_000;\n"
        "    public static final int SYSTEM_END = 1_003_000_000;\n\n"
        "    /** 模块名称到半开区间的权威注册表。 */\n"
        "    public static final Map<String, int[]> MODULE_RANGES = Map.ofEntries(\n"
        '            Map.entry("infra", new int[]{INFRA_BEGIN, INFRA_END}),\n'
        '            Map.entry("system", new int[]{SYSTEM_BEGIN, SYSTEM_END})\n'
        "    );\n"
        "}\n",
        encoding="utf-8",
        newline="\n",
    )
    return root


def test_java_module_and_crud_scaffolds_pass_java_comment_gate_and_scale_past_ten(
    tmp_path: Path,
) -> None:
    """后端模块与 CRUD 脚手架支持 12 个模块递增分配、拒绝 Java 关键字，且产物通过 Java 注释检查。"""
    repo = _prepare_scaffold_repo(tmp_path / "repo")

    preview = new_java_module.scaffold_java_module(repo, "crm", apply=False)
    assert preview.applied is False
    assert preview.begin_code == 1_003_000_000
    assert not (repo / "后端代码/basic-framework-boot/basic-framework-module-crm").exists()

    # 连续注册 10 个以上模块，验证 Map.ofEntries 不受 Java Map.of 10 项上限限制
    for index in range(11):
        mod_name = "crm" if index == 0 else f"biz{index}"
        plan = new_java_module.scaffold_java_module(repo, mod_name, apply=True)
        assert plan.begin_code == 1_003_000_000 + index * 1_000_000

    range_text = (
        repo
        / "后端代码/basic-framework-boot/basic-framework-core/basic-framework-common"
        / "src/main/java/com/basicframework/framework/common/exception/enums/ServiceErrorCodeRange.java"
    ).read_text(encoding="utf-8")
    assert "Map.ofEntries(" in range_text
    assert 'Map.entry("biz10", new int[]{BIZ10_BEGIN, BIZ10_END})' in range_text
    assert (
        repo
        / "后端代码/basic-framework-boot/basic-framework-module-crm"
        / "src/main/java/com/basicframework/module/crm/framework/web/config/CrmWebConfiguration.java"
    ).is_file()

    # 命名参数 --name 与 Java 保留关键字拒绝校验
    assert new_java_module.main(["--root", str(repo), "--name", "import"]) == 1
    with pytest.raises(ValueError, match="保留关键字"):
        new_java_module.scaffold_java_module(repo, "record", apply=False)
    with pytest.raises(ValueError, match="保留名称"):
        new_java_module.scaffold_java_module(repo, "system", apply=False)

    # 在 crm 模块生成后端单表 CRUD（继承 UniqueBaseDO）并实跑 Java 注释检查器
    crud_plan = new_java_crud.scaffold_java_crud(
        repo, "crm", "customer", title="客户", use_unique_base=True, apply=True
    )
    assert crud_plan.applied is True
    assert "deleted_tag" in crud_plan.ddl_sql
    assert "uk_code_deleted_tag" in crud_plan.ddl_sql

    java_files = [
        repo / rel
        for rel in crud_plan.created_files
        if rel.endswith(".java")
    ]
    assert len(java_files) == 9
    for java_file in java_files:
        source = java_file.read_text(encoding="utf-8")
        all_lines = set(range(1, source.count("\n") + 2))
        findings = check_staged_java_comments._scan_source(
            java_file.relative_to(repo).as_posix(), source, all_lines
        )
        assert findings == [], f"{java_file.name} 注释检查失败: {findings}"


def test_web_crud_scaffold_passes_real_web_comments_check_crud_and_schema_regex(
    tmp_path: Path,
) -> None:
    """前端 CRUD 脚手架产物必须真实通过 web-comments、check_crud 结构校验与 SchemaDoRbacParityTest 正则。"""
    repo = tmp_path / "repo"
    repo.mkdir()
    sql_dir = repo / "数据库文件"
    sql_dir.mkdir()
    (sql_dir / "basic_framework.sql").write_text(
        "CREATE TABLE `system_menu` (`id` bigint) ENGINE=InnoDB AUTO_INCREMENT=5047;\n"
        "INSERT INTO `system_menu` VALUES (5046, '历史', 'sys:old:query', 3, 'super_admin', 1, 1, '', '', '', '', 0, b'1', b'1', b'1', 'admin', '2026-01-01 00:00:00', 'admin', '2026-01-01 00:00:00', b'0');\n"
        "INSERT INTO `system_role_menu` VALUES (5046, 1, 5046, 'admin', '2026-01-01 00:00:00', 'admin', '2026-01-01 00:00:00', b'0');\n",
        encoding="utf-8",
        newline="\n",
    )

    # 相对路径 --sql-out 越出仓库目录必须被安全阻断
    with pytest.raises(ValueError, match="越出仓库根目录"):
        new_web_crud.scaffold_web_crud(
            repo, "crm", "customer", title="客户", sql_out=Path("../outside.sql"), apply=False
        )

    sql_path = Path(".local/menu_customer.sql")
    applied = new_web_crud.scaffold_web_crud(
        repo, "crm", "customer", title="客户", sql_out=sql_path, apply=True
    )
    assert applied.applied is True
    assert applied.menu_id_start >= 6000
    assert (repo / sql_path).is_file()

    # 1. 验证生成的菜单 SQL 100% 匹配 SchemaDoRbacParityTest 精确正则
    menu_matches = SCHEMA_MENU_INSERT_RE.findall(applied.menu_sql)
    role_menu_matches = SCHEMA_ROLE_MENU_INSERT_RE.findall(applied.menu_sql)
    perms = {perm for _, perm, mtype in menu_matches if perm and mtype == "super_admin"}
    assert perms == {
        "crm:customer:query",
        "crm:customer:create",
        "crm:customer:update",
        "crm:customer:delete",
        "crm:customer:export",
    }
    assert len(role_menu_matches) == 6

    # 2. 将生成的 TS/Vue 文件送入真实的 Node web-comments 规则检查器，必须 0 违规
    web_targets = [
        repo / rel
        for rel in applied.created_files
        if rel.endswith((".ts", ".vue"))
    ]
    assert len(web_targets) == 5
    bridge_result = invoke_node_bridge(
        "web",
        {
            "files": [
                {
                    "path": p.relative_to(repo).as_posix(),
                    "source": p.read_text(encoding="utf-8"),
                    "lines": None,
                    "new": True,
                }
                for p in web_targets
            ]
        },
    )
    findings = bridge_result["findings"]
    assert findings == [], f"new_web_crud.py 生成代码触发 web-comments 违规: {findings}"

    # 3. 验证通过 check_crud.py 结构、相对路径与渲染器检查（跳过独立 vue-tsc 环境）
    spec = importlib.util.spec_from_file_location(
        "check_crud_gate",
        DEFAULT_ROOT
        / ".agents/skills/weetion-development-web-standards/scripts/check_crud.py",
    )
    assert spec is not None and spec.loader is not None
    check_crud_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(check_crud_mod)
    api_dir = repo / "前端代码/basic-framework-admin/apps/web-ele/src/api/crm/customer"
    view_dir = repo / "前端代码/basic-framework-admin/apps/web-ele/src/views/crm/customer"
    assert check_crud_mod.main([str(api_dir), str(view_dir), "--skip-typecheck"]) == 0
    # 缺少 tsconfig 时默认失败关闭返回 2
    assert check_crud_mod.main([str(api_dir), str(view_dir)]) == 2

    # 命名参数 --module/--entity 同样支持
    assert (
        new_web_crud.main(
            ["--root", str(repo), "--module", "crm", "--entity", "order", "--title", "订单"]
        )
        == 0
    )

    with pytest.raises(ValueError, match="拒绝覆盖"):
        new_web_crud.scaffold_web_crud(repo, "crm", "customer", title="客户", apply=True)


def test_seed_local_dev_strictly_enforces_loopback_hosts_and_bcrypt_validation(
    tmp_path: Path,
) -> None:
    """本地演示种子强制校验回环地址、支持 --apply 与可选标准 BCrypt 哈希注入。"""
    assert seed_local_dev.is_loopback_host("127.0.0.1") is True
    assert seed_local_dev.is_loopback_host("localhost") is True
    assert seed_local_dev.is_loopback_host("::1") is True
    assert seed_local_dev.is_loopback_host("10.0.0.12") is False
    assert seed_local_dev.is_loopback_host("db.prod.internal") is False

    assert seed_local_dev.main(["--host", "db.prod.internal"]) == 1

    # 非法哈希格式必须拒绝，杜绝 SQL 注入
    assert (
        seed_local_dev.main(["--host", "127.0.0.1", "--admin-password-hash", "not-bcrypt' OR 1=1"])
        == 1
    )

    synthetic_bcrypt = "$2a$10$" + "a" * 53
    out_sql = tmp_path / "demo.sql"
    assert (
        seed_local_dev.main(
            [
                "--host",
                "127.0.0.1",
                "--admin-password-hash",
                synthetic_bcrypt,
                "--output",
                str(out_sql),
            ]
        )
        == 0
    )
    rendered = out_sql.read_text(encoding="utf-8")
    assert "business_admin" in rendered
    assert "deleted_tag" in rendered
    assert "UPDATE `system_users`" in rendered
    assert synthetic_bcrypt in rendered
