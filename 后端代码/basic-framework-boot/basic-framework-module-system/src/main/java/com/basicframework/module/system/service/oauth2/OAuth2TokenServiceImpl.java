package com.basicframework.module.system.service.oauth2;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.map.MapUtil;
import cn.hutool.core.util.IdUtil;
import cn.hutool.core.util.ObjectUtil;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.security.config.SecurityProperties;
import com.basicframework.framework.security.core.LoginUser;

import com.basicframework.module.system.controller.admin.oauth2.vo.token.OAuth2AccessTokenPageReqVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2ClientDO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2RefreshTokenDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.dal.mysql.oauth2.OAuth2AccessTokenMapper;
import com.basicframework.module.system.dal.mysql.oauth2.OAuth2RefreshTokenMapper;
import com.basicframework.module.system.dal.redis.oauth2.OAuth2AccessTokenRedisDAO;
import com.basicframework.module.system.enums.oauth2.OAuth2ClientConstants;
import com.basicframework.module.system.service.user.AdminUserService;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception0;
import static com.basicframework.framework.common.util.collection.CollectionUtils.convertSet;

/**
 * OAuth2.0 Token Service 实现类
 *
 * @author 李杰
 */
@Service
@Slf4j
public class OAuth2TokenServiceImpl implements OAuth2TokenService {

    @Resource
    private OAuth2AccessTokenMapper oauth2AccessTokenMapper;
    @Resource
    private OAuth2RefreshTokenMapper oauth2RefreshTokenMapper;

    @Resource
    private OAuth2AccessTokenRedisDAO oauth2AccessTokenRedisDAO;

    @Resource
    private OAuth2ClientService oauth2ClientService;
    @Resource
    private AdminUserService adminUserService;
    @Resource
    private SecurityProperties securityProperties;

    /**
     * 创建访问令牌。
     *
     * @param userId 用户编号
     * @param userType userType 参数
     * @param clientId 第三方客户端编号
     * @param scopes scopes 数据集合
     * @return 操作结果
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public OAuth2AccessTokenDO createAccessToken(Long userId, Integer userType, String clientId, List<String> scopes) {
        OAuth2ClientDO clientDO = resolveClient(clientId);
        // 创建刷新令牌
        OAuth2RefreshTokenDO refreshTokenDO = createOAuth2RefreshToken(userId, userType, clientDO, scopes);
        // 创建访问令牌
        return createOAuth2AccessToken(refreshTokenDO, clientDO);
    }

    /**
     * 刷新访问令牌。
     *
     * @param refreshToken refreshToken 参数
     * @param clientId 第三方客户端编号
     * @return 操作结果
     */
    @Override
    @Transactional(noRollbackFor = ServiceException.class)
    public OAuth2AccessTokenDO refreshAccessToken(String refreshToken, String clientId) {
        // 查询访问令牌
        OAuth2RefreshTokenDO refreshTokenDO = oauth2RefreshTokenMapper.selectByRefreshToken(refreshToken);
        if (refreshTokenDO == null) {
            throw exception0(GlobalErrorCodeConstants.BAD_REQUEST.getCode(), "无效的刷新令牌");
        }
        // 默认客户端已停用；升级后即使迁移尚未执行，也不允许其刷新令牌继续换发访问令牌。
        if (isLegacyDefaultClient(refreshTokenDO.getClientId())) {
            throw exception0(GlobalErrorCodeConstants.UNAUTHORIZED.getCode(), "登录已失效，请重新登录");
        }

        // 校验 Client 匹配
        OAuth2ClientDO clientDO = resolveClient(clientId);
        if (ObjectUtil.notEqual(clientId, refreshTokenDO.getClientId())) {
            throw exception0(GlobalErrorCodeConstants.BAD_REQUEST.getCode(), "刷新令牌的客户端编号不正确");
        }

        // 移除相关的访问令牌；刷新前先确认会话仍在空闲窗口内，避免空闲用户靠刷新令牌续期。
        List<OAuth2AccessTokenDO> accessTokenDOs = oauth2AccessTokenMapper.selectListByRefreshToken(refreshToken);
        assertSessionActive(refreshTokenDO, accessTokenDOs);
        if (CollUtil.isNotEmpty(accessTokenDOs)) {
            oauth2AccessTokenMapper.deleteByIds(convertSet(accessTokenDOs, OAuth2AccessTokenDO::getId));
            oauth2AccessTokenRedisDAO.deleteList(convertSet(accessTokenDOs, OAuth2AccessTokenDO::getAccessToken));
        }

        // 已过期的情况下，删除刷新令牌
        if (refreshTokenDO.getExpiresTime().isBefore(LocalDateTime.now())) {
            oauth2RefreshTokenMapper.deleteById(refreshTokenDO.getId());
            throw exception0(GlobalErrorCodeConstants.UNAUTHORIZED.getCode(), "刷新令牌已过期");
        }

        // 创建访问令牌
        return createOAuth2AccessToken(refreshTokenDO, clientDO);
    }

