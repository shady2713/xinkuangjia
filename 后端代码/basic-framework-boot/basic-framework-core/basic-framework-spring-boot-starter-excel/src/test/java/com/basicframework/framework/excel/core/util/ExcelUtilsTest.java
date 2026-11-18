package com.basicframework.framework.excel.core.util;

import cn.idev.excel.annotation.ExcelProperty;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockMultipartFile;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 {@link ExcelUtils} 的内存导出与导入往返一致性（含超 JS 安全整数精度的 Long 字段）。
 *
 * @author shady2713
 */
class ExcelUtilsTest {

    /**
     * 验证写出 Excel 响应流后再通过 {@link ExcelUtils#read} 读取可完整还原行数据与响应头。
     */
    @Test
    void writesAndReadsExcelRowsWithoutLosingLongPrecision() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        List<SampleExcelRow> rows = List.of(
                new SampleExcelRow(9007199254740993L, "研发部"),
                new SampleExcelRow(9007199254740995L, "平台部")
        );

        ExcelUtils.write(response, "部门导出.xlsx", "部门列表", SampleExcelRow.class, rows);

        assertThat(response.getHeader("Content-Disposition")).contains("attachment;filename=");
        assertThat(response.getContentType()).startsWith("application/vnd.ms-excel");

        MockMultipartFile uploadFile = new MockMultipartFile(
                "file", "部门导出.xlsx", response.getContentType(), response.getContentAsByteArray());
        List<SampleExcelRow> imported = ExcelUtils.read(uploadFile, SampleExcelRow.class);

        assertThat(imported).containsExactlyElementsOf(rows);
    }

    /**
     * 测试用 Excel 行模型。
     *
     * @author shady2713
     */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SampleExcelRow {

        @ExcelProperty("部门编号")
        private Long id;

        @ExcelProperty("部门名称")
        private String name;

    }

}
