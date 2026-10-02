package com.basicframework.framework.common.validation;

import com.basicframework.framework.common.util.validation.ValidationUtils;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/**
 * 数量取值格式校验器。
 *
 * @author 李杰
 */
public class QuantityValidator implements ConstraintValidator<Quantity, Object> {

    /**
     * 校验数值是否为非负整数；空值交由必填类注解处理。
     *
     * @param value 待校验值
     * @param context 校验上下文
     * @return 是否校验通过
     */
    @Override
    public boolean isValid(Object value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }
        if (value instanceof Number number) {
            return ValidationUtils.isQuantity(number);
        }
        return false;
    }

}
