package com.basicframework.framework.common.validation;

import com.basicframework.framework.common.util.validation.ValidationUtils;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/**
 * 百分比取值格式校验器。
 *
 * @author 李杰
 */
public class PercentValidator implements ConstraintValidator<Percent, Object> {

    /**
     * 校验数值或字符串是否为合法百分比；空值交由必填类注解处理。
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
            return ValidationUtils.isPercent(number);
        }
        if (value instanceof CharSequence charSequence) {
            return ValidationUtils.isPercent(charSequence.toString());
        }
        return false;
    }

}
