package com.basicframework.module.system.controller.admin.sms.vo.template;

import com.basicframework.framework.common.pojo.PageParam;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.ToString;
import org.springframework.format.annotation.DateTimeFormat;

import java.time.LocalDateTime;

import static cn.hutool.core.date.DatePattern.NORM_DATETIME_PATTERN;

/**
 * SmsTemplatePageReqVO 请求对象，承载接口输入参数。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 短信模板分页 Request VO")
@Data
@EqualsAndHashCode(callSuper = true)
@ToString(callSuper = true)
public class SmsTemplatePageReqVO extends PageParam {

    /**
     * 短信签名。
     */
    @Schema(description = "短信签名", example = "1")
    private Integer type;

    /**
     * 开启状态。
     */
    @Schema(description = "开启状态", example = "1")
    private Integer status;

    /**
     * 模板编码，模糊匹配。
     */
    @Schema(description = "模板编码，模糊匹配", example = "test_01")
    private String code;

    /**
     * 模板内容，模糊匹配。
     */
    @Schema(description = "模板内容，模糊匹配", example = "你好，{name}。你长的太{like}啦！")
    private String content;

    /**
     * 短信 API 的模板编号，模糊匹配。
     */
    @Schema(description = "短信 API 的模板编号，模糊匹配", example = "4383920")
    private String apiTemplateId;

    /**
     * 短信渠道编号。
     */
    @Schema(description = "短信渠道编号", example = "10")
    private Long channelId;

    /**
     * 创建时间。
     */
    @DateTimeFormat(pattern = NORM_DATETIME_PATTERN)
    @Schema(description = "创建时间")
    private LocalDateTime[] createTime;

}
