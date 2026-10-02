package com.basicframework.framework.desensitize.core.regex.handler;

import com.basicframework.framework.desensitize.core.regex.annotation.RegexDesensitize;

/**
 * {@link RegexDesensitize} 的正则脱敏处理器
 *
 * @author 李杰
 */
public class DefaultRegexDesensitizationHandler extends AbstractRegexDesensitizationHandler<RegexDesensitize> {

    /**
     * 获取正则表达式。
     *
     * @param annotation annotation 参数
     * @return 查询或转换后的结果
     */
    @Override
    String getRegex(RegexDesensitize annotation) {
        return annotation.regex();
    }

    /**
     * 获取当前脱敏规则使用的字符替换器。
     *
     * @param annotation annotation 参数
     * @return 查询或转换后的结果
     */
    @Override
    String getReplacer(RegexDesensitize annotation) {
        return annotation.replacer();
    }

    /**
     * 获取禁用标记。
     *
     * @param annotation annotation 参数
     * @return 查询或转换后的结果
     */
    @Override
    public String getDisable(RegexDesensitize annotation) {
        return annotation.disable();
    }

}
