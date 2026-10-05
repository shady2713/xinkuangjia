package com.basicframework.module.[module].controller.admin.[entity].vo;

import com.basicframework.framework.common.pojo.PageParam;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * [entity-name]分页查询请求。
 *
 * <p>继承 PageParam 复用 pageNo/pageSize 契约；筛选字段全部可选，为空表示不参与过滤，
 * 由 Service 用 likeIfPresent/eqIfPresent 表达，避免把空条件拼成恒真或恒假 SQL。</p>
 *
 * <p>占位符：[module]、[entity]、[Entity]、[entity-name]。</p>
 *
 * @author [author]
 */
@Schema(description = "管理后台 - [entity-name]分页 Request VO")
@Data
@EqualsAndHashCode(callSuper = true)
public class [Entity]PageReqVO extends PageParam {

    /** [entity-name]名称，模糊匹配。 */
    @Schema(description = "[entity-name]名称", example = "示例")
    private String name;

    /** 状态：0 开启、1 关闭，精确匹配。 */
    @Schema(description = "状态", example = "0")
    private Integer status;

}
