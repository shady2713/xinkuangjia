package com.basicframework.module.infra.api.config;

import com.basicframework.framework.common.api.config.ConfigApi;
import com.basicframework.module.infra.dal.dataobject.config.ConfigDO;
import com.basicframework.module.infra.service.config.ConfigService;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;
import org.springframework.validation.annotation.Validated;

/**
 * 参数配置 API 实现类
 *
 * 面向框架公共层提供按参数键读取配置值的能力。
 *
 * @author 李杰
 */
@Service
@Validated
public class ConfigApiImpl implements ConfigApi {

    @Resource
    private ConfigService configService;

    /**
     * 根据参数键获取参数值。
     *
     * @param key 参数键
     * @return 参数值；配置不存在时返回 null
     */
    @Override
    public String getConfigValueByKey(String key) {
        ConfigDO config = configService.getConfigByKey(key);
        return config != null ? config.getValue() : null;
    }

}
