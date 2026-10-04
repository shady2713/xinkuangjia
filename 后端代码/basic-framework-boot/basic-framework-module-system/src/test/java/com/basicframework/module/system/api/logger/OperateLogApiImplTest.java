package com.basicframework.module.system.api.logger;

import com.basicframework.framework.common.biz.system.logger.dto.OperateLogCreateReqDTO;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.api.logger.dto.OperateLogPageReqDTO;
import com.basicframework.module.system.api.logger.dto.OperateLogRespDTO;
import com.basicframework.module.system.dal.dataobject.logger.OperateLogDO;
import com.basicframework.module.system.service.logger.OperateLogService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证操作日志跨模块 API 实现类的写入转发与分页转换契约。
 *
 * <p>写入入口必须把请求 DTO 原样交给下游（复制或改写会丢掉调用方补充的字段），
 * 失败必须原样传播，避免业务操作在日志写入失败时被静默当作成功。分页入口把
 * {@link PageResult} 的元素类型由持久化对象转换为跨模块 DTO，列表内容与总数都必须保留，
 * 总数丢失会让消费方的翻页控件失效。</p>
 *
 * @author shady2713
 */
class OperateLogApiImplTest {

    /** 操作日志产生的固定时间，用于验证时间字段真实映射。 */
    private static final LocalDateTime CREATE_TIME = LocalDateTime.of(2026, 1, 2, 3, 4, 5);

    /** 被测 API 实现。 */
    private OperateLogApiImpl operateLogApi;
    /** 下游操作日志服务替身，用于观察真实转发参数。 */
    private OperateLogService operateLogService;

    /** 为每个用例创建独立 API 与下游替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        operateLogApi = new OperateLogApiImpl();
        operateLogService = mock(OperateLogService.class);
        ReflectionTestUtils.setField(operateLogApi, "operateLogService", operateLogService);
    }

    /** 写入请求必须按同一引用原样转发，不得复制或裁剪字段。 */
    @Test
    void createOperateLogForwardsSameRequestObject() {
        OperateLogCreateReqDTO reqDTO = new OperateLogCreateReqDTO();
        reqDTO.setTraceId("synthetic-trace-id");

        operateLogApi.createOperateLog(reqDTO);

        verify(operateLogService).createOperateLog(reqDTO);
        verifyNoMoreInteractions(operateLogService);
    }

    /** 写入失败必须原样传播，避免调用方在日志未落库时当作成功。 */
    @Test
    void createOperateLogPropagatesFailureUnchanged() {
        OperateLogCreateReqDTO reqDTO = new OperateLogCreateReqDTO();
        IllegalStateException failure = new IllegalStateException("synthetic-log-write-failure");
        doThrow(failure).when(operateLogService).createOperateLog(reqDTO);

        assertThatThrownBy(() -> operateLogApi.createOperateLog(reqDTO)).isSameAs(failure);
    }

    /** 分页查询必须原样转发请求对象，并保留列表元素字段与总数。 */
    @Test
    void getOperateLogPageMapsElementsAndKeepsTotal() {
        OperateLogPageReqDTO reqDTO = new OperateLogPageReqDTO();
        reqDTO.setUserId(7L);
        when(operateLogService.getOperateLogPage(reqDTO)).thenReturn(new PageResult<>(List.of(
                operateLog(11L, "synthetic-trace-1", 7L),
                operateLog(12L, "synthetic-trace-2", 8L)), 42L));

        PageResult<OperateLogRespDTO> result = operateLogApi.getOperateLogPage(reqDTO);

        assertThat(result.getTotal()).as("总数必须原样保留，供调用方翻页").isEqualTo(42L);
        assertThat(result.getList()).hasSize(2);
        assertThat(result.getList().get(0).getId()).isEqualTo(11L);
        assertThat(result.getList().get(0).getTraceId()).isEqualTo("synthetic-trace-1");
        assertThat(result.getList().get(0).getUserId()).isEqualTo(7L);
        assertThat(result.getList().get(0).getCreateTime()).isEqualTo(CREATE_TIME);
        assertThat(result.getList().get(1).getId()).as("顺序必须与下游返回一致").isEqualTo(12L);
        assertThat(result.getList().get(1).getUserId()).isEqualTo(8L);

        verify(operateLogService).getOperateLogPage(reqDTO);
        verifyNoMoreInteractions(operateLogService);
    }

    /** 空页必须保留总数 0 并返回空列表，不得产生空指针。 */
    @Test
    void getOperateLogPageHandlesEmptyPage() {
        OperateLogPageReqDTO reqDTO = new OperateLogPageReqDTO();
        when(operateLogService.getOperateLogPage(reqDTO)).thenReturn(new PageResult<>(List.of(), 0L));

        PageResult<OperateLogRespDTO> result = operateLogApi.getOperateLogPage(reqDTO);

        assertThat(result.getTotal()).isZero();
        assertThat(result.getList()).isEmpty();

        verify(operateLogService).getOperateLogPage(reqDTO);
    }

    /**
     * 构造指定编号、链路标识与用户编号的操作日志持久化对象。
     *
     * @param id 日志编号
     * @param traceId 链路标识
     * @param userId 操作人编号
     * @return 操作日志持久化对象
     */
    private static OperateLogDO operateLog(Long id, String traceId, Long userId) {
        OperateLogDO operateLog = new OperateLogDO();
        operateLog.setId(id);
        operateLog.setTraceId(traceId);
        operateLog.setUserId(userId);
        operateLog.setUserType(2);
        operateLog.setType("1");
        operateLog.setRequestMethod("POST");
        operateLog.setRequestUrl("/admin-api/system/user/create");
        operateLog.setUserIp("127.0.0.1");
        operateLog.setUserAgent("synthetic-agent");
        operateLog.setCreateTime(CREATE_TIME);
        return operateLog;
    }
}
