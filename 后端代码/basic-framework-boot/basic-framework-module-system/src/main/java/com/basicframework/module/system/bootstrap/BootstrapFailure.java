package com.basicframework.module.system.bootstrap;

/**
 * 初始化边界的固定失败分类，避免把用户输入、连接地址或凭据带入错误输出。
 *
 * @author shady2713
 */
final class BootstrapFailure extends RuntimeException {

    /** 初始化拒绝原因；编码本身不包含环境值。 */
    enum Reason {
        /** 目标、输入方式、账号或连接参数不符合显式配置要求。 */
        INVALID_CONFIGURATION,
        /** 明文口令不符合强度、长度或 Unicode 边界。 */
        PASSWORD_POLICY,
        /** 无回显交互的两次口令不一致或提前结束。 */
        PASSWORD_CONFIRMATION,
        /** URL、人工确认与实际连接的数据库名不一致。 */
        TARGET_MISMATCH,
        /** 必需表缺失或不具备 InnoDB 事务、行锁能力。 */
        NON_TRANSACTIONAL_SCHEMA,
        /** 已有账号、身份关联或会话数据，不能执行空库初始化。 */
        NONEMPTY_IDENTITIES,
        /** 不存在唯一、有效且同平台的内置超级管理员角色。 */
        INVALID_ADMIN_ROLE,
        /** 初始化命名锁超时或数据库无法提供该锁。 */
        BOOTSTRAP_BUSY
    }

    /** 以固定分类构造错误，不接收可能含凭据的外部消息。 */
    BootstrapFailure(Reason reason) {
        super(reason.name());
    }
}
