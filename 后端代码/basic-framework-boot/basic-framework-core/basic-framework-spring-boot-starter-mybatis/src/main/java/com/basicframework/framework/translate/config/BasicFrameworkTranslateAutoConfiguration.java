package com.basicframework.framework.translate.config;

import com.basicframework.framework.translate.core.TranslateUtils;
import com.fhs.trans.service.impl.TransService;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.Bean;

/**
 * Easy-Trans 数据翻译自动配置类。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-framework/yudao-spring-boot-starter-mybatis/src/main/java/cn/iocoder/yudao/framework/translate/
 * 上游文件续：config/YudaoTranslateAutoConfiguration.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：命名空间、模块名与类名前缀适配；本地改写/新增代码 1 行，上游代码 2 行被移除或改写；import 调整（新增 1 行、移除 2 行）；补充注释 11 行；按 D12 §62/§64 受控撤回无依据署名并改写为来源说明
 * 来源验收：尚未验收
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
