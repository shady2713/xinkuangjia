package com.basicframework.framework.common.validation;

import cn.hutool.core.collection.CollUtil;
import com.basicframework.framework.common.core.ArrayValuable;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.List;

/**
 * 集合枚举取值范围校验器。
 *
 * @author 李杰
 */
public class InEnumCollectionValidator implements ConstraintValidator<InEnum, Collection<?>> {

    private List<?> values;

    /**
     * 从枚举定义中读取允许的取值范围。
     *
     * @param annotation 枚举范围校验注解
     */
    @Override
    public void initialize(InEnum annotation) {
        ArrayValuable<?>[] values = annotation.value().getEnumConstants();
        if (values.length == 0) {
            this.values = Collections.emptyList();
        } else {
            this.values = Arrays.asList(values[0].array());
        }
    }

    /**
     * 校验集合内所有元素是否都在枚举允许范围内；空集合值交由必填类注解处理。
     *
     * @param list 待校验集合
     * @param context 校验上下文
     * @return 是否校验通过
     */
    @Override
    public boolean isValid(Collection<?> list, ConstraintValidatorContext context) {
        if (list == null) {
            return true;
        }
        // 校验通过
        if (CollUtil.containsAll(values, list)) {
            return true;
        }
        // 校验不通过，自定义提示语句
        context.disableDefaultConstraintViolation(); // 禁用默认的 message 的值
        context.buildConstraintViolationWithTemplate(context.getDefaultConstraintMessageTemplate()
                .replaceAll("\\{value}", CollUtil.join(list, ","))).addConstraintViolation(); // 重新添加错误提示语句
        return false;
    }

}

