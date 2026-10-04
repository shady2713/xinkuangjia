package com.basicframework.framework.excel.core.handler;

import cn.idev.excel.FastExcelFactory;
import cn.idev.excel.annotation.ExcelProperty;
import cn.idev.excel.enums.CellDataTypeEnum;
import cn.idev.excel.metadata.data.WriteCellData;
import cn.idev.excel.write.metadata.holder.WriteSheetHolder;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 Excel 自适应列宽处理器按单元格内容设置真实列宽，并覆盖全部单元格类型分支。
 *
 * <p>该处理器是导出接口的公共写出步骤（{@code ExcelUtils.write} 注册），列宽算错会让长内容被截断显示、
 * 或让短内容占用异常宽度。这里用真实 FastExcel 写出再由 POI 读回，锁定可观察的列宽契约：</p>
 * <ul>
 *   <li>列宽取"表头与全部数据行中最宽者"，按 UTF-8 字节数计量（中文与英文混排必须按字节而非字符）；</li>
 *   <li>超过 POI 上限的宽度截断为 {@code 255 * 256}，避免写出非法列宽；</li>
 *   <li>字符串、数字、布尔、日期四类单元格各自按其展示值计量；</li>
 *   <li>空值与无法识别的类型不设置列宽，保留表头宽度而不是写成 0 或负数。</li>
 * </ul>
 *
 * <p>另外用真实 POI 工作表与真实 {@link WriteSheetHolder} 直接驱动受保护方法，覆盖 FastExcel 在
 * 写出过程中不会构造的输入（空单元格数据集合、类型为 null 与 ERROR 的单元格数据）：这些输入在
 * 真实调用面上存在，且必须"不写列宽"，否则空单元格会把列宽重置为 0。</p>
 *
 * @author shady2713
 */
class ColumnWidthMatchStyleStrategyTest {

    /** POI 列宽单位：1/256 个字符宽度。 */
    private static final int WIDTH_UNIT = 256;

    /**
     * 真实写出后按"最宽内容"设置列宽，并锁定中文按 UTF-8 字节计量。
     *
     * <p>列宽必须取表头与全部数据行的最大值，而不是首行：首行短、后续行长的导出让用户看不到完整内容。</p>
     */
    @Test
    void columnWidthUsesWidestUtf8Content() throws Exception {
        byte[] content = writeRows(List.of(
                new WidthRow("中文名", "short", 42, true, LocalDateTime.of(2024, 1, 2, 3, 4, 5), null),
                new WidthRow("abcdefghijklmnopqrst", repeat('x', 300), 123456, false, null, "x")));

        try (Workbook workbook = new XSSFWorkbook(new ByteArrayInputStream(content))) {
            Sheet sheet = workbook.getSheetAt(0);
            // 表头“名称”为 6 字节；数据“中文名”9 字节、“abcdefghijklmnopqrst”20 字节 ⇒ 取 20。
            assertThat(sheet.getColumnWidth(0)).as("列宽必须取最宽数据行，中文按 UTF-8 字节计量")
                    .isEqualTo(20 * WIDTH_UNIT);
            // 表头“内容”6 字节；数据 300 字节超出上限，“short”5 字节 ⇒ 截断为 255。
            assertThat(sheet.getColumnWidth(1)).as("超过 POI 上限的宽度必须截断而不是写出非法值")
                    .isEqualTo(255 * WIDTH_UNIT);
            // 表头“数量”6 字节；数据“42”2 字节、“123456”6 字节 ⇒ 取表头宽度。
            assertThat(sheet.getColumnWidth(2)).as("数字单元格按展示值计量").isEqualTo(6 * WIDTH_UNIT);
            // 表头“标记”6 字节；数据“true”4 字节、“false”5 字节 ⇒ 取表头宽度。
            assertThat(sheet.getColumnWidth(3)).as("布尔单元格按展示值计量").isEqualTo(6 * WIDTH_UNIT);
            // 表头“时间”6 字节；数据 LocalDateTime.toString() 为 19 字节，另一行空值不参与 ⇒ 19。
            assertThat(sheet.getColumnWidth(4)).as("日期单元格按展示值计量，空值行不得覆盖").isEqualTo(19 * WIDTH_UNIT);
            // 表头“备注”6 字节；一行空值（不设置宽度）、一行“x”1 字节 ⇒ 取表头宽度。
            assertThat(sheet.getColumnWidth(5)).as("空值不设置列宽，表头宽度必须保留").isEqualTo(6 * WIDTH_UNIT);
        }
    }

