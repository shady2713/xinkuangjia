package com.basicframework.module.infra.service.job;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.infra.controller.admin.job.vo.job.JobPageReqVO;
import com.basicframework.module.infra.controller.admin.job.vo.job.JobSaveReqVO;
import com.basicframework.module.infra.dal.dataobject.job.JobDO;
import jakarta.validation.Valid;
import org.quartz.SchedulerException;

import java.util.List;

/**
 * 定时任务 Service 接口
 *
 * 定义定时任务配置维护、状态变更、手动触发和 Quartz 同步能力。
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
public interface JobService {

    /**
     * 创建定时任务
     *
     * @param createReqVO 创建信息
     * @return 编号
     * @throws SchedulerException Quartz 调度器操作失败时抛出
     */
    Long createJob(@Valid JobSaveReqVO createReqVO) throws SchedulerException;

    /**
     * 更新定时任务
     *
     * @param updateReqVO 更新信息
     * @throws SchedulerException Quartz 调度器操作失败时抛出
     */
    void updateJob(@Valid JobSaveReqVO updateReqVO) throws SchedulerException;

    /**
     * 更新定时任务的状态
     *
     * @param id     任务编号
     * @param status 状态
     * @throws SchedulerException Quartz 调度器操作失败时抛出
     */
    void updateJobStatus(Long id, Integer status) throws SchedulerException;

    /**
     * 触发定时任务
     *
     * @param id 任务编号
     * @throws SchedulerException Quartz 调度器操作失败时抛出
     */
    void triggerJob(Long id) throws SchedulerException;

    /**
     * 同步定时任务
     *
     * 目的：自己存储的 Job 信息，强制同步到 Quartz 中
     *
     * @throws SchedulerException Quartz 调度器操作失败时抛出
     */
    void syncJob() throws SchedulerException;

    /**
     * 删除定时任务
     *
     * @param id 编号
     * @throws SchedulerException Quartz 调度器操作失败时抛出
     */
    void deleteJob(Long id) throws SchedulerException;

    /**
     * 批量删除定时任务
     *
     * @param ids 编号列表
     * @throws SchedulerException Quartz 调度器操作失败时抛出
     */
    void deleteJobList(List<Long> ids) throws SchedulerException;

    /**
     * 获得定时任务
     *
     * @param id 编号
     * @return 定时任务
     */
    JobDO getJob(Long id);

    /**
     * 获得定时任务分页
     *
     * @param pageReqVO 分页查询
     * @return 定时任务分页
     */
    PageResult<JobDO> getJobPage(JobPageReqVO pageReqVO);

}
