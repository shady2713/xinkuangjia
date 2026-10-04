package com.basicframework.framework.common.enums;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证时间间隔枚举的编码、名称与按编码反查的真实契约。
 *
 * <p>该枚举的 {@code interval} 会写进报表查询参数并参与分组，编码一旦漂移，
 * 历史统计口径就会与展示口径错位，因此这里逐个锁定编码与名称的对应关系，
 * 而不是只断言枚举个数。</p>
 *
 * <p>{@link DateIntervalEnum#valueOf(Integer)} 是入参规范化入口：非法编码必须
 * 返回 {@code null} 交由调用方决定拒绝方式，不能静默回退成某个默认间隔，
 * 否则前端传错值会被当成“按天统计”而产生错误报表。</p>
 *
 * @author shady2713
 */
class DateIntervalEnumTest {

    /** 枚举常量必须保持既有的间隔编码与中文名称，顺序即展示顺序。 */
    @Test
    void enumConstantsKeepDocumentedIntervalAndName() {
        assertThat(DateIntervalEnum.HOUR.getInterval()).isEqualTo(0);
        assertThat(DateIntervalEnum.HOUR.getName()).isEqualTo("小时");
        assertThat(DateIntervalEnum.DAY.getInterval()).isEqualTo(1);
        assertThat(DateIntervalEnum.DAY.getName()).isEqualTo("天");
        assertThat(DateIntervalEnum.WEEK.getInterval()).isEqualTo(2);
        assertThat(DateIntervalEnum.WEEK.getName()).isEqualTo("周");
        assertThat(DateIntervalEnum.MONTH.getInterval()).isEqualTo(3);
        assertThat(DateIntervalEnum.MONTH.getName()).isEqualTo("月");
        assertThat(DateIntervalEnum.QUARTER.getInterval()).isEqualTo(4);
        assertThat(DateIntervalEnum.QUARTER.getName()).isEqualTo("季度");
        assertThat(DateIntervalEnum.YEAR.getInterval()).isEqualTo(5);
        assertThat(DateIntervalEnum.YEAR.getName()).isEqualTo("年");
    }

    /** 取值范围数组按声明顺序暴露全部间隔编码，供 {@code @InEnum} 校验使用。 */
    @Test
    void arraysExposeAllIntervalsInDeclarationOrder() {
        assertThat(DateIntervalEnum.ARRAYS).containsExactly(0, 1, 2, 3, 4, 5);
        assertThat(DateIntervalEnum.DAY.array()).as("实例入口与静态常量必须是同一份取值范围")
                .isSameAs(DateIntervalEnum.ARRAYS);
    }

    /** 按编码反查命中对应枚举；未知编码与空值都返回 null，不回退默认值。 */
    @Test
    void valueOfMatchesByIntervalAndReturnsNullWhenAbsent() {
        assertThat(DateIntervalEnum.valueOf(0)).isEqualTo(DateIntervalEnum.HOUR);
        assertThat(DateIntervalEnum.valueOf(5)).isEqualTo(DateIntervalEnum.YEAR);
        assertThat(DateIntervalEnum.valueOf(6)).as("未登记的编码不得匹配任何枚举").isNull();
        assertThat(DateIntervalEnum.valueOf((Integer) null)).as("空编码不得匹配任何枚举").isNull();
    }

}
