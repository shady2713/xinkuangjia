package com.basicframework.module.system.service.oauth2;

import cn.hutool.extra.spring.SpringUtil;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.exception.ErrorCode;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.controller.admin.oauth2.vo.client.OAuth2ClientPageReqVO;
import com.basicframework.module.system.controller.admin.oauth2.vo.client.OAuth2ClientSaveReqVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2ClientDO;
import com.basicframework.module.system.dal.mysql.oauth2.OAuth2ClientMapper;
import com.basicframework.module.system.dal.redis.RedisKeyConstants;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.context.ApplicationContext;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证 OAuth2 客户端的密钥处理、编号唯一性、开放接口客户端维护与授权请求校验契约。
 *
 * <p>客户端密钥是签发令牌的唯一凭据，以下边界决定安全：创建必须提交非空密钥并以 BCrypt 落库，
 * 明文不得入库；更新未提交新密钥时必须保留原哈希，提交时才执行轮换；客户端编号在创建与更新时
 * 都必须唯一，更新自身不算冲突。历史明文密钥只允许匹配成功一次，命中后必须原地升级为 BCrypt
 * 并清理该客户端缓存，避免明文长期留存；密钥比较失败一律返回统一的"无效 client_secret"，
 * 不区分"客户端不存在"以外的原因。</p>
 *
 * <p>授权请求校验要求回调地址与登记值完全一致，授权类型与授权范围必须是登记值的子集，任何一项
 * 不匹配都必须拒绝，避免相似域名或越权范围被放行。开放接口客户端的维护方法负责补齐固定属性，
 * 并在客户端不存在时按"新增"或"静默跳过"处理，不产生部分更新。</p>
 *
 * <p>持久层、密码编码器与缓存管理器按进程外边界替换为替身；{@code SpringUtil} 静态上下文只替换为
 * 返回同一实例的替身，用于验证自身代理调用路径，不引入静态方法拦截。</p>
 *
 * @author shady2713
 */
class OAuth2ClientServiceImplTest {

    /** 已哈希密钥前缀，与实现的 BCrypt 判定口径一致。 */
    private static final String DUMMY_BCRYPT_SECRET = "$2a$10$DUMMYHASHDUMMYHASHDUMMYHASHDUMMYHASHDUMMYHASHDUMMY";

    /** 被测服务。 */
    private OAuth2ClientServiceImpl clientService;
    /** 客户端持久层替身。 */
    private OAuth2ClientMapper clientMapper;
    /** 密码编码器替身。 */
    private PasswordEncoder passwordEncoder;
    /** 缓存管理器替身。 */
    private CacheManager cacheManager;
    /** 客户端缓存替身。 */
    private Cache cache;
    /** 用例开始前的 {@code SpringUtil} 应用上下文，结束后原样恢复。 */
    private Object previousApplicationContext;
    /** 用例开始前的 {@code SpringUtil} Bean 工厂，结束后原样恢复。 */
    private Object previousBeanFactory;

    /** 装配服务与替身，并让自身代理查询返回同一实例。 */
    @BeforeEach
    void setUp() {
        clientService = new OAuth2ClientServiceImpl();
        clientMapper = mock(OAuth2ClientMapper.class);
        passwordEncoder = mock(PasswordEncoder.class);
        cacheManager = mock(CacheManager.class);
        cache = mock(Cache.class);
        ReflectionTestUtils.setField(clientService, "oauth2ClientMapper", clientMapper);
        ReflectionTestUtils.setField(clientService, "passwordEncoder", passwordEncoder);
        ReflectionTestUtils.setField(clientService, "cacheManager", cacheManager);

        previousApplicationContext = ReflectionTestUtils.getField(SpringUtil.class, "applicationContext");
        previousBeanFactory = ReflectionTestUtils.getField(SpringUtil.class, "beanFactory");
        ApplicationContext applicationContext = mock(ApplicationContext.class);
        when(applicationContext.getBean(OAuth2ClientServiceImpl.class)).thenReturn(clientService);
        ReflectionTestUtils.setField(SpringUtil.class, "applicationContext", applicationContext);
        ReflectionTestUtils.setField(SpringUtil.class, "beanFactory", null);
    }

