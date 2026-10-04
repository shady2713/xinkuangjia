package com.basicframework.module.system.controller.admin.captcha;

import com.anji.captcha.model.common.ResponseModel;
import com.anji.captcha.model.vo.CaptchaVO;
import com.anji.captcha.properties.AjCaptchaProperties;
import com.anji.captcha.service.CaptchaService;
import com.basicframework.module.system.framework.captcha.core.AdminDefaultBlockPuzzleCaptchaServiceImpl;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证验证码接口的初始化、服务路由、远端标识拼接与配置映射契约。
 *
 * <p>该控制器同时服务业务平台与管理平台：初始化必须真实构造管理端专用滑块服务并按 aj-captcha
 * 约定的键写入配置，否则管理端会拿到业务平台底图；路由必须只在显式传入管理端验证码类型时才
 * 切到该服务，否则业务平台验证码会串用底图；远端标识由客户端地址与 User-Agent 拼成，
 * 用于缓存键与频控，拼接规则错误会让不同客户端共用同一份验证码。</p>
 *
 * <p>用例用真实 Spring 容器完成字段注入与 {@code @PostConstruct} 调用，验证配置映射时读取
 * aj-captcha 真实静态配置字段并在结束后还原，避免污染同 JVM 的其它验证码用例。</p>
 *
 * @author shady2713
 */
class CaptchaControllerTest {

    /** 被测控制器。 */
    private CaptchaController controller;
    /** 业务平台验证码服务替身，用于观察路由结果。 */
    private CaptchaService captchaService;
    /** 管理平台验证码服务替身，替换初始化时创建的真实实例。 */
    private CaptchaService adminCaptchaService;
    /** 初始化阶段真实创建的管理端服务，用于核对初始化结果。 */
    private CaptchaService initializedAdminService;
    /** 本用例使用的容器，结束时关闭。 */
    private AnnotationConfigApplicationContext context;
    /** 进入用例前的静态水印文本，结束后还原。 */
    private Object previousWaterMark;
    /** 进入用例前的静态偏移配置，结束后还原。 */
    private Object previousSlipOffset;

    /** 记录静态配置、启动容器并替换管理端服务为替身。 */
    @BeforeEach
    void setUp() {
        previousWaterMark = ReflectionTestUtils.getField(AdminDefaultBlockPuzzleCaptchaServiceImpl.class, "waterMark");
        previousSlipOffset = ReflectionTestUtils.getField(AdminDefaultBlockPuzzleCaptchaServiceImpl.class, "slipOffset");
        captchaService = mock(CaptchaService.class);
        context = new AnnotationConfigApplicationContext();
        context.registerBean("adminCaptchaController", CaptchaController.class);
        context.registerBean(CaptchaService.class, () -> captchaService);
        context.registerBean(AjCaptchaProperties.class, CaptchaControllerTest::captchaProperties);
        context.refresh();
        controller = context.getBean(CaptchaController.class);
        initializedAdminService = (CaptchaService) ReflectionTestUtils.getField(controller, "adminBlockPuzzleCaptchaService");
        adminCaptchaService = mock(CaptchaService.class);
        ReflectionTestUtils.setField(controller, "adminBlockPuzzleCaptchaService", adminCaptchaService);
    }

    /** 关闭容器并还原 aj-captcha 静态配置。 */
    @AfterEach
    void tearDown() {
        ReflectionTestUtils.setField(AdminDefaultBlockPuzzleCaptchaServiceImpl.class, "waterMark", previousWaterMark);
        ReflectionTestUtils.setField(AdminDefaultBlockPuzzleCaptchaServiceImpl.class, "slipOffset", previousSlipOffset);
        if (context != null) {
            context.close();
            context = null;
        }
    }

