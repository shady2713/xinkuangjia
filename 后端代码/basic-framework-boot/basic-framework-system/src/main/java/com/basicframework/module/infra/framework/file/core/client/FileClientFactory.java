package com.basicframework.module.infra.framework.file.core.client;

import com.basicframework.module.infra.framework.file.core.enums.FileStorageEnum;

/**
 * 文件客户端工厂，用于按进程内标识获取和创建客户端。
 *
 * @author 李杰
 */
public interface FileClientFactory {

    /**
     * 获得文件客户端
     *
     * @param clientId 进程内客户端标识
     * @return 文件客户端
     */
    FileClient getFileClient(Long clientId);

    /**
     * 创建或按配置变化刷新文件客户端。
     *
     * @param clientId 进程内客户端标识
     * @param storage 存储器的枚举 {@link FileStorageEnum}
     * @param config 文件配置
     */
    <Config extends FileClientConfig> void createOrUpdateFileClient(Long clientId, Integer storage, Config config);

}
