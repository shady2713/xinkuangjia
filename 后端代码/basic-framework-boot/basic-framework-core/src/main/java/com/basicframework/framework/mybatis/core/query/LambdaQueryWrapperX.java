package com.basicframework.framework.mybatis.core.query;

import cn.hutool.core.util.ArrayUtil;
import cn.hutool.core.util.ObjectUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.support.SFunction;
import org.springframework.util.StringUtils;

import java.util.Collection;

/**
 * 拓展 MyBatis Plus QueryWrapper 类，主要增加如下功能：
 * <p>
 * 1. 拼接条件的方法，增加 xxxIfPresent 方法，用于判断值不存在的时候，不要拼接到条件中。
 *
 * @param <T> 数据类型
 * @author 李杰
 */
public class LambdaQueryWrapperX<T> extends LambdaQueryWrapper<T> {

    /**
     * 参数有效时追加 like 查询条件，并返回当前查询包装器。
     *
     * @param column 字段参数
     * @param val val参数
     * @return 当前查询包装器
     */
    public LambdaQueryWrapperX<T> likeIfPresent(SFunction<T, ?> column, String val) {
        if (StringUtils.hasText(val)) {
            return (LambdaQueryWrapperX<T>) super.like(column, val);
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
    public LambdaQueryWrapperX<T> inIfPresent(SFunction<T, ?> column, Collection<?> values) {
        if (ObjectUtil.isAllNotEmpty(values) && !ArrayUtil.isEmpty(values)) {
            return (LambdaQueryWrapperX<T>) super.in(column, values);
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
    public LambdaQueryWrapperX<T> inIfPresent(SFunction<T, ?> column, Object... values) {
        if (ObjectUtil.isAllNotEmpty(values) && !ArrayUtil.isEmpty(values)) {
            return (LambdaQueryWrapperX<T>) super.in(column, values);
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
    public LambdaQueryWrapperX<T> eqIfPresent(SFunction<T, ?> column, Object val) {
        if (ObjectUtil.isNotEmpty(val)) {
            return (LambdaQueryWrapperX<T>) super.eq(column, val);
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
    public LambdaQueryWrapperX<T> neIfPresent(SFunction<T, ?> column, Object val) {
        if (ObjectUtil.isNotEmpty(val)) {
            return (LambdaQueryWrapperX<T>) super.ne(column, val);
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
    public LambdaQueryWrapperX<T> gtIfPresent(SFunction<T, ?> column, Object val) {
        if (val != null) {
            return (LambdaQueryWrapperX<T>) super.gt(column, val);
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
    public LambdaQueryWrapperX<T> geIfPresent(SFunction<T, ?> column, Object val) {
        if (val != null) {
            return (LambdaQueryWrapperX<T>) super.ge(column, val);
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
    public LambdaQueryWrapperX<T> ltIfPresent(SFunction<T, ?> column, Object val) {
        if (val != null) {
            return (LambdaQueryWrapperX<T>) super.lt(column, val);
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
    public LambdaQueryWrapperX<T> leIfPresent(SFunction<T, ?> column, Object val) {
        if (val != null) {
            return (LambdaQueryWrapperX<T>) super.le(column, val);
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
    public LambdaQueryWrapperX<T> betweenIfPresent(SFunction<T, ?> column, Object val1, Object val2) {
        if (val1 != null && val2 != null) {
            return (LambdaQueryWrapperX<T>) super.between(column, val1, val2);
        }
        if (val1 != null) {
            return (LambdaQueryWrapperX<T>) ge(column, val1);
        }
        if (val2 != null) {
            return (LambdaQueryWrapperX<T>) le(column, val2);
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
    public LambdaQueryWrapperX<T> betweenIfPresent(SFunction<T, ?> column, Object[] values) {
        Object val1 = ArrayUtil.get(values, 0);
        Object val2 = ArrayUtil.get(values, 1);
        return betweenIfPresent(column, val1, val2);
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
    public LambdaQueryWrapperX<T> eq(boolean condition, SFunction<T, ?> column, Object val) {
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
    public LambdaQueryWrapperX<T> eq(SFunction<T, ?> column, Object val) {
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
    public LambdaQueryWrapperX<T> orderByDesc(SFunction<T, ?> column) {
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
    public LambdaQueryWrapperX<T> last(String lastSql) {
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
    public LambdaQueryWrapperX<T> in(SFunction<T, ?> column, Collection<?> coll) {
        super.in(column, coll);
        return this;
    }

}
