package com.basicframework.module.infra.framework.file.core.client.local;

import com.basicframework.module.infra.framework.file.core.client.FileClientConfig;
import lombok.Data;

/**
 * 本地磁盘文件客户端配置（用于本地开发、CI 及政务断网内网环境）。
 *
 * @author 李杰
 */
@Data
public class LocalFileClientConfig implements FileClientConfig {

    /**
     * 本地存储根目录。
     */
    private String basePath = "./.local-storage";

    /**
     * 公开访问地址前缀（末尾不带斜杠），例如 {@code /admin-api/infra/file/content}。
     */
    private String domain = "/admin-api/infra/file/content";

    /**
     * 是否默认允许公开路径访问。
     */
    private boolean publicAccess = true;

}
