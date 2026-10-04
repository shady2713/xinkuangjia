package com.basicframework.module.system.api.logger;

import com.basicframework.module.system.api.logger.dto.LoginLogCreateReqDTO;
import com.basicframework.module.system.service.logger.LoginLogService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;

/**
 * 验证登录日志跨模块 API 的落库转发契约。
 *
 * <p>认证流程通过该入口记录登录成功与失败。实现只做转发，因此必须锁定：日志请求原样传递
 * （改写结果码或用户编号会让审计记录与真实登录不一致）、写入失败原样传播
 * （登录日志是审计依据，静默丢弃会让失败登录无法追溯）。</p>
 *
 * @author shady2713
 */
class LoginLogApiImplTest {

    /** 被测 API 实现。 */
    private LoginLogApiImpl loginLogApi;
    /** 下游登录日志服务替身，用于观察真实转发参数。 */
    private LoginLogService loginLogService;

    /** 为每个用例创建独立 API 与下游替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        loginLogApi = new LoginLogApiImpl();
        loginLogService = mock(LoginLogService.class);
        ReflectionTestUtils.setField(loginLogApi, "loginLogService", loginLogService);
    }

    /** 登录日志请求必须原样转发给登录日志服务。 */
    @Test
    void createLoginLogDelegatesSameInstance() {
        LoginLogCreateReqDTO reqDTO = new LoginLogCreateReqDTO();
        reqDTO.setLogType(100);
        reqDTO.setResult(0);

        loginLogApi.createLoginLog(reqDTO);

        verify(loginLogService).createLoginLog(reqDTO);
        verifyNoMoreInteractions(loginLogService);
    }

    /** 写入失败必须原样传播，避免登录审计记录静默丢失。 */
    @Test
    void serviceFailurePropagatesUnchanged() {
        LoginLogCreateReqDTO reqDTO = new LoginLogCreateReqDTO();
        IllegalStateException failure = new IllegalStateException("synthetic-login-log-failure");
        doThrow(failure).when(loginLogService).createLoginLog(reqDTO);

        assertThatThrownBy(() -> loginLogApi.createLoginLog(reqDTO)).isSameAs(failure);
    }

}
