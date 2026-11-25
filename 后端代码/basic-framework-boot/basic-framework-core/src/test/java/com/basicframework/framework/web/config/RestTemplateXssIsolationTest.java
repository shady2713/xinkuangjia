package com.basicframework.framework.web.config;

import com.basicframework.framework.jackson.config.BasicFrameworkJacksonAutoConfiguration;
import com.basicframework.framework.xss.config.XssProperties;
import com.basicframework.framework.xss.core.clean.JsoupXssCleaner;
import com.basicframework.framework.xss.core.json.XssStringJsonDeserializer;
import com.fasterxml.jackson.databind.Module;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.module.SimpleModule;
import lombok.Data;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.mock.http.MockHttpInputMessage;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 验证 {@link BasicFrameworkWebAutoConfiguration#restTemplate} 与 MVC 全局 XSS 反序列化器的隔离性。
 *
 * @author shady
 */
class RestTemplateXssIsolationTest {

    /**
     * 验证处于 HTTP 请求上下文中时，RestTemplate 不会清洗外部 JSON 字符串且不篡改原 MVC 转换器。
     */
    @Test
    @SuppressWarnings("unchecked")
    void restTemplateIsolatesOutboundMapperWithoutMutatingMvcConverter() throws Exception {
        Module timestampModule = new BasicFrameworkJacksonAutoConfiguration().timestampSupportModuleBean();
        SimpleModule xssModule = new SimpleModule();
        xssModule.addDeserializer(String.class, new XssStringJsonDeserializer(
                new XssProperties(), new AntPathMatcher(), new JsoupXssCleaner()));
        ObjectMapper mvcMapper = new ObjectMapper().registerModules(timestampModule, xssModule);
        MappingJackson2HttpMessageConverter mvcConverter = new MappingJackson2HttpMessageConverter(mvcMapper);

        ObjectProvider<Module> moduleProvider = mock(ObjectProvider.class);
        when(moduleProvider.getIfAvailable()).thenReturn(timestampModule);
        RestTemplate restTemplate = new BasicFrameworkWebAutoConfiguration().restTemplate(
                new RestTemplateBuilder().messageConverters(mvcConverter), moduleProvider);

        MappingJackson2HttpMessageConverter outboundConverter = findJacksonConverter(restTemplate);
        assertThat(outboundConverter).isNotNull().isNotSameAs(mvcConverter);

        String rawPayload = "{\"token\":\"a&b<script>alert(1)</script>\","
                + "\"url\":\"https://a.test?x=1&y=2\",\"ignored\":123,\"createdAt\":1700000000000}";
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/admin-api/system/demo");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        try {
            ExternalPayload outbound = (ExternalPayload) outboundConverter.read(
                    ExternalPayload.class,
                    new MockHttpInputMessage(rawPayload.getBytes(StandardCharsets.UTF_8)));
            assertThat(outbound.getToken()).isEqualTo("a&b<script>alert(1)</script>");
            assertThat(outbound.getUrl()).isEqualTo("https://a.test?x=1&y=2");
            assertThat(outbound.getCreatedAt()).isEqualTo(
                    LocalDateTime.ofInstant(Instant.ofEpochMilli(1700000000000L), ZoneId.systemDefault()));

            String mvcTokenJson = "{\"token\":\"<p class=\\\"text\\\" style=\\\"color:red\\\">hi</p>\"}";
            ExternalPayload inbound = (ExternalPayload) mvcConverter.read(
                    ExternalPayload.class,
                    new MockHttpInputMessage(mvcTokenJson.getBytes(StandardCharsets.UTF_8)));
            assertThat(inbound.getToken()).doesNotContain("style=");
        } finally {
            RequestContextHolder.resetRequestAttributes();
        }
    }

    /** 查找 RestTemplate 中的 Jackson JSON 消息转换器。 */
    private static MappingJackson2HttpMessageConverter findJacksonConverter(RestTemplate restTemplate) {
        for (HttpMessageConverter<?> converter : restTemplate.getMessageConverters()) {
            if (converter instanceof MappingJackson2HttpMessageConverter jacksonConverter) {
                return jacksonConverter;
            }
        }
        return null;
    }

    /** 用于验证外呼 JSON 反序列化行为的测试载荷对象。 */
    @Data
    static class ExternalPayload {

        private String token;

        private String url;

        private LocalDateTime createdAt;

    }

}
