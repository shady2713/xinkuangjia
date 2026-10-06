package com.basicframework.framework.quartz.core.enums;

/**
 * Quartz JobDataMap 的 key 枚举。
 *
 * @author 李杰
 * 署名验收：尚未验收
 */
public enum JobDataKeyEnum {

    /**
     * 任务编号。
     */
    JOB_ID,

    /**
     * 任务处理器 Bean 名称。
     */
    JOB_HANDLER_NAME,

    /**
     * 任务处理器参数。
     */
    JOB_HANDLER_PARAM,

    /**
     * 最大重试次数。
     */
    JOB_RETRY_COUNT,

    /**
     * 每次重试间隔，单位：毫秒。
     */
    JOB_RETRY_INTERVAL,

}
