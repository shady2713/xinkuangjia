package com.basicframework.module.system.controller.admin.logger.vo.loginlog;

import com.basicframework.framework.common.pojo.PageParam;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;
import org.springframework.format.annotation.DateTimeFormat;

import java.time.LocalDateTime;

import static cn.hutool.core.date.DatePattern.NORM_DATETIME_PATTERN;

/**
 * LoginLogPageReqVO 请求对象，承载接口输入参数。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 登录日志分页列表 Request VO")
@Data
@EqualsAndHashCode(callSuper = true)
public class LoginLogPageReqVO extends PageParam {

    /**
     * 用户 IP，模拟匹配。
     */
    @SuppressWarnings("PMD.AvoidUsingHardCodedIP") // 文档示例用于说明 IP 格式，并非服务端连接地址。
    @Schema(description = "用户 IP，模拟匹配", example = "127.0.0.1")
    private String userIp;

    /**
     * 用户账号，模拟匹配。
     */
    @Schema(description = "用户账号，模拟匹配", example = "admin")
    private String username;

    /**
     * 操作状态。
     */
    @Schema(description = "操作状态", example = "true")
    private Boolean status;

    /**
     * 登录时间。
     */
    @Schema(description = "登录时间", example = "[2022-07-01 00:00:00,2022-07-01 23:59:59]")
    @DateTimeFormat(pattern = NORM_DATETIME_PATTERN)
    private LocalDateTime[] createTime;

}
