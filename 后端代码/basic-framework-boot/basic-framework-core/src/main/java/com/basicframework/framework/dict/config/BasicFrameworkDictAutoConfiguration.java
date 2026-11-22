package com.basicframework.framework.dict.config;

import com.basicframework.framework.common.biz.system.dict.DictDataCommonApi;
import com.basicframework.framework.dict.core.DictFrameworkUtils;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.Bean;

/**
 * 字典组件自动配置，初始化 Excel 字典转换和字典校验依赖的工具类。
 *
 * @author 李杰
 */
@AutoConfiguration
public class BasicFrameworkDictAutoConfiguration {

    /**
     * 初始化字典工具类使用的字典数据接口。
     *
     * @param dictDataApi 字典数据接口
     * @return 字典工具类实例，用于完成 Spring Bean 注册
     */
    @Bean
    @SuppressWarnings("InstantiationOfUtilityClass")
    public DictFrameworkUtils dictUtils(DictDataCommonApi dictDataApi) {
        DictFrameworkUtils.init(dictDataApi);
        return new DictFrameworkUtils();
    }

}
