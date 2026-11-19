package com.basicframework.module.infra.service.job;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.quartz.core.scheduler.SchedulerManager;
import com.basicframework.module.infra.controller.admin.job.vo.job.JobSaveReqVO;
import com.basicframework.module.infra.dal.dataobject.job.JobDO;
import com.basicframework.module.infra.dal.mysql.job.JobMapper;
import com.basicframework.module.infra.enums.job.JobStatusEnum;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static com.basicframework.module.infra.enums.ErrorCodeConstants.JOB_HANDLER_CAN_NOT_UPDATE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证 {@link JobServiceImpl} 禁止修改处理器名称以防 Quartz 调度器产生僵尸触发器。
 *
 * @author shady2713
 */
@ExtendWith(MockitoExtension.class)
class JobServiceImplTest {

    @Mock
    private JobMapper jobMapper;
    @Mock
    private SchedulerManager schedulerManager;

    @InjectMocks
    private JobServiceImpl jobService;

    /** 验证更新定时任务时修改 handlerName 会被立即拒绝且不落库不触发调度器。 */
    @Test
    void updateJobRejectsChangingHandlerName() throws Exception {
        JobDO existing = new JobDO();
        existing.setId(25L);
        existing.setStatus(JobStatusEnum.NORMAL.getStatus());
        existing.setHandlerName("accessLogCleanJob");
        when(jobMapper.selectById(25L)).thenReturn(existing);

        JobSaveReqVO updateReqVO = new JobSaveReqVO();
        updateReqVO.setId(25L);
        updateReqVO.setName("改名测试");
        updateReqVO.setHandlerName("errorLogCleanJob");
        updateReqVO.setCronExpression("0 0 0 * * ?");
        updateReqVO.setRetryCount(0);
        updateReqVO.setRetryInterval(0);

        assertThatThrownBy(() -> jobService.updateJob(updateReqVO))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(JOB_HANDLER_CAN_NOT_UPDATE.getCode()));
        verify(jobMapper, never()).updateById(any(JobDO.class));
        verify(schedulerManager, never()).updateJob(any(), any(), any(), any(), any());
    }

}
