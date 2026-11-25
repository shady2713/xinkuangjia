package com.basicframework.module.system.service.dashboard;

import com.basicframework.framework.datapermission.core.aop.DataPermissionContextHolder;
import com.basicframework.module.system.controller.admin.dashboard.vo.DashboardSummaryRespVO;
import com.basicframework.module.system.dal.dataobject.logger.LoginLogDO;
import com.basicframework.module.system.dal.dataobject.logger.OperateLogDO;
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
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * {@link DashboardServiceImpl} 单元测试。
 *
 * @author shady
 */
@ExtendWith(MockitoExtension.class)
class DashboardServiceImplTest {

    @Mock
    private AdminUserMapper adminUserMapper;
    @Mock
    private DeptMapper deptMapper;
    @Mock
    private RoleMapper roleMapper;
    @Mock
    private DictTypeMapper dictTypeMapper;
    @Mock
    private LoginLogMapper loginLogMapper;
    @Mock
    private OperateLogMapper operateLogMapper;
    @Mock
    private PermissionService permissionService;

    @InjectMocks
    private DashboardServiceImpl dashboardService;

    @Test
    void getDashboardSummary_aggregatesCountsTrendsAndRecentLogs() {
        AdminUserDO operator = new AdminUserDO();
        operator.setId(1L);
        operator.setUserType(AdminPlatformTypeEnum.SUPER_ADMIN.getType());
        when(adminUserMapper.selectPlatformById(1L)).thenReturn(operator);
        when(permissionService.hasAnyPermissions(1L, "system:login-log:query")).thenReturn(true);
        when(permissionService.hasAnyPermissions(1L, "system:operate-log:query")).thenReturn(true);
        when(adminUserMapper.selectCountByPlatform(AdminPlatformTypeEnum.SUPER_ADMIN.getType(), null)).thenReturn(8L);
        when(adminUserMapper.selectCountByPlatform(AdminPlatformTypeEnum.SUPER_ADMIN.getType(), 0)).thenReturn(6L);
        when(deptMapper.selectCount(any())).thenReturn(5L);
        when(roleMapper.selectCount(any())).thenReturn(2L);
        when(dictTypeMapper.selectCount()).thenReturn(23L);

        LocalDate today = LocalDate.now();
        LoginLogMapper.DailyLoginStat todayStat = new LoginLogMapper.DailyLoginStat();
        todayStat.setStatDate(today);
        todayStat.setTotalCount(1L);
        todayStat.setSuccessCount(1L);
        todayStat.setFailCount(0L);
        LoginLogMapper.DailyLoginStat yesterdayStat = new LoginLogMapper.DailyLoginStat();
        yesterdayStat.setStatDate(today.minusDays(1));
        yesterdayStat.setTotalCount(1L);
        yesterdayStat.setSuccessCount(0L);
        yesterdayStat.setFailCount(1L);
        when(loginLogMapper.selectDailyStatsByPlatform(
                eq(AdminPlatformTypeEnum.SUPER_ADMIN.getType()), eq(false), any(),
                eq(LoginResultEnum.SUCCESS.getResult())))
                .thenReturn(List.of(todayStat, yesterdayStat));

        LocalDateTime now = LocalDateTime.now();
        LoginLogDO okLog = new LoginLogDO();
        okLog.setId(101L);
        okLog.setUsername("admin");
        okLog.setUserIp("127.0.0.1");
        okLog.setResult(LoginResultEnum.SUCCESS.getResult());
        okLog.setCreateTime(now);

        LoginLogDO failLog = new LoginLogDO();
        failLog.setId(100L);
        failLog.setUsername("guest");
        failLog.setUserIp("127.0.0.1");
        failLog.setResult(LoginResultEnum.BAD_CREDENTIALS.getResult());
        failLog.setCreateTime(now.minusDays(1));
        when(loginLogMapper.selectRecentByPlatform(
                eq(AdminPlatformTypeEnum.SUPER_ADMIN.getType()), eq(false), any(), eq(6)))
                .thenReturn(List.of(okLog, failLog));

        OperateLogMapper.DailyOperateStat operateStat = new OperateLogMapper.DailyOperateStat();
        operateStat.setStatDate(today);
        operateStat.setTotalCount(1L);
        when(operateLogMapper.selectDailyStatsByPlatform(
                eq(AdminPlatformTypeEnum.SUPER_ADMIN.getType()), eq(false), any()))
                .thenReturn(List.of(operateStat));

        OperateLogDO operateLog = new OperateLogDO();
        operateLog.setId(50L);
        operateLog.setType("系统用户");
        operateLog.setSubType("新增用户");
        operateLog.setAction("创建了用户【demo】");
        operateLog.setCreateTime(now);
        when(operateLogMapper.selectRecentByPlatform(
                eq(AdminPlatformTypeEnum.SUPER_ADMIN.getType()), eq(false), any(), eq(6)))
                .thenReturn(List.of(operateLog));

        DashboardSummaryRespVO summary = dashboardService.getDashboardSummary(1L);

        assertEquals(8L, summary.getUserTotal());
        assertEquals(6L, summary.getUserEnabledCount());
        assertEquals(5L, summary.getDeptTotal());
        assertEquals(2L, summary.getRoleTotal());
        assertEquals(23L, summary.getDictTypeTotal());
        assertEquals(1L, summary.getTodayLoginCount());
        assertEquals(2L, summary.getSevenDayLoginCount());
        assertEquals(1L, summary.getSevenDayLoginSuccessCount());
        assertEquals(1L, summary.getSevenDayLoginFailCount());
        assertEquals(1L, summary.getTodayOperateCount());
        assertEquals(1L, summary.getSevenDayOperateCount());
        assertEquals(7, summary.getDailyTrend().size());
        assertEquals(2, summary.getRecentLogins().size());
        assertEquals(1, summary.getRecentOperates().size());
    }

