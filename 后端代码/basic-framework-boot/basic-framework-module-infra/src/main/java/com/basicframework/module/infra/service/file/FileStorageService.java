/** 唯一对象存储服务契约，隔离底层客户端。 */
package com.basicframework.module.infra.service.file;

import com.basicframework.module.infra.framework.file.core.client.FileObjectPage;

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
     * 有界读取待验证对象；实现不得先无界读取再检查长度。
     * @param path 对象键
     * @param maximumBytes 允许的最大字节数
     * @return 完整且未超过限制的字节
     * @throws Exception 对象不存在、超限或存储故障
     */
    byte[] getContent(String path, int maximumBytes) throws Exception;

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
     * @param size 签名绑定的精确字节数；上传有效期五分钟
     * @return 预签名上传地址
     */
    String presignPutUrl(String path, long size);

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
