package com.basicframework.module.system.service.user;

import com.basicframework.framework.common.api.config.ConfigApi;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.module.system.controller.admin.auth.vo.AuthRegisterReqVO;
import com.basicframework.module.system.controller.admin.user.vo.profile.UserProfileUpdateReqVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserSaveReqVO;
import com.basicframework.module.system.dal.dataobject.dept.UserPostDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.dal.mysql.dept.UserPostMapper;
import com.basicframework.module.system.dal.mysql.user.AdminUserMapper;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.framework.auth.config.AdminAuthenticationProperties;
import com.basicframework.module.system.service.dept.DeptService;
import com.basicframework.module.system.service.dept.PostService;
import com.basicframework.module.system.service.oauth2.OAuth2TokenService;
import com.basicframework.module.system.service.permission.PermissionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Collection;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证后台用户服务写入路径的平台归属、默认值与派生数据契约。
 *
 * <p>写入路径与读取路径的风险不同：读取路径错了会多看到别人平台的数据，写入路径错了会直接把
 * 账号落到错误的平台或带上不该有的授权。这里集中验证三件事：平台归属一律以可信入口为准而不是
 * 请求体字段；请求体里的密码在改用户时必须被丢弃；岗位关联要按新增/删除的差集落库，保留已授权
 * 岗位不动。</p>
 *
 * <p>持久层按进程外边界替换为替身，服务内的平台判定、默认值、差集计算与异常类型全部真实执行；
 * 断言核对落库对象的字段归属以及替身实际收到的岗位增删集合。</p>
 *
 * @author shady2713
 */
class AdminUserServiceImplWritePathTest {

    /** 当前业务管理平台类型。 */
    private static final String PLATFORM = AdminPlatformTypeEnum.BUSINESS_ADMIN.getType();

    /** 另一个管理平台类型，用于验证请求体伪造平台字段被纠正。 */
    private static final String OTHER_PLATFORM = AdminPlatformTypeEnum.SUPER_ADMIN.getType();

    /** 被测服务。 */
    private AdminUserServiceImpl adminUserService;
    /** 用户持久层替身。 */
    private AdminUserMapper userMapper;
    /** 用户岗位持久层替身。 */
    private UserPostMapper userPostMapper;
    /** 部门服务替身。 */
    private DeptService deptService;
    /** 岗位服务替身。 */
    private PostService postService;
    /** 权限服务替身，服务经延迟提供者获取。 */
    private PermissionService permissionService;
    /** 口令编码器替身。 */
    private PasswordEncoder passwordEncoder;
    /** 配置服务替身。 */
    private ConfigApi configApi;
    /** 认证配置替身。 */
    private AdminAuthenticationProperties authenticationProperties;
    /** 令牌服务替身，服务经延迟提供者获取。 */
    private OAuth2TokenService oauth2TokenService;

    /**
     * 装配服务与全部替身，并把两个延迟提供者固定到同一替身实例。
     */
    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        adminUserService = new AdminUserServiceImpl();
        userMapper = mock(AdminUserMapper.class);
        userPostMapper = mock(UserPostMapper.class);
        deptService = mock(DeptService.class);
        postService = mock(PostService.class);
        permissionService = mock(PermissionService.class);
        passwordEncoder = mock(PasswordEncoder.class);
        configApi = mock(ConfigApi.class);
        authenticationProperties = mock(AdminAuthenticationProperties.class);
        oauth2TokenService = mock(OAuth2TokenService.class);

        ObjectProvider<PermissionService> permissionServiceProvider = mock(ObjectProvider.class);
        when(permissionServiceProvider.getObject()).thenReturn(permissionService);
        ObjectProvider<OAuth2TokenService> oauth2TokenServiceProvider = mock(ObjectProvider.class);
        when(oauth2TokenServiceProvider.getObject()).thenReturn(oauth2TokenService);

