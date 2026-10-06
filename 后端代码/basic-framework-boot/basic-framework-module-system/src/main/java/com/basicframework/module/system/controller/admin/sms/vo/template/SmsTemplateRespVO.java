package com.basicframework.module.system.controller.admin.sms.vo.template;

import com.basicframework.framework.excel.core.annotations.DictFormat;
import com.basicframework.framework.excel.core.convert.DictConvert;
import com.basicframework.module.system.enums.DictTypeConstants;
import cn.idev.excel.annotation.ExcelIgnoreUnannotated;
import cn.idev.excel.annotation.ExcelProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * SmsTemplateRespVO 响应对象，承载接口输出数据。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/sms/vo/template/SmsTemplateRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 1 行，上游代码 1 行在本地被移除或改写，例如 @Schema(description = "模板名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "登录验证码")；本地补充注释 36 行。
 */
@Schema(description = "管理后台 - 短信模板 Response VO")
@Data
@ExcelIgnoreUnannotated
public class SmsTemplateRespVO {

    /**
     * 编号。
     */
    @Schema(description = "编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @ExcelProperty("编号")
    private Long id;

    /**
     * 短信类型，参见 SmsTemplateTypeEnum 枚举类。
     */
    @Schema(description = "短信类型，参见 SmsTemplateTypeEnum 枚举类", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @ExcelProperty(value = "短信签名", converter = DictConvert.class)
    @DictFormat(DictTypeConstants.SMS_TEMPLATE_TYPE)
    private Integer type;

    /**
     * 开启状态，参见 CommonStatusEnum 枚举类。
     */
    @Schema(description = "开启状态，参见 CommonStatusEnum 枚举类", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @ExcelProperty(value = "开启状态", converter = DictConvert.class)
    @DictFormat(DictTypeConstants.COMMON_STATUS)
    private Integer status;

    /**
     * 模板编码。
     */
    @Schema(description = "模板编码", requiredMode = Schema.RequiredMode.REQUIRED, example = "test_01")
    @ExcelProperty("模板编码")
    private String code;

    /**
     * 模板名称。
     */
    @Schema(description = "模板名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "登录验证码")
    @ExcelProperty("模板名称")
    private String name;

    /**
     * 模板内容。
     */
    @Schema(description = "模板内容", requiredMode = Schema.RequiredMode.REQUIRED, example = "你好，{name}。你长的太{like}啦！")
    @ExcelProperty("模板内容")
    private String content;

    /**
     * 参数数组。
     */
    @Schema(description = "参数数组", example = "name,code")
    private List<String> params;

    /**
     * 备注。
     */
    @Schema(description = "备注", example = "哈哈哈")
    @ExcelProperty("备注")
    private String remark;

    /**
     * 短信 API 的模板编号。
     */
    @Schema(description = "短信 API 的模板编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "4383920")
    @ExcelProperty("短信 API 的模板编号")
    private String apiTemplateId;

    /**
     * 短信渠道编号。
     */
    @Schema(description = "短信渠道编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "10")
    @ExcelProperty("短信渠道编号")
    private Long channelId;

    /**
     * 短信渠道编码。
     */
    @Schema(description = "短信渠道编码", requiredMode = Schema.RequiredMode.REQUIRED, example = "ALIYUN")
    @ExcelProperty(value = "短信渠道编码", converter = DictConvert.class)
    @DictFormat(DictTypeConstants.SMS_CHANNEL_CODE)
    private String channelCode;

    /**
     * 创建时间。
     */
    @Schema(description = "创建时间", requiredMode = Schema.RequiredMode.REQUIRED)
    @ExcelProperty("创建时间")
    private LocalDateTime createTime;

}
