package com.basicframework.module.system.service.dashboard;

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
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * {@link DashboardServiceImpl} 单元测试。
 *
 * @author shady2713
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

    @InjectMocks
    private DashboardServiceImpl dashboardService;

    @Test
    void getDashboardSummary_aggregatesCountsTrendsAndRecentLogs() {
        AdminUserDO operator = new AdminUserDO();
        operator.setId(1L);
        operator.setUserType(AdminPlatformTypeEnum.SUPER_ADMIN.getType());
        when(adminUserMapper.selectById(1L)).thenReturn(operator);
        when(adminUserMapper.selectCount(any())).thenReturn(8L, 6L);
        when(deptMapper.selectCount(any())).thenReturn(5L);
        when(roleMapper.selectCount(any())).thenReturn(2L);
        when(dictTypeMapper.selectCount()).thenReturn(23L);

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
        when(loginLogMapper.selectList(any())).thenReturn(List.of(okLog, failLog));

        OperateLogDO operateLog = new OperateLogDO();
        operateLog.setId(50L);
        operateLog.setType("系统用户");
        operateLog.setSubType("新增用户");
        operateLog.setAction("创建了用户【demo】");
        operateLog.setCreateTime(now);
        when(operateLogMapper.selectList(any())).thenReturn(List.of(operateLog));

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
        when(adminUserMapper.selectCount(any())).thenReturn(null);
        when(deptMapper.selectCount(any())).thenReturn(0L);
        when(roleMapper.selectCount(any())).thenReturn(0L);
        when(dictTypeMapper.selectCount()).thenReturn(0L);
        when(loginLogMapper.selectList(any())).thenReturn(List.of());
        when(operateLogMapper.selectList(any())).thenReturn(List.of());

        DashboardSummaryRespVO summary = dashboardService.getDashboardSummary(null);

        assertEquals(0L, summary.getUserTotal());
        assertEquals(0L, summary.getSevenDayLoginCount());
        assertEquals(7, summary.getDailyTrend().size());
    }
}
