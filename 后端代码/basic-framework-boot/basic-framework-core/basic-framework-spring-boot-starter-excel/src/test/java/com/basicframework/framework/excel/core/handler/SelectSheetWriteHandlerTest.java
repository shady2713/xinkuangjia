package com.basicframework.framework.excel.core.handler;

import cn.hutool.extra.spring.SpringUtil;
import cn.idev.excel.FastExcelFactory;
import cn.idev.excel.annotation.ExcelIgnore;
import cn.idev.excel.annotation.ExcelIgnoreUnannotated;
import cn.idev.excel.annotation.ExcelProperty;
import cn.idev.excel.support.ExcelTypeEnum;
import com.basicframework.framework.common.biz.system.dict.DictDataCommonApi;
import com.basicframework.framework.common.biz.system.dict.dto.DictDataRespDTO;
import com.basicframework.framework.dict.core.DictFrameworkUtils;
import com.basicframework.framework.excel.core.annotations.ExcelColumnSelect;
import com.basicframework.framework.excel.core.function.ExcelColumnSelectFunction;
import org.apache.poi.hssf.usermodel.HSSFDataValidation;
import org.apache.poi.hssf.usermodel.HSSFWorkbook;
import org.apache.poi.ss.usermodel.DataValidation;
import org.apache.poi.ss.usermodel.Name;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证 Excel 下拉框处理器在真实导出流程中的列定位、数据源解析与校验绑定契约。
 *
 * <p>该处理器由 {@code ExcelUtils.write} 注册到每个导出请求上：列索引算错会把下拉框绑到别的列，
 * 数据源解析错会让用户选到错误选项，校验约束没绑上则等于没有下拉。因此除构造期的参数错误外，
 * 全部通过真实 FastExcel 写出再由 POI 读回，断言外部可观察结果：</p>
 * <ul>
 *   <li>字段到列索引的推进规则（显式 {@code index} 覆盖自增序号、静态常量与 transient 字段跳过、
 *       类级 {@code ExcelIgnoreUnannotated} 与字段级 {@code ExcelIgnore} 都跳过）；</li>
 *   <li>字典类型的下拉值取自字典接口，业务函数的下拉值按 {@code functionName} 精确匹配 Spring 容器内的实现；</li>
 *   <li>下拉数据写入隐藏字典 Sheet 的对应列，并以升序（候选少的列先建）建立命名区域；</li>
 *   <li>目标列 {@code FIRST_ROW..LAST_ROW} 绑定列表校验，xlsx 与 xls 两种工作簿的箭头抑制行为各自正确；</li>
 *   <li>没有任何下拉列时不创建字典 Sheet，也不得添加校验。</li>
 * </ul>
 *
 * <p>字典接口替身是明确的跨模块边界；{@code functionName} 路径使用真实 Spring 容器装配真实实现，
 * 以证明按名称匹配而不是"取第一个实现"。用例结束后清理静态字典缓存并还原 Spring 静态上下文。</p>
 *
 * @author shady2713
 */
class SelectSheetWriteHandlerTest {

    /** 本用例使用的字典类型。 */
    private static final String DICT_TYPE = "sys_select_status";
    /** 字典候选：两个标签，用于验证字典列写入与排序。 */
    private static final List<String> DICT_LABELS = List.of("启用", "停用");
    /** 业务函数候选：三个选项，数量多于字典列，用于验证按候选数升序建列。 */
    private static final List<String> FUNCTION_OPTIONS = List.of("研发部", "财务部", "市场部");

    /** 进入用例前的静态 Spring 上下文，结束后原样恢复。 */
    private ApplicationContext previousContext;
    /** 本用例创建的容器，结束时关闭。 */
    private AnnotationConfigApplicationContext context;

