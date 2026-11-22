package com.basicframework.module.system.api.logger;

import com.basicframework.framework.common.biz.system.logger.OperateLogCommonApi;
import com.basicframework.framework.common.biz.system.logger.dto.OperateLogCreateReqDTO;
import com.basicframework.module.system.service.logger.OperateLogService;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;
import org.springframework.validation.annotation.Validated;

/**
 * 操作审计日志核心 SPI 实现，供 core 层 {@code @OperateLog} 切面回调落库。
 *
 * @author 李杰
 */
@Service
@Validated
public class OperateLogApiImpl implements OperateLogCommonApi {

    @Resource
    private OperateLogService operateLogService;

    /**
     * 记录操作审计日志。
     *
     * @param createReqDTO 操作日志创建参数
     */
    @Override
    public void createOperateLog(OperateLogCreateReqDTO createReqDTO) {
        operateLogService.createOperateLog(createReqDTO);
    }

}
