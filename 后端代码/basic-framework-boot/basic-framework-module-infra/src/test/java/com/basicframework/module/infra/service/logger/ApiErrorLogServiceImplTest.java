package com.basicframework.module.infra.service.logger;

import com.basicframework.framework.common.biz.infra.logger.dto.ApiErrorLogCreateReqDTO;
import com.basicframework.module.infra.dal.dataobject.logger.ApiErrorLogDO;
import com.basicframework.module.infra.dal.mysql.logger.ApiErrorLogMapper;
import com.basicframework.module.infra.enums.logger.ApiErrorLogProcessStatusEnum;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * 验证 API 错误日志写入前的字段收敛与失败隔离。
 *
 * <p>错误日志承载原始请求参数，长度受 {@code infra_api_error_log.request_params} 列容量约束：
 * 超长内容若原样入库会被 MySQL 截断或直接写入失败，而错误日志本身的失败不能影响原接口流程。
 * 因此这里观察真正交给持久化层的对象，锁定截断口径与异常吞掉后的行为。</p>
 *
 * @author shady2713
 */
class ApiErrorLogServiceImplTest {

    /** 被测服务，持久化层按外部边界替换为可观察替身。 */
    private ApiErrorLogServiceImpl service;
    /** 记录写入参数的日志 Mapper 替身。 */
    private ApiErrorLogMapper apiErrorLogMapper;

    /** 为每个用例创建独立服务与持久化替身，避免用例之间共享调用记录。 */
    @BeforeEach
    void setUp() {
        service = new ApiErrorLogServiceImpl();
        apiErrorLogMapper = mock(ApiErrorLogMapper.class);
        ReflectionTestUtils.setField(service, "apiErrorLogMapper", apiErrorLogMapper);
    }

    /** 未超过列容量的请求参数原样入库，截断逻辑不得改动正常内容。 */
    @Test
    void shortRequestParamsAreStoredUnchanged() {
        String requestParams = "{\"pageNo\":1}";

        service.createApiErrorLog(createDTO(requestParams));

        ApiErrorLogDO stored = captureInserted();
        assertThat(stored.getRequestParams()).isEqualTo(requestParams);
        assertThat(stored.getProcessStatus()).isEqualTo(ApiErrorLogProcessStatusEnum.INIT.getStatus());
        assertThat(stored.getRequestUrl()).isEqualTo("/admin-api/probe");
    }

    /**
     * 超长请求参数截断到列容量并保留截断标记，避免数据库静默截断或写入失败。
     *
     * <p>断言真实长度等于 {@link ApiErrorLogDO#REQUEST_PARAMS_MAX_LENGTH}：截断后仍填满列容量，
     * 说明保留了尽可能多的诊断信息，同时以省略号明确标识内容不完整。</p>
     */
    @Test
    void oversizedRequestParamsAreTruncatedToColumnCapacity() {
        String oversized = "a".repeat(ApiErrorLogDO.REQUEST_PARAMS_MAX_LENGTH * 2);

        service.createApiErrorLog(createDTO(oversized));

        String stored = captureInserted().getRequestParams();
        assertThat(stored)
                .as("截断结果必须不超过列容量且明确标识被截断")
                .hasSize(ApiErrorLogDO.REQUEST_PARAMS_MAX_LENGTH)
                .endsWith("...");
        assertThat(stored).startsWith(oversized.substring(0, stored.length() - 3));
    }

    /**
     * 持久化失败不能向外传播，否则记录错误日志本身会覆盖原始业务异常。
     */
    @Test
    void persistenceFailureIsSwallowed() {
        doThrow(new IllegalStateException("模拟日志库不可用"))
                .when(apiErrorLogMapper).insert(any(ApiErrorLogDO.class));

        assertThatCode(() -> service.createApiErrorLog(createDTO("{\"a\":1}")))
                .as("错误日志写入失败必须被吞掉，让原接口继续按自身错误返回")
                .doesNotThrowAnyException();

        verify(apiErrorLogMapper).insert(any(ApiErrorLogDO.class));
    }

    /** 读取本用例中真正传给持久化层的实体。 */
    private ApiErrorLogDO captureInserted() {
        ArgumentCaptor<ApiErrorLogDO> captor = ArgumentCaptor.forClass(ApiErrorLogDO.class);
        verify(apiErrorLogMapper).insert(captor.capture());
        return captor.getValue();
    }

    /** 构造只包含本用例所需字段的错误日志创建请求。 */
    private static ApiErrorLogCreateReqDTO createDTO(String requestParams) {
        ApiErrorLogCreateReqDTO createDTO = new ApiErrorLogCreateReqDTO();
        createDTO.setTraceId("probe-trace-id");
        createDTO.setApplicationName("basic-framework-infra-test");
        createDTO.setRequestMethod("GET");
        createDTO.setRequestUrl("/admin-api/probe");
        createDTO.setRequestParams(requestParams);
        createDTO.setUserIp("127.0.0.1");
        createDTO.setUserAgent("probe-agent");
        createDTO.setExceptionTime(LocalDateTime.of(2026, 9, 30, 12, 34, 56));
        createDTO.setExceptionName("IllegalStateException");
        createDTO.setExceptionClassName("java.lang.IllegalStateException");
        createDTO.setExceptionFileName("Probe.java");
        createDTO.setExceptionMethodName("probe");
        createDTO.setExceptionLineNumber(1);
        createDTO.setExceptionMessage("probe");
        return createDTO;
    }
}