    /** 注入字典接口替身并清空缓存，避免上一例的缓存掩盖真实加载。 */
    @BeforeEach
    void setUp() {
        previousContext = SpringUtil.getApplicationContext();
        DictFrameworkUtils.init(type -> DICT_TYPE.equals(type)
                ? List.of(dictData("启用", "1"), dictData("停用", "2"))
                : List.of());
        DictFrameworkUtils.clearCache();
    }

    /** 清理字典缓存、关闭容器并还原静态上下文。 */
    @AfterEach
    void tearDown() {
        DictFrameworkUtils.clearCache();
        if (context != null) {
            context.close();
            context = null;
        }
        new SpringUtil().setApplicationContext(previousContext);
    }

    /**
     * 显式列索引覆盖自增序号，被忽略的字段不占列，字典列与函数列各自写入真实候选值。
     *
     * <p>夹具字段顺序为"静态常量、transient、@ExcelIgnore、显式 index=3 的字典列、缺省 index 的函数列"：
     * 前三个必须不占列序号，字典列固定落在第 3 列，函数列顺延到第 4 列。</p>
     */
    @Test
    void constructorResolvesColumnIndexAndBothSelectSources() throws Exception {
        installFunctionBeans();

        byte[] content = write(new SelectProbeRow(), new SelectProbeRow());
        try (Workbook workbook = new XSSFWorkbook(new ByteArrayInputStream(content))) {
            Sheet dictSheet = workbook.getSheet("字典sheet");
            assertThat(dictSheet).as("存在下拉列时必须创建隐藏字典 Sheet").isNotNull();
            assertThat(dictSheet.getRow(0).getCell(3).getStringCellValue()).isEqualTo("启用");
            assertThat(dictSheet.getRow(1).getCell(3).getStringCellValue()).isEqualTo("停用");
            assertThat(dictSheet.getRow(0).getCell(4).getStringCellValue()).isEqualTo("研发部");
            assertThat(dictSheet.getRow(2).getCell(4).getStringCellValue()).isEqualTo("市场部");

            assertThat(workbook.getName("dict3").getRefersToFormula())
                    .as("字典列命名区域必须指向字典 Sheet 的第 3 列前两行").contains("$D$1:$D$2");
            assertThat(workbook.getName("dict4").getRefersToFormula()).contains("$E$1:$E$3");
            assertThat(workbook.getAllNames().stream().map(Name::getNameName).toList())
                    .as("候选少的列先建命名区域，避免先建大范围后追加小范围时下拉失效")
                    .containsExactly("dict3", "dict4");

            Sheet dataSheet = workbook.getSheet("数据");
            assertThat(dataSheet.getDataValidations()).hasSize(2);
            DataValidation dictValidation = dataSheet.getDataValidations().get(0);
            assertThat(dictValidation.getValidationConstraint().getFormula1()).contains("dict3");
            assertThat(dictValidation.getRegions().getCellRangeAddress(0).getFirstRow())
                    .isEqualTo(SelectSheetWriteHandler.FIRST_ROW);
            assertThat(dictValidation.getRegions().getCellRangeAddress(0).getLastRow())
                    .isEqualTo(SelectSheetWriteHandler.LAST_ROW);
            assertThat(dictValidation.getRegions().getCellRangeAddress(0).getFirstColumn()).isEqualTo(3);
            assertThat(dictValidation.getRegions().getCellRangeAddress(0).getLastColumn()).isEqualTo(3);
            assertThat(dictValidation.getErrorStyle()).isEqualTo(DataValidation.ErrorStyle.STOP);
            assertThat(dictValidation.getErrorBoxText()).isEqualTo("此值不存在于下拉选择中！");
            assertThat(dictValidation.getSuppressDropDownArrow())
                    .as("非 HSSF 工作簿必须显示下拉箭头并开启错误提示框").isTrue();
            assertThat(dictValidation.getShowErrorBox()).isTrue();
        }
    }

