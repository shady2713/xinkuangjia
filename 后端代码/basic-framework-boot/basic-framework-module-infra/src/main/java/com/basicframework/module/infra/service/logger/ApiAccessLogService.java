package com.basicframework.module.infra.service.logger;

import com.basicframework.framework.common.biz.infra.logger.dto.ApiAccessLogCreateReqDTO;

/**
 * API 访问日志 Service 接口（仅保留写入和清理方法）
 *
 * @author 李杰
 */
public interface ApiAccessLogService {

    /**
     * 创建 API 访问日志
     *
     * @param createReqDTO API 访问日志创建请求
     */
    void createApiAccessLog(ApiAccessLogCreateReqDTO createReqDTO);

    /**
     * 清理 exceedDay 天前的访问日志
     *
     * @param exceedDay 保留天数，早于该天数的数据会被清理
     * @param deleteLimit 单批删除数量
     * @return 实际清理条数
     */
    Integer cleanAccessLog(Integer exceedDay, Integer deleteLimit);

}
