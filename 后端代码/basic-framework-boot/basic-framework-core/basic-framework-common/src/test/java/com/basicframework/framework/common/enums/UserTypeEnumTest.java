package com.basicframework.framework.common.enums;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 锁定全局用户类型编码与按值查找的容错口径。
 *
 * <p>用户类型决定令牌进入管理端还是会话端，编码 1/2 分别代表会员与管理员，属跨模块稳定
 * 契约。按值查找服务于请求参数与 MQ 消息中的原始编码，取值缺失、越界或为空时只能返回
 * {@code null} 由调用方决定处理方式，不能抛异常或误判为管理员。</p>
 *
 * @author shady2713
 */
class UserTypeEnumTest {

    /** 会员与管理员编码、名称及顺序必须稳定。 */
    @Test
    void constantsCarryStableUserTypeCodes() {
        assertThat(UserTypeEnum.values()).containsExactly(UserTypeEnum.MEMBER, UserTypeEnum.ADMIN);
        assertThat(UserTypeEnum.MEMBER.getValue()).isEqualTo(1);
        assertThat(UserTypeEnum.MEMBER.getName()).isEqualTo("会员");
        assertThat(UserTypeEnum.ADMIN.getValue()).isEqualTo(2);
        assertThat(UserTypeEnum.ADMIN.getName()).isEqualTo("管理员");
    }

    /** 按值查找必须命中真实常量，未知编码统一返回 null。 */
    @Test
    void valueOfMatchesKnownCodesOnly() {
        // 用 Integer 变量承载空值，模拟请求参数或消息字段缺失时的真实调用形态。
        Integer absentValue = null;

        assertThat(UserTypeEnum.valueOf(1)).isSameAs(UserTypeEnum.MEMBER);
        assertThat(UserTypeEnum.valueOf(2)).isSameAs(UserTypeEnum.ADMIN);
        assertThat(UserTypeEnum.valueOf(0)).as("0 不是合法用户类型").isNull();
        assertThat(UserTypeEnum.valueOf(3)).as("越界编码不得误判").isNull();
        assertThat(UserTypeEnum.valueOf(-1)).isNull();
        assertThat(UserTypeEnum.valueOf(absentValue)).as("空值不得抛出异常").isNull();
    }

    /** 数组入口必须返回全部合法用户类型值，供枚举范围校验使用。 */
    @Test
    void arrayExposesAllValidUserTypeCodes() {
        assertThat(UserTypeEnum.MEMBER.array()).containsExactly(1, 2);
        assertThat(UserTypeEnum.ADMIN.array())
                .as("数组入口不随调用方枚举常量变化").containsExactly(1, 2);
        assertThat(UserTypeEnum.ARRAYS).containsExactly(1, 2);
    }
}
