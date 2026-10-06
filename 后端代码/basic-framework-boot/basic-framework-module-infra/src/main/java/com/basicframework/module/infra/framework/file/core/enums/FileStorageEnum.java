package com.basicframework.module.infra.framework.file.core.enums;

import cn.hutool.core.util.ArrayUtil;
import com.basicframework.module.infra.framework.file.core.client.FileClient;
import com.basicframework.module.infra.framework.file.core.client.FileClientConfig;
import com.basicframework.module.infra.framework.file.core.client.s3.S3FileClient;
import com.basicframework.module.infra.framework.file.core.client.s3.S3FileClientConfig;
import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 文件存储器枚举
 *
 * 维护存储类型、配置类和客户端实现类之间的映射关系。
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@AllArgsConstructor
@Getter
public enum FileStorageEnum {

    /** S3 对象存储，编码 20（对应字典 infra_file_storage 的取值）；经 S3 协议对接 MinIO、阿里云 OSS、腾讯云 COS 等。 */
    S3(20, S3FileClientConfig.class, S3FileClient.class),
    ;

    /**
     * 存储器
     */
    private final Integer storage;

    /**
     * 配置类
     */
    private final Class<? extends FileClientConfig> configClass;
    /**
     * 客户端类
     */
    private final Class<? extends FileClient> clientClass;

    /**
     * 根据存储类型获取文件存储枚举。
     *
     * @param storage 存储类型
     * @return 文件存储枚举；未匹配时返回 null
     */
    public static FileStorageEnum getByStorage(Integer storage) {
        return ArrayUtil.firstMatch(o -> o.getStorage().equals(storage), values());
    }

}
