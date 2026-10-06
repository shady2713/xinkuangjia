package com.basicframework.module.infra.enums.job;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 任务日志的状态枚举
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@Getter
@AllArgsConstructor
public enum JobLogStatusEnum {

    /** 运行中，状态值 0；任务开始执行时先落库，结束时再改写。 */
    RUNNING(0),
    /** 成功，状态值 1；结果数据来自 {@code JobHandler#execute(String)} 的返回值。 */
    SUCCESS(1),
    /** 失败，状态值 2；异常信息记录在同一条日志中，供后台排查。 */
    FAILURE(2);

    /**
     * 状态
     */
    private final Integer status;

}
