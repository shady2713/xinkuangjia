package com.basicframework.module.system.service.user;

import cn.hutool.crypto.digest.DigestUtil;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.module.system.controller.admin.auth.vo.AuthRegisterReqVO;
import com.basicframework.module.system.controller.admin.user.vo.profile.UserProfileUpdatePasswordReqVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserSaveReqVO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.dal.mysql.dept.UserPostMapper;
import com.basicframework.module.system.dal.mysql.user.AdminUserMapper;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.service.dept.DeptService;
import com.basicframework.module.system.service.dept.PostService;
import com.basicframework.module.system.service.permission.PermissionService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.ApplicationContext;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import java.util.Set;

import static com.basicframework.module.system.enums.ErrorCodeConstants.PASSWORD_POLICY_NOT_MATCH;
import static com.basicframework.module.system.enums.ErrorCodeConstants.USER_PASSWORD_FAILED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证密码存储格式迁移、首次改密标志和密码策略落点。
 *
 * @author shady2713
 */
@ExtendWith(MockitoExtension.class)
class AdminUserServiceImplTest {

    /** 使用较低强度加速单测，算法与生产 BCryptPasswordEncoder 一致。 */
    @Spy
    private BCryptPasswordEncoder passwordEncoder = new BCryptPasswordEncoder(4);

    @Mock
    private AdminUserMapper userMapper;
    @Mock
    private DeptService deptService;
    @Mock
    private PostService postService;
    @Mock
    private ObjectProvider<PermissionService> permissionServiceProvider;
    @Mock
    private ApplicationContext applicationContext;
    @Mock
    private UserPostMapper userPostMapper;
    @Mock
    private com.basicframework.framework.common.api.config.ConfigApi configApi;

    @InjectMocks
    private AdminUserServiceImpl userService;

    /** 验证历史 bcrypt(md5(明文)) 能被识别，而当前格式只接受明文。 */
    @Test
    void recognizesLegacyMd5DerivedHash() {
        String encoded = passwordEncoder.encode(DigestUtil.md5Hex("Legacy#Pass1"));

        assertThat(userService.isPasswordMatchLegacy("Legacy#Pass1", encoded)).isTrue();
        assertThat(userService.isPasswordMatch("Legacy#Pass1", encoded)).isFalse();
    }

