package com.basicframework.framework.operatelog.core.annotation;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 操作审计日志注解，基于原生 Spring AOP 在业务方法成功返回后异步写入操作日志。
 *
 * @author shady
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface OperateLog {

    /**
     * 操作模块类型（如：用户管理、角色管理）。
     */
    String type();

    /**
     * 操作子类型/动作名称（如：创建用户、更新角色）。
     */
    String subType();

    /**
     * 业务对象编号 SpEL 表达式（支持方法参数名及 {@code #result} 返回值），默认 0。
     */
    String bizId() default "";

    /**
     * 操作描述模板，支持普通文本或 {@code #{...}} SpEL 片段。
     */
    String action() default "";

}
