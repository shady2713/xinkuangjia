package com.basicframework.module.system.controller.admin.dict.vo.data;

import com.basicframework.framework.excel.core.annotations.DictFormat;
import com.basicframework.framework.excel.core.convert.DictConvert;
import com.basicframework.module.system.enums.DictTypeConstants;
import cn.idev.excel.annotation.ExcelIgnoreUnannotated;
import cn.idev.excel.annotation.ExcelProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * DictDataRespVO 响应对象，承载接口输出数据。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/dict/vo/data/DictDataRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 3 行，移除或改写上游 3 行；补充注释 35 行。
 * 来源验收：尚未验收
 */
@Schema(description = "管理后台 - 字典数据信息 Response VO")
@Data
@ExcelIgnoreUnannotated
public class DictDataRespVO {

    /**
     * 字典数据编号。
     */
    @Schema(description = "字典数据编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @ExcelProperty("字典编码")
    private Long id;

    /**
     * 显示顺序。
     */
    @Schema(description = "显示顺序", requiredMode = Schema.RequiredMode.REQUIRED, example = "1024")
    @ExcelProperty("字典排序")
    private Integer sort;

    /**
     * 字典标签。
     */
    @Schema(description = "字典标签", requiredMode = Schema.RequiredMode.REQUIRED, example = "启用")
    @ExcelProperty("字典标签")
    private String label;

    /**
     * 字典值。
     */
    @Schema(description = "字典值", requiredMode = Schema.RequiredMode.REQUIRED)
    @ExcelProperty("字典键值")
    private String value;

    /**
     * 字典类型。
     */
    @Schema(description = "字典类型", requiredMode = Schema.RequiredMode.REQUIRED, example = "sys_common_see")
    @ExcelProperty("字典类型")
    private String dictType;

    /**
     * 状态,见 CommonStatusEnum 枚举。
     */
    @Schema(description = "状态,见 CommonStatusEnum 枚举", requiredMode = Schema.RequiredMode.REQUIRED, example = "1")
    @ExcelProperty(value = "状态", converter = DictConvert.class)
    @DictFormat(DictTypeConstants.COMMON_STATUS)
    private Integer status;

    /**
     * 颜色类型,default、primary、success、info、warning、danger。
     */
    @Schema(description = "颜色类型,default、primary、success、info、warning、danger", example = "default")
    private String colorType;

    /**
     * css 样式。
     */
    @Schema(description = "css 样式", example = "btn-visible")
    private String cssClass;

    /**
     * 备注。
     */
    @Schema(description = "备注", example = "我是一个角色")
    private String remark;

    /**
     * 创建时间。
     */
    @Schema(description = "创建时间", requiredMode = Schema.RequiredMode.REQUIRED, example = "时间戳格式")
    private LocalDateTime createTime;

}
