package com.basicframework.framework.xss.core.filter;

import com.basicframework.framework.xss.core.clean.JsoupXssCleaner;
import com.basicframework.framework.xss.core.clean.XssCleaner;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 XSS 请求包装类对参数、属性与查询串的真实清理行为。
 *
 * <p>过滤器把原始请求包装成本类之后，业务代码只应看到清理后的值；包装遗漏任何一个取值入口
 * 都会留下注入通道：参数漏清理会污染入库内容，属性漏清理会污染审计与权限判断，
 * 查询串漏清理会污染日志与回跳地址。因此用例用真实 {@link JsoupXssCleaner} 断言每个入口的返回值，
 * 同时锁定"非字符串属性原样返回""缺失参数返回 null"等不得被清理逻辑改变的行为。</p>
 *
 * @author shady2713
 */
class XssRequestWrapperTest {

    /** 真实清理器，行为与生产注册的 {@code JsoupXssCleaner} 一致。 */
    private final XssCleaner cleaner = new JsoupXssCleaner();

    /**
     * 参数 Map 中每个值都必须被清理，且返回的是清理后的原始数组。
     *
     * <p>真实副作用：实现直接改写从原始请求取到的值数组，因此原始请求的参数也被改动。
     * 已转义内容重复清理时结果保持不变（Jsoup 先解析实体再按同一规则转义），即清理是幂等的，
     * 但"重复调用会再次改写原始请求"这一点仍成立，用例按真实行为断言并作为待处理发现记录。</p>
     */
    @Test
    void getParameterMapCleansEveryValueAndMutatesSourceInPlace() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addParameter("name", "DUMMY<script>alert(1)</script>");
        request.addParameter("tags", "safe", "<script>alert(1)</script>DUMMY");
        request.addParameter("html", "a&b<c");

        Map<String, String[]> cleaned = new XssRequestWrapper(request, cleaner).getParameterMap();

        assertThat(cleaned.get("name")).containsExactly("DUMMY");
        assertThat(cleaned.get("tags")).as("同名参数的每个值都必须清理").containsExactly("safe", "DUMMY");
        assertThat(cleaned.get("html")).containsExactly("a&amp;b");
        assertThat(request.getParameterMap().get("name"))
                .as("真实副作用：原始请求的参数数组被就地改写").containsExactly("DUMMY");
        assertThat(new XssRequestWrapper(request, cleaner).getParameterMap().get("html"))
                .as("重复清理必须幂等，不得二次转义").containsExactly("a&amp;b");
    }

    /** 单个参数的取值入口必须返回清理后的数组，缺失参数返回 null。 */
    @Test
    void getParameterValuesCleansAndKeepsMissingAsNull() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addParameter("name", "<img src=x onerror=alert(1)>");

        XssRequestWrapper wrapper = new XssRequestWrapper(request, cleaner);

        assertThat(wrapper.getParameterValues("name")).containsExactly("<img>");
        assertThat(wrapper.getParameterValues("absent")).as("缺失参数必须返回 null 而不是空数组").isNull();
    }

    /** 字符串属性必须清理，非字符串属性原样返回。 */
    @Test
    void getAttributeCleansStringsAndKeepsOtherTypes() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setAttribute("note", "DUMMY<script>alert(1)</script>");
        request.setAttribute("count", 3);
        request.setAttribute("absent", null);

        XssRequestWrapper wrapper = new XssRequestWrapper(request, cleaner);

        assertThat(wrapper.getAttribute("note")).isEqualTo("DUMMY");
        assertThat(wrapper.getAttribute("count")).as("非字符串属性不得被改写").isEqualTo(3);
        assertThat(wrapper.getAttribute("absent")).isNull();
    }

    /** 查询串必须清理，缺失时返回 null。 */
    @Test
    void getQueryStringCleansAndKeepsMissingAsNull() {
        MockHttpServletRequest withQuery = new MockHttpServletRequest();
        withQuery.setQueryString("redirect=<script>alert(1)</script>DUMMY");

        assertThat(new XssRequestWrapper(withQuery, cleaner).getQueryString()).isEqualTo("redirect=DUMMY");
        assertThat(new XssRequestWrapper(new MockHttpServletRequest(), cleaner).getQueryString())
                .as("无查询串必须返回 null").isNull();
    }

    /** 单参数与请求头入口同样必须清理，缺失时返回 null。 */
    @Test
    void getParameterAndHeaderAreCleaned() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addParameter("name", "DUMMY<script>alert(1)</script>");
        request.addHeader("X-Note", "<a href=\"javascript:alert(1)\">x</a>");

        XssRequestWrapper wrapper = new XssRequestWrapper(request, cleaner);

        assertThat(wrapper.getParameter("name")).isEqualTo("DUMMY");
        assertThat(wrapper.getParameter("absent")).isNull();
        assertThat(wrapper.getHeader("X-Note")).isEqualTo("<a>x</a>");
        assertThat(wrapper.getHeader("X-Absent")).isNull();
    }

}
