package com.basicframework.module.system.controller.admin.dict.vo.type;

import cn.idev.excel.annotation.ExcelIgnoreUnannotated;
import cn.idev.excel.annotation.ExcelProperty;
import com.basicframework.framework.common.biz.system.dict.DictDataCommonApi;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.dict.core.DictFrameworkUtils;
import com.basicframework.framework.excel.core.util.ExcelUtils;
import com.basicframework.module.system.controller.admin.dict.DictTypeController;
import com.basicframework.module.system.dal.dataobject.dict.DictTypeDO;
import com.basicframework.module.system.enums.DictTypeConstants;
import com.basicframework.module.system.service.dict.DictTypeService;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 运行期验证字典类型导出列标题这一本地契约的真实产出与区分力。
 *
 * <p>被测对象是 {@link DictTypeRespVO} 上真实生效的 {@code @ExcelProperty} 列标题。驱动方式是
 * **真实导出调用**：走生产 {@link DictTypeController#export} 的同一条路径（同样经过
 * {@link ExcelUtils#write} 的写出、{@code LongStringConverter} 注册与写处理器），再用 POI
 * 读回生成的工作簿第一行。因此断言锁的是消费方真正下载到的表头文字，而不是注解里的字面量。</p>
 *
 * <p>判别性由同文件内的**上游措辞变体** {@link UpstreamWordingDictTypeRespVO} 提供：它与被测
 * 类字段一一对应，只把编号列标题改成上游措辞「字典主键」。同一个探针函数对两者读出的表头不同，
 * 且对变体执行与生产相同的断言会失败。若有人把生产注解改回上游措辞，本类对生产导出的断言立即
 * 失败，来源回退不会被静默吸收。</p>
 *
 * <p>字典框架是导出 {@code status} 列的前置依赖：{@code DictConvert} 通过
 * {@link DictFrameworkUtils} 解析标签，因此用例注入最小字典数据并清理静态缓存，避免把
 * 「转换器未初始化」误读成「表头不对」。</p>
 *
 * @author 契约与出口方向执行代理
 */
class DictTypeRespVOExportHeaderRuntimeTest {

    /** 本地契约确认的编号列标题。 */
    private static final String LOCAL_ID_HEADER = "字典编号";

    /** 上游措辞，用于负对照；它必须不出现在本地导出的表头里。 */
    private static final String UPSTREAM_ID_HEADER = "字典主键";

    /** 被测控制器，走生产导出入口。 */
    private DictTypeController controller;

    /** 字典类型服务替身，只负责提供真实导出走到的数据来源。 */
    private DictTypeService dictTypeService;

    /** 为每个用例重新装配控制器与字典框架，避免静态缓存掩盖真实转换行为。 */
    @BeforeEach
    void setUp() {
        controller = new DictTypeController();
        dictTypeService = mock(DictTypeService.class);
        ReflectionTestUtils.setField(controller, "dictTypeService", dictTypeService);
        when(dictTypeService.getDictTypePage(any()))
                .thenReturn(new PageResult<>(List.of(dictType(1024L, "sys_common_sex", "性别", 0)), 1L));
        DictFrameworkUtils.init(statusOnlyDictApi());
        DictFrameworkUtils.clearCache();
    }

    /** 清理静态字典缓存，避免把本用例的字典替身带出。 */
    @AfterEach
    void tearDown() {
        DictFrameworkUtils.clearCache();
    }

    /**
     * 真实导出产出的表头必须是本地措辞，且必须与上游措辞不同。
     *
     * <p>这是本类的核心读数：读的是下载得到的字节，不是注解常量。</p>
     */
    @Test
    void productionExportWritesLocalIdHeader() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        controller.export(response, new DictTypePageReqVO());

        List<String> headers = readHeaders(response.getContentAsByteArray());
        assertThat(headers).as("编号列标题必须是本地确认的措辞").contains(LOCAL_ID_HEADER);
        assertThat(headers).as("上游措辞不得出现在本地导出中").doesNotContain(UPSTREAM_ID_HEADER);
        assertThat(headers).as("表头顺序与字段声明顺序一致").containsExactly(
                LOCAL_ID_HEADER, "字典名称", "字典类型", "状态");
    }

    /**
     * 同一导出路径、同一探针作用到上游措辞变体时，读数必须不同，断言对变体失败。
     *
     * <p>这证明上一条断言读的是实际导出结果，而不是「表头里恰好有某个字符串就算通过」。</p>
     */
    @Test
    void upstreamWordingVariantProducesDifferentHeaderSoTheAssertionDiscriminates() throws Exception {
        List<String> variantHeaders = variantExportHeaders();

        assertThat(variantHeaders).as("变体导出必须能读出上游措辞").contains(UPSTREAM_ID_HEADER);
        assertThat(variantHeaders).as("变体与本地读数必须不同").isNotEqualTo(productionExportHeaders());
        assertThatThrownBy(() -> assertThat(variantHeaders)
                .as("编号列标题必须是本地确认的措辞").contains(LOCAL_ID_HEADER))
                .as("同一断言作用在契约违反变体上必须失败")
                .isInstanceOf(AssertionError.class);
    }

    /**
     * 导出内容必须是真实可解析的表格，且数据行落在本地标题之下。
     *
     * <p>若导出链路退化为空字节或非 Excel 内容，表头断言会以难以定位的方式失败；这里直接核对
     * 首行表头与数据行编号，锁定“表头与数据同属一次真实导出”。</p>
     */
    @Test
    void exportedWorkbookKeepsDataRowUnderTheLocalHeader() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        controller.export(response, new DictTypePageReqVO());

        try (Workbook workbook = openWorkbook(response.getContentAsByteArray())) {
            Sheet sheet = workbook.getSheetAt(0);
            assertThat(sheet.getRow(0).getCell(0).getStringCellValue())
                    .as("表头首列必须是本地编号列").isEqualTo(LOCAL_ID_HEADER);
            Row dataRow = sheet.getRow(1);
            assertThat(dataRow).as("必须存在真实数据行").isNotNull();
            assertThat(cellText(dataRow.getCell(0))).as("编号列必须导出真实编号").isEqualTo("1024");
            assertThat(cellText(dataRow.getCell(1))).isEqualTo("性别");
            assertThat(cellText(dataRow.getCell(2))).isEqualTo("sys_common_sex");
            assertThat(cellText(dataRow.getCell(3))).as("状态列必须按字典解析出标签").isEqualTo("开启");
        }
    }

    /**
     * 走生产导出入口导出并读回第一行表头。
     *
     * @return 真实导出得到的表头文字，按列顺序
     */
    private List<String> productionExportHeaders() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        controller.export(response, new DictTypePageReqVO());
        return readHeaders(response.getContentAsByteArray());
    }

    /**
     * 用同一条生产写出工具导出契约违反变体并读回第一行表头。
     *
     * <p>与生产导出共用 {@link ExcelUtils#write}、写出处理器与序列化器，唯一的差别是列标题，
     * 因此两条读数之差只能归因于列标题本身。</p>
     *
     * @return 变体导出得到的表头文字，按列顺序
     */
    private List<String> variantExportHeaders() throws IOException {
        MockHttpServletResponse response = new MockHttpServletResponse();
        List<UpstreamWordingDictTypeRespVO> rows = new ArrayList<>();
        UpstreamWordingDictTypeRespVO row = new UpstreamWordingDictTypeRespVO();
        row.setId(1024L);
        row.setName("性别");
        row.setType("sys_common_sex");
        row.setStatus(0);
        rows.add(row);
        ExcelUtils.write(response, "字典类型.xls", "数据", UpstreamWordingDictTypeRespVO.class, rows);
        return readHeaders(response.getContentAsByteArray());
    }

    /**
     * 用 POI 打开生产写出的字节，格式由内容自识别，不假定 xls 还是 xlsx。
     *
     * @param content 导出响应体
     * @return 可解析的工作簿
     */
    private static Workbook openWorkbook(byte[] content) throws IOException {
        return WorkbookFactory.create(new ByteArrayInputStream(content));
    }

    /**
     * 读出工作簿第一行（表头）的全部单元格文字。
     *
     * @param content 导出响应体
     * @return 表头文字，按列顺序；无表头时返回空列表
     */
    private static List<String> readHeaders(byte[] content) throws IOException {
        try (Workbook workbook = openWorkbook(content)) {
            Row header = workbook.getSheetAt(0).getRow(0);
            if (header == null) {
                return List.of();
            }
            List<String> headers = new ArrayList<>();
            for (int index = 0; index < header.getLastCellNum(); index++) {
                headers.add(cellText(header.getCell(index)));
            }
            return headers;
        }
    }

    /**
     * 读取单元格文字，数值型编号按整数文本返回。
     *
     * @param cell 目标单元格，可能为空
     * @return 单元格文字；单元格为空时返回空串
     */
    private static String cellText(Cell cell) {
        if (cell == null) {
            return "";
        }
        return cell.getCellType() == org.apache.poi.ss.usermodel.CellType.NUMERIC
                ? Long.toString((long) cell.getNumericCellValue()) : cell.getStringCellValue();
    }

    /**
     * 只登记本用例用到的状态字典，使 {@code DictConvert} 能把 {@code 0} 解析为「开启」。
     *
     * @return 最小字典数据 API 替身
     */
    private static DictDataCommonApi statusOnlyDictApi() {
        List<com.basicframework.framework.common.biz.system.dict.dto.DictDataRespDTO> data = List.of(
                dictData("0", "开启"), dictData("1", "关闭"));
        return type -> DictTypeConstants.COMMON_STATUS.equals(type) ? data : List.of();
    }

    /**
     * 构造一条字典数据。
     *
     * @param value 字典值
     * @param label 字典标签
     * @return 字典数据
     */
    private static com.basicframework.framework.common.biz.system.dict.dto.DictDataRespDTO dictData(
            String value, String label) {
        com.basicframework.framework.common.biz.system.dict.dto.DictDataRespDTO dto =
                new com.basicframework.framework.common.biz.system.dict.dto.DictDataRespDTO();
        dto.setDictType(DictTypeConstants.COMMON_STATUS);
        dto.setValue(value);
        dto.setLabel(label);
        dto.setStatus(0);
        return dto;
    }

    /**
     * 构造导出用的字典类型持久对象。
     *
     * @param id 编号
     * @param type 字典类型编码
     * @param name 字典名称
     * @param status 状态，0 表示开启
     * @return 字典类型持久对象
     */
    private static DictTypeDO dictType(Long id, String type, String name, Integer status) {
        DictTypeDO dictType = new DictTypeDO();
        dictType.setId(id);
        dictType.setType(type);
        dictType.setName(name);
        dictType.setStatus(status);
        return dictType;
    }

    /**
     * 契约违反变体：字段与被测类一一对应，仅把编号列标题改为上游措辞。
     *
     * <p>它只用于负对照，不参与任何生产路径；若生产注解被改回上游措辞，针对生产导出的表头断言
     * 会立刻失败。</p>
     *
     * @author 契约与出口方向执行代理
     */
    @ExcelIgnoreUnannotated
    public static class UpstreamWordingDictTypeRespVO {

        /** 编号列，标题故意采用上游措辞。 */
        @ExcelProperty(UPSTREAM_ID_HEADER)
        private Long id;

        /** 名称列。 */
        @ExcelProperty("字典名称")
        private String name;

        /** 类型列。 */
        @ExcelProperty("字典类型")
        private String type;

        /** 状态列，与被测类保持一致，避免变体在列集合上产生额外差异。 */
        @ExcelProperty("状态")
        private Integer status;

        /**
         * 读取编号，供负对照导出使用。
         *
         * @return 编号
         */
        public Long getId() {
            return id;
        }

        /**
         * 设置编号。
         *
         * @param id 编号
         */
        public void setId(Long id) {
            this.id = id;
        }

        /**
         * 读取名称。
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
         * 读取字典类型。
         *
         * @return 字典类型
         */
        public String getType() {
            return type;
        }

        /**
         * 设置字典类型。
         *
         * @param type 字典类型
         */
        public void setType(String type) {
            this.type = type;
        }

        /**
         * 读取状态。
         *
         * @return 状态
         */
        public Integer getStatus() {
            return status;
        }

        /**
         * 设置状态。
         *
         * @param status 状态
         */
        public void setStatus(Integer status) {
            this.status = status;
        }

    }

}