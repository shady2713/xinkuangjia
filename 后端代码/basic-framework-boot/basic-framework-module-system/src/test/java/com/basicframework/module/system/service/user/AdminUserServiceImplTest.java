package com.basicframework.module.system.service.user;

import com.basicframework.framework.common.api.config.ConfigApi;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.controller.admin.user.vo.profile.UserProfileUpdatePasswordReqVO;
import com.basicframework.module.system.controller.admin.user.vo.profile.UserProfileUpdateReqVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserImportExcelVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserImportRespVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserPageReqVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserSaveReqVO;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import com.basicframework.module.system.dal.dataobject.dept.UserPostDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.dal.mysql.dept.UserPostMapper;
import com.basicframework.module.system.dal.mysql.user.AdminUserMapper;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.framework.auth.config.AdminAuthenticationProperties;
import com.basicframework.module.system.mq.message.user.UserStatusChangedEvent;
import com.basicframework.module.system.service.dept.DeptService;
import com.basicframework.module.system.service.dept.PostService;
import com.basicframework.module.system.service.oauth2.OAuth2TokenService;
import com.basicframework.module.system.service.permission.PermissionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.ArgumentMatchers;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.ApplicationContext;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Collection;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证后台用户服务的平台隔离、唯一性校验、密码改密与批量导入契约。
 *
 * <p>后台用户服务同时被两个管理平台使用：任何按编号、按账号或按手机号触达用户的入口都必须
 * 先确认目标账号属于当前平台，否则一个平台的管理员可以读写另一个平台的账号，这是对象级的
 * 越权边界。唯一性校验同样是跨平台共享的：账号名只在同平台内唯一，但占用判定必须覆盖不可见
 * 数据，否则换个平台就能抢注同名账号。改密与批量导入还要保证"先校验后写入"以及旧密码不匹配时
 * 不落盘。</p>
 *
 * <p>持久层按进程外边界替换为替身，服务内的平台判定、唯一性判定、异常类型与密码撤销编排全部
 * 真实执行；断言核对真实业务错误码、写入对象的归属字段以及替身实际收到的调用参数。</p>
 *
 * @author shady2713
 */
class AdminUserServiceImplTest {

    /** 当前业务管理平台类型。 */
    private static final String PLATFORM = AdminPlatformTypeEnum.BUSINESS_ADMIN.getType();