    /** 验证历史哈希升级后，新格式可直接用明文校验。 */
    @Test
    void upgradesLegacyHashToPlainBcrypt() {
        userService.updatePasswordHash(1L, "Legacy#Pass1");

        ArgumentCaptor<AdminUserDO> captor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).updateById(captor.capture());
        AdminUserDO update = captor.getValue();
        assertThat(update.getId()).isEqualTo(1L);
        assertThat(passwordEncoder.matches("Legacy#Pass1", update.getPassword())).isTrue();
        assertThat(passwordEncoder.matches(DigestUtil.md5Hex("Legacy#Pass1"), update.getPassword())).isFalse();
    }

    /** 验证管理员重置密码后置位首次改密标志。 */
    @Test
    void adminResetPasswordSetsChangeRequiredFlag() {
        when(userMapper.selectById(1L)).thenReturn(buildUser(1L, "super_admin"));

        userService.updateUserPassword(1L, "New#Pass1", "super_admin");

        ArgumentCaptor<AdminUserDO> captor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).updateById(captor.capture());
        assertThat(captor.getValue().getPasswordChangeRequired()).isTrue();
        assertThat(passwordEncoder.matches("New#Pass1", captor.getValue().getPassword())).isTrue();
    }

    /** 验证短信重置密码后清除首次改密标志。 */
    @Test
    void smsResetPasswordClearsChangeRequiredFlag() {
        when(userMapper.selectById(1L)).thenReturn(buildUser(1L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType()));

        userService.updateUserPassword(1L, "New#Pass1");

        ArgumentCaptor<AdminUserDO> captor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).updateById(captor.capture());
        assertThat(captor.getValue().getPasswordChangeRequired()).isFalse();
    }

    /** 验证用户自行修改密码后清除标志，并允许旧密码为历史 md5 哈希。 */
    @Test
    void profilePasswordChangeClearsFlagAndAcceptsLegacyOldPassword() {
        AdminUserDO user = buildUser(1L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        user.setPassword(passwordEncoder.encode(DigestUtil.md5Hex("Old#Pass1")));
        when(userMapper.selectById(1L)).thenReturn(user);
        UserProfileUpdatePasswordReqVO reqVO = new UserProfileUpdatePasswordReqVO();
        reqVO.setOldPassword("Old#Pass1");
        reqVO.setNewPassword("New#Pass1");

        userService.updateUserPassword(1L, reqVO);

        ArgumentCaptor<AdminUserDO> captor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).updateById(captor.capture());
        assertThat(captor.getValue().getPasswordChangeRequired()).isFalse();
        assertThat(passwordEncoder.matches("New#Pass1", captor.getValue().getPassword())).isTrue();
    }

    /** 验证新密码不满足策略时不会写入数据库。 */
    @Test
    void profilePasswordChangeRejectsWeakPassword() {
        AdminUserDO user = buildUser(1L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        user.setPassword(passwordEncoder.encode("Old#Pass1"));
        when(userMapper.selectById(1L)).thenReturn(user);
        UserProfileUpdatePasswordReqVO reqVO = new UserProfileUpdatePasswordReqVO();
        reqVO.setOldPassword("Old#Pass1");
        reqVO.setNewPassword("weakpass");

        assertThatThrownBy(() -> userService.updateUserPassword(1L, reqVO))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(PASSWORD_POLICY_NOT_MATCH.getCode()));
        verify(userMapper, never()).updateById(any(AdminUserDO.class));
    }

    /** 验证旧密码错误时无法修改密码。 */
    @Test
    void profilePasswordChangeRejectsWrongOldPassword() {
        AdminUserDO user = buildUser(1L, AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        user.setPassword(passwordEncoder.encode("Old#Pass1"));
        when(userMapper.selectById(1L)).thenReturn(user);
        UserProfileUpdatePasswordReqVO reqVO = new UserProfileUpdatePasswordReqVO();
        reqVO.setOldPassword("Wrong#Pass1");
        reqVO.setNewPassword("New#Pass1");

        assertThatThrownBy(() -> userService.updateUserPassword(1L, reqVO))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(USER_PASSWORD_FAILED.getCode()));
        verify(userMapper, never()).updateById(any(AdminUserDO.class));
    }

    /** 验证管理员创建用户时置位首次改密标志。 */
    @Test
    void createUserSetsChangeRequiredFlag() {
        when(userMapper.selectByUsernameAndUserType("created-user",
                AdminPlatformTypeEnum.SUPER_ADMIN.getType())).thenReturn(null);
        UserSaveReqVO reqVO = new UserSaveReqVO();
        reqVO.setUsername("created-user");
        reqVO.setNickname("Created User");
        reqVO.setPassword("Init#Pass1");
        reqVO.setPostIds(Set.of());

        userService.createUser(reqVO, AdminPlatformTypeEnum.SUPER_ADMIN.getType());

        ArgumentCaptor<AdminUserDO> captor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).insert(captor.capture());
        assertThat(captor.getValue().getPasswordChangeRequired()).isTrue();
        assertThat(passwordEncoder.matches("Init#Pass1", captor.getValue().getPassword())).isTrue();
    }

    /** 验证注册入口由用户自行设置密码，不触发首次改密。 */
    @Test
    void registerUserClearsChangeRequiredFlag() {
        when(configApi.getConfigValueByKey("system.user.register-enabled")).thenReturn("true");
        when(userMapper.selectByUsernameAndUserType("registered-user",
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType())).thenReturn(null);
        AuthRegisterReqVO reqVO = new AuthRegisterReqVO();
        reqVO.setUsername("registered-user");
        reqVO.setNickname("Registered User");
        reqVO.setPassword("Init#Pass1");

        userService.registerUser(reqVO);

        ArgumentCaptor<AdminUserDO> captor = ArgumentCaptor.forClass(AdminUserDO.class);
        verify(userMapper).insert(captor.capture());
        assertThat(captor.getValue().getPasswordChangeRequired()).isFalse();
    }

    /**
     * 构造指定平台类型的用户。
     *
     * @param id 用户编号
     * @param userType 平台类型
     * @return 用户数据
     */
    private static AdminUserDO buildUser(Long id, String userType) {
        AdminUserDO user = new AdminUserDO();
        user.setId(id);
        user.setUsername("test-user");
        user.setUserType(userType);
        return user;
    }
}