    /** 还原 {@code SpringUtil} 静态上下文，避免影响同 JVM 内的其他用例。 */
    @AfterEach
    void tearDown() {
        ReflectionTestUtils.setField(SpringUtil.class, "applicationContext", previousApplicationContext);
        ReflectionTestUtils.setField(SpringUtil.class, "beanFactory", previousBeanFactory);
    }

    /** 创建客户端必须校验编号唯一，并以 BCrypt 保存密钥后返回新编号。 */
    @Test
    void createOAuth2ClientEncodesSecretAndReturnsId() {
        OAuth2ClientSaveReqVO reqVO = saveReqVO(null, "DUMMY-CLIENT");
        reqVO.setSecret("DUMMY-RAW-SECRET");
        when(clientMapper.selectByClientId("DUMMY-CLIENT")).thenReturn(null);
        when(passwordEncoder.encode("DUMMY-RAW-SECRET")).thenReturn(DUMMY_BCRYPT_SECRET);
        doAnswer(invocation -> {
            invocation.getArgument(0, OAuth2ClientDO.class).setId(100L);
            return 1;
        }).when(clientMapper).insert(any(OAuth2ClientDO.class));

        Long id = clientService.createOAuth2Client(reqVO);

        assertThat(id).as("创建结果必须返回落库后的主键").isEqualTo(100L);
        ArgumentCaptor<OAuth2ClientDO> captor = ArgumentCaptor.forClass(OAuth2ClientDO.class);
        verify(clientMapper).insert(captor.capture());
        assertThat(captor.getValue().getSecret()).as("明文密钥不得入库").isEqualTo(DUMMY_BCRYPT_SECRET);
        assertThat(captor.getValue().getClientId()).isEqualTo("DUMMY-CLIENT");
    }

    /** 创建客户端遇到编号重复或空密钥时必须拒绝，且不得落库。 */
    @Test
    void createOAuth2ClientRejectsDuplicateIdAndBlankSecret() {
        OAuth2ClientSaveReqVO duplicate = saveReqVO(null, "DUMMY-CLIENT");
        duplicate.setSecret("DUMMY-RAW-SECRET");
        when(clientMapper.selectByClientId("DUMMY-CLIENT")).thenReturn(client(1L, "DUMMY-CLIENT"));
        assertBusinessError(() -> clientService.createOAuth2Client(duplicate),
                ErrorCodeConstants.OAUTH2_CLIENT_EXISTS);

        OAuth2ClientSaveReqVO blankSecret = saveReqVO(null, "DUMMY-CLIENT");
        blankSecret.setSecret("   ");
        when(clientMapper.selectByClientId("DUMMY-CLIENT")).thenReturn(null);
        assertBusinessError(() -> clientService.createOAuth2Client(blankSecret),
                ErrorCodeConstants.OAUTH2_CLIENT_CLIENT_SECRET_ERROR);

        verify(clientMapper, never()).insert(any(OAuth2ClientDO.class));
    }

    /** 更新客户端未提交新密钥时必须保留原哈希，提交新密钥时必须重新编码。 */
    @Test
    void updateOAuth2ClientKeepsOrRotatesSecret() {
        OAuth2ClientDO existing = client(1L, "DUMMY-CLIENT");
        existing.setSecret(DUMMY_BCRYPT_SECRET);
        when(clientMapper.selectById(1L)).thenReturn(existing);
        when(clientMapper.selectByClientId("DUMMY-CLIENT")).thenReturn(existing);

        OAuth2ClientSaveReqVO keepSecret = saveReqVO(1L, "DUMMY-CLIENT");
        keepSecret.setSecret(null);
        clientService.updateOAuth2Client(keepSecret);

        ArgumentCaptor<OAuth2ClientDO> keepCaptor = ArgumentCaptor.forClass(OAuth2ClientDO.class);
        verify(clientMapper).updateById(keepCaptor.capture());
        assertThat(keepCaptor.getValue().getSecret()).as("未提交新密钥时必须保留原哈希")
                .isEqualTo(DUMMY_BCRYPT_SECRET);
        verify(passwordEncoder, never()).encode(anyString());

        OAuth2ClientSaveReqVO rotateSecret = saveReqVO(1L, "DUMMY-CLIENT");
        rotateSecret.setSecret("DUMMY-NEW-SECRET");
        when(passwordEncoder.encode("DUMMY-NEW-SECRET")).thenReturn("$2b$10$DUMMYROTATEDHASH");
        clientService.updateOAuth2Client(rotateSecret);

        ArgumentCaptor<OAuth2ClientDO> rotateCaptor = ArgumentCaptor.forClass(OAuth2ClientDO.class);
        verify(clientMapper, org.mockito.Mockito.times(2)).updateById(rotateCaptor.capture());
        assertThat(rotateCaptor.getAllValues().get(1).getSecret()).isEqualTo("$2b$10$DUMMYROTATEDHASH");
    }

