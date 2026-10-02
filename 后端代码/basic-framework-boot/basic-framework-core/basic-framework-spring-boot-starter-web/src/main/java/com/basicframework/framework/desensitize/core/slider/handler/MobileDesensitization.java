package com.basicframework.framework.desensitize.core.slider.handler;

import com.basicframework.framework.desensitize.core.slider.annotation.MobileDesensitize;

/**
 * {@link MobileDesensitize} 的脱敏处理器
 *
 * @author 李杰
 */
public class MobileDesensitization extends AbstractSliderDesensitizationHandler<MobileDesensitize> {

    /**
     * 获取脱敏时需要保留的前缀长度。
     *
     * @param annotation annotation 参数
     * @return 查询或转换后的结果
     */
    @Override
    Integer getPrefixKeep(MobileDesensitize annotation) {
        return annotation.prefixKeep();
    }

    /**
     * 获取脱敏时需要保留的后缀长度。
     *
     * @param annotation annotation 参数
     * @return 查询或转换后的结果
     */
    @Override
    Integer getSuffixKeep(MobileDesensitize annotation) {
        return annotation.suffixKeep();
    }

    /**
     * 获取当前脱敏规则使用的字符替换器。
     *
     * @param annotation annotation 参数
     * @return 查询或转换后的结果
     */
    @Override
    String getReplacer(MobileDesensitize annotation) {
        return annotation.replacer();
    }

}
