package com.basicframework.framework.common.biz.infra.logger;

import com.basicframework.framework.common.biz.infra.logger.dto.ApiErrorLogCreateReqDTO;

import jakarta.validation.Valid;
import org.springframework.scheduling.annotation.Async;

/**
 * API 错误日志的 API 接口
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
public interface ApiErrorLogCommonApi {

    /**
     * 创建 API 错误日志
     *
     * @param createDTO 创建信息
     */
    void createApiErrorLog(@Valid ApiErrorLogCreateReqDTO createDTO);

    /**
     * 【异步】创建 API 异常日志
     *
     * @param createDTO 异常日志 DTO
     */
    @Async
    default void createApiErrorLogAsync(ApiErrorLogCreateReqDTO createDTO) {
        createApiErrorLog(createDTO);
    }

}
