package com.basicframework.framework.web.core.filter;

import com.basicframework.framework.common.util.servlet.ServletUtils;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.InputStreamReader;

/**
 *  Request Body 缓存 Wrapper
 *
 * @author 李杰
 */
public class CacheRequestBodyWrapper extends HttpServletRequestWrapper {

    /**
     * 缓存的内容
     */
    private final byte[] body;

    /**
     * 创建 CacheRequestBodyWrapper，并初始化所需依赖与配置。
     *
     * @param request HTTP 请求
     */
    public CacheRequestBodyWrapper(HttpServletRequest request) {
        super(request);
        body = ServletUtils.getBodyBytes(request);
    }

    /**
     * 获取读取器。
     *
     * @return 查询或转换后的结果
     */
    @Override
    public BufferedReader getReader() {
        return new BufferedReader(new InputStreamReader(this.getInputStream()));
    }

    /**
     * 获取内容长度。
     *
     * @return 查询或转换后的结果
     */
    @Override
    public int getContentLength() {
        return body.length;
    }

    /**
     * 获取内容长度Long。
     *
     * @return 查询或转换后的结果
     */
    @Override
    public long getContentLengthLong() {
        return body.length;
    }

    /**
     * 获取当前请求体的输入流。
     *
     * @return 查询或转换后的结果
     */
    @Override
    public ServletInputStream getInputStream() {
        final ByteArrayInputStream inputStream = new ByteArrayInputStream(body);
        // 返回 ServletInputStream
        return new ServletInputStream() {

            /**
             * 读取目标数据。
             *
             * @return 查询或转换后的结果
             */
            @Override
            public int read() {
                return inputStream.read();
            }

            /**
             * 判断Finished 是否满足业务条件。
             *
             * @return 业务条件成立时返回 true，否则返回 false
             */
            @Override
            public boolean isFinished() {
                return false;
            }

            /**
             * 判断就绪状态 是否满足业务条件。
             *
             * @return 业务条件成立时返回 true，否则返回 false
             */
            @Override
            public boolean isReady() {
                return false;
            }

            /**
             * 为当前请求体输入流设置异步读取监听器。
             *
             * @param readListener readListener 数据集合
             */
            @Override
            public void setReadListener(ReadListener readListener) {
                // 同步读取语义：请求体已缓存为字节数组，异步读取通知无需实现。
            }

            /**
             * 判断当前组件是否具备执行条件。
             *
             * @return 方法处理结果
             */
            @Override
            public int available() {
                return body.length;
            }

        };
    }

}
