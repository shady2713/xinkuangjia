package com.basicframework.framework.excel.core.convert;

import cn.idev.excel.FastExcelFactory;
import cn.idev.excel.annotation.ExcelProperty;
import cn.idev.excel.enums.CellDataTypeEnum;
import cn.idev.excel.metadata.data.WriteCellData;
import com.basicframework.framework.common.biz.system.dict.DictDataCommonApi;
import com.basicframework.framework.common.biz.system.dict.dto.DictDataRespDTO;
import com.basicframework.framework.dict.core.DictFrameworkUtils;
import com.basicframework.framework.excel.core.annotations.DictFormat;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证 Excel 字典转换器在导出与导入两个方向上的真实行为。
 *
 * <p>该转换器是导出/导入与数据字典之间的唯一适配点，转换错误会让导出的表格显示内部编号、
 * 或让导入的标签被写成错误编号。这里用真实 FastExcel 写出与读回、真实字典工具类与真实
 * {@link DictFormat} 注解驱动转换器，锁定以下契约：</p>
 * <ul>
 *   <li>导出把字典值格式化为标签；字典值未登记或字段为空时输出空单元格，不回显内部值；</li>
 *   <li>导入把标签反查为字典值并按字段声明类型转换（{@code Integer} 字段得到数字而不是字符串）；</li>
 *   <li>标签未登记时返回 null（写入 null 而不是抛错或写成 0）。</li>
 * </ul>
 *
 * <p>支持类型声明接口在本转换器中刻意不支持：两个方法都抛出带明确文案的
 * {@link UnsupportedOperationException}，避免 FastExcel 按类型自动匹配到本转换器。</p>
 *
 * @author shady2713
 */
class DictConvertTest {

    /** 本用例使用的字典类型。 */
    private static final String DICT_TYPE = "sys_sex";

    /** 注入只含男/女两项的字典数据，并清空静态缓存，避免上一例的缓存掩盖真实解析。 */
    @BeforeEach
    void setUp() {
        DictDataCommonApi dictDataApi = type -> DICT_TYPE.equals(type)
                ? List.of(dictData("男", "1"), dictData("女", "2"))
                : List.of();
        DictFrameworkUtils.init(dictDataApi);
        DictFrameworkUtils.clearCache();
    }

    /** 清理静态字典缓存，避免把本用例的字典替身带出。 */
    @AfterEach
    void tearDown() {
        DictFrameworkUtils.clearCache();
    }

    /**
     * 转换器不声明支持的 Java 类型与 Excel 类型，调用必须显式失败。
     *
     * <p>声明会被 FastExcel 当作按类型自动匹配的转换器，从而影响所有同类型字段；
     * 因此两个声明入口必须抛出带明确文案的异常。</p>
     */
    @Test
    void supportTypeDeclarationsFailFast() {
        DictConvert convert = new DictConvert();

        assertThatThrownBy(convert::supportJavaTypeKey)
                .isInstanceOf(UnsupportedOperationException.class).hasMessage("暂不支持，也不需要");
        assertThatThrownBy(convert::supportExcelTypeKey)
                .isInstanceOf(UnsupportedOperationException.class).hasMessage("暂不支持，也不需要");
    }

    /**
     * 导出把字典值写成标签，未登记的值与空值都写成空单元格。
     *
     * <p>空值不得写成 {@code "null"} 文本或原始编号；未登记的值不得回显内部值，
     * 否则导出文件会把内部编码暴露给使用方。</p>
     */
    @Test
    void exportWritesLabelAndEmptyCellForUnknownValue() throws Exception {
        byte[] content = writeRows(List.of(
                row(1),
                row(99),
                row(null)));

        try (Workbook workbook = new XSSFWorkbook(new ByteArrayInputStream(content))) {
            Sheet sheet = workbook.getSheetAt(0);
            assertThat(sheet.getRow(1).getCell(0).getStringCellValue()).as("已登记字典值必须导出为标签").isEqualTo("男");
            assertThat(sheet.getRow(2).getCell(0).getStringCellValue()).as("未登记字典值不得回显内部编码").isEmpty();
            assertThat(sheet.getRow(3).getCell(0).getStringCellValue()).as("空值必须导出为空单元格").isEmpty();
        }
    }

