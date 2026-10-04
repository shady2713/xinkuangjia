package com.basicframework.module.system.service.sms;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.CALLS_REAL_METHODS;
import static org.mockito.Mockito.mock;

/**
 * 验证 {@link SmsSendService} 批量发送默认实现的失败语义。
 *
 * <p>默认实现不支持批量发送。它必须显式失败而不是静默返回：静默返回会让调用方误以为短信
 * 已经发出，运维与业务都看不到任何发送记录；抛出异常能让调用方按“能力未实现”处理。</p>
 *
 * @author shady2713
 */
class SmsSendServiceTest {

    /** 被测服务：默认方法调用真实实现，抽象方法由替身补齐。 */
    private final SmsSendService service = mock(SmsSendService.class, CALLS_REAL_METHODS);

    /** 未覆写默认实现时，批量发送必须抛出“不支持”异常并保留可辨识的提示。 */
    @Test
    void sendBatchSmsFailsExplicitlyByDefault() {
        assertThatThrownBy(() -> service.sendBatchSms(
                List.of("13800000000", "13900000000"), List.of(1L, 2L), 2,
                "admin-sms-login", Map.of("code", "123456")))
                .isInstanceOf(UnsupportedOperationException.class)
                .hasMessageContaining("暂时不支持该操作");
    }

}
