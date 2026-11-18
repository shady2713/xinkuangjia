package com.basicframework.framework.mybatis.core.interceptor;

import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.mybatis.core.util.MyBatisUtils;
import com.baomidou.mybatisplus.core.metadata.TableFieldInfo;
import com.baomidou.mybatisplus.core.metadata.TableInfo;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.baomidou.mybatisplus.core.toolkit.PluginUtils;
import com.baomidou.mybatisplus.extension.parser.JsqlParserSupport;
import com.baomidou.mybatisplus.extension.plugins.inner.InnerInterceptor;
import net.sf.jsqlparser.schema.Column;
import net.sf.jsqlparser.statement.update.Update;
import net.sf.jsqlparser.statement.update.UpdateSet;
import org.apache.ibatis.executor.statement.StatementHandler;
import org.apache.ibatis.mapping.MappedStatement;
import org.apache.ibatis.mapping.SqlCommandType;

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
        mpBs.sql(parserMulti(sql, null));
    }

    /**
     * 解析单条 UPDATE 语法树，若目标表含 {@code deleted_tag} 且本次更新设置 {@code deleted}，则追加主键消歧赋值。
     *
     * @param update UPDATE 语法树
     * @param index 多语句序号
     * @param sql 原始 SQL
     * @param obj 附加参数
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
            for (Column column : updateSet.getColumns()) {
                String colName = cleanIdentifier(column.getColumnName());
                if (DELETED_COLUMN.equalsIgnoreCase(colName)) {
                    setsDeleted = true;
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
