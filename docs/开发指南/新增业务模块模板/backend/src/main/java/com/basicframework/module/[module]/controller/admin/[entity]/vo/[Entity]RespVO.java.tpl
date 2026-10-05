package com.basicframework.module.[module].controller.admin.[entity].vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * [entity-name]响应。
 *
 * <p>只输出列表与详情需要展示的字段，不直接返回 DO：DO 携带逻辑删除标记与审计字段，
 * 直接输出会把持久化结构固化成对外契约。凭据类字段不得出现在响应对象里。</p>
 *
 * <p>占位符：[module]、[entity]、[Entity]、[entity-name]。</p>
 *
 * @author [author]
 */
@Schema(description = "管理后台 - [entity-name] Response VO")
@Data
public class [Entity]RespVO {

    /** 主键编号。 */
    @Schema(description = "编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    private Long id;

    /** [entity-name]名称。 */
    @Schema(description = "[entity-name]名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "示例")
    private String name;

    /** 状态：0 开启、1 关闭。 */
    @Schema(description = "状态", requiredMode = Schema.RequiredMode.REQUIRED, example = "0")
    private Integer status;

    /** 备注。 */
    @Schema(description = "备注", example = "备注")
    private String remark;

    /** 创建时间。 */
    @Schema(description = "创建时间", requiredMode = Schema.RequiredMode.REQUIRED)
    private LocalDateTime createTime;

}