    /** 更新不存在的客户端或编号被其他客户端占用时必须拒绝，且不得写库。 */
    @Test
    void updateOAuth2ClientRejectsMissingAndDuplicateClientId() {
        OAuth2ClientSaveReqVO absent = saveReqVO(9L, "DUMMY-CLIENT");
        when(clientMapper.selectById(9L)).thenReturn(null);
        assertBusinessError(() -> clientService.updateOAuth2Client(absent),
                ErrorCodeConstants.OAUTH2_CLIENT_NOT_EXISTS);

        OAuth2ClientSaveReqVO conflict = saveReqVO(1L, "DUMMY-CLIENT");
        when(clientMapper.selectById(1L)).thenReturn(client(1L, "DUMMY-CLIENT"));
        when(clientMapper.selectByClientId("DUMMY-CLIENT")).thenReturn(client(2L, "DUMMY-CLIENT"));
        assertBusinessError(() -> clientService.updateOAuth2Client(conflict),
                ErrorCodeConstants.OAUTH2_CLIENT_EXISTS);

        verify(clientMapper, never()).updateById(any(OAuth2ClientDO.class));
    }

    /** 删除客户端必须先确认存在，再按编号删除；批量删除必须原样转发编号集合。 */
    @Test
    void deleteOAuth2ClientValidatesThenDeletes() {
        when(clientMapper.selectById(9L)).thenReturn(null);
        assertBusinessError(() -> clientService.deleteOAuth2Client(9L),
                ErrorCodeConstants.OAUTH2_CLIENT_NOT_EXISTS);
        verify(clientMapper, never()).deleteById(9L);

        when(clientMapper.selectById(1L)).thenReturn(client(1L, "DUMMY-CLIENT"));
        clientService.deleteOAuth2Client(1L);
        verify(clientMapper).deleteById(1L);

        clientService.deleteOAuth2ClientList(List.of(1L, 2L));
        verify(clientMapper).deleteByIds(List.of(1L, 2L));
    }

    /** 客户端编号唯一性校验必须区分未命中、新增冲突、改到他人编号与保持自身编号。 */
    @Test
    void validateClientIdExistsDistinguishesCases() {
        when(clientMapper.selectByClientId("DUMMY-CLIENT")).thenReturn(null);
        clientService.validateClientIdExists(1L, "DUMMY-CLIENT");

        when(clientMapper.selectByClientId("DUMMY-CLIENT")).thenReturn(client(2L, "DUMMY-CLIENT"));
        assertBusinessError(() -> clientService.validateClientIdExists(null, "DUMMY-CLIENT"),
                ErrorCodeConstants.OAUTH2_CLIENT_EXISTS);
        assertBusinessError(() -> clientService.validateClientIdExists(1L, "DUMMY-CLIENT"),
                ErrorCodeConstants.OAUTH2_CLIENT_EXISTS);

        clientService.validateClientIdExists(2L, "DUMMY-CLIENT");
    }

