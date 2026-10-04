package com.basicframework.framework.excel.core.convert;

import cn.idev.excel.metadata.data.ReadCellData;
import cn.idev.excel.metadata.property.ExcelContentProperty;
import com.basicframework.framework.ip.core.utils.AreaUtils;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证地区转换器把 Excel 单元格中的地区路径解析为地区编号的导入契约。
 *
 * <p>该转换器是导入扩展点，业务方通过 {@code @ExcelProperty(converter = AreaConvert.class)}
 * 挂在地区字段上。导入文件的地区列由人工填写，因此需要锁定三类真实行为：
 * 合法路径按字段声明的类型返回对应编号（Integer 字段得到整数、String 字段得到字符串）；
 * 无法解析的路径返回 null 而不是抛出异常，让导入流程按“空值”处理并保留其余行；
 * 两个类型声明入口刻意不支持并抛出明确异常，避免调用方误以为该转换器可参与导出。</p>
 *
 * @author shady2713
 */
class AreaConvertTest {

    /** 被测转换器，无状态，可跨用例复用。 */
    private static final AreaConvert CONVERTER = new AreaConvert();

    /** 类型声明入口不支持且提示明确，防止被当作可导出的转换器使用。 */
    @Test
    void typeDeclarationEntriesAreUnsupported() {
        assertThatThrownBy(CONVERTER::supportJavaTypeKey)
                .isInstanceOf(UnsupportedOperationException.class)
                .hasMessage("暂不支持，也不需要");
        assertThatThrownBy(CONVERTER::supportExcelTypeKey)
                .isInstanceOf(UnsupportedOperationException.class)
                .hasMessage("暂不支持，也不需要");
    }

    /** 合法地区路径按字段类型转换：Integer 字段得到整数编号。 */
    @Test
    void integerFieldReceivesNumericAreaId() throws Exception {
        Object result = convert("北京市/北京市/东城区", "integerAreaId");

        assertThat(result).isInstanceOf(Integer.class).isEqualTo(110101);
        assertThat(AreaUtils.getArea(110101).getName()).as("编号必须指向路径末级地区").isEqualTo("东城区");
    }

    /** 字段声明为字符串时保留编号的字符串形态，便于直接落库到文本列。 */
    @Test
    void stringFieldReceivesAreaIdAsText() throws Exception {
        Object result = convert("北京市/北京市/东城区", "textAreaId");

        assertThat(result).isInstanceOf(String.class).isEqualTo("110101");
    }

    /** 无法解析的地区路径返回 null 且不抛异常，由导入流程按空值处理该行。 */
    @Test
    void unknownAreaPathYieldsNullInsteadOfFailing() throws Exception {
        assertThat(convert("不存在的地方", "integerAreaId")).isNull();
        assertThat(convert("", "integerAreaId")).as("空单元格同样按无法解析处理").isNull();
    }

    /**
     * 按被测转换器的真实调用方式执行一次转换。
     *
     * @param label 单元格文本，即地区路径
     * @param fieldName 表头类中承载地区编号的字段名
     * @return 转换结果，无法解析时为 null
     * @throws Exception 读取字段声明失败
     */
    private static Object convert(String label, String fieldName) throws Exception {
        Field field = AreaFieldHolder.class.getDeclaredField(fieldName);
        ExcelContentProperty contentProperty = new ExcelContentProperty();
        contentProperty.setField(field);
        return CONVERTER.convertToJavaData(new ReadCellData<>(label), contentProperty, null);
    }

    /** 导入表头夹具，覆盖整数与字符串两种地区编号字段声明。 */
    private static class AreaFieldHolder {

        /** 整数型地区编号字段。 */
        private Integer integerAreaId;

        /** 字符串型地区编号字段。 */
        private String textAreaId;
    }

}
