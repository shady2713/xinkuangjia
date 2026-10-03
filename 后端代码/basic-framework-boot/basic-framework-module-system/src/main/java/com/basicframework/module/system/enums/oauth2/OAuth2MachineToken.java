package com.basicframework.module.system.enums.oauth2;

/**
 * OAuth2 机器主体令牌的共享约定。
 *
 * <p>机器主体（client_credentials）没有真实登录用户，框架以 {@code userId <= 0} 作为占位编号。
 * 这类主体不签发刷新令牌：占位身份没有可绑定的真实账号，一旦允许续期就会产生
 * 不受账号禁用与会话撤销约束的长期凭据。</p>
 *
 * <p>{@code system_oauth2_access_token.refresh_token} 为 NOT NULL 且长度上限 32，
 * 机器令牌无法写入 NULL。使用固定哨兵值同时满足两处约束：该值不是
 * {@code IdUtil.fastSimpleUUID()} 生成的 32 位十六进制刷新令牌，刷新表中也不存在该记录，
 * 因此刷新入口必然按“无效的刷新令牌”拒绝。</p>
 *
 * @author 李杰
 */
public final class OAuth2MachineToken {

    /**
     * 机器主体访问令牌在 refresh_token 列上的哨兵值，不是可用凭据。
     */
    public static final String MACHINE_NO_REFRESH_TOKEN = "machine-no-refresh-token";

    /**
     * 工具类不允许实例化。
     */
    private OAuth2MachineToken() {
    }

}
