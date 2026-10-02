package com.basicframework.module.infra.controller.admin.job;

import com.basicframework.framework.apilog.core.annotation.ApiAccessLog;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.excel.core.util.ExcelUtils;
import com.basicframework.module.infra.controller.admin.job.vo.log.JobLogPageReqVO;
import com.basicframework.module.infra.controller.admin.job.vo.log.JobLogRespVO;
import com.basicframework.module.infra.dal.dataobject.job.JobLogDO;
import com.basicframework.module.infra.service.job.JobLogService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;

import static com.basicframework.framework.apilog.core.enums.OperateTypeEnum.EXPORT;
import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.framework.common.pojo.CommonResult.success;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.EXPORT_SIZE_EXCEEDED;

/**
 * 管理后台定时任务日志 API。
 *
 * 提供任务执行日志的详情查询、分页查询和 Excel 导出能力。
 *
 * @author 李杰
 */
@Tag(name = "管理后台 - 定时任务日志")
@RestController
@RequestMapping("/infra/job-log")
@Validated
public class JobLogController {

    /** 单次 Excel 导出上限，避免无边界加载全部任务日志。 */
    private static final int MAX_EXPORT_SIZE = 10_000;

    /** 定时任务日志服务。 */
    @Resource
    private JobLogService jobLogService;

    /**
     * 获取定时任务日志详情。
     *
     * @param id 任务日志编号
     * @return 定时任务日志详情
     */
    @GetMapping("/get")
    @Operation(summary = "获得定时任务日志")
    @Parameter(name = "id", description = "编号", required = true, example = "1024")
    @PreAuthorize("@ss.hasPermission('infra:job:query')")
    public CommonResult<JobLogRespVO> getJobLog(@RequestParam("id") Long id) {
        JobLogDO jobLog = jobLogService.getJobLog(id);
        return success(BeanUtils.toBean(jobLog, JobLogRespVO.class));
    }

    /**
     * 分页查询定时任务日志。
     *
     * @param pageVO 分页查询条件
     * @return 定时任务日志分页结果
     */
    @GetMapping("/page")
    @Operation(summary = "获得定时任务日志分页")
    @PreAuthorize("@ss.hasPermission('infra:job:query')")
    public CommonResult<PageResult<JobLogRespVO>> getJobLogPage(@Valid JobLogPageReqVO pageVO) {
        PageResult<JobLogDO> pageResult = jobLogService.getJobLogPage(pageVO);
        return success(BeanUtils.toBean(pageResult, JobLogRespVO.class));
    }

    /**
     * 导出定时任务日志 Excel。
     *
     * @param exportReqVO 导出查询条件
     * @param response HTTP 响应
     * @throws IOException Excel 写出失败时抛出
     */
    @GetMapping("/export-excel")
    @Operation(summary = "导出定时任务日志 Excel")
    @PreAuthorize("@ss.hasPermission('infra:job:export')")
    @ApiAccessLog(operateType = EXPORT)
    public void exportJobLogExcel(@Valid JobLogPageReqVO exportReqVO,
                                  HttpServletResponse response) throws IOException {
        exportReqVO.setPageNo(1);
        exportReqVO.setPageSize(MAX_EXPORT_SIZE);
        PageResult<JobLogDO> page = jobLogService.getJobLogPage(exportReqVO);
        if (page.getTotal() > MAX_EXPORT_SIZE) {
            throw exception(EXPORT_SIZE_EXCEEDED);
        }
        // 导出 Excel
        ExcelUtils.write(response, "任务日志.xls", "数据", JobLogRespVO.class,
                BeanUtils.toBean(page.getList(), JobLogRespVO.class));
    }

}
