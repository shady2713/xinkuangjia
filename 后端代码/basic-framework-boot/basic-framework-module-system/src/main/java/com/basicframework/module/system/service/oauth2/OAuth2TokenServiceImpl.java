package com.basicframework.module.system.service.oauth2;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.map.MapUtil;
import cn.hutool.core.util.IdUtil;
import cn.hutool.core.util.ObjectUtil;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.security.core.LoginUser;

import com.basicframework.module.system.controller.admin.oauth2.vo.token.OAuth2AccessTokenPageReqVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2ClientDO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2RefreshTokenDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.dal.mysql.oauth2.OAuth2AccessTokenMapper;
import com.basicframework.module.system.dal.mysql.oauth2.OAuth2RefreshTokenMapper;
import com.basicframework.module.system.dal.mysql.user.AdminUserMapper;
import com.basicframework.module.system.dal.redis.oauth2.OAuth2AccessTokenRedisDAO;
import com.basicframework.module.system.enums.oauth2.OAuth2MachineToken;
import com.basicframework.module.system.service.user.AdminUserService;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.LocalDateTime;
import java.util.Collections;
import java.util.Collection;
import java.util.List;
import java.util.Map;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception0;
import static com.basicframework.framework.common.util.collection.CollectionUtils.convertSet;

