package com.basicframework.module.infra.service.logger;

import com.basicframework.framework.common.biz.infra.logger.dto.ApiAccessLogCreateReqDTO;
import com.basicframework.module.infra.dal.dataobject.logger.ApiAccessLogDO;
import com.basicframework.module.infra.dal.mysql.logger.ApiAccessLogMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证访问日志落库前的字段转换与截断、以及过期日志分批清理的真实契约。
 *
 * <p>请求参数与结果信息来自外部请求，长度不可控：超过数据库列长度会让整条日志插入失败，
 * 进而丢掉审计记录，因此必须按列上限截断并保留省略号提示内容被裁剪。清理入口按“过期时间 +
 * 单批上限”循环删除，必须持续到某一批不足上限为止：提前退出会留下过期数据，
 * 不退出则会在删除数恰好等于上限时死循环，因此两处边界都要锁定。</p>
 *
 * @author shady2713
 */
class ApiAccessLogServiceImplTest {

    /** 请求参数字段允许的最大长度，与生产常量一致。 */
    private static final int REQUEST_PARAMS_MAX_LENGTH = 8000;
    /** 结果信息字段允许的最大长度，与生产常量一致。 */
    private static final int RESULT_MSG_MAX_LENGTH = 512;

    /** 被测服务。 */
    private final ApiAccessLogServiceImpl service = new ApiAccessLogServiceImpl();

    /** 访问日志 Mapper 替身。 */
    private final ApiAccessLogMapper apiAccessLogMapper = mock(ApiAccessLogMapper.class);

    /** 短内容原样落库，字段转换保留关键信息。 */
    @Test
    void createApiAccessLogKeepsShortFieldsAndMapsAllColumns() {
        injectDependencies();
        ApiAccessLogCreateReqDTO createDTO = new ApiAccessLogCreateReqDTO();
        createDTO.setTraceId("DUMMY-TRACE-ID");
        createDTO.setUserId(7L);
        createDTO.setRequestUrl("/admin-api/system/user/get");
        createDTO.setRequestParams("{\"id\":1}");
        createDTO.setResultMsg("成功");
        createDTO.setDuration(12);

        service.createApiAccessLog(createDTO);

        ArgumentCaptor<ApiAccessLogDO> captor = ArgumentCaptor.forClass(ApiAccessLogDO.class);
        verify(apiAccessLogMapper).insert(captor.capture());
        ApiAccessLogDO inserted = captor.getValue();
        assertThat(inserted.getTraceId()).isEqualTo("DUMMY-TRACE-ID");
        assertThat(inserted.getUserId()).isEqualTo(7L);
        assertThat(inserted.getRequestUrl()).isEqualTo("/admin-api/system/user/get");
        assertThat(inserted.getRequestParams()).isEqualTo("{\"id\":1}");
        assertThat(inserted.getResultMsg()).isEqualTo("成功");
        assertThat(inserted.getDuration()).isEqualTo(12);
    }

    /**
     * 超长请求参数与结果信息必须按列上限截断并保留省略号，避免整条日志插入失败。
     *
     * <p>截断长度为“列上限减 3”，省略号补足后正好等于列上限，既不超列也不会留下零头空间。</p>
     */
    @Test
    void createApiAccessLogTruncatesOversizedFields() {
        injectDependencies();
        ApiAccessLogCreateReqDTO createDTO = new ApiAccessLogCreateReqDTO();
        createDTO.setRequestParams("a".repeat(REQUEST_PARAMS_MAX_LENGTH));
        createDTO.setResultMsg("b".repeat(RESULT_MSG_MAX_LENGTH));

        service.createApiAccessLog(createDTO);

        ArgumentCaptor<ApiAccessLogDO> captor = ArgumentCaptor.forClass(ApiAccessLogDO.class);
        verify(apiAccessLogMapper).insert(captor.capture());
        String params = captor.getValue().getRequestParams();
        String resultMsg = captor.getValue().getResultMsg();
        assertThat(params).as("截断结果必须正好落在列上限内").hasSize(REQUEST_PARAMS_MAX_LENGTH);
        assertThat(params).as("截断必须保留省略号，提示内容已被裁剪").endsWith("...");
        assertThat(resultMsg).hasSize(RESULT_MSG_MAX_LENGTH);
        assertThat(resultMsg).endsWith("...");
    }

    /** 清理必须循环到某批不足上限为止，并累加各批删除数。 */
    @Test
    void cleanAccessLogLoopsUntilBatchIsNotFull() {
        injectDependencies();
        when(apiAccessLogMapper.deleteByCreateTimeLt(any(LocalDateTime.class), eq(100)))
                .thenReturn(100, 30);

        assertThat(service.cleanAccessLog(30, 100)).isEqualTo(130);
        verify(apiAccessLogMapper, times(2)).deleteByCreateTimeLt(any(LocalDateTime.class), eq(100));
    }

    /** 第一批就不足上限时必须立即结束，不得继续空转。 */
    @Test
    void cleanAccessLogStopsWhenNothingToDelete() {
        injectDependencies();
        when(apiAccessLogMapper.deleteByCreateTimeLt(any(LocalDateTime.class), anyInt())).thenReturn(0);

        assertThat(service.cleanAccessLog(7, 100)).isZero();
        verify(apiAccessLogMapper, times(1)).deleteByCreateTimeLt(any(LocalDateTime.class), anyInt());
    }

    /** 过期时间必须按“当前时间减保留天数”计算，单批上限原样传给 Mapper。 */
    @Test
    void cleanAccessLogComputesExpireDateFromRetentionDays() {
        injectDependencies();
        when(apiAccessLogMapper.deleteByCreateTimeLt(any(LocalDateTime.class), anyInt())).thenReturn(0);
        LocalDateTime before = LocalDateTime.now().minusDays(30).minusMinutes(1);

        service.cleanAccessLog(30, 500);

        ArgumentCaptor<LocalDateTime> captor = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(apiAccessLogMapper).deleteByCreateTimeLt(captor.capture(), eq(500));
        assertThat(captor.getValue()).as("过期时间必须是当前时间减 30 天")
                .isAfter(before).isBefore(LocalDateTime.now().minusDays(30).plusMinutes(1));
    }

    /** 注入 Mapper 替身，保证服务只访问受控边界。 */
    private void injectDependencies() {
        ReflectionTestUtils.setField(service, "apiAccessLogMapper", apiAccessLogMapper);
    }

}
