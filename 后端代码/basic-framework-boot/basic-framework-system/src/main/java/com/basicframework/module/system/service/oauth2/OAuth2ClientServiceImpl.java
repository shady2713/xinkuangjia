package com.basicframework.module.system.service.oauth2;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.extra.spring.SpringUtil;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.security.config.SecurityProperties;
import com.basicframework.module.system.controller.admin.oauth2.vo.client.OAuth2ClientPageReqVO;
import com.basicframework.module.system.controller.admin.oauth2.vo.client.OAuth2ClientSaveReqVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2ClientDO;
import com.basicframework.module.system.dal.mysql.oauth2.OAuth2ClientMapper;
import com.basicframework.module.system.dal.redis.RedisKeyConstants;
import com.basicframework.module.system.enums.oauth2.OAuth2ClientConstants;
import com.basicframework.module.system.enums.oauth2.OAuth2GrantTypeEnum;
import com.google.common.annotations.VisibleForTesting;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.validation.annotation.Validated;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.module.system.enums.ErrorCodeConstants.*;

/**
 * OAuth2.0 Client Service 实现类
 *
 * @author shady
 */
@Service
@Validated
@Slf4j
public class OAuth2ClientServiceImpl implements OAuth2ClientService {

    @Resource
    private OAuth2ClientMapper oauth2ClientMapper;
    @Resource
    private PasswordEncoder passwordEncoder;
    @Resource
    private CacheManager cacheManager;
    @Resource
    private SecurityProperties securityProperties;

    /**
     * 创建 OAuth2 客户端，并以 BCrypt 保存客户端密钥。
     *
     * @param createReqVO 客户端创建参数，密钥不能为空
     * @return 新客户端主键
     */
    @Override
    public Long createOAuth2Client(OAuth2ClientSaveReqVO createReqVO) {
        String normalizedClientId = StrUtil.trim(createReqVO.getClientId());
        String normalizedName = StrUtil.trim(createReqVO.getName());
        validateClientIdExists(null, normalizedClientId);
        validateAuthorizedGrantTypes(null, createReqVO.getAuthorizedGrantTypes());
        OAuth2ClientDO client = BeanUtils.toBean(createReqVO, OAuth2ClientDO.class);
        client.setId(null);
        client.setClientId(normalizedClientId);
        client.setName(normalizedName);
        client.setSecret(passwordEncoder.encode(requireClientSecret(createReqVO.getSecret())));
        oauth2ClientMapper.insert(client);
        return client.getId();
    }

    /**
     * 更新 OAuth2 客户端；未提交新密钥时保留原哈希，提交时执行密钥轮换。
     *
     * @param updateReqVO 客户端更新参数
     */
    @Override
    @CacheEvict(cacheNames = RedisKeyConstants.OAUTH_CLIENT,
            allEntries = true) // allEntries 清空所有缓存，因为可能修改到 clientId 字段，不好清理
    public void updateOAuth2Client(OAuth2ClientSaveReqVO updateReqVO) {
        OAuth2ClientDO existing = validateOAuth2ClientExists(updateReqVO.getId());
        String normalizedClientId = StrUtil.trim(updateReqVO.getClientId());
        String normalizedName = StrUtil.trim(updateReqVO.getName());
        validateClientIdExists(updateReqVO.getId(), normalizedClientId);
        validateAuthorizedGrantTypes(existing.getAuthorizedGrantTypes(), updateReqVO.getAuthorizedGrantTypes());

        OAuth2ClientDO updateObj = BeanUtils.toBean(updateReqVO, OAuth2ClientDO.class);
        updateObj.setClientId(normalizedClientId);
        updateObj.setName(normalizedName);
        updateObj.setSecret(StrUtil.isBlank(updateReqVO.getSecret())
                ? existing.getSecret() : passwordEncoder.encode(updateReqVO.getSecret()));
        oauth2ClientMapper.updateById(updateObj);
    }

    /**
     * 删除单个 OAuth2 客户端并清理客户端缓存。
     *
     * @param id 客户端主键
     */
    @Override
    @CacheEvict(cacheNames = RedisKeyConstants.OAUTH_CLIENT,
            allEntries = true) // allEntries 清空所有缓存，因为 id 不是直接的缓存 key，不好清理
    public void deleteOAuth2Client(Long id) {
        validateOAuth2ClientExists(id);
        oauth2ClientMapper.deleteById(id);
    }

    /**
     * 批量删除 OAuth2 客户端并清理客户端缓存。
     *
     * @param ids 客户端主键集合
     */
    @Override
    @CacheEvict(cacheNames = RedisKeyConstants.OAUTH_CLIENT,
            allEntries = true) // allEntries 清空所有缓存，因为 id 不是直接的缓存 key，不好清理
    public void deleteOAuth2ClientList(List<Long> ids) {
        oauth2ClientMapper.deleteByIds(ids);
    }

