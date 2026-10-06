package com.basicframework.framework.dict.validation;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.dict.core.DictFrameworkUtils;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

import java.util.Collection;
import java.util.List;

/**
 * 集合字典范围校验器。
 *
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-framework/yudao-spring-boot-starter-excel/src/main/java/cn/iocoder/yudao/framework/dict/validation/
 * 上游文件续：InDictCollectionValidator.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：jakarta 命名空间适配；字典值比较补空值防护；补全类型与方法职责 JavaDoc。
 */
public class InDictCollectionValidator implements ConstraintValidator<InDict, Collection<?>> {

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
     * 校验集合内全部元素是否都属于指定字典类型；空集合值交由必填类注解处理。
     *
     * @param list 待校验集合
     * @param context 校验上下文
     * @return 是否校验通过
     */
    @Override
    public boolean isValid(Collection<?> list, ConstraintValidatorContext context) {
        // 为空时，默认不校验，即认为通过
        if (CollUtil.isEmpty(list)) {
            return true;
        }
        // 校验全部通过
        List<String> dbValues = DictFrameworkUtils.getDictDataValueList(dictType);
        boolean match = list.stream().allMatch(v -> dbValues.stream()
                .anyMatch(dbValue -> v != null && StrUtil.equalsIgnoreCase(dbValue, v.toString())));
        if (match) {
            return true;
        }

        // 校验不通过，自定义提示语句
        context.disableDefaultConstraintViolation(); // 禁用默认的 message 的值
        context.buildConstraintViolationWithTemplate(
                StrUtil.replace(context.getDefaultConstraintMessageTemplate(), "{value}", CollUtil.join(dbValues, ","))
        ).addConstraintViolation(); // 重新添加错误提示语句
        return false;
    }

}