    @Test
    void getDashboardSummary_handlesNullOperatorAndEmptyLogs() {
        when(adminUserMapper.selectCountByPlatform(anyString(), any())).thenReturn(null);
        when(deptMapper.selectCount(any())).thenReturn(0L);
        when(roleMapper.selectCount(any())).thenReturn(0L);
        when(dictTypeMapper.selectCount()).thenReturn(0L);

        DashboardSummaryRespVO summary = dashboardService.getDashboardSummary(null);

        assertEquals(0L, summary.getUserTotal());
        assertEquals(0L, summary.getSevenDayLoginCount());
        assertEquals(7, summary.getDailyTrend().size());
        verifyNoInteractions(permissionService);
        verifyNoInteractions(loginLogMapper);
        verifyNoInteractions(operateLogMapper);
    }

    @Test
    void getDashboardSummary_hidesRecentDetailWithoutLogQueryPermission() {
        AdminUserDO operator = new AdminUserDO();
        operator.setId(2L);
        operator.setUserType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        when(adminUserMapper.selectPlatformById(2L)).thenAnswer(ignored -> {
            assertFalse(DataPermissionContextHolder.get().enable());
            return operator;
        });

        LocalDate today = LocalDate.now();
        LoginLogMapper.DailyLoginStat loginStat = new LoginLogMapper.DailyLoginStat();
        loginStat.setStatDate(today);
        loginStat.setTotalCount(1L);
        loginStat.setSuccessCount(1L);
        loginStat.setFailCount(0L);
        when(loginLogMapper.selectDailyStatsByPlatform(
                eq(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()), eq(true), any(),
                eq(LoginResultEnum.SUCCESS.getResult())))
                .thenAnswer(ignored -> {
                    assertNull(DataPermissionContextHolder.get());
                    return List.of(loginStat);
                });

        OperateLogMapper.DailyOperateStat operateStat = new OperateLogMapper.DailyOperateStat();
        operateStat.setStatDate(today);
        operateStat.setTotalCount(1L);
        when(operateLogMapper.selectDailyStatsByPlatform(
                eq(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()), eq(true), any()))
                .thenReturn(List.of(operateStat));

        DashboardSummaryRespVO summary = dashboardService.getDashboardSummary(2L);

        assertEquals(1L, summary.getTodayLoginCount());
        assertEquals(1L, summary.getSevenDayLoginCount());
        assertEquals(1L, summary.getSevenDayOperateCount());
        assertTrue(summary.getRecentLogins().isEmpty());
        assertTrue(summary.getRecentOperates().isEmpty());
        verify(loginLogMapper, never()).selectRecentByPlatform(anyString(), anyBoolean(), any(), anyInt());
        verify(operateLogMapper, never()).selectRecentByPlatform(anyString(), anyBoolean(), any(), anyInt());
    }
}
