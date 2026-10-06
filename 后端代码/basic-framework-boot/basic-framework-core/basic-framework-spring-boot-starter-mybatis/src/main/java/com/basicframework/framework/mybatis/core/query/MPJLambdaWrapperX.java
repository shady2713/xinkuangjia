package com.basicframework.framework.mybatis.core.query;

import cn.hutool.core.util.ArrayUtil;
import cn.hutool.core.util.ObjectUtil;
import com.baomidou.mybatisplus.core.toolkit.support.SFunction;
import com.github.yulichang.wrapper.MPJLambdaWrapper;
import org.springframework.util.StringUtils;

import java.util.Collection;
import java.util.function.Consumer;

/**
 * 拓展 MyBatis Plus Join QueryWrapper 类，主要增加如下功能：
 * <p>
 * 1. 拼接条件的方法，增加 xxxIfPresent 方法，用于判断值不存在的时候，不要拼接到条件中。
 * 2. SFunction<S, ?> column + <S> 泛型：支持任意类字段（主表、子表、三表），推荐写法, 让编译器自动推断 S 类型
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-framework/yudao-spring-boot-starter-mybatis/src/main/java/cn/
 * 上游文件续：iocoder/yudao/framework/mybatis/core/query/MPJLambdaWrapperX.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 2 行，移除或改写上游 4 行；import 新增 0 行、移除 1 行；补充注释 214 行。
 *
 * @param <T> 数据类型
 */
public class MPJLambdaWrapperX<T> extends MPJLambdaWrapper<T> {

