package com.basicframework.framework.dict.config;

import com.basicframework.framework.common.biz.system.dict.DictDataCommonApi;
import com.basicframework.framework.common.biz.system.dict.dto.DictDataRespDTO;
import com.basicframework.framework.dict.core.DictFrameworkUtils;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证字典自动配置把容器内的字典数据接口真正接入 {@link DictFrameworkUtils}。
 *
 * <p>该自动配置只注册一个工具类 Bean，但副作用是初始化静态的字典数据接口与缓存。
 * 只断言 Bean 存在无法排除“注册了工具类却没完成初始化”：那样字典标签解析会因接口为 null
 * 而失败，或沿用上一次初始化的接口读到错误字典。因此这里在真实最小上下文中注入字典接口替身，
 * 再按工具类的真实入口解析标签，确认数据确实来自本次注入的接口。</p>
 *
 * @author shady2713
 */
class BasicFrameworkDictAutoConfigurationTest {

    /** 每例清理字典缓存，避免缓存命中掩盖初始化是否真正发生。 */
    @BeforeEach
    @AfterEach
    void clearDictCache() {
        DictFrameworkUtils.clearCache();
    }

    /** 应用自动配置后必须注册字典工具类 Bean。 */
    @Test
    void registersDictFrameworkUtilsBean() {
        contextRunner().run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).hasSingleBean(DictFrameworkUtils.class);
        });
    }

    /**
     * 初始化后的工具类必须通过注入的字典接口解析标签与反查字典值。
     *
     * <p>标签解析是导出与展示的真实入口；接口未接入时这里会抛错或返回 null，
     * 因此同时断言正向解析与反向解析，避免只覆盖其中一条路径。</p>
     */
    @Test
    void injectedDictApiIsUsedForBothDirections() {
        contextRunner().run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(DictFrameworkUtils.parseDictDataLabel("sys_sex", 1)).isEqualTo("男");
            assertThat(DictFrameworkUtils.parseDictDataLabel("sys_sex", "2")).isEqualTo("女");
            assertThat(DictFrameworkUtils.parseDictDataValue("sys_sex", "女")).isEqualTo("2");
            assertThat(DictFrameworkUtils.getDictDataLabelList("sys_sex")).containsExactly("男", "女");
            assertThat(DictFrameworkUtils.parseDictDataLabel("sys_sex", 99))
                    .as("未登记的字典值必须返回 null，而不是回退成原值").isNull();
        });
    }

    /**
     * 构造只装配字典自动配置的最小上下文，并注入字典接口替身。
     *
     * @return 最小上下文运行器
     */
    private ApplicationContextRunner contextRunner() {
        return new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(BasicFrameworkDictAutoConfiguration.class))
                .withBean(DictDataCommonApi.class, () -> dictType -> "sys_sex".equals(dictType)
                        ? List.of(dictData("男", "1"), dictData("女", "2"))
                        : List.of());
    }

    /**
     * 构造字典数据，仅填充解析所需的标签与字典值。
     *
     * @param label 字典标签
     * @param value 字典值
     * @return 字典数据
     */
    private DictDataRespDTO dictData(String label, String value) {
        DictDataRespDTO dictData = new DictDataRespDTO();
        dictData.setLabel(label);
        dictData.setValue(value);
        return dictData;
    }

}
