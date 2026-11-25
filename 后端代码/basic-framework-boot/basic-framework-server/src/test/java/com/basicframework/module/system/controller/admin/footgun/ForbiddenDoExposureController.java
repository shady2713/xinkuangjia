package com.basicframework.module.system.controller.admin.footgun;

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.module.system.dal.dataobject.footgun.ForbiddenFootgunDO;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 反向失败夹具：控制器在 HTTP 泛型返回签名中直接暴露持久化 DO。
 *
 * @author shady
 */
@RestController
public class ForbiddenDoExposureController {

    /**
     * 故意在泛型响应中返回 DO，用于验证契约隔离门禁能穿透泛型实参。
     *
     * @return 含持久化对象的响应结果
     */
    @GetMapping("/admin-api/system/footgun/do-leak")
    public CommonResult<ForbiddenFootgunDO> leakDoInResponse() {
        return CommonResult.success(new ForbiddenFootgunDO());
    }
}
