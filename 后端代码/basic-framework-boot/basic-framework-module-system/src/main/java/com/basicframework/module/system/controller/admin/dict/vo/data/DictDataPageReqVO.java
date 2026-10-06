package com.basicframework.module.system.controller.admin.dict.vo.data;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.pojo.PageParam;
import com.basicframework.framework.common.validation.InEnum;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;

import jakarta.validation.constraints.Size;

/**
 * DictDataPageReqVO 请求对象，承载接口输入参数。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/dict/vo/data/DictDataPageReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 2 行，上游代码 2 行在本地被移除或改写，例如 @Schema(description = "字典标签", example = "启用")；@Schema(description = "字典类型，模糊匹配", example = "sys_common_see")；本地补充注释 9 行。
 */
@Schema(description = "管理后台 - 字典类型分页列表 Request VO")
@Data
@EqualsAndHashCode(callSuper = true)
public class DictDataPageReqVO extends PageParam {

    /**
     * 字典标签。
     */
    @Schema(description = "字典标签", example = "启用")
    @Size(max = 100, message = "字典标签长度不能超过100个字符")
    private String label;

    /**
     * 字典类型，模糊匹配。
     */
    @Schema(description = "字典类型，模糊匹配", example = "sys_common_see")
    @Size(max = 100, message = "字典类型类型长度不能超过100个字符")
    private String dictType;

    /**
     * 展示状态，参见 CommonStatusEnum 枚举类。
     */
    @Schema(description = "展示状态，参见 CommonStatusEnum 枚举类", example = "1")
    @InEnum(value = CommonStatusEnum.class, message = "修改状态必须是 {value}")
    private Integer status;

}
