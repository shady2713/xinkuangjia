package com.basicframework.framework.datapermission.core.db;

import cn.hutool.core.collection.CollUtil;
import com.basicframework.framework.datapermission.core.rule.DataPermissionRule;
import com.basicframework.framework.datapermission.core.rule.DataPermissionRuleFactory;
import com.basicframework.framework.mybatis.core.util.MyBatisUtils;
import com.baomidou.mybatisplus.extension.plugins.handler.MultiDataPermissionHandler;
import lombok.RequiredArgsConstructor;
import net.sf.jsqlparser.expression.Expression;
import net.sf.jsqlparser.expression.operators.conditional.AndExpression;
import net.sf.jsqlparser.schema.Table;

import java.util.List;

import static com.basicframework.framework.security.core.util.SecurityFrameworkUtils.skipPermissionCheck;

/**
 * 基于 {@link DataPermissionRule} 的数据权限处理器。
 *
 * <p>底层基于 MyBatis Plus 数据权限插件，在 SQL 执行前根据当前用户的数据权限动态追加过滤条件，
 * 确保查询结果只包含当前用户允许访问的数据。</p>
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@RequiredArgsConstructor
public class DataPermissionRuleHandler implements MultiDataPermissionHandler {

    private final DataPermissionRuleFactory ruleFactory;

    /**
     * 为当前 SQL 表生成数据权限过滤片段。
     *
     * <p>多条规则同时命中同一张表时使用 AND 合并；没有规则、规则未命中或规则返回空表达式时不追加条件。</p>
     *
     * @param table 当前 SQL 中正在处理的表
     * @param where 当前 SQL 原始 WHERE 条件，可能为空
     * @param mappedStatementId MyBatis MappedStatement 编号
     * @return 需要追加的数据权限 SQL 表达式；无须追加时返回 null
     */
    @Override
    public Expression getSqlSegment(Table table, Expression where, String mappedStatementId) {
        if (skipPermissionCheck()) {
            return null;
        }

        List<DataPermissionRule> rules = ruleFactory.getDataPermissionRule(mappedStatementId);
        if (CollUtil.isEmpty(rules)) {
            return null;
        }

        // 生成条件
        Expression allExpression = null;
        for (DataPermissionRule rule : rules) {
            // 判断表名是否匹配
            String tableName = MyBatisUtils.getTableName(table);
            if (!rule.getTableNames().contains(tableName)) {
                continue;
            }

            // 单条规则的条件
            Expression oneExpress = rule.getExpression(tableName, table.getAlias());
            if (oneExpress == null) {
                continue;
            }
            allExpression = allExpression == null ? oneExpress
                    : new AndExpression(allExpression, oneExpress);
        }
        return allExpression;
    }

}
