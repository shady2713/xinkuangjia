package com.basicframework.framework.dict.core;

import com.basicframework.framework.common.biz.system.dict.DictDataCommonApi;
import com.basicframework.framework.common.biz.system.dict.dto.DictDataRespDTO;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 校验字典工具类在“空值短路、双向解析、加载失败传播”三类真实场景下的行为。
 *
 * <p>字典值的批量入口供 Excel 导出与下拉选项使用，必须与单个解析读取同一份缓存数据，
 * 否则同一字典类型会出现展示与导出不一致。空字典值必须直接返回 null 且不访问字典接口，
 * 避免为无意义的查询打穿下游。</p>
 *
 * <p>字典接口或缓存加载失败时，工具类刻意把失败原样抛出（{@code @SneakyThrows} 只负责
 * 绕过受检异常声明，不做包装与兜底），调用方据此感知异常并重试或降级；如果失败被吞掉并
 * 返回 null，页面上会静默显示空白标签并写入错误的导出文件。失败也不得写入缓存，接口恢复
 * 后同一字典类型必须能立即取到正确数据。</p>
 *
 * @author shady2713
 */
class DictFrameworkUtilsTest {

    /** 记录字典接口被调用的字典类型，用于验证空值短路与失败不缓存。 */
    private final AtomicInteger loadCount = new AtomicInteger();

    /** 可切换行为的字典接口替身；{@code failing} 为真时模拟下游不可用。 */
    private volatile boolean failing;

    /** 当前受测的字典接口替身。 */
    private DictDataCommonApi dictDataApi;

    /** 注入字典接口替身并清空缓存，避免上一例的缓存掩盖本例如实加载行为。 */
    @BeforeEach
    void setUp() {
        failing = false;
        loadCount.set(0);
        dictDataApi = dictType -> {
            loadCount.incrementAndGet();
            if (failing) {
                throw new IllegalStateException("字典接口不可用");
            }
            return "sys_sex".equals(dictType) || "boom".equals(dictType)
                    ? List.of(dictData("男", "1"), dictData("女", "2"))
                    : List.of();
        };
        DictFrameworkUtils.init(dictDataApi);
        DictFrameworkUtils.clearCache();
    }

    /** 清理字典缓存，避免静态缓存把接口替身或失败状态带出本用例。 */
    @AfterEach
    void tearDown() {
        DictFrameworkUtils.clearCache();
    }

    /** 批量字典值入口必须返回该字典类型的全部字典值，且与标签入口共用同一份数据。 */
    @Test
    void getDictDataValueListReturnsAllValuesOfType() {
        assertThat(DictFrameworkUtils.getDictDataValueList("sys_sex")).containsExactly("1", "2");
        assertThat(DictFrameworkUtils.getDictDataLabelList("sys_sex")).as("同一字典类型的标签入口读到同一份数据")
                .containsExactly("男", "女");
        assertThat(DictFrameworkUtils.getDictDataValueList("unused_type"))
                .as("未登记的字典类型返回空列表而不是 null").isEmpty();
    }

    /** 空字典值必须直接返回 null，且不得访问字典接口。 */
    @Test
    void nullIntegerValueShortCircuitsWithoutLoading() {
        Integer absentValue = null;

        assertThat(DictFrameworkUtils.parseDictDataLabel("never_loaded", absentValue)).isNull();
        assertThat(loadCount).as("空值不得触发字典接口调用").hasValue(0);
    }

