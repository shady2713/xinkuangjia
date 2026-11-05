package com.basicframework.module.system.framework.security.audit;

import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.module.system.api.logger.dto.LoginLogCreateReqDTO;
import com.basicframework.module.system.enums.logger.LoginLogTypeEnum;
import com.basicframework.module.system.enums.logger.LoginResultEnum;
import com.basicframework.module.system.service.logger.LoginLogService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;

/**
 * 验证安全审计记录的用户、请求元数据和结果字段，确保不依赖调用方拼装。
 *
 * @author shady2713
 */
@ExtendWith(MockitoExtension.class)
class SecurityAuditServiceTest {

    @Mock
    private LoginLogService loginLogService;

    @InjectMocks
    private SecurityAuditService securityAuditService;

    /** 验证审计记录包含事件类型、结果、用户和可落库的空 IP/UA 兜底值。 */
    @Test
    void recordsAuditFieldsForKnownUser() {
        securityAuditService.record(LoginLogTypeEnum.PASSWORD_CHANGE,
                LoginResultEnum.SUCCESS, 1024L, "audit-user");

        ArgumentCaptor<LoginLogCreateReqDTO> captor = ArgumentCaptor.forClass(LoginLogCreateReqDTO.class);
        verify(loginLogService).createLoginLog(captor.capture());
        LoginLogCreateReqDTO reqDTO = captor.getValue();
        assertThat(reqDTO.getLogType()).isEqualTo(LoginLogTypeEnum.PASSWORD_CHANGE.getType());
        assertThat(reqDTO.getResult()).isEqualTo(LoginResultEnum.SUCCESS.getResult());
        assertThat(reqDTO.getUserId()).isEqualTo(1024L);
        assertThat(reqDTO.getUserType()).isEqualTo(UserTypeEnum.ADMIN.getValue());
        assertThat(reqDTO.getUsername()).isEqualTo("audit-user");
        assertThat(reqDTO.getUserIp()).isEmpty();
        assertThat(reqDTO.getUserAgent()).isEmpty();
    }

    /** 验证从当前请求上下文记录客户端 IP 和 User-Agent。 */
    @Test
    void recordsRequestIpAndUserAgent() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("192.0.2.10");
        request.addHeader("User-Agent", "JUnit-Agent");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        try {
            securityAuditService.record(LoginLogTypeEnum.LOGIN_USERNAME,
                    LoginResultEnum.BAD_CREDENTIALS, null, "audit-user");

            ArgumentCaptor<LoginLogCreateReqDTO> captor = ArgumentCaptor.forClass(LoginLogCreateReqDTO.class);
            verify(loginLogService).createLoginLog(captor.capture());
            assertThat(captor.getValue().getUserIp()).isEqualTo("192.0.2.10");
            assertThat(captor.getValue().getUserAgent()).isEqualTo("JUnit-Agent");
        } finally {
            RequestContextHolder.resetRequestAttributes();
        }
    }

    /** 验证未知用户按 0 记录，账号和请求元数据不会为 null。 */
    @Test
    void recordsUnknownUserWithZeroId() {
        securityAuditService.record(LoginLogTypeEnum.LOGIN_MOBILE,
                LoginResultEnum.USER_MOBILE_NOT_FOUND, null, null);

        ArgumentCaptor<LoginLogCreateReqDTO> captor = ArgumentCaptor.forClass(LoginLogCreateReqDTO.class);
        verify(loginLogService).createLoginLog(captor.capture());
        assertThat(captor.getValue().getUserId()).isZero();
        assertThat(captor.getValue().getUsername()).isEmpty();
    }
}
