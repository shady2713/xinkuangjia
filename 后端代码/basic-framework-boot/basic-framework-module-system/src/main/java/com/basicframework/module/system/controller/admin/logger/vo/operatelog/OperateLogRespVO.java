package com.basicframework.module.system.controller.admin.logger.vo.operatelog;

import com.basicframework.framework.excel.core.annotations.DictFormat;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import cn.idev.excel.annotation.ExcelIgnoreUnannotated;
import cn.idev.excel.annotation.ExcelProperty;
import com.basicframework.module.system.enums.DictTypeConstants;
import com.fhs.core.trans.anno.Trans;
import com.fhs.core.trans.constant.TransType;
import com.fhs.core.trans.vo.VO;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotEmpty;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * OperateLogRespVO 响应对象，承载接口输出数据。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/
 * 上游文件续：controller/admin/logger/vo/operatelog/OperateLogRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 4 行，移除或改写上游 3 行；import 新增 4 行、移除 4 行；补充注释 50 行。
 */
@Schema(description = "管理后台 - 操作日志 Response VO")
@Data
@ExcelIgnoreUnannotated
public class OperateLogRespVO implements VO {

    /**
     * 日志编号。
     */
    @Schema(description = "日志编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @ExcelProperty("日志编号")
    private Long id;

    /**
     * 链路追踪编号。
     */
    @Schema(description = "链路追踪编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "89aca178-a370-411c-ae02-3f0d672be4ab")
    private String traceId;

    /**
     * 用户编号。
     */
    @Schema(description = "用户编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @Trans(type = TransType.SIMPLE, target = AdminUserDO.class, fields = "nickname", ref = "userName")
    private Long userId;
    /**
     * 用户昵称。
     */
    @Schema(description = "用户昵称", requiredMode = Schema.RequiredMode.REQUIRED, example = "管理员")
    @ExcelProperty("操作人")
    private String userName;

    /**
     * 用户类型。
     */
    @Schema(description = "用户类型", requiredMode = Schema.RequiredMode.REQUIRED, example = "1", implementation = Integer.class)
    @ExcelProperty("用户类型")
    @DictFormat(DictTypeConstants.USER_TYPE)
    private Integer userType;

    /**
     * 操作模块类型。
     */
    @Schema(description = "操作模块类型", requiredMode = Schema.RequiredMode.REQUIRED, example = "订单")
    @ExcelProperty("操作模块类型")
    private String type;

    /**
     * 操作名。
     */
    @Schema(description = "操作名", requiredMode = Schema.RequiredMode.REQUIRED, example = "创建订单")
    @ExcelProperty("操作名")
    private String subType;

    /**
     * 操作模块业务编号。
     */
    @Schema(description = "操作模块业务编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @ExcelProperty("操作模块业务编号")
    private Long bizId;

    /**
     * 操作明细。
     */
    @Schema(description = "操作明细", example = "修改编号为 1 的用户信息，将性别从男改成女，将姓名从张三改成李四。")
    private String action;

    /**
     * 拓展字段。
     */
    @Schema(description = "拓展字段", example = "{'orderId': 1}")
    private String extra;

    /**
     * 请求方法名。
     */
    @Schema(description = "请求方法名", requiredMode = Schema.RequiredMode.REQUIRED, example = "GET")
    @NotEmpty(message = "请求方法名不能为空")
    private String requestMethod;

    /**
     * 请求地址。
     */
    @Schema(description = "请求地址", requiredMode = Schema.RequiredMode.REQUIRED, example = "/eee/yyy")
    private String requestUrl;

    /**
     * 用户 IP。
     */
    @SuppressWarnings("PMD.AvoidUsingHardCodedIP") // 文档示例用于说明 IP 格式，并非服务端连接地址。
    @Schema(description = "用户 IP", requiredMode = Schema.RequiredMode.REQUIRED, example = "127.0.0.1")
    private String userIp;

    /**
     * 浏览器 UserAgent。
     */
    @Schema(description = "浏览器 UserAgent", requiredMode = Schema.RequiredMode.REQUIRED, example = "Mozilla/5.0")
    private String userAgent;

    /**
     * 创建时间。
     */
    @Schema(description = "创建时间", requiredMode = Schema.RequiredMode.REQUIRED)
    private LocalDateTime createTime;

}
