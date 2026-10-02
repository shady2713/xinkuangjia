package com.basicframework.module.infra.api.file;

import java.util.List;

/**
 * 面向其他业务模块提供受控的对象存储能力。
 *
 * <p>调用方只依赖本契约，不感知 Infra 模块内部的存储客户端、配置编号和实现类型。</p>
 *
 * @author 李杰
 */
public interface FileStorageApi {

    /**
     * 按指定对象路径上传文件。
     *
     * @param content 文件内容
     * @param path 对象路径
     * @param type 内容类型
     * @return 文件访问地址
     * @throws Exception 上传失败时抛出
     */
    String upload(byte[] content, String path, String type) throws Exception;

    /**
     * 读取指定对象的内容。
     *
     * @param path 对象路径
     * @return 文件内容
     * @throws Exception 读取失败时抛出
     */
    byte[] getContent(String path) throws Exception;

    /**
     * 将来源对象复制到目标路径。
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
     * 删除指定路径前缀下的全部对象。
     *
     * @param prefix 路径前缀
     * @return 删除数量
     * @throws Exception 删除失败时抛出
     */
    int deletePrefix(String prefix) throws Exception;

}
