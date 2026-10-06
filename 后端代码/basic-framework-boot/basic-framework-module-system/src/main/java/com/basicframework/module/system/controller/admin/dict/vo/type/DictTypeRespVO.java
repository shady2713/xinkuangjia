package com.basicframework.module.system.controller.admin.dict.vo.type;

import com.basicframework.framework.excel.core.annotations.DictFormat;
import com.basicframework.framework.excel.core.convert.DictConvert;
import com.basicframework.module.system.enums.DictTypeConstants;
import cn.idev.excel.annotation.ExcelIgnoreUnannotated;
import cn.idev.excel.annotation.ExcelProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * DictTypeRespVO 响应对象，承载接口输出数据。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/dict/vo/type/DictTypeRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 1 行，上游代码 1 行在本地被移除或改写，例如 @ExcelProperty("字典编号")；本地补充注释 18 行。
 */
@Schema(description = "管理后台 - 字典类型信息 Response VO")
@Data
@ExcelIgnoreUnannotated
public class DictTypeRespVO {

    /**
     * 字典类型编号。
     */
    @Schema(description = "字典类型编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @ExcelProperty("字典编号")
    private Long id;

    /**
     * 字典名称。
     */
    @Schema(description = "字典名称", requiredMode = Schema.RequiredMode.REQUIRED, example = "性别")
    @ExcelProperty("字典名称")
    private String name;

    /**
     * 字典类型。
     */
    @Schema(description = "字典类型", requiredMode = Schema.RequiredMode.REQUIRED, example = "sys_common_sex")
    @ExcelProperty("字典类型")
    private String type;

    /**
     * 状态，参见 CommonStatusEnum 枚举类。
     */
    @Schema(description = "状态，参见 CommonStatusEnum 枚举类", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @ExcelProperty(value = "状态", converter = DictConvert.class)
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
    @Schema(description = "创建时间", requiredMode = Schema.RequiredMode.REQUIRED, example = "时间戳格式")
    private LocalDateTime createTime;

}