    /**
     * 空单元格数据集合且非表头时必须直接返回，不得改动已有列宽。
     *
     * <p>FastExcel 在无单元格数据的行上会传入空集合；若继续取值会索引越界，若写入 0 宽度会让整列塌缩。</p>
     */
    @Test
    void emptyCellDataKeepsColumnWidthUntouched() {
        try (Workbook workbook = new XSSFWorkbook()) {
            Sheet sheet = workbook.createSheet("数据");
            sheet.setColumnWidth(2, 33 * WIDTH_UNIT);
            WriteSheetHolder holder = holderFor(sheet, 0);
            Cell cell = dataRow(sheet).createCell(2);

            exposingStrategy().setColumnWidth(holder, List.of(), cell, null, 0, false);

            assertThat(sheet.getColumnWidth(2)).as("空单元格数据不得改写列宽").isEqualTo(33 * WIDTH_UNIT);
        } catch (Exception failure) {
            throw new IllegalStateException("构造 POI 工作表失败", failure);
        }
    }

    /**
     * 单元格数据类型缺失或为无法识别的类型时必须跳过，不得写入列宽。
     *
     * <p>类型缺失来自未赋值的 {@code WriteCellData}，无法识别的类型来自公式错误单元格；
     * 两者都没有可计量的展示值，跳过才能保留表头宽度。</p>
     */
    @Test
    void unknownCellDataTypeKeepsColumnWidthUntouched() {
        try (Workbook workbook = new XSSFWorkbook()) {
            Sheet sheet = workbook.createSheet("数据");
            sheet.setColumnWidth(1, 44 * WIDTH_UNIT);
            WriteSheetHolder holder = holderFor(sheet, 0);
            Cell cell = dataRow(sheet).createCell(1);
            List<WriteCellData<?>> noType = new ArrayList<>();
            noType.add(new WriteCellData<>());
            List<WriteCellData<?>> errorType = new ArrayList<>();
            errorType.add(new WriteCellData<>(CellDataTypeEnum.ERROR));

            exposingStrategy().setColumnWidth(holder, noType, cell, null, 0, false);
            exposingStrategy().setColumnWidth(holder, errorType, cell, null, 0, false);

            assertThat(sheet.getColumnWidth(1)).as("类型缺失或无法识别时不得改写列宽").isEqualTo(44 * WIDTH_UNIT);
        } catch (Exception failure) {
            throw new IllegalStateException("构造 POI 工作表失败", failure);
        }
    }

    /**
     * 表头单元格即使没有数据集合也必须按表头文本设置列宽。
     *
     * <p>导出只有表头（空数据）时，列宽仍必须按表头文字撑开；这里直接驱动真实 POI 表头单元格，
     * 断言写入的是表头 UTF-8 字节数对应的列宽。</p>
     */
    @Test
    void headCellSetsWidthFromHeaderText() {
        try (Workbook workbook = new XSSFWorkbook()) {
            Sheet sheet = workbook.createSheet("数据");
            Row headRow = sheet.createRow(0);
            Cell headCell = headRow.createCell(0);
            headCell.setCellValue("表头名称");

            exposingStrategy().setColumnWidth(holderFor(sheet, 0), null, headCell, null, 0, true);

            assertThat(sheet.getColumnWidth(0)).as("表头宽度按 UTF-8 字节数设置")
                    .isEqualTo("表头名称".getBytes(StandardCharsets.UTF_8).length * WIDTH_UNIT);
        } catch (Exception failure) {
            throw new IllegalStateException("构造 POI 工作表失败", failure);
        }
    }

