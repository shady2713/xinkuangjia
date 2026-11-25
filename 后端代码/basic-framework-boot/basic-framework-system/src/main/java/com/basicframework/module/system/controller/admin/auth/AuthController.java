package com.basicframework.module.system.controller.admin.auth;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.security.config.SecurityProperties;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import com.basicframework.module.system.controller.admin.auth.vo.AuthLoginReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthLoginRespVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthPermissionInfoRespVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthRefreshTokenReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthResetPasswordReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthSmsLoginReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthSmsSendReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.Sm2PublicKeyRespVO;
import com.basicframework.module.system.convert.auth.AuthConvert;
import com.basicframework.module.system.dal.dataobject.permission.MenuDO;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.logger.LoginLogTypeEnum;
import com.basicframework.module.system.framework.security.sm2.Sm2PasswordTransportService;
import com.basicframework.module.system.service.auth.AdminAuthService;
import com.basicframework.module.system.service.permission.MenuService;
import com.basicframework.module.system.service.permission.PermissionService;
import com.basicframework.module.system.service.permission.RoleService;
import com.basicframework.module.system.service.user.AdminUserService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.annotation.security.PermitAll;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Collections;
import java.util.List;
import java.util.Set;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.framework.common.pojo.CommonResult.success;
import static com.basicframework.framework.common.util.collection.CollectionUtils.convertSet;
import static com.basicframework.framework.security.core.util.SecurityFrameworkUtils.getLoginUserId;

/**
 * 管理后台认证接口，提供登录、登出、令牌刷新、受控密码重置和当前用户权限查询能力。
 *
 * @author shady
 */
@Tag(name = "管理后台 - 认证")
@RestController
@Validated
@RequestMapping("/system/auth")
@Slf4j
public class AuthController {

    @Resource
    private AdminAuthService authService;
    @Resource
    private AdminUserService userService;
    @Resource
    private RoleService roleService;
    @Resource
    private MenuService menuService;
    @Resource
    private PermissionService permissionService;
    @Resource
    private SecurityProperties securityProperties;
    @Resource
    private Sm2PasswordTransportService sm2PasswordTransportService;

    /**
     * 查询 SM2 密码传输公钥。
     *
     * @return SM2 公钥和密文模式
     */
    @GetMapping("/sm2-public-key")
    @PermitAll
    @Operation(summary = "获取密码传输 SM2 公钥")
    public CommonResult<Sm2PublicKeyRespVO> getSm2PublicKey() {
        return success(new Sm2PublicKeyRespVO(sm2PasswordTransportService.getPublicKeyHex(), 1));
    }

    /**
     * 使用业务管理平台账号密码登录；先校验验证码与锁定状态，再执行国密解密与防重放记录。
     *
     * @param reqVO 登录请求
     * @return 登录令牌和用户信息
     */
    @PostMapping("/login")
    @PermitAll
    @Operation(summary = "使用账号密码登录")
    public CommonResult<AuthLoginRespVO> login(@RequestBody @Valid AuthLoginReqVO reqVO) {
        authService.precheckLogin(reqVO);
        reqVO.setPassword(sm2PasswordTransportService.decryptLoginPassword(reqVO.getPassword()));
        return success(authService.login(reqVO));
    }

    /**
     * 使用超级管理平台入口登录；先校验验证码与锁定状态，再执行国密解密。
     *
     * @param reqVO 登录请求
     * @return 登录令牌和用户信息
     */
    @PostMapping("/super-admin-login")
    @PermitAll
    @Operation(summary = "超级管理平台账号密码登录")
    public CommonResult<AuthLoginRespVO> superAdminLogin(@RequestBody @Valid AuthLoginReqVO reqVO) {
        authService.precheckLogin(reqVO);
        reqVO.setPassword(sm2PasswordTransportService.decryptLoginPassword(reqVO.getPassword()));
        return success(authService.superAdminLogin(reqVO));
    }

    /**
     * 注销当前请求携带的访问令牌。
     *
     * @param request HTTP 请求
     * @return 注销结果
     */
    @PostMapping("/logout")
    @PermitAll
    @Operation(summary = "登出系统")
    public CommonResult<Boolean> logout(HttpServletRequest request) {
        String token = SecurityFrameworkUtils.obtainAuthorization(request,
                securityProperties.getTokenHeader(), securityProperties.getTokenParameter());
        if (StrUtil.isNotBlank(token)) {
            authService.logout(token, LoginLogTypeEnum.LOGOUT_SELF.getType());
        }
        return success(true);
    }

