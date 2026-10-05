package com.basicframework.framework.datapermission.core.db;

import com.basicframework.framework.datapermission.core.rule.DataPermissionRule;
import com.basicframework.framework.datapermission.core.rule.DataPermissionRuleFactory;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import net.sf.jsqlparser.expression.Expression;
import net.sf.jsqlparser.expression.StringValue;
import net.sf.jsqlparser.schema.Table;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证数据权限处理器在跨租户旁路开关打开时的短路行为。
 *
 * <p>{@link DataPermissionRuleHandler} 会为每条 SQL 追加数据权限条件，是数据隔离的最后一道防线；
 * 跨租户排查开关（{@code SecurityFrameworkUtils.skipPermissionCheck()}）一旦打开，处理器必须在
 * 解析规则之前就返回“不追加条件”，否则排查用的跨租户查询仍会被改写，或者规则工厂被无谓调用。</p>
 *
 * <p>开关当前恒为 false，生产路径上该分支不可达，因此用例用公开静态方法的替身打开它，
 * 同时保留一条未打开开关的正对照，证明处理器并非恒返回 null。</p>
 *
 * @author shady2713
 */
class DataPermissionRuleHandlerTest {

    /** 需要追加条件的真实表名，用于正对照。 */
    private static final String TABLE_NAME = "system_users";

    /**
     * 旁路开关打开时必须直接返回 null，且不得向规则工厂索取规则。
     *
     * <p>断言包含两个可观察结果：返回值为 null（不追加条件），以及规则工厂从未被调用（真正短路）。</p>
     */
    @Test
    void skipSwitchReturnsNullWithoutQueryingRuleFactory() {
        DataPermissionRuleFactory ruleFactory = mock(DataPermissionRuleFactory.class);
        DataPermissionRuleHandler handler = new DataPermissionRuleHandler(ruleFactory);

        try (MockedStatic<SecurityFrameworkUtils> mocked = mockStatic(SecurityFrameworkUtils.class)) {
            mocked.when(SecurityFrameworkUtils::skipPermissionCheck).thenReturn(true);

            Expression expression = handler.getSqlSegment(new Table(TABLE_NAME), null, "probe.mapper.select");

            assertThat(expression).as("旁路打开时不得追加任何数据权限条件").isNull();
            verify(ruleFactory, never()).getDataPermissionRule(anyString());
        }
    }

    /**
     * 正对照：开关未打开且规则命中时，处理器必须真实产出过滤表达式。
     *
     * <p>缺少这条对照，上一条断言的 null 就无法区分“短路生效”与“处理器恒不产出条件”。</p>
     */
    @Test
    void matchingRuleProducesExpressionWhenSwitchIsClosed() {
        DataPermissionRule rule = mock(DataPermissionRule.class);
        when(rule.getTableNames()).thenReturn(Set.of(TABLE_NAME));
        when(rule.getExpression(TABLE_NAME, null)).thenReturn(new StringValue("probe"));
        DataPermissionRuleFactory ruleFactory = mock(DataPermissionRuleFactory.class);
        when(ruleFactory.getDataPermissionRule("probe.mapper.select")).thenReturn(List.of(rule));
        DataPermissionRuleHandler handler = new DataPermissionRuleHandler(ruleFactory);

        Expression expression = handler.getSqlSegment(new Table(TABLE_NAME), null, "probe.mapper.select");

        assertThat(expression).as("规则命中时必须产出过滤表达式").isNotNull();
        assertThat(expression.toString()).contains("probe");
    }

}
