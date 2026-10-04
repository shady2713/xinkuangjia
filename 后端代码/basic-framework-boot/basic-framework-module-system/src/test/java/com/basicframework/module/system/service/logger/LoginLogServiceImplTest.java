package com.basicframework.module.system.service.logger;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.api.logger.dto.LoginLogCreateReqDTO;
import com.basicframework.module.system.controller.admin.logger.vo.loginlog.LoginLogPageReqVO;
import com.basicframework.module.system.dal.dataobject.logger.LoginLogDO;
import com.basicframework.module.system.dal.mysql.logger.LoginLogMapper;
import com.basicframework.module.system.enums.logger.LoginResultEnum;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证登录日志服务的失败审计守卫与查询转发契约。
 *
 * <p>失败审计使用独立事务提交：只有真正的失败结果才允许走该入口，成功结果必须交给会话事务，
 * 否则成功登录会在两个事务里各写一次或提前提交。查询入口只做转发，
 * 因此必须锁定按编号查询与分页条件原样传给 Mapper。</p>
 *
 * @author shady2713
 */
class LoginLogServiceImplTest {

    /** 被测服务。 */
    private LoginLogServiceImpl loginLogService;
    /** 下游登录日志 Mapper 替身，用于观察真实转发参数。 */
    private LoginLogMapper loginLogMapper;

    /** 为每个用例装配独立服务与替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        loginLogService = new LoginLogServiceImpl();
        loginLogMapper = mock(LoginLogMapper.class);
        ReflectionTestUtils.setField(loginLogService, "loginLogMapper", loginLogMapper);
    }

    /**
     * 成功结果不得通过失败审计入口写入。
     *
     * <p>该入口使用独立事务，成功结果必须与会话事务共同提交；误用会让成功登录提前落库，
     * 会话提交失败时留下错误的成功审计。</p>
     */
    @Test
    void createLoginFailureLogRejectsSuccessResult() {
        LoginLogCreateReqDTO reqDTO = new LoginLogCreateReqDTO();
        reqDTO.setResult(LoginResultEnum.SUCCESS.getResult());

        assertThatThrownBy(() -> loginLogService.createLoginFailureLog(reqDTO))
                .isInstanceOf(IllegalArgumentException.class);

        verify(loginLogMapper, never()).insert(org.mockito.ArgumentMatchers.any(LoginLogDO.class));
    }

    /** 真正的失败结果必须写入数据库，审计失败登录。 */
    @Test
    void createLoginFailureLogPersistsFailureResult() {
        LoginLogCreateReqDTO reqDTO = new LoginLogCreateReqDTO();
        reqDTO.setResult(LoginResultEnum.BAD_CREDENTIALS.getResult());
        reqDTO.setUsername("admin");

        loginLogService.createLoginFailureLog(reqDTO);

        verify(loginLogMapper).insert(org.mockito.ArgumentMatchers.<LoginLogDO>argThat(
                log -> LoginResultEnum.BAD_CREDENTIALS.getResult().equals(log.getResult())
                        && "admin".equals(log.getUsername())));
    }

    /** 按编号查询必须原样转发给 Mapper 并透出结果。 */
    @Test
    void getLoginLogDelegatesToMapper() {
        LoginLogDO stored = new LoginLogDO();
        stored.setId(9L);
        when(loginLogMapper.selectById(9L)).thenReturn(stored);

        assertThat(loginLogService.getLoginLog(9L)).isSameAs(stored);
        verify(loginLogMapper).selectById(9L);
        verifyNoMoreInteractions(loginLogMapper);
    }

    /** 按编号查询不存在时必须返回 null，交由调用方区分“无此日志”和字段为空。 */
    @Test
    void getLoginLogReturnsNullForMissingLog() {
        when(loginLogMapper.selectById(404L)).thenReturn(null);

        assertThat(loginLogService.getLoginLog(404L)).isNull();
    }

    /** 分页查询必须把请求对象原样交给 Mapper，条件在 Mapper 内表达。 */
    @Test
    void getLoginLogPageDelegatesSameRequest() {
        LoginLogPageReqVO reqVO = new LoginLogPageReqVO();
        reqVO.setUsername("admin");
        PageResult<LoginLogDO> page = new PageResult<>(List.of(), 0L);
        when(loginLogMapper.selectPage(reqVO)).thenReturn(page);

        assertThat(loginLogService.getLoginLogPage(reqVO)).isSameAs(page);
        verify(loginLogMapper).selectPage(reqVO);
        verifyNoMoreInteractions(loginLogMapper);
    }

}