    /**
     * 类级 {@code ExcelIgnoreUnannotated} 让没有 {@code ExcelProperty} 的字段整列跳过。
     *
     * <p>这是导出模型"只导出显式声明的列"的约定：未声明的字段若仍占用列序号，
     * 后续所有下拉都会错位。</p>
     */
    @Test
    void ignoreUnannotatedHeadSkipsFieldsWithoutExcelProperty() throws Exception {
        byte[] content = write(new UnannotatedProbeRow(), new UnannotatedProbeRow());
        try (Workbook workbook = new XSSFWorkbook(new ByteArrayInputStream(content))) {
            Sheet dictSheet = workbook.getSheet("字典sheet");
            assertThat(dictSheet.getRow(0).getCell(0).getStringCellValue()).isEqualTo("启用");
            assertThat(dictSheet.getRow(1).getCell(0).getStringCellValue()).isEqualTo("停用");

            Sheet dataSheet = workbook.getSheet("数据");
            assertThat(dataSheet.getDataValidations()).hasSize(1);
            assertThat(dataSheet.getDataValidations().get(0).getRegions().getCellRangeAddress(0).getFirstColumn())
                    .as("下拉必须绑在唯一被导出的列上").isZero();
        }
    }

    /** 业务函数下拉按名称精确匹配容器内的实现，不得退化成"取第一个注册的实现"。 */
    @Test
    void functionSelectMatchesByNameNotByRegistrationOrder() throws Exception {
        installFunctionBeans();

        byte[] content = write(new FunctionOnlyProbeRow(), new FunctionOnlyProbeRow());
        try (Workbook workbook = new XSSFWorkbook(new ByteArrayInputStream(content))) {
            Sheet dictSheet = workbook.getSheet("字典sheet");
            assertThat(dictSheet.getRow(0).getCell(0).getStringCellValue())
                    .as("必须使用 functionName 匹配到的实现").isEqualTo("研发部");
            assertThat(dictSheet.getRow(2).getCell(0).getStringCellValue()).isEqualTo("市场部");
        }
    }

    /**
     * xls 工作簿（HSSF）的下拉单元格必须保留下拉箭头。
     *
     * <p>POI 对 HSSF 与 XLSF 的箭头抑制语义相反：HSSF 只有显式关闭抑制才显示箭头，
     * 走错分支会让 xls 导出的下拉框在 Excel 中不可见。</p>
     */
    @Test
    void hssfWorkbookKeepsDropDownArrowVisible() throws Exception {
        installFunctionBeans();

        byte[] content = write(new SelectProbeRow(), new SelectProbeRow(), ExcelTypeEnum.XLS);
        try (Workbook workbook = new HSSFWorkbook(new ByteArrayInputStream(content))) {
            DataValidation validation = workbook.getSheet("数据").getDataValidations().get(0);
            assertThat(validation).isInstanceOf(HSSFDataValidation.class);
            assertThat(((HSSFDataValidation) validation).getSuppressDropDownArrow())
                    .as("HSSF 必须显式关闭箭头抑制").isFalse();
        }
    }

    /** 没有任何下拉列时不得创建字典 Sheet，也不得添加数据校验。 */
    @Test
    void headWithoutSelectColumnsWritesNoDictSheet() throws Exception {
        byte[] content = write(new PlainProbeRow(), new PlainProbeRow());
        try (Workbook workbook = new XSSFWorkbook(new ByteArrayInputStream(content))) {
            assertThat(workbook.getSheet("字典sheet")).isNull();
            assertThat(workbook.getSheet("数据").getDataValidations()).isEmpty();
        }
    }

    /** 注解的 dictType 与 functionName 同时为空时必须在构造期显式拒绝并指出字段名。 */
    @Test
    void blankSelectConfigurationIsRejectedWithFieldName() {
        assertThatThrownBy(() -> new SelectSheetWriteHandler(BlankSelectProbeRow.class))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("不能同时为空")
                .hasMessageContaining("status");
    }

