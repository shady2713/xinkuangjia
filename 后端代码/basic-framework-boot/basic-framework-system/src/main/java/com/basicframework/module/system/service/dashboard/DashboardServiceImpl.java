package com.basicframework.module.system.service.dashboard;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.datapermission.core.util.DataPermissionUtils;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.system.controller.admin.dashboard.vo.DashboardSummaryRespVO;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import com.basicframework.module.system.dal.dataobject.logger.LoginLogDO;
import com.basicframework.module.system.dal.dataobject.logger.OperateLogDO;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.dal.mysql.dept.DeptMapper;
import com.basicframework.module.system.dal.mysql.dict.DictTypeMapper;
import com.basicframework.module.system.dal.mysql.logger.LoginLogMapper;
import com.basicframework.module.system.dal.mysql.logger.OperateLogMapper;
import com.basicframework.module.system.dal.mysql.permission.RoleMapper;
import com.basicframework.module.system.dal.mysql.user.AdminUserMapper;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.logger.LoginResultEnum;
import com.basicframework.module.system.service.permission.PermissionService;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 首页概览统计 Service 实现类。
 *
 * <p>按当前登录用户的平台边界隔离用户、部门与角色规模，并聚合近 7 日登录与操作审计真实数据。</p>
 *
 * @author shady2713
 */
@Service
public class DashboardServiceImpl implements DashboardService {

    private static final int TREND_DAYS = 7;
    private static final int RECENT_LIMIT = 6;
    private static final DateTimeFormatter SHORT_DATE_FORMATTER = DateTimeFormatter.ofPattern("MM-dd");
    /** 最近登录明细与登录日志页面共用同一查询权限。 */
    private static final String LOGIN_LOG_QUERY_PERMISSION = "system:login-log:query";
    /** 最近操作明细与操作日志页面共用同一查询权限。 */
    private static final String OPERATE_LOG_QUERY_PERMISSION = "system:operate-log:query";

    @Resource
    private AdminUserMapper adminUserMapper;
    @Resource
    private DeptMapper deptMapper;
    @Resource
    private RoleMapper roleMapper;
    @Resource
    private DictTypeMapper dictTypeMapper;
    @Resource
    private LoginLogMapper loginLogMapper;
    @Resource
    private OperateLogMapper operateLogMapper;
    @Resource
    private PermissionService permissionService;

