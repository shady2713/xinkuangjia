package com.basicframework.module.system.controller.admin.user.vo.user;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * 管理后台更新指定用户密码请求。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/user/vo/user/UserUpdatePasswordReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 1 行，上游代码 2 行在本地被移除或改写，例如 @Schema(description = "密码", requiredMode = Schema.RequiredMode.REQUIRED, example = "")；本地补充注释 7 行。
 */
@Schema(description = "管理后台 - 用户更新密码 Request VO")
@Data
public class UserUpdatePasswordReqVO {

    /**
     * 用户编号。
     */
    @Schema(description = "用户编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @NotNull(message = "用户编号不能为空")
    private Long id;

    /**
     * 前端完成复杂度校验后提交的密码 MD5 摘要，服务层使用 BCrypt 存储。
     */
    @Schema(description = "密码", requiredMode = Schema.RequiredMode.REQUIRED, example = "")
    @NotEmpty(message = "密码不能为空")
    // 接口接收 MD5 摘要，不对摘要执行原密码的长度和复杂度校验。
    private String password;

}
