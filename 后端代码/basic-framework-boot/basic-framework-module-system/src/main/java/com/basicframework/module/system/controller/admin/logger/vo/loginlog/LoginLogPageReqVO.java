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
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/
 * 上游文件续：system/controller/admin/logger/vo/loginlog/LoginLogPageReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 3 行，移除或改写上游 2 行；import 新增 1 行、移除 1 行；补充注释 17 行。
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
