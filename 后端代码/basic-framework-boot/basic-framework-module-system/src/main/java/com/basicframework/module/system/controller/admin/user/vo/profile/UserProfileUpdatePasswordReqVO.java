package com.basicframework.module.system.controller.admin.user.vo.profile;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotEmpty;
import lombok.Data;

/**
 * 管理后台个人中心修改密码请求。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/
 * 上游文件续：controller/admin/user/vo/profile/UserProfileUpdatePasswordReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 2 行，移除或改写上游 4 行；import 新增 1 行、移除 2 行；补充注释 12 行。
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
