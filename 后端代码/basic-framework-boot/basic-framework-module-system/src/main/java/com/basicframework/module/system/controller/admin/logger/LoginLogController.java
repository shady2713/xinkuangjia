package com.basicframework.module.system.controller.admin.logger;

import com.basicframework.framework.apilog.core.annotation.ApiAccessLog;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.excel.core.util.ExcelUtils;
import com.basicframework.module.system.controller.admin.logger.vo.loginlog.LoginLogPageReqVO;
import com.basicframework.module.system.controller.admin.logger.vo.loginlog.LoginLogRespVO;
import com.basicframework.module.system.dal.dataobject.logger.LoginLogDO;
import com.basicframework.module.system.service.logger.LoginLogService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.util.List;

import static com.basicframework.framework.apilog.core.enums.OperateTypeEnum.EXPORT;
import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.framework.common.pojo.CommonResult.success;
import static com.basicframework.module.system.enums.ErrorCodeConstants.LOG_EXPORT_SIZE_EXCEEDED;

/**
 * 登录日志 Controller，提供登录日志的分页查询能力
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/logger/LoginLogController.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 10 行，上游代码 4 行在本地被移除或改写，例如 private static final int MAX_EXPORT_SIZE = 10_000;；public CommonResult<LoginLogRespVO> getLoginLog(Long id) {；本地补充注释 20 行。
 */
@Tag(name = "管理后台 - 登录日志")
@RestController
@RequestMapping("/system/login-log")
@Validated
public class LoginLogController {

    /** 单次 Excel 导出上限，避免无边界加载持续增长的登录日志。 */
    private static final int MAX_EXPORT_SIZE = 10_000;

    @Resource
    private LoginLogService loginLogService;

    /**
     * 获取登录日志。
     *
     * @param id 主键编号
     * @return 查询结果
     */
    @GetMapping("/get")
    @Operation(summary = "获得登录日志")
    @PreAuthorize("@ss.hasPermission('system:login-log:query')")
    public CommonResult<LoginLogRespVO> getLoginLog(Long id) {
        LoginLogDO loginLog = loginLogService.getLoginLog(id);
        return success(BeanUtils.toBean(loginLog, LoginLogRespVO.class));
    }

    /**
     * 获取登录日志分页数据。
     *
     * @param pageReqVO 请求参数
     * @return 查询结果
     */
    @GetMapping("/page")
    @Operation(summary = "获得登录日志分页列表")
    @PreAuthorize("@ss.hasPermission('system:login-log:query')")
    public CommonResult<PageResult<LoginLogRespVO>> getLoginLogPage(@Valid LoginLogPageReqVO pageReqVO) {
        PageResult<LoginLogDO> pageResult = loginLogService.getLoginLogPage(pageReqVO);
        return success(BeanUtils.toBean(pageResult, LoginLogRespVO.class));
    }

    /**
     * 导出登录日志。
     *
     * @param response HTTP 响应
     * @param exportReqVO 请求参数
     * @throws IOException 执行失败时抛出
     */
    @GetMapping("/export-excel")
    @Operation(summary = "导出登录日志 Excel")
    @PreAuthorize("@ss.hasPermission('system:login-log:export')")
    @ApiAccessLog(operateType = EXPORT)
    public void exportLoginLog(HttpServletResponse response,
                               @Valid LoginLogPageReqVO exportReqVO) throws IOException {
        exportReqVO.setPageNo(1);
        exportReqVO.setPageSize(MAX_EXPORT_SIZE);
        PageResult<LoginLogDO> page = loginLogService.getLoginLogPage(exportReqVO);
        if (page.getTotal() > MAX_EXPORT_SIZE) {
            throw exception(LOG_EXPORT_SIZE_EXCEEDED);
        }
        List<LoginLogDO> list = page.getList();
        // 输出
        ExcelUtils.write(response, "登录日志.xls", "数据列表", LoginLogRespVO.class,
                BeanUtils.toBean(list, LoginLogRespVO.class));
    }

}
