package com.basicframework.module.system.controller.admin.permission.vo.role;

import com.basicframework.framework.common.pojo.PageParam;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;
import org.springframework.format.annotation.DateTimeFormat;

import java.time.LocalDateTime;

import static cn.hutool.core.date.DatePattern.NORM_DATETIME_PATTERN;

/**
 * RolePageReqVO 请求对象，承载接口输入参数。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 角色分页 Request VO")
@Data
@EqualsAndHashCode(callSuper = true)
public class RolePageReqVO extends PageParam {

    /**
     * 角色名称，模糊匹配。
     */
    @Schema(description = "角色名称，模糊匹配", example = "超级管理员")
    private String name;

    /**
     * 角色标识，模糊匹配。
     */
    @Schema(description = "角色标识，模糊匹配", example = "super_admin")
    private String code;

    /**
     * 展示状态，参见 CommonStatusEnum 枚举类。
     */
    @Schema(description = "展示状态，参见 CommonStatusEnum 枚举类", example = "1")
    private Integer status;

    /**
     * 创建时间。
     */
    @Schema(description = "创建时间", example = "[2022-07-01 00:00:00,2022-07-01 23:59:59]")
    @DateTimeFormat(pattern = NORM_DATETIME_PATTERN)
    private LocalDateTime[] createTime;

    /**
     * 所属后台类型，后端按当前登录用户自动填充。
     */
    @Schema(description = "所属后台类型，后端按当前登录用户自动填充", hidden = true)
    private String roleType;

}