    /**
     * 容器初始化必须创建管理端专用滑块服务，并把配置映射成 aj-captcha 认识的键。
     *
     * <p>断言读取 aj-captcha 的真实静态配置字段，证明水印与滑动偏移确实按
     * {@code captcha.water.mark}／{@code captcha.slip.offset} 两个键被消费，而不是只构造了对象。</p>
     */
    @Test
    void postConstructBuildsAdminServiceWithMappedProperties() {
        assertThat(initializedAdminService).isInstanceOf(AdminDefaultBlockPuzzleCaptchaServiceImpl.class);
        assertThat(initializedAdminService.captchaType())
                .isEqualTo(AdminDefaultBlockPuzzleCaptchaServiceImpl.CAPTCHA_TYPE);
        assertThat(ReflectionTestUtils.getField(AdminDefaultBlockPuzzleCaptchaServiceImpl.class, "waterMark"))
                .isEqualTo("DUMMY-WATER-MARK");
        assertThat(ReflectionTestUtils.getField(AdminDefaultBlockPuzzleCaptchaServiceImpl.class, "slipOffset"))
                .isEqualTo("7");
    }

    /** 管理端验证码类型必须路由到管理端服务，并把远端标识写回请求数据。 */
    @Test
    void getRoutesAdminTypeToAdminServiceAndFillsBrowserInfo() {
        CaptchaVO data = new CaptchaVO();
        data.setCaptchaType(AdminDefaultBlockPuzzleCaptchaServiceImpl.CAPTCHA_TYPE);
        MockHttpServletRequest request = request("10.1.2.3", "DUMMY-ADMIN-UA");
        ResponseModel expected = ResponseModel.success();
        when(adminCaptchaService.get(data)).thenReturn(expected);

        ResponseModel result = controller.get(data, request);

        assertThat(result).as("必须返回管理端服务的结果").isSameAs(expected);
        assertThat(data.getBrowserInfo()).isEqualTo("10.1.2.3DUMMY-ADMIN-UA");
        verify(adminCaptchaService).get(data);
    }

    /** 其它验证码类型必须路由到业务平台服务，管理端服务不得被调用。 */
    @Test
    void checkRoutesOtherTypeToBusinessService() {
        CaptchaVO data = new CaptchaVO();
        data.setCaptchaType("blockPuzzle");
        MockHttpServletRequest request = request("10.1.2.4", "DUMMY-BIZ-UA");
        ResponseModel expected = ResponseModel.success();
        when(captchaService.check(data)).thenReturn(expected);

        ResponseModel result = controller.check(data, request);

        assertThat(result).isSameAs(expected);
        assertThat(data.getBrowserInfo()).isEqualTo("10.1.2.4DUMMY-BIZ-UA");
        verify(captchaService).check(data);
        verify(adminCaptchaService, never()).check(data);
    }

    /** 未指定验证码类型时必须回退到业务平台服务。 */
    @Test
    void checkWithoutTypeFallsBackToBusinessService() {
        CaptchaVO data = new CaptchaVO();
        MockHttpServletRequest request = request("10.1.2.5", "DUMMY-NO-TYPE-UA");
        ResponseModel expected = ResponseModel.success();
        when(captchaService.check(data)).thenReturn(expected);

        assertThat(controller.check(data, request)).isSameAs(expected);
        verify(captchaService).check(data);
    }

    /** 远端标识由客户端地址与 User-Agent 直接拼接，地址为空时退化为仅 User-Agent。 */
    @Test
    void getRemoteIdJoinsClientAddressAndUserAgent() {
        assertThat(CaptchaController.getRemoteId(request("192.0.2.10", "DUMMY-UA")))
                .isEqualTo("192.0.2.10DUMMY-UA");
        assertThat(CaptchaController.getRemoteId(request("", "DUMMY-UA")))
                .as("地址为空时只保留 User-Agent").isEqualTo("DUMMY-UA");
        assertThat(CaptchaController.getRemoteId(request("192.0.2.10", null)))
                .as("User-Agent 缺失时只保留地址").isEqualTo("192.0.2.10null");
    }

    /** 构造带客户端地址与 User-Agent 的真实请求对象。 */
    private static MockHttpServletRequest request(String remoteAddr, String userAgent) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/admin-api/system/captcha/get");
        request.setRemoteAddr(remoteAddr);
        request.setRemoteHost("localhost");
        if (userAgent != null) {
            request.addHeader("user-agent", userAgent);
        }
        return request;
    }

    /** 构造覆盖映射断言的验证码配置。 */
    private static AjCaptchaProperties captchaProperties() {
        AjCaptchaProperties properties = new AjCaptchaProperties();
        properties.setWaterMark("DUMMY-WATER-MARK");
        properties.setSlipOffset("7");
        return properties;
    }

}
