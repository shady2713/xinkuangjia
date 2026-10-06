package com.basicframework.module.system.controller.admin.logger.vo.loginlog;

import com.basicframework.framework.excel.core.annotations.DictFormat;
import com.basicframework.framework.excel.core.convert.DictConvert;
import com.basicframework.module.system.enums.DictTypeConstants;
import cn.idev.excel.annotation.ExcelIgnoreUnannotated;
import cn.idev.excel.annotation.ExcelProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * LoginLogRespVO 响应对象，承载接口输出数据。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/logger/vo/loginlog/LoginLogRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 2 行，上游代码 1 行在本地被移除或改写，例如 @Schema(description = "用户账号", requiredMode = Schema.RequiredMode.REQUIRED, example = "admin")；@SuppressWarnings("PMD.AvoidUsingHardCodedIP") // 文档示例用于说明 IP 格式，并非服务端连接地址。；本地补充注释 30 行。
 */
@Schema(description = "管理后台 - 登录日志 Response VO")
@Data
@ExcelIgnoreUnannotated
public class LoginLogRespVO {

    /**
     * 日志编号。
     */
    @Schema(description = "日志编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @ExcelProperty("日志主键")
    private Long id;

    /**
     * 日志类型，参见 LoginLogTypeEnum 枚举类。
     */
    @Schema(description = "日志类型，参见 LoginLogTypeEnum 枚举类", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @ExcelProperty(value = "日志类型", converter = DictConvert.class)
    @DictFormat(DictTypeConstants.LOGIN_TYPE)
    private Integer logType;

    /**
     * 用户编号。
     */
    @Schema(description = "用户编号", example = "666")
    private Long userId;

    /**
     * 用户类型，参见 UserTypeEnum 枚举。
     */
    @Schema(description = "用户类型，参见 UserTypeEnum 枚举", requiredMode = Schema.RequiredMode.REQUIRED, example = "2")
    private Integer userType;

    /**
     * 链路追踪编号。
     */
    @Schema(description = "链路追踪编号", example = "89aca178-a370-411c-ae02-3f0d672be4ab")
    private String traceId;

    /**
     * 用户账号。
     */
    @Schema(description = "用户账号", requiredMode = Schema.RequiredMode.REQUIRED, example = "admin")
    @ExcelProperty("用户账号")
    private String username;

    /**
     * 登录结果，参见 LoginResultEnum 枚举类。
     */
    @Schema(description = "登录结果，参见 LoginResultEnum 枚举类", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @ExcelProperty(value = "登录结果", converter = DictConvert.class)
    @DictFormat(DictTypeConstants.LOGIN_RESULT)
    private Integer result;

    /**
     * 用户 IP。
     */
    @SuppressWarnings("PMD.AvoidUsingHardCodedIP") // 文档示例用于说明 IP 格式，并非服务端连接地址。
    @Schema(description = "用户 IP", requiredMode = Schema.RequiredMode.REQUIRED, example = "127.0.0.1")
    @ExcelProperty("登录 IP")
    private String userIp;

    /**
     * 浏览器 UserAgent。
     */
    @Schema(description = "浏览器 UserAgent", example = "Mozilla/5.0")
    @ExcelProperty("浏览器 UA")
    private String userAgent;

    /**
     * 登录时间。
     */
    @Schema(description = "登录时间", requiredMode = Schema.RequiredMode.REQUIRED)
    @ExcelProperty("登录时间")
    private LocalDateTime createTime;

}
