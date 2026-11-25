package com.basicframework.module.system.controller.admin.user.vo.user;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.pojo.PageParam;
import com.basicframework.framework.common.validation.InEnum;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;

import java.time.LocalDateTime;

import static cn.hutool.core.date.DatePattern.NORM_DATETIME_PATTERN;

/**
 * UserPageReqVO 请求对象，承载接口输入参数。
 *
 * @author shady
 */
@Schema(description = "管理后台 - 用户分页 Request VO")
@Data
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode(callSuper = true)
public class UserPageReqVO extends PageParam {

    /**
     * 用户账号，模糊匹配。
     */
    @Schema(description = "用户账号，模糊匹配", example = "admin")
    @Size(max = 30, message = "用户账号长度不能超过 30 个字符")
    private String username;

    /**
     * 手机号码，模糊匹配。
     */
    @Schema(description = "手机号码，模糊匹配", example = "")
    @Size(max = 11, message = "手机号码长度不能超过 11 个字符")
    private String mobile;

    /**
     * 展示状态，参见 CommonStatusEnum 枚举类。
     */
    @Schema(description = "展示状态，参见 CommonStatusEnum 枚举类", example = "1")
    @InEnum(value = CommonStatusEnum.class, message = "状态必须是 {value}")
    private Integer status;

    /**
     * 创建时间。
     */
    @Schema(description = "创建时间", example = "[2022-07-01 00:00:00, 2022-07-01 23:59:59]")
    @DateTimeFormat(pattern = NORM_DATETIME_PATTERN)
    @Size(max = 2, message = "创建时间范围最多包含 2 个时间点")
    private LocalDateTime[] createTime;

    /**
     * 部门编号，同时筛选子部门。
     */
    @Schema(description = "部门编号，同时筛选子部门", example = "1024")
    private Long deptId;

    /**
     * 角色编号。
     */
    @Schema(description = "角色编号", example = "1024")
    private Long roleId;

    /**
     * 所属后台类型，后端按当前登录用户自动填充。
     */
    @Schema(description = "所属后台类型，后端按当前登录用户自动填充", hidden = true)
    private String userType;

}
