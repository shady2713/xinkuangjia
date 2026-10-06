package com.basicframework.module.system.controller.admin.permission.vo.role;

import com.basicframework.framework.excel.core.annotations.DictFormat;
import com.basicframework.framework.excel.core.convert.DictConvert;
import com.basicframework.module.system.enums.DictTypeConstants;
import cn.idev.excel.annotation.ExcelIgnoreUnannotated;
import cn.idev.excel.annotation.ExcelProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.Set;

/**
 * RoleRespVO 响应对象，承载接口输出数据。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/
 * 上游文件续：system/controller/admin/permission/vo/role/RoleRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 5 行，移除或改写上游 3 行；import 新增 1 行、移除 1 行；补充注释 38 行。
 */
@Schema(description = "管理后台 - 角色信息 Response VO")
@Data
@ExcelIgnoreUnannotated
public class RoleRespVO {

    /**
     * 角色编号。
     */
    @Schema(description = "角色编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @ExcelProperty("角色编号")
    private Long id;

    /**
     * 角色名称。
     */
    @Schema(description = "角色名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "管理员")
    @ExcelProperty("角色名称")
    private String name;

    /**
     * 角色标志。
     */
    @Schema(description = "角色标志", requiredMode = Schema.RequiredMode.REQUIRED, example = "admin")
    @NotBlank(message = "角色标志不能为空")
    @ExcelProperty("角色标识")
    private String code;

    /**
     * 所属后台类型。
     */
    @Schema(description = "所属后台类型", requiredMode = Schema.RequiredMode.REQUIRED, example = "business_admin")
    private String roleType;

    /**
     * 显示顺序。
     */
    @Schema(description = "显示顺序", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @ExcelProperty("显示顺序")
    private Integer sort;

    /**
     * 状态，参见 CommonStatusEnum 枚举类。
     */
    @Schema(description = "状态，参见 CommonStatusEnum 枚举类", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @ExcelProperty(value = "角色状态", converter = DictConvert.class)
    @DictFormat(DictTypeConstants.COMMON_STATUS)
    private Integer status;

    /**
     * 角色类型，参见 RoleTypeEnum 枚举类。
     */
    @Schema(description = "角色类型，参见 RoleTypeEnum 枚举类", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    private Integer type;

    /**
     * 备注。
     */
    @Schema(description = "备注", example = "我是一个角色")
    private String remark;

    /**
     * 数据范围，参见 DataScopeEnum 枚举类。
     */
    @Schema(description = "数据范围，参见 DataScopeEnum 枚举类", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @ExcelProperty(value = "数据范围", converter = DictConvert.class)
    @DictFormat(DictTypeConstants.DATA_SCOPE)
    private Integer dataScope;

    /**
     * 数据范围(指定部门数组)。
     */
    @Schema(description = "数据范围(指定部门数组)", example = "1")
    private Set<Long> dataScopeDeptIds;

    /**
     * 创建时间。
     */
    @Schema(description = "创建时间", requiredMode = Schema.RequiredMode.REQUIRED, example = "时间戳格式")
    private LocalDateTime createTime;

}
