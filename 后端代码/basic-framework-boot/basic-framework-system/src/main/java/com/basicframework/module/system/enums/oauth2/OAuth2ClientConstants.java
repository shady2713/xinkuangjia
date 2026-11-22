package com.basicframework.module.system.enums.oauth2;

/**
 * OAuth2.0 客户端的通用枚举
 *
 * @author 李杰
 */
public interface OAuth2ClientConstants {

    /**
     * 管理后台内部会话客户端编号。
     *
     * <p>该客户端不落在 system_oauth2_client 表：它只服务管理后台登录和刷新令牌，
     * 不接受客户端密钥，也不能通过开放接口换取令牌。有效期由
     * basic-framework.security.session 配置提供。</p>
     */
    String CLIENT_ID_SYSTEM = "system-admin";

    /**
     * 历史默认客户端编号。
     *
     * <p>该客户端已停用并从基线移除授权配置。保留常量仅用于让升级后残留的访问令牌
     * 和刷新令牌立即失效，不再用于签发新令牌。</p>
     */
    String CLIENT_ID_LEGACY_DEFAULT = "default";

}
