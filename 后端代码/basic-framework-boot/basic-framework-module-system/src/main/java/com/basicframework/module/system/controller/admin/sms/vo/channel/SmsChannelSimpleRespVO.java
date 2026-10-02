package com.basicframework.module.system.controller.admin.sms.vo.channel;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * SmsChannelSimpleRespVO 响应对象，承载接口输出数据。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 短信渠道精简 Response VO")
@Data
public class SmsChannelSimpleRespVO {

    /**
     * 编号。
     */
    @Schema(description = "编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    private Long id;

    /**
     * 短信签名。
     */
    @Schema(description = "短信签名", requiredMode = Schema.RequiredMode.REQUIRED, example = "基础框架")
    private String signature;

    /**
     * 渠道编码，参见 SmsChannelEnum 枚举类。
     */
    @Schema(description = "渠道编码，参见 SmsChannelEnum 枚举类", requiredMode = Schema.RequiredMode.REQUIRED, example = "YUN_PIAN")
    private String code;

}
