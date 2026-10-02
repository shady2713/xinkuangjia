package com.basicframework.framework.xss.core.filter;

import com.basicframework.framework.xss.core.clean.XssCleaner;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Xss 请求 Wrapper
 *
 * @author 李杰
 */
public class XssRequestWrapper extends HttpServletRequestWrapper {

    private final XssCleaner xssCleaner;

    /**
     * 创建 XssRequestWrapper，并初始化所需依赖与配置。
     *
     * @param request HTTP 请求
     * @param xssCleaner xssCleaner参数
     */
    public XssRequestWrapper(HttpServletRequest request, XssCleaner xssCleaner) {
        super(request);
        this.xssCleaner = xssCleaner;
    }

    // ============================ parameter ============================
    /**
     * 获取参数Map。
     *
     * @return 查询或转换后的结果
     */
    @Override
    public Map<String, String[]> getParameterMap() {
        Map<String, String[]> map = new LinkedHashMap<>();
        Map<String, String[]> parameters = super.getParameterMap();
        for (Map.Entry<String, String[]> entry : parameters.entrySet()) {
            String[] values = entry.getValue();
            for (int i = 0; i < values.length; i++) {
                values[i] = xssCleaner.clean(values[i]);
            }
            map.put(entry.getKey(), values);
        }
        return map;
    }

    /**
     * 获取参数Values。
     *
     * @param name name 参数
     * @return 查询或转换后的结果
     */
    @Override
    public String[] getParameterValues(String name) {
        String[] values = super.getParameterValues(name);
        if (values == null) {
            return null;
        }
        int count = values.length;
        String[] encodedValues = new String[count];
        for (int i = 0; i < count; i++) {
            encodedValues[i] = xssCleaner.clean(values[i]);
        }
        return encodedValues;
    }

    /**
     * 获取参数。
     *
     * @param name name 参数
     * @return 查询或转换后的结果
     */
    @Override
    public String getParameter(String name) {
        String value = super.getParameter(name);
        if (value == null) {
            return null;
        }
        return xssCleaner.clean(value);
    }

    // ============================ attribute ============================
    /**
     * 获取属性。
     *
     * @param name name 参数
     * @return 查询或转换后的结果
     */
    @Override
    public Object getAttribute(String name) {
        Object value = super.getAttribute(name);
        if (value instanceof String) {
            return xssCleaner.clean((String) value);
        }
        return value;
    }

    // ============================ header ============================
    /**
     * 获取Header。
     *
     * @param name name 参数
     * @return 查询或转换后的结果
     */
    @Override
    public String getHeader(String name) {
        String value = super.getHeader(name);
        if (value == null) {
            return null;
        }
        return xssCleaner.clean(value);
    }

    // ============================ queryString ============================
    /**
     * 获取QueryString。
     *
     * @return 查询或转换后的结果
     */
    @Override
    public String getQueryString() {
        String value = super.getQueryString();
        if (value == null) {
            return null;
        }
        return xssCleaner.clean(value);
    }

}
