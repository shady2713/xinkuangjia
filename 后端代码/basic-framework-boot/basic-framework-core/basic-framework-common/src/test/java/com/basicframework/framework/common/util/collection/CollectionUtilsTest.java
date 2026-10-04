package com.basicframework.framework.common.util.collection;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证集合工具在过滤、转换、查首与空值处理上的实际契约。
 *
 * <p>该工具是业务层把持久对象批量转换为响应模型、把列表转成按编号索引的 Map 的公共通道。
 * 空集合必须返回可用的空结果而不是 null，转换函数返回 null 时必须被过滤而不是写入 null 元素，
 * 重复键必须有确定的合并口径。用例用真实集合与真实函数断言这些可观察结果，并覆盖各重载的空
 * 输入分支。</p>
 *
 * @author shady2713
 */
class CollectionUtilsTest {

    /**
     * 工具类没有实例状态，允许直接实例化后仅使用静态方法。
     *
     * @throws ReflectiveOperationException 实例化失败时抛出
     */
    @Test
    void utilityClassIsStatelessAndInstantiable() throws ReflectiveOperationException {
        assertThat(CollectionUtils.class.getDeclaredFields()).as("工具类不应保存运行期状态").isEmpty();
        assertThat(CollectionUtils.class.getDeclaredConstructor().newInstance()).isInstanceOf(CollectionUtils.class);
    }

    /**
     * 命中判断按值相等比较，目标为空时一律不命中。
     */
    @Test
    void containsAnyMatchesAgainstTargets() {
        assertThat(CollectionUtils.containsAny("b", "a", "b")).isTrue();
        assertThat(CollectionUtils.containsAny("c", "a", "b")).isFalse();
        assertThat(CollectionUtils.containsAny(null, "a")).isFalse();
        assertThat(CollectionUtils.containsAny("a")).as("没有目标值时不得命中").isFalse();
    }

    /**
     * 过滤集合时空集合返回空列表，非空集合按条件保留元素。
     */
    @Test
    void filterListHandlesEmptyAndMatchingInput() {
        assertThat(CollectionUtils.filterList(null, value -> true)).isEmpty();
        assertThat(CollectionUtils.filterList(List.of(), value -> true)).isEmpty();
        assertThat(CollectionUtils.filterList(List.of(1, 2, 3), value -> value > 1)).containsExactly(2, 3);
    }

    /**
     * 数组与集合转换都过滤 null 结果，空输入返回空列表。
     */
    @Test
    void convertListFiltersNullsAndHandlesEmptyInput() {
        assertThat(CollectionUtils.convertList(new Integer[0], String::valueOf)).isEmpty();
        assertThat(CollectionUtils.convertList((Integer[]) null, String::valueOf)).isEmpty();
        assertThat(CollectionUtils.convertList(new Integer[]{1, 2}, value -> value * 10)).containsExactly(10, 20);
        assertThat(CollectionUtils.convertList(List.of(1, 2, 3), value -> value == 2 ? null : value))
                .as("转换结果为 null 的元素必须被过滤").containsExactly(1, 3);
        assertThat(CollectionUtils.convertList(List.of(), value -> value)).isEmpty();
        assertThat(CollectionUtils.convertList((Collection<Integer>) null, value -> value)).isEmpty();
    }

    /**
     * 先过滤再转换的重载按顺序生效，空输入返回空列表。
     */
    @Test
    void convertListWithFilterAppliesFilterBeforeMapping() {
        assertThat(CollectionUtils.convertList(List.of(), value -> value, value -> true)).isEmpty();
        assertThat(CollectionUtils.convertList((Collection<Integer>) null, value -> value, value -> true)).isEmpty();
        assertThat(CollectionUtils.convertList(List.of(1, 2, 3), value -> value * 10, value -> value != 2))
                .containsExactly(10, 30);
        assertThat(CollectionUtils.convertList(List.of(1, 2), value -> null, value -> true))
                .as("转换结果为 null 时同样过滤").isEmpty();
    }

