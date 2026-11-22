package com.basicframework.module.system.controller.admin.logger;

import cn.hutool.core.collection.CollUtil;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.collection.CollectionUtils;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.excel.core.util.ExcelUtils;
import com.basicframework.module.system.controller.admin.logger.vo.operatelog.OperateLogPageReqVO;
import com.basicframework.module.system.controller.admin.logger.vo.operatelog.OperateLogRespVO;
import com.basicframework.module.system.dal.dataobject.logger.OperateLogDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.service.logger.OperateLogService;
import com.basicframework.module.system.service.user.AdminUserService;
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
import java.util.Map;
import java.util.Set;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.framework.common.pojo.CommonResult.success;
import static com.basicframework.module.system.enums.ErrorCodeConstants.LOG_EXPORT_SIZE_EXCEEDED;

/**
 * 操作日志 Controller，提供操作日志的分页查询与导出能力。
 *
 * @author 李杰
 */
@Tag(name = "管理后台 - 操作日志")
@RestController
@RequestMapping("/system/operate-log")
@Validated
public class OperateLogController {

    private static final int MAX_EXPORT_SIZE = 10_000;

    @Resource
    private OperateLogService operateLogService;

    @Resource
    private AdminUserService adminUserService;

    @GetMapping("/get")
    @Operation(summary = "查看操作日志")
    @Parameter(name = "id", description = "编号", required = true, example = "1024")
    @PreAuthorize("@ss.hasPermission('system:operate-log:query')")
    public CommonResult<OperateLogRespVO> getOperateLog(@RequestParam("id") Long id) {
        OperateLogDO operateLog = operateLogService.getOperateLog(id);
        OperateLogRespVO respVO = BeanUtils.toBean(operateLog, OperateLogRespVO.class);
        if (respVO != null) {
            fillUserNames(List.of(respVO));
        }
        return success(respVO);
    }

    @GetMapping("/page")
    @Operation(summary = "查看操作日志分页列表")
    @PreAuthorize("@ss.hasPermission('system:operate-log:query')")
    public CommonResult<PageResult<OperateLogRespVO>> pageOperateLog(@Valid OperateLogPageReqVO pageReqVO) {
        PageResult<OperateLogDO> pageResult = operateLogService.getOperateLogPage(pageReqVO);
        PageResult<OperateLogRespVO> voPage = BeanUtils.toBean(pageResult, OperateLogRespVO.class);
        fillUserNames(voPage.getList());
        return success(voPage);
    }

    @Operation(summary = "导出操作日志")
    @GetMapping("/export-excel")
    @PreAuthorize("@ss.hasPermission('system:operate-log:export')")
    public void exportOperateLog(HttpServletResponse response,
                                 @Valid OperateLogPageReqVO exportReqVO) throws IOException {
        exportReqVO.setPageNo(1);
        exportReqVO.setPageSize(MAX_EXPORT_SIZE);
        PageResult<OperateLogDO> page = operateLogService.getOperateLogPage(exportReqVO);
        if (page.getTotal() > MAX_EXPORT_SIZE) {
            throw exception(LOG_EXPORT_SIZE_EXCEEDED);
        }
        List<OperateLogRespVO> list = BeanUtils.toBean(page.getList(), OperateLogRespVO.class);
        fillUserNames(list);
        ExcelUtils.write(response, "操作日志.xls", "数据列表", OperateLogRespVO.class, list);
    }

    private void fillUserNames(List<OperateLogRespVO> list) {
        if (CollUtil.isEmpty(list)) {
            return;
        }
        Set<Long> userIds = CollectionUtils.convertSet(list, OperateLogRespVO::getUserId);
        if (CollUtil.isEmpty(userIds)) {
            return;
        }
        Map<Long, AdminUserDO> userMap = adminUserService.getUserMap(userIds);
        for (OperateLogRespVO vo : list) {
            AdminUserDO user = userMap.get(vo.getUserId());
            if (user != null) {
                vo.setUserName(user.getNickname());
            }
        }
    }

}
