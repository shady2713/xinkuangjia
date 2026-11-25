package com.basicframework.module.system.service.oauth2;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.map.MapUtil;
import cn.hutool.core.util.ObjectUtil;
import com.basicframework.framework.common.enums.CommonStatusEnum;
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
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.oauth2.OAuth2ClientConstants;
import com.basicframework.module.system.service.user.AdminUserService;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception0;
import static com.basicframework.framework.common.util.collection.CollectionUtils.convertSet;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED;

/**
 * OAuth2.0 Token Service 实现类
 *
 * @author shady
 */
@Service
@Slf4j
public class OAuth2TokenServiceImpl implements OAuth2TokenService {

    /** 密码学安全随机源，用于生成 128 位不可预测的访问令牌与刷新令牌。 */
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    /** 令牌字节长度（16 字节编码为 32 位十六进制字符串，适配数据库列宽）。 */
    private static final int TOKEN_BYTE_LENGTH = 16;

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
     * 为 {@code client_credentials} 模式创建纯客户端访问令牌，不签发刷新令牌。
     *
     * @param clientId 客户端编号
     * @param scopes   授权范围
     * @return 访问令牌信息
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public OAuth2AccessTokenDO createClientAccessToken(String clientId, List<String> scopes) {
        OAuth2ClientDO clientDO = resolveClient(clientId);
        OAuth2AccessTokenDO accessTokenDO = new OAuth2AccessTokenDO();
        accessTokenDO.setAccessToken(generateAccessToken());
        accessTokenDO.setUserId(0L);
        accessTokenDO.setUserType(0);
        accessTokenDO.setUserInfo(Collections.emptyMap());
        accessTokenDO.setClientId(clientDO.getClientId());
        accessTokenDO.setScopes(scopes);
        // 数据库 refresh_token 列非空；客户端模式按 RFC 6749 §4.4.3 不落库 refresh_token 记录。
        accessTokenDO.setRefreshToken("");
        accessTokenDO.setExpiresTime(LocalDateTime.now().plusSeconds(clientDO.getAccessTokenValiditySeconds()));
        oauth2AccessTokenMapper.insert(accessTokenDO);
        return accessTokenDO;
    }

    /**
     * 刷新访问令牌。
     *
     * @param refreshToken refreshToken 参数
     * @param clientId 第三方客户端编号
     * @return 操作结果
     */
    @Override
    @Transactional(rollbackFor = Exception.class, noRollbackFor = ServiceException.class)
    public OAuth2AccessTokenDO refreshAccessToken(String refreshToken, String clientId) {
        // 查询访问令牌
        OAuth2RefreshTokenDO refreshTokenDO = oauth2RefreshTokenMapper.selectByRefreshToken(refreshToken);
        if (refreshTokenDO == null) {
            throw exception0(GlobalErrorCodeConstants.BAD_REQUEST.getCode(), "无效的刷新令牌");
        }
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
            Set<String> oldTokens = convertSet(accessTokenDOs, OAuth2AccessTokenDO::getAccessToken);
            runAfterCommitOrNow(() -> oauth2AccessTokenRedisDAO.deleteList(oldTokens));
        }

        // 已过期的情况下，删除刷新令牌
        if (refreshTokenDO.getExpiresTime().isBefore(LocalDateTime.now())) {
            oauth2RefreshTokenMapper.deleteById(refreshTokenDO.getId());
            throw exception0(GlobalErrorCodeConstants.UNAUTHORIZED.getCode(), "刷新令牌已过期");
        }
        // 已停用或已删除的管理员账号不得继续通过刷新令牌换发新的访问令牌
        if (UserTypeEnum.ADMIN.getValue().equals(refreshTokenDO.getUserType())) {
            AdminUserDO user = adminUserService.getUser(refreshTokenDO.getUserId());
            if (user == null || !CommonStatusEnum.ENABLE.getStatus().equals(user.getStatus())) {
                oauth2RefreshTokenMapper.deleteById(refreshTokenDO.getId());
                throw exception0(GlobalErrorCodeConstants.UNAUTHORIZED.getCode(), "登录已失效，请重新登录");
            }
        }

