package com.basicframework.module.infra.api.logger;

import com.basicframework.framework.common.biz.infra.logger.ApiErrorLogCommonApi;
import com.basicframework.framework.common.biz.infra.logger.dto.ApiErrorLogCreateReqDTO;
import com.basicframework.module.infra.service.logger.ApiErrorLogService;
import org.springframework.stereotype.Service;
import org.springframework.validation.annotation.Validated;

import jakarta.annotation.Resource;

/**
 * API 错误日志的 API 实现类
 *
 * 接收框架公共层传入的异常日志并落库。
 *
 * @author 李杰
 */
@Service
@Validated
public class ApiErrorLogApiImpl implements ApiErrorLogCommonApi {

    @Resource
    private ApiErrorLogService apiErrorLogService;

    /**
     * 创建 API 错误日志。
     *
     * @param createDTO API 错误日志创建请求
     */
    @Override
    public void createApiErrorLog(ApiErrorLogCreateReqDTO createDTO) {
        apiErrorLogService.createApiErrorLog(createDTO);
    }

}