        ReflectionTestUtils.setField(adminUserService, "userMapper", userMapper);
        ReflectionTestUtils.setField(adminUserService, "userPostMapper", userPostMapper);
        ReflectionTestUtils.setField(adminUserService, "deptService", deptService);
        ReflectionTestUtils.setField(adminUserService, "postService", postService);
        ReflectionTestUtils.setField(adminUserService, "permissionServiceProvider", permissionServiceProvider);
        ReflectionTestUtils.setField(adminUserService, "passwordEncoder", passwordEncoder);
        ReflectionTestUtils.setField(adminUserService, "applicationContext", mock(org.springframework.context.ApplicationContext.class));
        ReflectionTestUtils.setField(adminUserService, "configApi", configApi);
        ReflectionTestUtils.setField(adminUserService, "authenticationProperties", authenticationProperties);
        ReflectionTestUtils.setField(adminUserService, "oauth2TokenServiceProvider", oauth2TokenServiceProvider);
    }

    /** 创建用户时平台归属必须以可信入口为准，请求体伪造的平台字段必须被覆盖。 */
    @Test
    void createUserForgesPlatformFieldToTrustedEntry() {
        when(passwordEncoder.encode("DUMMY-raw")).thenReturn("DUMMY-encoded");
        doAnswerAssignId();
        UserSaveReqVO reqVO = new UserSaveReqVO();
        reqVO.setUsername("zhangsan");
        reqVO.setPassword("DUMMY-raw");
        reqVO.setUserType(OTHER_PLATFORM);

        Long userId = adminUserService.createUser(reqVO, PLATFORM);

        ArgumentCaptor<AdminUserDO> captor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).insert(captor.capture());
        assertThat(captor.getValue().getUserType()).as("请求体不得决定账号归属平台").isEqualTo(PLATFORM);
        assertThat(captor.getValue().getUserType()).isNotEqualTo(OTHER_PLATFORM);
        assertThat(captor.getValue().getPassword()).isEqualTo("DUMMY-encoded");
        assertThat(captor.getValue().getStatus()).as("未显式指定状态时默认开启").isEqualTo(CommonStatusEnum.ENABLE.getStatus());
        assertThat(userId).isNotNull();
    }

    /** 更新未传头像时必须回填旧头像，否则操作日志会把这次保存误报成"删除头像"。 */
    @Test
    void updateUserBackfillsAvatarForOperationLog() {
        AdminUserDO stored = user(31L, PLATFORM);
        stored.setAvatar("DUMMY-old-avatar");
        when(userMapper.selectByIdForUpdate(31L)).thenReturn(stored);
        when(userMapper.selectById(31L)).thenReturn(stored);
        when(userPostMapper.selectListByUserId(31L)).thenReturn(List.of());
        UserSaveReqVO reqVO = new UserSaveReqVO();
        reqVO.setId(31L);
        reqVO.setUsername("zhangsan");

        adminUserService.updateUser(reqVO, PLATFORM);

        assertThat(reqVO.getAvatar()).as("缺省头像必须回填旧值").isEqualTo("DUMMY-old-avatar");
        ArgumentCaptor<AdminUserDO> captor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).updateById(captor.capture());
        assertThat(captor.getValue().getAvatar()).as("回填只服务于日志上下文，不得写库").isNull();
    }

    /** 更新显式传了头像时必须原样沿用，不得被回填逻辑覆盖成旧值。 */
    @Test
    void updateUserKeepsProvidedAvatar() {
        AdminUserDO stored = user(32L, PLATFORM);
        stored.setAvatar("DUMMY-old-avatar");
        when(userMapper.selectByIdForUpdate(32L)).thenReturn(stored);
        when(userMapper.selectById(32L)).thenReturn(stored);
        when(userPostMapper.selectListByUserId(32L)).thenReturn(List.of());
        UserSaveReqVO reqVO = new UserSaveReqVO();
        reqVO.setId(32L);
        reqVO.setUsername("zhangsan");
        reqVO.setAvatar("DUMMY-new-avatar");

        adminUserService.updateUser(reqVO, PLATFORM);

        assertThat(reqVO.getAvatar()).isEqualTo("DUMMY-new-avatar");
        ArgumentCaptor<AdminUserDO> captor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).updateById(captor.capture());
        assertThat(captor.getValue().getAvatar()).isEqualTo("DUMMY-new-avatar");
    }

    /** 创建用户时岗位必须一次性批量落库，且带上新生成的用户编号。 */
    @Test
    void createUserInsertsPostLinksInOneBatch() {
        when(passwordEncoder.encode("DUMMY-raw")).thenReturn("DUMMY-encoded");
        doAnswerAssignId();
        UserSaveReqVO reqVO = new UserSaveReqVO();
        reqVO.setUsername("zhangsan");
        reqVO.setPassword("DUMMY-raw");
        reqVO.setPostIds(Set.of(5L, 6L));

        adminUserService.createUser(reqVO, PLATFORM);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<UserPostDO>> captor = ArgumentCaptor.forClass(Collection.class);
        verify(userPostMapper).insertBatch(captor.capture());
        assertThat(captor.getValue()).hasSize(2);
        assertThat(captor.getValue()).extracting(UserPostDO::getPostId).containsExactlyInAnyOrder(5L, 6L);
        assertThat(captor.getValue()).allSatisfy(userPost -> assertThat(userPost.getUserId()).isEqualTo(1001L));
    }

    /** 创建用户命中已占用账号名时必须拒绝，不允许靠换平台抢注同名账号。 */
    @Test
    void createUserRejectsDuplicateUsername() {
        when(userMapper.selectByUsernameAndUserType("zhangsan", PLATFORM)).thenReturn(user(31L, PLATFORM));
        UserSaveReqVO reqVO = new UserSaveReqVO();
        reqVO.setUsername("zhangsan");
        reqVO.setPassword("DUMMY-raw");

        assertThatThrownBy(() -> adminUserService.createUser(reqVO, PLATFORM))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.USER_USERNAME_EXISTS.getCode());
        verify(userMapper, never()).insert(any(AdminUserDO.class));
    }

    /** 更新用户时请求体里的密码必须被丢弃，改密码只能走专用改密入口。 */
    @Test
    void updateUserDiscardsRequestBodyPassword() {
        when(userMapper.selectByIdForUpdate(31L)).thenReturn(user(31L, PLATFORM));
        when(userMapper.selectById(31L)).thenReturn(user(31L, PLATFORM));
        when(userPostMapper.selectListByUserId(31L)).thenReturn(List.of());
        UserSaveReqVO reqVO = new UserSaveReqVO();
        reqVO.setId(31L);
        reqVO.setUsername("zhangsan");
        reqVO.setPassword("DUMMY-raw");

        adminUserService.updateUser(reqVO, PLATFORM);

        assertThat(reqVO.getPassword()).as("普通更新入口不得写密码").isNull();
        ArgumentCaptor<AdminUserDO> captor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).updateById(captor.capture());
        assertThat(captor.getValue().getPassword()).isNull();
        assertThat(captor.getValue().getUserType()).isEqualTo(PLATFORM);
    }

    /** 更新岗位按差集落库：只新增缺少的、只删除被收回的，已授权岗位保持不动。 */
    @Test
    void updateUserAppliesPostDifference() {
        when(userMapper.selectByIdForUpdate(31L)).thenReturn(user(31L, PLATFORM));
        when(userMapper.selectById(31L)).thenReturn(user(31L, PLATFORM));
        when(userPostMapper.selectListByUserId(31L)).thenReturn(List.of(userPost(31L, 5L), userPost(31L, 6L)));
        UserSaveReqVO reqVO = new UserSaveReqVO();
        reqVO.setId(31L);
        reqVO.setUsername("zhangsan");
        reqVO.setPostIds(Set.of(6L, 7L));

        adminUserService.updateUser(reqVO, PLATFORM);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<UserPostDO>> insertCaptor = ArgumentCaptor.forClass(Collection.class);
        verify(userPostMapper).insertBatch(insertCaptor.capture());
        assertThat(insertCaptor.getValue()).as("只应新增缺少的岗位").hasSize(1);
        assertThat(insertCaptor.getValue().iterator().next().getPostId()).isEqualTo(7L);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<Long>> deleteCaptor = ArgumentCaptor.forClass(Collection.class);
        verify(userPostMapper).deleteByUserIdAndPostId(eq(31L), deleteCaptor.capture());
        assertThat(deleteCaptor.getValue()).as("只应删除被收回的岗位").containsExactly(5L);
    }

    /** 跨平台更新必须被拒绝，且不得写入主表或岗位关联。 */
    @Test
    void updateUserRejectsCrossPlatform() {
        when(userMapper.selectByIdForUpdate(41L)).thenReturn(user(41L, OTHER_PLATFORM));
        when(userMapper.selectById(41L)).thenReturn(user(41L, OTHER_PLATFORM));
        UserSaveReqVO reqVO = new UserSaveReqVO();
        reqVO.setId(41L);
        reqVO.setUsername("zhangsan");

        assertThatThrownBy(() -> adminUserService.updateUser(reqVO, PLATFORM))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED.getCode());
        verify(userMapper, never()).updateById(any(AdminUserDO.class));
        verify(userPostMapper, never()).insertBatch(anyCollection());
    }

    /** 注册开关关闭时必须拒绝注册，不允许绕过配置自行开户。 */
    @Test
    void registerUserRejectsWhenRegistrationDisabled() {
        when(authenticationProperties.isRegistrationEnabled()).thenReturn(false);
        when(configApi.getConfigValueByKey("system.user.register-enabled")).thenReturn("true");

        assertThatThrownBy(() -> adminUserService.registerUser(registerReq()))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.USER_REGISTER_DISABLED.getCode());
        verify(userMapper, never()).insert(any(AdminUserDO.class));
    }

    /** 配置项与代码开关不一致时同样拒绝注册，两处开关任一关闭即关闭。 */
    @Test
    void registerUserRejectsWhenConfigDisablesRegistration() {
        when(authenticationProperties.isRegistrationEnabled()).thenReturn(true);
        when(configApi.getConfigValueByKey("system.user.register-enabled")).thenReturn("false");

        assertThatThrownBy(() -> adminUserService.registerUser(registerReq()))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.USER_REGISTER_DISABLED.getCode());
        verify(userMapper, never()).insert(any(AdminUserDO.class));
    }

    /** 注册成功的账号只能落在当前业务平台，且默认启用，不允许借注册创建新平台账号。 */
    @Test
    void registerUserForcesBusinessPlatformAndEnabledStatus() {
        when(authenticationProperties.isRegistrationEnabled()).thenReturn(true);
        when(configApi.getConfigValueByKey("system.user.register-enabled")).thenReturn("true");
        when(passwordEncoder.encode("DUMMY-raw")).thenReturn("DUMMY-encoded");
        doAnswerAssignId();

        Long userId = adminUserService.registerUser(registerReq());

        ArgumentCaptor<AdminUserDO> captor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).insert(captor.capture());
        assertThat(captor.getValue().getUserType()).isEqualTo(PLATFORM);
        assertThat(captor.getValue().getStatus()).isEqualTo(CommonStatusEnum.ENABLE.getStatus());
        assertThat(captor.getValue().getPassword()).isEqualTo("DUMMY-encoded");
        assertThat(userId).isEqualTo(1001L);
    }

    /** 改个人资料前必须确认用户存在，否则会把资料写到不存在的账号上。 */
    @Test
    void updateUserProfileRejectsUnknownUser() {
        when(userMapper.selectById(404L)).thenReturn(null);
        UserProfileUpdateReqVO reqVO = new UserProfileUpdateReqVO();
        reqVO.setNickname("DUMMY-新昵称");

        assertThatThrownBy(() -> adminUserService.updateUserProfile(404L, reqVO))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.USER_NOT_EXISTS.getCode());
        verify(userMapper, never()).updateById(any(AdminUserDO.class));
    }

    /** 个人资料更新成功时必须把目标编号写回更新对象，避免按空编号更新成全表。 */
    @Test
    void updateUserProfileWritesTargetId() {
        when(userMapper.selectById(44L)).thenReturn(user(44L, PLATFORM));
        UserProfileUpdateReqVO reqVO = new UserProfileUpdateReqVO();
        reqVO.setNickname("DUMMY-新昵称");

        adminUserService.updateUserProfile(44L, reqVO);

        ArgumentCaptor<AdminUserDO> captor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).updateById(captor.capture());
        assertThat(captor.getValue().getId()).isEqualTo(44L);
        assertThat(captor.getValue().getNickname()).isEqualTo("DUMMY-新昵称");
    }

    /** 管理端重置密码必须加密后落库，并在同一事务里撤销该用户的全部会话。 */
    @Test
    void updateUserPasswordEncryptsAndRevokesSessions() {
        when(userMapper.selectByIdForUpdate(46L)).thenReturn(user(46L, PLATFORM));
        when(passwordEncoder.encode("DUMMY-new")).thenReturn("DUMMY-encoded-new");

        adminUserService.updateUserPassword(46L, "DUMMY-new");

        ArgumentCaptor<AdminUserDO> captor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).updateById(captor.capture());
        assertThat(captor.getValue().getPassword()).isEqualTo("DUMMY-encoded-new");
        assertThat(captor.getValue().getId()).isEqualTo(46L);
        verify(oauth2TokenService).removeAccessToken(46L, UserTypeEnum.ADMIN.getValue());
    }

    /** 带平台入参的重置密码成功时同样必须撤销会话，且只撤销管理端类型。 */
    @Test
    void updateUserPasswordWithPlatformRevokesAdminSessions() {
        when(userMapper.selectByIdForUpdate(47L)).thenReturn(user(47L, OTHER_PLATFORM));
        when(passwordEncoder.encode("DUMMY-new")).thenReturn("DUMMY-encoded-new");

        adminUserService.updateUserPassword(47L, "DUMMY-new", OTHER_PLATFORM);

        ArgumentCaptor<AdminUserDO> captor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).updateById(captor.capture());
        assertThat(captor.getValue().getPassword()).isEqualTo("DUMMY-encoded-new");
        verify(oauth2TokenService).removeAccessToken(47L, UserTypeEnum.ADMIN.getValue());
    }

    /** 加锁读取用户时必须走"当前读"，普通快照读拿不到行锁，认证与改密就失去串行化边界。 */
    @Test
    void lockUserReadsThroughSelectByIdForUpdate() {
        when(userMapper.selectByIdForUpdate(48L)).thenReturn(user(48L, PLATFORM));

        AdminUserDO locked = adminUserService.lockUser(48L);

        assertThat(locked.getId()).isEqualTo(48L);
        verify(userMapper).selectByIdForUpdate(48L);
        verify(userMapper, never()).selectById(any());
    }

    /** 加锁读取时用户已被删除必须以"用户不存在"拒绝，不能返回空对象让调用方继续改密。 */
    @Test
    void lockUserRejectsDeletedUser() {
        when(userMapper.selectByIdForUpdate(49L)).thenReturn(null);

        assertThatThrownBy(() -> adminUserService.lockUser(49L))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.USER_NOT_EXISTS.getCode());
    }

    /** 让持久层替身在插入时分配固定编号，用于断言随后的派生写入带上同一编号。 */
    private void doAnswerAssignId() {
        org.mockito.Mockito.doAnswer(invocation -> {
            invocation.getArgument(0, AdminUserDO.class).setId(1001L);
            return 1;
        }).when(userMapper).insert(any(AdminUserDO.class));
    }

    /**
     * 构造一条字段合法的注册请求。
     *
     * @return 注册请求对象
     */
    private static AuthRegisterReqVO registerReq() {
        AuthRegisterReqVO reqVO = new AuthRegisterReqVO();
        reqVO.setUsername("zhangsan");
        reqVO.setPassword("DUMMY-raw");
        return reqVO;
    }

    /**
     * 构造指定用户编号与岗位编号的岗位关联记录。
     *
     * @param userId 用户编号
     * @param postId 岗位编号
     * @return 岗位关联记录
     */
    private static UserPostDO userPost(Long userId, Long postId) {
        UserPostDO userPost = new UserPostDO();
        userPost.setUserId(userId);
        userPost.setPostId(postId);
        return userPost;
    }

    /**
     * 构造指定编号与平台类型的用户对象。
     *
     * @param id 用户编号
     * @param userType 管理平台类型，允许为 {@code null} 表示历史数据
     * @return 用户对象
     */
    private static AdminUserDO user(Long id, String userType) {
        AdminUserDO user = new AdminUserDO();
        user.setId(id);
        user.setUsername("DUMMY-" + id);
        user.setUserType(userType);
        user.setPassword("DUMMY-encoded");
        user.setStatus(CommonStatusEnum.ENABLE.getStatus());
        return user;
    }

}