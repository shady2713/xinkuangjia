package com.basicframework.module.infra.service.job;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.infra.controller.admin.job.vo.log.JobLogPageReqVO;
import com.basicframework.module.infra.dal.dataobject.job.JobLogDO;
import com.basicframework.module.infra.dal.mysql.job.JobLogMapper;
import com.basicframework.module.infra.enums.job.JobLogStatusEnum;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.validation.annotation.Validated;

import java.time.LocalDateTime;

/**
 * Job 日志 Service 实现类
 *
 * 记录定时任务每次执行的开始、结束和结果状态。
 *
 * @author 李杰
 */
@Service
@Validated
@Slf4j
public class JobLogServiceImpl implements JobLogService {

    @Resource
    private JobLogMapper jobLogMapper;

    /**
     * 创建任务执行日志。
     *
     * @param jobId 任务编号
     * @param beginTime 开始执行时间
     * @param jobHandlerName 处理器名称
     * @param jobHandlerParam 处理器参数
     * @param executeIndex 第几次执行，重试时递增
     * @return 任务日志编号
     */
    @Override
    public Long createJobLog(Long jobId, LocalDateTime beginTime,
                             String jobHandlerName, String jobHandlerParam, Integer executeIndex) {
        JobLogDO log = JobLogDO.builder().jobId(jobId).handlerName(jobHandlerName)
                .handlerParam(jobHandlerParam).executeIndex(executeIndex)
                .beginTime(beginTime).status(JobLogStatusEnum.RUNNING.getStatus()).build();
        jobLogMapper.insert(log);
        return log.getId();
    }

    /**
     * 异步更新任务执行结果。
     *
     * <p>更新失败时只记录日志，避免影响 Quartz 执行线程的后续流程。</p>
     *
     * @param logId 日志编号
     * @param endTime 结束执行时间
     * @param duration 执行耗时，单位毫秒
     * @param success 是否执行成功
     * @param result 执行结果或异常摘要
     */
    @Override
    @Async
    public void updateJobLogResultAsync(Long logId, LocalDateTime endTime, Integer duration, boolean success, String result) {
        try {
            JobLogDO updateObj = JobLogDO.builder().id(logId).endTime(endTime).duration(duration)
                    .status(success ? JobLogStatusEnum.SUCCESS.getStatus() : JobLogStatusEnum.FAILURE.getStatus())
                    .result(result).build();
            jobLogMapper.updateById(updateObj);
        } catch (Exception ex) {
            // 结果可能包含任务参数或异常详情，失败日志只保留稳定定位字段并记录异常链。
            log.error("[updateJobLogResultAsync][logId({}) endTime({}) duration({}) success({}) 记录结果失败]",
                    logId, endTime, duration, success, ex);
        }
    }

    /**
     * 分批清理过期任务日志。
     *
     * @param exceedDay 保留天数，早于该天数的数据会被清理
     * @param deleteLimit 单批删除数量
     * @return 实际清理条数
     */
    @Override
    @SuppressWarnings("DuplicatedCode")
    public Integer cleanJobLog(Integer exceedDay, Integer deleteLimit) {
        int count = 0;
        LocalDateTime expireDate = LocalDateTime.now().minusDays(exceedDay);
        // 循环删除，直到没有满足条件的数据
        for (int i = 0; i < Short.MAX_VALUE; i++) {
            int deleteCount = jobLogMapper.deleteByCreateTimeLt(expireDate, deleteLimit);
            count += deleteCount;
            // 达到删除预期条数，说明到底了
            if (deleteCount < deleteLimit) {
                break;
            }
        }
        return count;
    }

    /**
     * 获取任务日志详情。
     *
     * @param id 任务日志编号
     * @return 任务日志详情
     */
    @Override
    public JobLogDO getJobLog(Long id) {
        return jobLogMapper.selectById(id);
    }

    /**
     * 分页查询任务日志。
     *
     * @param pageReqVO 分页查询条件
     * @return 任务日志分页结果
     */
    @Override
    public PageResult<JobLogDO> getJobLogPage(JobLogPageReqVO pageReqVO) {
        return jobLogMapper.selectPage(pageReqVO);
    }

}
