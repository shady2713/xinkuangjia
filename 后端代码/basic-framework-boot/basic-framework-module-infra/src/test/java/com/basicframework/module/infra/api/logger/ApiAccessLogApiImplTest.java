package com.basicframework.module.infra.api.logger;

import com.basicframework.framework.common.biz.infra.logger.dto.ApiAccessLogCreateReqDTO;
import com.basicframework.module.infra.service.logger.ApiAccessLogService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;

/**
 * 验证 API 访问日志跨模块 API 的落库转发契约。
 *
 * <p>访问日志由公共层异步调用，调用方不关心返回值，因此必须锁定：日志请求对象原样传给
 * 访问日志服务（改写字段会让落库记录与真实请求不一致）、服务失败原样传播
 * （异步执行器需要拿到异常才能记录写入失败，吞掉会静默丢日志）。</p>
 *
 * @author shady2713
 */
class ApiAccessLogApiImplTest {

    /** 被测 API 实现。 */
    private ApiAccessLogApiImpl api;
    /** 下游访问日志服务替身，用于观察真实转发参数。 */
    private ApiAccessLogService apiAccessLogService;

    /** 为每个用例创建独立 API 与下游替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        api = new ApiAccessLogApiImpl();
        apiAccessLogService = mock(ApiAccessLogService.class);
        ReflectionTestUtils.setField(api, "apiAccessLogService", apiAccessLogService);
    }

    /** 日志请求必须原样转发，不得复制或补写字段。 */
    @Test
    void createApiAccessLogDelegatesSameInstance() {
        ApiAccessLogCreateReqDTO createDTO = new ApiAccessLogCreateReqDTO();
        createDTO.setTraceId("trace-delegate");

        api.createApiAccessLog(createDTO);

        verify(apiAccessLogService).createApiAccessLog(createDTO);
        verifyNoMoreInteractions(apiAccessLogService);
    }

    /** 落库失败必须原样传播，避免访问日志静默丢失。 */
    @Test
    void serviceFailurePropagatesUnchanged() {
        ApiAccessLogCreateReqDTO createDTO = new ApiAccessLogCreateReqDTO();
        IllegalStateException failure = new IllegalStateException("synthetic-access-log-failure");
        doThrow(failure).when(apiAccessLogService).createApiAccessLog(createDTO);

        assertThatThrownBy(() -> api.createApiAccessLog(createDTO)).isSameAs(failure);
    }

}
