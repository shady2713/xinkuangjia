package com.basicframework.module.system.controller.admin.user.vo.user;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.validation.InEnum;
import com.basicframework.framework.dict.validation.InDict;
import com.basicframework.module.system.enums.DictTypeConstants;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * UserUpdateStatusReqVO 请求对象，承载接口输入参数。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 用户更新状态 Request VO")
@Data
public class UserUpdateStatusReqVO {

    /**
     * 用户编号。
     */
    @Schema(description = "用户编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @NotNull(message = "角色编号不能为空")
    private Long id;

    /**
     * 状态，见 CommonStatusEnum 枚举。
     */
    @Schema(description = "状态，见 CommonStatusEnum 枚举", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @NotNull(message = "状态不能为空")
    @InEnum(value = CommonStatusEnum.class, message = "修改状态必须是 {value}")
    @InDict(type = DictTypeConstants.COMMON_STATUS)
    private Integer status;

}
