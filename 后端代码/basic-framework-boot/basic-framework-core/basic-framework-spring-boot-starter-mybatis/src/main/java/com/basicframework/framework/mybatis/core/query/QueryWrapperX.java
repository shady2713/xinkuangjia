package com.basicframework.framework.mybatis.core.query;

import com.basicframework.framework.mybatis.core.util.JdbcUtils;
import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.ArrayUtils;
import com.baomidou.mybatisplus.core.toolkit.CollectionUtils;
import org.springframework.util.StringUtils;

import java.util.Collection;

/**
 * 拓展 MyBatis Plus QueryWrapper 类，主要增加如下功能：
 *
 * 1. 拼接条件的方法，增加 xxxIfPresent 方法，用于判断值不存在的时候，不要拼接到条件中。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-framework/yudao-spring-boot-starter-mybatis/src/main/java/
 * 上游文件续：cn/iocoder/yudao/framework/mybatis/core/query/QueryWrapperX.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 6 行，移除或改写上游 5 行；补充注释 66 行，上游注释 1 行未保留。
 *
 * @param <T> 数据类型
 */
public class QueryWrapperX<T> extends QueryWrapper<T> {

    /**
     * 参数有效时追加 like 查询条件，并返回当前查询包装器。
     *
     * @param column 字段参数
     * @param val val参数
     * @return 当前查询包装器
     */
    public QueryWrapperX<T> likeIfPresent(String column, String val) {
        if (StringUtils.hasText(val)) {
            return (QueryWrapperX<T>) super.like(column, val);
        }
        return this;
    }

    /**
     * 参数有效时追加 in 查询条件，并返回当前查询包装器。
     *
     * @param column 字段参数
     * @param values 输入值集合
     * @return 当前查询包装器
     */
    public QueryWrapperX<T> inIfPresent(String column, Collection<?> values) {
        if (!CollectionUtils.isEmpty(values)) {
            return (QueryWrapperX<T>) super.in(column, values);
        }
        return this;
    }

    /**
     * 参数有效时追加 in 查询条件，并返回当前查询包装器。
     *
     * @param column 字段参数
     * @param values 输入值集合
     * @return 当前查询包装器
     */
    public QueryWrapperX<T> inIfPresent(String column, Object... values) {
        if (!ArrayUtils.isEmpty(values)) {
            return (QueryWrapperX<T>) super.in(column, values);
        }
        return this;
    }

    /**
     * 参数有效时追加 eq 查询条件，并返回当前查询包装器。
     *
     * @param column 字段参数
     * @param val val参数
     * @return 当前查询包装器
     */
    public QueryWrapperX<T> eqIfPresent(String column, Object val) {
        if (val != null) {
            return (QueryWrapperX<T>) super.eq(column, val);
        }
        return this;
    }

    /**
     * 参数有效时追加 ne 查询条件，并返回当前查询包装器。
     *
     * @param column 字段参数
     * @param val val参数
     * @return 当前查询包装器
     */
    public QueryWrapperX<T> neIfPresent(String column, Object val) {
        if (val != null) {
            return (QueryWrapperX<T>) super.ne(column, val);
        }
        return this;
    }

    /**
     * 参数有效时追加 gt 查询条件，并返回当前查询包装器。
     *
     * @param column 字段参数
     * @param val val参数
     * @return 当前查询包装器
     */
    public QueryWrapperX<T> gtIfPresent(String column, Object val) {
        if (val != null) {
            return (QueryWrapperX<T>) super.gt(column, val);
        }
        return this;
    }

    /**
     * 参数有效时追加 ge 查询条件，并返回当前查询包装器。
     *
     * @param column 字段参数
     * @param val val参数
     * @return 当前查询包装器
     */
    public QueryWrapperX<T> geIfPresent(String column, Object val) {
        if (val != null) {
            return (QueryWrapperX<T>) super.ge(column, val);
        }
        return this;
    }

    /**
     * 参数有效时追加 lt 查询条件，并返回当前查询包装器。
     *
     * @param column 字段参数
     * @param val val参数
     * @return 当前查询包装器
     */
    public QueryWrapperX<T> ltIfPresent(String column, Object val) {
        if (val != null) {
            return (QueryWrapperX<T>) super.lt(column, val);
        }
        return this;
    }

