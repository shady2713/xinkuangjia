package com.basicframework.module.system.controller.admin.dashboard.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 首页概览统计响应 VO。
 *
 * <p>聚合系统用户、部门、角色、字典、近 7 日登录与操作趋势及最新动态，作为通用统计页基座数据结构。</p>
 *
 * @author shady2713
 */
@Schema(description = "管理后台 - 概览统计摘要 Response VO")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DashboardSummaryRespVO {

    @Schema(description = "当前平台用户总数", requiredMode = Schema.RequiredMode.REQUIRED, example = "12")
    private Long userTotal;

    @Schema(description = "当前平台启用用户数", requiredMode = Schema.RequiredMode.REQUIRED, example = "10")
    private Long userEnabledCount;

    @Schema(description = "当前平台部门总数", requiredMode = Schema.RequiredMode.REQUIRED, example = "5")
    private Long deptTotal;

    @Schema(description = "当前平台角色总数", requiredMode = Schema.RequiredMode.REQUIRED, example = "3")
    private Long roleTotal;

    @Schema(description = "系统字典类型总数", requiredMode = Schema.RequiredMode.REQUIRED, example = "23")
    private Long dictTypeTotal;

    @Schema(description = "今日登录次数", requiredMode = Schema.RequiredMode.REQUIRED, example = "6")
    private Long todayLoginCount;

    @Schema(description = "近 7 日登录总次数", requiredMode = Schema.RequiredMode.REQUIRED, example = "42")
    private Long sevenDayLoginCount;

    @Schema(description = "近 7 日登录成功次数", requiredMode = Schema.RequiredMode.REQUIRED, example = "40")
    private Long sevenDayLoginSuccessCount;

    @Schema(description = "近 7 日登录失败次数", requiredMode = Schema.RequiredMode.REQUIRED, example = "2")
    private Long sevenDayLoginFailCount;

    @Schema(description = "今日操作审计次数", requiredMode = Schema.RequiredMode.REQUIRED, example = "4")
    private Long todayOperateCount;

    @Schema(description = "近 7 日操作审计总次数", requiredMode = Schema.RequiredMode.REQUIRED, example = "28")
    private Long sevenDayOperateCount;

    @Schema(description = "近 7 日活跃趋势列表", requiredMode = Schema.RequiredMode.REQUIRED)
    private List<DailyTrendItem> dailyTrend;

    @Schema(description = "最近登录日志（最多 6 条）", requiredMode = Schema.RequiredMode.REQUIRED)
    private List<RecentLoginItem> recentLogins;

    @Schema(description = "最近操作审计（最多 6 条）", requiredMode = Schema.RequiredMode.REQUIRED)
    private List<RecentOperateItem> recentOperates;

    /**
     * 按日汇总的登录与操作趋势数据点。
     */
    @Schema(description = "按日活跃趋势项")
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DailyTrendItem {

        @Schema(description = "日期（MM-dd）", requiredMode = Schema.RequiredMode.REQUIRED, example = "11-22")
        private String date;

        @Schema(description = "当日登录次数", requiredMode = Schema.RequiredMode.REQUIRED, example = "8")
        private Long loginCount;

        @Schema(description = "当日操作审计次数", requiredMode = Schema.RequiredMode.REQUIRED, example = "5")
        private Long operateCount;
    }

    /**
     * 最近登录动态项。
     */
    @Schema(description = "最近登录记录项")
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class RecentLoginItem {

        @Schema(description = "日志编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "199")
        private Long id;

        @Schema(description = "用户账号", requiredMode = Schema.RequiredMode.REQUIRED, example = "admin")
        private String username;

        @Schema(description = "登录 IP")
        private String userIp;

        @Schema(description = "登录结果（0=成功，其余为失败码）", requiredMode = Schema.RequiredMode.REQUIRED, example = "0")
        private Integer result;

        @Schema(description = "登录时间", requiredMode = Schema.RequiredMode.REQUIRED)
        private LocalDateTime createTime;
    }

    /**
     * 最近操作审计动态项。
     */
    @Schema(description = "最近操作审计项")
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class RecentOperateItem {

        @Schema(description = "日志编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "10")
        private Long id;

        @Schema(description = "操作模块", example = "系统用户")
        private String type;

        @Schema(description = "操作子类型", example = "新增用户")
        private String subType;

        @Schema(description = "操作详情", example = "创建了用户【zhangsan】")
        private String action;

        @Schema(description = "操作时间", requiredMode = Schema.RequiredMode.REQUIRED)
        private LocalDateTime createTime;
    }

}
