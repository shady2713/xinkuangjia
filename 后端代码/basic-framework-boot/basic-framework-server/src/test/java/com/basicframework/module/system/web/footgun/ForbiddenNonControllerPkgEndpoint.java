package com.basicframework.module.system.web.footgun;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 架构门禁反向夹具：故意放在 {@code ..controller..} 包之外并尝试用 {@code @PreAuthorize("permitAll()")} 绕过鉴权检查的控制器。
 *
 * @author shady2713
 */
@RestController
public class ForbiddenNonControllerPkgEndpoint {

    /** 故意放在非 controller 包下的未授权端点。 */
    @GetMapping("/footgun/hidden-unprotected")
    public String hiddenUnprotected() {
        return "leak";
    }

    /** 故意通过 SpEL permitAll() 绕过白名单检查的端点。 */
    @PreAuthorize("permitAll()")
    @GetMapping("/footgun/preauth-bypass")
    public String preAuthBypass() {
        return "bypass";
    }

}