    /**
     * 参数有效时追加 le 查询条件，并返回当前查询包装器。
     *
     * @param column 字段参数
     * @param val val参数
     * @return 当前查询包装器
     */
    public QueryWrapperX<T> leIfPresent(String column, Object val) {
        if (val != null) {
            return (QueryWrapperX<T>) super.le(column, val);
        }
        return this;
    }

    /**
     * 参数有效时追加 区间 查询条件，并返回当前查询包装器。
     *
     * @param column 字段参数
     * @param val1 val1参数
     * @param val2 val2参数
     * @return 当前查询包装器
     */
    public QueryWrapperX<T> betweenIfPresent(String column, Object val1, Object val2) {
        if (val1 != null && val2 != null) {
            return (QueryWrapperX<T>) super.between(column, val1, val2);
        }
        if (val1 != null) {
            return (QueryWrapperX<T>) ge(column, val1);
        }
        if (val2 != null) {
            return (QueryWrapperX<T>) le(column, val2);
        }
        return this;
    }

    /**
     * 参数有效时追加 区间 查询条件，并返回当前查询包装器。
     *
     * @param column 字段参数
     * @param values 输入值集合
     * @return 当前查询包装器
     */
    public QueryWrapperX<T> betweenIfPresent(String column, Object[] values) {
        if (values!= null && values.length != 0 && values[0] != null && values[1] != null) {
            return (QueryWrapperX<T>) super.between(column, values[0], values[1]);
        }
        if (values!= null && values.length != 0 && values[0] != null) {
            return (QueryWrapperX<T>) ge(column, values[0]);
        }
        if (values!= null && values.length != 0 && values[1] != null) {
            return (QueryWrapperX<T>) le(column, values[1]);
        }
        return this;
    }

    // ========== 重写父类方法，方便链式调用 ==========

    /**
     * 追加等值查询条件并返回当前查询包装器。
     *
     * @param condition condition 参数
     * @param column column 参数
     * @param val val 参数
     * @return 当前查询包装器
     */
    @Override
    public QueryWrapperX<T> eq(boolean condition, String column, Object val) {
        super.eq(condition, column, val);
        return this;
    }

    /**
     * 追加等值查询条件并返回当前查询包装器。
     *
     * @param column column 参数
     * @param val val 参数
     * @return 当前查询包装器
     */
    @Override
    public QueryWrapperX<T> eq(String column, Object val) {
        super.eq(column, val);
        return this;
    }

    /**
     * 追加降序排序条件并返回当前查询包装器。
     *
     * @param column column 参数
     * @return 当前查询包装器
     */
    @Override
    public QueryWrapperX<T> orderByDesc(String column) {
        super.orderByDesc(true, column);
        return this;
    }

    /**
     * 追加查询尾部 SQL 片段并返回当前查询包装器。
     *
     * @param lastSql lastSql 参数
     * @return 当前查询包装器
     */
    @Override
    public QueryWrapperX<T> last(String lastSql) {
        super.last(lastSql);
        return this;
    }

    /**
     * 追加集合范围查询条件并返回当前查询包装器。
     *
     * @param column column 参数
     * @param coll coll 数据集合
     * @return 当前查询包装器
     */
    @Override
    public QueryWrapperX<T> in(String column, Collection<?> coll) {
        super.in(column, coll);
        return this;
    }

    /**
     * 设置只返回最后一条
     *
     * 当前实现按数据库类型生成限制语法。若未来引入更多异构数据源，可进一步抽离方言层。
     *
     * @return this
     */
    public QueryWrapperX<T> limitN(int n) {
        DbType dbType = JdbcUtils.getDbType();
        switch (dbType) {
            case ORACLE:
            case ORACLE_12C:
                super.le("ROWNUM", n);
                break;
            case SQL_SERVER:
            case SQL_SERVER2005:
                super.select("TOP " + n + " *"); // 由于 SQL Server 是通过 SELECT TOP 1 实现限制一条，所以只好使用 * 查询剩余字段
                break;
            default: // MySQL、PostgreSQL、DM 达梦、KingbaseES 大金都是采用 LIMIT 实现
                super.last("LIMIT " + n);
        }
        return this;
    }

}
