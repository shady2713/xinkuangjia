package com.basicframework.framework.encrypt.core.annotation;

import java.lang.annotation.*;

/**
 * HTTP API 加解密注解
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-framework/yudao-spring-boot-starter-web/src/main/java/cn/iocoder/yudao/framework/encrypt/core/annotation/
 * 上游文件续：ApiEncrypt.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：命名空间适配。
 */
@Documented
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
public @interface ApiEncrypt {

    /**
     * 是否对请求参数进行解密，默认 true
     */
    boolean request() default true;

    /**
     * 是否对响应结果进行加密，默认 true
     */
    boolean response() default true;

}
