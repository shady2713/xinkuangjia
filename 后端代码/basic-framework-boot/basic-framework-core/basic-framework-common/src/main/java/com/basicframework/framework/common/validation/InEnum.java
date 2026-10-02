package com.basicframework.framework.common.validation;

import com.basicframework.framework.common.core.ArrayValuable;
import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.*;

/**
 * 枚举取值范围校验注解。
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
        validatedBy = {InEnumValidator.class, InEnumCollectionValidator.class}
)
public @interface InEnum {

    /**
     * @return 实现 ArrayValuable 接口的类
     */
    Class<? extends ArrayValuable<?>> value();

    /**
     * @return 校验失败时的提示信息，{value} 会被替换为枚举取值范围
     */
    String message() default "必须在指定范围 {value}";

    /**
     * @return 分组校验标识
     */
    Class<?>[] groups() default {};

    /**
     * @return 约束元数据负载
     */
    Class<? extends Payload>[] payload() default {};

}
