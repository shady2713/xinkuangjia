package com.basicframework.module.system.controller.admin.user.vo.profile;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotEmpty;
import lombok.Data;

/**
 * 管理后台个人中心修改密码请求。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 用户个人中心更新密码 Request VO")
@Data
public class UserProfileUpdatePasswordReqVO {

    /**
     * 旧密码的 MD5 摘要，与当前登录请求保持一致。
     */
    @Schema(description = "旧密码", requiredMode = Schema.RequiredMode.REQUIRED, example = "oldPassword")
    @NotEmpty(message = "旧密码不能为空")
    private String oldPassword;

    /**
     * 新密码的 MD5 摘要；原密码复杂度由前端校验，服务层继续使用 BCrypt 存储。
     */
    @Schema(description = "新密码", requiredMode = Schema.RequiredMode.REQUIRED, example = "")
    @NotEmpty(message = "新密码不能为空")
    // 按当前接口约定接收 MD5 摘要，不对摘要执行原密码的长度和复杂度校验。
    private String newPassword;

}
