package com.basicframework.module.system.mq.message.user;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 用户状态变更事件
 *
 * 当用户被禁用时，需要清除其所有 Token，通过事件解耦 AdminUserService 与 OAuth2TokenService 的循环依赖
 * @author 李杰
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class UserStatusChangedEvent {

    /**
     * 用户编号
     */
    private Long userId;

    /**
     * 用户类型
     */
    private Integer userType;

    /**
     * 变更后的状态
     */
    private Integer status;

}
