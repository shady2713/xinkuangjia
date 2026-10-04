package com.basicframework.framework.quartz.core.util;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证 Cron 表达式工具类的合法性与后续触发时间计算契约。
 *
 * <p>该工具同时服务任务保存前的校验和“下次执行时间”预览，因此两类行为都必须真实：
 * 非法表达式要能提前判为无效，合法表达式要按 Quartz 口径给出连续且递增的触发时间。
 * 时间预览还会遇到“表达式已无未来触发点”（例如只指定了过去年份）的边界，
 * 此时必须返回较少的条数而不是空指针，也不能把 {@code null} 塞进结果列表。
 * 解析失败统一转成 {@link IllegalArgumentException}，让接口层按参数错误返回。</p>
 *
 * @author shady2713
 */
class CronUtilsTest {

    /**
     * 合法表达式放行，语法错误判为无效；空值按 Quartz 的真实行为抛出参数异常。
     *
     * <p>该工具直接委托 {@code CronExpression.isValidExpression}，后者对 null 会抛
     * {@code IllegalArgumentException("cronExpression cannot be null")} 而不是返回 false。
     * 这里如实锁定该边界：调用方必须自行判空，不能假设“无效表达式一律得到 false”。</p>
     */
    @Test
    void isValidAcceptsQuartzSyntaxAndRejectsMalformedExpression() {
        assertThat(CronUtils.isValid("0 0 0 * * ?")).isTrue();
        assertThat(CronUtils.isValid("0/5 * * * * ?")).isTrue();
        assertThat(CronUtils.isValid("0 0 0 1 1 ? 2030")).isTrue();
        assertThat(CronUtils.isValid("not-a-cron")).isFalse();
        assertThat(CronUtils.isValid("")).isFalse();
        assertThatThrownBy(() -> CronUtils.isValid(null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("cannot be null");
    }

    /** 每日零点表达式返回连续三天的触发时间，均为零点且严格递增。 */
    @Test
    void getNextTimesReturnsConsecutiveTriggerTimes() {
        List<LocalDateTime> nextTimes = CronUtils.getNextTimes("0 0 0 * * ?", 3);

        assertThat(nextTimes).hasSize(3);
        assertThat(nextTimes).allSatisfy(time -> assertThat(time.toLocalTime()).isEqualTo(LocalTime.MIDNIGHT));
        assertThat(nextTimes.get(0)).as("首个触发时间必须在当前时间之后").isAfter(LocalDateTime.now());
        assertThat(nextTimes.get(1)).isEqualTo(nextTimes.get(0).plusDays(1));
        assertThat(nextTimes.get(2)).isEqualTo(nextTimes.get(1).plusDays(1));
    }

    /** 表达式已无未来触发点时返回空列表，不得塞入 null 或抛异常。 */
    @Test
    void getNextTimesStopsWhenExpressionHasNoFutureTrigger() {
        assertThat(CronUtils.getNextTimes("0 0 0 1 1 ? 2020", 3)).isEmpty();
    }

    /** 请求 0 个触发时间时返回空列表，循环不执行。 */
    @Test
    void getNextTimesWithZeroCountReturnsEmptyList() {
        assertThat(CronUtils.getNextTimes("0 0 0 * * ?", 0)).isEmpty();
    }

    /** 非法表达式转成带原始解析提示的 IllegalArgumentException。 */
    @Test
    void getNextTimesRejectsMalformedExpression() {
        assertThatThrownBy(() -> CronUtils.getNextTimes("not-a-cron", 1))
                .isInstanceOf(IllegalArgumentException.class)
                .satisfies(thrown -> assertThat(thrown.getMessage()).as("必须保留底层解析提示")
                        .isNotBlank());
    }

}