    /**
     * 导入把标签反查为字典值，并按字段声明类型转换；未登记标签写入 null。
     *
     * <p>字段类型是 {@code Integer}，若只做字符串回填，后续业务比较与入库都会失败。</p>
     */
    @Test
    void importConvertsLabelToDeclaredFieldType() throws Exception {
        byte[] content = workbookWithLabels("男", "女", "未知");

        List<DictRow> rows = readRows(content);

        assertThat(rows).hasSize(3);
        assertThat(rows.get(0).getSex()).as("标签必须反查为字段类型对应的字典值").isEqualTo(1);
        assertThat(rows.get(1).getSex()).isEqualTo(2);
        assertThat(rows.get(2).getSex()).as("未登记标签必须写入 null，而不是抛错或写成 0").isNull();
    }

    /** 用真实 FastExcel 导出字典行，返回真实 xlsx 字节。 */
    private static byte[] writeRows(List<DictRow> rows) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        FastExcelFactory.write(output, DictRow.class).sheet("数据").doWrite(rows);
        return output.toByteArray();
    }

    /**
     * 转换器自身对 null 值必须返回空单元格，且不访问字典。
     *
     * <p>FastExcel 写出时对 null 字段直接生成空单元格、不回调转换器（已由上一条导出用例证实），
     * 因此这里直接调用转换器的公开契约：空值返回空字符串单元格，而不是 null 或回显字典值。</p>
     */
    @Test
    void nullValueConvertsToEmptyCell() {
        WriteCellData<String> cellData = new DictConvert().convertToExcelData(null, null, null);

        assertThat(cellData.getStringValue()).as("空值必须转为空单元格").isEmpty();
        assertThat(cellData.getType()).as("空单元格类型必须是字符串").isEqualTo(CellDataTypeEnum.STRING);
    }

    /** 构造只有表头与标签列的 xlsx，用于驱动导入方向。 */
    private static byte[] workbookWithLabels(String... labels) throws Exception {
        try (Workbook workbook = new XSSFWorkbook();
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            Sheet sheet = workbook.createSheet("数据");
            sheet.createRow(0).createCell(0).setCellValue("性别");
            for (int index = 0; index < labels.length; index++) {
                sheet.createRow(index + 1).createCell(0).setCellValue(labels[index]);
            }
            workbook.write(output);
            return output.toByteArray();
        }
    }

    /** 用真实 FastExcel 读回字典列，返回带类型的字段值。 */
    private static List<DictRow> readRows(byte[] content) throws Exception {
        try (ByteArrayInputStream input = new ByteArrayInputStream(content)) {
            return FastExcelFactory.read(input, DictRow.class, null).sheet().doReadSync();
        }
    }

    /** 构造一行字典夹具，字典值允许为 null。 */
    private static DictRow row(Integer sex) {
        DictRow row = new DictRow();
        row.setSex(sex);
        return row;
    }

    /** 构造字典数据，仅填充解析所需的标签与字典值。 */
    private static DictDataRespDTO dictData(String label, String value) {
        DictDataRespDTO dictData = new DictDataRespDTO();
        dictData.setLabel(label);
        dictData.setValue(value);
        return dictData;
    }

    /**
     * 字典导出导入夹具：字段声明字典类型与转换器，与生产 VO 的写法一致。
     *
     * @author shady2713
     */
    public static class DictRow {

        /** 性别字典值列，导出为标签、导入回数字。 */
        @ExcelProperty(value = "性别", converter = DictConvert.class)
        @DictFormat(DICT_TYPE)
        private Integer sex;

        /** 供 FastExcel 反射使用的无参构造。 */
        public DictRow() {
        }

        /**
         * 获取性别字典值。
         *
         * @return 性别字典值
         */
        public Integer getSex() {
            return sex;
        }

        /**
         * 设置性别字典值。
         *
         * @param sex 性别字典值
         */
        public void setSex(Integer sex) {
            this.sex = sex;
        }
    }

}
