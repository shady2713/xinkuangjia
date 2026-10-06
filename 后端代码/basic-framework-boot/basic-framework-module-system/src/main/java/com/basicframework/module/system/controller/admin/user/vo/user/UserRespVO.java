package com.basicframework.module.system.controller.admin.user.vo.user;

import com.basicframework.framework.excel.core.annotations.DictFormat;
import com.basicframework.framework.excel.core.convert.DictConvert;
import com.basicframework.module.system.enums.DictTypeConstants;
import cn.idev.excel.annotation.ExcelIgnoreUnannotated;
import cn.idev.excel.annotation.ExcelProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.Set;
import java.util.List;

/**
 * UserRespVO 响应对象，承载接口输出数据。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/user/vo/user/UserRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 12 行，移除或改写上游 7 行；import 新增 1 行、移除 0 行；补充注释 54 行。
 * 来源验收：尚未验收
 */
@Schema(description = "管理后台 - 用户信息 Response VO")
@Data
@ExcelIgnoreUnannotated
public class UserRespVO{

    /** 当前平台已分配角色的名称；用户列表只读展示，不参与用户保存。 */
    @Schema(description = "当前平台已分配角色名称")
    private List<String> roleNames;

    /**
     * 用户编号。
     */
    @Schema(description = "用户编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @ExcelProperty("用户编号")
    private Long id;

    /**
     * 用户账号。
     */
    @Schema(description = "用户账号", requiredMode = Schema.RequiredMode.REQUIRED, example = "admin")
    @ExcelProperty("用户名称")
    private String username;

    /**
     * 所属后台类型。
     */
    @Schema(description = "所属后台类型", requiredMode = Schema.RequiredMode.REQUIRED, example = "business_admin")
    private String userType;

    /**
     * 用户昵称。
     */
    @Schema(description = "用户昵称", requiredMode = Schema.RequiredMode.REQUIRED, example = "管理员")
    @ExcelProperty("用户昵称")
    private String nickname;

    /**
     * 备注。
     */
    @Schema(description = "备注", example = "我是一个用户")
    private String remark;

    /**
     * 部门 ID。
     */
    @Schema(description = "部门ID", example = "我是一个用户")
    private Long deptId;
    /**
     * 部门名称。
     */
    @Schema(description = "部门名称", example = "IT 部")
    @ExcelProperty("部门")
    private String deptName;

    /**
     * 岗位编号数组。
     */
    @Schema(description = "岗位编号数组", example = "1")
    private Set<Long> postIds;

    /**
     * 用户邮箱。
     */
    @Schema(description = "用户邮箱", example = "admin@example.com")
    @ExcelProperty("用户邮箱")
    private String email;

    /**
     * 手机号码。
     */
    @Schema(description = "手机号码", example = "")
    @ExcelProperty("手机号码")
    private String mobile;

    /**
     * 用户性别，参见 SexEnum 枚举类。
     */
    @Schema(description = "用户性别，参见 SexEnum 枚举类", example = "1")
    @ExcelProperty(value = "用户性别", converter = DictConvert.class)
    @DictFormat(DictTypeConstants.USER_SEX)
    private Integer sex;

    /**
     * 用户头像。
     */
    @Schema(description = "用户头像", example = "https://www.example.com/xxx.png")
    private String avatar;

    /**
     * 状态，参见 CommonStatusEnum 枚举类。
     */
    @Schema(description = "状态，参见 CommonStatusEnum 枚举类", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @ExcelProperty(value = "状态", converter = DictConvert.class)
    @DictFormat(DictTypeConstants.COMMON_STATUS)
    private Integer status;

    /**
     * 最后登录 IP。
     */
    @SuppressWarnings("PMD.AvoidUsingHardCodedIP") // 文档示例用于说明 IP 格式，并非服务端连接地址。
    @Schema(description = "最后登录 IP", requiredMode = Schema.RequiredMode.REQUIRED, example = "192.168.1.1")
    @ExcelProperty("最后登录IP")
    private String loginIp;

    /**
     * 最后登录时间。
     */
    @Schema(description = "最后登录时间", requiredMode = Schema.RequiredMode.REQUIRED, example = "时间戳格式")
    @ExcelProperty("最后登录时间")
    private LocalDateTime loginDate;

    /**
     * 创建时间。
     */
    @Schema(description = "创建时间", requiredMode = Schema.RequiredMode.REQUIRED, example = "时间戳格式")
    private LocalDateTime createTime;

}
