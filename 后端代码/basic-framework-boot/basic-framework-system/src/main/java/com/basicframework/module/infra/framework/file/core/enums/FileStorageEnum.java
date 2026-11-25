package com.basicframework.module.infra.framework.file.core.enums;

import cn.hutool.core.util.ArrayUtil;
import com.basicframework.module.infra.framework.file.core.client.FileClient;
import com.basicframework.module.infra.framework.file.core.client.FileClientConfig;
import com.basicframework.module.infra.framework.file.core.client.local.LocalFileClient;
import com.basicframework.module.infra.framework.file.core.client.local.LocalFileClientConfig;
import com.basicframework.module.infra.framework.file.core.client.s3.S3FileClient;
import com.basicframework.module.infra.framework.file.core.client.s3.S3FileClientConfig;
import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 文件存储器枚举：支持本地磁盘（LOCAL）与阿里云 OSS（S3 协议）。
 *
 * @author shady
 */
@AllArgsConstructor
@Getter
public enum FileStorageEnum {

    LOCAL(10, LocalFileClientConfig.class, LocalFileClient.class),
    S3(20, S3FileClientConfig.class, S3FileClient.class),
    ;

    private final Integer storage;
    private final Class<? extends FileClientConfig> configClass;
    private final Class<? extends FileClient> clientClass;

    public static FileStorageEnum getByStorage(Integer storage) {
        return ArrayUtil.firstMatch(o -> o.getStorage().equals(storage), values());
    }

}
