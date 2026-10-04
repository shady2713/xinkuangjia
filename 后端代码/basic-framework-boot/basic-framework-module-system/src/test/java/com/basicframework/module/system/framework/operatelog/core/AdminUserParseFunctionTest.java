package com.basicframework.module.system.framework.operatelog.core;

import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.service.user.AdminUserService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证操作日志的“管理员用户”解析函数：注册名、空值短路与昵称/手机号组合规则。
 *
 * <p>操作日志注解里写的是 {@code getAdminUserById}；日志需要把用户编号还原成人可读的标识，
 * 手机号已登记时补充在昵称后（{@code 昵称(手机号)}），便于同名用户区分；手机号为空时只返回昵称，
 * 不能输出 {@code 昵称()} 这种空括号。查不到用户时返回空串，避免日志出现 "null"。</p>
 *
 * @author shady2713
 */
class AdminUserParseFunctionTest {

    /** 被测解析函数。 */
    private final AdminUserParseFunction function = new AdminUserParseFunction();

    /** 用户服务替身，用于控制查询结果并核对查询入参。 */
    private final AdminUserService adminUserService = mock(AdminUserService.class);

    /** 注册名必须与操作日志注解中的引用一致。 */
    @Test
    void registrationNameMatchesAnnotationReference() {
        ReflectionTestUtils.setField(function, "adminUserService", adminUserService);

        assertThat(AdminUserParseFunction.NAME).isEqualTo("getAdminUserById");
        assertThat(function.functionName()).isEqualTo("getAdminUserById");
    }

    /** 空编号直接解析为空串且不访问用户服务。 */
    @Test
    void emptyValueShortCircuitsWithoutQuery() {
        ReflectionTestUtils.setField(function, "adminUserService", adminUserService);

        assertThat(function.apply(null)).isEmpty();
        assertThat(function.apply("")).isEmpty();
        verifyNoInteractions(adminUserService);
    }

    /** 手机号已登记时输出“昵称(手机号)”，按转换后的编号查询。 */
    @Test
    void userWithMobileParsesIntoNicknameWithMobile() {
        ReflectionTestUtils.setField(function, "adminUserService", adminUserService);
        when(adminUserService.getUser(5L)).thenReturn(user("张三", "13800000000"));

        assertThat(function.apply("5")).as("字符串编号必须按 Long 转换后查询").isEqualTo("张三(13800000000)");
        verify(adminUserService).getUser(5L);
    }

    /** 手机号为空时只输出昵称，不得输出空括号。 */
    @Test
    void userWithoutMobileParsesIntoNicknameOnly() {
        ReflectionTestUtils.setField(function, "adminUserService", adminUserService);
        when(adminUserService.getUser(6L)).thenReturn(user("李四", null));
        when(adminUserService.getUser(7L)).thenReturn(user("王五", ""));

        assertThat(function.apply(6L)).isEqualTo("李四");
        assertThat(function.apply(7L)).as("空串手机号同样视为未登记").isEqualTo("王五");
        verify(adminUserService, times(2)).getUser(anyLong());
    }

    /** 用户不存在时返回空串，不把 null 写进日志。 */
    @Test
    void missingUserParsesToEmptyString() {
        ReflectionTestUtils.setField(function, "adminUserService", adminUserService);
        when(adminUserService.getUser(99L)).thenReturn(null);

        assertThat(function.apply(99L)).isEmpty();
    }

    /**
     * 构造管理员用户记录。
     *
     * @param nickname 昵称
     * @param mobile 手机号，null 或空串表示未登记
     * @return 用户记录
     */
    private static AdminUserDO user(String nickname, String mobile) {
        AdminUserDO user = new AdminUserDO();
        user.setNickname(nickname);
        user.setMobile(mobile);
        return user;
    }

}