    /**
     * 根据访问令牌获取令牌信息。
     *
     * <p>刷新令牌只能用于刷新流程，不能作为 Bearer 访问令牌使用，避免绕过访问令牌有效期。</p>
     *
     * @param accessToken 访问令牌
     * @return 令牌信息，未找到时返回 {@code null}；过期状态由统一校验流程处理
     */
    @Override
    public OAuth2AccessTokenDO getAccessToken(String accessToken) {
        // 优先从 Redis 中获取
        OAuth2AccessTokenDO accessTokenDO = oauth2AccessTokenRedisDAO.get(accessToken);
        if (accessTokenDO != null) {
            return accessTokenDO;
        }

        // 获取不到，从 MySQL 中获取访问令牌
        accessTokenDO = oauth2AccessTokenMapper.selectByAccessToken(accessToken);

        // 如果在 MySQL 存在，则往 Redis 中写入
        if (accessTokenDO != null && !accessTokenDO.getExpiresTime().isBefore(LocalDateTime.now())) {
            oauth2AccessTokenRedisDAO.set(accessTokenDO);
        }
        return accessTokenDO;
    }

    /**
     * 检查访问令牌。
     *
     * @param accessToken accessToken 参数
     * @return 方法处理结果
     */
    @Override
    public OAuth2AccessTokenDO checkAccessToken(String accessToken) {
        OAuth2AccessTokenDO accessTokenDO = getAccessToken(accessToken);
        if (accessTokenDO == null) {
            throw exception0(GlobalErrorCodeConstants.UNAUTHORIZED.getCode(), "访问令牌不存在");
        }
        if (accessTokenDO.getExpiresTime().isBefore(LocalDateTime.now())) {
            throw exception0(GlobalErrorCodeConstants.UNAUTHORIZED.getCode(), "访问令牌已过期");
        }
        // 默认客户端已停用；拒绝其残留访问令牌，避免升级窗口内继续访问。
        if (isLegacyDefaultClient(accessTokenDO.getClientId())) {
            throw exception0(GlobalErrorCodeConstants.UNAUTHORIZED.getCode(), "登录已失效，请重新登录");
        }
        assertAccessTokenActive(accessTokenDO);
        return accessTokenDO;
    }

    /**
     * 移除访问令牌。
     *
     * @param accessToken accessToken 参数
     * @return 操作结果
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public OAuth2AccessTokenDO removeAccessToken(String accessToken) {
        // 删除访问令牌
        OAuth2AccessTokenDO accessTokenDO = oauth2AccessTokenMapper.selectByAccessToken(accessToken);
        if (accessTokenDO == null) {
            return null;
        }
        oauth2AccessTokenMapper.deleteById(accessTokenDO.getId());
        oauth2AccessTokenRedisDAO.delete(accessToken);
        oauth2AccessTokenRedisDAO.deleteActive(accessToken);
        // 删除刷新令牌
        oauth2RefreshTokenMapper.deleteByRefreshToken(accessTokenDO.getRefreshToken());
        return accessTokenDO;
    }

    /**
     * 移除访问令牌。
     *
     * @param userId 用户编号
     * @param userType userType 参数
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public void removeAccessToken(Long userId, Integer userType) {
        List<OAuth2AccessTokenDO> accessTokens = oauth2AccessTokenMapper.selectListByUserIdAndUserType(userId, userType);
        if (CollUtil.isNotEmpty(accessTokens)) {
            oauth2AccessTokenMapper.deleteByIds(convertSet(accessTokens, OAuth2AccessTokenDO::getId));
            oauth2AccessTokenRedisDAO.deleteList(convertSet(accessTokens, OAuth2AccessTokenDO::getAccessToken));
        }
        // 刷新令牌按用户直接删除，避免访问令牌已过期或已清理时留下可继续换发令牌的孤立记录。
        oauth2RefreshTokenMapper.deleteByUserIdAndUserType(userId, userType);
    }

    /**
     * 获取访问令牌分页数据。
     *
     * @param reqVO 请求参数
     * @return 查询或转换后的结果
     */
    @Override
    public PageResult<OAuth2AccessTokenDO> getAccessTokenPage(OAuth2AccessTokenPageReqVO reqVO) {
        return oauth2AccessTokenMapper.selectPage(reqVO);
    }

