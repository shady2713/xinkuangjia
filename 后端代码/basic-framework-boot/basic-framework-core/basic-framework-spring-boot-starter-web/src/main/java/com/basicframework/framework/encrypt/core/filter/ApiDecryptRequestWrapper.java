package com.basicframework.framework.encrypt.core.filter;

import cn.hutool.core.io.IoUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.crypto.asymmetric.AsymmetricDecryptor;
import cn.hutool.crypto.asymmetric.KeyType;
import com.basicframework.framework.encrypt.core.util.AesCbcUtils;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;

/**
 * 解密请求 {@link HttpServletRequestWrapper} 实现类
 *
 * @author 李杰
 */
public class ApiDecryptRequestWrapper extends HttpServletRequestWrapper {

    private final byte[] body;

    /**
     * 创建 ApiDecryptRequestWrapper，并初始化所需依赖与配置。
     *
     * @param request HTTP 请求
     * @param aesKey aes键参数
     * @param asymmetricDecryptor asymmetricDecryptor参数
     * @throws IOException 执行失败时抛出
     */
    public ApiDecryptRequestWrapper(HttpServletRequest request,
                                    String aesKey,
                                    AsymmetricDecryptor asymmetricDecryptor) throws IOException {
        super(request);
        // 读取 body，允许 BASE64 传输
        String requestBody = StrUtil.utf8Str(
                IoUtil.readBytes(request.getInputStream(), false));

        // 解密 body
        body = aesKey != null ? AesCbcUtils.decryptFromBase64(requestBody, aesKey)
                : asymmetricDecryptor.decrypt(requestBody, KeyType.PrivateKey);
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
        ByteArrayInputStream stream = new ByteArrayInputStream(body);
        return new ServletInputStream() {

            /**
             * 读取目标数据。
             *
             * @return 查询或转换后的结果
             */
            @Override
            public int read() {
                return stream.read();
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
                // 同步读取语义：请求体已整体读入内存，异步读取通知无需实现。
            }

        };
    }
}
