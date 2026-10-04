package com.basicframework.framework.quartz.core.enums;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证 Quartz JobDataMap 键名枚举的取值契约。
 *
 * <p>枚举常量名会被 {@code name()} 直接当作 JobDataMap 的键写入 Quartz 任务数据，
 * 调度端（{@code SchedulerManager}）与执行端（{@code JobHandlerInvoker}）各自按同一键读取。
 * 常量名一旦被重命名，写入与读取会静默错位：任务仍能触发，但任务编号、处理器名和重试参数
 * 全部取到默认值，故障只在运行期暴露。因此这里锁定每个常量的实际键名与整体集合。</p>
 *
 * @author shady2713
 */
class JobDataKeyEnumTest {

    /** 枚举必须完整覆盖调度与执行双方约定的五个键，缺失会让对应参数静默丢失。 */
    @Test
    void declaresEveryJobDataKeyUsedBySchedulerAndInvoker() {
        List<String> names = Arrays.stream(JobDataKeyEnum.values()).map(Enum::name).toList();

        assertThat(names).containsExactly("JOB_ID", "JOB_HANDLER_NAME", "JOB_HANDLER_PARAM",
                "JOB_RETRY_COUNT", "JOB_RETRY_INTERVAL");
    }

    /**
     * 每个常量名必须与 Quartz JobDataMap 中使用的字面键名完全一致。
     *
     * <p>这里断言的是字符串字面量而不是 {@code name()} 自身，重命名常量会让本用例失败，
     * 从而避免写入端与读取端同时被改名后仍“自洽”却与历史任务数据不兼容。</p>
     */
    @Test
    void nameMatchesJobDataMapKeyLiteral() {
        assertThat(JobDataKeyEnum.JOB_ID.name()).isEqualTo("JOB_ID");
        assertThat(JobDataKeyEnum.JOB_HANDLER_NAME.name()).isEqualTo("JOB_HANDLER_NAME");
        assertThat(JobDataKeyEnum.JOB_HANDLER_PARAM.name()).isEqualTo("JOB_HANDLER_PARAM");
        assertThat(JobDataKeyEnum.JOB_RETRY_COUNT.name()).isEqualTo("JOB_RETRY_COUNT");
        assertThat(JobDataKeyEnum.JOB_RETRY_INTERVAL.name()).isEqualTo("JOB_RETRY_INTERVAL");
    }

    /** 键名必须可按字面量反查回常量，供执行端从持久化数据恢复键对象。 */
    @Test
    void valueOfResolvesDeclaredKeys() {
        assertThat(JobDataKeyEnum.valueOf("JOB_ID")).isSameAs(JobDataKeyEnum.JOB_ID);
        assertThat(JobDataKeyEnum.valueOf("JOB_RETRY_INTERVAL")).isSameAs(JobDataKeyEnum.JOB_RETRY_INTERVAL);
        assertThatThrownBy(() -> JobDataKeyEnum.valueOf("job_id"))
                .as("键名区分大小写，小写拼写必须显式失败而不是静默落到默认值")
                .isInstanceOf(IllegalArgumentException.class);
    }
}