    /**
     * 校验客户端存在并返回当前持久化数据，供更新时保留密钥使用。
     *
     * @param id 客户端主键
     * @return 当前客户端
     */
    private OAuth2ClientDO validateOAuth2ClientExists(Long id) {
        OAuth2ClientDO client = oauth2ClientMapper.selectById(id);
        if (client == null) {
            throw exception(OAUTH2_CLIENT_NOT_EXISTS);
        }
        return client;
    }

    /**
     * 校验客户端编号未被其他记录占用。
     *
     * @param id 当前客户端主键，创建时为空
     * @param clientId 客户端编号
     */
    @VisibleForTesting
    void validateClientIdExists(Long id, String clientId) {
        OAuth2ClientDO client = oauth2ClientMapper.selectByClientId(clientId);
        if (client == null) {
            return;
        }
        // 如果 id 为空，说明不用比较是否为相同 id 的客户端
        if (id == null) {
            throw exception(OAUTH2_CLIENT_EXISTS);
        }
        if (!client.getId().equals(id)) {
            throw exception(OAUTH2_CLIENT_EXISTS);
        }
    }

    /**
     * 按主键查询 OAuth2 客户端。
     *
     * @param id 客户端主键
     * @return 客户端，不存在时返回 null
     */
    @Override
    public OAuth2ClientDO getOAuth2Client(Long id) {
        return oauth2ClientMapper.selectById(id);
    }

    /**
     * 按客户端编号从缓存查询 OAuth2 客户端。
     *
     * @param clientId 客户端编号
     * @return 客户端，不存在时返回 null
     */
    @Override
    @Cacheable(cacheNames = RedisKeyConstants.OAUTH_CLIENT, key = "#clientId",
            unless = "#result == null")
    public OAuth2ClientDO getOAuth2ClientFromCache(String clientId) {
        return oauth2ClientMapper.selectByClientId(clientId);
    }

    /**
     * 构造管理后台内部会话客户端。
     *
     * <p>该客户端只在内存中生成，不写入数据库，也不参与开放接口的客户端密钥和授权类型校验。
     * 有效期直接读取会话配置，避免后台登录依赖可被删除或误改的 default 客户端记录。</p>
     *
     * @return 内部会话客户端配置
     */
    @Override
    public OAuth2ClientDO getSystemClient() {
        SecurityProperties.Session session = securityProperties.getSession();
        OAuth2ClientDO client = new OAuth2ClientDO();
        client.setClientId(OAuth2ClientConstants.CLIENT_ID_SYSTEM);
        client.setName("管理后台内部会话");
        client.setDescription("管理后台登录与刷新令牌使用的内部客户端，不参与开放接口授权");
        client.setSecret("");
        client.setStatus(CommonStatusEnum.ENABLE.getStatus());
        client.setAccessTokenValiditySeconds(toValiditySeconds(session.getAccessTokenValidity()));
        client.setRefreshTokenValiditySeconds(toValiditySeconds(session.getRefreshTokenValidity()));
        client.setAuthorizedGrantTypes(List.of());
        client.setScopes(List.of());
        return client;
    }

    /**
     * 将会话有效期转为令牌表使用的秒数，至少保留 1 秒并避免整数溢出。
     *
     * @param duration 配置的有效期
     * @return 秒数
     */
    private int toValiditySeconds(Duration duration) {
        long seconds = duration == null ? 0L : duration.getSeconds();
        return (int) Math.max(1L, Math.min(Integer.MAX_VALUE, seconds));
    }

    /**
     * 分页查询 OAuth2 客户端。
     *
     * @param pageReqVO 分页条件
     * @return 客户端分页数据
     */
    @Override
    public PageResult<OAuth2ClientDO> getOAuth2ClientPage(OAuth2ClientPageReqVO pageReqVO) {
        return oauth2ClientMapper.selectPage(pageReqVO);
    }

