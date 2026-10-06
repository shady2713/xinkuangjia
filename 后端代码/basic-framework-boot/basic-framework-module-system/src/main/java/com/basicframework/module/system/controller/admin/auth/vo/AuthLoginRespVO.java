package com.basicframework.module.system.controller.admin.auth.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * AuthLoginRespVO 响应对象，承载接口输出数据。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/auth/vo/AuthLoginRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地补充注释 12 行。
 * 来源验收：尚未验收
 */
@Schema(description = "管理后台 - 登录 Response VO")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AuthLoginRespVO {

    /**
     * 用户编号。
     */
    @Schema(description = "用户编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    private Long userId;

    /**
     * 访问令牌。
     */
    @Schema(description = "访问令牌", requiredMode = Schema.RequiredMode.REQUIRED, example = "happy")
    private String accessToken;

    /**
     * 刷新令牌。
     */
    @Schema(description = "刷新令牌", requiredMode = Schema.RequiredMode.REQUIRED, example = "nice")
    private String refreshToken;

    /**
     * 过期时间。
     */
    @Schema(description = "过期时间", requiredMode = Schema.RequiredMode.REQUIRED)
    private LocalDateTime expiresTime;

}
