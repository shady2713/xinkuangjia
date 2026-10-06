package com.basicframework.module.infra.framework.file.core.client;

import com.fasterxml.jackson.annotation.JsonTypeInfo;

/**
 * 文件客户端的配置
 *
 * 不同实现的客户端需要不同配置，通过子类定义并依赖 Jackson 多态信息完成持久化和还原。
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@JsonTypeInfo(use = JsonTypeInfo.Id.CLASS)
// @JsonTypeInfo 注解的作用，Jackson 多态
// 1. 序列化到时数据库时，增加 @class 属性。
// 2. 反序列化到内存对象时，通过 @class 属性，可以创建出正确的类型
public interface FileClientConfig {
}
