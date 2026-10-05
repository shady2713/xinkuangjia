package com.basicframework.framework.common.enums;

import cn.hutool.core.util.ArrayUtil;
import com.basicframework.framework.common.core.ArrayValuable;
import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.Arrays;

/**
 * 时间间隔的枚举
 *
 * @author 李杰
 */
@Getter
@AllArgsConstructor
public enum DateIntervalEnum implements ArrayValuable<Integer> {

    /** 小时间隔，编码 0；字典暂不提供该粒度，仅在明确需要小时的场景直接引用。 */
    HOUR(0, "小时"),
    /** 天间隔，编码 1。 */
    DAY(1, "天"),
    /** 周间隔，编码 2。 */
    WEEK(2, "周"),
    /** 月间隔，编码 3。 */
    MONTH(3, "月"),
    /** 季度间隔，编码 4。 */
    QUARTER(4, "季度"),
    /** 年间隔，编码 5。 */
    YEAR(5, "年")
    ;

    public static final Integer[] ARRAYS = Arrays.stream(values()).map(DateIntervalEnum::getInterval).toArray(Integer[]::new);

    /**
     * 类型
     */
    private final Integer interval;
    /**
     * 名称
     */
    private final String name;

    /**
     * 将输入值规范化为数组形式。
     *
     * @return 当前查询包装器
     */
    @Override
    public Integer[] array() {
        return ARRAYS;
    }

    /**
     * 根据输入值获取对应的枚举或类型对象。
     *
     * @param interval 时间间隔
     * @return 方法处理结果
     */
    public static DateIntervalEnum valueOf(Integer interval) {
        return ArrayUtil.firstMatch(item -> item.getInterval().equals(interval), values());
    }

}
