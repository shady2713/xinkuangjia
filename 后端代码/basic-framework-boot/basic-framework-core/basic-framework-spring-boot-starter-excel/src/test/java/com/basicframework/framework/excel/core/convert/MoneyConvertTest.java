package com.basicframework.framework.excel.core.convert;

import cn.idev.excel.enums.CellDataTypeEnum;
import cn.idev.excel.metadata.data.WriteCellData;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证金额转换器把“分”换算为“元”的口径与单元格类型。
 *
 * <p>该转换器是导出扩展点，业务方通过 {@code @ExcelProperty(converter = MoneyConvert.class)}
 * 挂在 Integer 金额字段上。导出后金额会脱离系统继续被人读取和二次计算，因此两项契约必须锁定：
 * 一是分与元的换算按 2 位小数四舍五入，不能出现 1 分被显示成 0 元；二是结果写成字符串单元格，
 * 否则 Excel 会把 {@code 1.00} 当数字回显成 {@code 1}，丢失分位精度。</p>
 *
 * <p>仓库内没有生产消费方，本用例直接按转换器接口调用，覆盖真实换算与单元格构造。</p>
 *
 * @author shady2713
 */
class MoneyConvertTest {

    /** 被测转换器，无状态，可跨用例复用。 */
    private static final MoneyConvert CONVERTER = new MoneyConvert();

    /** 整数元金额必须补足两位小数，不能因数值整除而省略分位。 */
    @Test
    void wholeYuanAmountsKeepTwoDecimals() {
        assertThat(convert(0)).isEqualTo("0.00");
        assertThat(convert(100)).isEqualTo("1.00");
        assertThat(convert(-100)).isEqualTo("-1.00");
        assertThat(convert(2147483647)).as("Integer 上边界仍须精确换算").isEqualTo("21474836.47");
    }

    /** 非整数元金额按分位展示，进位方向与四舍五入一致。 */
    @Test
    void fractionalYuanAmountsRoundHalfUpToCents() {
        assertThat(convert(1)).isEqualTo("0.01");
        assertThat(convert(4)).as("不足半分向下").isEqualTo("0.04");
        assertThat(convert(5)).as("半分向上").isEqualTo("0.05");
        assertThat(convert(99)).isEqualTo("0.99");
        assertThat(convert(199)).isEqualTo("1.99");
        assertThat(convert(12345)).isEqualTo("123.45");
        assertThat(convert(-5)).as("负数按远离零方向进位").isEqualTo("-0.05");
    }

    /**
     * 换算结果必须写成字符串单元格，避免 Excel 按数字回显丢失分位。
     *
     * <p>FastExcel 的字符串单元格把内容放在 {@code stringValue}，{@code data} 保持为空，
     * 因此这里断言真正被写出的字段；同时确认没有数值载荷，否则 Excel 会按数字处理。</p>
     */
    @Test
    void convertedCellIsWrittenAsText() {
        WriteCellData<String> cellData = CONVERTER.convertToExcelData(12345, null, null);

        assertThat(cellData.getType()).isEqualTo(CellDataTypeEnum.STRING);
        assertThat(cellData.getStringValue()).isEqualTo("123.45");
        assertThat(cellData.getNumberValue()).as("文本单元格不得携带数值，否则 Excel 会按数字处理").isNull();
        assertThat(cellData.getBooleanValue()).isNull();
    }

    /**
     * 换算只依赖金额本身，字段属性与全局配置允许为空。
     *
     * <p>转换器不读取字段注解或全局配置，导出框架在无额外配置时也按此调用，
     * 因此必须能在两个参数为 null 时正常返回。</p>
     */
    @Test
    void conversionDoesNotRequireContentPropertyOrGlobalConfiguration() {
        assertThat(CONVERTER.convertToExcelData(100, null, null).getStringValue()).isEqualTo("1.00");
    }

    /**
     * 调用转换器并返回文本结果。
     *
     * @param cents 金额，单位：分
     * @return 以元为单位的两位小数字符串
     */
    private static String convert(Integer cents) {
        return CONVERTER.convertToExcelData(cents, null, null).getStringValue();
    }
}
