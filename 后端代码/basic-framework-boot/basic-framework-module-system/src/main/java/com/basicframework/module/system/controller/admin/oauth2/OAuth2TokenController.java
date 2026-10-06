package com.basicframework.module.system.controller.admin.oauth2;

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.module.system.controller.admin.oauth2.vo.token.OAuth2AccessTokenPageReqVO;
import com.basicframework.module.system.controller.admin.oauth2.vo.token.OAuth2AccessTokenRespVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.enums.logger.LoginLogTypeEnum;
import com.basicframework.module.system.service.auth.AdminAuthService;
import com.basicframework.module.system.service.oauth2.OAuth2TokenService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

import static com.basicframework.framework.common.pojo.CommonResult.success;

/**
 * OAuth2TokenController HTTP 接口，负责请求校验和响应组装。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/oauth2/OAuth2TokenController.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地补充注释 22 行。
 */
@Tag(name = "管理后台 - OAuth2.0 令牌")
@RestController
@RequestMapping("/system/oauth2-token")
public class OAuth2TokenController {

    @Resource
    private OAuth2TokenService oauth2TokenService;
    @Resource
    private AdminAuthService authService;

    /**
     * 获取访问令牌分页数据。
     *
     * @param reqVO 请求参数
     * @return 查询结果
     */
    @GetMapping("/page")
    @Operation(summary = "获得访问令牌分页", description = "只返回有效期内的")
    @PreAuthorize("@ss.hasPermission('system:oauth2-token:page')")
    public CommonResult<PageResult<OAuth2AccessTokenRespVO>> getAccessTokenPage(@Valid OAuth2AccessTokenPageReqVO reqVO) {
        PageResult<OAuth2AccessTokenDO> pageResult = oauth2TokenService.getAccessTokenPage(reqVO);
        return success(BeanUtils.toBean(pageResult, OAuth2AccessTokenRespVO.class));
    }

    /**
     * 删除访问令牌。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param accessToken 访问令牌参数
     * @return 操作结果
     */
    @DeleteMapping("/delete")
    @Operation(summary = "删除访问令牌")
    @Parameter(name = "accessToken", description = "访问令牌", required = true, example = "tudou")
    @PreAuthorize("@ss.hasPermission('system:oauth2-token:delete')")
    public CommonResult<Boolean> deleteAccessToken(@RequestParam("accessToken") String accessToken) {
        authService.logout(accessToken, LoginLogTypeEnum.LOGOUT_DELETE.getType());
        return success(true);
    }

    /**
     * 删除访问令牌列表。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param accessTokens 访问Tokens参数
     * @return 操作结果
     */
    @DeleteMapping("/delete-list")
    @Operation(summary = "批量删除访问令牌")
    @Parameter(name = "accessTokens", description = "访问令牌数组", required = true)
    @PreAuthorize("@ss.hasPermission('system:oauth2-token:delete')")
    public CommonResult<Boolean> deleteAccessTokenList(@RequestParam("accessTokens") List<String> accessTokens) {
        accessTokens.forEach(accessToken ->
                authService.logout(accessToken, LoginLogTypeEnum.LOGOUT_DELETE.getType()));
        return success(true);
    }

}
