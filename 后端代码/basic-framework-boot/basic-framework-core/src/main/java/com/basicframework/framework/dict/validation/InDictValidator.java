package com.basicframework.framework.dict.validation;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.dict.core.DictFrameworkUtils;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

import java.util.List;

/**
 * 单值字典范围校验器。
 *
 * @author 李杰
 */
public class InDictValidator implements ConstraintValidator<InDict, Object> {

    private String dictType;

    /**
     * 初始化待校验的字典类型。
     *
     * @param annotation 字典范围校验注解
     */
    @Override
    public void initialize(InDict annotation) {
        this.dictType = annotation.type();
    }

    /**
     * 校验单个值是否属于指定字典类型；空值交由必填类注解处理。
     *
     * @param value 待校验值
     * @param context 校验上下文
     * @return 是否校验通过
     */
    @Override
    public boolean isValid(Object value, ConstraintValidatorContext context) {
        // 为空时，默认不校验，即认为通过
        if (value == null) {
            return true;
        }
        // 校验通过
        final List<String> values = DictFrameworkUtils.getDictDataValueList(dictType);
        boolean match = values.stream().anyMatch(v -> StrUtil.equalsIgnoreCase(v, value.toString()));
        if (match) {
            return true;
        }

        // 校验不通过，自定义提示语句
        context.disableDefaultConstraintViolation(); // 禁用默认的 message 的值
        context.buildConstraintViolationWithTemplate(
                StrUtil.replace(context.getDefaultConstraintMessageTemplate(), "{value}", CollUtil.join(values, ","))
        ).addConstraintViolation(); // 重新添加错误提示语句
        return false;
    }

}

