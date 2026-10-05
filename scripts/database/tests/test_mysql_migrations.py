"""在专用环回 MySQL 中验证新装、升级、校验和与真实备份恢复。

只有显式运行本文件才创建随机测试库；缺少环境或客户端直接失败，不跳过。
@author OpenAI Codex
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import uuid
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlsplit

import pymysql
import pytest
from pymysql.constants import CLIENT

ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = ROOT / "docs/部署/mysql-migrations"
INITIAL = "202610010000"
DEFAULT_GRANT_REPAIR = MIGRATIONS / "V202610020004__system_default_client_remove_all_machine_grants.sql"


def canonical_ddl(ddl: str) -> str:
    """统一 MySQL 导出后显式补出的 utf8mb4 声明；保留具体排序规则与全部结构。"""
    return re.sub(r" CHARACTER SET utf8mb4(?= COLLATE utf8mb4_)", "", ddl)


class MysqlSandbox:
    """只管理本实例创建的随机数据库，并保存实际命令的脱敏日志。"""

    def __init__(self, output: Path) -> None:
        """核实环回无库连接及显式工具路径；任何缺失均在写入前失败。"""
        raw = os.environ.get("AUTH_TEST_MYSQL_URL", "")
        if not raw.startswith("jdbc:mysql://"):
            raise RuntimeError("必须提供专用 AUTH_TEST_MYSQL_URL")
        url = urlsplit(raw[5:])
        if (url.hostname not in {"127.0.0.1", "localhost", "::1"}
                or not url.port or url.path not in {"", "/"}
                or url.username or url.password or url.fragment):
            raise RuntimeError("测试只接受带端口、无库名及URL凭据的环回 MySQL")
        self.host, self.port = url.hostname, url.port
        self.user = os.environ["AUTH_TEST_MYSQL_USERNAME"]
        self.password = os.environ["AUTH_TEST_MYSQL_PASSWORD"]
        if not self.user or not self.password:
            raise RuntimeError("测试数据库凭据不能为空")
        self.maven = shutil.which("mvn")
        self.mysql = os.environ.get("BF_TEST_MYSQL_CLIENT") or shutil.which("mysql")
        self.dump = os.environ.get("BF_TEST_MYSQL_DUMP") or shutil.which("mysqldump")
        if not self.maven or not Path(self.maven).is_file():
            raise RuntimeError("缺少 Maven")
        if not self.mysql or not self.dump or not Path(self.mysql).is_file() or not Path(self.dump).is_file():
            raise RuntimeError("缺少 mysql/mysqldump；可设置 BF_TEST_MYSQL_CLIENT/BF_TEST_MYSQL_DUMP")
        self.output = output
        self.databases: set[str] = set()
        self.backups: set[Path] = set()
        self.sequence = 0

    def connect(self, database: str | None = None) -> pymysql.Connection:
        """连接专用实例，超时有界；多语句仅用于仓库 SQL 或自有备份。"""
        if database is not None:
            self.owned(database)
        return pymysql.connect(
            host=self.host, port=self.port, user=self.user, password=self.password,
            database=database, charset="utf8mb4", autocommit=True,
            connect_timeout=10, read_timeout=30, write_timeout=30,
            client_flag=CLIENT.MULTI_STATEMENTS,
        )

    def owned(self, database: str) -> None:
        """写入、备份和清理均只接受本实例实际创建的随机库。"""
        if database not in self.databases or not re.fullmatch(r"bf_migration_[0-9a-f]{24}", database):
            raise RuntimeError("拒绝访问非本次创建的测试库")

    def create(self) -> str:
        """先建立随机独立库，再登记所有权，不复用既有库。"""
        database = "bf_migration_" + uuid.uuid4().hex[:24]
        with self.connect() as connection, connection.cursor() as cursor:
            cursor.execute(f"CREATE DATABASE `{database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
        self.databases.add(database)
        return database

    def sql(self, database: str, source: str) -> None:
        """在自有库执行可信 SQL 并消费全部结果，保留服务器真实失败。"""
        with self.connect(database) as connection, connection.cursor() as cursor:
            cursor.execute(source)
            while cursor.nextset():
                pass

    def rows(self, database: str, query: str) -> tuple:
        """查询自有库的结构或测试聚合值，不把凭据或数据打印到报告。"""
        with self.connect(database) as connection, connection.cursor() as cursor:
            cursor.execute(query)
            return cursor.fetchall()

    def flyway(self, database: str, goal: str, *properties: str) -> tuple[int, str]:
        """调用生产固定插件；隔离外部 Flyway 覆盖值，凭据仅进入子进程环境。"""
        self.owned(database)
        environment = {key: value for key, value in os.environ.items()
                       if not key.startswith("FLYWAY_") and key not in {"MAVEN_ARGS", "MAVEN_OPTS", "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS"}}
        host = f"[{self.host}]" if ":" in self.host else self.host
        environment.update(
            FLYWAY_URL=f"jdbc:mysql://{host}:{self.port}/{database}?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC",
            FLYWAY_USER=self.user, FLYWAY_PASSWORD=self.password,
            REDGATE_DISABLE_TELEMETRY="true",
        )
        command = [str(self.maven), "-B", "-ntp", "-f", str(ROOT / "scripts/database/pom.xml"),
                   *properties, f"flyway:{goal}"]
        result = subprocess.run(command, cwd=ROOT, env=environment, capture_output=True,
                                timeout=240, check=False)
        output = (result.stdout + result.stderr).decode("utf-8", errors="replace")
        output = output.replace(self.password, "[REDACTED]")
        self.sequence += 1
        log = self.output / f"flyway-{self.sequence:02d}-{goal}.log"
        log.write_text(output, encoding="utf-8")
        return result.returncode, output

    def structure(self, database: str) -> dict[str, str]:
        """比较真实表定义，忽略历史自增位置和独立的 Flyway 运行记录。"""
        result = {}
        for (table,) in self.rows(database, "SHOW TABLES"):
            if table == "flyway_schema_history":
                continue
            ddl = self.rows(database, f"SHOW CREATE TABLE `{table}`")[0][1]
            result[table] = re.sub(r" AUTO_INCREMENT=\d+", "", canonical_ddl(ddl))
        return result

    def fingerprint(self, database: str) -> str:
        """对全部表和行计算摘要以核实失败无副作用与完整恢复，不输出业务内容。"""
        tables = {}
        for (table,) in self.rows(database, "SHOW TABLES"):
            tables[table] = {
                "ddl": canonical_ddl(self.rows(database, f"SHOW CREATE TABLE `{table}`")[0][1]),
                "rows": sorted(repr(row) for row in self.rows(database, f"SELECT * FROM `{table}`")),
            }
        return hashlib.sha256(json.dumps(tables, sort_keys=True).encode()).hexdigest()

    def backup(self, source: str) -> Path:
        """实际导出自有库并登记内容校验和，不在数据库命令参数中携带密码。"""
        self.owned(source)
        environment = dict(os.environ, MYSQL_PWD=self.password)
        common = ["--no-defaults", "--protocol=TCP", f"--host={self.host}", f"--port={self.port}",
                  f"--user={self.user}", "--default-character-set=utf8mb4"]
        backup = self.output / f"{source}.sql"
        with backup.open("xb") as output:
            dumped = subprocess.run(
                [str(self.dump), *common, "--single-transaction", "--no-tablespaces",
                 "--set-gtid-purged=OFF", "--hex-blob", "--routines", "--events", source],
                env=environment, stdout=output, stderr=subprocess.PIPE, timeout=60, check=False,
            )
        assert dumped.returncode == 0, "mysqldump 失败，未执行恢复"
        assert backup.stat().st_size > 0
        digest = hashlib.sha256(backup.read_bytes()).hexdigest()
        backup.with_suffix(".sha256").write_text(digest + "\n", encoding="utf-8")
        self.backups.add(backup.resolve())
        return backup

    def restore(self, backup: Path) -> str:
        """仅恢复本次已登记且校验和相符的备份，目标必须是另一个新建空库。"""
        if backup.resolve() not in self.backups:
            raise RuntimeError("拒绝恢复非本次导出的备份")
        expected = backup.with_suffix(".sha256").read_text("utf-8").strip()
        if hashlib.sha256(backup.read_bytes()).hexdigest() != expected:
            raise RuntimeError("备份校验和不匹配")
        target = self.create()
        environment = dict(os.environ, MYSQL_PWD=self.password)
        common = ["--no-defaults", "--protocol=TCP", f"--host={self.host}", f"--port={self.port}",
                  f"--user={self.user}", "--default-character-set=utf8mb4"]
        with backup.open("rb") as source_file:
            restored = subprocess.run([str(self.mysql), *common, f"--database={target}"],
                                      env=environment, stdin=source_file, capture_output=True,
                                      timeout=60, check=False)
        assert restored.returncode == 0, "mysql 恢复失败"
        return target

    def backup_restore(self, source: str) -> str:
        """演练实际导出与恢复，核对包括迁移历史在内的全表结构、行及自增状态。"""
        target = self.restore(self.backup(source))
        assert self.fingerprint(source) == self.fingerprint(target)
        return target

    def close(self) -> None:
        """只删除已登记且命名核验通过的随机测试库，不清理其他数据库。"""
        for database in sorted(self.databases):
            self.owned(database)
            with self.connect() as connection, connection.cursor() as cursor:
                cursor.execute(f"DROP DATABASE `{database}`")


@pytest.fixture
def mysql(tmp_path: Path) -> Iterator[MysqlSandbox]:
    """为每个场景提供独立库集合，成功或失败后均回收本场景数据库。"""
    sandbox = MysqlSandbox(tmp_path)
    try:
        yield sandbox
    finally:
        sandbox.close()


def test_fresh_install_matches_snapshot_and_contains_no_accounts(mysql: MysqlSandbox) -> None:
    """全量迁移与空库快照结构相等，必需元数据可用且身份、日志、示例组织为空。"""
    fresh, snapshot = mysql.create(), mysql.create()
    code, output = mysql.flyway(fresh, "migrate")
    assert code == 0, output
    mysql.sql(snapshot, (ROOT / "数据库文件/basic_framework.sql").read_text("utf-8"))
    assert mysql.structure(fresh) == mysql.structure(snapshot)
    for table in ("system_users", "system_user_role", "system_dept", "system_oauth2_access_token",
                  "system_oauth2_refresh_token", "system_login_log", "infra_file"):
        assert mysql.rows(fresh, f"SELECT COUNT(*) FROM `{table}`") == ((0,),)
    assert mysql.rows(fresh, "SELECT COUNT(*) FROM system_role WHERE code='super_admin' AND role_type='super_admin'") == ((1,),)
    assert mysql.rows(fresh, "SELECT COUNT(*) FROM system_menu")[0][0] > 0
    assert mysql.rows(fresh, "SELECT COUNT(*) FROM flyway_schema_history WHERE success=1") == ((6,),)
    # default 客户端不得保留机器主体授权，否则新装库会直接产生越权读取入口。
    assert mysql.rows(
        fresh, "SELECT JSON_CONTAINS(authorized_grant_types, '\"client_credentials\"') "
               "FROM system_oauth2_client WHERE client_id='default' AND deleted=b'0'") == ((0,),)
    before = mysql.fingerprint(fresh)
    assert mysql.flyway(fresh, "migrate")[0] == 0
    assert mysql.fingerprint(fresh) == before


def test_existing_schema_requires_explicit_baseline_and_preserves_data(mysql: MysqlSandbox) -> None:
    """旧库不能自动接管，显式登记后升级保留账号与文件，并能真实备份恢复。"""
    legacy = mysql.create()
    mysql.sql(legacy, (MIGRATIONS / "V202610010000__initial_schema.sql").read_text("utf-8"))
    mysql.sql(legacy, "INSERT INTO system_users(username,nickname,password,user_type) VALUES ('migration_probe','升级验证','','super_admin');"
              "INSERT INTO infra_file(name,path,url,type,size) VALUES ('probe.txt','legacy/probe.txt','https://example.invalid/probe.txt','text/plain',5);"
              "UPDATE infra_config SET value='true' WHERE config_key='system.user.register-enabled';")
    before = mysql.fingerprint(legacy)
    code, output = mysql.flyway(legacy, "migrate")
    assert code != 0 and "non-empty" in output.lower()
    assert mysql.fingerprint(legacy) == before
    restored = mysql.backup_restore(legacy)
    assert mysql.fingerprint(restored) == before
    assert mysql.flyway(legacy, "baseline")[0] == 0
    assert mysql.flyway(legacy, "migrate")[0] == 0
    assert mysql.rows(legacy, "SELECT username FROM system_users") == (("migration_probe",),)
    assert mysql.rows(legacy, "SELECT path,size FROM infra_file") == (("legacy/probe.txt", 5),)
    assert mysql.rows(legacy, "SELECT value FROM infra_config WHERE config_key='system.user.register-enabled'") == (("false",),)
    # 升级必须真正收回 default 客户端的机器主体授权，而不只是新装路径生效。
    assert mysql.rows(
        legacy, "SELECT JSON_CONTAINS(authorized_grant_types, '\"client_credentials\"') "
                "FROM system_oauth2_client WHERE client_id='default' AND deleted=b'0'") == ((0,),)
    # 其余授权类型必须保留，避免误伤真实用户登录与刷新。
    assert mysql.rows(
        legacy, "SELECT JSON_CONTAINS(authorized_grant_types, '\"password\"'), "
                "JSON_CONTAINS(authorized_grant_types, '\"refresh_token\"') "
                "FROM system_oauth2_client WHERE client_id='default' AND deleted=b'0'") == ((1, 1),)
    fresh = mysql.create()
    assert mysql.flyway(fresh, "migrate")[0] == 0
    assert mysql.structure(legacy) == mysql.structure(fresh)


def test_changed_migration_fails_checksum_without_database_changes(mysql: MysqlSandbox, tmp_path: Path) -> None:
    """篡改已应用脚本被真实 Flyway 校验拒绝，不以重新记账掩盖漂移。"""
    database = mysql.create()
    assert mysql.flyway(database, "migrate")[0] == 0
    modified = tmp_path / "changed"
    shutil.copytree(MIGRATIONS, modified)
    target = modified / "V202610020002__system_authentication_defaults.sql"
    target.write_text(target.read_text("utf-8") + "\nSELECT 42;\n", encoding="utf-8")
    before = mysql.fingerprint(database)
    code, output = mysql.flyway(database, "validate", f"-Dflyway.locations=filesystem:{modified.as_posix()}")
    assert code != 0 and "checksum mismatch" in output.lower()
    assert mysql.fingerprint(database) == before


def test_failed_ddl_is_recorded_and_restore_is_complete(mysql: MysqlSandbox, tmp_path: Path) -> None:
    """真实 DDL 中途失败会留下对象与失败记录，后续迁移受阻，备份可恢复完整先前状态。"""
    database = mysql.create()
    assert mysql.flyway(database, "migrate")[0] == 0
    backup = mysql.backup(database)
    expected = mysql.fingerprint(database)
    modified = tmp_path / "failure"
    shutil.copytree(MIGRATIONS, modified)
    (modified / "V202610030001__controlled_failure.sql").write_text(
        "CREATE TABLE failed_probe (id INT PRIMARY KEY);\nINSERT INTO deliberately_missing_table VALUES (1);\n", encoding="utf-8")
    code, output = mysql.flyway(database, "migrate", f"-Dflyway.locations=filesystem:{modified.as_posix()}")
    assert code != 0 and "failed" in output.lower()
    assert mysql.rows(database, "SHOW TABLES LIKE 'failed_probe'") == (("failed_probe",),)
    assert mysql.rows(database, "SELECT success FROM flyway_schema_history WHERE version='202610030001'") == ((0,),)
    assert mysql.flyway(database, "migrate", f"-Dflyway.locations=filesystem:{modified.as_posix()}")[0] != 0
    restored = mysql.restore(backup)
    assert mysql.fingerprint(restored) == expected
    assert mysql.flyway(restored, "validate")[0] == 0


def test_clean_is_disabled_and_empty_locations_fail(mysql: MysqlSandbox, tmp_path: Path) -> None:
    """生产插件拒绝清库与缺失迁移位置，不能把零脚本当作有效安装。"""
    database = mysql.create()
    assert mysql.flyway(database, "migrate")[0] == 0
    before = mysql.fingerprint(database)
    code, output = mysql.flyway(database, "clean")
    assert code != 0 and "cleandisabled" in output.lower()
    assert mysql.fingerprint(database) == before
    code, _ = mysql.flyway(database, "migrate", f"-Dflyway.locations=filesystem:{(tmp_path / 'missing').as_posix()}")
    assert code != 0


def test_corrupt_backup_is_refused_before_creating_target(mysql: MysqlSandbox) -> None:
    """备份被改变后在建库或执行 SQL 前失败，已有源库保持原状。"""
    database = mysql.create()
    assert mysql.flyway(database, "migrate")[0] == 0
    backup = mysql.backup(database)
    backup.write_bytes(backup.read_bytes() + b"\nSELECT 42;\n")
    before, owned = mysql.fingerprint(database), set(mysql.databases)
    with pytest.raises(RuntimeError, match="校验和"):
        mysql.restore(backup)
    assert mysql.databases == owned
    assert mysql.fingerprint(database) == before


def prepare_grant_clients(mysql: MysqlSandbox, grants: str | None) -> str:
    """建立自有最小旧配置表并参数化写入边界值；保留第三方和逻辑删除客户端作作用域对照。"""
    database = mysql.create()
    mysql.sql(database, "CREATE TABLE system_oauth2_client ("
              "id BIGINT PRIMARY KEY, client_id VARCHAR(64) NOT NULL, "
              "authorized_grant_types VARCHAR(255) NULL, deleted BIT(1) NOT NULL)")
    with mysql.connect(database) as connection, connection.cursor() as cursor:
        cursor.executemany(
            "INSERT INTO system_oauth2_client(id,client_id,authorized_grant_types,deleted) VALUES (%s,%s,%s,%s)",
            [(1, "default", grants, 0), (2, "third_party", '["client_credentials"]', 0),
             (3, "default", '["client_credentials"]', 1)],
        )
    return database


@pytest.mark.parametrize(("grants", "expected"), [
    ('["password","client_credentials","client_credentials","client_credentials","refresh_token"]',
     ["password", "refresh_token"]),
    ('["clientXcredentials","client_credentials","refresh_token"]',
     ["clientXcredentials", "refresh_token"]),
    ('["client_credentials","client_credentials"]', []),
    ('["中文授权","client_credentials","password"]', ["中文授权", "password"]),
    ('["Client_credentials","client_credentials","CLIENT_CREDENTIALS"]',
     ["Client_credentials", "CLIENT_CREDENTIALS"]),
    ('[null,true,42,"client_credentials","0"]', [None, True, 42, "0"]),
    ('[ "password", "refresh_token", "clientXcredentials" ]',
     '[ "password", "refresh_token", "clientXcredentials" ]'),
    (None, None),
    ("", ""),
    ('["password",', '["password",'),
    ('"client_credentials"', '"client_credentials"'),
    ('"password"', '"password"'),
    ("123", "123"),
    ("null", "null"),
    ('{"grant":"client_credentials"}', '{"grant":"client_credentials"}'),
    ("[]", "[]"),
    (json.dumps([0] * 110 + ["client_credentials"], separators=(",", ":")), [0] * 110),
], ids=["duplicates", "literal_underscore", "only_duplicates", "unicode", "case_sensitive", "non_string_elements",
        "already_clean", "sql_null", "empty", "invalid_json", "scalar_target", "scalar_other",
        "scalar_number", "json_null", "object", "empty_array", "near_column_limit"])
def test_default_grant_repair_handles_literal_values_and_corrupt_shapes(
        mysql: MysqlSandbox, grants: str | None, expected: list | str | None) -> None:
    """真实执行 004，证明重复目标全部删除、干扰值和原顺序保留，非数组及损坏配置原样留存。"""
    database = prepare_grant_clients(mysql, grants)
    mysql.sql(database, DEFAULT_GRANT_REPAIR.read_text("utf-8"))
    actual = mysql.rows(database, "SELECT authorized_grant_types FROM system_oauth2_client WHERE id=1")[0][0]
    if isinstance(expected, list):
        assert json.loads(actual) == expected
        assert mysql.rows(database, "SELECT JSON_CONTAINS(authorized_grant_types, '\"client_credentials\"') "
                                   "FROM system_oauth2_client WHERE id=1") == ((0,),)
    else:
        assert actual == expected


def test_default_grant_repair_is_replayable_and_preserves_other_clients(mysql: MysqlSandbox) -> None:
    """直接重跑 004 两次必须保持全库摘要；第三方和已删除 default 的机器授权不能被误收回。"""
    database = prepare_grant_clients(mysql, '["password","client_credentials","client_credentials"]')
    source = DEFAULT_GRANT_REPAIR.read_text("utf-8")
    mysql.sql(database, source)
    assert mysql.rows(database, "SELECT id,authorized_grant_types FROM system_oauth2_client WHERE id IN (2,3) ORDER BY id") == (
        (2, '["client_credentials"]'), (3, '["client_credentials"]'))
    before = mysql.fingerprint(database)
    mysql.sql(database, source)
    assert mysql.fingerprint(database) == before
    mysql.sql(database, source)
    assert mysql.fingerprint(database) == before


def test_default_grant_repair_restores_a_low_session_concat_limit(mysql: MysqlSandbox) -> None:
    """低拼接上限不能截断保留授权，迁移结束必须恢复同一连接原设置，避免影响后续脚本。"""
    database = prepare_grant_clients(mysql, '["password","client_credentials","refresh_token"]')
    with mysql.connect(database) as connection, connection.cursor() as cursor:
        cursor.execute("SET SESSION group_concat_max_len=8")
        cursor.execute(DEFAULT_GRANT_REPAIR.read_text("utf-8"))
        while cursor.nextset():
            pass
        cursor.execute("SELECT @@SESSION.group_concat_max_len")
        assert cursor.fetchone() == (8,)
        cursor.execute("SELECT authorized_grant_types FROM system_oauth2_client WHERE id=1")
        assert json.loads(cursor.fetchone()[0]) == ["password", "refresh_token"]


def test_default_grant_repair_postcheck_rejects_a_remaining_target(mysql: MysqlSandbox) -> None:
    """单独执行真实后检时，尚存机器授权必须触发服务器约束错误，不能以输出查询结果冒充断言。"""
    database = prepare_grant_clients(mysql, '["password","client_credentials"]')
    source = DEFAULT_GRANT_REPAIR.read_text("utf-8")
    postcheck = source[source.index("CREATE TEMPORARY TABLE `bf_default_grant_assertion`"):
                       source.rindex("SET SESSION group_concat_max_len")]
    with pytest.raises(pymysql.MySQLError, match="Check constraint"):
        mysql.sql(database, postcheck)
    assert mysql.rows(database, "SELECT authorized_grant_types FROM system_oauth2_client WHERE id=1") == (
        ('["password","client_credentials"]',),)


def test_default_grant_repair_upgrades_an_already_applied_single_removal(mysql: MysqlSandbox) -> None:
    """从真实 Flyway 003 的重复残留升级到 004，验证补救版本执行并保留原授权顺序和干扰值。"""
    database = mysql.create()
    code, output = mysql.flyway(database, "migrate", "-Dflyway.target=202610020002")
    assert code == 0, output
    mysql.sql(database, "UPDATE system_oauth2_client SET authorized_grant_types="
              "'[\"password\",\"client_credentials\",\"client_credentials\",\"client_credentials\",\"clientXcredentials\",\"refresh_token\"]' "
              "WHERE client_id='default' AND deleted=b'0'")
    code, output = mysql.flyway(database, "migrate", "-Dflyway.target=202610020003")
    assert code == 0, output
    previous = json.loads(mysql.rows(database, "SELECT authorized_grant_types FROM system_oauth2_client "
                                    "WHERE client_id='default' AND deleted=b'0'")[0][0])
    assert previous.count("client_credentials") == 2
    code, output = mysql.flyway(database, "migrate")
    assert code == 0, output
    actual = json.loads(mysql.rows(database, "SELECT authorized_grant_types FROM system_oauth2_client "
                                  "WHERE client_id='default' AND deleted=b'0'")[0][0])
    assert actual == ["password", "clientXcredentials", "refresh_token"]
    assert mysql.rows(database, "SELECT success FROM flyway_schema_history WHERE version='202610020004'") == ((1,),)
