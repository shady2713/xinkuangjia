package com.basicframework.module.system.enums.common;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证性别枚举的稳定编码。
 *
 * <p>性别编码会写入用户表并参与导出与展示，编码漂移会让历史数据被解读成另一种性别，
 * 因此这里锁定每个枚举常量对应的持久化取值。</p>
 *
 * @author shady2713
 */
class SexEnumTest {

    /** 三个性别编码必须与数据库既有取值一致，且互不相同。 */
    @Test
    void sexCodesAreStableAndDistinct() {
        assertThat(SexEnum.MALE.getSex()).isEqualTo(1);
        assertThat(SexEnum.FEMALE.getSex()).isEqualTo(2);
        assertThat(SexEnum.UNKNOWN.getSex()).as("未知必须是 0，不能占用 1 或 2").isEqualTo(0);

        assertThat(SexEnum.values()).extracting(SexEnum::getSex).doesNotHaveDuplicates();
    }

}