    /**
     * 创建OAuth2访问令牌。
     */
    private OAuth2AccessTokenDO createOAuth2AccessToken(OAuth2RefreshTokenDO refreshTokenDO, OAuth2ClientDO clientDO) {
        OAuth2AccessTokenDO accessTokenDO = new OAuth2AccessTokenDO();
        accessTokenDO.setAccessToken(generateAccessToken());
        accessTokenDO.setUserId(refreshTokenDO.getUserId());
        accessTokenDO.setUserType(refreshTokenDO.getUserType());
        accessTokenDO.setUserInfo(buildUserInfo(refreshTokenDO.getUserId(), refreshTokenDO.getUserType()));
        accessTokenDO.setClientId(clientDO.getClientId());
        accessTokenDO.setScopes(refreshTokenDO.getScopes());
        accessTokenDO.setRefreshToken(refreshTokenDO.getRefreshToken());
        accessTokenDO.setExpiresTime(LocalDateTime.now().plusSeconds(clientDO.getAccessTokenValiditySeconds()));
        oauth2AccessTokenMapper.insert(accessTokenDO);
        // 记录到 Redis 中
        oauth2AccessTokenRedisDAO.set(accessTokenDO);
        // 管理后台内部会话从创建时刻开始计算空闲窗口。
        markActive(accessTokenDO);
        return accessTokenDO;
    }

    /**
     * 创建OAuth2Refresh令牌。
     */
    private OAuth2RefreshTokenDO createOAuth2RefreshToken(Long userId, Integer userType, OAuth2ClientDO clientDO, List<String> scopes) {
        OAuth2RefreshTokenDO refreshToken = new OAuth2RefreshTokenDO();
        refreshToken.setRefreshToken(generateRefreshToken());
        refreshToken.setUserId(userId);
        refreshToken.setUserType(userType);
        refreshToken.setClientId(clientDO.getClientId());
        refreshToken.setScopes(scopes);
        refreshToken.setExpiresTime(LocalDateTime.now().plusSeconds(clientDO.getRefreshTokenValiditySeconds()));
        oauth2RefreshTokenMapper.insert(refreshToken);
        return refreshToken;
    }

    /**
     * 加载用户信息，方便 {@link com.basicframework.framework.security.core.LoginUser} 获取到昵称、部门等信息
     *
     * @param userId 用户编号
     * @param userType 用户类型
     * @return 用户信息
     */
    private Map<String, String> buildUserInfo(Long userId, Integer userType) {
        if (userId == null || userId <= 0) {
            return Collections.emptyMap();
        }
        if (userType.equals(UserTypeEnum.ADMIN.getValue())) {
            AdminUserDO user = adminUserService.getUser(userId);
            return MapUtil.builder(LoginUser.INFO_KEY_NICKNAME, user.getNickname())
                    .put(LoginUser.INFO_KEY_DEPT_ID, user.getDeptId() != null ? user.getDeptId().toString() : null).build();
        } else if (userType.equals(UserTypeEnum.MEMBER.getValue())) {
            // 注意：目前 Member 暂时不读取，可以按需实现
            return Collections.emptyMap();
        }
        throw new IllegalArgumentException("未知用户类型：" + userType);
    }

    /**
     * 生成访问令牌。
     *
     * @return 方法处理结果
     */
    private static String generateAccessToken() {
        return IdUtil.fastSimpleUUID();
    }

    /**
     * 生成Refresh令牌。
     *
     * @return 方法处理结果
     */
    private static String generateRefreshToken() {
        return IdUtil.fastSimpleUUID();
    }

    /**
     * 解析令牌所属客户端；内部会话客户端使用代码内置配置，其余客户端仍走持久化校验。
     *
     * @param clientId 客户端编号
     * @return 客户端配置
     */
    private OAuth2ClientDO resolveClient(String clientId) {
        if (OAuth2ClientConstants.CLIENT_ID_SYSTEM.equals(clientId)) {
            return oauth2ClientService.getSystemClient();
        }
        return oauth2ClientService.validOAuthClientFromCache(clientId);
    }

