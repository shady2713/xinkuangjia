package com.basicframework.module.infra.api.logger;

import com.basicframework.framework.common.biz.infra.logger.dto.ApiErrorLogCreateReqDTO;
import com.basicframework.module.infra.service.logger.ApiErrorLogService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;

/**
 * 验证 API 错误日志跨模块 API 的落库转发契约。
 *
 * <p>错误日志是线上排障的主要依据，因此必须锁定：异常请求对象原样传给错误日志服务
 * （改写堆栈或异常类型会让排障信息失真）、服务失败原样传播而不是静默吞掉。</p>
 *
 * @author shady2713
 */
class ApiErrorLogApiImplTest {

    /** 被测 API 实现。 */
    private ApiErrorLogApiImpl api;
    /** 下游错误日志服务替身，用于观察真实转发参数。 */
    private ApiErrorLogService apiErrorLogService;

    /** 为每个用例创建独立 API 与下游替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        api = new ApiErrorLogApiImpl();
        apiErrorLogService = mock(ApiErrorLogService.class);
        ReflectionTestUtils.setField(api, "apiErrorLogService", apiErrorLogService);
    }

    /** 异常日志请求必须原样转发，不得复制或裁剪字段。 */
    @Test
    void createApiErrorLogDelegatesSameInstance() {
        ApiErrorLogCreateReqDTO createDTO = new ApiErrorLogCreateReqDTO();
        createDTO.setTraceId("trace-error-delegate");
        createDTO.setExceptionName("java.lang.IllegalStateException");

        api.createApiErrorLog(createDTO);

        verify(apiErrorLogService).createApiErrorLog(createDTO);
        verifyNoMoreInteractions(apiErrorLogService);
    }

    /** 落库失败必须原样传播，避免错误日志静默丢失。 */
    @Test
    void serviceFailurePropagatesUnchanged() {
        ApiErrorLogCreateReqDTO createDTO = new ApiErrorLogCreateReqDTO();
        IllegalStateException failure = new IllegalStateException("synthetic-error-log-failure");
        doThrow(failure).when(apiErrorLogService).createApiErrorLog(createDTO);

        assertThatThrownBy(() -> api.createApiErrorLog(createDTO)).isSameAs(failure);
    }

}