    /**
     * 使用请求体中的刷新令牌换取新令牌，避免敏感令牌进入 URL 和访问日志。
     *
     * @param reqVO 刷新令牌请求
     * @return 新的登录令牌
     */
    @PostMapping("/refresh-token")
    @PermitAll
    @Operation(summary = "刷新令牌")
    public CommonResult<AuthLoginRespVO> refreshToken(@RequestBody @Valid AuthRefreshTokenReqVO reqVO) {
        if (StrUtil.isBlank(reqVO.getRefreshToken())) {
            throw exception(ErrorCodeConstants.AUTH_REFRESH_TOKEN_REQUIRED);
        }
        return success(authService.refreshToken(reqVO.getRefreshToken()));
    }

    /**
     * 查询当前已认证登录用户的角色及可用菜单。
     *
     * @return 当前用户的权限信息；用户不存在时数据为空
     */
    @GetMapping("/get-permission-info")
    @PreAuthorize("isAuthenticated()")
    @com.basicframework.framework.datapermission.core.annotation.DataPermission(enable = false)
    @Operation(summary = "获取登录用户的权限信息")
    public CommonResult<AuthPermissionInfoRespVO> getPermissionInfo() {
        AdminUserDO user = userService.getUser(getLoginUserId());
        if (user == null) {
            return success(null);
        }
        String loginUserType = AdminPlatformTypeEnum.defaultType(user.getUserType());

        Set<Long> roleIds = permissionService.getUserRoleIdListByUserId(getLoginUserId());
        if (CollUtil.isEmpty(roleIds)) {
            return success(AuthConvert.INSTANCE.convert(user, Collections.emptyList(), Collections.emptyList()));
        }
        List<RoleDO> roles = roleService.getRoleList(roleIds).stream()
                .filter(role -> CommonStatusEnum.ENABLE.getStatus().equals(role.getStatus()))
                .filter(role -> AdminPlatformTypeEnum.isSame(role.getRoleType(), loginUserType))
                .toList();

        Set<Long> menuIds = permissionService.getRoleMenuListByRoleId(convertSet(roles, RoleDO::getId));
        List<MenuDO> menuList = menuService.getMenuList(menuIds).stream()
                .filter(menu -> AdminPlatformTypeEnum.isSame(menu.getMenuType(), loginUserType))
                .toList();
        menuList = menuService.filterDisableMenus(menuList);

        return success(AuthConvert.INSTANCE.convert(user, roles, menuList));
    }

    /**
     * 使用手机号和短信验证码登录业务管理平台。
     *
     * @param reqVO 短信登录请求
     * @return 登录令牌和用户信息
     */
    @PostMapping("/sms-login")
    @PermitAll
    @Operation(summary = "使用短信验证码登录")
    public CommonResult<AuthLoginRespVO> smsLogin(@RequestBody @Valid AuthSmsLoginReqVO reqVO) {
        return success(authService.smsLogin(reqVO));
    }

    /**
     * 发送登录或重置密码所需的短信验证码。
     *
     * @param reqVO 短信验证码请求
     * @return 发送受理结果
     */
    @PostMapping("/send-sms-code")
    @PermitAll
    @Operation(summary = "发送手机验证码")
    public CommonResult<Boolean> sendLoginSmsCode(@RequestBody @Valid AuthSmsSendReqVO reqVO) {
        authService.sendSmsCode(reqVO);
        return success(true);
    }

    /**
     * 校验短信验证码并重置用户密码；前置检查锁定状态后再执行国密解密。
     *
     * @param reqVO 重置密码请求
     * @return 重置结果
     */
    @PostMapping("/reset-password")
    @PermitAll
    @Operation(summary = "重置密码")
    public CommonResult<Boolean> resetPassword(@RequestBody @Valid AuthResetPasswordReqVO reqVO) {
        authService.precheckSmsAttempt(reqVO.getMobile());
        reqVO.setPassword(sm2PasswordTransportService.decryptPassword(reqVO.getPassword()));
        authService.resetPassword(reqVO);
        return success(true);
    }

}
