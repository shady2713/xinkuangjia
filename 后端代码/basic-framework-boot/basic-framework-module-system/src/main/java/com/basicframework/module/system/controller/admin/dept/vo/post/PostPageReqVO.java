package com.basicframework.module.system.controller.admin.dept.vo.post;

import com.basicframework.framework.common.pojo.PageParam;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * PostPageReqVO 请求对象，承载接口输入参数。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 岗位分页 Request VO")
@Data
@EqualsAndHashCode(callSuper = true)
public class PostPageReqVO extends PageParam {

    /**
     * 岗位编码，模糊匹配。
     */
    @Schema(description = "岗位编码，模糊匹配", example = "POST_ADMIN")
    private String code;

    /**
     * 岗位名称，模糊匹配。
     */
    @Schema(description = "岗位名称，模糊匹配", example = "技术总监")
    private String name;

    /**
     * 展示状态，参见 CommonStatusEnum 枚举类。
     */
    @Schema(description = "展示状态，参见 CommonStatusEnum 枚举类", example = "1")
    private Integer status;

}
