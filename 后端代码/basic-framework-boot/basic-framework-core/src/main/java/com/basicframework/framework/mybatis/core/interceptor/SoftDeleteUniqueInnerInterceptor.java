package com.basicframework.framework.mybatis.core.interceptor;

import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.mybatis.core.util.MyBatisUtils;
import com.baomidou.mybatisplus.core.metadata.TableFieldInfo;
import com.baomidou.mybatisplus.core.metadata.TableInfo;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.baomidou.mybatisplus.core.toolkit.PluginUtils;
import com.baomidou.mybatisplus.extension.parser.JsqlParserSupport;
import com.baomidou.mybatisplus.extension.plugins.inner.InnerInterceptor;
import net.sf.jsqlparser.expression.Expression;
import net.sf.jsqlparser.expression.HexValue;
import net.sf.jsqlparser.expression.JdbcNamedParameter;
import net.sf.jsqlparser.expression.JdbcParameter;
import net.sf.jsqlparser.expression.LongValue;
import net.sf.jsqlparser.expression.StringValue;
import net.sf.jsqlparser.schema.Column;
import net.sf.jsqlparser.statement.update.Update;
import net.sf.jsqlparser.statement.update.UpdateSet;
import org.apache.ibatis.executor.statement.StatementHandler;
import org.apache.ibatis.mapping.BoundSql;
import org.apache.ibatis.mapping.MappedStatement;
import org.apache.ibatis.mapping.ParameterMapping;
import org.apache.ibatis.mapping.ParameterMode;
import org.apache.ibatis.mapping.SqlCommandType;
import org.apache.ibatis.session.Configuration;

import java.sql.Connection;
import java.util.List;

/**
 * 逻辑删除唯一键消歧拦截器。
 *
 * <p>当对声明了 {@code deleted_tag} 列的实体执行逻辑删除（即 UPDATE 语句将 {@code deleted} 置为删除值）时，
 * 自动在 SET 子句追加 {@code deleted_tag = id}。这样无论调用 {@code deleteById}、{@code deleteByIds}
 * 还是条件 {@code delete(wrapper)}，多条历史软删除记录都能按各自主键区分，不阻塞同编码记录重新创建。</p>
 *
 * @author shady2713
 */
public class SoftDeleteUniqueInnerInterceptor extends JsqlParserSupport implements InnerInterceptor {

    /** 逻辑删除列名。 */
    private static final String DELETED_COLUMN = "deleted";

    /** 唯一索引消歧列名。 */
    private static final String DELETED_TAG_COLUMN = "deleted_tag";

    /**
     * 在 SQL 预编译前识别逻辑删除更新语句并补齐 {@code deleted_tag = id}。
     *
     * @param sh MyBatis 语句处理器
     * @param connection 当前数据库连接
     * @param transactionTimeout 事务超时时间（秒），可能为空
     */
    @Override
    public void beforePrepare(StatementHandler sh, Connection connection, Integer transactionTimeout) {
        PluginUtils.MPStatementHandler mpSh = PluginUtils.mpStatementHandler(sh);
        MappedStatement ms = mpSh.mappedStatement();
        if (ms.getSqlCommandType() != SqlCommandType.UPDATE) {
            return;
        }
        PluginUtils.MPBoundSql mpBs = mpSh.mPBoundSql();
        String sql = mpBs.sql();
        if (!StrUtil.containsIgnoreCase(sql, DELETED_COLUMN)) {
            return;
        }
        ParameterContext parameterContext = new ParameterContext(ms.getConfiguration(), sh.getBoundSql());
        mpBs.sql(parserMulti(sql, parameterContext));
    }

    /**
     * 解析单条 UPDATE 语法树，若目标表含 {@code deleted_tag} 且本次更新设置 {@code deleted}，则追加主键消歧赋值。
     *
     * @param update UPDATE 语法树
     * @param index 多语句序号
     * @param sql 原始 SQL
     * @param obj 附加参数上下文
     */
    @Override
    protected void processUpdate(Update update, int index, String sql, Object obj) {
        if (update.getTable() == null) {
            return;
        }
        String tableName = MyBatisUtils.getTableName(update.getTable());
        TableInfo tableInfo = TableInfoHelper.getTableInfo(tableName);
        if (tableInfo == null || !hasDeletedTagColumn(tableInfo)) {
            return;
        }
        List<UpdateSet> updateSets = update.getUpdateSets();
        if (updateSets == null || updateSets.isEmpty()) {
            return;
        }
        boolean setsDeleted = false;
        boolean setsDeletedTag = false;
        for (UpdateSet updateSet : updateSets) {
            List<Column> columns = updateSet.getColumns();
            List<? extends Expression> values = updateSet.getValues();
            for (int i = 0; i < columns.size(); i++) {
                String colName = cleanIdentifier(columns.get(i).getColumnName());
                if (DELETED_COLUMN.equalsIgnoreCase(colName)) {
                    Expression valueExpr = (values != null && i < values.size()) ? values.get(i) : null;
                    if (isLogicDeleteValue(valueExpr, obj)) {
                        setsDeleted = true;
                    }
                } else if (DELETED_TAG_COLUMN.equalsIgnoreCase(colName)) {
                    setsDeletedTag = true;
                }
            }
        }
        if (setsDeleted && !setsDeletedTag) {
            String keyColumn = cleanIdentifier(StrUtil.blankToDefault(tableInfo.getKeyColumn(), "id"));
            update.addUpdateSet(new Column(DELETED_TAG_COLUMN), new Column(keyColumn));
        }
    }

