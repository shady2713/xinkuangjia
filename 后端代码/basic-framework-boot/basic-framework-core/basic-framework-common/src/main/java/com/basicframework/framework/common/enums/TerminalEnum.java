package com.basicframework.framework.common.enums;

import com.basicframework.framework.common.core.ArrayValuable;
import lombok.Getter;
import lombok.RequiredArgsConstructor;

import java.util.Arrays;

/**
 * 终端的枚举
 *
 * @author 李杰
 */
@RequiredArgsConstructor
@Getter
public enum TerminalEnum implements ArrayValuable<Integer> {

    /** 未知终端，编码 0；请求头缺失或取值无法解析时的兜底值，统计与筛选依赖它避免落空。 */
    UNKNOWN(0, "未知"),
    /** 微信小程序端，编码 10。 */
    WECHAT_MINI_PROGRAM(10, "微信小程序"),
    /** 微信公众号网页端，编码 11。 */
    WECHAT_WAP(11, "微信公众号"),
    /** H5 网页端，编码 20；手机浏览器直接访问的页面。 */
    H5(20, "H5 网页"),
    /** 手机 App 端，编码 31。 */
    APP(31, "手机 App"),
    ;

    public static final Integer[] ARRAYS = Arrays.stream(values()).map(TerminalEnum::getTerminal).toArray(Integer[]::new);

    /**
     * 终端
     */
    private final Integer terminal;
    /**
     * 终端名
     */
    private final String name;

    /**
     * 返回全部终端值，用于枚举范围校验。
     *
     * @return 终端值数组
     */
    @Override
    public Integer[] array() {
        return ARRAYS;
    }
}
