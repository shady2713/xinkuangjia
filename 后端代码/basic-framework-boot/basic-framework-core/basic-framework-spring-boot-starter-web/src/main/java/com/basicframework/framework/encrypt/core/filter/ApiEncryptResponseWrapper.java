package com.basicframework.framework.encrypt.core.filter;

import cn.hutool.crypto.asymmetric.AsymmetricEncryptor;
import cn.hutool.crypto.asymmetric.KeyType;
import com.basicframework.framework.encrypt.config.ApiEncryptProperties;
import com.basicframework.framework.encrypt.core.util.AesCbcUtils;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.WriteListener;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpServletResponseWrapper;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;

/**
 * 加密响应 {@link HttpServletResponseWrapper} 实现类
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
public class ApiEncryptResponseWrapper extends HttpServletResponseWrapper {

    private final ByteArrayOutputStream byteArrayOutputStream;
    private final ServletOutputStream servletOutputStream;
    private final PrintWriter printWriter;

    /**
     * 创建 ApiEncryptResponseWrapper，并初始化所需依赖与配置。
     *
     * @param response HTTP 响应
     */
    public ApiEncryptResponseWrapper(HttpServletResponse response) {
        super(response);
        this.byteArrayOutputStream = new ByteArrayOutputStream();
        this.servletOutputStream = this.getOutputStream();
        this.printWriter = new PrintWriter(new OutputStreamWriter(byteArrayOutputStream));
    }

    /**
     * 完成 encrypt 对应的业务处理。
     *
     * @param properties 配置参数
     * @param aesKey aes键参数
     * @param asymmetricEncryptor asymmetricEncryptor参数
     * @throws IOException 执行失败时抛出
     */
    public void encrypt(ApiEncryptProperties properties,
                        String aesKey,
                        AsymmetricEncryptor asymmetricEncryptor) throws IOException {
        // 1.1 清空 body
        HttpServletResponse response = (HttpServletResponse) this.getResponse();
        response.resetBuffer();
        // 1.2 获取 body
        this.flushBuffer();
        byte[] body = byteArrayOutputStream.toByteArray();

        // 2. 添加加密 header 标识
        this.addHeader(properties.getHeader(), "true");
        // 特殊：特殊：https://juejin.cn/post/6867327674675625992
        this.addHeader("Access-Control-Expose-Headers", properties.getHeader());

        // 3.1 加密 body
        String encryptedBody = aesKey != null ? AesCbcUtils.encryptToBase64(body, aesKey)
                : asymmetricEncryptor.encryptBase64(body, KeyType.PublicKey);
        // 3.2 输出加密后的 body：（设置 header 要放在 response 的 write 之前）
        response.getWriter().write(encryptedBody);
    }

    /**
     * 获取Writer。
     *
     * @return 查询或转换后的结果
     */
    @Override
    public PrintWriter getWriter() {
        return printWriter;
    }

    /**
     * 刷新Buffer。
     *
     * @throws IOException 底层处理失败时抛出
     */
    @Override
    public void flushBuffer() throws IOException {
        if (servletOutputStream != null) {
            servletOutputStream.flush();
        }
        if (printWriter != null) {
            printWriter.flush();
        }
    }

    /**
     * 重置目标数据。
     */
    @Override
    public void reset() {
        byteArrayOutputStream.reset();
    }

    /**
     * 获取Output流。
     *
     * @return 查询或转换后的结果
     */
    @Override
    public ServletOutputStream getOutputStream() {
        return new ServletOutputStream() {

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
             * 设置WriteListener。
             *
             * @param writeListener writeListener 数据集合
             */
            @Override
            public void setWriteListener(WriteListener writeListener) {
                // 同步写出语义：响应体在写完时才加密，异步写出通知无需实现。
            }

            /**
             * 写入目标数据。
             *
             * @param b b 参数
             */
            @Override
            public void write(int b) {
                byteArrayOutputStream.write(b);
            }

            /**
             * 写入目标数据。
             *
             * @param b b 参数
             * @throws IOException 底层处理失败时抛出
             */
            @Override
            @SuppressWarnings("NullableProblems")
            public void write(byte[] b) throws IOException {
                byteArrayOutputStream.write(b);
            }

            /**
             * 写入目标数据。
             *
             * @param b b 参数
             * @param off off 参数
             * @param len len 参数
             */
            @Override
            @SuppressWarnings("NullableProblems")
            public void write(byte[] b, int off, int len) {
                byteArrayOutputStream.write(b, off, len);
            }

        };
    }

}