    /** 按编号查询与分页查询必须原样转发到持久层。 */
    @Test
    void queryMethodsDelegateToMapper() {
        when(clientMapper.selectById(1L)).thenReturn(client(1L, "DUMMY-CLIENT"));
        assertThat(clientService.getOAuth2Client(1L).getClientId()).isEqualTo("DUMMY-CLIENT");

        OAuth2ClientPageReqVO pageReqVO = new OAuth2ClientPageReqVO();
        when(clientMapper.selectPage(pageReqVO)).thenReturn(new PageResult<>(List.of(client(1L, "DUMMY-CLIENT")), 1L));
        assertThat(clientService.getOAuth2ClientPage(pageReqVO).getTotal()).isEqualTo(1L);
    }

    /** 开放接口客户端不存在时必须按新增处理，并补齐固定属性。 */
    @Test
    void upsertEncodedOpenClientInsertsWithFixedProperties() {
        when(clientMapper.selectByClientId("DUMMY-OPEN-CLIENT")).thenReturn(null);

        clientService.upsertEncodedOpenClient("DUMMY-OPEN-CLIENT", DUMMY_BCRYPT_SECRET,
                CommonStatusEnum.ENABLE.getStatus());

        ArgumentCaptor<OAuth2ClientDO> captor = ArgumentCaptor.forClass(OAuth2ClientDO.class);
        verify(clientMapper).insert(captor.capture());
        OAuth2ClientDO inserted = captor.getValue();
        assertThat(inserted.getClientId()).isEqualTo("DUMMY-OPEN-CLIENT");
        assertThat(inserted.getSecret()).as("开放接口密钥由调用方完成哈希，不得二次编码")
                .isEqualTo(DUMMY_BCRYPT_SECRET);
        assertThat(inserted.getName()).isEqualTo("DUMMY-OPEN-CLIENT");
        assertThat(inserted.getLogo()).isEmpty();
        assertThat(inserted.getStatus()).isEqualTo(CommonStatusEnum.ENABLE.getStatus());
        assertThat(inserted.getAccessTokenValiditySeconds()).isEqualTo(7200);
        assertThat(inserted.getRefreshTokenValiditySeconds()).isEqualTo(2592000);
        assertThat(inserted.getAuthorizedGrantTypes()).containsExactly("client_credentials");
        assertThat(inserted.getScopes()).containsExactly("alert:read", "alert:subscribe");
        assertThat(inserted.getAutoApproveScopes()).containsExactly("alert:read", "alert:subscribe");
        assertThat(inserted.getAdditionalInformation()).isEqualTo("{}");
        assertThat(inserted.getDeleted()).isFalse();
        verify(passwordEncoder, never()).encode(anyString());
    }

    /** 开放接口客户端已存在时必须按更新处理，保留原编号且不新增记录。 */
    @Test
    void upsertEncodedOpenClientUpdatesExistingRecord() {
        when(clientMapper.selectByClientId("DUMMY-OPEN-CLIENT")).thenReturn(client(8L, "DUMMY-OPEN-CLIENT"));

        clientService.upsertEncodedOpenClient("DUMMY-OPEN-CLIENT", DUMMY_BCRYPT_SECRET,
                CommonStatusEnum.DISABLE.getStatus());

        ArgumentCaptor<OAuth2ClientDO> captor = ArgumentCaptor.forClass(OAuth2ClientDO.class);
        verify(clientMapper).updateById(captor.capture());
        assertThat(captor.getValue().getId()).isEqualTo(8L);
        assertThat(captor.getValue().getStatus()).isEqualTo(CommonStatusEnum.DISABLE.getStatus());
        verify(clientMapper, never()).insert(any(OAuth2ClientDO.class));
    }

