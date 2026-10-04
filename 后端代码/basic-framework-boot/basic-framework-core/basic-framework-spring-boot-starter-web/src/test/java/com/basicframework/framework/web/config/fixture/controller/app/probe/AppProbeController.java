package com.basicframework.framework.web.config.fixture.controller.app.probe;

import org.springframework.web.bind.annotation.RestController;

/**
 * 应用端包下的控制器夹具，用于验证 {@code /app-api} 前缀与 {@code /admin-api} 的隔离。
 *
 * <p>两个前缀各自只匹配自己的包：管理端前缀不得命中应用端控制器，否则两类接口会共享同一前缀，
 * 权限与限流策略随之失效。</p>
 *
 * @author shady2713
 */
@RestController
public class AppProbeController {
}
