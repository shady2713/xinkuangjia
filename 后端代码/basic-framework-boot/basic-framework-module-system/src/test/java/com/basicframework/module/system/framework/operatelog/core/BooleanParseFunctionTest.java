package com.basicframework.module.system.framework.operatelog.core;

import com.basicframework.framework.common.biz.system.dict.dto.DictDataRespDTO;
import com.basicframework.framework.dict.core.DictFrameworkUtils;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证操作日志的“是否”解析函数：注册名、转换时机与字典标签映射。
 *
 * <p>布尔字段在业务表里通常存 0/1 或 true/false，日志展示需要转成“是/否”一类可读标签，
 * 该映射依赖字典数据。函数声明“先转换值后对比”，必须在比较前完成转换。空值必须解析为空串，
 * 未登记的字典值必须返回 null 而不是原值，避免日志把内部编码当成业务文案展示。</p>
 *
 * @author shady2713
 */
class BooleanParseFunctionTest {

    /** 被测解析函数。 */
    private final BooleanParseFunction function = new BooleanParseFunction();

    /** 注入字典数据替身并清空缓存，保证本例读取的是本用例声明的字典。 */
    @BeforeEach
    void setUp() {
        DictFrameworkUtils.clearCache();
        DictFrameworkUtils.init(dictType -> "infra_boolean_string".equals(dictType)
                ? List.of(dictData("是", "true"), dictData("否", "false"))
                : List.of());
    }

    /** 清理字典缓存，避免静态缓存把本用例的字典替身带出用例。 */
    @AfterEach
    void tearDown() {
        DictFrameworkUtils.clearCache();
    }

    /** 注册名与转换时机必须与操作日志注解中的引用一致。 */
    @Test
    void registrationNameAndOrderAreStable() {
        assertThat(BooleanParseFunction.NAME).isEqualTo("getBoolean");
        assertThat(function.functionName()).isEqualTo("getBoolean");
        assertThat(function.executeBefore()).as("必须先把编码转换成标签再参与比较").isTrue();
    }

    /** 空值必须解析为空串，避免日志出现 null 字样。 */
    @Test
    void emptyValueParsesToEmptyString() {
        assertThat(function.apply(null)).isEmpty();
        assertThat(function.apply("")).isEmpty();
    }

    /** 已登记的字典值必须解析为字典标签，字典值以字符串精确匹配。 */
    @Test
    void registeredValuesParseIntoDictLabels() {
        assertThat(function.apply(true)).isEqualTo("是");
        assertThat(function.apply("false")).isEqualTo("否");
    }

    /** 未登记的字典值解析为 null，不得回退成原始编码。 */
    @Test
    void unknownValueParsesToNull() {
        assertThat(function.apply("unknown")).as("未登记取值不得原样展示").isNull();
    }

    /** 构造只填充解析所需字段的字典数据。 */
    private static DictDataRespDTO dictData(String label, String value) {
        DictDataRespDTO dictData = new DictDataRespDTO();
        dictData.setLabel(label);
        dictData.setValue(value);
        return dictData;
    }
}
