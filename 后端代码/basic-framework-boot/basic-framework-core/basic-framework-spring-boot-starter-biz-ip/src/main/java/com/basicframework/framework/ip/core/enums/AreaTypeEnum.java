package com.basicframework.framework.ip.core.enums;

import com.basicframework.framework.common.core.ArrayValuable;
import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.Arrays;

/**
 * 区域类型枚举
 *
 * @author 李杰
 */
@AllArgsConstructor
@Getter
public enum AreaTypeEnum implements ArrayValuable<Integer> {

    /** 国家，编码 1；区域树的最上层，向上不再有父节点。 */
    COUNTRY(1, "国家"),
    /** 省份，编码 2；父节点为国家。 */
    PROVINCE(2, "省份"),
    /** 城市，编码 3；父节点为省份。 */
    CITY(3, "城市"),
    /** 地区，编码 4；父节点为城市，涵盖县、镇、区等最细一级。 */
    DISTRICT(4, "地区"),
    ;

    public static final Integer[] ARRAYS = Arrays.stream(values()).map(AreaTypeEnum::getType).toArray(Integer[]::new);

    /**
     * 类型
     */
    private final Integer type;
    /**
     * 名字
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
}
