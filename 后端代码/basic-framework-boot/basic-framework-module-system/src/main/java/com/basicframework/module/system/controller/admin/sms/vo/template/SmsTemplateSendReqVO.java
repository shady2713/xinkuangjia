package com.basicframework.module.system.controller.admin.sms.vo.template;

import com.basicframework.framework.common.validation.Mobile;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

import java.util.Map;

/**
 * SmsTemplateSendReqVO 请求对象，承载接口输入参数。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 短信模板发送 Request VO")
@Data
public class SmsTemplateSendReqVO {

    /**
     * 手机号。
     */
    @Schema(description = "手机号", requiredMode = Schema.RequiredMode.REQUIRED, example = "")
    @NotBlank(message = "手机号不能为空")
    @Mobile
    private String mobile;

    /**
     * 模板编码。
     */
    @Schema(description = "模板编码", requiredMode = Schema.RequiredMode.REQUIRED, example = "test_01")
    @NotBlank(message = "模板编码不能为空")
    private String templateCode;

    /**
     * 模板参数。
     */
    @Schema(description = "模板参数")
    private Map<String, Object> templateParams;

}