    /** 另一个管理平台类型，用于验证跨平台拒绝。 */
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
    /** 应用上下文替身，用于观察状态变更事件。 */
    private ApplicationContext applicationContext;
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
        applicationContext = mock(ApplicationContext.class);
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
        ReflectionTestUtils.setField(adminUserService, "applicationContext", applicationContext);
        ReflectionTestUtils.setField(adminUserService, "configApi", configApi);
        ReflectionTestUtils.setField(adminUserService, "authenticationProperties", authenticationProperties);
        ReflectionTestUtils.setField(adminUserService, "oauth2TokenServiceProvider", oauth2TokenServiceProvider);
    }

    /** 没有用户编号时视为新增场景，不得发起按编号查询。 */
    @Test
    void validateUserExistsSkipsQueryWithoutId() {
        assertThat(adminUserService.validateUserExists(null)).isNull();

        verify(userMapper, never()).selectById(any());
    }

    /** 存在的用户必须原样返回，调用方才能继续做平台归属判定。 */
    @Test
    void validateUserExistsReturnsStoredUser() {
        when(userMapper.selectById(11L)).thenReturn(user(11L, PLATFORM));

        AdminUserDO result = adminUserService.validateUserExists(11L);

        assertThat(result).isNotNull();
        assertThat(result.getId()).isEqualTo(11L);
        verify(userMapper).selectById(11L);
    }

    /** 目标用户不存在时必须以固定的"用户不存在"错误码拒绝，不能静默当成新增。 */
    @Test
    void validateUserExistsRejectsUnknownId() {
        when(userMapper.selectById(404L)).thenReturn(null);

        assertThatThrownBy(() -> adminUserService.validateUserExists(404L))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.USER_NOT_EXISTS.getCode());
    }

    /** 同平台用户必须通过校验，跨平台用户必须被拒绝在服务层而不是只靠前端隐藏入口。 */
    @Test
    void validateUserForPlatformReturnsSamePlatformUserOnly() {
        when(userMapper.selectById(11L)).thenReturn(user(11L, PLATFORM));
        when(userMapper.selectById(12L)).thenReturn(user(12L, OTHER_PLATFORM));

        assertThat(adminUserService.validateUserForPlatform(11L, PLATFORM).getId()).isEqualTo(11L);
        assertThatThrownBy(() -> adminUserService.validateUserForPlatform(12L, PLATFORM))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED.getCode());
    }

    /** 历史账号没有平台字段时按当前业务平台兜底，不能因为老数据把管理员挡在门外。 */
    @Test
    void validateUserForPlatformTreatsLegacyRowAsBusinessAdmin() {
        when(userMapper.selectById(13L)).thenReturn(user(13L, null));

        AdminUserDO result = adminUserService.validateUserForPlatform(13L, PLATFORM);

        assertThat(result.getId()).isEqualTo(13L);
        assertThat(result.getUserType()).as("历史数据必须保持原样，不在读取路径改写").isNull();
    }

    /** 批量校验必须先去掉重复编号并保留请求顺序，避免重复删除同一用户。 */
    @Test
    void validateUserListForPlatformDeduplicatesAndKeepsOrder() {
        when(userMapper.selectByIds(List.of(21L, 22L)))
                .thenReturn(List.of(user(22L, PLATFORM), user(21L, PLATFORM)));

        List<Long> result = adminUserService.validateUserListForPlatform(List.of(21L, 22L, 21L), PLATFORM);

        assertThat(result).containsExactly(21L, 22L);
        assertThat(result).as("重复编号必须被去掉").doesNotHaveDuplicates();
        verify(userMapper).selectByIds(List.of(21L, 22L));
    }

    /** 批量校验中任一用户不存在时整体拒绝，不能只删掉存在的那部分。 */
    @Test
    void validateUserListForPlatformRejectsUnknownId() {
        when(userMapper.selectByIds(List.of(21L, 99L))).thenReturn(List.of(user(21L, PLATFORM)));

        assertThatThrownBy(() -> adminUserService.validateUserListForPlatform(List.of(21L, 99L), PLATFORM))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.USER_NOT_EXISTS.getCode());
        verify(userMapper, never()).deleteByIds(anyCollection());
    }

    /** 批量集合里混入跨平台账号时整体拒绝，不允许部分成功。 */
    @Test
    void validateUserListForPlatformRejectsCrossPlatformMember() {
        when(userMapper.selectByIds(List.of(21L, 22L)))
                .thenReturn(List.of(user(21L, PLATFORM), user(22L, OTHER_PLATFORM)));

        assertThatThrownBy(() -> adminUserService.validateUserListForPlatform(List.of(21L, 22L), PLATFORM))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED.getCode());
        verify(userMapper, never()).deleteByIds(anyCollection());
    }

    /** 空编号集合不发起查询，避免把"没有选择用户"翻译成一次无条件删除。 */
    @Test
    void validateUserListForPlatformShortCircuitsEmptyIds() {
        assertThat(adminUserService.validateUserListForPlatform(List.of(), PLATFORM)).isEmpty();
        assertThat(adminUserService.validateUserListForPlatform(null, PLATFORM)).isEmpty();

        verify(userMapper, never()).selectByIds(anyCollection());
    }

    /** 账号名为空时跳过唯一性判定，由参数校验负责，不在这里产生"账号已存在"误报。 */
    @Test
    void validateUsernameUniqueSkipsBlankName() {
        adminUserService.validateUsernameUnique(null, "  ", PLATFORM);

        verify(userMapper, never()).selectByUsernameAndUserType(anyString(), anyString());
    }

    /** 新增时命中已占用账号名必须拒绝，换平台也不能抢注同一个账号名。 */
    @Test
    void validateUsernameUniqueRejectsTakenNameOnCreate() {
        when(userMapper.selectByUsernameAndUserType("zhangsan", PLATFORM)).thenReturn(user(31L, PLATFORM));

        assertThatThrownBy(() -> adminUserService.validateUsernameUnique(null, "zhangsan", PLATFORM))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.USER_USERNAME_EXISTS.getCode());
    }

    /** 更新时把账号名改成别人已占用的名字必须拒绝。 */
    @Test
    void validateUsernameUniqueRejectsNameOwnedByOtherUser() {
        when(userMapper.selectByUsernameAndUserType("lisi", PLATFORM)).thenReturn(user(32L, PLATFORM));

        assertThatThrownBy(() -> adminUserService.validateUsernameUnique(31L, "lisi", PLATFORM))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.USER_USERNAME_EXISTS.getCode());
    }

    /** 保留自己的账号名不算冲突，否则任何一次改名保存都会被自己挡住。 */
    @Test
    void validateUsernameUniqueAllowsSelfOwnership() {
        when(userMapper.selectByUsernameAndUserType("zhangsan", PLATFORM)).thenReturn(user(31L, PLATFORM));

        adminUserService.validateUsernameUnique(31L, "zhangsan", PLATFORM);

        verify(userMapper, times(1)).selectByUsernameAndUserType("zhangsan", PLATFORM);
    }

    /** 邮箱唯一性覆盖全部平台：占用者与被校验者平台不同也算冲突，防止跨平台撞邮箱。 */
    @Test
    void validateEmailUniqueRejectsEmailTakenOnAnotherPlatform() {
        when(userMapper.selectByEmail("dup@example.com")).thenReturn(user(33L, OTHER_PLATFORM));

        assertThatThrownBy(() -> adminUserService.validateEmailUnique(31L, "dup@example.com"))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.USER_EMAIL_EXISTS.getCode());
    }

    /** 邮箱留空时跳过判定，避免把"未填写邮箱"误判成重复。 */
    @Test
    void validateEmailUniqueSkipsBlankEmail() {
        adminUserService.validateEmailUnique(31L, null);

        verify(userMapper, never()).selectByEmail(anyString());
    }

    /** 手机号留空时跳过判定，空值不应该阻断正常保存。 */
    @Test
    void validateMobileUniqueSkipsBlankMobile() {
        adminUserService.validateMobileUnique(31L, "");

        verify(userMapper, never()).selectByMobile(anyString());
    }

    /** 手机号被别的账号占用时必须拒绝，编号相同才视为本人。 */
    @Test
    void validateMobileUniqueRejectsMobileOwnedByOtherUser() {
        when(userMapper.selectByMobile("13800000001")).thenReturn(user(32L, PLATFORM));

        assertThatThrownBy(() -> adminUserService.validateMobileUnique(31L, "13800000001"))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.USER_MOBILE_EXISTS.getCode());
    }

    /** 没有登录上下文时平台类型必须回落到当前业务平台，而不是空值或抛错。 */
    @Test
    void getUserTypeOrDefaultFallsBackToBusinessAdmin() {
        when(userMapper.selectById(31L)).thenReturn(user(31L, OTHER_PLATFORM));

        assertThat(adminUserService.getUserTypeOrDefault(null)).isEqualTo(PLATFORM);
        assertThat(adminUserService.getUserTypeOrDefault(404L)).as("查不到用户时同样回落到业务平台")
                .isEqualTo(PLATFORM);
        verify(userMapper).selectById(404L);
    }

    /** 已登记的平台类型必须原样返回，否则登录后会被错误地迁到另一个平台。 */
    @Test
    void getUserTypeOrDefaultKeepsStoredPlatformType() {
        when(userMapper.selectById(32L)).thenReturn(user(32L, OTHER_PLATFORM));

        assertThat(adminUserService.getUserTypeOrDefault(32L)).isEqualTo(OTHER_PLATFORM);
        assertThat(adminUserService.getUserTypeOrDefault(32L)).isNotEqualTo(PLATFORM);
    }

    /** 历史账号没有平台字段时必须回落到业务平台，保证老账号仍能登录。 */
    @Test
    void getUserTypeOrDefaultNormalizesLegacyRow() {
        when(userMapper.selectById(33L)).thenReturn(user(33L, null));

        assertThat(adminUserService.getUserTypeOrDefault(33L)).isEqualTo(PLATFORM);
        assertThat(adminUserService.getUserTypeOrDefault(33L)).isNotEqualTo(OTHER_PLATFORM);
    }

    /** 按编号读取跨平台用户时返回空而不是抛错，让"不存在"与"无权访问"在读取路径上不泄漏。 */
    @Test
    void getUserByIdRejectsCrossPlatformAndReturnsNullWhenAbsent() {
        when(userMapper.selectById(404L)).thenReturn(null);
        when(userMapper.selectById(41L)).thenReturn(user(41L, OTHER_PLATFORM));

        assertThat(adminUserService.getUser(404L, PLATFORM)).isNull();
        assertThatThrownBy(() -> adminUserService.getUser(41L, PLATFORM))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED.getCode());
    }

    /** 空编号集合的批量读取必须短路，避免产生一次无意义的全量条件查询。 */
    @Test
    void getUserListShortCircuitsEmptyIds() {
        assertThat(adminUserService.getUserList(List.of())).isEmpty();
        assertThat(adminUserService.getUserListByDeptIds(List.of())).isEmpty();

        verify(userMapper, never()).selectByIds(anyCollection());
        verify(userMapper, never()).selectListByDeptIds(anyCollection());
    }

    /** 按编号批量读取必须整体透传给持久层，返回值不得被服务层裁剪或重排。 */
    @Test
    void getUserListPassesThroughEveryRequestedUser() {
        when(userMapper.selectByIds(List.of(51L, 52L))).thenReturn(List.of(user(51L, PLATFORM), user(52L, PLATFORM)));
        when(userMapper.selectListByDeptIds(List.of(61L))).thenReturn(List.of(user(61L, PLATFORM)));

        List<AdminUserDO> byIds = adminUserService.getUserList(List.of(51L, 52L));
        List<AdminUserDO> byDept = adminUserService.getUserListByDeptIds(List.of(61L));

        assertThat(byIds).extracting(AdminUserDO::getId).containsExactly(51L, 52L);
        assertThat(byDept).extracting(AdminUserDO::getId).containsExactly(61L);
        verify(userMapper).selectListByDeptIds(List.of(61L));
    }

    /** 按编号读取同平台用户必须放行并原样返回，跨平台读取才拒绝。 */
    @Test
    void getUserByIdAndTypeAllowsSamePlatform() {
        when(userMapper.selectById(71L)).thenReturn(user(71L, PLATFORM));

        AdminUserDO result = adminUserService.getUser(71L, PLATFORM);

        assertThat(result).isNotNull();
        assertThat(result.getId()).isEqualTo(71L);
        assertThat(result.getUserType()).isEqualTo(PLATFORM);
    }

    /** 角色下仍有用户时必须把角色下的用户编号作为分页过滤条件传下去，而不是直接返回空。 */
    @Test
    void getUserPageForwardsRoleUserIdsAsFilter() {
        when(permissionService.getUserRoleIdListByRoleId(Set.of(7L))).thenReturn(Set.of(51L, 52L));
        when(userMapper.selectPage(any(UserPageReqVO.class), ArgumentMatchers.<Long>anyCollection(),
                ArgumentMatchers.<Long>anyCollection())).thenReturn(PageResult.empty());
        UserPageReqVO reqVO = new UserPageReqVO();
        reqVO.setRoleId(7L);

        adminUserService.getUserPage(reqVO);

        ArgumentCaptor<Collection<Long>> captor = ArgumentCaptor.forClass(Collection.class);
        verify(userMapper).selectPage(any(UserPageReqVO.class), ArgumentMatchers.<Long>anyCollection(),
                captor.capture());
        assertThat(captor.getValue()).containsExactlyInAnyOrder(51L, 52L);
    }

    /** 批量校验必须拦住不存在的编号，避免后续流程拿一个查不到的账号继续操作。 */
    @Test
    void validateUserListRejectsUnknownUser() {
        when(userMapper.selectByIds(List.of(81L))).thenReturn(List.of());

        assertThatThrownBy(() -> adminUserService.validateUserList(List.of(81L)))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.USER_NOT_EXISTS.getCode());
    }

    /** 全部账号都存在且启用时必须放行，空集合同样不得发起查询。 */
    @Test
    void validateUserListAcceptsEnabledUsers() {
        when(userMapper.selectByIds(List.of(81L, 82L)))
                .thenReturn(List.of(user(81L, PLATFORM), user(82L, PLATFORM)));

        adminUserService.validateUserList(List.of(81L, 82L));
        adminUserService.validateUserList(List.of());

        verify(userMapper, times(1)).selectByIds(List.of(81L, 82L));
        verify(userMapper, never()).selectByIds(List.of());
    }

    /** 新增时邮箱被占用必须拒绝，邮箱是跨平台共享的登录辅助标识。 */
    @Test
    void validateEmailUniqueRejectsTakenEmailOnCreate() {
        when(userMapper.selectByEmail("taken@example.com")).thenReturn(user(83L, PLATFORM));

        assertThatThrownBy(() -> adminUserService.validateEmailUnique(null, "taken@example.com"))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.USER_EMAIL_EXISTS.getCode());
    }

    /** 保留自己的邮箱不算冲突，否则任何一次资料保存都会被自己挡住。 */
    @Test
    void validateEmailUniqueAllowsSelfOwnership() {
        when(userMapper.selectByEmail("mine@example.com")).thenReturn(user(84L, PLATFORM));

        adminUserService.validateEmailUnique(84L, "mine@example.com");

        verify(userMapper, times(1)).selectByEmail("mine@example.com");
    }

    /** 邮箱没有被占用时必须放行，否则正常的新邮箱永远无法保存。 */
    @Test
    void validateEmailUniqueAcceptsFreeEmail() {
        when(userMapper.selectByEmail("free@example.com")).thenReturn(null);

        assertThatCode(() -> adminUserService.validateEmailUnique(84L, "free@example.com"))
                .as("邮箱未被占用时必须放行").doesNotThrowAnyException();
        verify(userMapper, times(1)).selectByEmail("free@example.com");
    }

    /** 手机号没有被占用时必须放行。 */
    @Test
    void validateMobileUniqueAcceptsFreeMobile() {
        when(userMapper.selectByMobile("13800000009")).thenReturn(null);

        assertThatCode(() -> adminUserService.validateMobileUnique(86L, "13800000009"))
                .as("手机号未被占用时必须放行").doesNotThrowAnyException();
        verify(userMapper, times(1)).selectByMobile("13800000009");
    }

    /** 新增时手机号被占用必须拒绝，手机号同样跨平台共享。 */
    @Test
    void validateMobileUniqueRejectsTakenMobileOnCreate() {
        when(userMapper.selectByMobile("13800000002")).thenReturn(user(85L, PLATFORM));

        assertThatThrownBy(() -> adminUserService.validateMobileUnique(null, "13800000002"))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.USER_MOBILE_EXISTS.getCode());
    }

    /** 保留自己的手机号不算冲突。 */
    @Test
    void validateMobileUniqueAllowsSelfOwnership() {
        when(userMapper.selectByMobile("13800000003")).thenReturn(user(86L, PLATFORM));

        adminUserService.validateMobileUnique(86L, "13800000003");

        verify(userMapper, times(1)).selectByMobile("13800000003");
    }

    /** 导入行的手机号被占用时必须逐行记为失败并继续处理，不能让整批导入中断。 */
    @Test
    void importUserListRecordsUniquenessFailurePerRow() {
        when(configApi.getConfigValueByKey("system.user.init-password")).thenReturn("DUMMY-init");
        when(userMapper.selectByMobile("13800000004")).thenReturn(user(87L, PLATFORM));
        UserImportExcelVO importUser = importUser("wangwu");
        importUser.setMobile("13800000004");

        UserImportRespVO respVO = adminUserService.importUserList(List.of(importUser), true);

        assertThat(respVO.getFailureUsernames()).containsKey("wangwu");
        assertThat(respVO.getCreateUsernames()).isEmpty();
        verify(userMapper, never()).insert(any(AdminUserDO.class));
    }

    /** 按岗位取用户时没有任何岗位关联记录必须返回空集合，而不是带空条件的全量查询。 */
    @Test
    void getUserListByPostIdsReturnsEmptyWithoutMapping() {
        when(userPostMapper.selectListByPostIds(List.of(5L))).thenReturn(List.of());

        assertThat(adminUserService.getUserListByPostIds(List.of(5L))).isEmpty();

        verify(userMapper, never()).selectByIds(anyCollection());
    }

    /** 按岗位取用户时按岗位关联表里的用户编号批量回填，不得逐个查询。 */
    @Test
    void getUserListByPostIdsLooksUpUsersByMappedIds() {
        when(userPostMapper.selectListByPostIds(List.of(5L))).thenReturn(List.of(userPost(51L, 5L), userPost(52L, 5L)));
        when(userMapper.selectByIds(Set.of(51L, 52L))).thenReturn(List.of(user(51L, PLATFORM)));

        List<AdminUserDO> result = adminUserService.getUserListByPostIds(List.of(5L));

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getId()).isEqualTo(51L);
        verify(userMapper).selectByIds(Set.of(51L, 52L));
    }

    /** 批量校验必须拦住禁用账号，否则以停用账号继续走后续业务。 */
    @Test
    void validateUserListRejectsDisabledUser() {
        AdminUserDO disabled = user(61L, PLATFORM);
        disabled.setNickname("DUMMY-停用");
        disabled.setStatus(CommonStatusEnum.DISABLE.getStatus());
        when(userMapper.selectByIds(List.of(61L))).thenReturn(List.of(disabled));

        assertThatThrownBy(() -> adminUserService.validateUserList(List.of(61L)))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.USER_IS_DISABLE.getCode());
    }

    /** 按角色筛选用户时该角色下没有任何用户必须直接返回空分页，不落库查询。 */
    @Test
    void getUserPageReturnsEmptyWhenRoleHasNoUser() {
        when(permissionService.getUserRoleIdListByRoleId(Set.of(7L))).thenReturn(Set.of());
        UserPageReqVO reqVO = new UserPageReqVO();
        reqVO.setRoleId(7L);

        PageResult<AdminUserDO> result = adminUserService.getUserPage(reqVO);

        assertThat(result.getList()).isEmpty();
        assertThat(result.getTotal()).isEqualTo(0L);
        verify(userMapper, never()).selectPage(any(UserPageReqVO.class), ArgumentMatchers.<Long>anyCollection(),
                ArgumentMatchers.<Long>anyCollection());
    }

    /** 按部门筛选用户时查询条件必须包含部门自身，否则父部门下的直属用户会被漏掉。 */
    @Test
    void getUserPageIncludesOwnDeptInCondition() {
        DeptDO child = new DeptDO();
        child.setId(8L);
        when(deptService.getChildDeptList(9L)).thenReturn(List.of(child));
        UserPageReqVO reqVO = new UserPageReqVO();
        reqVO.setDeptId(9L);
        when(userMapper.selectPage(any(UserPageReqVO.class), ArgumentMatchers.<Long>anyCollection(),
                ArgumentMatchers.<Long>anyCollection()))
                .thenReturn(PageResult.empty());

        adminUserService.getUserPage(reqVO);

        ArgumentCaptor<Collection<Long>> captor = ArgumentCaptor.forClass(Collection.class);
        verify(userMapper).selectPage(any(UserPageReqVO.class), captor.capture(), isNull());
        assertThat(captor.getValue()).containsExactlyInAnyOrder(8L, 9L);
        assertThat(captor.getValue()).as("必须包含被查询部门自身").contains(9L);
    }

    /** 未按部门筛选时不得注入任何部门条件，避免把列表误收窄成某个部门。 */
    @Test
    void getUserPageWithoutDeptKeepsEmptyCondition() {
        when(userMapper.selectPage(any(UserPageReqVO.class), ArgumentMatchers.<Long>anyCollection(),
                ArgumentMatchers.<Long>anyCollection())).thenReturn(PageResult.empty());

        adminUserService.getUserPage(new UserPageReqVO());

        ArgumentCaptor<Collection<Long>> captor = ArgumentCaptor.forClass(Collection.class);
        verify(userMapper).selectPage(any(UserPageReqVO.class), captor.capture(), isNull());
        assertThat(captor.getValue()).isEmpty();
        verify(userMapper, never()).selectPage(any(UserPageReqVO.class),
                ArgumentMatchers.<Long>anyCollection(), ArgumentMatchers.<Long>anyCollection());
    }

    /** 按账号名查询时平台类型为空必须先归一化，不能把空平台当成一个独立平台去查。 */
    @Test
    void getUserByUsernameAndTypeNormalizesBlankPlatform() {
        when(userMapper.selectByUsernameAndUserType("zhangsan", PLATFORM)).thenReturn(user(31L, PLATFORM));

        assertThat(adminUserService.getUserByUsernameAndType("zhangsan", null).getId()).isEqualTo(31L);
        assertThat(adminUserService.getUserByUsernameAndType("zhangsan", "  ")).isNotNull();
        verify(userMapper, times(2)).selectByUsernameAndUserType("zhangsan", PLATFORM);
    }

    /** 按状态查平台用户时同样必须归一化平台类型，防止跨平台串号。 */
    @Test
    void getUserListByStatusAndTypeNormalizesBlankPlatform() {
        when(userMapper.selectListByStatusAndUserType(CommonStatusEnum.ENABLE.getStatus(), PLATFORM))
                .thenReturn(List.of(user(31L, PLATFORM)));

        List<AdminUserDO> result = adminUserService
                .getUserListByStatusAndType(CommonStatusEnum.ENABLE.getStatus(), null);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getId()).isEqualTo(31L);
        verify(userMapper).selectListByStatusAndUserType(CommonStatusEnum.ENABLE.getStatus(), PLATFORM);
    }

    /** 口令匹配必须整体委托给编码器，服务自身不得用明文比较。 */
    @Test
    void isPasswordMatchDelegatesToEncoder() {
        when(passwordEncoder.matches("DUMMY-raw", "DUMMY-encoded")).thenReturn(true, false);

        assertThat(adminUserService.isPasswordMatch("DUMMY-raw", "DUMMY-encoded")).isTrue();
        assertThat(adminUserService.isPasswordMatch("DUMMY-raw", "DUMMY-encoded")).isFalse();
        verify(passwordEncoder, times(2)).matches("DUMMY-raw", "DUMMY-encoded");
    }

    /** 跨平台改状态必须在写入前被拒绝，否则禁用动作会落到另一个平台的账号上。 */
    @Test
    void updateUserStatusRejectsCrossPlatformBeforeWrite() {
        when(userMapper.selectById(41L)).thenReturn(user(41L, OTHER_PLATFORM));

        assertThatThrownBy(() -> adminUserService.updateUserStatus(41L, CommonStatusEnum.DISABLE.getStatus(), PLATFORM))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED.getCode());
        verify(userMapper, never()).updateById(any(AdminUserDO.class));
        verify(applicationContext, never()).publishEvent(any());
    }

    /** 禁用成功后必须发布状态变更事件，消费者据此清理该用户的令牌。 */
    @Test
    void updateUserStatusPublishesStatusChangedEvent() {
        when(userMapper.selectById(42L)).thenReturn(user(42L, PLATFORM));

        adminUserService.updateUserStatus(42L, CommonStatusEnum.DISABLE.getStatus(), PLATFORM);

        ArgumentCaptor<AdminUserDO> updateCaptor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).updateById(updateCaptor.capture());
        assertThat(updateCaptor.getValue().getId()).isEqualTo(42L);
        assertThat(updateCaptor.getValue().getStatus()).isEqualTo(CommonStatusEnum.DISABLE.getStatus());

        ArgumentCaptor<UserStatusChangedEvent> eventCaptor = ArgumentCaptor.forClass(UserStatusChangedEvent.class);
        verify(applicationContext).publishEvent(eventCaptor.capture());
        assertThat(eventCaptor.getValue().getUserId()).isEqualTo(42L);
        assertThat(eventCaptor.getValue().getUserType()).isEqualTo(UserTypeEnum.ADMIN.getValue());
        assertThat(eventCaptor.getValue().getStatus()).isEqualTo(CommonStatusEnum.DISABLE.getStatus());
    }

    /** 删除登录信息时必须同时写入登录 IP 与登录时间，审计依赖这两个字段还原登录轨迹。 */
    @Test
    void updateUserLoginWritesIpAndLoginDate() {
        adminUserService.updateUserLogin(43L, "DUMMY-IP");

        ArgumentCaptor<AdminUserDO> captor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).updateById(captor.capture());
        assertThat(captor.getValue().getId()).isEqualTo(43L);
        assertThat(captor.getValue().getLoginIp()).isEqualTo("DUMMY-IP");
        assertThat(captor.getValue().getLoginDate()).as("登录时间必须落库").isNotNull();
    }

    /** 改个人资料前必须校验存在性，手机号与邮箱都不允许撞上别人的账号。 */
    @Test
    void updateUserProfileValidatesUniquenessBeforeWrite() {
        when(userMapper.selectById(44L)).thenReturn(user(44L, PLATFORM));
        when(userMapper.selectByEmail("dup@example.com")).thenReturn(user(45L, PLATFORM));
        UserProfileUpdateReqVO reqVO = new UserProfileUpdateReqVO();
        reqVO.setEmail("dup@example.com");

        assertThatThrownBy(() -> adminUserService.updateUserProfile(44L, reqVO))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.USER_EMAIL_EXISTS.getCode());
        verify(userMapper, never()).updateById(any(AdminUserDO.class));
    }

    /** 旧密码不匹配时必须拒绝且不得写入新密码，否则任何人拿到会话都能改密。 */
    @Test
    void updateUserPasswordRejectsWrongOldPassword() {
        when(userMapper.selectByIdForUpdate(45L)).thenReturn(user(45L, PLATFORM));
        when(passwordEncoder.matches("DUMMY-old", "DUMMY-encoded")).thenReturn(false);
        UserProfileUpdatePasswordReqVO reqVO = new UserProfileUpdatePasswordReqVO();
        reqVO.setOldPassword("DUMMY-old");
        reqVO.setNewPassword("DUMMY-new");

        assertThatThrownBy(() -> adminUserService.updateUserPassword(45L, reqVO))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.USER_PASSWORD_FAILED.getCode());
        verify(userMapper, never()).updateById(any(AdminUserDO.class));
        verify(oauth2TokenService, never()).removeAccessToken(anyLong(), anyInt());
    }

    /** 改密成功后必须在同一事务里撤销全部会话，防止旧令牌继续可用。 */
    @Test
    void updateUserPasswordRevokesSessionsAfterWrite() {
        when(userMapper.selectByIdForUpdate(46L)).thenReturn(user(46L, PLATFORM));
        when(passwordEncoder.matches("DUMMY-old", "DUMMY-encoded")).thenReturn(true);
        when(passwordEncoder.encode("DUMMY-new")).thenReturn("DUMMY-encoded-new");
        UserProfileUpdatePasswordReqVO reqVO = new UserProfileUpdatePasswordReqVO();
        reqVO.setOldPassword("DUMMY-old");
        reqVO.setNewPassword("DUMMY-new");

        adminUserService.updateUserPassword(46L, reqVO);

        ArgumentCaptor<AdminUserDO> captor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).updateById(captor.capture());
        assertThat(captor.getValue().getPassword()).isEqualTo("DUMMY-encoded-new");
        assertThat(captor.getValue().getId()).isEqualTo(46L);
        verify(oauth2TokenService).removeAccessToken(46L, UserTypeEnum.ADMIN.getValue());
    }

    /** 管理端跨平台改密必须在写入前被拒绝，避免把另一个平台的账号改掉。 */
    @Test
    void updateUserPasswordRejectsCrossPlatform() {
        when(userMapper.selectByIdForUpdate(41L)).thenReturn(user(41L, OTHER_PLATFORM));

        assertThatThrownBy(() -> adminUserService.updateUserPassword(41L, "DUMMY-new", PLATFORM))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED.getCode());
        verify(userMapper, never()).updateById(any(AdminUserDO.class));
        verify(oauth2TokenService, never()).removeAccessToken(anyLong(), anyInt());
    }

    /** 批量删除必须为每个用户清理权限与岗位关联，遗留关联会让编号被后续新建用户继承。 */
    @Test
    void deleteUserListCleansRelationsPerUser() {
        when(userMapper.selectByIds(List.of(51L, 52L)))
                .thenReturn(List.of(user(51L, PLATFORM), user(52L, PLATFORM)));

        adminUserService.deleteUserList(List.of(51L, 52L), PLATFORM);

        verify(userMapper).deleteByIds(List.of(51L, 52L));
        verify(permissionService, times(2)).processUserDeleted(anyLong());
        verify(userPostMapper, times(2)).deleteByUserId(anyLong());
        verify(permissionService).processUserDeleted(51L);
        verify(userPostMapper).deleteByUserId(52L);
    }

    /** 空集合删除必须短路，不得发起无条件删除。 */
    @Test
    void deleteUserListShortCircuitsEmptyIds() {
        adminUserService.deleteUserList(List.of(), PLATFORM);

        verify(userMapper, never()).deleteByIds(anyCollection());
        verify(permissionService, never()).processUserDeleted(anyLong());
    }

    /** 单个删除必须先确认平台归属，再删除主记录并清理关联数据。 */
    @Test
    void deleteUserValidatesPlatformThenCleansRelations() {
        when(userMapper.selectById(53L)).thenReturn(user(53L, PLATFORM));

        adminUserService.deleteUser(53L, PLATFORM);

        verify(userMapper).deleteById(53L);
        verify(permissionService).processUserDeleted(53L);
        verify(userPostMapper).deleteByUserId(53L);
    }

    /** 导入列表为空必须直接报错，不能返回一份"全部成功"的空结果。 */
    @Test
    void importUserListRejectsEmptyList() {
        assertThatThrownBy(() -> adminUserService.importUserList(List.of(), true))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.USER_IMPORT_LIST_IS_EMPTY.getCode());
        verify(configApi, never()).getConfigValueByKey(anyString());
    }

    /** 初始密码未配置时必须拒绝导入，否则会为所有导入用户写入空口令。 */
    @Test
    void importUserListRejectsMissingInitPassword() {
        when(configApi.getConfigValueByKey("system.user.init-password")).thenReturn("");

        assertThatThrownBy(() -> adminUserService.importUserList(List.of(importUser("zhangsan")), true))
                .isInstanceOf(ServiceException.class)
                .extracting(exception -> ((ServiceException) exception).getCode())
                .isEqualTo(ErrorCodeConstants.USER_IMPORT_INIT_PASSWORD.getCode());
        verify(userMapper, never()).insert(any(AdminUserDO.class));
    }

    /** 部门名称不存在时该行必须记为失败并继续处理其余行，不能整体中断。 */
    @Test
    void importUserListReportsUnknownDeptName() {
        when(configApi.getConfigValueByKey("system.user.init-password")).thenReturn("DUMMY-init");
        when(deptService.getDeptByName("DUMMY-不存在的部门")).thenReturn(null);

        UserImportRespVO respVO = adminUserService
                .importUserList(List.of(importUserWithDept("zhangsan", "DUMMY-不存在的部门")), true);

        assertThat(respVO.getFailureUsernames()).containsEntry("zhangsan", "部门名称不存在");
        assertThat(respVO.getCreateUsernames()).isEmpty();
        verify(userMapper, never()).insert(any(AdminUserDO.class));
    }

    /** 新增导入行必须按当前登录平台写入并使用配置的初始密码，不允许导入数据绕过平台隔离。 */
    @Test
    void importUserListCreatesUserWithInitPasswordAndCurrentPlatform() {
        when(configApi.getConfigValueByKey("system.user.init-password")).thenReturn("DUMMY-init");
        when(passwordEncoder.encode("DUMMY-init")).thenReturn("DUMMY-encoded-init");
        DeptDO dept = new DeptDO();
        dept.setId(61L);
        when(deptService.getDeptByName("DUMMY-研发部")).thenReturn(dept);
        when(userMapper.selectByUsernameAndUserType("zhangsan", PLATFORM)).thenReturn(null);

        UserImportRespVO respVO = adminUserService
                .importUserList(List.of(importUserWithDept("zhangsan", "DUMMY-研发部")), true);

        ArgumentCaptor<AdminUserDO> captor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).insert(captor.capture());
        assertThat(captor.getValue().getUserType()).isEqualTo(PLATFORM);
        assertThat(captor.getValue().getPassword()).isEqualTo("DUMMY-encoded-init");
        assertThat(captor.getValue().getDeptId()).isEqualTo(61L);
        assertThat(captor.getValue().getPostIds()).as("导入不授予任何岗位").isEmpty();
        assertThat(respVO.getCreateUsernames()).containsExactly("zhangsan");
        assertThat(respVO.getFailureUsernames()).isEmpty();
    }

    /** 已存在账号且未开启覆盖时必须记为失败，不得静默覆盖既有账号资料。 */
    @Test
    void importUserListRejectsDuplicateWhenUpdateNotSupported() {
        when(configApi.getConfigValueByKey("system.user.init-password")).thenReturn("DUMMY-init");
        when(userMapper.selectByUsernameAndUserType("zhangsan", PLATFORM)).thenReturn(user(31L, PLATFORM));

        UserImportRespVO respVO = adminUserService.importUserList(List.of(importUser("zhangsan")), false);

        assertThat(respVO.getFailureUsernames()).containsKey("zhangsan");
        assertThat(respVO.getUpdateUsernames()).isEmpty();
        assertThat(respVO.getCreateUsernames()).isEmpty();
        verify(userMapper, never()).updateById(any(AdminUserDO.class));
    }

    /** 开启覆盖时只更新既有账号的编号与资料，不得改动其平台归属与密码。 */
    @Test
    void importUserListUpdatesExistingUserWhenSupported() {
        when(configApi.getConfigValueByKey("system.user.init-password")).thenReturn("DUMMY-init");
        when(userMapper.selectByUsernameAndUserType("zhangsan", PLATFORM)).thenReturn(user(31L, PLATFORM));

        UserImportRespVO respVO = adminUserService.importUserList(List.of(importUser("zhangsan")), true);

        ArgumentCaptor<AdminUserDO> captor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).updateById(captor.capture());
        assertThat(captor.getValue().getId()).isEqualTo(31L);
        assertThat(captor.getValue().getNickname()).isEqualTo("DUMMY-张三");
        assertThat(captor.getValue().getPassword()).as("覆盖导入不得重置既有账号口令").isNull();
        assertThat(respVO.getUpdateUsernames()).containsExactly("zhangsan");
        assertThat(respVO.getCreateUsernames()).isEmpty();
    }

    /** 字段不符合校验的行必须按用户名记入失败原因，且不影响同批次其他行。 */
    @Test
    void importUserListRecordsValidationFailurePerRow() {
        when(configApi.getConfigValueByKey("system.user.init-password")).thenReturn("DUMMY-init");
        when(userMapper.selectByUsernameAndUserType("lisi", PLATFORM)).thenReturn(null);
        UserImportExcelVO invalid = importUser("lisi");
        invalid.setEmail("not-an-email");

        UserImportRespVO respVO = adminUserService.importUserList(List.of(invalid), true);

        assertThat(respVO.getFailureUsernames()).containsKey("lisi");
        assertThat(respVO.getCreateUsernames()).isEmpty();
        verify(userMapper, never()).insert(any(AdminUserDO.class));
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
     * 构造一行字段合法的导入数据。
     *
     * @param username 登录名称
     * @return 导入行对象
     */
    private static UserImportExcelVO importUser(String username) {
        UserImportExcelVO importUser = new UserImportExcelVO();
        importUser.setUsername(username);
        importUser.setNickname("DUMMY-张三");
        return importUser;
    }

    /**
     * 构造一行带部门名称的导入数据。
     *
     * @param username 登录名称
     * @param deptName 部门名称
     * @return 导入行对象
     */
    private static UserImportExcelVO importUserWithDept(String username, String deptName) {
        UserImportExcelVO importUser = importUser(username);
        importUser.setDeptName(deptName);
        return importUser;
    }

}