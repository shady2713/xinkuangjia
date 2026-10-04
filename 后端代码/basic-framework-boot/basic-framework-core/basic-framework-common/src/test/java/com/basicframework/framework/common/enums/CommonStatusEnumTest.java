package com.basicframework.framework.common.enums;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 锁定通用状态的稳定编码与“启用/禁用”判定口径。
 *
 * <p>状态编码会写进用户、角色、菜单等多张表的 {@code status} 字段，并被 {@code @InEnum}
 * 作为合法取值集合校验，因此编码与顺序不能随意调整。判定方法被账号启用检查、状态变更
 * 消息消费等路径调用，遇到未知状态或空值时必须判为“两者都不是”，不能默认放行成启用，
 * 否则被禁用的账号或配置会被当成可用。</p>
 *
 * @author shady2713
 */
class CommonStatusEnumTest {

    /** 状态编码、名称与枚举顺序必须是前端和数据库共同依赖的稳定契约。 */
    @Test
    void constantsCarryStableCodesAndNames() {
        assertThat(CommonStatusEnum.values())
                .as("枚举顺序与声明顺序一致")
                .containsExactly(CommonStatusEnum.ENABLE, CommonStatusEnum.DISABLE);
        assertThat(CommonStatusEnum.ENABLE.getStatus()).isEqualTo(0);
        assertThat(CommonStatusEnum.ENABLE.getName()).isEqualTo("开启");
        assertThat(CommonStatusEnum.DISABLE.getStatus()).isEqualTo(1);
        assertThat(CommonStatusEnum.DISABLE.getName()).isEqualTo("关闭");
    }

    /** 数组入口必须返回全部合法状态值，供枚举范围校验使用。 */
    @Test
    void arrayExposesAllValidStatusCodes() {
        assertThat(CommonStatusEnum.ENABLE.array()).containsExactly(0, 1);
        assertThat(CommonStatusEnum.DISABLE.array())
                .as("数组入口不随调用方枚举常量变化").containsExactly(0, 1);
        assertThat(CommonStatusEnum.ARRAYS).containsExactly(0, 1);
    }

    /** 启用判定只承认编码 0；未知状态、其它编码与空值都不得判为启用。 */
    @Test
    void isEnableOnlyAcceptsEnableCode() {
        assertThat(CommonStatusEnum.isEnable(0)).isTrue();
        assertThat(CommonStatusEnum.isEnable(1)).isFalse();
        assertThat(CommonStatusEnum.isEnable(null)).as("空状态不得当作启用").isFalse();
        assertThat(CommonStatusEnum.isEnable(2)).as("未知状态不得当作启用").isFalse();
        assertThat(CommonStatusEnum.isEnable(-1)).isFalse();
    }

    /** 禁用判定只承认编码 1；未知状态、其它编码与空值都不得判为禁用。 */
    @Test
    void isDisableOnlyAcceptsDisableCode() {
        assertThat(CommonStatusEnum.isDisable(1)).isTrue();
        assertThat(CommonStatusEnum.isDisable(0)).isFalse();
        assertThat(CommonStatusEnum.isDisable(null)).as("空状态不得当作禁用").isFalse();
        assertThat(CommonStatusEnum.isDisable(2)).as("未知状态不得当作禁用").isFalse();
        assertThat(CommonStatusEnum.isDisable(-1)).isFalse();
    }

    /** 同一状态值的启用与禁用判定必须互斥，不允许同时成立。 */
    @Test
    void enableAndDisableAreMutuallyExclusive() {
        for (Integer status : new Integer[]{null, -1, 0, 1, 2, Integer.MAX_VALUE}) {
            assertThat(CommonStatusEnum.isEnable(status) && CommonStatusEnum.isDisable(status))
                    .as("状态 %s 不能同时判为启用与禁用", status)
                    .isFalse();
        }
    }
}
