package com.basicframework.framework.web.config.fixture.controller.admin.probe;

import org.springframework.web.bind.annotation.RestController;

/**
 * 管理端包下的控制器夹具，用于验证 {@code /admin-api} 前缀的真实匹配规则。
 *
 * <p>路径前缀只对 {@code controller.admin} 包下且带 {@link RestController} 的类生效；
 * 夹具同时提供"匹配包且有注解"与"匹配包但无注解"两种形态，让断言能区分包规则与注解规则。</p>
 *
 * @author shady2713
 */
@RestController
public class AdminProbeController {

    /**
     * 管理端包下但不带 {@link RestController} 的嵌套类，不得命中任何前缀。
     *
     * @author shady2713
     */
    public static class AdminPlainComponent {
    }

}