    /**
     * 校验 OAuth2 客户端及本次授权请求。
     *
     * @param clientId 客户端编号
     * @param clientSecret 客户端密钥，为空时不校验
     * @param authorizedGrantType 授权方式，为空时不校验
     * @param scopes 授权范围，为空时不校验
     * @return 校验通过的客户端
     */
    @Override
    public OAuth2ClientDO validOAuthClientFromCache(String clientId, String clientSecret, String authorizedGrantType,
                                                    Collection<String> scopes) {
        // 校验客户端存在、且开启
        OAuth2ClientDO client = requireEnabledClient(getSelf().getOAuth2ClientFromCache(clientId));

        // 新数据使用 BCrypt；历史明文仅在存储值仍为本次已校验值时条件升级并清理缓存。
        if (StrUtil.isNotEmpty(clientSecret)) {
            if (!matchesClientSecret(clientSecret, client.getSecret())) {
                throw exception(OAUTH2_CLIENT_CLIENT_SECRET_ERROR);
            }
            if (!isPasswordHash(client.getSecret()) && !upgradeLegacyClientSecret(client, clientSecret)) {
                // 条件升级未命中说明存储值已被并发修改：以数据库当前状态重新校验，不覆盖新值。
                client = requireEnabledClient(oauth2ClientMapper.selectByClientId(clientId));
                if (!matchesClientSecret(clientSecret, client.getSecret())) {
                    throw exception(OAUTH2_CLIENT_CLIENT_SECRET_ERROR);
                }
            }
        }
        // 校验授权方式
        if (StrUtil.isNotEmpty(authorizedGrantType) && !CollUtil.contains(client.getAuthorizedGrantTypes(), authorizedGrantType)) {
            throw exception(OAUTH2_CLIENT_AUTHORIZED_GRANT_TYPE_NOT_EXISTS);
        }
        // 校验授权范围
        if (CollUtil.isNotEmpty(scopes) && !CollUtil.containsAll(client.getScopes(), scopes)) {
            throw exception(OAUTH2_CLIENT_SCOPE_OVER);
        }
        return client;
    }

    /**
     * 校验创建请求必须提交非空客户端密钥。
     *
     * @param clientSecret 原始客户端密钥
     * @return 未修改的原始密钥
     */
    private String requireClientSecret(String clientSecret) {
        if (StrUtil.isBlank(clientSecret)) {
            throw exception(OAUTH2_CLIENT_CLIENT_SECRET_ERROR);
        }
        return clientSecret;
    }

    /**
     * 比较原始密钥与持久化值；BCrypt 使用 PasswordEncoder，历史明文使用常量时间比较。
     *
     * @param rawSecret 请求提交的原始密钥
     * @param storedSecret 数据库存储的哈希或历史明文
     * @return 密钥匹配时返回 true
     */
    private boolean matchesClientSecret(String rawSecret, String storedSecret) {
        if (StrUtil.isEmpty(storedSecret)) {
            return false;
        }
        if (isPasswordHash(storedSecret)) {
            return passwordEncoder.matches(rawSecret, storedSecret);
        }
        return MessageDigest.isEqual(rawSecret.getBytes(StandardCharsets.UTF_8),
                storedSecret.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 判断持久化密钥是否属于 BCrypt 格式。
     *
     * @param storedSecret 数据库存储值
     * @return BCrypt 哈希返回 true
     */
    private boolean isPasswordHash(String storedSecret) {
        return StrUtil.startWithAny(storedSecret, "$2a$", "$2b$", "$2y$");
    }

    /**
     * 仅当存储值仍为已校验的历史明文时升级为 BCrypt，并始终清理该客户端缓存；不修改传入的缓存对象。
     *
     * @param client 本次校验使用的客户端
     * @param rawSecret 已校验通过的原始密钥
     * @return 升级成功返回 true；存储值已被并发修改时返回 false
     */
    private boolean upgradeLegacyClientSecret(OAuth2ClientDO client, String rawSecret) {
        boolean upgraded = oauth2ClientMapper.updateSecretByIdAndSecret(client.getId(), client.getSecret(),
                passwordEncoder.encode(rawSecret)) > 0;
        Cache cache = cacheManager.getCache(RedisKeyConstants.OAUTH_CLIENT);
        if (cache != null) {
            cache.evict(client.getClientId());
        }
        return upgraded;
    }

    /**
     * 校验客户端存在且启用。
     *
     * @param client 客户端
     * @return 校验通过的客户端
     */
    private OAuth2ClientDO requireEnabledClient(OAuth2ClientDO client) {
        if (client == null) {
            throw exception(OAUTH2_CLIENT_NOT_EXISTS);
        }
        if (CommonStatusEnum.isDisable(client.getStatus())) {
            throw exception(OAUTH2_CLIENT_DISABLE);
        }
        return client;
    }

    /**
     * 新增的授权类型只允许开放入口实际支持的 client_credentials；已持久化的历史值原样保留。
     *
     * @param existingGrantTypes 已持久化授权类型，创建时为空
     * @param grantTypes 请求授权类型
     */
    private void validateAuthorizedGrantTypes(List<String> existingGrantTypes, List<String> grantTypes) {
        Set<String> requested = new HashSet<>(CollUtil.emptyIfNull(grantTypes));
        if (existingGrantTypes != null && requested.equals(new HashSet<>(existingGrantTypes))) {
            return;
        }
        if (!requested.equals(Set.of(OAuth2GrantTypeEnum.CLIENT_CREDENTIALS.getGrantType()))) {
            throw exception(OAUTH2_CLIENT_AUTHORIZED_GRANT_TYPE_NOT_EXISTS);
        }
    }

    /**
     * 获得自身的代理对象，解决 AOP 生效问题
     *
     * @return 自己
     */
    private OAuth2ClientServiceImpl getSelf() {
        return SpringUtil.getBean(getClass());
    }

}
