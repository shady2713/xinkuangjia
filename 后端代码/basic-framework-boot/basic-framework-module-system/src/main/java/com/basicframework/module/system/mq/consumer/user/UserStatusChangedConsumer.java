package com.basicframework.module.system.mq.consumer.user;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.module.system.mq.message.user.UserStatusChangedEvent;
import com.basicframework.module.system.service.oauth2.OAuth2TokenService;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

/**
 * 针对 {@link UserStatusChangedEvent} 的消费者
 *
 * 当用户被禁用时，删除其所有 Token
 * @author 李杰
 */
@Component
@Slf4j
public class UserStatusChangedConsumer {

    @Resource
    private OAuth2TokenService oauth2TokenService;

    /**
     * 完成 onMessage 对应的业务处理。
     *
     * @param event 事件参数
     */
    @EventListener
    @Async
    public void onMessage(UserStatusChangedEvent event) {
        log.info("[onMessage][用户({}) 状态变更为({})]", event.getUserId(), event.getStatus());
        if (CommonStatusEnum.isDisable(event.getStatus())) {
            oauth2TokenService.removeAccessToken(event.getUserId(), event.getUserType());
        }
    }

}
