package com.basicframework.framework.ip.core.enums;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 锁定 IP 区域层级的稳定编码与数组入口。
 *
 * <p>区域类型编码写入 IP 库解析结果与前端级联选择的数据结构，国家/省份/城市/地区分别对应
 * 1/2/3/4，改变编码会让既有统计与级联展示错位。数组入口用于枚举范围校验，必须与枚举声明
 * 始终一致，且不随调用方持有的常量变化。</p>
 *
 * @author shady2713
 */
class AreaTypeEnumTest {

    /** 国家到地区的编码、名称与层级顺序必须稳定。 */
    @Test
    void constantsCarryStableLevelCodes() {
        assertThat(AreaTypeEnum.values()).containsExactly(AreaTypeEnum.COUNTRY, AreaTypeEnum.PROVINCE,
                AreaTypeEnum.CITY, AreaTypeEnum.DISTRICT);
        assertThat(AreaTypeEnum.COUNTRY.getType()).isEqualTo(1);
        assertThat(AreaTypeEnum.COUNTRY.getName()).isEqualTo("国家");
        assertThat(AreaTypeEnum.PROVINCE.getType()).isEqualTo(2);
        assertThat(AreaTypeEnum.PROVINCE.getName()).isEqualTo("省份");
        assertThat(AreaTypeEnum.CITY.getType()).isEqualTo(3);
        assertThat(AreaTypeEnum.CITY.getName()).isEqualTo("城市");
        assertThat(AreaTypeEnum.DISTRICT.getType()).isEqualTo(4);
        assertThat(AreaTypeEnum.DISTRICT.getName()).as("地区涵盖县、镇、区等下级行政区划")
                .isEqualTo("地区");
    }

    /** 数组入口必须返回全部合法区域类型值，供枚举范围校验使用。 */
    @Test
    void arrayExposesAllValidLevelCodes() {
        assertThat(AreaTypeEnum.COUNTRY.array()).containsExactly(1, 2, 3, 4);
        assertThat(AreaTypeEnum.DISTRICT.array())
                .as("数组入口不随调用方枚举常量变化").containsExactly(1, 2, 3, 4);
        assertThat(AreaTypeEnum.ARRAYS).containsExactly(1, 2, 3, 4);
    }
}
