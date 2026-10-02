package com.basicframework.module.system.controller.admin.auth.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * AuthShareLoginRespVO 响应对象，承载接口输出数据。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 分享码自动登录 Response VO")
@Data
@EqualsAndHashCode(callSuper = true)
public class AuthShareLoginRespVO extends AuthLoginRespVO {

    /**
     * 登录成功后跳转的首个有权限菜单地址。
     */
    @Schema(description = "登录成功后跳转的首个有权限菜单地址", requiredMode = Schema.RequiredMode.REQUIRED,
            example = "/ai/task")
    private String redirectPath;

}