    /**
     * 集合转 Set 时去重并过滤 null，空输入返回空 Set。
     */
    @Test
    void convertSetDeduplicatesAndFiltersNulls() {
        assertThat(CollectionUtils.convertSet(List.of(1, 1, 2))).containsExactlyInAnyOrder(1, 2);
        assertThat(CollectionUtils.convertSet(List.of(1, 2), value -> value == 1 ? null : value))
                .as("转换结果为 null 的元素必须被过滤").containsExactly(2);
        assertThat(CollectionUtils.convertSet(List.<Integer>of(), value -> value)).isEmpty();
        assertThat(CollectionUtils.convertSet((Collection<Integer>) null, value -> value)).isEmpty();
        assertThat(CollectionUtils.convertSet(List.of(1, 2), value -> value * 10, value -> value != 1))
                .containsExactly(20);
        assertThat(CollectionUtils.convertSet(List.<Integer>of(), value -> value, value -> true)).isEmpty();
    }

    /**
     * 集合转 Map 时元素作为值，重复键保留先出现的值。
     */
    @Test
    void convertMapKeepsElementAsValueAndFirstValueForDuplicateKey() {
        assertThat(CollectionUtils.convertMap(List.of("a", "bb"), String::length))
                .containsExactlyInAnyOrderEntriesOf(Map.of(1, "a", 2, "bb"));
        assertThat(CollectionUtils.convertMap(List.<String>of(), String::length)).isEmpty();
        assertThat(CollectionUtils.convertMap((Collection<String>) null, String::length)).isEmpty();
        assertThat(CollectionUtils.convertMap(List.of("a", "b"), value -> 1))
                .as("重复键必须保留先出现的值").containsExactly(Map.entry(1, "a"));
    }

    /**
     * 指定 Map 实现的转换在空输入时返回供应器创建的实例。
     */
    @Test
    void convertMapWithSupplierReturnsSuppliedInstanceForEmptyInput() {
        Map<Integer, String> empty = CollectionUtils.convertMap(List.<String>of(), String::length, () -> new LinkedHashMap<Integer, String>());
        assertThat(empty).isInstanceOf(LinkedHashMap.class).isEmpty();

        Map<Integer, String> converted = CollectionUtils.convertMap(List.of("a", "bb"), String::length,
                () -> new LinkedHashMap<Integer, String>());
        assertThat(converted).isInstanceOf(LinkedHashMap.class)
                .containsExactlyInAnyOrderEntriesOf(Map.of(1, "a", 2, "bb"));
    }

    /**
     * 指定键与值函数的转换保留先出现的重复键值。
     */
    @Test
    void convertMapWithValueFunctionKeepsFirstValue() {
        assertThat(CollectionUtils.convertMap(List.of("a", "bb"), value -> 1, String::toUpperCase))
                .as("重复键必须保留先出现的值").containsExactly(Map.entry(1, "A"));
        assertThat(CollectionUtils.convertMap(List.<String>of(), value -> 1, String::toUpperCase)).isEmpty();
        assertThat(CollectionUtils.convertMap((Collection<String>) null, value -> 1, String::toUpperCase)).isEmpty();
    }

    /**
     * 提供合并函数时必须按函数合并重复键，空输入返回空 Map。
     */
    @Test
    void convertMapWithMergeFunctionCombinesDuplicateKeys() {
        assertThat(CollectionUtils.convertMap(List.of("a", "bb", "cc"), String::length, String::length,
                Integer::sum)).containsExactly(Map.entry(1, 1), Map.entry(2, 4));
        assertThat(CollectionUtils.convertMap(List.<String>of(), String::length, String::length, Integer::sum))
                .isEmpty();
        assertThat(CollectionUtils.convertMap((Collection<String>) null, String::length, String::length, Integer::sum))
                .isEmpty();
    }