    /** 更新开放接口客户端状态在客户端不存在时必须静默跳过，不产生写操作。 */
    @Test
    void updateOpenClientStatusSkipsMissingClient() {
        when(clientMapper.selectByClientId("DUMMY-OPEN-CLIENT")).thenReturn(null);

        clientService.updateOpenClientStatus("DUMMY-OPEN-CLIENT", CommonStatusEnum.DISABLE.getStatus());

        verify(clientMapper, never()).updateById(any(OAuth2ClientDO.class));

        when(clientMapper.selectByClientId("DUMMY-OPEN-CLIENT")).thenReturn(client(8L, "DUMMY-OPEN-CLIENT"));
        clientService.updateOpenClientStatus("DUMMY-OPEN-CLIENT", CommonStatusEnum.DISABLE.getStatus());

        ArgumentCaptor<OAuth2ClientDO> captor = ArgumentCaptor.forClass(OAuth2ClientDO.class);
        verify(clientMapper).updateById(captor.capture());
        assertThat(captor.getValue().getId()).isEqualTo(8L);
        assertThat(captor.getValue().getStatus()).isEqualTo(CommonStatusEnum.DISABLE.getStatus());
        assertThat(captor.getValue().getClientId()).as("状态更新不得顺带改写客户端编号").isNull();
    }

    /** 停用开放接口客户端在客户端不存在时必须静默跳过，存在时按编号删除。 */
    @Test
    void disableOpenClientDeletesOnlyWhenPresent() {
        when(clientMapper.selectByClientId("DUMMY-OPEN-CLIENT")).thenReturn(null);
        clientService.disableOpenClient("DUMMY-OPEN-CLIENT");
        verify(clientMapper, never()).deleteById(any(Long.class));

        when(clientMapper.selectByClientId("DUMMY-OPEN-CLIENT")).thenReturn(client(8L, "DUMMY-OPEN-CLIENT"));
        clientService.disableOpenClient("DUMMY-OPEN-CLIENT");
        verify(clientMapper).deleteById(8L);
    }

    /** 授权请求校验必须先确认客户端存在且启用，否则按对应错误码拒绝。 */
    @Test
    void validOAuthClientRejectsMissingAndDisabledClient() {
        when(clientMapper.selectByClientId("DUMMY-CLIENT")).thenReturn(null);
        assertBusinessError(() -> clientService.validOAuthClientFromCache("DUMMY-CLIENT", null, null, null, null),
                ErrorCodeConstants.OAUTH2_CLIENT_NOT_EXISTS);

        OAuth2ClientDO disabled = client(1L, "DUMMY-CLIENT");
        disabled.setStatus(CommonStatusEnum.DISABLE.getStatus());
        when(clientMapper.selectByClientId("DUMMY-CLIENT")).thenReturn(disabled);
        assertBusinessError(() -> clientService.validOAuthClientFromCache("DUMMY-CLIENT", null, null, null, null),
                ErrorCodeConstants.OAUTH2_CLIENT_DISABLE);
    }

    /** 提交密钥时必须按 BCrypt 比对；比对失败统一返回无效密钥，且不得升级或写库。 */
    @Test
    void validOAuthClientRejectsWrongSecret() {
        OAuth2ClientDO client = client(1L, "DUMMY-CLIENT");
        client.setSecret(DUMMY_BCRYPT_SECRET);
        when(clientMapper.selectByClientId("DUMMY-CLIENT")).thenReturn(client);
        when(passwordEncoder.matches("DUMMY-WRONG-SECRET", DUMMY_BCRYPT_SECRET)).thenReturn(false);

        assertBusinessError(() -> clientService.validOAuthClientFromCache("DUMMY-CLIENT", "DUMMY-WRONG-SECRET",
                null, null, null), ErrorCodeConstants.OAUTH2_CLIENT_CLIENT_SECRET_ERROR);
        verify(clientMapper, never()).updateById(any(OAuth2ClientDO.class));
    }

    /** 持久化密钥为空时任何密钥都不得通过，避免历史脏数据被当成免校验客户端。 */
    @Test
    void validOAuthClientRejectsEmptyStoredSecret() {
        OAuth2ClientDO client = client(1L, "DUMMY-CLIENT");
        client.setSecret(null);
        when(clientMapper.selectByClientId("DUMMY-CLIENT")).thenReturn(client);

        assertBusinessError(() -> clientService.validOAuthClientFromCache("DUMMY-CLIENT", "DUMMY-RAW-SECRET",
                null, null, null), ErrorCodeConstants.OAUTH2_CLIENT_CLIENT_SECRET_ERROR);
    }

