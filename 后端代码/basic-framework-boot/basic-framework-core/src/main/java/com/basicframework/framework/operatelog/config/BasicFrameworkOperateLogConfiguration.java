package com.basicframework.framework.operatelog.config;

import com.basicframework.framework.common.biz.system.logger.OperateLogCommonApi;
import com.basicframework.framework.operatelog.core.aop.OperateLogAspect;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.Bean;

/**
 * 原生 Spring AOP 操作审计日志自动配置类。
 *
 * @author shady
 */
@AutoConfiguration
public class BasicFrameworkOperateLogConfiguration {

    /**
     * 注册操作审计日志 AOP 切面。
     *
     * @param operateLogApiProvider 操作日志写入接口提供器
     * @return 操作日志切面 Bean
     */
    @Bean
    public OperateLogAspect operateLogAspect(ObjectProvider<OperateLogCommonApi> operateLogApiProvider) {
        return new OperateLogAspect(operateLogApiProvider);
    }

}
