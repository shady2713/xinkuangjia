package com.basicframework.module.infra.api.logger;

import com.basicframework.framework.common.biz.infra.logger.ApiAccessLogCommonApi;
import com.basicframework.framework.common.biz.infra.logger.dto.ApiAccessLogCreateReqDTO;
import com.basicframework.module.infra.service.logger.ApiAccessLogService;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;
import org.springframework.validation.annotation.Validated;

/**
 * API 访问日志的 API 实现类
 *
 * 接收框架公共层传入的访问日志并落库。
 *
 * @author 李杰
 */
@Service
@Validated
public class ApiAccessLogApiImpl implements ApiAccessLogCommonApi {

    @Resource
    private ApiAccessLogService apiAccessLogService;

    /**
     * 创建 API 访问日志。
     *
     * @param createDTO API 访问日志创建请求
     */
    @Override
    public void createApiAccessLog(ApiAccessLogCreateReqDTO createDTO) {
        apiAccessLogService.createApiAccessLog(createDTO);
    }

}
