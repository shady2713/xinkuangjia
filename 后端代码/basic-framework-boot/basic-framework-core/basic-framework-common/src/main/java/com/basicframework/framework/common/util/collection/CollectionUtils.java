package com.basicframework.framework.common.util.collection;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.ArrayUtil;

import java.util.*;
import java.util.function.*;
import java.util.stream.Collectors;

import static java.util.Arrays.asList;

/**
 * Collection 工具类
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
public class CollectionUtils {

    /**
     * 判断源对象是否命中任一目标值。
     *
     * @param source 源对象
     * @param targets 目标值数组
     * @return 是否命中
     */
    public static boolean containsAny(Object source, Object... targets) {
        return asList(targets).contains(source);
    }

    /**
     * 过滤集合元素。
     *
     * @param from 源集合
     * @param predicate 过滤条件
     * @return 过滤后的列表；源集合为空时返回空列表
     */
    public static <T> List<T> filterList(Collection<T> from, Predicate<T> predicate) {
        if (CollUtil.isEmpty(from)) {
            return new ArrayList<>();
        }
        return from.stream().filter(predicate).collect(Collectors.toList());
    }

    /**
     * 将数组转换为列表。
     *
     * @param from 源数组
     * @param func 元素转换函数
     * @return 转换后的列表；源数组为空时返回空列表
     */
    public static <T, U> List<U> convertList(T[] from, Function<T, U> func) {
        if (ArrayUtil.isEmpty(from)) {
            return new ArrayList<>();
        }
        return convertList(asList(from), func);
    }

    /**
     * 将集合转换为列表，转换结果为 null 的元素会被过滤。
     *
     * @param from 源集合
     * @param func 元素转换函数
     * @return 转换后的列表；源集合为空时返回空列表
     */
    public static <T, U> List<U> convertList(Collection<T> from, Function<T, U> func) {
        if (CollUtil.isEmpty(from)) {
            return new ArrayList<>();
        }
        return from.stream().map(func).filter(Objects::nonNull).collect(Collectors.toList());
    }

    /**
     * 先过滤集合元素，再转换为列表。
     *
     * @param from 源集合
     * @param func 元素转换函数
     * @param filter 过滤条件
     * @return 转换后的列表；源集合为空时返回空列表
     */
    public static <T, U> List<U> convertList(Collection<T> from, Function<T, U> func, Predicate<T> filter) {
        if (CollUtil.isEmpty(from)) {
            return new ArrayList<>();
        }
        return from.stream().filter(filter).map(func).filter(Objects::nonNull).collect(Collectors.toList());
    }

    /**
     * 将集合转换为 Set。
     *
     * @param from 源集合
     * @return 转换后的 Set
     */
    public static <T> Set<T> convertSet(Collection<T> from) {
        return convertSet(from, v -> v);
    }

    /**
     * 将集合转换为 Set，转换结果为 null 的元素会被过滤。
     *
     * @param from 源集合
     * @param func 元素转换函数
     * @return 转换后的 Set；源集合为空时返回空 Set
     */
    public static <T, U> Set<U> convertSet(Collection<T> from, Function<T, U> func) {
        if (CollUtil.isEmpty(from)) {
            return new HashSet<>();
        }
        return from.stream().map(func).filter(Objects::nonNull).collect(Collectors.toSet());
    }

    /**
     * 先过滤集合元素，再转换为 Set。
     *
     * @param from 源集合
     * @param func 元素转换函数
     * @param filter 过滤条件
     * @return 转换后的 Set；源集合为空时返回空 Set
     */
    public static <T, U> Set<U> convertSet(Collection<T> from, Function<T, U> func, Predicate<T> filter) {
        if (CollUtil.isEmpty(from)) {
            return new HashSet<>();
        }
        return from.stream().filter(filter).map(func).filter(Objects::nonNull).collect(Collectors.toSet());
    }

    /**
     * 将集合转换为 Map，集合元素作为 Map 值。
     *
     * @param from 源集合
     * @param keyFunc Map 键生成函数
     * @return 转换后的 Map；源集合为空时返回空 Map
     */
    public static <T, K> Map<K, T> convertMap(Collection<T> from, Function<T, K> keyFunc) {
        if (CollUtil.isEmpty(from)) {
            return new HashMap<>();
        }
        return convertMap(from, keyFunc, Function.identity());
    }

    /**
     * 将集合转换为指定 Map 实现，集合元素作为 Map 值。
     *
     * @param from 源集合
     * @param keyFunc Map 键生成函数
     * @param supplier Map 实例供应器
     * @return 转换后的 Map；源集合为空时返回供应器创建的空 Map
     */
    public static <T, K> Map<K, T> convertMap(Collection<T> from, Function<T, K> keyFunc, Supplier<? extends Map<K, T>> supplier) {
        if (CollUtil.isEmpty(from)) {
            return supplier.get();
        }
        return convertMap(from, keyFunc, Function.identity(), supplier);
    }

    /**
     * 将集合转换为 Map。
     *
     * @param from 源集合
     * @param keyFunc Map 键生成函数
     * @param valueFunc Map 值生成函数
     * @return 转换后的 Map；源集合为空时返回空 Map
     */
    public static <T, K, V> Map<K, V> convertMap(Collection<T> from, Function<T, K> keyFunc, Function<T, V> valueFunc) {
        if (CollUtil.isEmpty(from)) {
            return new HashMap<>();
        }
        return convertMap(from, keyFunc, valueFunc, (v1, v2) -> v1);
    }

    /**
     * 将集合转换为 Map，并用合并函数处理重复键。
     *
     * @param from 源集合
     * @param keyFunc Map 键生成函数
     * @param valueFunc Map 值生成函数
     * @param mergeFunction 重复键值合并函数
     * @return 转换后的 Map；源集合为空时返回空 Map
     */
    public static <T, K, V> Map<K, V> convertMap(Collection<T> from, Function<T, K> keyFunc, Function<T, V> valueFunc, BinaryOperator<V> mergeFunction) {
        if (CollUtil.isEmpty(from)) {
            return new HashMap<>();
        }
        return convertMap(from, keyFunc, valueFunc, mergeFunction, HashMap::new);
    }

    /**
     * 将集合转换为指定 Map 实现。
     *
     * @param from 源集合
     * @param keyFunc Map 键生成函数
     * @param valueFunc Map 值生成函数
     * @param supplier Map 实例供应器
     * @return 转换后的 Map；源集合为空时返回供应器创建的空 Map
     */
    public static <T, K, V> Map<K, V> convertMap(Collection<T> from, Function<T, K> keyFunc, Function<T, V> valueFunc, Supplier<? extends Map<K, V>> supplier) {
        if (CollUtil.isEmpty(from)) {
            return supplier.get();
        }
        return convertMap(from, keyFunc, valueFunc, (v1, v2) -> v1, supplier);
    }

    /**
     * 将集合转换为指定 Map 实现，并用合并函数处理重复键。
     *
     * @param from 源集合
     * @param keyFunc Map 键生成函数
     * @param valueFunc Map 值生成函数
     * @param mergeFunction 重复键值合并函数
     * @param supplier Map 实例供应器
     * @return 转换后的 Map；源集合为空时返回空 Map
     */
    public static <T, K, V> Map<K, V> convertMap(Collection<T> from, Function<T, K> keyFunc, Function<T, V> valueFunc, BinaryOperator<V> mergeFunction, Supplier<? extends Map<K, V>> supplier) {
        if (CollUtil.isEmpty(from)) {
            return new HashMap<>();
        }
        return from.stream().collect(Collectors.toMap(keyFunc, valueFunc, mergeFunction, supplier));
    }

    /**
     * 查找首个满足条件的元素。
     *
     * @param from 源集合
     * @param predicate 匹配条件
     * @return 首个匹配元素；不存在时返回 null
     */
    public static <T> T findFirst(Collection<T> from, Predicate<T> predicate) {
        return findFirst(from, predicate, Function.identity());
    }

    /**
     * 查找首个满足条件的元素，并转换返回值。
     *
     * @param from 源集合
     * @param predicate 匹配条件
     * @param func 返回值转换函数
     * @return 转换后的首个匹配结果；不存在时返回 null
     */
    public static <T, U> U findFirst(Collection<T> from, Predicate<T> predicate, Function<T, U> func) {
        if (CollUtil.isEmpty(from)) {
            return null;
        }
        return from.stream().filter(predicate).findFirst().map(func).orElse(null);
    }

    /**
     * 当元素不为 null 时添加到集合。
     *
     * @param coll 目标集合
     * @param item 待添加元素
     */
    public static <T> void addIfNotNull(Collection<T> coll, T item) {
        if (item == null) {
            return;
        }
        coll.add(item);
    }

    /**
     * 将单个对象包装为集合。
     *
     * @param obj 源对象
     * @return 单元素集合；对象为 null 时返回空集合
     */
    public static <T> Collection<T> singleton(T obj) {
        return obj == null ? Collections.emptyList() : Collections.singleton(obj);
    }

}
