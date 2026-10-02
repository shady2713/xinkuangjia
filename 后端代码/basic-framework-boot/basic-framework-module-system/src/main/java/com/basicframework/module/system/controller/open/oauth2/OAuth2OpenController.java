package com.basicframework.module.system.controller.open.oauth2;

import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.util.http.HttpUtils;
import com.basicframework.module.system.controller.open.oauth2.vo.OAuth2OpenTokenRespVO;
import com.basicframework.module.system.dal.dataobject.oauth2.OAuth2AccessTokenDO;
import com.basicframework.module.system.enums.oauth2.OAuth2GrantTypeEnum;
import com.basicframework.module.system.service.oauth2.OAuth2ClientService;
import com.basicframework.module.system.service.oauth2.OAuth2GrantService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.annotation.security.PermitAll;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.List;

import static com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants.BAD_REQUEST;
import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception0;
import static com.basicframework.framework.common.pojo.CommonResult.success;

/**
 * 第三方开放 OAuth2 令牌接口。
 *
 * <p>接口路径、表单参数和返回字段严格对齐《AI场景识别接口文档》中的认证接口。</p>
 *
 * @author 李杰
 */
@Tag(name = "开放接口 - OAuth2 令牌")
@RestController
@RequestMapping("/system/oauth2")
public class OAuth2OpenController {

    @Resource
    private OAuth2ClientService oauth2ClientService;
    @Resource
    private OAuth2GrantService oauth2GrantService;

    /**
     * 校验客户端凭据和授权范围后签发客户端模式令牌。
     *
     * @param grantType 授权类型，仅支持 {@code client_credentials}
     * @param clientId 表单中的客户端编号，Basic 认证存在时由认证头覆盖
     * @param clientSecret 表单中的客户端密钥，Basic 认证存在时由认证头覆盖
     * @param scope 空格分隔的授权范围
     * @param request HTTP 请求，用于读取 Basic 认证头
     * @return 客户端模式令牌响应
     */
    @PostMapping("/token")
    @PermitAll
    @Operation(summary = "第三方客户端模式获取访问令牌")
    public CommonResult<OAuth2OpenTokenRespVO> token(
            @RequestParam("grant_type") String grantType,
            @RequestParam(value = "client_id", required = false) String clientId,
            @RequestParam(value = "client_secret", required = false) String clientSecret,
            @RequestParam("scope") String scope,
            HttpServletRequest request) {
        String[] basicAuth = HttpUtils.obtainBasicAuthorization(request);
        if (basicAuth != null) {
            clientId = basicAuth[0];
            clientSecret = basicAuth[1];
        }
        if (!OAuth2GrantTypeEnum.CLIENT_CREDENTIALS.getGrantType().equals(grantType)) {
            throw exception0(BAD_REQUEST.getCode(), "grant_type 仅支持 client_credentials");
        }
        if (StrUtil.isBlank(clientId) || StrUtil.isBlank(clientSecret)) {
            throw exception0(BAD_REQUEST.getCode(), "client_id 和 client_secret 不能为空");
        }

        List<String> scopes = splitScope(scope);
        // 先校验密钥、授权方式和 scope，再创建令牌，避免无权限客户端拿到 token。
        oauth2ClientService.validOAuthClientFromCache(clientId, clientSecret, grantType, scopes, null);
        OAuth2AccessTokenDO accessToken = oauth2GrantService.grantClientCredentials(clientId, scopes);

        long expiresIn = Math.max(0, ChronoUnit.SECONDS.between(LocalDateTime.now(), accessToken.getExpiresTime()));
        return success(new OAuth2OpenTokenRespVO(
                accessToken.getAccessToken(), accessToken.getRefreshToken(), "Bearer", expiresIn,
                String.join(" ", scopes)));
    }

    /**
     * 拆分、去重并清理空格分隔的授权范围。
     *
     * @param scope 原始授权范围
     * @return 保持原顺序且已去重的授权范围
     */
    private List<String> splitScope(String scope) {
        if (StrUtil.isBlank(scope)) {
            throw exception0(BAD_REQUEST.getCode(), "scope 不能为空");
        }
        return Arrays.stream(scope.trim().split("\\s+"))
                .filter(StrUtil::isNotBlank)
                .distinct()
                .toList();
    }

}
