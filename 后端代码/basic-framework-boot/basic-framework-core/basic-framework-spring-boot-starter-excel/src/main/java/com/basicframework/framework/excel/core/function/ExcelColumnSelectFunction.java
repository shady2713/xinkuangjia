package com.basicframework.framework.excel.core.function;

import java.util.List;

/**
 * Excel 列下拉数据源获取接口
 *
 * <p>
 * 除字典数据外，部分下拉数据可能来自业务服务，因此提供扩展接口供业务方注册自定义数据源。
 *
 * @author 李杰
 */
public interface ExcelColumnSelectFunction {

    /**
     * 获得方法名称
     *
     * @return 方法名称
     */
    String getName();

    /**
     * 获得列下拉数据源
     *
     * @return 下拉数据源
     */
    List<String> getOptions();

}
