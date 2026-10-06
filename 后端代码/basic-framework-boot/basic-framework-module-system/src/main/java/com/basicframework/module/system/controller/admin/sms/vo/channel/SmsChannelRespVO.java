package com.basicframework.module.system.controller.admin.sms.vo.channel;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import org.hibernate.validator.constraints.URL;

import jakarta.validation.constraints.NotNull;
import java.time.LocalDateTime;

/**
 * 管理后台短信渠道响应。
 *
 * <p>响应不得包含短信 API 密钥；密钥只在新增或修改时由调用方提交，服务端不提供反向读取。
 * 读取接口只返回 {@code apiKey} 与回调地址等非秘密字段，查询权限不构成获取第三方服务凭据的依据。</p>
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/
 * 上游文件续：system/controller/admin/sms/vo/channel/SmsChannelRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 3 行，移除或改写上游 5 行；import 新增 1 行、移除 1 行；补充注释 32 行。
 * 来源验收：尚未验收
 */
@Schema(description = "管理后台 - 短信渠道 Response VO")
@Data
public class SmsChannelRespVO {

    /**
     * 编号。
     */
    @Schema(description = "编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    private Long id;

    /**
     * 短信签名。
     */
    @Schema(description = "短信签名", requiredMode = Schema.RequiredMode.REQUIRED, example = "基础框架")
    @NotNull(message = "短信签名不能为空")
    private String signature;

    /**
     * 渠道编码，参见 SmsChannelEnum 枚举类。
     */
    @Schema(description = "渠道编码，参见 SmsChannelEnum 枚举类", requiredMode = Schema.RequiredMode.REQUIRED, example = "YUN_PIAN")
    private String code;

    /**
     * 启用状态。
     */
    @Schema(description = "启用状态", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @NotNull(message = "启用状态不能为空")
    private Integer status;

    /**
     * 备注。
     */
    @Schema(description = "备注", example = "好吃！")
    private String remark;

    /**
     * 短信 API 的账号。
     */
    @Schema(description = "短信 API 的账号", requiredMode = Schema.RequiredMode.REQUIRED, example = "sms-access-key")
    @NotNull(message = "短信 API 的账号不能为空")
    private String apiKey;

    /**
     * 短信发送回调 URL。
     */
    @Schema(description = "短信发送回调 URL", example = "https://www.example.com")
    @URL(message = "回调 URL 格式不正确")
    private String callbackUrl;

    /**
     * 创建时间。
     */
    @Schema(description = "创建时间", requiredMode = Schema.RequiredMode.REQUIRED)
    private LocalDateTime createTime;

}
