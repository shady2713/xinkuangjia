package com.basicframework.framework.excel.core.convert;

import com.basicframework.framework.common.util.json.JsonUtils;
import cn.idev.excel.converters.Converter;
import cn.idev.excel.metadata.GlobalConfiguration;
import cn.idev.excel.metadata.data.WriteCellData;
import cn.idev.excel.metadata.property.ExcelContentProperty;

/**
 * Excel JSON 转换器。
 *
 * @author 李杰
 */
public class JsonConvert implements Converter<Object> {

    /**
     * 将字段对象序列化为 JSON 文本写入 Excel。
     *
     * @param value 字段值
     * @param contentProperty 字段内容属性
     * @param globalConfiguration FastExcel 全局配置
     * @return Excel 单元格写入数据
     */
    @Override
    public WriteCellData<String> convertToExcelData(Object value, ExcelContentProperty contentProperty,
                                                    GlobalConfiguration globalConfiguration) {
        // 生成 Excel 小表格
        return new WriteCellData<>(JsonUtils.toJsonString(value));
    }

}
