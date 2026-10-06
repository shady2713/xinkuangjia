package com.basicframework.framework.datapermission.core.rule;

import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import net.sf.jsqlparser.expression.Alias;
import net.sf.jsqlparser.expression.Expression;

import java.util.Set;

/**
 * 数据权限规则接口。
 *
 * <p>实现类负责声明自己影响的表，并为命中的表生成对应的数据权限 SQL 表达式。</p>
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
public interface DataPermissionRule {

    /**
     * 返回需要生效的表名集合。
     *
     * <p>数据权限基于 SQL 重写实现，只有当 SQL 中的表名命中该集合时才会调用 {@link #getExpression(String, Alias)}
     * 生成过滤条件。如果需要基于实体类获得表名，可调用 {@link TableInfoHelper#getTableInfo(Class)}。</p>
     *
     * @return 需要追加数据权限条件的表名集合
     */
    Set<String> getTableNames();

    /**
     * 根据表名和别名生成对应的数据权限过滤条件。
     *
     * @param tableName 表名
     * @param tableAlias 表别名，可能为空
     * @return 过滤条件表达式；无需追加条件时返回 null
     */
    Expression getExpression(String tableName, Alias tableAlias);

}
