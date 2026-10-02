package com.basicframework.framework.quartz.core.handler;

/**
 * 任务处理器。
 *
 * <p>业务模块通过实现该接口定义具体任务逻辑，Bean 名称会作为 Quartz 任务的处理器标识。</p>
 *
 * @author 李杰
 */
public interface JobHandler {

    /**
     * 执行任务。
     *
     * @param param 任务参数
     * @return 执行结果，成功时会写入任务日志
     * @throws Exception 任务执行失败时抛出，用于触发日志记录和重试逻辑
     */
    String execute(String param) throws Exception;

}
