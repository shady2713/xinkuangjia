package com.basicframework.module.[module].controller.admin.[entity].vo;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * [entity-name]新增/修改请求。
 *
 * <p>新增与修改共用一个请求对象：修改时必须带编号，新增时编号必须为空，由 Service 依据编号
 * 是否存在决定是否放过唯一性冲突。名称是业务唯一键，因此声明 @NotBlank 与长度上限；非法输入由
 * 真实 Bean Validation 在进入业务逻辑前拒绝，不会产生半写入数据。</p>
 *
 * <p>占位符：[module]、[entity]、[Entity]、[entity-name]。</p>
 *
 * @author [author]
 */
@Schema(description = "管理后台 - [entity-name]新增/修改 Request VO")
@Data
public class [Entity]SaveReqVO {

    /** 主键编号；新增时为空，修改时必填。 */
    @Schema(description = "编号", example = "1024")
    private Long id;

    /** [entity-name]名称，必填且唯一。 */
    @Schema(description = "[entity-name]名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "示例")
    @NotBlank(message = "[entity-name]名称不能为空")
    @Size(max = 64, message = "[entity-name]名称长度不能超过 64 个字符")
    private String name;

    /** 状态：0 开启、1 关闭。 */
    @Schema(description = "状态", requiredMode = Schema.RequiredMode.REQUIRED, example = "0")
    @NotNull(message = "状态不能为空")
    private Integer status;

    /** 备注。 */
    @Schema(description = "备注", example = "备注")
    @Size(max = 255, message = "备注长度不能超过 255 个字符")
    private String remark;

}