    /** 历史明文密钥匹配成功后必须原地升级为 BCrypt，并清理该客户端缓存。 */
    @Test
    void validOAuthClientUpgradesLegacyPlainSecret() {
        OAuth2ClientDO client = client(1L, "DUMMY-CLIENT");
        client.setSecret("DUMMY-LEGACY-SECRET");
        when(clientMapper.selectByClientId("DUMMY-CLIENT")).thenReturn(client);
        when(passwordEncoder.encode("DUMMY-LEGACY-SECRET")).thenReturn(DUMMY_BCRYPT_SECRET);
        when(cacheManager.getCache(RedisKeyConstants.OAUTH_CLIENT)).thenReturn(cache);

        OAuth2ClientDO result = clientService.validOAuthClientFromCache("DUMMY-CLIENT", "DUMMY-LEGACY-SECRET",
                null, null, null);

        ArgumentCaptor<OAuth2ClientDO> captor = ArgumentCaptor.forClass(OAuth2ClientDO.class);
        verify(clientMapper).updateById(captor.capture());
        assertThat(captor.getValue().getId()).isEqualTo(1L);
        assertThat(captor.getValue().getSecret()).isEqualTo(DUMMY_BCRYPT_SECRET);
        assertThat(result.getSecret()).as("返回对象必须同步为新哈希，避免同一请求内继续持有明文")
                .isEqualTo(DUMMY_BCRYPT_SECRET);
        verify(cache).evict("DUMMY-CLIENT");
    }

    /** 历史明文密钥不匹配时必须拒绝，不得触发升级写库。 */
    @Test
    void validOAuthClientRejectsWrongLegacySecret() {
        OAuth2ClientDO client = client(1L, "DUMMY-CLIENT");
        client.setSecret("DUMMY-LEGACY-SECRET");
        when(clientMapper.selectByClientId("DUMMY-CLIENT")).thenReturn(client);

        assertBusinessError(() -> clientService.validOAuthClientFromCache("DUMMY-CLIENT", "DUMMY-WRONG-SECRET",
                null, null, null), ErrorCodeConstants.OAUTH2_CLIENT_CLIENT_SECRET_ERROR);
        verify(clientMapper, never()).updateById(any(OAuth2ClientDO.class));
    }

    /** 缓存管理器未提供客户端缓存时必须完成升级且不抛异常。 */
    @Test
    void validOAuthClientUpgradesLegacySecretWithoutCache() {
        OAuth2ClientDO client = client(1L, "DUMMY-CLIENT");
        client.setSecret("DUMMY-LEGACY-SECRET");
        when(clientMapper.selectByClientId("DUMMY-CLIENT")).thenReturn(client);
        when(passwordEncoder.encode("DUMMY-LEGACY-SECRET")).thenReturn(DUMMY_BCRYPT_SECRET);
        when(cacheManager.getCache(RedisKeyConstants.OAUTH_CLIENT)).thenReturn(null);

        OAuth2ClientDO result = clientService.validOAuthClientFromCache("DUMMY-CLIENT", "DUMMY-LEGACY-SECRET",
                null, null, null);

        assertThat(result.getSecret()).isEqualTo(DUMMY_BCRYPT_SECRET);
        verify(clientMapper).updateById(any(OAuth2ClientDO.class));
    }

