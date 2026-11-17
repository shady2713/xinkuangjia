package com.basicframework.module.system.controller.admin.footgun;

import com.basicframework.module.system.dal.mysql.footgun.ForbiddenFootgunMapper;
import org.springframework.web.bind.annotation.RestController;

/**
 * 反向失败夹具：控制器直接依赖 mapper 包。
 *
 * @author shady2713
 */
@RestController
public class ForbiddenMapperAccessController {

    /**
     * 构造时持有 mapper，形成被禁止的直接依赖。
     *
     * @param mapper 假 mapper
     */
    public ForbiddenMapperAccessController(ForbiddenFootgunMapper mapper) {
        if (mapper == null) {
            throw new IllegalArgumentException("mapper");
        }
    }
}
