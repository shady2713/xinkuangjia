package com.basicframework.module.system.mq.consumer.user;

import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.module.system.enums.security.UserTokenInvalidationReasonEnum;
import com.basicframework.module.system.mq.message.user.UserTokenInvalidatedEvent;
import com.basicframework.module.system.service.oauth2.OAuth2TokenService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.mockito.Mockito.verify;

/**
 * 验证令牌失效事件会同步撤销事件对应用户的全部令牌。
 *
 * @author shady2713
 */
@ExtendWith(MockitoExtension.class)
class UserTokenInvalidatedConsumerTest {

    @Mock
    private OAuth2TokenService oauth2TokenService;

    @InjectMocks
    private UserTokenInvalidatedConsumer consumer;

    /** 验证监听器调用按用户撤销令牌，并透传管理员用户类型。 */
    @Test
    void revokesTokensForEventUser() {
        consumer.onMessage(new UserTokenInvalidatedEvent(2048L,
                UserTypeEnum.ADMIN.getValue(), UserTokenInvalidationReasonEnum.PASSWORD_CHANGED));

        verify(oauth2TokenService).removeAccessToken(2048L, UserTypeEnum.ADMIN.getValue());
    }
}
