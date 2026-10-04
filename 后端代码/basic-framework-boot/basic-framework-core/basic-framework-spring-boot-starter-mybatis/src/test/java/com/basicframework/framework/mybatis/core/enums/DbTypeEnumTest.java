package com.basicframework.framework.mybatis.core.enums;

import com.baomidou.mybatisplus.annotation.DbType;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证数据库类型增强枚举的产品名映射与 FIND_IN_SET 兼容模板。
 *
 * <p>该枚举承担两项运行期契约：把 JDBC 元数据里的数据库产品名映射成 MyBatis Plus 的
 * {@link DbType}，以及为"字段中是否包含某个值"的查询提供各数据库方言的 SQL 片段。
 * 映射写错会让启动期取不到数据库类型、或让分页与 ID 策略退化成默认值；模板写错会让数据权限
 * 过滤在部分数据库上恒真或恒假，属于越权/漏数据风险。因此这里逐项锁定真实取值与失败方式。</p>
 *
 * @author shady2713
 */
class DbTypeEnumTest {

    /** 已登记的产品名必须映射到对应的 MyBatis Plus 数据库类型。 */
    @Test
    void findMapsKnownProductNames() {
        assertThat(DbTypeEnum.find("H2")).isEqualTo(DbType.H2);
        assertThat(DbTypeEnum.find("MySQL")).isEqualTo(DbType.MYSQL);
        assertThat(DbTypeEnum.find("Oracle")).isEqualTo(DbType.ORACLE);
        assertThat(DbTypeEnum.find("PostgreSQL")).as("华为 openGauss 的产品名与 PostgreSQL 相同")
                .isEqualTo(DbType.POSTGRE_SQL);
        assertThat(DbTypeEnum.find("Microsoft SQL Server")).isEqualTo(DbType.SQL_SERVER);
        assertThat(DbTypeEnum.find("Microsoft SQL Server 2005")).isEqualTo(DbType.SQL_SERVER2005);
        assertThat(DbTypeEnum.find("DM DBMS")).isEqualTo(DbType.DM);
        assertThat(DbTypeEnum.find("KingbaseES")).isEqualTo(DbType.KINGBASE_ES);
        assertThat(DbTypeEnum.find("OceanBase")).isEqualTo(DbType.OCEAN_BASE);
    }

    /**
     * 产品名为空或未登记时必须返回 null，而不是猜测一个默认数据库类型。
     *
     * <p>调用方据此决定跳过 ID 策略与环境后置处理；返回错误的类型会把 Oracle 这类
     * 非自增数据库当成自增处理。</p>
     */
    @Test
    void findReturnsNullForBlankOrUnknownProductName() {
        assertThat(DbTypeEnum.find(null)).isNull();
        assertThat(DbTypeEnum.find("")).isNull();
        assertThat(DbTypeEnum.find("   ")).isNull();
        assertThat(DbTypeEnum.find("SQLite")).as("未登记的产品名不得映射成其它数据库").isNull();
    }

    /** 已支持的数据库必须返回其真实方言模板，模板内容决定过滤条件是否等价于"包含该值"。 */
    @Test
    void getFindInSetTemplateReturnsDialectTemplate() {
        assertThat(DbTypeEnum.getFindInSetTemplate(DbType.MYSQL)).isEqualTo("FIND_IN_SET('#{value}', #{column}) <> 0");
        assertThat(DbTypeEnum.getFindInSetTemplate(DbType.ORACLE)).isEqualTo("FIND_IN_SET('#{value}', #{column}) <> 0");
        assertThat(DbTypeEnum.getFindInSetTemplate(DbType.DM)).isEqualTo("FIND_IN_SET('#{value}', #{column}) <> 0");
        assertThat(DbTypeEnum.getFindInSetTemplate(DbType.OCEAN_BASE)).isEqualTo("FIND_IN_SET('#{value}', #{column}) <> 0");
        assertThat(DbTypeEnum.getFindInSetTemplate(DbType.POSTGRE_SQL)).isEqualTo("POSITION('#{value}' IN #{column}) <> 0");
        assertThat(DbTypeEnum.getFindInSetTemplate(DbType.KINGBASE_ES)).isEqualTo("POSITION('#{value}' IN #{column}) <> 0");
        assertThat(DbTypeEnum.getFindInSetTemplate(DbType.SQL_SERVER))
                .isEqualTo("CHARINDEX(',' + #{value} + ',', ',' + #{column} + ',') <> 0");
        assertThat(DbTypeEnum.getFindInSetTemplate(DbType.SQL_SERVER2005))
                .isEqualTo("CHARINDEX(',' + #{value} + ',', ',' + #{column} + ',') <> 0");
    }

    /**
     * 类型为 null 或该数据库没有模板时必须抛错，不能返回空模板。
     *
     * <p>空模板会被拼成恒真条件而放行全部数据，因此这里要求显式失败：H2 登记了空模板
     * （数据文件里不支持 find_in_set），SQLite 未登记模板。</p>
     */
    @Test
    void getFindInSetTemplateRejectsNullAndUnsupportedDialect() {
        assertThatThrownBy(() -> DbTypeEnum.getFindInSetTemplate(null))
                .isInstanceOf(IllegalArgumentException.class).hasMessage("数据库类型不支持 FIND_IN_SET: null");
        assertThatThrownBy(() -> DbTypeEnum.getFindInSetTemplate(DbType.H2))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("H2");
        assertThatThrownBy(() -> DbTypeEnum.getFindInSetTemplate(DbType.SQLITE))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("SQLITE");
    }

}