    /**
     * 判断 {@code deleted} 列的赋值表达式是否代表逻辑删除（而非恢复为未删除状态）。
     *
     * <p>显式将 {@code deleted} 置为 {@code 0}、{@code false}、{@code b'0'} 等未删除值时返回 {@code false}；
     * 对于参数化占位符 {@code ?}，会结合 {@link BoundSql} 解析真实绑定值并在无法解析时安全降级为 {@code false}，
     * 避免恢复或常规更新语句误将活跃行的 {@code deleted_tag} 篡改为 {@code id}。</p>
     *
     * @param valueExpr SET 子句右侧赋值表达式
     * @param obj       SQL 参数上下文
     * @return 为逻辑删除值时返回 true
     */
    private static boolean isLogicDeleteValue(Expression valueExpr, Object obj) {
        if (valueExpr == null) {
            return false;
        }
        if (valueExpr instanceof LongValue longValue) {
            return longValue.getValue() != 0L;
        }
        if (valueExpr instanceof StringValue stringValue) {
            String text = StrUtil.trim(stringValue.getValue());
            return "1".equals(text) || "true".equalsIgnoreCase(text);
        }
        if (valueExpr instanceof HexValue hexValue) {
            String text = StrUtil.trim(hexValue.getValue());
            return !"0x0".equalsIgnoreCase(text) && !"0x00".equalsIgnoreCase(text);
        }
        if (valueExpr instanceof JdbcParameter jdbcParameter) {
            return isLogicDeleteBoundValue(resolveJdbcParameterValue(jdbcParameter, obj));
        }
        if (valueExpr instanceof JdbcNamedParameter) {
            return false;
        }
        String raw = StrUtil.trim(valueExpr.toString());
        if ("0".equals(raw) || "false".equalsIgnoreCase(raw) || "b'0'".equalsIgnoreCase(raw) || "'0'".equals(raw)) {
            return false;
        }
        return "1".equals(raw) || "true".equalsIgnoreCase(raw) || "b'1'".equalsIgnoreCase(raw) || "'1'".equals(raw);
    }

    /**
     * 按 JDBC 占位符序号从 {@link BoundSql} 解析对应的真实参数值。
     *
     * @param jdbcParameter JSqlParser 占位符节点（序号从 1 开始）
     * @param obj           参数上下文
     * @return 解析到的绑定参数值；上下文缺失、越界或属性不可读时返回 null
     */
    private static Object resolveJdbcParameterValue(JdbcParameter jdbcParameter, Object obj) {
        if (!(obj instanceof ParameterContext context)
                || context.configuration() == null
                || context.boundSql() == null) {
            return null;
        }
        Integer index = jdbcParameter.getIndex();
        if (index == null || index < 1) {
            return null;
        }
        List<ParameterMapping> mappings = context.boundSql().getParameterMappings();
        int paramIndex = index - 1;
        if (mappings == null || paramIndex >= mappings.size()) {
            return null;
        }
        ParameterMapping mapping = mappings.get(paramIndex);
        if (mapping.getMode() == ParameterMode.OUT) {
            return null;
        }
        String property = mapping.getProperty();
        if (context.boundSql().hasAdditionalParameter(property)) {
            return context.boundSql().getAdditionalParameter(property);
        }
        Object paramObj = context.boundSql().getParameterObject();
        if (paramObj == null) {
            return null;
        }
        if (context.configuration().getTypeHandlerRegistry().hasTypeHandler(paramObj.getClass())) {
            return paramObj;
        }
        try {
            return context.configuration().newMetaObject(paramObj).getValue(property);
        } catch (RuntimeException ex) {
            return null;
        }
    }

    /**
     * 判断已解析的绑定参数值是否表示逻辑删除状态。
     *
     * @param value 绑定参数值
     * @return 表示逻辑删除（true / 非零数值 / "1" / "true" / 非零字节）时返回 true
     */
    private static boolean isLogicDeleteBoundValue(Object value) {
        if (value == null) {
            return false;
        }
        if (value instanceof Boolean boolVal) {
            return boolVal;
        }
        if (value instanceof Number numVal) {
            return numVal.longValue() != 0L;
        }
        if (value instanceof CharSequence text) {
            String trimmed = StrUtil.trim(text.toString());
            return "1".equals(trimmed) || "true".equalsIgnoreCase(trimmed);
        }
        if (value instanceof byte[] bytes) {
            return bytes.length > 0 && bytes[bytes.length - 1] != 0;
        }
        return false;
    }

    /**
     * 透传至 JSqlParser 解析回调的 MyBatis 参数上下文。
     *
     * @param configuration MyBatis 全局配置
     * @param boundSql      当前绑定 SQL 与参数映射
     */
    record ParameterContext(Configuration configuration, BoundSql boundSql) {
    }

    /**
     * 判断实体元数据是否声明了 {@code deleted_tag} 列。
     *
     * @param tableInfo MyBatis-Plus 表元数据
     * @return 声明了 {@code deleted_tag} 返回 true
     */
    private static boolean hasDeletedTagColumn(TableInfo tableInfo) {
        for (TableFieldInfo field : tableInfo.getFieldList()) {
            if (DELETED_TAG_COLUMN.equalsIgnoreCase(cleanIdentifier(field.getColumn()))) {
                return true;
            }
        }
        return false;
    }

    /**
     * 去除标识符首尾的反引号或双引号。
     *
     * @param identifier 原始列名
     * @return 规范化后的列名
     */
    private static String cleanIdentifier(String identifier) {
        if (identifier == null) {
            return "";
        }
        return StrUtil.strip(identifier.trim(), "`", "`").replace("\"", "");
    }

}
