package com.basicframework.framework.web.core.filter;

import com.basicframework.framework.common.util.servlet.ServletUtils;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/**
 * 有界 JSON 请求体缓存包装器。
 *
 * @author shady
 */
public class CacheRequestBodyWrapper extends HttpServletRequestWrapper {

    /** 读取缓冲区大小。 */
    private static final int BUFFER_SIZE = 4096;

    /** 已缓存的请求体字节数组。 */
    private final byte[] body;

    /**
     * 使用默认 2MB 上限构造请求体缓存包装器。
     *
     * @param request HTTP 请求
     * @throws IOException 读取请求流失败时抛出
     */
    public CacheRequestBodyWrapper(HttpServletRequest request) throws IOException {
        this(request, CacheRequestBodyFilter.MAX_CACHE_BODY_BYTES);
    }

    /**
     * 按指定字节上限读取并缓存 JSON 请求体。
     *
     * @param request HTTP 请求
     * @param maxBytes 允许缓存的最大字节数
     * @throws IOException 读取底层输入流失败时抛出
     * @throws RequestBodyTooLargeException 实际读取字节数超出 {@code maxBytes} 时抛出
     */
    public CacheRequestBodyWrapper(HttpServletRequest request, int maxBytes) throws IOException {
        super(request);
        if (!ServletUtils.isJsonRequest(request)) {
            this.body = new byte[0];
            return;
        }
        this.body = readBoundedBytes(request.getInputStream(), maxBytes);
    }

    /**
     * 从输入流按上限读取字节，超过上限立即中断，防止分块传输绕过 Content-Length 限制。
     *
     * @param input 请求输入流
     * @param maxBytes 最大允许字节数
     * @return 读取到的完整字节数组
     * @throws IOException IO 异常
     */
    private static byte[] readBoundedBytes(InputStream input, int maxBytes) throws IOException {
        if (input == null) {
            return new byte[0];
        }
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[BUFFER_SIZE];
        int total = 0;
        int read;
        while ((read = input.read(buffer)) != -1) {
            total += read;
            if (total > maxBytes) {
                throw new RequestBodyTooLargeException();
            }
            output.write(buffer, 0, read);
        }
        return output.toByteArray();
    }

    /**
     * 获取 UTF-8 字符读取器。
     *
     * @return 包装缓存字节流的字符读取器
     */
    @Override
    public BufferedReader getReader() {
        return new BufferedReader(new InputStreamReader(this.getInputStream(), StandardCharsets.UTF_8));
    }

    /**
     * 获取缓存后的请求体字节长度。
     *
     * @return 字节长度
     */
    @Override
    public int getContentLength() {
        return body.length;
    }

    /**
     * 获取缓存后的长整型请求体字节长度。
     *
     * @return 字节长度
     */
    @Override
    public long getContentLengthLong() {
        return body.length;
    }

    /**
     * 返回可重复读取的内存输入流。
     *
     * @return 基于缓存字节数组的 Servlet 输入流
     */
    @Override
    public ServletInputStream getInputStream() {
        final ByteArrayInputStream inputStream = new ByteArrayInputStream(body);
        return new ServletInputStream() {

            /** 从内存缓冲读取单字节。 */
            @Override
            public int read() {
                return inputStream.read();
            }

            /** 判断内存流是否读取完毕。 */
            @Override
            public boolean isFinished() {
                return inputStream.available() == 0;
            }

            /** 内存缓冲始终立即可读。 */
            @Override
            public boolean isReady() {
                return true;
            }

            /** 同步内存流无需异步监听器。 */
            @Override
            public void setReadListener(ReadListener readListener) {
                // 内存字节流始终同步就绪，无需注册异步回调。
            }

            /** 返回剩余可读字节数。 */
            @Override
            public int available() {
                return inputStream.available();
            }
        };
    }

    /**
     * 请求体超出缓存上限异常。
     *
     * @author shady
     */
    public static final class RequestBodyTooLargeException extends RuntimeException {
        private static final long serialVersionUID = 1L;
    }

}