    /** 字典接口失败必须原样抛出，不能被吞掉后返回 null。 */
    @Test
    void loadFailurePropagatesInsteadOfReturningNull() {
        failing = true;

        assertThatThrownBy(() -> DictFrameworkUtils.parseDictDataLabel("boom", 1))
                .as("按整型值解析失败必须抛出").isInstanceOf(RuntimeException.class)
                .hasRootCauseInstanceOf(IllegalStateException.class)
                .hasMessageContaining("字典接口不可用");
        assertThatThrownBy(() -> DictFrameworkUtils.parseDictDataLabel("boom", "1"))
                .as("按字符串值解析失败必须抛出").isInstanceOf(RuntimeException.class)
                .hasRootCauseInstanceOf(IllegalStateException.class)
                .hasMessageContaining("字典接口不可用");
        assertThatThrownBy(() -> DictFrameworkUtils.getDictDataLabelList("boom"))
                .as("标签列表加载失败必须抛出").isInstanceOf(RuntimeException.class)
                .hasRootCauseInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> DictFrameworkUtils.parseDictDataValue("boom", "男"))
                .as("按标签反查失败必须抛出").isInstanceOf(RuntimeException.class)
                .hasRootCauseInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> DictFrameworkUtils.getDictDataValueList("boom"))
                .as("字典值列表加载失败必须抛出").isInstanceOf(RuntimeException.class)
                .hasRootCauseInstanceOf(IllegalStateException.class);
    }

    /** 加载失败不得写入缓存：接口恢复后同一字典类型必须立即返回正确数据。 */
    @Test
    void failureIsNotCached() {
        failing = true;
        assertThatThrownBy(() -> DictFrameworkUtils.getDictDataValueList("boom"))
                .isInstanceOf(RuntimeException.class);

        failing = false;
        assertThat(DictFrameworkUtils.getDictDataValueList("boom"))
                .as("失败恢复后无需等待过期即可取到正确数据").containsExactly("1", "2");
        assertThat(DictFrameworkUtils.parseDictDataLabel("boom", 2)).isEqualTo("女");
    }

    /** 同一字典类型的重复解析必须命中缓存，避免每次展示都查询字典接口。 */
    @Test
    void repeatedLookupsUseCachedData() {
        assertThat(DictFrameworkUtils.parseDictDataLabel("sys_sex", 1)).isEqualTo("男");
        int loadsAfterFirstLookup = loadCount.get();

        DictFrameworkUtils.parseDictDataLabel("sys_sex", 2);
        DictFrameworkUtils.getDictDataLabelList("sys_sex");

        assertThat(loadCount).as("同一字典类型只加载一次").hasValue(loadsAfterFirstLookup);
    }

    /**
     * 实例化工具类不得影响静态绑定与已加载缓存。
     *
     * <p>字典自动配置以实例形式注册该工具类 Bean（{@code return new DictFrameworkUtils()}），
     * 因此实例化是框架自身的真实用法；断言实例化前后静态入口读到同一份缓存，避免未来把
     * 可变状态放进实例，导致按实例注入的组件与静态入口读到不同字典。</p>
     */
    @Test
    void instantiationKeepsStaticBindingAndCache() {
        assertThat(DictFrameworkUtils.parseDictDataLabel("sys_sex", 1)).isEqualTo("男");
        int loadsAfterFirstLookup = loadCount.get();

        new DictFrameworkUtils();

        assertThat(DictFrameworkUtils.parseDictDataLabel("sys_sex", 2))
                .as("实例化不得清空已绑定的字典数据").isEqualTo("女");
        assertThat(loadCount).as("实例化不得丢弃缓存").hasValue(loadsAfterFirstLookup);
    }

    /** 已登记的字典值解析为标签，未登记取值返回 null 而不是回退成原值。 */
    @Test
    void labelLookupMatchesExactValueOnly() {
        assertThat(DictFrameworkUtils.parseDictDataLabel("sys_sex", 1)).isEqualTo("男");
        assertThat(DictFrameworkUtils.parseDictDataLabel("sys_sex", "2")).isEqualTo("女");
        assertThat(DictFrameworkUtils.parseDictDataLabel("sys_sex", "01"))
                .as("字典值按字符串精确比较，不得按数值等价匹配").isNull();
        assertThat(DictFrameworkUtils.parseDictDataLabel("sys_sex", 99)).isNull();
        assertThat(DictFrameworkUtils.parseDictDataValue("sys_sex", "男")).isEqualTo("1");
        assertThat(DictFrameworkUtils.parseDictDataValue("sys_sex", "未知")).isNull();
    }

    /** 构造字典数据，仅填充解析所需的标签与字典值。 */
    private static DictDataRespDTO dictData(String label, String value) {
        DictDataRespDTO dictData = new DictDataRespDTO();
        dictData.setLabel(label);
        dictData.setValue(value);
        return dictData;
    }
}
