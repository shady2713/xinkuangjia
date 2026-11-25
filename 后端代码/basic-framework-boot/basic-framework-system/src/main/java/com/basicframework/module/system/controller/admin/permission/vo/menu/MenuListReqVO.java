package com.basicframework.module.system.controller.admin.permission.vo.menu;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.validation.InEnum;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * MenuListReqVO 请求对象，承载接口输入参数。
 *
 * @author shady
 */
@Schema(description = "管理后台 - 菜单列表 Request VO")
@Data
public class MenuListReqVO {

    /**
     * 菜单名称，模糊匹配。
     */
    @Schema(description = "菜单名称，模糊匹配", example = "系统管理")
    @Size(max = 50, message = "菜单名称长度不能超过 50 个字符")
    private String name;

    /**
     * 展示状态，参见 CommonStatusEnum 枚举类。
     */
    @Schema(description = "展示状态，参见 CommonStatusEnum 枚举类", example = "1")
    @InEnum(value = CommonStatusEnum.class, message = "状态必须是 {value}")
    private Integer status;

    /**
     * 所属后台类型，后端按当前登录用户自动填充。
     */
    @Schema(description = "所属后台类型，后端按当前登录用户自动填充", hidden = true)
    private String menuType;

}