    /**
     * 参数有效时追加 like 查询条件，并返回当前查询包装器。
     *
     * @param column 字段参数
     * @param val val参数
     * @return 当前查询包装器
     */
    public <S> MPJLambdaWrapperX<T> likeIfPresent(SFunction<S, ?> column, String val) {
        if (StringUtils.hasText(val)) {
            return (MPJLambdaWrapperX<T>) super.like(column, val);
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
    public <S> MPJLambdaWrapperX<T> inIfPresent(SFunction<S, ?> column, Collection<?> values) {
        if (ObjectUtil.isAllNotEmpty(values) && !ArrayUtil.isEmpty(values)) {
            return (MPJLambdaWrapperX<T>) super.in(column, values);
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
    public <S> MPJLambdaWrapperX<T> inIfPresent(SFunction<S, ?> column, Object... values) {
        if (ObjectUtil.isAllNotEmpty(values) && !ArrayUtil.isEmpty(values)) {
            return (MPJLambdaWrapperX<T>) super.in(column, values);
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
    public <S> MPJLambdaWrapperX<T> eqIfPresent(SFunction<S, ?> column, Object val) {
        if (ObjectUtil.isNotEmpty(val)) {
            return (MPJLambdaWrapperX<T>) super.eq(column, val);
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
    public <S> MPJLambdaWrapperX<T> neIfPresent(SFunction<S, ?> column, Object val) {
        if (ObjectUtil.isNotEmpty(val)) {
            return (MPJLambdaWrapperX<T>) super.ne(column, val);
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
    public <S> MPJLambdaWrapperX<T> gtIfPresent(SFunction<S, ?> column, Object val) {
        if (val != null) {
            return (MPJLambdaWrapperX<T>) super.gt(column, val);
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
    public <S> MPJLambdaWrapperX<T> geIfPresent(SFunction<S, ?> column, Object val) {
        if (val != null) {
            return (MPJLambdaWrapperX<T>) super.ge(column, val);
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
    public <S> MPJLambdaWrapperX<T> ltIfPresent(SFunction<S, ?> column, Object val) {
        if (val != null) {
            return (MPJLambdaWrapperX<T>) super.lt(column, val);
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
    public <S> MPJLambdaWrapperX<T> leIfPresent(SFunction<S, ?> column, Object val) {
        if (val != null) {
            return (MPJLambdaWrapperX<T>) super.le(column, val);
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
    public <S> MPJLambdaWrapperX<T> betweenIfPresent(SFunction<S, ?> column, Object[] values) {
        Object val1 = ArrayUtil.get(values, 0);
        Object val2 = ArrayUtil.get(values, 1);
        return betweenIfPresent(column, val1, val2);
    }

    /**
     * 参数有效时追加 区间 查询条件，并返回当前查询包装器。
     *
     * @param column 字段参数
     * @param val1 val1参数
     * @param val2 val2参数
     * @return 当前查询包装器
     */
    public <S> MPJLambdaWrapperX<T> betweenIfPresent(SFunction<S, ?> column, Object val1, Object val2) {
        if (val1 != null && val2 != null) {
            return (MPJLambdaWrapperX<T>) super.between(column, val1, val2);
        }
        if (val1 != null) {
            return (MPJLambdaWrapperX<T>) super.ge(column, val1);
        }
        if (val2 != null) {
            return (MPJLambdaWrapperX<T>) super.le(column, val2);
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
    public <X> MPJLambdaWrapperX<T> eq(boolean condition, SFunction<X, ?> column, Object val) {
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
    public <X> MPJLambdaWrapperX<T> eq(SFunction<X, ?> column, Object val) {
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
    public <X> MPJLambdaWrapperX<T> orderByDesc(SFunction<X, ?> column) {
        super.orderByDesc(true, column);
        return this;
    }

    /**
     * 追加升序排序条件并返回当前查询包装器。
     *
     * @param column column 参数
     * @return 当前查询包装器
     */
    @Override
    public <X> MPJLambdaWrapperX<T> orderByAsc(SFunction<X, ?> column) {
        super.orderByAsc(true, column);
        return this;
    }

    /**
     * 追加查询尾部 SQL 片段并返回当前查询包装器。
     *
     * @param lastSql lastSql 参数
     * @return 当前查询包装器
     */
    @Override
    public MPJLambdaWrapperX<T> last(String lastSql) {
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
    public <X> MPJLambdaWrapperX<T> in(SFunction<X, ?> column, Collection<?> coll) {
        super.in(column, coll);
        return this;
    }

    /**
     * 查询全部。
     *
     * @param clazz 目标类型
     * @return 当前查询包装器
     */
    @Override
    public MPJLambdaWrapperX<T> selectAll(Class<?> clazz) {
        super.selectAll(clazz);
        return this;
    }

    /**
     * 查询全部。
     *
     * @param clazz 目标类型
     * @param prefix prefix 参数
     * @return 当前查询包装器
     */
    @Override
    public MPJLambdaWrapperX<T> selectAll(Class<?> clazz, String prefix) {
        super.selectAll(clazz, prefix);
        return this;
    }

    /**
     * 查询As。
     *
     * @param column column 参数
     * @param alias alias 参数
     * @return 当前查询包装器
     */
    @Override
    public <S> MPJLambdaWrapperX<T> selectAs(SFunction<S, ?> column, String alias) {
        super.selectAs(column, alias);
        return this;
    }

    /**
     * 查询As。
     *
     * @param column column 参数
     * @param alias alias 参数
     * @return 当前查询包装器
     */
    @Override
    public <E> MPJLambdaWrapperX<T> selectAs(String column, SFunction<E, ?> alias) {
        super.selectAs(column, alias);
        return this;
    }

    /**
     * 查询As。
     *
     * @param column column 参数
     * @param alias alias 参数
     * @return 当前查询包装器
     */
    @Override
    public <S, X> MPJLambdaWrapperX<T> selectAs(SFunction<S, ?> column, SFunction<X, ?> alias) {
        super.selectAs(column, alias);
        return this;
    }

    /**
     * 查询As。
     *
     * @param index index 参数
     * @param column column 参数
     * @param alias alias 参数
     * @return 当前查询包装器
     */
    @Override
    public <E, X> MPJLambdaWrapperX<T> selectAs(String index, SFunction<E, ?> column, SFunction<X, ?> alias) {
        super.selectAs(index, column, alias);
        return this;
    }

    /**
     * 查询AsClass。
     *
     * @param source source 参数
     * @param tag tag 参数
     * @return 当前查询包装器
     */
    @Override
    public <E> MPJLambdaWrapperX<T> selectAsClass(Class<E> source, Class<?> tag) {
        super.selectAsClass(source, tag);
        return this;
    }

    /**
     * 查询Sub。
     *
     * @param clazz 目标类型
     * @param consumer consumer 参数
     * @param alias alias 参数
     * @return 当前查询包装器
     */
    @Override
    public <E, F> MPJLambdaWrapperX<T> selectSub(Class<E> clazz, Consumer<MPJLambdaWrapper<E>> consumer, SFunction<F, ?> alias) {
        super.selectSub(clazz, consumer, alias);
        return this;
    }

    /**
     * 查询Sub。
     *
     * @param clazz 目标类型
     * @param st st 参数
     * @param consumer consumer 参数
     * @param alias alias 参数
     * @return 当前查询包装器
     */
    @Override
    public <E, F> MPJLambdaWrapperX<T> selectSub(Class<E> clazz, String st, Consumer<MPJLambdaWrapper<E>> consumer, SFunction<F, ?> alias) {
        super.selectSub(clazz, st, consumer, alias);
        return this;
    }

    /**
     * 查询数量。
     *
     * @param column column 参数
     * @return 当前查询包装器
     */
    @Override
    public <S> MPJLambdaWrapperX<T> selectCount(SFunction<S, ?> column) {
        super.selectCount(column);
        return this;
    }

    /**
     * 查询数量。
     *
     * @param column column 参数
     * @param alias alias 参数
     * @return 当前查询包装器
     */
    @Override
    public MPJLambdaWrapperX<T> selectCount(Object column, String alias) {
        super.selectCount(column, alias);
        return this;
    }

    /**
     * 查询数量。
     *
     * @param column column 参数
     * @param alias alias 参数
     * @return 当前查询包装器
     */
    @Override
    public <X> MPJLambdaWrapperX<T> selectCount(Object column, SFunction<X, ?> alias) {
        super.selectCount(column, alias);
        return this;
    }

    /**
     * 查询数量。
     *
     * @param column column 参数
     * @param alias alias 参数
     * @return 当前查询包装器
     */
    @Override
    public <S> MPJLambdaWrapperX<T> selectCount(SFunction<S, ?> column, String alias) {
        super.selectCount(column, alias);
        return this;
    }

    /**
     * 查询数量。
     *
     * @param column column 参数
     * @param alias alias 参数
     * @return 当前查询包装器
     */
    @Override
    public <S, X> MPJLambdaWrapperX<T> selectCount(SFunction<S, ?> column, SFunction<X, ?> alias) {
        super.selectCount(column, alias);
        return this;
    }

    /**
     * 查询Sum。
     *
     * @param column column 参数
     * @return 当前查询包装器
     */
    @Override
    public <S> MPJLambdaWrapperX<T> selectSum(SFunction<S, ?> column) {
        super.selectSum(column);
        return this;
    }

    /**
     * 查询Sum。
     *
     * @param column column 参数
     * @param alias alias 参数
     * @return 当前查询包装器
     */
    @Override
    public <S> MPJLambdaWrapperX<T> selectSum(SFunction<S, ?> column, String alias) {
        super.selectSum(column, alias);
        return this;
    }

    /**
     * 查询Sum。
     *
     * @param column column 参数
     * @param alias alias 参数
     * @return 当前查询包装器
     */
    @Override
    public <S, X> MPJLambdaWrapperX<T> selectSum(SFunction<S, ?> column, SFunction<X, ?> alias) {
        super.selectSum(column, alias);
        return this;
    }

    /**
     * 查询最大值。
     *
     * @param column column 参数
     * @return 当前查询包装器
     */
    @Override
    public <S> MPJLambdaWrapperX<T> selectMax(SFunction<S, ?> column) {
        super.selectMax(column);
        return this;
    }

    /**
     * 查询最大值。
     *
     * @param column column 参数
     * @param alias alias 参数
     * @return 当前查询包装器
     */
    @Override
    public <S> MPJLambdaWrapperX<T> selectMax(SFunction<S, ?> column, String alias) {
        super.selectMax(column, alias);
        return this;
    }

    /**
     * 查询最大值。
     *
     * @param column column 参数
     * @param alias alias 参数
     * @return 当前查询包装器
     */
    @Override
    public <S, X> MPJLambdaWrapperX<T> selectMax(SFunction<S, ?> column, SFunction<X, ?> alias) {
        super.selectMax(column, alias);
        return this;
    }

    /**
     * 查询最小值。
     *
     * @param column column 参数
     * @return 当前查询包装器
     */
    @Override
    public <S> MPJLambdaWrapperX<T> selectMin(SFunction<S, ?> column) {
        super.selectMin(column);
        return this;
    }

    /**
     * 查询最小值。
     *
     * @param column column 参数
     * @param alias alias 参数
     * @return 当前查询包装器
     */
    @Override
    public <S> MPJLambdaWrapperX<T> selectMin(SFunction<S, ?> column, String alias) {
        super.selectMin(column, alias);
        return this;
    }

    /**
     * 查询最小值。
     *
     * @param column column 参数
     * @param alias alias 参数
     * @return 当前查询包装器
     */
    @Override
    public <S, X> MPJLambdaWrapperX<T> selectMin(SFunction<S, ?> column, SFunction<X, ?> alias) {
        super.selectMin(column, alias);
        return this;
    }

    /**
     * 查询Avg。
     *
     * @param column column 参数
     * @return 当前查询包装器
     */
    @Override
    public <S> MPJLambdaWrapperX<T> selectAvg(SFunction<S, ?> column) {
        super.selectAvg(column);
        return this;
    }

    /**
     * 查询Avg。
     *
     * @param column column 参数
     * @param alias alias 参数
     * @return 当前查询包装器
     */
    @Override
    public <S> MPJLambdaWrapperX<T> selectAvg(SFunction<S, ?> column, String alias) {
        super.selectAvg(column, alias);
        return this;
    }

    /**
     * 查询Avg。
     *
     * @param column column 参数
     * @param alias alias 参数
     * @return 当前查询包装器
     */
    @Override
    public <S, X> MPJLambdaWrapperX<T> selectAvg(SFunction<S, ?> column, SFunction<X, ?> alias) {
        super.selectAvg(column, alias);
        return this;
    }

    /**
     * 查询Len。
     *
     * @param column column 参数
     * @return 当前查询包装器
     */
    @Override
    public <S> MPJLambdaWrapperX<T> selectLen(SFunction<S, ?> column) {
        super.selectLen(column);
        return this;
    }

    /**
     * 查询Len。
     *
     * @param column column 参数
     * @param alias alias 参数
     * @return 当前查询包装器
     */
    @Override
    public <S> MPJLambdaWrapperX<T> selectLen(SFunction<S, ?> column, String alias) {
        super.selectLen(column, alias);
        return this;
    }

    /**
     * 查询Len。
     *
     * @param column column 参数
     * @param alias alias 参数
     * @return 当前查询包装器
     */
    @Override
    public <S, X> MPJLambdaWrapperX<T> selectLen(SFunction<S, ?> column, SFunction<X, ?> alias) {
        super.selectLen(column, alias);
        return this;
    }

    // ========== 关键重写：使 leftJoin 返回当前类型 this ==========
    /**
     * 追加左连接查询条件并返回当前查询包装器。
     *
     * @param clazz 目标类型
     * @param left left 参数
     * @param right right 参数
     * @return 当前查询包装器
     */
    @Override
    public <A, B> MPJLambdaWrapperX<T> leftJoin(Class<A> clazz, SFunction<A, ?> left, SFunction<B, ?> right) {
        super.leftJoin(clazz, left, right);
        return this;
    }

    /**
     * 追加右连接查询条件并返回当前查询包装器。
     *
     * @param clazz 目标类型
     * @param left left 参数
     * @param right right 参数
     * @return 当前查询包装器
     */
    @Override
    public <A, B> MPJLambdaWrapperX<T> rightJoin(Class<A> clazz, SFunction<A, ?> left, SFunction<B, ?> right) {
        super.rightJoin(clazz, left, right);
        return this;
    }

    /**
     * 追加内连接查询条件并返回当前查询包装器。
     *
     * @param clazz 目标类型
     * @param left left 参数
     * @param right right 参数
     * @return 当前查询包装器
     */
    @Override
    public <A, B> MPJLambdaWrapperX<T> innerJoin(Class<A> clazz, SFunction<A, ?> left, SFunction<B, ?> right) {
        super.innerJoin(clazz, left, right);
        return this;
    }

    // ========== 添加扩展 Join 支持 ext 函数式参数 ==========
    /**
     * 完成 leftJoin 对应的业务处理。
     *
     * @param clazz clazz参数
     * @param left left参数
     * @param right right参数
     * @param ext ext参数
     * @return 方法处理结果
     */
    public <A, B> MPJLambdaWrapperX<T> leftJoin(Class<A> clazz, SFunction<A, ?> left, SFunction<B, ?> right, Consumer<MPJLambdaWrapperX<T>> ext) {
        super.leftJoin(clazz, left, right);
        if (ext != null) ext.accept(this);
        return this;
    }

    /**
     * 完成 rightJoin 对应的业务处理。
     *
     * @param clazz clazz参数
     * @param left left参数
     * @param right right参数
     * @param ext ext参数
     * @return 方法处理结果
     */
    public <A, B> MPJLambdaWrapperX<T> rightJoin(Class<A> clazz, SFunction<A, ?> left, SFunction<B, ?> right, Consumer<MPJLambdaWrapperX<T>> ext) {
        super.rightJoin(clazz, left, right);
        if (ext != null) ext.accept(this);
        return this;
    }

    /**
     * 完成 innerJoin 对应的业务处理。
     *
     * @param clazz clazz参数
     * @param left left参数
     * @param right right参数
     * @param ext ext参数
     * @return 方法处理结果
     */
    public <A, B> MPJLambdaWrapperX<T> innerJoin(Class<A> clazz, SFunction<A, ?> left, SFunction<B, ?> right, Consumer<MPJLambdaWrapperX<T>> ext) {
        super.innerJoin(clazz, left, right);
        if (ext != null) ext.accept(this);
        return this;
    }
}
