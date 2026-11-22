package com.basicframework.framework.excel.core.util;

import cn.idev.excel.FastExcelFactory;
import cn.idev.excel.converters.Converter;
import cn.idev.excel.converters.longconverter.LongStringConverter;
import cn.idev.excel.enums.CellDataTypeEnum;
import cn.idev.excel.metadata.GlobalConfiguration;
import cn.idev.excel.metadata.data.WriteCellData;
import cn.idev.excel.metadata.property.ExcelContentProperty;
import com.basicframework.framework.excel.core.handler.ColumnWidthMatchStyleStrategy;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Excel 导入导出工具类，统一封装 FastExcel 的响应写出和文件读取逻辑。
 *
 * @author 李杰
 */
public class ExcelUtils {

    /**
     * 将列表以 Excel 响应给前端
     *
     * @param response  响应
     * @param filename  文件名
     * @param sheetName Excel sheet 名
     * @param head      Excel 表头类型
     * @param data      数据列表
     * @param <T>       泛型，保证 head 和 data 类型的一致性
     * @throws IOException 写入失败的情况
     */
    public static <T> void write(HttpServletResponse response, String filename, String sheetName,
                                 Class<T> head, List<T> data) throws IOException {
        // 在写出响应流前先设置响应头，避免数据量超过 Servlet 缓冲区提交后响应头被静默丢弃。
        response.addHeader("Content-Disposition", "attachment;filename=" + URLEncoder.encode(filename, StandardCharsets.UTF_8));
        response.setContentType("application/vnd.ms-excel;charset=UTF-8");
        // 输出 Excel
        FastExcelFactory.write(response.getOutputStream(), head)
                .autoCloseStream(false) // 不要自动关闭，交给 Servlet 自己处理
                .registerWriteHandler(new ColumnWidthMatchStyleStrategy()) // 基于 column 长度，自动适配。最大 255 宽度
                .registerConverter(new LongPlainStringWriteConverter()) // 覆盖默认 LongNumberConverter 键，防止 64 位雪花主键丢失精度
                .registerConverter(new FormulaNeutralizingStringWriteConverter()) // 对公式引导字符前置单引号，防止 CSV/Excel 公式注入
                .sheet(sheetName).doWrite(data);
    }

    /**
     * 对以 {@code =}、{@code +}、{@code -}、{@code @}、制表符或回车符开头的字符串前置单引号，
     * 防止导出的电子表格在客户端打开时被当作公式执行。
     *
     * @param value 待写出的单元格文本
     * @return 安全转义后的文本（空值原样返回）
     */
    public static String neutralizeFormula(String value) {
        if (value == null || value.isEmpty()) {
            return value;
        }
        char first = value.charAt(0);
        if (first == '=' || first == '+' || first == '-' || first == '@' || first == '\t' || first == '\r') {
            return "'" + value;
        }
        return value;
    }

    /**
     * 从上传文件中读取 Excel 数据。
     *
     * @param file 上传的 Excel 文件
     * @param head Excel 表头类型
     * @param <T>  泛型，保证 head 和返回数据类型一致
     * @return Excel 数据列表
     * @throws IOException 读取上传文件流失败的情况
     */
    public static <T> List<T> read(MultipartFile file, Class<T> head) throws IOException {
        // 增加 try-with-resources 处理，兼容 Windows 场景
        try (InputStream inputStream = file.getInputStream()) {
            return FastExcelFactory.read(inputStream, head, null)
                    .autoCloseStream(false) // 不要自动关闭，交给 Servlet 自己处理
                    .doReadAllSync();
        }
    }

    /**
     * 将 {@link #supportExcelTypeKey()} 声明为 {@code null}，使 FastExcel 写出阶段真正覆盖默认的
     * {@code (Long.class, null)} 数值转换器，按完整十进制字符串写出 64 位整数。
     */
    private static final class LongPlainStringWriteConverter extends LongStringConverter {

        /**
         * 返回 {@code null} 以绑定 FastExcel 默认写出转换器映射键。
         *
         * @return 固定返回 {@code null}
         */
        @Override
        public CellDataTypeEnum supportExcelTypeKey() {
            return null;
        }

    }

    /**
     * 在写出字符串单元格前中和公式注入前缀，并覆盖 FastExcel 默认 {@code (String.class, null)} 转换器。
     */
    private static final class FormulaNeutralizingStringWriteConverter implements Converter<String> {

        /**
         * 声明支持的 Java 字段类型为 {@link String}。
         *
         * @return {@code String.class}
         */
        @Override
        public Class<?> supportJavaTypeKey() {
            return String.class;
        }

        /**
         * 返回 {@code null} 以绑定 FastExcel 默认写出字符串转换器映射键。
         *
         * @return 固定返回 {@code null}
         */
        @Override
        public CellDataTypeEnum supportExcelTypeKey() {
            return null;
        }

        /**
         * 将字符串值经过公式前缀中和后写入 Excel 单元格。
         *
         * @param value               字段字符串值
         * @param contentProperty     单元格元数据属性
         * @param globalConfiguration 全局导出配置
         * @return 处理后的文本单元格数据
         */
        @Override
        public WriteCellData<String> convertToExcelData(String value, ExcelContentProperty contentProperty,
                                                        GlobalConfiguration globalConfiguration) {
            return new WriteCellData<>(value == null ? "" : neutralizeFormula(value));
        }

    }

}
