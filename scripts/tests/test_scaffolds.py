"""验证后端业务模块脚手架、前端 CRUD 脚手架及本地演示种子安全门禁。

覆盖默认只读预览、--apply 写入幂等防覆盖、错误码号段自动递增分配、回环主机强制校验。
@author shady2713
"""

from __future__ import annotations

from pathlib import Path

import pytest
from scripts.runtime import seed_local_dev
from scripts.scaffold import new_java_module, new_web_crud


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
        "    public static final Map<String, int[]> MODULE_RANGES = Map.of(\n"
        '            "infra", new int[]{INFRA_BEGIN, INFRA_END},\n'
        '            "system", new int[]{SYSTEM_BEGIN, SYSTEM_END}\n'
        "    );\n"
        "}\n",
        encoding="utf-8",
        newline="\n",
    )
    return root


def test_java_module_scaffold_allocates_sequential_ranges_and_registers_poms(
    tmp_path: Path,
) -> None:
    """后端模块脚手架默认只读预览，--apply 时顺序分配百万级错误码号段并注册 POM。"""
    repo = _prepare_scaffold_repo(tmp_path / "repo")

    preview = new_java_module.scaffold_java_module(repo, "crm", apply=False)
    assert preview.applied is False
    assert preview.begin_code == 1_003_000_000
    assert preview.end_code == 1_004_000_000
    assert not (repo / "后端代码/basic-framework-boot/basic-framework-module-crm").exists()

    applied_crm = new_java_module.scaffold_java_module(repo, "crm", apply=True)
    assert applied_crm.applied is True
    assert (repo / "后端代码/basic-framework-boot/basic-framework-module-crm/pom.xml").is_file()
    assert (repo / "后端代码/basic-framework-boot/basic-framework-module-crm/README.md").is_file()

    # 第二个模块自动分配到 1_004_000_000 起始区间
    applied_erp = new_java_module.scaffold_java_module(repo, "erp", apply=True)
    assert applied_erp.begin_code == 1_004_000_000
    assert applied_erp.end_code == 1_005_000_000

    root_pom = (repo / "后端代码/basic-framework-boot/pom.xml").read_text(encoding="utf-8")
    assert "<module>basic-framework-module-crm</module>" in root_pom
    assert "<module>basic-framework-module-erp</module>" in root_pom

    # 重复生成同名模块或保留名必须拒绝
    with pytest.raises(ValueError, match="已存在"):
        new_java_module.scaffold_java_module(repo, "crm", apply=True)
    with pytest.raises(ValueError, match="保留名称"):
        new_java_module.scaffold_java_module(repo, "system", apply=False)


def test_web_crud_scaffold_creates_standard_files_and_prevents_overwrite(
    tmp_path: Path,
) -> None:
    """前端 CRUD 脚手架生成完整 5 件套文件与幂等菜单 SQL，并拒绝覆盖已有文件。"""
    repo = tmp_path / "repo"
    repo.mkdir()

    preview = new_web_crud.scaffold_web_crud(
        repo, "crm", "customer", title="客户", apply=False
    )
    assert preview.applied is False
    assert len(preview.created_files) == 5
    assert "crm:customer:create" in preview.menu_sql
    assert not (
        repo / "前端代码/basic-framework-admin/apps/web-ele/src/views/crm/customer/index.vue"
    ).exists()

    sql_path = repo / ".local" / "menu_customer.sql"
    applied = new_web_crud.scaffold_web_crud(
        repo, "crm", "customer", title="客户", sql_out=sql_path, apply=True
    )
    assert applied.applied is True
    assert sql_path.is_file()
    api_text = (
        repo / "前端代码/basic-framework-admin/apps/web-ele/src/api/crm/customer/index.ts"
    ).read_text(encoding="utf-8")
    assert "createTime?: number;" in api_text

    with pytest.raises(ValueError, match="拒绝覆盖"):
        new_web_crud.scaffold_web_crud(repo, "crm", "customer", title="客户", apply=True)


def test_seed_local_dev_strictly_enforces_loopback_hosts(tmp_path: Path) -> None:
    """本地演示种子仅允许回环地址，远程域名或公网 IP 必须被阻断。"""
    assert seed_local_dev.is_loopback_host("127.0.0.1") is True
    assert seed_local_dev.is_loopback_host("localhost") is True
    assert seed_local_dev.is_loopback_host("::1") is True
    assert seed_local_dev.is_loopback_host("10.0.0.12") is False
    assert seed_local_dev.is_loopback_host("db.prod.internal") is False

    assert seed_local_dev.main(["--host", "db.prod.internal"]) == 1

    out_sql = tmp_path / "demo.sql"
    assert seed_local_dev.main(["--host", "127.0.0.1", "--output", str(out_sql)]) == 0
    rendered = out_sql.read_text(encoding="utf-8")
    assert "business_admin" in rendered
    assert "deleted_tag" in rendered
