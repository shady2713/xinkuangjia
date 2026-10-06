package com.basicframework.module.system.controller.admin.dict.vo.type;

import com.basicframework.framework.common.pojo.PageParam;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;
import org.springframework.format.annotation.DateTimeFormat;

import jakarta.validation.constraints.Size;
import java.time.LocalDateTime;

import static cn.hutool.core.date.DatePattern.NORM_DATETIME_PATTERN;

/**
 * DictTypePageReqVO 请求对象，承载接口输入参数。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/dict/vo/type/DictTypePageReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 3 行，上游代码 3 行在本地被移除或改写，例如 @Schema(description = "字典类型名称，模糊匹配", example = "common_status")；@Schema(description = "字典类型，模糊匹配", example = "sys_common_see")；本地补充注释 12 行。
 */
@Schema(description = "管理后台 - 字典类型分页列表 Request VO")
@Data
@EqualsAndHashCode(callSuper = true)
public class DictTypePageReqVO extends PageParam {

    /**
     * 字典类型名称，模糊匹配。
     */
    @Schema(description = "字典类型名称，模糊匹配", example = "common_status")
    private String name;

    /**
     * 字典类型，模糊匹配。
     */
    @Schema(description = "字典类型，模糊匹配", example = "sys_common_see")
    @Size(max = 100, message = "字典类型类型长度不能超过100个字符")
    private String type;

    /**
     * 展示状态，参见 CommonStatusEnum 枚举类。
     */
    @Schema(description = "展示状态，参见 CommonStatusEnum 枚举类", example = "1")
    private Integer status;

    /**
     * 创建时间。
     */
    @DateTimeFormat(pattern = NORM_DATETIME_PATTERN)
    @Schema(description = "创建时间")
    private LocalDateTime[] createTime;

}
