package com.basicframework.framework.common.biz.system.oauth2.dto;

import lombok.Data;

import java.io.Serializable;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * OAuth2.0 访问令牌的校验 Response DTO
 *
 * @author 李杰
 */
@Data
public class OAuth2AccessTokenCheckRespDTO implements Serializable {

    /**
     * 用户编号
     */
    private Long userId;
    /**
     * 用户类型
     */
    private Integer userType;
    /**
     * 用户信息
     */
    private Map<String, String> userInfo;
    /**
     * 客户端编号
     *
     * <p>第三方开放接口需要按 OAuth2 Client 隔离数据，因此 token 校验结果需要透传 clientId。</p>
     */
    private String clientId;
    /**
     * 授权范围的数组
     */
    private List<String> scopes;
    /**
     * 过期时间
     */
    private LocalDateTime expiresTime;

}