        // 创建访问令牌
        return createOAuth2AccessToken(refreshTokenDO, clientDO);
    }

    /**
     * 根据访问令牌读取数据库中的持久化会话记录；数据库记录是鉴权的唯一权威来源，不使用 Redis 实体缓存。
     *
     * @param accessToken 访问令牌
     * @return 令牌信息，未找到时返回 {@code null}
     */
    @Override
    public OAuth2AccessTokenDO getAccessToken(String accessToken) {
        return oauth2AccessTokenMapper.selectByAccessToken(accessToken);
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
        // 非内部会话客户端需核验客户端仍处于启用状态，确保禁用或删除客户端后既有令牌立即失效。
        if (!isInternalSession(accessTokenDO.getClientId())) {
            try {
                oauth2ClientService.validOAuthClientFromCache(accessTokenDO.getClientId());
            } catch (ServiceException ex) {
                throw exception0(GlobalErrorCodeConstants.UNAUTHORIZED.getCode(), "客户端已停用或不存在");
            }
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
        OAuth2AccessTokenDO accessTokenDO = oauth2AccessTokenMapper.selectByAccessToken(accessToken);
        if (accessTokenDO == null) {
            return null;
        }
        revokeAccessTokenRecord(accessTokenDO);
        return accessTokenDO;
    }

    /**
     * 按令牌记录编号与操作者平台隔离吊销访问令牌。
     *
     * @param id 令牌记录编号
     * @param operatorPlatformType 操作者管理平台类型
     * @return 被移除的访问令牌；不存在时返回 null
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public OAuth2AccessTokenDO removeAccessTokenById(Long id, String operatorPlatformType) {
        if (id == null) {
            return null;
        }
        OAuth2AccessTokenDO accessTokenDO = oauth2AccessTokenMapper.selectById(id);
        if (accessTokenDO == null) {
            return null;
        }
        if (!UserTypeEnum.ADMIN.getValue().equals(accessTokenDO.getUserType())) {
            throw exception(SYSTEM_PLATFORM_ACCESS_DENIED);
        }
        // 同步校验目标用户的平台归属、部门数据权限范围及超级管理员保护边界，防止按令牌编号越权强退。
        adminUserService.validateUserManageable(accessTokenDO.getUserId(), operatorPlatformType);
        revokeAccessTokenRecord(accessTokenDO);
        return accessTokenDO;
    }

    /**
     * 在单一事务内全量前置校验所有目标令牌及用户可管理性，再统一删除数据库记录并在提交后清理 Redis。
     *
     * @param ids 令牌记录编号集合
     * @param operatorPlatformType 操作者管理平台类型
     * @return 实际被移除的访问令牌列表
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public List<OAuth2AccessTokenDO> removeAccessTokenByIds(Collection<Long> ids, String operatorPlatformType) {
        if (CollUtil.isEmpty(ids)) {
            return Collections.emptyList();
        }
        List<OAuth2AccessTokenDO> targets = new ArrayList<>();
        Set<Long> seenIds = new HashSet<>();
        for (Long id : ids) {
            if (id == null || !seenIds.add(id)) {
                continue;
            }
            OAuth2AccessTokenDO accessTokenDO = oauth2AccessTokenMapper.selectById(id);
            if (accessTokenDO == null) {
                continue;
            }
            if (!UserTypeEnum.ADMIN.getValue().equals(accessTokenDO.getUserType())) {
                throw exception(SYSTEM_PLATFORM_ACCESS_DENIED);
            }
            adminUserService.validateUserManageable(accessTokenDO.getUserId(), operatorPlatformType);
            targets.add(accessTokenDO);
        }
        for (OAuth2AccessTokenDO target : targets) {
            revokeAccessTokenRecord(target);
        }
        return targets;
    }

    /**
     * 清理数据库中的访问令牌、同刷新令牌下可能存在的兄弟访问令牌与刷新令牌，并在事务提交后移除全部 Redis 缓存与活动标记。
     */
    private void revokeAccessTokenRecord(OAuth2AccessTokenDO accessTokenDO) {
        Set<Long> accessTokenIds = new java.util.LinkedHashSet<>();
        Set<String> tokenValues = new java.util.LinkedHashSet<>();
        if (accessTokenDO.getId() != null) {
            accessTokenIds.add(accessTokenDO.getId());
        }
        if (cn.hutool.core.util.StrUtil.isNotBlank(accessTokenDO.getAccessToken())) {
            tokenValues.add(accessTokenDO.getAccessToken());
        }
        if (cn.hutool.core.util.StrUtil.isNotBlank(accessTokenDO.getRefreshToken())) {
            List<OAuth2AccessTokenDO> siblings = oauth2AccessTokenMapper.selectListByRefreshToken(accessTokenDO.getRefreshToken());
            if (CollUtil.isNotEmpty(siblings)) {
                for (OAuth2AccessTokenDO sibling : siblings) {
                    if (sibling.getId() != null) {
                        accessTokenIds.add(sibling.getId());
                    }
                    if (cn.hutool.core.util.StrUtil.isNotBlank(sibling.getAccessToken())) {
                        tokenValues.add(sibling.getAccessToken());
                    }
                }
            }
            oauth2RefreshTokenMapper.deleteByRefreshToken(accessTokenDO.getRefreshToken());
        }
        if (accessTokenIds.size() == 1) {
            oauth2AccessTokenMapper.deleteById(accessTokenIds.iterator().next());
        } else if (!accessTokenIds.isEmpty()) {
            oauth2AccessTokenMapper.deleteByIds(accessTokenIds);
        }
        if (tokenValues.size() == 1) {
            String singleToken = tokenValues.iterator().next();
            runAfterCommitOrNow(() -> {
                oauth2AccessTokenRedisDAO.delete(singleToken);
                oauth2AccessTokenRedisDAO.deleteActive(singleToken);
            });
        } else if (!tokenValues.isEmpty()) {
            runAfterCommitOrNow(() -> oauth2AccessTokenRedisDAO.deleteList(tokenValues));
        }
    }

    /**
     * 移除指定用户的全部访问令牌与刷新令牌。
     *
     * @param userId 用户编号
     * @param userType 用户类型
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public void removeAccessToken(Long userId, Integer userType) {
        List<OAuth2AccessTokenDO> accessTokens = oauth2AccessTokenMapper.selectListByUserIdAndUserType(userId, userType);
        if (CollUtil.isNotEmpty(accessTokens)) {
            oauth2AccessTokenMapper.deleteByIds(convertSet(accessTokens, OAuth2AccessTokenDO::getId));
            Set<String> tokenValues = convertSet(accessTokens, OAuth2AccessTokenDO::getAccessToken);
            runAfterCommitOrNow(() -> oauth2AccessTokenRedisDAO.deleteList(tokenValues));
        }
        oauth2RefreshTokenMapper.deleteByUserIdAndUserType(userId, userType);
    }

    /**
     * 按调用者管理平台分页查询在线访问令牌，并将平台隔离与 {@code system_users} 数据权限下推至数据库执行。
     *
     * @param reqVO 分页条件
     * @param operatorPlatformType 操作者所属管理平台类型
     * @return 过滤后的在线令牌分页
     */
    @Override
    public PageResult<OAuth2AccessTokenDO> getAccessTokenPage(OAuth2AccessTokenPageReqVO reqVO, String operatorPlatformType) {
        return oauth2AccessTokenMapper.selectPageByPlatform(reqVO, AdminPlatformTypeEnum.defaultType(operatorPlatformType));
    }

    /**
     * 创建 OAuth2 访问令牌，并在事务提交后写入会话空闲活动标记。
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
        runAfterCommitOrNow(() -> markActive(accessTokenDO));
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
            if (user == null) {
                throw exception0(GlobalErrorCodeConstants.UNAUTHORIZED.getCode(), "登录已失效，请重新登录");
            }
            return MapUtil.builder(LoginUser.INFO_KEY_NICKNAME, user.getNickname())
                    .put(LoginUser.INFO_KEY_DEPT_ID, user.getDeptId() != null ? user.getDeptId().toString() : null).build();
        } else if (userType.equals(UserTypeEnum.MEMBER.getValue())) {
            // 注意：目前 Member 暂时不读取，可以按需实现
            return Collections.emptyMap();
        }
        throw exception0(GlobalErrorCodeConstants.BAD_REQUEST.getCode(), "用户类型不正确");
    }

    /**
     * 使用密码学安全随机数生成器签发 128 位十六进制访问令牌。
     *
     * @return 32 位小写十六进制令牌
     */
    private static String generateAccessToken() {
        byte[] bytes = new byte[TOKEN_BYTE_LENGTH];
        SECURE_RANDOM.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }

    /**
     * 使用密码学安全随机数生成器签发 128 位十六进制刷新令牌。
     *
     * @return 32 位小写十六进制令牌
     */
    private static String generateRefreshToken() {
        byte[] bytes = new byte[TOKEN_BYTE_LENGTH];
        SECURE_RANDOM.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }

    /**
     * 若当前存在活动 Spring 事务则延迟到事务成功提交后执行 Redis 同步，否则立即执行。
     *
     * @param action Redis 同步动作
     */
    private static void runAfterCommitOrNow(Runnable action) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                /** 事务提交后执行外部缓存同步。 */
                @Override
                public void afterCommit() {
                    action.run();
                }
            });
            return;
        }
        action.run();
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
