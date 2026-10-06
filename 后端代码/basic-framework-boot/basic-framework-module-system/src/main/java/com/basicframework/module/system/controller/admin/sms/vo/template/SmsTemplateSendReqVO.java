package com.basicframework.module.system.controller.admin.sms.vo.template;

import com.basicframework.framework.common.validation.Mobile;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

import java.util.Map;

/**
 * SmsTemplateSendReqVO 请求对象，承载接口输入参数。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/sms/vo/template/SmsTemplateSendReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 5 行，上游代码 4 行在本地被移除或改写，例如 @Schema(description = "管理后台 - 短信模板发送 Request VO")；@Schema(description = "手机号", requiredMode = Schema.RequiredMode.REQUIRED, example = "")；本地补充注释 9 行。
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