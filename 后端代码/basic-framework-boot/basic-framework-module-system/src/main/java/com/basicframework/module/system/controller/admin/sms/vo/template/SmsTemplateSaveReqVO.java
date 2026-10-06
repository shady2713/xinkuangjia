package com.basicframework.module.system.controller.admin.sms.vo.template;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 管理后台短信模板创建或修改请求。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/
 * 上游文件续：system/controller/admin/sms/vo/template/SmsTemplateSaveReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 6 行，移除或改写上游 1 行；import 新增 2 行、移除 1 行；补充注释 32 行。
 * 来源验收：尚未验收
 */
@Schema(description = "管理后台 - 短信模板创建/修改 Request VO")
@Data
public class SmsTemplateSaveReqVO {

    /**
     * 编号。
     */
    @Schema(description = "编号", example = "1024")
    private Long id;

    /**
     * 短信类型，参见 SmsTemplateTypeEnum 枚举类。
     */
    @Schema(description = "短信类型，参见 SmsTemplateTypeEnum 枚举类", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @NotNull(message = "短信类型不能为空")
    private Integer type;

    /**
     * 开启状态，参见 CommonStatusEnum 枚举类。
     */
    @Schema(description = "开启状态，参见 CommonStatusEnum 枚举类", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @NotNull(message = "开启状态不能为空")
    private Integer status;

    /**
     * 模板编码。
     */
    @Schema(description = "模板编码", requiredMode = Schema.RequiredMode.REQUIRED, example = "test_01")
    @NotNull(message = "模板编码不能为空")
    @Size(max = 63, message = "模板编码长度不能超过 63 个字符")
    private String code;

    /**
     * 模板名称。
     */
    @Schema(description = "模板名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "登录验证码")
    @NotNull(message = "模板名称不能为空")
    @Size(max = 63, message = "模板名称长度不能超过 63 个字符")
    private String name;

    /**
     * 模板内容。
     */
    @Schema(description = "模板内容", requiredMode = Schema.RequiredMode.REQUIRED, example = "你好，{name}。你长的太{like}啦！")
    @NotNull(message = "模板内容不能为空")
    @Size(max = 255, message = "模板内容长度不能超过 255 个字符")
    private String content;

    /**
     * 备注。
     */
    @Schema(description = "备注", example = "哈哈哈")
    @Size(max = 255, message = "备注长度不能超过 255 个字符")
    private String remark;

    /**
     * 短信 API 的模板编号。
     */
    @Schema(description = "短信 API 的模板编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "4383920")
    @NotNull(message = "短信 API 的模板编号不能为空")
    @Size(max = 63, message = "短信 API 模板编号长度不能超过 63 个字符")
    private String apiTemplateId;

    /**
     * 短信渠道编号。
     */
    @Schema(description = "短信渠道编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "10")
    @NotNull(message = "短信渠道编号不能为空")
    private Long channelId;

}
