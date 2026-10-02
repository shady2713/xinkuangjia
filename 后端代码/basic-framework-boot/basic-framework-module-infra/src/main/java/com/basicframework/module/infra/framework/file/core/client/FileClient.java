/** 文件客户端统一协议，包含有界对象元数据读取。 */
package com.basicframework.module.infra.framework.file.core.client;

import java.util.List;

/**
 * 文件客户端
 *
 * 抽象不同存储实现的文件上传、删除、读取和预签名访问能力。
 *
 * @author 李杰
 */
public interface FileClient extends AutoCloseable {

    /**
     * 获得客户端编号
     *
     * @return 客户端编号
     */
    Long getId();

    /**
     * 只读列举当前桶的一页对象元数据，不读取对象内容。
     *
     * @param continuationToken 上一页返回的游标，首页为 null
     * @return 最多 1000 条对象及下一页游标
     * @throws RuntimeException 不支持列举或存储访问失败时抛出
     */
    default FileObjectPage listObjects(String continuationToken) {
        throw new UnsupportedOperationException("当前存储不支持对象容量采集");
    }

    /**
     * 上传文件
     *
     * @param content 文件流
     * @param path    相对路径
     * @return 完整路径，即 HTTP 访问地址
     * @throws Exception 上传文件时，抛出 Exception 异常
     */
    String upload(byte[] content, String path, String type) throws Exception;

    /**
     * 删除文件
     *
     * @param path 相对路径
     * @throws Exception 删除文件时，抛出 Exception 异常
     */
    void delete(String path) throws Exception;

    /**
     * 获得文件的内容
     *
     * @param path 相对路径
     * @return 文件的内容
     */
    byte[] getContent(String path) throws Exception;

    /**
     * 复制对象到新的路径。
     *
     * @param sourcePath 来源对象路径，例如 frames/20260515/a.jpg
     * @param targetPath 目标对象路径，例如 ai-business/20260515/a.jpg
     * @param type 文件类型
     * @return 目标对象访问 URL
     * @throws Exception 复制对象失败时抛出
     */
    default String copy(String sourcePath, String targetPath, String type) throws Exception {
        return upload(getContent(sourcePath), targetPath, type);
    }

    /**
     * 查询指定路径下一级子目录前缀。
     *
     * @param prefix 路径前缀，例如 frames/
     * @param delimiter 分隔符，通常为 /
     * @return 下一级子目录前缀，例如 frames/20260515/
     * @throws Exception 查询对象存储目录失败时抛出
     */
    default List<String> listPrefixes(String prefix, String delimiter) throws Exception {
        throw new UnsupportedOperationException("不支持的操作");
    }

    /**
     * 删除指定路径前缀下的全部对象。
     *
     * @param prefix 路径前缀，例如 frames/20260513/
     * @return 删除的对象数量
     * @throws Exception 删除对象存储目录失败时抛出
     */
    default int deletePrefix(String prefix) throws Exception {
        throw new UnsupportedOperationException("不支持的操作");
    }

    // ========== 文件签名，目前仅 S3 支持 ==========

    /**
     * 获得文件预签名地址，用于上传
     *
     * @param path 相对路径
     * @return 文件预签名地址
     */
    default String presignPutUrl(String path) {
        throw new UnsupportedOperationException("不支持的操作");
    }

    /**
     * 生成文件预签名地址，用于读取
     *
     * @param url 完整的文件访问地址
     * @param expirationSeconds 访问有效期，单位秒
     * @return 文件预签名地址
     */
    default String presignGetUrl(String url, Integer expirationSeconds) {
        throw new UnsupportedOperationException("不支持的操作");
    }

    /**
     * 关闭客户端持有的连接池、线程和其他外部资源。
     *
     * <p>无状态实现默认无需处理；持有 SDK 客户端的实现必须覆写。</p>
     */
    @Override
    default void close() {
    }

}
