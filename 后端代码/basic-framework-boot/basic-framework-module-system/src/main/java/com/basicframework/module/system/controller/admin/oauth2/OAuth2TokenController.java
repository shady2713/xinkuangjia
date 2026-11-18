package com.basicframework.module.system.controller.admin.oauth2;

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.module.system.controller.admin.oauth2.vo.token.OAuth2AccessTokenPageReqVO;
import com.basicframework.module.system.controller.admin.oauth2.vo.token.OAuth2AccessTokenRespVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.enums.logger.LoginLogTypeEnum;
import com.basicframework.module.system.enums.logger.LoginResultEnum;
import com.basicframework.module.system.framework.security.audit.SecurityAuditService;
import com.basicframework.module.system.service.oauth2.OAuth2TokenService;
import com.basicframework.module.system.service.user.AdminUserService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

import static com.basicframework.framework.common.pojo.CommonResult.success;

/**
 * 管理后台在线会话令牌管理接口。
 *
 * <p>严格按登录管理员所属平台隔离查询与吊销范围，并按令牌主键而非明文令牌字符串执行强制下线。</p>
 *
 * @author 李杰
 */
@Tag(name = "管理后台 - OAuth2.0 令牌")
@RestController
@RequestMapping("/system/oauth2-token")
@Validated
public class OAuth2TokenController {

    /** 单次批量下线令牌上限。 */
    private static final int MAX_BATCH_DELETE_SIZE = 100;

    @Resource
    private OAuth2TokenService oauth2TokenService;
    @Resource
    private AdminUserService adminUserService;
    @Resource
    private SecurityAuditService securityAuditService;

    /**
     * 按当前管理平台隔离获取有效访问令牌分页。
     *
     * @param reqVO 分页条件
     * @return 脱敏后的在线令牌分页
     */
    @GetMapping("/page")
    @Operation(summary = "获得访问令牌分页", description = "只返回当前平台有效期内的令牌元数据")
    @PreAuthorize("@ss.hasPermission('system:oauth2-token:page')")
    public CommonResult<PageResult<OAuth2AccessTokenRespVO>> getAccessTokenPage(@Valid OAuth2AccessTokenPageReqVO reqVO) {
        String platformType = adminUserService.getLoginUserTypeOrDefault();
        PageResult<OAuth2AccessTokenDO> pageResult = oauth2TokenService.getAccessTokenPage(reqVO, platformType);
        return success(BeanUtils.toBean(pageResult, OAuth2AccessTokenRespVO.class));
    }

    /**
     * 按令牌记录编号强制下线同平台会话并写入审计日志。
     *
     * @param id 令牌记录编号
     * @return 是否处理成功
     */
    @DeleteMapping("/delete")
    @Operation(summary = "删除访问令牌")
    @Parameter(name = "id", description = "令牌记录编号", required = true, example = "1024")
    @PreAuthorize("@ss.hasPermission('system:oauth2-token:delete')")
    public CommonResult<Boolean> deleteAccessToken(@RequestParam("id") Long id) {
        revokeAndAudit(id, adminUserService.getLoginUserTypeOrDefault());
        return success(true);
    }

    /**
     * 按令牌记录编号列表批量强制下线同平台会话。
     *
     * @param ids 令牌记录编号列表，单次最多 100 条
     * @return 是否处理成功
     */
    @DeleteMapping("/delete-list")
    @Operation(summary = "批量删除访问令牌")
    @Parameter(name = "ids", description = "令牌记录编号列表", required = true)
    @PreAuthorize("@ss.hasPermission('system:oauth2-token:delete')")
    public CommonResult<Boolean> deleteAccessTokenList(
            @RequestParam("ids") @NotEmpty(message = "令牌编号列表不能为空")
            @Size(max = MAX_BATCH_DELETE_SIZE, message = "单次最多下线 100 个会话") List<Long> ids) {
        String platformType = adminUserService.getLoginUserTypeOrDefault();
        for (Long id : ids) {
            revokeAndAudit(id, platformType);
        }
        return success(true);
    }

    /**
     * 执行单个令牌吊销并记录强制登出审计。
     */
    private void revokeAndAudit(Long id, String platformType) {
        OAuth2AccessTokenDO removed = oauth2TokenService.removeAccessTokenById(id, platformType);
        if (removed != null) {
            var targetUser = adminUserService.getUser(removed.getUserId());
            securityAuditService.record(LoginLogTypeEnum.LOGOUT_DELETE, LoginResultEnum.SUCCESS,
                    removed.getUserId(), targetUser != null ? targetUser.getUsername() : null);
        }
    }

}
