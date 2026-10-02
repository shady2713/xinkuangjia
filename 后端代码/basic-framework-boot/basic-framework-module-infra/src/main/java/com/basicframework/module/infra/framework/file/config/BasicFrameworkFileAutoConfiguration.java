package com.basicframework.module.infra.framework.file.config;

import com.basicframework.module.infra.framework.file.core.client.FileClientFactory;
import com.basicframework.module.infra.framework.file.core.client.FileClientFactoryImpl;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Infra 文件客户端自动配置。
 *
 * @author 李杰
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(MinioFileProperties.class)
public class BasicFrameworkFileAutoConfiguration {

    /**
     * 创建进程内统一的文件客户端工厂。
     *
     * @return 文件客户端工厂
     */
    @Bean
    public FileClientFactory fileClientFactory() {
        return new FileClientFactoryImpl();
    }

}
