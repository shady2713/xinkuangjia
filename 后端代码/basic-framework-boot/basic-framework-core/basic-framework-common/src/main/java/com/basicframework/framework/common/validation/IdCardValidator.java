package com.basicframework.framework.common.validation;

import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.util.validation.ValidationUtils;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/**
 * 身份证号格式校验器。
 *
 * @author 李杰
 */
public class IdCardValidator implements ConstraintValidator<IdCard, String> {

    /**
     * 校验身份证号格式；空值交由必填类注解处理。
     *
     * @param value 待校验值
     * @param context 校验上下文
     * @return 是否校验通过
     */
    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (StrUtil.isEmpty(value)) {
            return true;
        }
        return ValidationUtils.isIdCard(value);
    }

}
