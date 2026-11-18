package com.basicframework.module.system.controller.admin.footgun;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 架构门禁反向夹具：漏写 {@code @PreAuthorize} 与 {@code @PermitAll} 的控制器端点。
 *
 * @author shady2713
 */
@RestController
public class ForbiddenUnprotectedEndpointController {

    /** 故意不标注权限注解以验证门禁失败能力。 */
    @GetMapping("/footgun/unprotected")
    public String unprotected() {
        return "leak";
    }

}
