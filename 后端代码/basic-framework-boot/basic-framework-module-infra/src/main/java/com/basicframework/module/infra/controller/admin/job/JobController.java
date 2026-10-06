package com.basicframework.module.infra.controller.admin.job;

import com.basicframework.framework.apilog.core.annotation.ApiAccessLog;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.excel.core.util.ExcelUtils;
import com.basicframework.framework.quartz.core.util.CronUtils;
import com.basicframework.module.infra.controller.admin.job.vo.job.JobPageReqVO;
import com.basicframework.module.infra.controller.admin.job.vo.job.JobRespVO;
import com.basicframework.module.infra.controller.admin.job.vo.job.JobSaveReqVO;
import com.basicframework.module.infra.dal.dataobject.job.JobDO;
import com.basicframework.module.infra.service.job.JobService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.Parameters;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import org.quartz.SchedulerException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.time.LocalDateTime;
import java.util.List;

import static com.basicframework.framework.apilog.core.enums.OperateTypeEnum.EXPORT;
import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.framework.common.pojo.CommonResult.success;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.EXPORT_SIZE_EXCEEDED;

/**
 * 定时任务管理 API
 *
 * 提供任务的增删改查、状态变更、触发、同步及执行时间预览能力。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-infra/src/main/java/cn/iocoder/yudao/module/infra/controller/admin/job/JobController.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 16 行，移除或改写上游 6 行；import 新增 9 行、移除 5 行；补充注释 86 行。
 */
@Tag(name = "管理后台 - 定时任务")
@RestController
@RequestMapping("/infra/job")
@Validated
public class JobController {

    /** 管理端单次批量删除上限。 */
    private static final int MAX_BATCH_DELETE_SIZE = 100;
    /** 单次预览后续执行时间的数量上限。 */
    private static final int MAX_NEXT_EXECUTION_COUNT = 100;
    /** 单次 Excel 导出上限，避免无边界加载全部任务。 */
    private static final int MAX_EXPORT_SIZE = 10_000;

    /** 定时任务服务。 */
    @Resource
    private JobService jobService;

    /**
     * 创建定时任务。
     *
     * @param createReqVO 创建请求
     * @return 定时任务编号
     * @throws SchedulerException 调度器创建任务失败时抛出
     */
    @PostMapping("/create")
    @Operation(summary = "创建定时任务")
    @PreAuthorize("@ss.hasPermission('infra:job:create')")
    public CommonResult<Long> createJob(@Valid @RequestBody JobSaveReqVO createReqVO)
            throws SchedulerException {
        return success(jobService.createJob(createReqVO));
    }

    /**
     * 更新定时任务。
     *
     * @param updateReqVO 更新请求
     * @return 是否更新成功
     * @throws SchedulerException 调度器更新任务失败时抛出
     */
    @PutMapping("/update")
    @Operation(summary = "更新定时任务")
    @PreAuthorize("@ss.hasPermission('infra:job:update')")
    public CommonResult<Boolean> updateJob(@Valid @RequestBody JobSaveReqVO updateReqVO)
            throws SchedulerException {
        jobService.updateJob(updateReqVO);
        return success(true);
    }

    /**
     * 更新定时任务状态。
     *
     * @param id 定时任务编号
     * @param status 任务状态
     * @return 是否更新成功
     * @throws SchedulerException 调度器更新任务状态失败时抛出
     */
    @PutMapping("/update-status")
    @Operation(summary = "更新定时任务的状态")
    @Parameters({
            @Parameter(name = "id", description = "编号", required = true, example = "1024"),
            @Parameter(name = "status", description = "状态", required = true, example = "1"),
    })
    @PreAuthorize("@ss.hasPermission('infra:job:update')")
    public CommonResult<Boolean> updateJobStatus(@RequestParam(value = "id") Long id, @RequestParam("status") Integer status)
            throws SchedulerException {
        jobService.updateJobStatus(id, status);
        return success(true);
    }

    /**
     * 删除定时任务。
     *
     * @param id 定时任务编号
     * @return 是否删除成功
     * @throws SchedulerException 调度器删除任务失败时抛出
     */
    @DeleteMapping("/delete")
    @Operation(summary = "删除定时任务")
    @Parameter(name = "id", description = "编号", required = true, example = "1024")
    @PreAuthorize("@ss.hasPermission('infra:job:delete')")
    public CommonResult<Boolean> deleteJob(@RequestParam("id") Long id)
            throws SchedulerException {
        jobService.deleteJob(id);
        return success(true);
    }

