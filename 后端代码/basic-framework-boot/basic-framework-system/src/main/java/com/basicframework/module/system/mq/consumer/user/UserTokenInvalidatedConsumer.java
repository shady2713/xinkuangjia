package com.basicframework.module.system.mq.consumer.user;

import com.basicframework.module.system.mq.message.user.UserTokenInvalidatedEvent;
import com.basicframework.module.system.service.oauth2.OAuth2TokenService;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 用户访问令牌失效事件消费者。
 *
 * <p>改密、重置密码和删除用户后同步撤销该用户的全部访问令牌与刷新令牌，同时清理 Redis 缓存。
 * 监听器保持同步执行，保证业务方法返回前旧令牌已经失效，避免异步窗口内继续使用旧令牌。</p>
 *
 * @author shady2713
 */
@Component
@Slf4j
public class UserTokenInvalidatedConsumer {

    @Resource
    private OAuth2TokenService oauth2TokenService;

    /**
     * 撤销事件对应用户的全部访问令牌和刷新令牌。
     *
     * @param event 令牌失效事件
     */
    @EventListener
    public void onMessage(UserTokenInvalidatedEvent event) {
        log.info("[onMessage][用户({}) 访问令牌因({})失效]",
                event.getUserId(), event.getReason());
        oauth2TokenService.removeAccessToken(event.getUserId(), event.getUserType());
    }

}
