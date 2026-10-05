package com.basicframework.framework.common.enums;

import cn.hutool.core.util.ObjUtil;
import com.basicframework.framework.common.core.ArrayValuable;
import lombok.AllArgsConstructor;
import lombok.Getter;

import java.util.Arrays;

/**
 * 通用状态枚举
 *
 * @author 李杰
 */
@Getter
@AllArgsConstructor
public enum CommonStatusEnum implements ArrayValuable<Integer> {

    /** 开启状态，状态值 0；启用中的部门、岗位、角色等记录使用该值。 */
    ENABLE(0, "开启"),
    /** 关闭状态，状态值 1；已停用但保留历史数据的记录使用该值。 */
    DISABLE(1, "关闭");

    public static final Integer[] ARRAYS = Arrays.stream(values()).map(CommonStatusEnum::getStatus).toArray(Integer[]::new);

    /**
     * 状态值
     */
    private final Integer status;
    /**
     * 状态名
     */
    private final String name;

    /**
     * 返回全部状态值，用于枚举范围校验。
     *
     * @return 状态值数组
     */
    @Override
    public Integer[] array() {
        return ARRAYS;
    }

    /**
     * 判断状态是否为启用。
     *
     * @param status 状态值
     * @return 是否启用
     */
    public static boolean isEnable(Integer status) {
        return ObjUtil.equal(ENABLE.status, status);
    }

    /**
     * 判断状态是否为禁用。
     *
     * @param status 状态值
     * @return 是否禁用
     */
    public static boolean isDisable(Integer status) {
        return ObjUtil.equal(DISABLE.status, status);
    }

}