    /**
     * 批量删除定时任务。
     *
     * @param ids 定时任务编号列表
     * @return 是否删除成功
     * @throws SchedulerException 调度器删除任务失败时抛出
     */
    @DeleteMapping("/delete-list")
    @Operation(summary = "批量删除定时任务")
    @Parameter(name = "ids", description = "编号列表", required = true)
    @PreAuthorize("@ss.hasPermission('infra:job:delete')")
    public CommonResult<Boolean> deleteJobList(
            @RequestParam("ids") @NotEmpty(message = "定时任务编号列表不能为空")
            @Size(max = MAX_BATCH_DELETE_SIZE, message = "单次最多删除 100 个定时任务") List<Long> ids)
            throws SchedulerException {
        jobService.deleteJobList(ids);
        return success(true);
    }

    /**
     * 立即触发一次定时任务。
     *
     * @param id 定时任务编号
     * @return 是否触发成功
     * @throws SchedulerException 调度器触发任务失败时抛出
     */
    @PutMapping("/trigger")
    @Operation(summary = "触发定时任务")
    @Parameter(name = "id", description = "编号", required = true, example = "1024")
    @PreAuthorize("@ss.hasPermission('infra:job:trigger')")
    public CommonResult<Boolean> triggerJob(@RequestParam("id") Long id) throws SchedulerException {
        jobService.triggerJob(id);
        return success(true);
    }

    /**
     * 同步数据库中的定时任务到调度器。
     *
     * @return 是否同步成功
     * @throws SchedulerException 调度器同步任务失败时抛出
     */
    @PostMapping("/sync")
    @Operation(summary = "同步定时任务")
    @PreAuthorize("@ss.hasPermission('infra:job:create')")
    public CommonResult<Boolean> syncJob() throws SchedulerException {
        jobService.syncJob();
        return success(true);
    }

    /**
     * 获取定时任务详情。
     *
     * @param id 定时任务编号
     * @return 定时任务详情
     */
    @GetMapping("/get")
    @Operation(summary = "获得定时任务")
    @Parameter(name = "id", description = "编号", required = true, example = "1024")
    @PreAuthorize("@ss.hasPermission('infra:job:query')")
    public CommonResult<JobRespVO> getJob(@RequestParam("id") Long id) {
        JobDO job = jobService.getJob(id);
        return success(BeanUtils.toBean(job, JobRespVO.class));
    }

    /**
     * 分页查询定时任务。
     *
     * @param pageVO 分页查询条件
     * @return 定时任务分页结果
     */
    @GetMapping("/page")
    @Operation(summary = "获得定时任务分页")
    @PreAuthorize("@ss.hasPermission('infra:job:query')")
    public CommonResult<PageResult<JobRespVO>> getJobPage(@Valid JobPageReqVO pageVO) {
        PageResult<JobDO> pageResult = jobService.getJobPage(pageVO);
        return success(BeanUtils.toBean(pageResult, JobRespVO.class));
    }

    /**
     * 导出定时任务 Excel。
     *
     * @param exportReqVO 导出查询条件
     * @param response HTTP 响应
     * @throws IOException Excel 写出失败时抛出
     */
    @GetMapping("/export-excel")
    @Operation(summary = "导出定时任务 Excel")
    @PreAuthorize("@ss.hasPermission('infra:job:export')")
    @ApiAccessLog(operateType = EXPORT)
    public void exportJobExcel(@Valid JobPageReqVO exportReqVO,
                               HttpServletResponse response) throws IOException {
        exportReqVO.setPageNo(1);
        exportReqVO.setPageSize(MAX_EXPORT_SIZE);
        PageResult<JobDO> page = jobService.getJobPage(exportReqVO);
        if (page.getTotal() > MAX_EXPORT_SIZE) {
            throw exception(EXPORT_SIZE_EXCEEDED);
        }
        // 导出 Excel
        ExcelUtils.write(response, "定时任务.xls", "数据", JobRespVO.class,
                BeanUtils.toBean(page.getList(), JobRespVO.class));
    }

    /**
     * 获取定时任务后续执行时间。
     *
     * @param id 定时任务编号
     * @param count 返回的执行时间数量
     * @return 后续执行时间列表；任务不存在时返回空列表
     */
    @GetMapping("/get_next_times")
    @Operation(summary = "获得定时任务的下 n 次执行时间")
    @Parameters({
            @Parameter(name = "id", description = "编号", required = true, example = "1024"),
            @Parameter(name = "count", description = "数量", example = "5")
    })
    @PreAuthorize("@ss.hasPermission('infra:job:query')")
    public CommonResult<List<LocalDateTime>> getJobNextTimes(
            @RequestParam("id") Long id,
            @RequestParam(value = "count", required = false, defaultValue = "5")
            @Min(value = 1, message = "执行时间数量必须大于 0")
            @Max(value = MAX_NEXT_EXECUTION_COUNT, message = "执行时间数量不能超过 100") Integer count) {
        JobDO job = jobService.getJob(id);
        if (job == null) {
            return success(List.of());
        }
        return success(CronUtils.getNextTimes(job.getCronExpression(), count));
    }

}
