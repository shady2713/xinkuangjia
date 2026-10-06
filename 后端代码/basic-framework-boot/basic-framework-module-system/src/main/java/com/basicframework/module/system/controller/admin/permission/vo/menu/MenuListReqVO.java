package com.basicframework.module.system.controller.admin.permission.vo.menu;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * MenuListReqVO 请求对象，承载接口输入参数。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/
 * 上游文件续：system/controller/admin/permission/vo/menu/MenuListReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 3 行，移除或改写上游 1 行；补充注释 14 行。
 * 来源验收：尚未验收
 */
@Schema(description = "管理后台 - 菜单列表 Request VO")
@Data
public class MenuListReqVO {

    /**
     * 菜单名称，模糊匹配。
     */
    @Schema(description = "菜单名称，模糊匹配", example = "系统管理")
    private String name;

    /**
     * 展示状态，参见 CommonStatusEnum 枚举类。
     */
    @Schema(description = "展示状态，参见 CommonStatusEnum 枚举类", example = "1")
    private Integer status;

    /**
     * 所属后台类型，后端按当前登录用户自动填充。
     */
    @Schema(description = "所属后台类型，后端按当前登录用户自动填充", hidden = true)
    private String menuType;

}
