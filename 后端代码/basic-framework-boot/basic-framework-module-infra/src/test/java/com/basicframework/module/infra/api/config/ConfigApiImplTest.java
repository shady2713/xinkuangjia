package com.basicframework.module.infra.api.config;

import com.basicframework.module.infra.dal.dataobject.config.ConfigDO;
import com.basicframework.module.infra.service.config.ConfigService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证参数配置跨模块 API 的读取与转发契约。
 *
 * <p>框架公共层按参数键读取配置（如上传限额、开关项），因此这里锁定三点：参数键必须原样传给
 * 参数服务（键被改写会读到另一条配置）、配置存在时必须返回其值、配置不存在时必须返回 null
 * 让调用方使用默认值而不是抛错。</p>
 *
 * @author shady2713
 */
class ConfigApiImplTest {

    /** 被测 API 实现。 */
    private ConfigApiImpl configApi;
    /** 下游参数服务替身，用于观察真实转发参数。 */
    private ConfigService configService;

    /** 为每个用例创建独立 API 与下游替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        configApi = new ConfigApiImpl();
        configService = mock(ConfigService.class);
        ReflectionTestUtils.setField(configApi, "configService", configService);
    }

    /** 配置存在时必须返回参数服务给出的取值，且参数键原样转发。 */
    @Test
    void returnsValueOfExistingConfig() {
        when(configService.getConfigByKey("upload.max-bytes")).thenReturn(config("upload.max-bytes", "10485760"));

        assertThat(configApi.getConfigValueByKey("upload.max-bytes")).isEqualTo("10485760");
        verify(configService).getConfigByKey("upload.max-bytes");
        verifyNoMoreInteractions(configService);
    }

    /** 配置不存在时必须返回 null，交由调用方决定默认值，不得抛出空指针。 */
    @Test
    void returnsNullForMissingConfig() {
        when(configService.getConfigByKey("absent.key")).thenReturn(null);

        assertThat(configApi.getConfigValueByKey("absent.key")).isNull();
    }

    /** 参数服务失败必须原样传播，不能被包装成“配置不存在”。 */
    @Test
    void serviceFailurePropagatesUnchanged() {
        IllegalStateException failure = new IllegalStateException("synthetic-config-failure");
        when(configService.getConfigByKey("broken.key")).thenThrow(failure);

        assertThatThrownBy(() -> configApi.getConfigValueByKey("broken.key")).isSameAs(failure);
    }

    /**
     * 构造带键值的参数配置。
     *
     * @param key 参数键
     * @param value 参数值
     * @return 参数配置
     */
    private ConfigDO config(String key, String value) {
        ConfigDO config = new ConfigDO();
        config.setConfigKey(key);
        config.setValue(value);
        return config;
    }

}
