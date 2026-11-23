package com.basicframework.module.system.service.oauth2;

import cn.hutool.extra.spring.SpringUtil;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.security.config.SecurityProperties;
import com.basicframework.module.system.controller.admin.oauth2.vo.client.OAuth2ClientSaveReqVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2ClientDO;
import com.basicframework.module.system.dal.mysql.oauth2.OAuth2ClientMapper;
import com.basicframework.module.system.enums.oauth2.OAuth2ClientConstants;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.MockedStatic;
import org.mockito.Mockito;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Duration;
import java.util.List;

import static com.basicframework.module.system.enums.ErrorCodeConstants.OAUTH2_CLIENT_AUTHORIZED_GRANT_TYPE_NOT_EXISTS;
import static com.basicframework.module.system.enums.ErrorCodeConstants.OAUTH2_CLIENT_CLIENT_SECRET_ERROR;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

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
        assertThat(client.getAccessTokenValiditySeconds())
                .isEqualTo((int) Duration.ofMinutes(30).toSeconds());
        assertThat(client.getRefreshTokenValiditySeconds())
                .isEqualTo((int) Duration.ofDays(30).toSeconds());
        verifyNoInteractions(oauth2ClientMapper);
    }

    /** 验证新建客户端只允许开放入口实际支持的授权类型。 */
    @Test
    void createRejectsGrantTypeUnsupportedByOpenEntry() {
        assertThatThrownBy(() -> oauth2ClientService.createOAuth2Client(buildSaveReq(null, List.of("password"))))
                .isInstanceOfSatisfying(ServiceException.class, ex -> assertThat(ex.getCode())
                        .isEqualTo(OAUTH2_CLIENT_AUTHORIZED_GRANT_TYPE_NOT_EXISTS.getCode()));
        verify(oauth2ClientMapper, never()).insert(any(OAuth2ClientDO.class));
    }

    /** 验证更新时未变化的历史授权类型原样保留。 */
    @Test
    void updateRetainsUnchangedHistoricalGrantTypes() {
        OAuth2ClientDO existing = buildClient("$2a$04$stored");
        existing.setAuthorizedGrantTypes(List.of("password", "client_credentials"));
        when(oauth2ClientMapper.selectById(1L)).thenReturn(existing);

        oauth2ClientService.updateOAuth2Client(buildSaveReq(1L, List.of("password", "client_credentials")));

        verify(oauth2ClientMapper).updateById(any(OAuth2ClientDO.class));
    }

    /** 验证更新时新增的不支持授权类型被拒绝。 */
    @Test
    void updateRejectsNewlyAddedUnsupportedGrantType() {
        OAuth2ClientDO existing = buildClient("$2a$04$stored");
        existing.setAuthorizedGrantTypes(List.of("client_credentials"));
        when(oauth2ClientMapper.selectById(1L)).thenReturn(existing);

        assertThatThrownBy(() -> oauth2ClientService.updateOAuth2Client(
                buildSaveReq(1L, List.of("client_credentials", "implicit"))))
                .isInstanceOfSatisfying(ServiceException.class, ex -> assertThat(ex.getCode())
                        .isEqualTo(OAUTH2_CLIENT_AUTHORIZED_GRANT_TYPE_NOT_EXISTS.getCode()));
        verify(oauth2ClientMapper, never()).updateById(any(OAuth2ClientDO.class));
    }

    /** 构造启用的合成客户端。 */
    private static OAuth2ClientDO buildClient(String storedSecret) {
        OAuth2ClientDO client = new OAuth2ClientDO();
        client.setId(1L);
        client.setClientId("demo-client");
        client.setSecret(storedSecret);
        client.setStatus(CommonStatusEnum.ENABLE.getStatus());
        return client;
    }

    /** 构造客户端保存请求，不提交新密钥。 */
    private static OAuth2ClientSaveReqVO buildSaveReq(Long id, List<String> grantTypes) {
        OAuth2ClientSaveReqVO reqVO = new OAuth2ClientSaveReqVO();
        reqVO.setId(id);
        reqVO.setClientId("demo-client");
        reqVO.setName("Demo");
        reqVO.setStatus(CommonStatusEnum.ENABLE.getStatus());
        reqVO.setAccessTokenValiditySeconds(60);
        reqVO.setRefreshTokenValiditySeconds(120);
        reqVO.setAuthorizedGrantTypes(grantTypes);
        return reqVO;
    }
}
