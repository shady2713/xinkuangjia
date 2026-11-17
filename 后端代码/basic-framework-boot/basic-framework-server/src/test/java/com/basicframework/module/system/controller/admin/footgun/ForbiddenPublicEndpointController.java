package com.basicframework.module.system.controller.admin.footgun;

import jakarta.annotation.security.PermitAll;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 反向失败夹具：名单外的公开端点，不得出现在产品代码中。
 *
 * @author shady2713
 */
@RestController
public class ForbiddenPublicEndpointController {

    /**
     * 模拟新增却未列入允许名单的公开接口。
     *
     * @return 占位响应
     */
    @PermitAll
    @GetMapping("/system/footgun/new-public")
    public String newlyExposed() {
        return "forbidden";
    }
}