    @Override
    public DashboardSummaryRespVO getDashboardSummary(Long operatorUserId) {
        // 只按已认证 ID 取当前身份。指定部门范围可以不包含操作者本人。
        AdminUserDO operator = operatorUserId == null ? null
                : DataPermissionUtils.executeIgnore(() -> adminUserMapper.selectPlatformById(operatorUserId));
        String platformType = AdminPlatformTypeEnum.defaultType(operator == null ? null : operator.getUserType());
        boolean businessPlatform = AdminPlatformTypeEnum.BUSINESS_ADMIN.getType().equals(platformType);

        long userTotal = countOrZero(adminUserMapper.selectCountByPlatform(platformType, null));
        long userEnabledCount = countOrZero(adminUserMapper.selectCountByPlatform(
                platformType, CommonStatusEnum.ENABLE.getStatus()));
        long deptTotal = countOrZero(deptMapper.selectCount(
                new LambdaQueryWrapperX<DeptDO>().eq(DeptDO::getRoleType, platformType)));
        long roleTotal = countOrZero(roleMapper.selectCount(
                new LambdaQueryWrapperX<RoleDO>().eq(RoleDO::getRoleType, platformType)));
        long dictTypeTotal = countOrZero(dictTypeMapper.selectCount());

        LocalDate today = LocalDate.now();
        LocalDate startDate = today.minusDays(TREND_DAYS - 1L);
        LocalDateTime startDateTime = startDate.atStartOfDay();

        // 日志表不保存平台字段，通过数据库侧关联归属用户平台过滤（沿用老账号空平台归业务平台的兼容规则），
        // 仅拉取 7 天按日聚合统计和最多 RECENT_LIMIT 条明细，避免全量加载日志与用户 ID 列表。
        boolean includeLoginDetails = operator != null
                && permissionService.hasAnyPermissions(operatorUserId, LOGIN_LOG_QUERY_PERMISSION);
        boolean includeOperateDetails = operator != null
                && permissionService.hasAnyPermissions(operatorUserId, OPERATE_LOG_QUERY_PERMISSION);

        List<LoginLogMapper.DailyLoginStat> loginDailyStats = operator == null ? List.of()
                : loginLogMapper.selectDailyStatsByPlatform(
                        platformType, businessPlatform, startDateTime, LoginResultEnum.SUCCESS.getResult());
        List<OperateLogMapper.DailyOperateStat> operateDailyStats = operator == null ? List.of()
                : operateLogMapper.selectDailyStatsByPlatform(platformType, businessPlatform, startDateTime);

        Map<LocalDate, Long> loginDailyMap = new HashMap<>();
        long todayLoginCount = 0L;
        long sevenDayLoginCount = 0L;
        long sevenDayLoginSuccessCount = 0L;
        long sevenDayLoginFailCount = 0L;
        for (LoginLogMapper.DailyLoginStat stat : loginDailyStats) {
            long total = countOrZero(stat.getTotalCount());
            long success = countOrZero(stat.getSuccessCount());
            long fail = countOrZero(stat.getFailCount());
            sevenDayLoginCount += total;
            sevenDayLoginSuccessCount += success;
            sevenDayLoginFailCount += fail;
            if (stat.getStatDate() != null) {
                loginDailyMap.merge(stat.getStatDate(), total, Long::sum);
                if (today.equals(stat.getStatDate())) {
                    todayLoginCount += total;
                }
            }
        }

        Map<LocalDate, Long> operateDailyMap = new HashMap<>();
        long todayOperateCount = 0L;
        long sevenDayOperateCount = 0L;
        for (OperateLogMapper.DailyOperateStat stat : operateDailyStats) {
            long total = countOrZero(stat.getTotalCount());
            sevenDayOperateCount += total;
            if (stat.getStatDate() != null) {
                operateDailyMap.merge(stat.getStatDate(), total, Long::sum);
                if (today.equals(stat.getStatDate())) {
                    todayOperateCount += total;
                }
            }
        }

        List<DashboardSummaryRespVO.DailyTrendItem> dailyTrend = new ArrayList<>(TREND_DAYS);
        for (int i = 0; i < TREND_DAYS; i++) {
            LocalDate current = startDate.plusDays(i);
            dailyTrend.add(DashboardSummaryRespVO.DailyTrendItem.builder()
                    .date(current.format(SHORT_DATE_FORMATTER))
                    .loginCount(loginDailyMap.getOrDefault(current, 0L))
                    .operateCount(operateDailyMap.getOrDefault(current, 0L))
                    .build());
        }

        // 最近明细包含账号、IP 与操作内容，需具备与日志页面相同的查询权限；计数与趋势仍对已登录用户开放。
        List<LoginLogDO> recentLoginLogs = includeLoginDetails
                ? loginLogMapper.selectRecentByPlatform(platformType, businessPlatform, startDateTime, RECENT_LIMIT)
                : List.of();
        List<DashboardSummaryRespVO.RecentLoginItem> recentLogins = recentLoginLogs.stream()
                .map(item -> DashboardSummaryRespVO.RecentLoginItem.builder()
                        .id(item.getId())
                        .username(item.getUsername())
                        .userIp(item.getUserIp())
                        .result(item.getResult())
                        .createTime(item.getCreateTime())
                        .build())
                .toList();

        List<OperateLogDO> recentOperateLogs = includeOperateDetails
                ? operateLogMapper.selectRecentByPlatform(platformType, businessPlatform, startDateTime, RECENT_LIMIT)
                : List.of();
        List<DashboardSummaryRespVO.RecentOperateItem> recentOperates = recentOperateLogs.stream()
                .map(item -> DashboardSummaryRespVO.RecentOperateItem.builder()
                        .id(item.getId())
                        .type(item.getType())
                        .subType(item.getSubType())
                        .action(item.getAction())
                        .createTime(item.getCreateTime())
                        .build())
                .toList();

        return DashboardSummaryRespVO.builder()
                .userTotal(userTotal)
                .userEnabledCount(userEnabledCount)
                .deptTotal(deptTotal)
                .roleTotal(roleTotal)
                .dictTypeTotal(dictTypeTotal)
                .todayLoginCount(todayLoginCount)
                .sevenDayLoginCount(sevenDayLoginCount)
                .sevenDayLoginSuccessCount(sevenDayLoginSuccessCount)
                .sevenDayLoginFailCount(sevenDayLoginFailCount)
                .todayOperateCount(todayOperateCount)
                .sevenDayOperateCount(sevenDayOperateCount)
                .dailyTrend(dailyTrend)
                .recentLogins(recentLogins)
                .recentOperates(recentOperates)
                .build();
    }

    private long countOrZero(Long value) {
        return value == null ? 0L : value;
    }

}