    /**
     * 记录管理后台访问令牌的一次有效活动，并重置空闲计时。
     *
     * <p>空闲超时只作用于内部会话客户端；开放接口客户端继续使用各自登记的有效期，
     * 不因后台会话配置提前失效。</p>
     *
     * @param accessTokenDO 访问令牌
     */
    private void markActive(OAuth2AccessTokenDO accessTokenDO) {
        if (!isIdleCheckEnabled() || !isInternalSession(accessTokenDO.getClientId())) {
            return;
        }
        try {
            oauth2AccessTokenRedisDAO.setActive(accessTokenDO.getAccessToken(), idleTimeout());
        } catch (RuntimeException ex) {
            // 令牌已经创建成功，活动标记写入失败不能回滚登录；Redis 不可用时后续校验会失败关闭。
            log.error("[markActive][访问令牌活动标记写入失败: {}]", ex.getClass().getSimpleName());
        }
    }

    /**
     * 校验管理后台访问令牌是否仍在空闲窗口内，并顺延活动时间。
     *
     * <p>Redis 不可用时按失败关闭处理，避免空闲超时在依赖故障期间静默失效。</p>
     *
     * @param accessTokenDO 访问令牌
     */
    private void assertAccessTokenActive(OAuth2AccessTokenDO accessTokenDO) {
        if (!isIdleCheckEnabled() || !isInternalSession(accessTokenDO.getClientId())) {
            return;
        }
        try {
            if (!oauth2AccessTokenRedisDAO.refreshActive(accessTokenDO.getAccessToken(), idleTimeout())) {
                throw sessionIdleTimeout();
            }
        } catch (ServiceException ex) {
            throw ex;
        } catch (RuntimeException ex) {
            log.error("[assertAccessTokenActive][空闲校验不可用: {}]", ex.getClass().getSimpleName());
            throw sessionIdleTimeout();
        }
    }

    /**
     * 刷新令牌前校验旧访问令牌是否仍有活动记录，防止空闲会话通过刷新继续续期。
     *
     * @param refreshTokenDO 刷新令牌
     * @param accessTokens 该刷新令牌关联的访问令牌
     */
    private void assertSessionActive(OAuth2RefreshTokenDO refreshTokenDO,
                                     List<OAuth2AccessTokenDO> accessTokens) {
        if (!isIdleCheckEnabled() || !isInternalSession(refreshTokenDO.getClientId())) {
            return;
        }
        try {
            boolean active = CollUtil.isNotEmpty(accessTokens) && accessTokens.stream()
                    .anyMatch(token -> oauth2AccessTokenRedisDAO.isActive(token.getAccessToken()));
            if (!active) {
                throw sessionIdleTimeout();
            }
        } catch (ServiceException ex) {
            throw ex;
        } catch (RuntimeException ex) {
            log.error("[assertSessionActive][刷新令牌空闲校验不可用: {}]", ex.getClass().getSimpleName());
            throw sessionIdleTimeout();
        }
    }

    /**
     * 判断客户端是否为管理后台内部会话客户端。
     *
     * @param clientId 客户端编号
     * @return 内部会话返回 true
     */
    private boolean isInternalSession(String clientId) {
        return OAuth2ClientConstants.CLIENT_ID_SYSTEM.equals(clientId);
    }

    /**
     * 判断是否为已停用的历史默认客户端。
     *
     * @param clientId 客户端编号
     * @return 历史默认客户端返回 true
     */
    private boolean isLegacyDefaultClient(String clientId) {
        return OAuth2ClientConstants.CLIENT_ID_LEGACY_DEFAULT.equals(clientId);
    }

    /**
     * 判断是否启用会话空闲校验。
     *
     * @return 启用返回 true
     */
    private boolean isIdleCheckEnabled() {
        return idleTimeout() != null && !idleTimeout().isZero() && !idleTimeout().isNegative();
    }

    /**
     * 读取会话空闲超时配置。
     *
     * @return 空闲超时
     */
    private Duration idleTimeout() {
        return securityProperties.getSession().getIdleTimeout();
    }

    /**
     * 构造空闲超时错误，使用 401 让前端触发重新认证而不是普通业务提示。
     *
     * @return 未抛出的服务异常
     */
    private ServiceException sessionIdleTimeout() {
        return exception0(GlobalErrorCodeConstants.UNAUTHORIZED.getCode(), "登录已超时，请重新登录");
    }

}
