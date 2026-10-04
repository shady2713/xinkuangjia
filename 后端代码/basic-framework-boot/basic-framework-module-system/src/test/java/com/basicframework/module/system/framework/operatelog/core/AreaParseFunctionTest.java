package com.basicframework.module.system.framework.operatelog.core;

import com.basicframework.framework.ip.core.utils.AreaUtils;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证操作日志的“地名”解析函数：注册名、转换时机与取值到地区名的映射。
 *
 * <p>操作日志的记录内容里，地区字段在库里存的是编号；展示前必须经该函数转成可读地名，
 * 否则日志里只会出现一串数字。函数声明“先转换值后对比”，因此必须在方法比较之前完成转换，
 * 否则条件判断拿编号与原值比较会永远不相等。空值与未登记的编号不能回退成编号本身，
 * 否则日志会显示一个看似地名实际是编号的内容。</p>
 *
 * @author shady2713
 */
class AreaParseFunctionTest {

    /** 被测解析函数。 */
    private final AreaParseFunction function = new AreaParseFunction();

    /** 注册名与转换时机必须与操作日志注解中的引用一致。 */
    @Test
    void registrationNameAndOrderAreStable() {
        assertThat(AreaParseFunction.NAME).isEqualTo("getArea");
        assertThat(function.functionName()).isEqualTo("getArea");
        assertThat(function.executeBefore()).as("必须先把编号转换成地名再参与比较").isTrue();
    }

    /** 空值必须解析为空串，避免日志出现 null 字样。 */
    @Test
    void emptyValueParsesToEmptyString() {
        assertThat(function.apply(null)).isEmpty();
        assertThat(function.apply("")).isEmpty();
    }

    /** 整数编号与字符串编号都必须解析为真实地名，且与区域工具结论一致。 */
    @Test
    void areaIdsParseIntoFormattedNames() {
        assertThat(function.apply(110100)).isEqualTo(AreaUtils.format(110100)).isEqualTo("北京市 北京市");
        assertThat(function.apply("320100")).as("字符串编号同样需要转换").isEqualTo("江苏省 南京市");
        assertThat(function.apply(1)).as("国家层级只显示国家名").isEqualTo("中国");
    }

    /** 未登记的区域编号解析为 null，不得回退成编号本身。 */
    @Test
    void unknownAreaIdParsesToNull() {
        assertThat(AreaUtils.format(710000)).as("该编号不在随包区域数据中").isNull();
        assertThat(function.apply(710000)).isNull();
    }
}
