package com.basicframework.framework.web.core.util;

import com.basicframework.framework.common.enums.TerminalEnum;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.web.config.WebProperties;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * 验证 Web 工具类从请求与当前请求上下文中读取登录身份、终端与公共结果的契约。
 *
 * <p>该工具是安全过滤器写入身份、业务代码读取身份的公共通道：写错属性名会让全部接口拿不到
 * 登录用户，用户类型回退判断错误则会把管理端请求当成会员请求。用例固定以下可观察行为：
 * 显式写入的身份优先于按 URL 前缀推断；前缀不匹配时不猜测用户类型；无请求上下文时返回
 * null 或未知终端；非 Servlet 请求上下文不得被强转。</p>
 *
 * @author shady2713
 */
class WebFrameworkUtilsTest {

    /** 提供 admin-api 与 app-api 前缀约定的默认配置。 */
    private WebProperties webProperties;

    /** 安装默认前缀配置，供按 URL 推断用户类型的用例使用。 */
    @BeforeEach
    void setUp() {
        webProperties = new WebProperties();
        new WebFrameworkUtils(webProperties);
    }

    /** 清理当前请求上下文，避免 Servlet 属性在用例之间泄漏。 */
    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    /**
     * 显式写入的登录用户编号与类型必须能被同一请求读回，后写覆盖先写。
     */
    @Test
    void loginIdentityAttributesRoundTrip() {
        MockHttpServletRequest request = new MockHttpServletRequest();

        WebFrameworkUtils.setLoginUserId(request, 1024L);
        WebFrameworkUtils.setLoginUserType(request, UserTypeEnum.ADMIN.getValue());
        assertThat(WebFrameworkUtils.getLoginUserId(request)).isEqualTo(1024L);
        assertThat(WebFrameworkUtils.getLoginUserType(request)).isEqualTo(UserTypeEnum.ADMIN.getValue());

        WebFrameworkUtils.setLoginUserId(request, 2048L);
        WebFrameworkUtils.setLoginUserType(request, UserTypeEnum.MEMBER.getValue());
        assertThat(WebFrameworkUtils.getLoginUserId(request)).isEqualTo(2048L);
        assertThat(WebFrameworkUtils.getLoginUserType(request)).isEqualTo(UserTypeEnum.MEMBER.getValue());
    }

    /**
     * 请求为 null 时读取身份必须返回 null，不得抛空指针。
     */
    @Test
    void identityReadersTolerateNullRequest() {
        assertThat(WebFrameworkUtils.getLoginUserId(null)).isNull();
        assertThat(WebFrameworkUtils.getLoginUserType(null)).isNull();
    }

    /**
     * 已写入的用户类型优先于 URL 前缀推断，避免网关注入类型时被路径覆盖。
     */
    @Test
    void explicitUserTypeWinsOverUrlPrefix() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setServletPath("/admin-api/system/user/list");
        WebFrameworkUtils.setLoginUserType(request, UserTypeEnum.MEMBER.getValue());

        assertThat(WebFrameworkUtils.getLoginUserType(request)).isEqualTo(UserTypeEnum.MEMBER.getValue());
    }

    /**
     * 未写入用户类型时按 admin-api 与 app-api 前缀推断，其他路径不猜测类型。
     */
    @Test
    void userTypeFallsBackToUrlPrefix() {
        MockHttpServletRequest adminRequest = new MockHttpServletRequest();
        adminRequest.setServletPath("/admin-api/system/auth/login");
        MockHttpServletRequest appRequest = new MockHttpServletRequest();
        appRequest.setServletPath("/app-api/member/auth/login");
        MockHttpServletRequest otherRequest = new MockHttpServletRequest();
        otherRequest.setServletPath("/actuator/health");

        assertThat(WebFrameworkUtils.getLoginUserType(adminRequest)).isEqualTo(UserTypeEnum.ADMIN.getValue());
        assertThat(WebFrameworkUtils.getLoginUserType(appRequest)).isEqualTo(UserTypeEnum.MEMBER.getValue());
        assertThat(WebFrameworkUtils.getLoginUserType(otherRequest)).as("非 API 前缀不得猜测用户类型").isNull();
    }

    /**
     * 无参数重载必须从当前请求上下文读取身份，缺少上下文时返回 null。
     */
    @Test
    void identityReadersUseCurrentRequestContext() {
        assertThat(WebFrameworkUtils.getLoginUserId()).isNull();
        assertThat(WebFrameworkUtils.getLoginUserType()).isNull();

        MockHttpServletRequest request = new MockHttpServletRequest();
        WebFrameworkUtils.setLoginUserId(request, 4096L);
        WebFrameworkUtils.setLoginUserType(request, UserTypeEnum.MEMBER.getValue());
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        assertThat(WebFrameworkUtils.getLoginUserId()).isEqualTo(4096L);
        assertThat(WebFrameworkUtils.getLoginUserType()).isEqualTo(UserTypeEnum.MEMBER.getValue());
    }

    /**
     * 终端取值来自 terminal 请求头，缺失或非数字时回退为未知终端。
     */
    @Test
    void terminalHeaderFallsBackToUnknown() {
        assertThat(WebFrameworkUtils.getTerminal()).as("无请求上下文时返回未知终端")
                .isEqualTo(TerminalEnum.UNKNOWN.getTerminal());

        MockHttpServletRequest request = new MockHttpServletRequest();
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        assertThat(WebFrameworkUtils.getTerminal()).isEqualTo(TerminalEnum.UNKNOWN.getTerminal());

        request.addHeader(WebFrameworkUtils.HEADER_TERMINAL, String.valueOf(TerminalEnum.H5.getTerminal()));
        assertThat(WebFrameworkUtils.getTerminal()).isEqualTo(TerminalEnum.H5.getTerminal());

        request.removeHeader(WebFrameworkUtils.HEADER_TERMINAL);
        request.addHeader(WebFrameworkUtils.HEADER_TERMINAL, "not-a-number");
        assertThat(WebFrameworkUtils.getTerminal()).as("非法终端值必须回退为未知").isEqualTo(TerminalEnum.UNKNOWN.getTerminal());
    }

    /**
     * 当前请求上下文不是 Servlet 上下文时必须返回 null，而不是抛类型转换错误。
     */
    @Test
    void requestIsNullForNonServletAttributes() {
        assertThat(WebFrameworkUtils.getRequest()).isNull();

        RequestContextHolder.setRequestAttributes(mock(RequestAttributes.class));

        assertThat(WebFrameworkUtils.getRequest()).isNull();
    }

    /**
     * 公共结果按请求属性存取，缺失时返回 null 且不新建对象。
     */
    @Test
    void commonResultRoundTripsThroughRequestAttribute() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        CommonResult<String> result = CommonResult.success("ok");

        assertThat(WebFrameworkUtils.getCommonResult(request)).isNull();

        WebFrameworkUtils.setCommonResult(request, result);

        assertThat(WebFrameworkUtils.getCommonResult(request)).isSameAs(result);
    }

}
