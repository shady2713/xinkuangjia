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
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/
 * 上游文件续：system/controller/admin/sms/vo/channel/SmsChannelPageReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 4 行，移除或改写上游 2 行；import 新增 1 行、移除 1 行；补充注释 17 行。
 * 来源验收：尚未验收
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
