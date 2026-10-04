package com.basicframework.framework.excel.core.util;

import cn.idev.excel.annotation.ExcelProperty;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 Excel 导入导出工具类的响应写出与上传读取契约。
 *
 * <p>该工具类是所有导入导出接口的公共出口，行为直接决定浏览器能否正确下载与回传文件。
 * 这里用真实 FastExcel 写出与读回，锁定三项契约：响应体必须是可被同一工具读回的真实
 * Excel 内容；下载头与内容类型按约定设置（中文文件名经 UTF-8 百分号编码）；
 * 导出空列表时仍产出只有表头的合法文件，读取后得到空列表而不是异常。</p>
 *
 * <p>写出顺序也有业务含义：响应头在内容写出之后设置，一旦写出失败就不会提前改动响应，
 * 因此用例同时核对写出成功后的响应状态与载荷一致性。</p>
 *
 * @author shady2713
 */
class ExcelUtilsTest {

    /** 导出后能被同一工具读回的表格内容，说明写出的是真实 Excel 而非占位字节。 */
    @Test
    void writeProducesReadableWorkbookWithDownloadHeaders() throws IOException {
        MockHttpServletResponse response = new MockHttpServletResponse();
        List<ExportRow> rows = List.of(row(1L, "第一条"), row(2L, "第二条"));

        ExcelUtils.write(response, "导出结果.xlsx", "数据", ExportRow.class, rows);

        assertThat(response.getHeader("Content-Disposition")).isEqualTo(
                "attachment;filename=" + URLEncoder.encode("导出结果.xlsx", StandardCharsets.UTF_8));
        assertThat(response.getContentType()).isEqualTo("application/vnd.ms-excel;charset=UTF-8");

        List<ExportRow> readBack = ExcelUtils.read(upload(response.getContentAsByteArray()), ExportRow.class);
        assertThat(readBack).hasSize(2);
        assertThat(readBack.get(0).getId()).isEqualTo(1L);
        assertThat(readBack.get(0).getName()).isEqualTo("第一条");
        assertThat(readBack.get(1).getId()).isEqualTo(2L);
        assertThat(readBack.get(1).getName()).isEqualTo("第二条");
    }

    /** 导出空列表仍产出合法文件：读取得到空列表，表头不因无数据而缺失。 */
    @Test
    void writeWithEmptyDataStillProducesValidWorkbook() throws IOException {
        MockHttpServletResponse response = new MockHttpServletResponse();

        ExcelUtils.write(response, "empty.xlsx", "数据", ExportRow.class, Collections.emptyList());

        assertThat(response.getContentAsByteArray()).as("空数据也必须写出文件内容").isNotEmpty();
        assertThat(ExcelUtils.read(upload(response.getContentAsByteArray()), ExportRow.class)).isEmpty();
    }

    /**
     * 工具类未声明私有构造，实例化不得改变静态导入导出入口的行为。
     *
     * <p>该类没有实例状态，构造方法属于真实可调用面；断言实例化后静态入口仍按同一规则工作，
     * 防止未来把共享状态放进实例，导致按实例使用与静态入口读到不同配置。</p>
     */
    @Test
    void instantiationKeepsStaticEntryBehaviour() throws IOException {
        new ExcelUtils();

        MockHttpServletResponse response = new MockHttpServletResponse();
        ExcelUtils.write(response, "instantiated.xlsx", "数据", ExportRow.class, List.of(row(3L, "实例化后")));

        assertThat(ExcelUtils.read(upload(response.getContentAsByteArray()), ExportRow.class))
                .singleElement().extracting(ExportRow::getName).isEqualTo("实例化后");
    }

    /** 构造一行导出数据。 */
    private static ExportRow row(Long id, String name) {
        ExportRow row = new ExportRow();
        row.setId(id);
        row.setName(name);
        return row;
    }

    /** 把导出的字节包装成上传文件，模拟浏览器回传。 */
    private static MultipartFile upload(byte[] content) {
        return new MockMultipartFile("file", "data.xlsx", "application/vnd.ms-excel", content);
    }

    /**
     * 导入导出表头夹具，字段与列名一一对应。
     *
     * @author shady2713
     */
    public static class ExportRow {

        /** 编号列。 */
        @ExcelProperty("编号")
        private Long id;

        /** 名称列。 */
        @ExcelProperty("名称")
        private String name;

        /**
         * 获取编号。
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
    }

}
