package com.basicframework.module.system.mq.message.user;

import com.basicframework.module.system.enums.security.UserTokenInvalidationReasonEnum;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 用户访问令牌失效事件。
 *
 * <p>改密、重置密码和删除用户后发布，由监听器撤销该用户全部访问令牌与刷新令牌。
 * 使用事件解耦用户服务与 OAuth2 令牌服务，避免两者形成循环依赖。</p>
 *
 * @author shady2713
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class UserTokenInvalidatedEvent {

    /**
     * 用户编号
     */
    private Long userId;

    /**
     * 用户类型
     */
    private Integer userType;

    /**
     * 令牌失效原因
     */
    private UserTokenInvalidationReasonEnum reason;

}