    /** functionName 在容器内找不到实现时必须在构造期显式拒绝并指出名称。 */
    @Test
    void missingSelectFunctionIsRejectedWithFunctionName() {
        installFunctionBeans();

        assertThatThrownBy(() -> new SelectSheetWriteHandler(MissingFunctionProbeRow.class))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("未找到对应的 function(missing-probe)");
    }

    /** 容器里没有任何业务函数实现时同样按"未找到"拒绝，不得静默写入空下拉。 */
    @Test
    void missingSelectFunctionWithoutAnyBeanIsRejected() {
        context = new AnnotationConfigApplicationContext();
        context.refresh();
        new SpringUtil().setApplicationContext(context);

        assertThatThrownBy(() -> new SelectSheetWriteHandler(FunctionOnlyProbeRow.class))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("未找到对应的 function(probe-dept)");
    }

    /** 在真实 Spring 容器中注册两个业务函数实现，顺序上把不匹配的实现放在前面。 */
    private void installFunctionBeans() {
        context = new AnnotationConfigApplicationContext();
        context.registerBean("probeOtherFunction", ExcelColumnSelectFunction.class, OtherSelectFunction::new);
        context.registerBean("probeDeptFunction", ExcelColumnSelectFunction.class, DeptSelectFunction::new);
        context.refresh();
        new SpringUtil().setApplicationContext(context);
    }

    /** 用真实 FastExcel 写出流程驱动处理器，返回可被 POI 读回的字节。 */
    private static byte[] write(Object row, Object ignoredRow) throws Exception {
        return write(row, ignoredRow, ExcelTypeEnum.XLSX);
    }