    /** 用真实 FastExcel 写出真实 xlsx 字节，供 POI 读回核对列宽。 */
    private static byte[] writeRows(List<WidthRow> rows) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        FastExcelFactory.write(output, WidthRow.class)
                .registerWriteHandler(new ColumnWidthMatchStyleStrategy())
                .sheet("数据")
                .doWrite(rows);
        return output.toByteArray();
    }

    /** 构造数据行，列号与表头夹具字段顺序一致。 */
    private static Row dataRow(Sheet sheet) {
        return sheet.createRow(1);
    }

    /** 构造真实写入上下文，只填充被测方法实际读取的 sheet 与 sheetNo。 */
    private static WriteSheetHolder holderFor(Sheet sheet, int sheetNo) {
        WriteSheetHolder holder = new WriteSheetHolder();
        holder.setSheet(sheet);
        holder.setSheetNo(sheetNo);
        return holder;
    }

    /** 用同包子类暴露受保护方法，直接驱动 FastExcel 写出过程不会构造的输入。 */
    private static ExposedStrategy exposingStrategy() {
        return new ExposedStrategy();
    }

    /** 生成重复字符，用于构造超过列宽上限的长内容。 */
    private static String repeat(char value, int count) {
        return String.valueOf(value).repeat(count);
    }

    /**
     * 暴露受保护方法的同包子类，只用于直接驱动边界输入。
     *
     * @author shady2713
     */
    static class ExposedStrategy extends ColumnWidthMatchStyleStrategy {

        /**
         * 暴露受保护的列宽设置入口，参数语义与父类一致。
         *
         * @param writeSheetHolder 写入 Sheet 上下文
         * @param cellDataList 单元格写入数据
         * @param cell POI 单元格
         * @param head 表头元数据
         * @param relativeRowIndex 相对行索引
         * @param isHead 是否表头
         */
        @Override
        public void setColumnWidth(WriteSheetHolder writeSheetHolder, List<WriteCellData<?>> cellDataList, Cell cell,
                                   cn.idev.excel.metadata.Head head, Integer relativeRowIndex, Boolean isHead) {
            super.setColumnWidth(writeSheetHolder, cellDataList, cell, head, relativeRowIndex, isHead);
        }
    }

    /**
     * 列宽写出夹具，字段顺序即列顺序，覆盖字符串、数字、布尔、日期与空值。
     *
     * @author shady2713
     */
    public static class WidthRow {

        /** 字符串列，用于验证按最宽内容取列宽。 */
        @ExcelProperty("名称")
        private String name;
        /** 字符串列，用于验证超上限截断。 */
        @ExcelProperty("内容")
        private String content;
        /** 数字列。 */
        @ExcelProperty("数量")
        private Integer count;
        /** 布尔列。 */
        @ExcelProperty("标记")
        private Boolean flag;
        /** 日期时间列，允许为空。 */
        @ExcelProperty("时间")
        private LocalDateTime time;
        /** 备注列，允许为空。 */
        @ExcelProperty("备注")
        private String note;

        /** 供 FastExcel 反射写出使用的无参构造。 */
        public WidthRow() {
        }

        /**
         * 构造一行列宽夹具。
         *
         * @param name 名称
         * @param content 内容
         * @param count 数量
         * @param flag 标记
         * @param time 时间，允许为 null
         * @param note 备注，允许为 null
         */
        public WidthRow(String name, String content, Integer count, Boolean flag, LocalDateTime time, String note) {
            this.name = name;
            this.content = content;
            this.count = count;
            this.flag = flag;
            this.time = time;
            this.note = note;
        }

        /**
         * 获取名称。
         *
         * @return 名称
         */
        public String getName() {
            return name;
        }

        /**
         * 设置名称。
         *
         * @param name 名称
         */
        public void setName(String name) {
            this.name = name;
        }

        /**
         * 获取内容。
         *
         * @return 内容
         */
        public String getContent() {
            return content;
        }

        /**
         * 设置内容。
         *
         * @param content 内容
         */
        public void setContent(String content) {
            this.content = content;
        }

        /**
         * 获取数量。
         *
         * @return 数量
         */
        public Integer getCount() {
            return count;
        }

        /**
         * 设置数量。
         *
         * @param count 数量
         */
        public void setCount(Integer count) {
            this.count = count;
        }

        /**
         * 获取标记。
         *
         * @return 标记
         */
        public Boolean getFlag() {
            return flag;
        }

        /**
         * 设置标记。
         *
         * @param flag 标记
         */
        public void setFlag(Boolean flag) {
            this.flag = flag;
        }

        /**
         * 获取时间。
         *
         * @return 时间
         */
        public LocalDateTime getTime() {
            return time;
        }

        /**
         * 设置时间。
         *
         * @param time 时间
         */
        public void setTime(LocalDateTime time) {
            this.time = time;
        }

        /**
         * 获取备注。
         *
         * @return 备注
         */
        public String getNote() {
            return note;
        }

        /**
         * 设置备注。
         *
         * @param note 备注
         */
        public void setNote(String note) {
            this.note = note;
        }
    }

}
