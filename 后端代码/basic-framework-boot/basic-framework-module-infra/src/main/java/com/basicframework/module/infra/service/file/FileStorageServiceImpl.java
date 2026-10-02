/** 使用环境配置管理唯一 MinIO 客户端及资源生命周期。 */
package com.basicframework.module.infra.service.file;

import com.basicframework.module.infra.framework.file.config.MinioFileProperties;
import com.basicframework.module.infra.framework.file.core.client.FileClient;
import com.basicframework.module.infra.framework.file.core.client.FileClientFactory;
import com.basicframework.module.infra.framework.file.core.client.FileObjectPage;
import com.basicframework.module.infra.framework.file.core.enums.FileStorageEnum;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Objects;

/**
 * 环境变量驱动的唯一 MinIO 文件存储服务。
 *
 * <p>启动时根据 {@link MinioFileProperties} 创建单一客户端，运行期间不查询数据库配置。</p>
 *
 * @author 李杰
 */
@Service
@RequiredArgsConstructor
public class FileStorageServiceImpl implements FileStorageService {

    /** 文件客户端工厂内部使用的固定标识，不写入业务表，也不通过接口暴露。 */
    private static final Long MINIO_CLIENT_ID = 1L;

    private final FileClientFactory fileClientFactory;
    private final MinioFileProperties minioFileProperties;

    /** 当前进程唯一的 MinIO 客户端。 */
    private FileClient fileClient;

    /**
     * 委托唯一存储客户端只读列举当前桶的一页对象。
     * @param continuationToken 上一页游标，首页为 null
     * @return 对象元数据页
     * @throws RuntimeException 存储访问失败时抛出
     */
    @Override
    public FileObjectPage listObjects(String continuationToken) {
        return fileClient.listObjects(continuationToken);
    }

    /**
     * 使用环境变量初始化唯一的 MinIO 客户端。
     *
     * @throws NullPointerException 客户端创建失败时抛出，阻止应用带错误配置启动
     */
    @PostConstruct
    void initializeFileClient() {
        fileClientFactory.createOrUpdateFileClient(MINIO_CLIENT_ID, FileStorageEnum.S3.getStorage(),
                minioFileProperties.toClientConfig());
        fileClient = Objects.requireNonNull(fileClientFactory.getFileClient(MINIO_CLIENT_ID),
                "MinIO 文件客户端初始化失败");
    }

    /**
     * 在 Spring Bean 销毁时关闭底层 SDK 连接资源。
     */
    @PreDestroy
    void closeFileClient() {
        if (fileClient != null) {
            fileClient.close();
        }
    }

    /**
     * 上传文件到当前唯一 MinIO 客户端。
     *
     * @param content 文件内容
     * @param path 对象路径
     * @param type MIME 类型
     * @return 文件长期访问地址
     * @throws Exception 上传失败时抛出
     */
    @Override
    public String upload(byte[] content, String path, String type) throws Exception {
        return fileClient.upload(content, path, type);
    }

    /**
     * 删除指定对象。
     *
     * @param path 对象路径
     * @throws Exception 删除失败时抛出
     */
    @Override
    public void delete(String path) throws Exception {
        fileClient.delete(path);
    }

    /**
     * 读取指定对象的完整内容。
     *
     * @param path 对象路径
     * @return 文件字节内容
     * @throws Exception 读取失败时抛出
     */
    @Override
    public byte[] getContent(String path) throws Exception {
        return fileClient.getContent(path);
    }

    /**
     * 通过对象存储服务端复制对象。
     *
     * @param sourcePath 来源对象路径
     * @param targetPath 目标对象路径
     * @param type MIME 类型
     * @return 目标对象长期访问地址
     * @throws Exception 复制失败时抛出
     */
    @Override
    public String copy(String sourcePath, String targetPath, String type) throws Exception {
        return fileClient.copy(sourcePath, targetPath, type);
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
        return fileClient.listPrefixes(prefix, delimiter);
    }

    /**
     * 删除指定前缀下的全部对象。
     *
     * @param prefix 路径前缀
     * @return 删除对象数量
     * @throws Exception 删除失败时抛出
     */
    @Override
    public int deletePrefix(String prefix) throws Exception {
        return fileClient.deletePrefix(prefix);
    }

    /**
     * 生成对象上传预签名地址。
     *
     * @param path 对象路径
     * @return 上传预签名地址
     */
    @Override
    public String presignPutUrl(String path) {
        return fileClient.presignPutUrl(path);
    }

    /**
     * 生成对象读取地址。
     *
     * @param url 对象路径或完整文件地址
     * @param expirationSeconds 私有存储有效期，单位秒；公开存储时忽略
     * @return 文件读取地址
     */
    @Override
    public String presignGetUrl(String url, Integer expirationSeconds) {
        return fileClient.presignGetUrl(url, expirationSeconds);
    }

}
