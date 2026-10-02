package com.basicframework.framework.operatelog.config;

import com.basicframework.framework.operatelog.core.service.LogRecordServiceImpl;
import com.mzt.logapi.service.ILogRecordService;
import com.mzt.logapi.starter.annotation.EnableLogRecord;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/**
 * 操作日志配置类
 * <p>统一暴露第三方日志组件所需的日志服务 Bean。</p>
 *
 * @author 李杰
 *
 */
@EnableLogRecord(tenant = "") // 第三方库必填参数，框架未使用多租户
@AutoConfiguration
@Slf4j
public class BasicFrameworkOperateLogConfiguration {

    /**
     * 业务侧统一的日志记录服务实现
     *
     * @return ILogRecordService 实现
     */
    @Bean
    @Primary
    public ILogRecordService iLogRecordServiceImpl() {
        return new LogRecordServiceImpl();
    }

}
