package com.basicframework.module.system.controller.admin.dict.vo.data;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.pojo.PageParam;
import com.basicframework.framework.common.validation.InEnum;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;

import jakarta.validation.constraints.Size;

/**
 * DictDataPageReqVO 请求对象，承载接口输入参数。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 字典类型分页列表 Request VO")
@Data
@EqualsAndHashCode(callSuper = true)
public class DictDataPageReqVO extends PageParam {

    /**
     * 字典标签。
     */
    @Schema(description = "字典标签", example = "启用")
    @Size(max = 100, message = "字典标签长度不能超过100个字符")
    private String label;

    /**
     * 字典类型，模糊匹配。
     */
    @Schema(description = "字典类型，模糊匹配", example = "sys_common_see")
    @Size(max = 100, message = "字典类型类型长度不能超过100个字符")
    private String dictType;

    /**
     * 展示状态，参见 CommonStatusEnum 枚举类。
     */
    @Schema(description = "展示状态，参见 CommonStatusEnum 枚举类", example = "1")
    @InEnum(value = CommonStatusEnum.class, message = "修改状态必须是 {value}")
    private Integer status;

}
