package com.basicframework.framework.common.validation;

import cn.hutool.core.text.CharSequenceUtil;
import cn.hutool.core.util.PhoneUtil;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/**
 * 固话或手机号格式校验器。
 *
 * @author 李杰
 */
public class TelephoneValidator implements ConstraintValidator<Telephone, String> {

    /**
     * 校验电话格式；空值交由必填类注解处理。
     *
     * @param value 待校验值
     * @param context 校验上下文
     * @return 是否校验通过
     */
    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (CharSequenceUtil.isEmpty(value)) {
            return true;
        }
        return PhoneUtil.isTel(value) || PhoneUtil.isPhone(value);
    }

}
