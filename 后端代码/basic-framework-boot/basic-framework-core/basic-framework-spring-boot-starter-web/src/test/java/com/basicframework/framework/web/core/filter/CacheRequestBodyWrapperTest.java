package com.basicframework.framework.web.core.filter;

import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * 验证缓存请求体包装的 Servlet 输入流契约。
 *
 * <p>包装后的请求体由下游同步读取，容器仍会查询流的完成与就绪状态。用例锁定真实行为：
 * 缓存流基于内存字节数组，{@code isReady} 恒定报告未就绪（不参与异步 IO 就绪通知），
 * {@code setReadListener} 为空实现且不触发任何监听回调；{@code available} 与读取结果
 * 必须与缓存的请求体长度、内容一致，避免下游按错误长度截断请求体。</p>
 *
 * <p>同时如实记录一个实现限制：{@code isFinished} 恒定返回 false，读完请求体后也不报告完成，
 * 因此依赖该标志判断“流已结束”的容器或异步框架无法据此收敛。</p>
 *
 * @author shady2713
 */
class CacheRequestBodyWrapperTest {

    /** 缓存流的就绪、完成与监听器行为必须与实现一致，读取内容不得被截断。 */
    @Test
    void cachedInputStreamReportsFixedAsyncStateAndFullBody() throws Exception {
        byte[] body = "{\"name\":\"张三\"}".getBytes(StandardCharsets.UTF_8);
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/app-api/order/create");
        request.setContentType(MediaType.APPLICATION_JSON_VALUE);
        request.setContent(body);
        CacheRequestBodyWrapper wrapper = new CacheRequestBodyWrapper(request);

        ServletInputStream stream = wrapper.getInputStream();
        ReadListener readListener = mock(ReadListener.class);

        assertThat(stream.isReady()).as("内存缓存流不参与异步就绪通知").isFalse();
        assertThat(stream.isFinished()).as("实现恒定报告未完成").isFalse();
        stream.setReadListener(readListener);
        verifyNoInteractions(readListener);

        assertThat(stream.available()).isEqualTo(body.length);
        assertThat(stream.readAllBytes()).isEqualTo(body);
        assertThat(stream.isFinished()).as("读完请求体后仍恒定报告未完成").isFalse();
    }

}