    /**
     * 用真实 FastExcel 写出流程驱动处理器。
     *
     * @param row 表头与数据行共用同一夹具类型
     * @param ignoredRow 与 {@code row} 同类型的第二行数据，用于让字典 Sheet 产生多行
     * @param excelType 工作簿类型，决定走 HSSF 还是 XLSX 分支
     * @return 写出后的工作簿字节
     * @throws Exception 写出失败时抛出，表示夹具本身不可用
     */
    private static byte[] write(Object row, Object ignoredRow, ExcelTypeEnum excelType) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        FastExcelFactory.write(output, row.getClass())
                .excelType(excelType)
                .registerWriteHandler(new SelectSheetWriteHandler(row.getClass()))
                .sheet("数据")
                .doWrite(List.of(row, ignoredRow));
        return output.toByteArray();
    }

    /** 构造字典数据夹具。 */
    private static DictDataRespDTO dictData(String label, String value) {
        DictDataRespDTO data = new DictDataRespDTO();
        data.setLabel(label);
        data.setValue(value);
        return data;
    }

    /**
     * 名称匹配但非目标实现的业务函数，用于证明按名称匹配。
     *
     * @author shady2713
     */
    public static class OtherSelectFunction implements ExcelColumnSelectFunction {

        /** @return 实现名称 */
        @Override
        public String getName() {
            return "probe-other";
        }

        /** @return 其它下拉候选，不得被目标字段采用 */
        @Override
        public List<String> getOptions() {
            return List.of("DUMMY-OTHER");
        }
    }

    /**
     * 目标业务函数实现，提供部门下拉候选。
     *
     * @author shady2713
     */
    public static class DeptSelectFunction implements ExcelColumnSelectFunction {

        /** @return 实现名称 */
        @Override
        public String getName() {
            return "probe-dept";
        }

        /** @return 部门下拉候选 */
        @Override
        public List<String> getOptions() {
            return FUNCTION_OPTIONS;
        }
    }

    /**
     * 完整下拉夹具：覆盖静态常量、transient、忽略注解、显式列索引与缺省列索引。
     *
     * @author shady2713
     */
    public static class SelectProbeRow {

        /** 静态常量字段，FastExcel 会忽略，处理器也不得占用列序号。 */
        private static final String CONSTANT = "DUMMY-CONSTANT";
        /** transient 字段，处理器必须跳过。 */
        private transient String cached;
        /** 显式忽略的字段，即使带下拉注解也不得注册下拉。 */
        @ExcelIgnore
        @ExcelColumnSelect(dictType = "sys_select_ignored")
        private String ignored;
        /** 字典下拉列，显式声明第 3 列。 */
        @ExcelProperty(value = "状态", index = 3)
        @ExcelColumnSelect(dictType = DICT_TYPE)
        private String status;
        /** 业务函数下拉列，未声明 index，顺延到第 4 列。 */
        @ExcelProperty("部门")
        @ExcelColumnSelect(functionName = "probe-dept")
        private String dept;

        /** @return 被忽略的字段 */
        public String getIgnored() {
            return ignored;
        }

        /** @param ignored 被忽略的字段 */
        public void setIgnored(String ignored) {
            this.ignored = ignored;
        }

        /** @return 状态 */
        public String getStatus() {
            return status;
        }

        /** @param status 状态 */
        public void setStatus(String status) {
            this.status = status;
        }

        /** @return 部门 */
        public String getDept() {
            return dept;
        }

        /** @param dept 部门 */
        public void setDept(String dept) {
            this.dept = dept;
        }
    }

    /**
     * 类级忽略未注解字段的下拉夹具。
     *
     * @author shady2713
     */
    @ExcelIgnoreUnannotated
    public static class UnannotatedProbeRow {

        /** 没有 ExcelProperty，必须被类级注解整列跳过。 */
        @ExcelColumnSelect(dictType = DICT_TYPE)
        private String noProperty;
        /** 显式声明导出列，下拉必须落在第 0 列。 */
        @ExcelProperty("状态")
        @ExcelColumnSelect(dictType = DICT_TYPE)
        private String status;

        /** @return 未声明的字段 */
        public String getNoProperty() {
            return noProperty;
        }

        /** @param noProperty 未声明的字段 */
        public void setNoProperty(String noProperty) {
            this.noProperty = noProperty;
        }

        /** @return 状态 */
        public String getStatus() {
            return status;
        }

        /** @param status 状态 */
        public void setStatus(String status) {
            this.status = status;
        }
    }

    /**
     * 只使用业务函数下拉的夹具。
     *
     * @author shady2713
     */
    public static class FunctionOnlyProbeRow {

        /** 业务函数下拉列。 */
        @ExcelProperty("部门")
        @ExcelColumnSelect(functionName = "probe-dept")
        private String dept;

        /** @return 部门 */
        public String getDept() {
            return dept;
        }

        /** @param dept 部门 */
        public void setDept(String dept) {
            this.dept = dept;
        }
    }

    /**
     * 不含任何下拉注解的普通导出夹具。
     *
     * @author shady2713
     */
    public static class PlainProbeRow {

        /** 普通文本列。 */
        @ExcelProperty("名称")
        private String name;

        /** @return 名称 */
        public String getName() {
            return name;
        }

        /** @param name 名称 */
        public void setName(String name) {
            this.name = name;
        }
    }

    /**
     * dictType 与 functionName 都为空的非法夹具。
     *
     * @author shady2713
     */
    public static class BlankSelectProbeRow {

        /** 非法下拉字段，两个数据源属性都未填写。 */
        @ExcelProperty("状态")
        @ExcelColumnSelect
        private String status;

        /** @return 状态 */
        public String getStatus() {
            return status;
        }

        /** @param status 状态 */
        public void setStatus(String status) {
            this.status = status;
        }
    }

    /**
     * functionName 在容器内不存在的非法夹具。
     *
     * @author shady2713
     */
    public static class MissingFunctionProbeRow {

        /** 指向不存在实现的业务函数下拉字段。 */
        @ExcelProperty("部门")
        @ExcelColumnSelect(functionName = "missing-probe")
        private String dept;

        /** @return 部门 */
        public String getDept() {
            return dept;
        }

        /** @param dept 部门 */
        public void setDept(String dept) {
            this.dept = dept;
        }
    }

}
