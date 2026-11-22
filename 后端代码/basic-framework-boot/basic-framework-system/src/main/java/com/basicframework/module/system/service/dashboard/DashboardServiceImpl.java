package com.basicframework.module.system.service.dashboard;

import com.basicframework.framework.common.enums.CommonStatusEnum;
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

    @Override
    public DashboardSummaryRespVO getDashboardSummary(Long operatorUserId) {
        String platformType = resolvePlatformType(operatorUserId);

        long userTotal = countOrZero(adminUserMapper.selectCount(
                new LambdaQueryWrapperX<AdminUserDO>().eq(AdminUserDO::getUserType, platformType)));
        long userEnabledCount = countOrZero(adminUserMapper.selectCount(
                new LambdaQueryWrapperX<AdminUserDO>()
                        .eq(AdminUserDO::getUserType, platformType)
                        .eq(AdminUserDO::getStatus, CommonStatusEnum.ENABLE.getStatus())));
        long deptTotal = countOrZero(deptMapper.selectCount(
                new LambdaQueryWrapperX<DeptDO>().eq(DeptDO::getRoleType, platformType)));
        long roleTotal = countOrZero(roleMapper.selectCount(
                new LambdaQueryWrapperX<RoleDO>().eq(RoleDO::getRoleType, platformType)));
        long dictTypeTotal = countOrZero(dictTypeMapper.selectCount());

        LocalDate today = LocalDate.now();
        LocalDate startDate = today.minusDays(TREND_DAYS - 1L);
        LocalDateTime startDateTime = startDate.atStartOfDay();

        List<LoginLogDO> sevenDayLoginLogs = loginLogMapper.selectList(
                new LambdaQueryWrapperX<LoginLogDO>()
                        .ge(LoginLogDO::getCreateTime, startDateTime)
                        .orderByDesc(LoginLogDO::getId));
        List<OperateLogDO> sevenDayOperateLogs = operateLogMapper.selectList(
                new LambdaQueryWrapperX<OperateLogDO>()
                        .ge(OperateLogDO::getCreateTime, startDateTime)
                        .orderByDesc(OperateLogDO::getId));

        Map<LocalDate, Long> loginDailyMap = new HashMap<>();
        long todayLoginCount = 0L;
        long sevenDayLoginSuccessCount = 0L;
        long sevenDayLoginFailCount = 0L;
        for (LoginLogDO logItem : sevenDayLoginLogs) {
            LocalDate createDate = logItem.getCreateTime() != null ? logItem.getCreateTime().toLocalDate() : null;
            if (createDate != null) {
                loginDailyMap.merge(createDate, 1L, Long::sum);
                if (today.equals(createDate)) {
                    todayLoginCount++;
                }
            }
            if (LoginResultEnum.SUCCESS.getResult().equals(logItem.getResult())) {
                sevenDayLoginSuccessCount++;
            } else {
                sevenDayLoginFailCount++;
            }
        }

        Map<LocalDate, Long> operateDailyMap = new HashMap<>();
        long todayOperateCount = 0L;
        for (OperateLogDO operateItem : sevenDayOperateLogs) {
            LocalDate createDate = operateItem.getCreateTime() != null
                    ? operateItem.getCreateTime().toLocalDate() : null;
            if (createDate != null) {
                operateDailyMap.merge(createDate, 1L, Long::sum);
                if (today.equals(createDate)) {
                    todayOperateCount++;
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

        List<DashboardSummaryRespVO.RecentLoginItem> recentLogins = sevenDayLoginLogs.stream()
                .limit(RECENT_LIMIT)
                .map(item -> DashboardSummaryRespVO.RecentLoginItem.builder()
                        .id(item.getId())
                        .username(item.getUsername())
                        .userIp(item.getUserIp())
                        .result(item.getResult())
                        .createTime(item.getCreateTime())
                        .build())
                .toList();

        List<DashboardSummaryRespVO.RecentOperateItem> recentOperates = sevenDayOperateLogs.stream()
                .limit(RECENT_LIMIT)
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
                .sevenDayLoginCount((long) sevenDayLoginLogs.size())
                .sevenDayLoginSuccessCount(sevenDayLoginSuccessCount)
                .sevenDayLoginFailCount(sevenDayLoginFailCount)
                .todayOperateCount(todayOperateCount)
                .sevenDayOperateCount((long) sevenDayOperateLogs.size())
                .dailyTrend(dailyTrend)
                .recentLogins(recentLogins)
                .recentOperates(recentOperates)
                .build();
    }

    private String resolvePlatformType(Long operatorUserId) {
        if (operatorUserId == null) {
            return AdminPlatformTypeEnum.BUSINESS_ADMIN.getType();
        }
        AdminUserDO operator = adminUserMapper.selectById(operatorUserId);
        if (operator == null) {
            return AdminPlatformTypeEnum.BUSINESS_ADMIN.getType();
        }
        return AdminPlatformTypeEnum.defaultType(operator.getUserType());
    }

    private long countOrZero(Long value) {
        return value == null ? 0L : value;
    }

}
