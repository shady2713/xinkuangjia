package com.basicframework.framework.excel.core.convert;

import cn.idev.excel.enums.CellDataTypeEnum;
import cn.idev.excel.metadata.data.WriteCellData;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 {@link JsonConvert} 把对象字段写成单元格内 JSON 文本的导出契约。
 *
 * <p>该转换器是导出扩展点，业务方通过 {@code @ExcelProperty(converter = JsonConvert.class)}
 * 挂在结构化字段上。导出的表格会被人直接阅读和二次处理，因此需要锁定：单元格必须是文本类型
 * （否则 Excel 会把 JSON 当数字或日期解析）、内容按运行期 JSON 口径序列化、
 * 以及 null 字段与 null 取值这两类边界的真实输出。</p>
 *
 * <p>仓库内没有生产消费方，本用例直接按转换器接口调用，覆盖真实序列化与单元格构造。</p>
 *
 * <p><b>依赖边界说明</b>：本模块的生产代码 {@code JsonConvert#convertToExcelData} 经
 * {@code JsonUtils} 真实依赖 Jackson（{@code JsonUtils} 静态块注册 {@code JavaTimeModule}）。
 * 该依赖原先未在本模块声明，独立使用该 starter 时会在 {@code JsonUtils} 类初始化阶段抛
 * {@code NoClassDefFoundError}；现已与 {@code basic-framework-common} 一致，把
 * jackson-databind / jackson-core / jackson-datatype-jsr310 声明为 {@code provided}
 * （由使用方提供）。本用例因此既证明转换行为正确，也覆盖了该依赖声明缺口。</p>
 *
 * @author shady2713
 */
class JsonConvertTest {

    /** 被测转换器，无状态，可跨用例复用。 */
    private static final JsonConvert CONVERTER = new JsonConvert();

    /**
     * 结构化字段必须序列化为 JSON 文本并写成文本单元格。
     *
     * <p>数值载荷为空是硬约束：携带数值时 Excel 会按数字处理，含 {@code {}} 的内容将无法回显。</p>
     */
    @Test
    void objectValueIsWrittenAsJsonTextCell() {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("id", 1);
        value.put("name", "张三");

        WriteCellData<String> cellData = CONVERTER.convertToExcelData(value, null, null);

        assertThat(cellData.getType()).isEqualTo(CellDataTypeEnum.STRING);
        assertThat(cellData.getStringValue()).isEqualTo("{\"id\":1,\"name\":\"张三\"}");
        assertThat(cellData.getNumberValue()).as("JSON 必须写成文本，否则 Excel 会按数字解析").isNull();
        assertThat(cellData.getDateValue()).isNull();
    }

    /** 取值为 null 的字段按运行期 JSON 口径省略，不写成 {@code "key":null} 干扰阅读。 */
    @Test
    void nullFieldsAreOmittedFromJsonText() {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("id", 1);
        value.put("remark", null);

        assertThat(CONVERTER.convertToExcelData(value, null, null).getStringValue())
                .isEqualTo("{\"id\":1}");
    }

    /**
     * 字段整体为 null 时单元格写入字面量 {@code null}。
     *
     * <p>序列化器对 null 输入返回 {@code "null"} 文本，导出后单元格会显示这四个字符；
     * 这是既有口径而非空单元格，本用例锁定真实输出以便评审时可见。</p>
     */
    @Test
    void nullValueIsWrittenAsNullLiteral() {
        assertThat(CONVERTER.convertToExcelData(null, null, null).getStringValue()).isEqualTo("null");
    }

    /** 转换只依赖字段值本身，导出框架在无注解与全局配置时同样调用。 */
    @Test
    void conversionDoesNotRequireContentPropertyOrGlobalConfiguration() {
        assertThat(CONVERTER.convertToExcelData("plain", null, null).getStringValue()).isEqualTo("\"plain\"");
    }

}
