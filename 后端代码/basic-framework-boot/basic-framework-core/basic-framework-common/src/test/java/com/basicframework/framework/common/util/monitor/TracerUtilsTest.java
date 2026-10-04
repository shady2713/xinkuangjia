package com.basicframework.framework.common.util.monitor;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证链路追踪编号读取工具在未接入链路代理时的返回值契约。
 *
 * <p>该工具被各 Starter 的日志与审计路径直接调用，返回值会被拼进日志前缀。
 * 契约要求取不到链路时返回空字符串而不是 {@code null}，否则调用方需要额外判空，
 * 一旦遗漏就会在记录日志时抛出空指针、掩盖真正的业务异常。</p>
 *
 * @author shady2713
 */
class TracerUtilsTest {

    /** 测试进程未挂载 SkyWalking 代理，必须命中“返回空字符串”的兜底语义。 */
    @Test
    void traceIdWithoutAgentIsEmptyString() {
        String traceId = TracerUtils.getTraceId();

        assertThat(traceId)
                .as("取不到链路编号时必须返回空字符串，而不是 null")
                .isNotNull()
                .isEmpty();
    }
}