/**
 * OAuth2.0 Token Service 实现类
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@Service
@Slf4j
public class OAuth2TokenServiceImpl implements OAuth2TokenService {

    @Resource
    private OAuth2AccessTokenMapper oauth2AccessTokenMapper;
    @Resource
    private OAuth2RefreshTokenMapper oauth2RefreshTokenMapper;

    @Resource
    private AdminUserMapper adminUserMapper;

    @Resource
    private OAuth2AccessTokenRedisDAO oauth2AccessTokenRedisDAO;

    @Resource
    private OAuth2ClientService oauth2ClientService;
    @Resource
    private AdminUserService adminUserService;

    /**
     * 创建访问令牌。
     *
     * <p>机器主体（{@code userId <= 0}）只签发访问令牌，不创建刷新令牌：占位用户没有真实身份可绑定，
     * 一旦允许续期就会得到不受账号状态与会话撤销约束的长期凭据。
     * 机器主体无法续期，访问令牌到期后必须重新用客户端凭据换取。</p>
     *
     * @param userId 用户编号，机器主体使用非正数占位
     * @param userType userType 参数
     * @param clientId 第三方客户端编号
     * @param scopes scopes 数据集合
     * @return 操作结果
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public OAuth2AccessTokenDO createAccessToken(Long userId, Integer userType, String clientId, List<String> scopes) {
        // 和改密共用用户锁；认证入口必须把凭据验证和这里的签发包含在同一事务中。
        lockActiveUser(userId, userType);
        OAuth2ClientDO clientDO = oauth2ClientService.validOAuthClientFromCache(clientId);
        if (isMachinePrincipal(userId)) {
            return createOAuth2MachineAccessToken(userId, userType, clientDO, scopes);
        }
        // 创建刷新令牌
        OAuth2RefreshTokenDO refreshTokenDO = createOAuth2RefreshToken(userId, userType, clientDO, scopes);
        // 创建访问令牌
        return createOAuth2AccessToken(refreshTokenDO, clientDO);
    }

    /**
     * 为真实用户刷新访问令牌，拒绝升级前遗留的机器刷新会话和机器哨兵值。
     *
     * <p>机器主体没有可锁定并核对状态的真实账号，即使历史刷新记录未过期且客户端匹配，
     * 也不能续期。拒绝机器凭据时保留原会话，不撤销其他令牌；真实用户继续沿用用户锁和当前读，
     * 成功刷新会替换同一刷新会话的访问令牌，过期刷新记录会被删除。</p>
     *
     * @param refreshToken 真实用户的刷新凭据，机器哨兵值始终无效
     * @param clientId 必须与刷新会话匹配的客户端编号
     * @return 已落库的新访问令牌
     * @throws ServiceException 凭据无效、属于机器主体、客户端不匹配、账号不可用或凭据过期时抛出
     */
    @Override
    @Transactional(noRollbackFor = ServiceException.class)
    public OAuth2AccessTokenDO refreshAccessToken(String refreshToken, String clientId) {
        // 哨兵只是机器访问记录的非空占位；即使历史脏数据存在同值刷新行也不能作为凭据使用。
        if (OAuth2MachineToken.MACHINE_NO_REFRESH_TOKEN.equals(refreshToken)) {
            throw exception0(GlobalErrorCodeConstants.BAD_REQUEST.getCode(), "无效的刷新令牌");
        }
        // 查询访问令牌
        OAuth2RefreshTokenDO refreshTokenDO = oauth2RefreshTokenMapper.selectByRefreshToken(refreshToken);
        if (refreshTokenDO == null) {
            throw exception0(GlobalErrorCodeConstants.BAD_REQUEST.getCode(), "无效的刷新令牌");
        }

        lockActiveUser(refreshTokenDO.getUserId(), refreshTokenDO.getUserType());
        // REPEATABLE READ 下普通重查可能读到锁等待前的快照，必须使用锁定当前读。
        refreshTokenDO = oauth2RefreshTokenMapper.selectByRefreshTokenForUpdate(refreshToken);
        if (refreshTokenDO == null) {
            throw exception0(GlobalErrorCodeConstants.BAD_REQUEST.getCode(), "无效的刷新令牌");
        }

        // 校验锁定当前读得到的主体，堵住旧版本已签发且仍未过期的机器刷新会话。
        if (isMachinePrincipal(refreshTokenDO.getUserId())) {
            throw exception0(GlobalErrorCodeConstants.BAD_REQUEST.getCode(), "机器主体不支持刷新令牌");
        }

        // 校验 Client 匹配
        OAuth2ClientDO clientDO = oauth2ClientService.validOAuthClientFromCache(clientId);
        if (ObjectUtil.notEqual(clientId, refreshTokenDO.getClientId())) {
            throw exception0(GlobalErrorCodeConstants.BAD_REQUEST.getCode(), "刷新令牌的客户端编号不正确");
        }

        // 移除相关的访问令牌
        List<OAuth2AccessTokenDO> accessTokenDOs = oauth2AccessTokenMapper.selectListByRefreshToken(refreshToken);
        oauth2AccessTokenMapper.deleteByRefreshToken(refreshToken);
        clearLegacyCacheAfterCommit(accessTokenDOs);

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
        // 会话撤销必须以数据库为准；历史 Redis 条目即使清理失败也不能恢复身份。
        // 不写入新令牌缓存，避免数据库事务尚未提交或回滚时缓存提前暴露会话。
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
        if (UserTypeEnum.ADMIN.getValue().equals(accessTokenDO.getUserType()) && accessTokenDO.getUserId() > 0) {
            AdminUserDO user = adminUserMapper.selectById(accessTokenDO.getUserId());
            if (user == null || !CommonStatusEnum.isEnable(user.getStatus())) {
                throw exception0(GlobalErrorCodeConstants.UNAUTHORIZED.getCode(), "用户不存在或已禁用");
            }
        }
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
        lockUser(accessTokenDO.getUserId(), accessTokenDO.getUserType());
        if (OAuth2MachineToken.MACHINE_NO_REFRESH_TOKEN.equals(accessTokenDO.getRefreshToken())) {
            // 机器令牌共享同一个哨兵刷新值，按该值删除会连带撤销所有机器主体的会话；
            // 且机器主体没有刷新会话需要清理，这里只精确删除本行。
            oauth2AccessTokenMapper.deleteById(accessTokenDO.getId());
        } else {
            // 整个刷新会话与刷新操作使用同一用户锁，避免退出后并发刷新留下新的访问令牌。
            oauth2AccessTokenMapper.deleteByRefreshToken(accessTokenDO.getRefreshToken());
            // 删除刷新令牌
            oauth2RefreshTokenMapper.deleteByRefreshToken(accessTokenDO.getRefreshToken());
        }
        clearLegacyCacheAfterCommit(List.of(accessTokenDO));
        return accessTokenDO;
    }

    /**
     * 在用户锁内撤销所有访问与刷新会话，包含无访问令牌的刷新记录。
     *
     * @param userId 用户编号
     * @param userType userType 参数
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public void removeAccessToken(Long userId, Integer userType) {
        lockUser(userId, userType);
        List<OAuth2AccessTokenDO> accessTokens = oauth2AccessTokenMapper.selectListByUserIdAndUserType(userId, userType);
        oauth2AccessTokenMapper.deleteByUserIdAndUserType(userId, userType);
        oauth2RefreshTokenMapper.deleteByUserIdAndUserType(userId, userType);
        clearLegacyCacheAfterCommit(accessTokens);
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
        return accessTokenDO;
    }

    /**
     * 为机器主体创建访问令牌，且不落库任何刷新会话。
     *
     * <p>{@code system_oauth2_access_token.refresh_token} 为 NOT NULL 且没有对应外键，
     * 机器令牌无法写 NULL，也不能写入真实刷新令牌值——写入后 {@code selectByRefreshToken}
     * 虽查不到刷新记录，但同名字段会让运维误判该会话可续期。
     * 这里写入固定哨兵值 {@link OAuth2MachineToken#MACHINE_NO_REFRESH_TOKEN}：刷新表不存在该值，
     * 刷新入口必然按“无效的刷新令牌”拒绝，撤销入口按该值删除也只命中机器令牌自身。</p>
     *
     * @param userId 机器主体占位编号，非正数
     * @param userType 认证用户类型
     * @param clientDO 已通过校验的客户端
     * @param scopes 授权范围
     * @return 已落库的机器访问令牌，{@code refreshToken} 为哨兵值而非可用凭据
     */
    private OAuth2AccessTokenDO createOAuth2MachineAccessToken(Long userId, Integer userType,
                                                                OAuth2ClientDO clientDO, List<String> scopes) {
        OAuth2AccessTokenDO accessTokenDO = new OAuth2AccessTokenDO();
        accessTokenDO.setAccessToken(generateAccessToken());
        accessTokenDO.setUserId(userId);
        accessTokenDO.setUserType(userType);
        accessTokenDO.setUserInfo(Collections.emptyMap());
        accessTokenDO.setClientId(clientDO.getClientId());
        accessTokenDO.setScopes(scopes);
        accessTokenDO.setRefreshToken(OAuth2MachineToken.MACHINE_NO_REFRESH_TOKEN);
        accessTokenDO.setExpiresTime(LocalDateTime.now().plusSeconds(clientDO.getAccessTokenValiditySeconds()));
        oauth2AccessTokenMapper.insert(accessTokenDO);
        return accessTokenDO;
    }

    /**
     * 判断是否是不对应任何真实用户的机器主体。
     *
     * <p>客户端凭据模式没有登录用户，框架以 0 作为占位编号；真实用户编号恒为正数。</p>
     *
     * @param userId 用户编号，允许为 {@code null}
     * @return 非正数或 {@code null} 时返回 {@code true}
     */
    private static boolean isMachinePrincipal(Long userId) {
        return userId == null || userId <= 0;
    }

    /**
     * 串行化真实管理员会话操作；客户端凭据模式的占位用户不持有用户行锁。
     *
     * @param userId 真实用户编号，客户端凭据模式使用零
     * @param userType 认证用户类型
     * @return 管理员当前记录；其他类型或占位用户返回 {@code null}
     */
    private AdminUserDO lockUser(Long userId, Integer userType) {
        if (UserTypeEnum.ADMIN.getValue().equals(userType) && userId != null && userId > 0) {
            return adminUserMapper.selectByIdForUpdate(userId);
        }
        return null;
    }

    /** 在锁内确认管理员仍存在且启用，防止短信或刷新入口为禁用账号签发令牌。 */
    private void lockActiveUser(Long userId, Integer userType) {
        AdminUserDO user = lockUser(userId, userType);
        if (UserTypeEnum.ADMIN.getValue().equals(userType) && userId != null && userId > 0
                && (user == null || !CommonStatusEnum.isEnable(user.getStatus()))) {
            throw exception0(GlobalErrorCodeConstants.UNAUTHORIZED.getCode(), "用户不存在或已禁用");
        }
    }

    /**
     * 提交成功后清理旧版本遗留的缓存；清理失败不影响数据库已生效的撤销结果。
     *
     * @param tokens 待清理的旧访问会话，空集合不注册事务回调
     */
    private void clearLegacyCacheAfterCommit(Collection<OAuth2AccessTokenDO> tokens) {
        if (CollUtil.isEmpty(tokens)) {
            return;
        }
        Collection<String> tokenValues = convertSet(tokens, OAuth2AccessTokenDO::getAccessToken);
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            /** 只记录异常类型和数量，避免把令牌或 Redis 连接凭据写入日志。 */
            @Override
            public void afterCommit() {
                try {
                    oauth2AccessTokenRedisDAO.deleteList(tokenValues);
                } catch (RuntimeException exception) {
                    log.warn("旧会话缓存清理失败，数据库撤销保持生效；数量={}，异常类型={}",
                            tokenValues.size(), exception.getClass().getSimpleName());
                }
            }
        });
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

}
