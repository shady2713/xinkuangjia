package com.basicframework.framework.desensitize.core.regex.handler;

import com.basicframework.framework.desensitize.core.regex.annotation.EmailDesensitize;

/**
 * {@link EmailDesensitize} 的脱敏处理器
 *
 * @author 李杰
 */
public class EmailDesensitizationHandler extends AbstractRegexDesensitizationHandler<EmailDesensitize> {

    /**
     * 获取正则表达式。
     *
     * @param annotation annotation 参数
     * @return 查询或转换后的结果
     */
    @Override
    String getRegex(EmailDesensitize annotation) {
        return annotation.regex();
    }

    /**
     * 获取当前脱敏规则使用的字符替换器。
     *
     * @param annotation annotation 参数
     * @return 查询或转换后的结果
     */
    @Override
    String getReplacer(EmailDesensitize annotation) {
        return annotation.replacer();
    }

}
