package com.basicframework.module.system.controller.admin.logger;

import com.basicframework.framework.apilog.core.annotation.ApiAccessLog;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.excel.core.util.ExcelUtils;
import com.basicframework.framework.translate.core.TranslateUtils;
import com.basicframework.module.system.controller.admin.logger.vo.operatelog.OperateLogPageReqVO;
import com.basicframework.module.system.controller.admin.logger.vo.operatelog.OperateLogRespVO;
import com.basicframework.module.system.dal.dataobject.logger.OperateLogDO;
import com.basicframework.module.system.service.logger.OperateLogService;
import com.fhs.core.trans.anno.TransMethodResult;
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
import java.util.List;

import static com.basicframework.framework.apilog.core.enums.OperateTypeEnum.EXPORT;
import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.framework.common.pojo.CommonResult.success;
import static com.basicframework.module.system.enums.ErrorCodeConstants.LOG_EXPORT_SIZE_EXCEEDED;

/**
 * 操作日志 Controller，提供操作日志的分页查询能力
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/logger/OperateLogController.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 9 行，移除或改写上游 3 行；import 新增 6 行、移除 5 行；补充注释 25 行。
 * 来源验收：尚未验收
 */
@Tag(name = "管理后台 - 操作日志")
@RestController
@RequestMapping("/system/operate-log")
@Validated
public class OperateLogController {

    /** 单次 Excel 导出上限，避免无边界加载持续增长的日志数据。 */
    private static final int MAX_EXPORT_SIZE = 10_000;

    @Resource
    private OperateLogService operateLogService;

    /**
     * 获取Operate日志。
     *
     * @param id 主键编号
     * @return 查询结果
     */
    @GetMapping("/get")
    @Operation(summary = "查看操作日志")
    @Parameter(name = "id", description = "编号", required = true, example = "1024")
    @PreAuthorize("@ss.hasPermission('system:operate-log:query')")
    public CommonResult<OperateLogRespVO> getOperateLog(@RequestParam("id") Long id) {
        OperateLogDO operateLog = operateLogService.getOperateLog(id);
        return success(BeanUtils.toBean(operateLog, OperateLogRespVO.class));
    }

    /**
     * 完成 pageOperateLog 对应的业务处理。
     *
     * @param pageReqVO 请求参数
     * @return 方法处理结果
     */
    @GetMapping("/page")
    @Operation(summary = "查看操作日志分页列表")
    @PreAuthorize("@ss.hasPermission('system:operate-log:query')")
    @TransMethodResult
    public CommonResult<PageResult<OperateLogRespVO>> pageOperateLog(@Valid OperateLogPageReqVO pageReqVO) {
        PageResult<OperateLogDO> pageResult = operateLogService.getOperateLogPage(pageReqVO);
        return success(BeanUtils.toBean(pageResult, OperateLogRespVO.class));
    }

    /**
     * 导出Operate日志。
     *
     * @param response HTTP 响应
     * @param exportReqVO 请求参数
     * @throws IOException 执行失败时抛出
     */
    @Operation(summary = "导出操作日志")
    @GetMapping("/export-excel")
    @PreAuthorize("@ss.hasPermission('system:operate-log:export')")
    @TransMethodResult
    @ApiAccessLog(operateType = EXPORT)
    public void exportOperateLog(HttpServletResponse response,
                                 @Valid OperateLogPageReqVO exportReqVO) throws IOException {
        exportReqVO.setPageNo(1);
        exportReqVO.setPageSize(MAX_EXPORT_SIZE);
        PageResult<OperateLogDO> page = operateLogService.getOperateLogPage(exportReqVO);
        if (page.getTotal() > MAX_EXPORT_SIZE) {
            throw exception(LOG_EXPORT_SIZE_EXCEEDED);
        }
        List<OperateLogDO> list = page.getList();
        ExcelUtils.write(response, "操作日志.xls", "数据列表", OperateLogRespVO.class,
                TranslateUtils.translate(BeanUtils.toBean(list, OperateLogRespVO.class)));
    }

}
