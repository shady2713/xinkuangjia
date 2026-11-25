package com.basicframework.module.system.service.footgun;

import java.util.logging.Logger;

/**
 * 反向失败夹具：业务模块直接抛出裸 {@link RuntimeException} 并使用 {@code java.util.logging}。
 *
 * @author shady
 */
public class ForbiddenGenericExceptionAndJulUsage {

    /** 故意使用 JDK 原生日志器，验证日志门面统一规则。 */
    private static final Logger LOGGER = Logger.getLogger(ForbiddenGenericExceptionAndJulUsage.class.getName());

    /**
     * 故意记录 JUL 日志并抛出裸运行时异常，供反向门禁测试验证。
     */
    public void triggerBadSmells() {
        LOGGER.info("forbidden-jul");
        throw new RuntimeException("forbidden-generic-exception");
    }
}
