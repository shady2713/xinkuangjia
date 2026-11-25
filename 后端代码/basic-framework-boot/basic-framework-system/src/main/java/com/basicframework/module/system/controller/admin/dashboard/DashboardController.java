package com.basicframework.module.system.controller.admin.dashboard;

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import com.basicframework.module.system.controller.admin.dashboard.vo.DashboardSummaryRespVO;
import com.basicframework.module.system.service.dashboard.DashboardService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import static com.basicframework.framework.common.pojo.CommonResult.success;

/**
 * 管理后台 - 概览统计控制器。
 *
 * @author shady
 */
@Tag(name = "管理后台 - 概览统计")
@RestController
@RequestMapping("/system/dashboard")
@Validated
public class DashboardController {

    @Resource
    private DashboardService dashboardService;

    /**
     * 获取首页概览统计摘要数据。
     *
     * @return 概览统计摘要
     */
    @GetMapping("/summary")
    @Operation(summary = "获得首页概览统计摘要")
    @PreAuthorize("isAuthenticated()")
    public CommonResult<DashboardSummaryRespVO> getDashboardSummary() {
        return success(dashboardService.getDashboardSummary(SecurityFrameworkUtils.getLoginUserId()));
    }

}
