package com.basicframework.module.infra.framework.file.core.client;

import cn.hutool.core.lang.Assert;
import cn.hutool.core.util.ReflectUtil;
import com.basicframework.module.infra.framework.file.core.enums.FileStorageEnum;
import lombok.extern.slf4j.Slf4j;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/**
 * 线程安全的进程内文件客户端工厂。
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@Slf4j
public class FileClientFactoryImpl implements FileClientFactory {

    /**
     * 文件客户端 Map
     * key：进程内客户端标识
     */
    private final ConcurrentMap<Long, AbstractFileClient<?>> clients = new ConcurrentHashMap<>();

    /**
     * 按进程内标识获取文件客户端。
     *
     * @param clientId 进程内客户端标识
     * @return 文件客户端；不存在时返回 null
     */
    @Override
    public FileClient getFileClient(Long clientId) {
        AbstractFileClient<?> client = clients.get(clientId);
        if (client == null) {
            log.error("[getFileClient][客户端标识({}) 找不到客户端]", clientId);
        }
        return client;
    }

    /**
     * 原子地创建或刷新文件客户端，避免并发初始化泄漏重复客户端。
     *
     * @param clientId 进程内客户端标识
     * @param storage 存储类型
     * @param config 客户端配置
     * @param <Config> 客户端配置类型
     */
    @Override
    @SuppressWarnings("unchecked")
    public <Config extends FileClientConfig> void createOrUpdateFileClient(Long clientId, Integer storage, Config config) {
        clients.compute(clientId, (id, existingClient) -> {
            AbstractFileClient<Config> client = (AbstractFileClient<Config>) existingClient;
            if (client == null) {
                client = createFileClient(id, storage, config);
                client.init();
                return client;
            }
            client.refresh(config);
            return client;
        });
    }

    /**
     * 根据存储枚举反射创建对应客户端。
     *
     * @param clientId 进程内客户端标识
     * @param storage 存储类型
     * @param config 客户端配置
     * @param <Config> 客户端配置类型
     * @return 尚未初始化的文件客户端
     */
    @SuppressWarnings("unchecked")
    private <Config extends FileClientConfig> AbstractFileClient<Config> createFileClient(
            Long clientId, Integer storage, Config config) {
        FileStorageEnum storageEnum = FileStorageEnum.getByStorage(storage);
        Assert.notNull(storageEnum, String.format("文件存储类型(%s) 不存在", storage));
        // 创建客户端
        return (AbstractFileClient<Config>) ReflectUtil.newInstance(storageEnum.getClientClass(), clientId, config);
    }

}
