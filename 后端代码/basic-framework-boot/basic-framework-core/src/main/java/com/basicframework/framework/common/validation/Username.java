package com.basicframework.framework.common.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 用户名格式校验注解。
 *
 * @author 李杰
 */
@Target({
        ElementType.METHOD,
        ElementType.FIELD,
        ElementType.ANNOTATION_TYPE,
        ElementType.CONSTRUCTOR,
        ElementType.PARAMETER,
        ElementType.TYPE_USE
})
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Constraint(validatedBy = UsernameValidator.class)
public @interface Username {

    /**
     * @return 校验失败时的提示信息
     */
    String message() default "用户名必须为 4-30 位字母或数字";

    /**
     * @return 分组校验标识
     */
    Class<?>[] groups() default {};

    /**
     * @return 约束元数据负载
     */
    Class<? extends Payload>[] payload() default {};

}
