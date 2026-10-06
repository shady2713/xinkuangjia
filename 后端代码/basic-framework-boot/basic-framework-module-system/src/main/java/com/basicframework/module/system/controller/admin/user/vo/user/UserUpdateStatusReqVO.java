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
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/
 * 上游文件续：system/controller/admin/user/vo/user/UserUpdateStatusReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地补充注释 6 行。
 * 来源验收：尚未验收
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
