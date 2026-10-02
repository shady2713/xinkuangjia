package com.basicframework.module.infra.controller.admin.config.vo;

import com.basicframework.framework.excel.core.annotations.DictFormat;
import com.basicframework.framework.excel.core.convert.DictConvert;
import com.basicframework.module.infra.enums.DictTypeConstants;
import cn.idev.excel.annotation.ExcelIgnoreUnannotated;
import cn.idev.excel.annotation.ExcelProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 管理后台参数配置响应。
 *
 * 同时用于参数配置 Excel 导出。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - 参数配置信息 Response VO")
@Data
@ExcelIgnoreUnannotated
public class ConfigRespVO {

    /**
     * 参数配置序号。
     */
    @Schema(description = "参数配置序号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @ExcelProperty("参数配置序号")
    private Long id;

    /**
     * 参数分类。
     */
    @Schema(description = "参数分类", requiredMode = Schema.RequiredMode.REQUIRED, example = "biz")
    @ExcelProperty("参数分类")
    private String category;

    /**
     * 参数名称。
     */
    @Schema(description = "参数名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "数据库名")
    @ExcelProperty("参数名称")
    private String name;

    /**
     * 参数键名。
     */
    @Schema(description = "参数键名", requiredMode = Schema.RequiredMode.REQUIRED, example = "")
    @ExcelProperty("参数键名")
    private String key;

    /**
     * 参数键值。
     */
    @Schema(description = "参数键值", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @ExcelProperty("参数键值")
    private String value;

    /**
     * 参数类型，参见 ConfigTypeEnum 枚举。
     */
    @Schema(description = "参数类型，参见 ConfigTypeEnum 枚举", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @ExcelProperty(value = "参数类型", converter = DictConvert.class)
    @DictFormat(DictTypeConstants.CONFIG_TYPE)
    private Integer type;

    /**
     * 是否可见。
     */
    @Schema(description = "是否可见", requiredMode = Schema.RequiredMode.REQUIRED, example = "true")
    @ExcelProperty(value = "是否可见", converter = DictConvert.class)
    @DictFormat(DictTypeConstants.BOOLEAN_STRING)
    private Boolean visible;

    /**
     * 备注。
     */
    @Schema(description = "备注", example = "")
    @ExcelProperty("备注")
    private String remark;

    /**
     * 创建时间。
     */
    @Schema(description = "创建时间", requiredMode = Schema.RequiredMode.REQUIRED, example = "时间戳格式")
    @ExcelProperty("创建时间")
    private LocalDateTime createTime;

}
