/** 唯一对象存储服务契约，隔离底层客户端。 */
package com.basicframework.module.infra.service.file;

import com.basicframework.module.infra.framework.file.core.client.FileObjectPage;
import com.basicframework.module.infra.framework.file.core.client.FileObjectStat;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.List;

/**
 * 统一文件存储服务。
 *
 * <p>业务层只依赖本接口，不感知文件客户端编号、数据库配置或具体存储实现。</p>
 *
 * @author 李杰
 */
public interface FileStorageService {

    /**
     * 读取当前桶的一页对象大小，供内部监控统计使用。
     * @param continuationToken 上一页游标，首页为 null
     * @return 有界对象元数据页
     * @throws RuntimeException 存储访问失败时抛出
     */
    FileObjectPage listObjects(String continuationToken);

    /**
     * 查询单个已上传对象的实际元数据（通过 HEAD 请求获取，不读取对象体）。
     *
     * @param path 对象相对路径
     * @return 对象元数据摘要；对象不存在时返回 {@code null}
     */
    FileObjectStat statObject(String path);

    /**
     * 上传文件。
     *
     * @param content 文件内容
     * @param path 对象路径
     * @param type 内容类型
     * @return 可长期访问的文件地址
     * @throws Exception 上传失败时抛出
     */
    String upload(byte[] content, String path, String type) throws Exception;

    /**
     * 删除文件。
     *
     * @param path 对象路径
     * @throws Exception 删除失败时抛出
     */
    void delete(String path) throws Exception;

    /**
     * 读取文件内容。
     *
     * @param path 对象路径
     * @return 文件内容
     * @throws Exception 读取失败时抛出
     */
    byte[] getContent(String path) throws Exception;

    /**
     * 以流式方式打开文件内容，避免大文件整包载入堆内存。
     *
     * @param path 对象路径
     * @return 文件内容输入流，不存在时返回 null
     * @throws Exception 读取失败时抛出
     */
    default InputStream openContentStream(String path) throws Exception {
        byte[] content = getContent(path);
        return content != null ? new ByteArrayInputStream(content) : null;
    }

    /**
     * 复制文件。
     *
     * @param sourcePath 来源对象路径
     * @param targetPath 目标对象路径
     * @param type 内容类型
     * @return 目标文件访问地址
     * @throws Exception 复制失败时抛出
     */
    String copy(String sourcePath, String targetPath, String type) throws Exception;

    /**
     * 查询指定路径的下一级目录前缀。
     *
     * @param prefix 路径前缀
     * @param delimiter 目录分隔符
     * @return 下一级目录前缀
     * @throws Exception 查询失败时抛出
     */
    List<String> listPrefixes(String prefix, String delimiter) throws Exception;

    /**
     * 删除指定路径前缀下的全部文件。
     *
     * @param prefix 路径前缀
     * @return 删除数量
     * @throws Exception 删除失败时抛出
     */
    int deletePrefix(String prefix) throws Exception;

    /**
     * 生成上传地址。
     *
     * @param path 对象路径
     * @return 预签名上传地址
     */
    String presignPutUrl(String path);

    /**
     * 生成限定 {@code Content-Type} 的上传预签名地址。
     *
     * @param path        对象路径
     * @param contentType 允许的 MIME 类型
     * @return 预签名上传地址
     */
    default String presignPutUrl(String path, String contentType) {
        return presignPutUrl(path);
    }

    /**
     * 生成读取地址。
     *
     * <p>当前 MinIO 配置固定公开访问；有效期参数仅保留给底层 S3 能力。</p>
     *
     * @param url 对象路径或完整文件地址
     * @param expirationSeconds 有效期，单位秒；公开访问时可为空
     * @return 文件读取地址
     */
    String presignGetUrl(String url, Integer expirationSeconds);

}
