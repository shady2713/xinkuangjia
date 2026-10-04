package com.basicframework.framework.common.enums;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 锁定终端编码的稳定取值与“无法解析时回退未知”的口径。
 *
 * <p>终端编码由访问日志、登录日志与令牌签发入口写入数据库，各端上报的编码一旦变化，
 * 历史统计与前端筛选会失真。{@link TerminalEnum#UNKNOWN} 专门用于请求头缺失或取值无法
 * 识别的情况，必须保持编码 0 且不得被当作具体端处理。</p>
 *
 * @author shady2713
 */
class TerminalEnumTest {

    /** 各端编码必须与声明保持一致，未知项固定为 0 作为兜底值。 */
    @Test
    void constantsCarryStableTerminalCodes() {
        assertThat(TerminalEnum.values()).containsExactly(TerminalEnum.UNKNOWN,
                TerminalEnum.WECHAT_MINI_PROGRAM, TerminalEnum.WECHAT_WAP, TerminalEnum.H5, TerminalEnum.APP);
        assertThat(TerminalEnum.UNKNOWN.getTerminal()).as("未知端必须固定为兜底编码 0").isEqualTo(0);
        assertThat(TerminalEnum.UNKNOWN.getName()).isEqualTo("未知");
        assertThat(TerminalEnum.WECHAT_MINI_PROGRAM.getTerminal()).isEqualTo(10);
        assertThat(TerminalEnum.WECHAT_MINI_PROGRAM.getName()).isEqualTo("微信小程序");
        assertThat(TerminalEnum.WECHAT_WAP.getTerminal()).isEqualTo(11);
        assertThat(TerminalEnum.H5.getTerminal()).isEqualTo(20);
        assertThat(TerminalEnum.APP.getTerminal()).isEqualTo(31);
        assertThat(TerminalEnum.APP.getName()).isEqualTo("手机 App");
    }

    /** 数组入口必须返回全部合法终端值，供枚举范围校验使用。 */
    @Test
    void arrayExposesAllValidTerminalCodes() {
        assertThat(TerminalEnum.UNKNOWN.array()).containsExactly(0, 10, 11, 20, 31);
        assertThat(TerminalEnum.APP.array())
                .as("数组入口不随调用方枚举常量变化").containsExactly(0, 10, 11, 20, 31);
        assertThat(TerminalEnum.ARRAYS).containsExactly(0, 10, 11, 20, 31);
    }
}
