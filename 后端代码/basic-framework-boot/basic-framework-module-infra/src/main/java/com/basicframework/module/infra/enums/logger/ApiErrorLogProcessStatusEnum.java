package com.basicframework.module.infra.enums.logger;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * API 异常数据的处理状态
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@AllArgsConstructor
@Getter
public enum ApiErrorLogProcessStatusEnum {

    /** 未处理，状态值 0；异常日志写入后的初始状态，等待人工分派。 */
    INIT(0, "未处理"),
    /** 已处理，状态值 1；异常已定位并完成修复。 */
    DONE(1, "已处理"),
    /** 已忽略，状态值 2；确认无需修复，处理时不再计入待办。 */
    IGNORE(2, "已忽略");

    /**
     * 状态
     */
    private final Integer status;
    /**
     * 资源类型名
     */
    private final String name;

}
