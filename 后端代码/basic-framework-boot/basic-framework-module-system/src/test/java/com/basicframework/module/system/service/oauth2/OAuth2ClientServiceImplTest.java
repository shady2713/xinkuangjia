package com.basicframework.module.system.service.oauth2;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.security.config.SecurityProperties;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2ClientDO;
import com.basicframework.module.system.dal.mysql.oauth2.OAuth2ClientMapper;
import com.basicframework.module.system.enums.oauth2.OAuth2ClientConstants;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * 验证管理后台内部会话客户端不依赖持久化默认客户端。
 *
 * @author shady2713
 */
@ExtendWith(MockitoExtension.class)
class OAuth2ClientServiceImplTest {

    @Mock
    private OAuth2ClientMapper oauth2ClientMapper;
    @Mock
    private PasswordEncoder passwordEncoder;
    @Mock
    private org.springframework.cache.CacheManager cacheManager;

    private SecurityProperties securityProperties;
    private OAuth2ClientServiceImpl oauth2ClientService;

    /**
     * 构造只暴露内部会话客户端的服务实例。
     */
    @BeforeEach
    void setUp() {
        securityProperties = new SecurityProperties();
        oauth2ClientService = new OAuth2ClientServiceImpl();
        ReflectionTestUtils.setField(oauth2ClientService, "oauth2ClientMapper", oauth2ClientMapper);
        ReflectionTestUtils.setField(oauth2ClientService, "passwordEncoder", passwordEncoder);
        ReflectionTestUtils.setField(oauth2ClientService, "cacheManager", cacheManager);
        ReflectionTestUtils.setField(oauth2ClientService, "securityProperties", securityProperties);
    }

    /** 验证内部客户端启用、无授权类型、有效期来自会话配置且不查询数据库。 */
    @Test
    void buildsInternalClientFromSessionConfig() {
        OAuth2ClientDO client = oauth2ClientService.getSystemClient();

        assertThat(client.getClientId()).isEqualTo(OAuth2ClientConstants.CLIENT_ID_SYSTEM);
        assertThat(client.getStatus()).isEqualTo(CommonStatusEnum.ENABLE.getStatus());
        assertThat(client.getSecret()).isEmpty();
        assertThat(client.getAuthorizedGrantTypes()).isEmpty();
        assertThat(client.getRedirectUris()).isEmpty();
        assertThat(client.getAccessTokenValiditySeconds())
                .isEqualTo((int) Duration.ofMinutes(30).toSeconds());
        assertThat(client.getRefreshTokenValiditySeconds())
                .isEqualTo((int) Duration.ofDays(30).toSeconds());
        verifyNoInteractions(oauth2ClientMapper);
    }
}
