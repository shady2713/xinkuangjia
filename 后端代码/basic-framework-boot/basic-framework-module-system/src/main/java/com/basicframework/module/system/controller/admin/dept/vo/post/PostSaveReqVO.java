package com.basicframework.module.system.controller.admin.dept.vo.post;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.validation.InEnum;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 管理后台岗位创建或修改请求。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/dept/vo/post/PostSaveReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 2 行，移除或改写上游 1 行；import 新增 3 行、移除 3 行；补充注释 23 行。
 */
@Schema(description = "管理后台 - 岗位创建/修改 Request VO")
@Data
public class PostSaveReqVO {

    /**
     * 岗位编号。
     */
    @Schema(description = "岗位编号", example = "1024")
    private Long id;

    /**
     * 岗位名称。
     */
    @Schema(description = "岗位名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "小土豆")
    @NotBlank(message = "岗位名称不能为空")
    @Size(max = 50, message = "岗位名称长度不能超过 50 个字符")
    private String name;

    /**
     * 岗位编码。
     */
    @Schema(description = "岗位编码", requiredMode = Schema.RequiredMode.REQUIRED, example = "POST_ADMIN")
    @NotBlank(message = "岗位编码不能为空")
    @Size(max = 64, message = "岗位编码长度不能超过64个字符")
    private String code;

    /**
     * 显示顺序。
     */
    @Schema(description = "显示顺序", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @NotNull(message = "显示顺序不能为空")
    private Integer sort;

    /**
     * 状态。
     */
    @Schema(description = "状态", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @InEnum(CommonStatusEnum.class)
    private Integer status;

    /**
     * 备注。
     */
    @Schema(description = "备注", example = "快乐的备注")
    @Size(max = 500, message = "备注长度不能超过 500 个字符")
    private String remark;

}
