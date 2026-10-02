package com.basicframework.module.infra.api.file;

import com.basicframework.module.infra.service.file.FileStorageService;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 对象存储跨模块 API 实现。
 *
 * <p>本实现将公开契约委托给 Infra 内部存储服务，避免调用方依赖内部实现层。</p>
 *
 * @author 李杰
 */
@Service
public class FileStorageApiImpl implements FileStorageApi {

    /** Infra 模块内部的统一文件存储服务。 */
    @Resource
    private FileStorageService fileStorageService;

    /**
     * 按指定对象路径上传文件。
     *
     * @param content 文件内容
     * @param path 对象路径
     * @param type 内容类型
     * @return 文件访问地址
     * @throws Exception 上传失败时抛出
     */
    @Override
    public String upload(byte[] content, String path, String type) throws Exception {
        return fileStorageService.upload(content, path, type);
    }

    /**
     * 读取指定对象的内容。
     *
     * @param path 对象路径
     * @return 文件内容
     * @throws Exception 读取失败时抛出
     */
    @Override
    public byte[] getContent(String path) throws Exception {
        return fileStorageService.getContent(path);
    }

    /**
     * 将来源对象复制到目标路径。
     *
     * @param sourcePath 来源对象路径
     * @param targetPath 目标对象路径
     * @param type 内容类型
     * @return 目标文件访问地址
     * @throws Exception 复制失败时抛出
     */
    @Override
    public String copy(String sourcePath, String targetPath, String type) throws Exception {
        return fileStorageService.copy(sourcePath, targetPath, type);
    }

    /**
     * 查询指定路径的下一级目录前缀。
     *
     * @param prefix 路径前缀
     * @param delimiter 目录分隔符
     * @return 下一级目录前缀
     * @throws Exception 查询失败时抛出
     */
    @Override
    public List<String> listPrefixes(String prefix, String delimiter) throws Exception {
        return fileStorageService.listPrefixes(prefix, delimiter);
    }

    /**
     * 删除指定路径前缀下的全部对象。
     *
     * @param prefix 路径前缀
     * @return 删除数量
     * @throws Exception 删除失败时抛出
     */
    @Override
    public int deletePrefix(String prefix) throws Exception {
        return fileStorageService.deletePrefix(prefix);
    }

}
