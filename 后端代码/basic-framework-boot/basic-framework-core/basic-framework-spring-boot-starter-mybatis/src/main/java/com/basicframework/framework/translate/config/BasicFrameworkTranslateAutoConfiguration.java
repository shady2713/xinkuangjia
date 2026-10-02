package com.basicframework.framework.translate.config;

import com.basicframework.framework.translate.core.TranslateUtils;
import com.fhs.trans.service.impl.TransService;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.Bean;

/**
 * Easy-Trans 数据翻译自动配置类。
 *
 * @author 李杰
 */
@AutoConfiguration
public class BasicFrameworkTranslateAutoConfiguration {

    /**
     * 初始化静态翻译工具。
     *
     * @param transService Easy-Trans 翻译服务
     * @return 翻译工具占位 Bean
     */
    @Bean
    @SuppressWarnings({"InstantiationOfUtilityClass", "SpringJavaInjectionPointsAutowiringInspection"})
    public TranslateUtils translateUtils(TransService transService) {
        TranslateUtils.init(transService);
        return new TranslateUtils();
    }

}
