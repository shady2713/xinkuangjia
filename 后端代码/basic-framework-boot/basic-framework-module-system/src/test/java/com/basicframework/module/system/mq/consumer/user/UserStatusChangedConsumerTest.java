package com.basicframework.module.system.mq.consumer.user;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.module.system.mq.message.user.UserStatusChangedEvent;
import com.basicframework.module.system.service.oauth2.OAuth2TokenService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * 验证用户状态变更消费者只在“变为禁用”时撤销令牌。
 *
 * <p>该消费者是禁用账号后立刻失效的关键一环：只有状态为禁用才删除该用户、该用户类型的
 * 全部访问令牌，保证禁用立即生效；启用、未知状态或异常事件都不得删除令牌，否则一次错误
 * 或乱序的事件就会把所有在线用户踢下线。删除范围必须带用户类型，避免会员与管理员共用
 * 编号时误删另一端会话。</p>
 *
 * @author shady2713
 */
class UserStatusChangedConsumerTest {

    /** 被测消费者，令牌服务按外部边界替换为可观察替身。 */
    private UserStatusChangedConsumer consumer;
    /** 记录撤销调用的令牌服务替身。 */
    private OAuth2TokenService oauth2TokenService;

    /** 为每个用例创建独立消费者与替身，避免用例之间共享调用记录。 */
    @BeforeEach
    void setUp() {
        consumer = new UserStatusChangedConsumer();
        oauth2TokenService = mock(OAuth2TokenService.class);
        ReflectionTestUtils.setField(consumer, "oauth2TokenService", oauth2TokenService);
    }

    /** 状态变为禁用时必须按用户与用户类型撤销全部令牌。 */
    @Test
    void disabledStatusRemovesTokensOfSameUserType() {
        UserStatusChangedEvent event = event(1024L, 2, CommonStatusEnum.DISABLE.getStatus());

        consumer.onMessage(event);

        verify(oauth2TokenService).removeAccessToken(1024L, 2);
    }

    /** 状态变为启用时不得撤销令牌，否则启用操作会把在线会话踢下线。 */
    @Test
    void enabledStatusKeepsTokens() {
        consumer.onMessage(event(1024L, 2, CommonStatusEnum.ENABLE.getStatus()));

        verifyNoInteractions(oauth2TokenService);
    }

    /** 未知或缺失状态不得视为禁用，避免异常事件清空令牌。 */
    @Test
    void unknownStatusKeepsTokens() {
        consumer.onMessage(event(1024L, 2, 99));
        consumer.onMessage(event(1024L, 2, null));

        verifyNoInteractions(oauth2TokenService);
    }

    /** 会员与管理员的令牌必须按用户类型分别撤销，不能互相误删。 */
    @Test
    void memberTokensAreRevokedSeparatelyFromAdmin() {
        consumer.onMessage(event(1024L, 1, CommonStatusEnum.DISABLE.getStatus()));

        verify(oauth2TokenService).removeAccessToken(1024L, 1);
        verify(oauth2TokenService, never()).removeAccessToken(1024L, 2);
    }

    /** 构造用户状态变更事件。 */
    private static UserStatusChangedEvent event(Long userId, Integer userType, Integer status) {
        UserStatusChangedEvent event = new UserStatusChangedEvent();
        event.setUserId(userId);
        event.setUserType(userType);
        event.setStatus(status);
        return event;
    }
}
