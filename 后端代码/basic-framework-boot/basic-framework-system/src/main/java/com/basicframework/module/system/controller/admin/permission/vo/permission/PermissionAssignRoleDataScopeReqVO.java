package com.basicframework.module.system.controller.admin.permission.vo.permission;

import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.framework.common.validation.InEnum;
import com.basicframework.module.system.enums.permission.DataScopeEnum;
import com.fasterxml.jackson.annotation.JsonIgnore;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

import java.util.Collections;
import java.util.Set;

/**
 * PermissionAssignRoleDataScopeReqVO 请求对象，承载接口输入参数。
 *
 * @author shady
 */
@Schema(description = "管理后台 - 赋予角色数据权限 Request VO")
@Data
public class PermissionAssignRoleDataScopeReqVO {

    private static final int DATA_SCOPE_DEPT_IDS_JSON_MAX_LENGTH = 500;

    /**
     * 角色编号。
     */
    @Schema(description = "角色编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @NotNull(message = "角色编号不能为空")
    private Long roleId;

    /**
     * 数据范围，参见 DataScopeEnum 枚举类。
     */
    @Schema(description = "数据范围，参见 DataScopeEnum 枚举类", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @NotNull(message = "数据范围不能为空")
    @InEnum(value = DataScopeEnum.class, message = "数据范围必须是 {value}")
    private Integer dataScope;

    /**
     * 部门编号列表，只有范围类型为 DEPT_CUSTOM 时，该字段才需要。
     */
    @Schema(description = "部门编号列表，只有范围类型为 DEPT_CUSTOM 时，该字段才需要", example = "1,3,5")
    @Size(max = 100, message = "指定部门数量不能超过 100 个")
    private Set<@NotNull(message = "部门编号不能为空") Long> dataScopeDeptIds = Collections.emptySet(); // 兜底

    /**
     * 限制序列化后的部门集合不超过数据库 {@code system_role.data_scope_dept_ids} 的 varchar(500) 长度。
     */
    @AssertTrue(message = "指定部门集合超出存储上限，请减少勾选数量")
    @JsonIgnore
    public boolean isDataScopeDeptIdsLengthValid() {
        return dataScopeDeptIds == null
                || JsonUtils.toJsonString(dataScopeDeptIds).length() <= DATA_SCOPE_DEPT_IDS_JSON_MAX_LENGTH;
    }

}
