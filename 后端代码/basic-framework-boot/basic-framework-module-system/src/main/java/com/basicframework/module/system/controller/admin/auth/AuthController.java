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
import com.basicframework.module.system.controller.admin.auth.vo.AuthRegisterReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthResetPasswordReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthShareLoginRespVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthSmsLoginReqVO;
import com.basicframework.module.system.controller.admin.auth.vo.AuthSmsSendReqVO;
import com.basicframework.module.system.convert.auth.AuthConvert;
import com.basicframework.module.system.dal.dataobject.permission.MenuDO;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.enums.logger.LoginLogTypeEnum;
import com.basicframework.module.system.service.auth.AdminAuthService;
import com.basicframework.module.system.service.permission.MenuService;
import com.basicframework.module.system.service.permission.PermissionService;
import com.basicframework.module.system.service.permission.RoleService;
import com.basicframework.module.system.service.user.AdminUserService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.annotation.security.PermitAll;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

import java.util.Collections;
import java.util.List;
import java.util.Set;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.framework.common.pojo.CommonResult.success;
import static com.basicframework.framework.common.util.collection.CollectionUtils.convertSet;
import static com.basicframework.framework.security.core.util.SecurityFrameworkUtils.getLoginUserId;

/**
 * 管理后台认证接口，提供登录、登出、令牌刷新和当前用户权限查询能力。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/auth/AuthController.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 21 行，移除或改写上游 23 行；import 新增 16 行、移除 10 行；补充注释 64 行，上游注释 3 行未保留。
 */
@Tag(name = "管理后台 - 认证")
@RestController
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


    /**
     * 使用账号密码登录管理后台。
     *
     * @param reqVO 登录请求
     * @return 登录令牌和用户信息
     */
    @PostMapping("/login")
    @PermitAll
    @Operation(summary = "使用账号密码登录")
    public CommonResult<AuthLoginRespVO> login(@RequestBody @Valid AuthLoginReqVO reqVO) {
        return success(authService.login(reqVO));
    }

    /**
     * 使用超级管理员入口登录新管理平台。
     *
     * @param reqVO 登录请求
     * @return 登录令牌和用户信息
     */
    @PostMapping("/super-admin-login")
    @PermitAll
    @Operation(summary = "新管理平台账号密码登录")
    public CommonResult<AuthLoginRespVO> superAdminLogin(@RequestBody @Valid AuthLoginReqVO reqVO) {
        return success(authService.superAdminLogin(reqVO));
    }

    /**
     * 为旧分享链接返回已停用的业务错误，不签发身份。
     *
     * @param ticket 分享票据
     * @return 当前入口始终由业务异常返回分享登录未开放
     */
    @PostMapping("/share-login")
    @PermitAll
    @Operation(summary = "分享登录（已停用）")
    @Parameter(name = "ticket", description = "固定分享码", required = true)
    public CommonResult<AuthShareLoginRespVO> shareLogin(@RequestParam("ticket") String ticket) {
        return success(authService.shareLogin(ticket));
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
     * 查询当前登录用户、角色及可用菜单。
     *
     * @return 当前用户的权限信息；用户不存在时数据为空
     */
    @GetMapping("/get-permission-info")
    @Operation(summary = "获取登录用户的权限信息")
    public CommonResult<AuthPermissionInfoRespVO> getPermissionInfo() {
        // 1.1 获得用户信息
        AdminUserDO user = userService.getUser(getLoginUserId());
        if (user == null) {
            return success(null);
        }
        String loginUserType = AdminPlatformTypeEnum.defaultType(user.getUserType());

        // 1.2 获得角色列表
        Set<Long> roleIds = permissionService.getUserRoleIdListByUserId(getLoginUserId());
        if (CollUtil.isEmpty(roleIds)) {
            return success(AuthConvert.INSTANCE.convert(user, Collections.emptyList(), Collections.emptyList()));
        }
        List<RoleDO> roles = roleService.getRoleList(roleIds).stream()
                .filter(role -> CommonStatusEnum.ENABLE.getStatus().equals(role.getStatus()))
                .filter(role -> AdminPlatformTypeEnum.isSame(role.getRoleType(), loginUserType))
                .toList();

        // 1.3 获得菜单列表
        Set<Long> menuIds = permissionService.getRoleMenuListByRoleId(convertSet(roles, RoleDO::getId));
        List<MenuDO> menuList = menuService.getMenuList(menuIds).stream()
                .filter(menu -> AdminPlatformTypeEnum.isSame(menu.getMenuType(), loginUserType))
                .toList();
        menuList = menuService.filterDisableMenus(menuList);

        // 2. 拼接结果返回
        return success(AuthConvert.INSTANCE.convert(user, roles, menuList));
    }

    /**
     * 注册用户并返回登录结果。
     *
     * @param registerReqVO 注册请求
     * @return 登录令牌和用户信息
     */
    @PostMapping("/register")
    @PermitAll
    @Operation(summary = "注册用户")
    public CommonResult<AuthLoginRespVO> register(@RequestBody @Valid AuthRegisterReqVO registerReqVO) {
        return success(authService.register(registerReqVO));
    }


    // ========== 短信登录相关 ==========

    /**
     * 使用手机号和短信验证码登录。
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
     * 校验短信验证码并重置用户密码。
     *
     * @param reqVO 重置密码请求
     * @return 重置结果
     */
    @PostMapping("/reset-password")
    @PermitAll
    @Operation(summary = "重置密码")
    public CommonResult<Boolean> resetPassword(@RequestBody @Valid AuthResetPasswordReqVO reqVO) {
        authService.resetPassword(reqVO);
        return success(true);
    }

}
