package com.basicframework.module.system.service.dashboard;

import com.basicframework.module.system.controller.admin.dashboard.vo.DashboardSummaryRespVO;

/**
 * 首页概览统计 Service 接口。
 *
 * @author shady2713
 */
public interface DashboardService {

    /**
     * 获取当前登录管理员所属平台的概览统计摘要。
     *
     * @param operatorUserId 当前登录用户编号
     * @return 概览统计摘要
     */
    DashboardSummaryRespVO getDashboardSummary(Long operatorUserId);

}
