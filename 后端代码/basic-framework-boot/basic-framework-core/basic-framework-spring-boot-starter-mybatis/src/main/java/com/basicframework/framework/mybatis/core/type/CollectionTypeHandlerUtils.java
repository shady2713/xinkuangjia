package com.basicframework.framework.mybatis.core.type;

import cn.hutool.core.util.StrUtil;

import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * MyBatis 集合类型处理器的分隔文本解析工具。
 *
 * @author 李杰
 */
final class CollectionTypeHandlerUtils {

    /**
     * 工具类不允许实例化。
     */
    private CollectionTypeHandlerUtils() {
    }

    /**
     * 将分隔文本解析为保持原始顺序的长整数列表。
     *
     * @param value 待解析文本
     * @param separator 分隔符
     * @return 长整数列表
     */
    static List<Long> parseLongList(String value, CharSequence separator) {
        return Arrays.stream(StrUtil.splitToLong(value, separator)).boxed().collect(Collectors.toList());
    }

    /**
     * 将分隔文本解析为去重的长整数集合。
     *
     * @param value 待解析文本
     * @param separator 分隔符
     * @return 长整数集合
     */
    static Set<Long> parseLongSet(String value, CharSequence separator) {
        return Arrays.stream(StrUtil.splitToLong(value, separator)).boxed().collect(Collectors.toSet());
    }

    /**
     * 将分隔文本解析为保持原始顺序的整数列表。
     *
     * @param value 待解析文本
     * @param separator 分隔符
     * @return 整数列表
     */
    static List<Integer> parseIntegerList(String value, CharSequence separator) {
        return Arrays.stream(StrUtil.splitToInt(value, separator)).boxed().collect(Collectors.toList());
    }

}