    /**
     * 带供应器的键值转换使用指定 Map 实现，空输入返回供应器实例，重复键保留先出现的值。
     */
    @Test
    void convertMapWithValueFunctionAndSupplierUsesSuppliedMap() {
        Map<Integer, String> empty = CollectionUtils.convertMap(List.<String>of(), String::length,
                String::toUpperCase, () -> new TreeMap<Integer, String>());
        assertThat(empty).isInstanceOf(TreeMap.class).isEmpty();

        Map<Integer, String> converted = CollectionUtils.convertMap(List.of("a", "bb"), String::length,
                String::toUpperCase, () -> new TreeMap<Integer, String>());
        assertThat(converted).isInstanceOf(TreeMap.class)
                .containsExactly(Map.entry(1, "A"), Map.entry(2, "BB"));

        Map<Integer, String> duplicated = CollectionUtils.convertMap(List.of("a", "b"), String::length,
                String::toUpperCase, () -> new TreeMap<Integer, String>());
        assertThat(duplicated).as("重复键必须保留先出现的值").containsExactly(Map.entry(1, "A"));
    }

    /**
     * 同时提供合并函数与供应器时按合并函数去重，空输入分支忽略供应器。
     *
     * <p>该重载的空输入分支固定返回 {@link HashMap} 而不调用供应器，与其它带供应器的重载不一致；
     * 调用方不能依赖空输入时拿到自定义 Map 类型。</p>
     */
    @Test
    void convertMapWithMergeFunctionAndSupplierUsesSuppliedMapForNonEmptyInput() {
        Map<Integer, Integer> converted = CollectionUtils.convertMap(List.of("a", "bb", "cc"), String::length,
                String::length, Integer::sum, () -> new TreeMap<Integer, Integer>());
        assertThat(converted).isInstanceOf(TreeMap.class)
                .containsExactly(Map.entry(1, 1), Map.entry(2, 4));

        Map<Integer, Integer> empty = CollectionUtils.convertMap(List.<String>of(), String::length,
                String::length, Integer::sum, () -> new TreeMap<Integer, Integer>());
        assertThat(empty).as("空输入分支返回 HashMap 而不调用供应器")
                .isInstanceOf(HashMap.class).isNotInstanceOf(TreeMap.class).isEmpty();
    }

    /**
     * 查首在空集合或无匹配时返回 null，命中时返回元素或其转换结果。
     */
    @Test
    void findFirstHandlesEmptyNoMatchAndMatch() {
        assertThat(CollectionUtils.<Integer>findFirst(List.of(1, 2), value -> value > 1)).isEqualTo(2);
        assertThat(CollectionUtils.<Integer>findFirst(List.of(1, 2), value -> value > 5)).isNull();
        assertThat(CollectionUtils.<Integer>findFirst(List.<Integer>of(), value -> true)).isNull();
        assertThat(CollectionUtils.<Integer>findFirst(null, value -> true)).isNull();

        assertThat(CollectionUtils.<Integer, Integer>findFirst(List.of(1, 2), value -> value > 1, value -> value * 10))
                .isEqualTo(20);
        assertThat(CollectionUtils.<Integer, Integer>findFirst(List.of(1, 2), value -> value > 5, value -> value * 10))
                .isNull();
        assertThat(CollectionUtils.<Integer, Integer>findFirst(List.<Integer>of(), value -> true, value -> value * 10))
                .isNull();
    }

    /**
     * 仅非空元素会被加入集合，空元素不得占用位置。
     */
    @Test
    void addIfNotNullSkipsNullElement() {
        List<String> target = new ArrayList<>();
        CollectionUtils.addIfNotNull(target, null);
        CollectionUtils.addIfNotNull(target, "a");

        assertThat(target).containsExactly("a");
    }

    /**
     * 单元素包装在对象为空时返回空集合。
     */
    @Test
    void singletonWrapsObjectOrReturnsEmptyCollection() {
        assertThat(CollectionUtils.singleton("a")).containsExactly("a");
        assertThat(CollectionUtils.singleton(null)).as("空对象必须返回空集合").isEmpty();
    }

    /**
     * 集合转 Set 的恒等转换保留原元素。
     */
    @Test
    void convertSetWithoutFunctionKeepsElements() {
        Set<String> converted = CollectionUtils.convertSet(List.of("a", "b", "a"));

        assertThat(converted).isInstanceOf(HashSet.class).containsExactlyInAnyOrder("a", "b");
    }

}
