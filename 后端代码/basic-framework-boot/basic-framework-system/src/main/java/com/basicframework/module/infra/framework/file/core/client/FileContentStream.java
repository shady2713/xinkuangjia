/** 对象存储流式内容与权威长度封装。 */
package com.basicframework.module.infra.framework.file.core.client;

import java.io.IOException;
import java.io.InputStream;
import java.util.Objects;

/**
 * 流式文件下载内容及其字节长度封装，供下载接口统一输出 {@code Content-Length} 与断点续传响应头。
 *
 * @param inputStream   文件内容输入流（非空，由调用方关闭）
 * @param contentLength 文件总字节数，未知时为 {@code null}
 * @author shady
 */
public record FileContentStream(InputStream inputStream, Long contentLength) implements AutoCloseable {

    /**
     * 校验内容输入流非空。
     */
    public FileContentStream {
        Objects.requireNonNull(inputStream, "inputStream must not be null");
    }

    /**
     * 关闭底层文件内容输入流。
     *
     * @throws IOException 关闭输入流失败时抛出
     */
    @Override
    public void close() throws IOException {
        inputStream.close();
    }

}
