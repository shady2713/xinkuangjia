package com.basicframework.module.infra.framework.file.core.client;

import cn.hutool.core.util.StrUtil;
import lombok.extern.slf4j.Slf4j;

/**
 * 文件客户端的抽象类，提供模板方法，减少子类的冗余代码
 *
 * @param <Config> 客户端配置类型
 * @author 李杰
 */
@Slf4j
public abstract class AbstractFileClient<Config extends FileClientConfig> implements FileClient {

    /**
     * 配置编号
     */
    private final Long id;
    /**
     * 文件配置
     */
    protected Config config;
    /**
     * 原始的文件配置
     *
     * 原因：{@link #config} 可能被子类所修改，无法用于判断配置是否变更
     */
    private Config originalConfig;

    /**
     * 创建文件客户端模板。
     *
     * @param id 进程内客户端标识
     * @param config 初始客户端配置
     */
    protected AbstractFileClient(Long id, Config config) {
        this.id = id;
        this.config = config;
        this.originalConfig = config;
    }

    /**
     * 初始化
     */
    public final void init() {
        doInit();
        log.debug("[init][配置摘要({}) 初始化完成]", summarizeConfig(config));
    }

    /**
     * 自定义初始化
     */
    protected abstract void doInit();

    /**
     * 配置变化时刷新客户端资源。
     *
     * <p>初始化失败会恢复原配置，让既有客户端继续按原配置工作。</p>
     *
     * @param config 新客户端配置
     */
    public final void refresh(Config config) {
        // 判断是否更新
        if (config.equals(this.originalConfig)) {
            return;
        }
        log.info("[refresh][配置摘要({}) 发生变化，重新初始化]", summarizeConfig(config));
        Config previousConfig = this.config;
        this.config = config;
        try {
            this.init();
            this.originalConfig = config;
        } catch (RuntimeException ex) {
            this.config = previousConfig;
            throw ex;
        }
    }

    /**
     * 获取进程内客户端标识。
     *
     * @return 客户端标识
     */
    @Override
    public Long getId() {
        return id;
    }

    /**
     * 格式化文件的 URL 访问地址
     * 使用场景：local、ftp、db，通过 FileController 的 getFile 来获取文件内容
     *
     * @param domain 自定义域名
     * @param path 文件路径
     * @return URL 访问地址
     */
    protected String formatFileUrl(String domain, String path) {
        return StrUtil.format("{}/admin-api/infra/file/content/{}", domain, path);
    }

    /**
     * 生成不包含访问密钥的配置摘要，供日志定位客户端类型。
     *
     * @param config 客户端配置
     * @return 安全配置摘要
     */
    private String summarizeConfig(Config config) {
        if (config == null) {
            return String.format("id(%s) type(null)", id);
        }
        return String.format("id(%s) type(%s)", id, config.getClass().getSimpleName());
    }

}
