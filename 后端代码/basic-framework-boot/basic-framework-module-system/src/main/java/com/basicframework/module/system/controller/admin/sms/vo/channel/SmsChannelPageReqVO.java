package com.basicframework.module.system.controller.admin.sms.vo.channel;

import com.basicframework.framework.common.pojo.PageParam;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.ToString;
import org.springframework.format.annotation.DateTimeFormat;

import java.time.LocalDateTime;

import static cn.hutool.core.date.DatePattern.NORM_DATETIME_PATTERN;

/**
 * SmsChannelPageReqVO 请求对象，承载接口输入参数。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 短信渠道分页 Request VO")
@Data
@EqualsAndHashCode(callSuper = true)
@ToString(callSuper = true)
public class SmsChannelPageReqVO extends PageParam {

    /**
     * 任务状态。
     */
    @Schema(description = "任务状态", example = "1")
    private Integer status;

    /**
     * 短信签名，模糊匹配。
     */
    @Schema(description = "短信签名，模糊匹配", example = "基础框架")
    private String signature;

    /**
     * 短信渠道编码。
     */
    @Schema(description = "短信渠道编码", example = "ALIYUN")
    private String code;

    /**
     * 创建时间。
     */
    @DateTimeFormat(pattern = NORM_DATETIME_PATTERN)
    @Schema(description = "创建时间")
    private LocalDateTime[] createTime;

}
