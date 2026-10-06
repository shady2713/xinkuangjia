package com.basicframework.framework.desensitize.core.regex.handler;

import com.basicframework.framework.desensitize.core.regex.annotation.RegexDesensitize;

/**
 * {@link RegexDesensitize} 的正则脱敏处理器
 *
 * @author gaibu
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
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
