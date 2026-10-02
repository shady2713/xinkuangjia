package com.basicframework.module.infra.service.logger;

import com.basicframework.framework.common.biz.infra.logger.dto.ApiErrorLogCreateReqDTO;

/**
 * API 错误日志 Service 接口（仅保留写入和清理方法）
 *
 * @author 李杰
 */
public interface ApiErrorLogService {

    /**
     * 创建 API 错误日志
     *
     * @param createReqDTO API 错误日志创建请求
     */
    void createApiErrorLog(ApiErrorLogCreateReqDTO createReqDTO);

    /**
     * 清理 exceedDay 天前的错误日志
     *
     * @param exceedDay 保留天数，早于该天数的数据会被清理
     * @param deleteLimit 单批删除数量
     * @return 实际清理条数
     */
    Integer cleanErrorLog(Integer exceedDay, Integer deleteLimit);

}
