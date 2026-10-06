package com.basicframework.module.system.controller.admin.dept.vo.post;

import com.basicframework.framework.common.pojo.PageParam;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * PostPageReqVO 请求对象，承载接口输入参数。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/dept/vo/post/PostPageReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 2 行，上游代码 2 行在本地被移除或改写，例如 @Schema(description = "岗位编码，模糊匹配", example = "POST_ADMIN")；@Schema(description = "岗位名称，模糊匹配", example = "技术总监")；本地补充注释 9 行。
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
