package com.basicframework.framework.dict.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 字典值范围校验注解。
 * <p>
 * 用于校验字段、方法参数或集合元素是否属于指定字典类型的可用字典值。
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
@Constraint(
        validatedBy = {InDictValidator.class, InDictCollectionValidator.class}
)
public @interface InDict {

    /**
     * 数据字典 type
     *
     * @return 字典类型
     */
    String type();

    /**
     * 校验失败提示，{value} 会被替换为字典允许值。
     *
     * @return 校验失败提示
     */
    String message() default "必须在指定范围 {value}";

    /**
     * Bean Validation 分组。
     *
     * @return 校验分组
     */
    Class<?>[] groups() default {};

    /**
     * Bean Validation 负载。
     *
     * @return 校验负载
     */
    Class<? extends Payload>[] payload() default {};

}