    /** 授权类型、授权范围与回调地址必须逐项核对，任何一项不匹配都要拒绝。 */
    @Test
    void validOAuthClientRejectsGrantTypeScopeAndRedirectMismatch() {
        OAuth2ClientDO client = client(1L, "DUMMY-CLIENT");
        client.setSecret(DUMMY_BCRYPT_SECRET);
        client.setAuthorizedGrantTypes(List.of("authorization_code"));
        client.setScopes(List.of("alert:read"));
        client.setRedirectUris(List.of("https://example.test/callback"));
        when(clientMapper.selectByClientId("DUMMY-CLIENT")).thenReturn(client);
        when(passwordEncoder.matches("DUMMY-RAW-SECRET", DUMMY_BCRYPT_SECRET)).thenReturn(true);

        assertBusinessError(() -> clientService.validOAuthClientFromCache("DUMMY-CLIENT", "DUMMY-RAW-SECRET",
                "client_credentials", null, null), ErrorCodeConstants.OAUTH2_CLIENT_AUTHORIZED_GRANT_TYPE_NOT_EXISTS);
        assertBusinessError(() -> clientService.validOAuthClientFromCache("DUMMY-CLIENT", "DUMMY-RAW-SECRET",
                null, List.of("alert:read", "alert:subscribe"), null), ErrorCodeConstants.OAUTH2_CLIENT_SCOPE_OVER);
        assertThatThrownBy(() -> clientService.validOAuthClientFromCache("DUMMY-CLIENT", "DUMMY-RAW-SECRET",
                null, null, "https://example.test/callback-evil"))
                .isInstanceOfSatisfying(ServiceException.class, exception -> {
                    assertThat(exception.getCode())
                            .isEqualTo(ErrorCodeConstants.OAUTH2_CLIENT_REDIRECT_URI_NOT_MATCH.getCode());
                    assertThat(exception.getMessage()).as("必须回显未匹配的回调地址，便于定位接入配置")
                            .contains("callback-evil");
                });
    }

    /** 密钥、授权类型、范围与回调地址全部匹配时必须返回该客户端。 */
    @Test
    void validOAuthClientAcceptsMatchingRequest() {
        OAuth2ClientDO client = client(1L, "DUMMY-CLIENT");
        client.setSecret(DUMMY_BCRYPT_SECRET);
        client.setAuthorizedGrantTypes(List.of("authorization_code", "refresh_token"));
        client.setScopes(List.of("alert:read", "alert:subscribe"));
        client.setRedirectUris(List.of("https://example.test/callback"));
        when(clientMapper.selectByClientId("DUMMY-CLIENT")).thenReturn(client);
        when(passwordEncoder.matches("DUMMY-RAW-SECRET", DUMMY_BCRYPT_SECRET)).thenReturn(true);

        OAuth2ClientDO result = clientService.validOAuthClientFromCache("DUMMY-CLIENT", "DUMMY-RAW-SECRET",
                "authorization_code", List.of("alert:read"), "https://example.test/callback");

        assertThat(result).isSameAs(client);
        verify(clientMapper, never()).updateById(any(OAuth2ClientDO.class));
    }

    /**
     * 断言业务异常的错误码。
     *
     * @param action 触发业务校验的动作
     * @param expected 期望的业务错误码
     */
    private static void assertBusinessError(ThrowingCallable action, ErrorCode expected) {
        assertThatThrownBy(action).isInstanceOfSatisfying(ServiceException.class,
                exception -> assertThat(exception.getCode()).isEqualTo(expected.getCode()));
    }

    /**
     * 构造客户端保存参数，默认启用并带完整列表字段。
     *
     * @param id 客户端编号，新增时为空
     * @param clientId 客户端编号
     * @return 保存参数
     */
    private static OAuth2ClientSaveReqVO saveReqVO(Long id, String clientId) {
        OAuth2ClientSaveReqVO reqVO = new OAuth2ClientSaveReqVO();
        reqVO.setId(id);
        reqVO.setClientId(clientId);
        reqVO.setName("DUMMY-应用");
        reqVO.setLogo("DUMMY-图标");
        reqVO.setStatus(CommonStatusEnum.ENABLE.getStatus());
        reqVO.setAccessTokenValiditySeconds(7200);
        reqVO.setRefreshTokenValiditySeconds(2592000);
        reqVO.setRedirectUris(List.of("https://example.test/callback"));
        reqVO.setAuthorizedGrantTypes(List.of("authorization_code"));
        reqVO.setScopes(List.of("alert:read"));
        return reqVO;
    }

    /**
     * 构造启用状态的客户端。
     *
     * @param id 编号
     * @param clientId 客户端编号
     * @return 客户端
     */
    private static OAuth2ClientDO client(Long id, String clientId) {
        OAuth2ClientDO client = new OAuth2ClientDO();
        client.setId(id);
        client.setClientId(clientId);
        client.setName("DUMMY-应用");
        client.setStatus(CommonStatusEnum.ENABLE.getStatus());
        return client;
    }

}
