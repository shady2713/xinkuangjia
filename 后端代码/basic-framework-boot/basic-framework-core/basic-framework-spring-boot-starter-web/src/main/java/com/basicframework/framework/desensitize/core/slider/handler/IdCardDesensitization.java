package com.basicframework.framework.desensitize.core.slider.handler;

import com.basicframework.framework.desensitize.core.slider.annotation.IdCardDesensitize;

/**
 * {@link IdCardDesensitize} 的脱敏处理器
 *
 * @author 李杰
 */
public class IdCardDesensitization extends AbstractSliderDesensitizationHandler<IdCardDesensitize> {
    /**
     * 获取脱敏时需要保留的前缀长度。
     *
     * @param annotation annotation 参数
     * @return 查询或转换后的结果
     */
    @Override
    Integer getPrefixKeep(IdCardDesensitize annotation) {
        return annotation.prefixKeep();
    }

    /**
     * 获取脱敏时需要保留的后缀长度。
     *
     * @param annotation annotation 参数
     * @return 查询或转换后的结果
     */
    @Override
    Integer getSuffixKeep(IdCardDesensitize annotation) {
        return annotation.suffixKeep();
    }

    /**
     * 获取当前脱敏规则使用的字符替换器。
     *
     * @param annotation annotation 参数
     * @return 查询或转换后的结果
     */
    @Override
    String getReplacer(IdCardDesensitize annotation) {
        return annotation.replacer();
    }

}
