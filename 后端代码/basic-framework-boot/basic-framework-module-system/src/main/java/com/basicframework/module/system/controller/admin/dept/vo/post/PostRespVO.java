package com.basicframework.module.system.controller.admin.dept.vo.post;

import com.basicframework.framework.excel.core.annotations.DictFormat;
import com.basicframework.framework.excel.core.convert.DictConvert;
import com.basicframework.module.system.enums.DictTypeConstants;
import cn.idev.excel.annotation.ExcelIgnoreUnannotated;
import cn.idev.excel.annotation.ExcelProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * PostRespVO 响应对象，承载接口输出数据。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/dept/vo/post/PostRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 4 行，移除或改写上游 4 行；补充注释 26 行。
 * 来源验收：尚未验收
 */
@Schema(description = "管理后台 - 岗位信息 Response VO")
@Data
@ExcelIgnoreUnannotated
public class PostRespVO {

    /**
     * 岗位序号。
     */
    @Schema(description = "岗位序号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @ExcelProperty("岗位编号")
    private Long id;

    /**
     * 岗位名称。
     */
    @Schema(description = "岗位名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "小土豆")
    @ExcelProperty("岗位名称")
    private String name;

    /**
     * 岗位编码。
     */
    @Schema(description = "岗位编码", requiredMode = Schema.RequiredMode.REQUIRED, example = "POST_ADMIN")
    @ExcelProperty("岗位编码")
    private String code;

    /**
     * 显示顺序。
     */
    @Schema(description = "显示顺序", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @ExcelProperty("显示顺序")
    private Integer sort;

    /**
     * 状态，参见 CommonStatusEnum 枚举类。
     */
    @Schema(description = "状态，参见 CommonStatusEnum 枚举类", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @ExcelProperty(value = "岗位状态", converter = DictConvert.class)
    @DictFormat(DictTypeConstants.COMMON_STATUS)
    private Integer status;

    /**
     * 备注。
     */
    @Schema(description = "备注", example = "快乐的备注")
    private String remark;

    /**
     * 创建时间。
     */
    @Schema(description = "创建时间", requiredMode = Schema.RequiredMode.REQUIRED)
    private LocalDateTime createTime;

}
