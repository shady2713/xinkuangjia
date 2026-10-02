package com.basicframework.framework.desensitize.core.slider.handler;

import com.basicframework.framework.desensitize.core.slider.annotation.PasswordDesensitize;

/**
 * {@link PasswordDesensitize} 的码脱敏处理器
 *
 * @author 李杰
 */
public class PasswordDesensitization extends AbstractSliderDesensitizationHandler<PasswordDesensitize> {
    /**
     * 获取脱敏时需要保留的前缀长度。
     *
     * @param annotation annotation 参数
     * @return 查询或转换后的结果
     */
    @Override
    Integer getPrefixKeep(PasswordDesensitize annotation) {
        return annotation.prefixKeep();
    }

    /**
     * 获取脱敏时需要保留的后缀长度。
     *
     * @param annotation annotation 参数
     * @return 查询或转换后的结果
     */
    @Override
    Integer getSuffixKeep(PasswordDesensitize annotation) {
        return annotation.suffixKeep();
    }

    /**
     * 获取当前脱敏规则使用的字符替换器。
     *
     * @param annotation annotation 参数
     * @return 查询或转换后的结果
     */
    @Override
    String getReplacer(PasswordDesensitize annotation) {
        return annotation.replacer();
    }

}
