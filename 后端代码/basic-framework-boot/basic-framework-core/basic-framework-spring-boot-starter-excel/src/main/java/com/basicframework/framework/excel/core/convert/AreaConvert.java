package com.basicframework.framework.excel.core.convert;

import cn.hutool.core.convert.Convert;
import com.basicframework.framework.ip.core.Area;
import com.basicframework.framework.ip.core.utils.AreaUtils;
import cn.idev.excel.converters.Converter;
import cn.idev.excel.enums.CellDataTypeEnum;
import cn.idev.excel.metadata.GlobalConfiguration;
import cn.idev.excel.metadata.data.ReadCellData;
import cn.idev.excel.metadata.property.ExcelContentProperty;
import lombok.extern.slf4j.Slf4j;

/**
 * Excel 数据地区转换器
 *
 * @author 李杰
 */
@Slf4j
public class AreaConvert implements Converter<Object> {

    /**
     * 返回当前转换器支持的 Java 数据类型。
     *
     * @return 方法处理结果
     */
    @Override
    public Class<?> supportJavaTypeKey() {
        throw new UnsupportedOperationException("暂不支持，也不需要");
    }

    /**
     * 返回当前转换器支持的 Excel 数据类型。
     *
     * @return 方法处理结果
     */
    @Override
    public CellDataTypeEnum supportExcelTypeKey() {
        throw new UnsupportedOperationException("暂不支持，也不需要");
    }

    /**
     * 将 Excel 单元格内容转换为 Java 数据。
     *
     * @param readCellData readCellData 参数
     * @param contentProperty contentProperty 参数
     * @param globalConfiguration globalConfiguration 参数
     * @return 查询或转换后的结果
     */
    @Override
    public Object convertToJavaData(ReadCellData<?> readCellData, ExcelContentProperty contentProperty,
                                    GlobalConfiguration globalConfiguration) {
        // 解析地区编号
        String label = readCellData.getStringValue();
        Area area = AreaUtils.parseArea(label);
        if (area == null) {
            log.error("[convertToJavaData][label({}) 解析不掉]", label);
            return null;
        }
        // 将 value 转换成对应的属性
        Class<?> fieldClazz = contentProperty.getField().getType();
        return Convert.convert(fieldClazz, area.getId());
    }

}
