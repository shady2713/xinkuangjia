package com.basicframework.module.system.service.oauth2;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.extra.spring.SpringUtil;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.module.system.controller.admin.oauth2.vo.client.OAuth2ClientPageReqVO;
import com.basicframework.module.system.controller.admin.oauth2.vo.client.OAuth2ClientSaveReqVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2ClientDO;
import com.basicframework.module.system.dal.mysql.oauth2.OAuth2ClientMapper;
import com.basicframework.module.system.dal.redis.RedisKeyConstants;
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
import java.util.Collection;
import java.util.List;

import static com.basicframework.module.system.enums.oauth2.OAuth2GrantTypeEnum.CLIENT_CREDENTIALS;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.module.system.enums.ErrorCodeConstants.*;

/**
 * OAuth2.0 Client Service 实现类
 *
 * @author 李杰
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

    /**
     * 创建 OAuth2 客户端，并以 BCrypt 保存客户端密钥。
     *
     * @param createReqVO 客户端创建参数，密钥不能为空
     * @return 新客户端主键
     */
    @Override
    public Long createOAuth2Client(OAuth2ClientSaveReqVO createReqVO) {
        validateClientIdExists(null, createReqVO.getClientId());
        OAuth2ClientDO client = BeanUtils.toBean(createReqVO, OAuth2ClientDO.class);
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
        validateClientIdExists(updateReqVO.getId(), updateReqVO.getClientId());

        OAuth2ClientDO updateObj = BeanUtils.toBean(updateReqVO, OAuth2ClientDO.class);
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
     * 新增或更新开放接口客户端，直接保存调用方已完成 BCrypt 处理的密钥。
     *
     * @param clientId 客户端编号
     * @param encodedSecret 已哈希的客户端密钥
     * @param status 客户端状态
     */
    @Override
    @CacheEvict(cacheNames = RedisKeyConstants.OAUTH_CLIENT, allEntries = true)
    public void upsertEncodedOpenClient(String clientId, String encodedSecret, Integer status) {
        OAuth2ClientDO client = oauth2ClientMapper.selectByClientId(clientId);
        if (client == null) {
            client = new OAuth2ClientDO();
            client.setClientId(clientId);
        }
        client.setSecret(encodedSecret);
        client.setName(clientId);
        client.setLogo("");
        client.setDescription("第三方开放接口客户授权");
        client.setStatus(status);
        client.setAccessTokenValiditySeconds(7200);
        client.setRefreshTokenValiditySeconds(2592000);
        client.setRedirectUris(List.of());
        client.setAuthorizedGrantTypes(List.of(CLIENT_CREDENTIALS.getGrantType()));
        client.setScopes(List.of("alert:read", "alert:subscribe"));
        client.setAutoApproveScopes(List.of("alert:read", "alert:subscribe"));
        client.setAuthorities(List.of());
        client.setResourceIds(List.of());
        client.setAdditionalInformation("{}");
        client.setDeleted(false);
        if (client.getId() == null) {
            oauth2ClientMapper.insert(client);
        } else {
            oauth2ClientMapper.updateById(client);
        }
    }

    /**
     * 更新开放接口客户端状态。
     *
     * @param clientId 客户端编号
     * @param status 客户端状态
     */
    @Override
    @CacheEvict(cacheNames = RedisKeyConstants.OAUTH_CLIENT, allEntries = true)
    public void updateOpenClientStatus(String clientId, Integer status) {
        OAuth2ClientDO client = oauth2ClientMapper.selectByClientId(clientId);
        if (client == null) {
            return;
        }
        OAuth2ClientDO update = new OAuth2ClientDO();
        update.setId(client.getId());
        update.setStatus(status);
        oauth2ClientMapper.updateById(update);
    }

    /**
     * 停用开放接口客户端。
     *
     * @param clientId 客户端编号
     */
    @Override
    @CacheEvict(cacheNames = RedisKeyConstants.OAUTH_CLIENT, allEntries = true)
    public void disableOpenClient(String clientId) {
        OAuth2ClientDO client = oauth2ClientMapper.selectByClientId(clientId);
        if (client != null) {
            oauth2ClientMapper.deleteById(client.getId());
        }
    }

    /**
     * 校验 OAuth2 客户端及本次授权请求。
     *
     * <p>回调地址必须与登记值完全一致，禁止使用前缀匹配，避免相似域名或路径绕过。</p>
     *
     * @param clientId 客户端编号
     * @param clientSecret 客户端密钥，为空时不校验
     * @param authorizedGrantType 授权方式，为空时不校验
     * @param scopes 授权范围，为空时不校验
     * @param redirectUri 回调地址，为空时不校验
     * @return 校验通过的客户端
     */
    @Override
    public OAuth2ClientDO validOAuthClientFromCache(String clientId, String clientSecret, String authorizedGrantType,
                                                    Collection<String> scopes, String redirectUri) {
        // 校验客户端存在、且开启
        OAuth2ClientDO client = getSelf().getOAuth2ClientFromCache(clientId);
        if (client == null) {
            throw exception(OAUTH2_CLIENT_NOT_EXISTS);
        }
        if (CommonStatusEnum.isDisable(client.getStatus())) {
            throw exception(OAUTH2_CLIENT_DISABLE);
        }

        // 新数据使用 BCrypt；历史明文只允许通过一次，成功后立即原地升级并清理缓存。
        if (StrUtil.isNotEmpty(clientSecret)) {
            if (!matchesClientSecret(clientSecret, client.getSecret())) {
                throw exception(OAUTH2_CLIENT_CLIENT_SECRET_ERROR);
            }
            if (!isPasswordHash(client.getSecret())) {
                upgradeLegacyClientSecret(client, clientSecret);
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
        // 校验回调地址
        if (StrUtil.isNotEmpty(redirectUri) && !CollUtil.contains(client.getRedirectUris(), redirectUri)) {
            throw exception(OAUTH2_CLIENT_REDIRECT_URI_NOT_MATCH, redirectUri);
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
     * 将校验成功的历史明文密钥升级为 BCrypt，并清理旧客户端缓存。
     *
     * @param client 当前客户端
     * @param rawSecret 已校验通过的原始密钥
     */
    private void upgradeLegacyClientSecret(OAuth2ClientDO client, String rawSecret) {
        String encodedSecret = passwordEncoder.encode(rawSecret);
        OAuth2ClientDO updateObj = new OAuth2ClientDO();
        updateObj.setId(client.getId());
        updateObj.setSecret(encodedSecret);
        oauth2ClientMapper.updateById(updateObj);
        client.setSecret(encodedSecret);
        Cache cache = cacheManager.getCache(RedisKeyConstants.OAUTH_CLIENT);
        if (cache != null) {
            cache.evict(client.getClientId());
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
