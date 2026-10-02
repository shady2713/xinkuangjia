package com.basicframework.framework.desensitize.core.slider.handler;

import com.basicframework.framework.desensitize.core.slider.annotation.CarLicenseDesensitize;

/**
 * {@link CarLicenseDesensitize} 的脱敏处理器
 *
 * @author 李杰
 */
public class CarLicenseDesensitization extends AbstractSliderDesensitizationHandler<CarLicenseDesensitize> {

    /**
     * 获取脱敏时需要保留的前缀长度。
     *
     * @param annotation annotation 参数
     * @return 查询或转换后的结果
     */
    @Override
    Integer getPrefixKeep(CarLicenseDesensitize annotation) {
        return annotation.prefixKeep();
    }

    /**
     * 获取脱敏时需要保留的后缀长度。
     *
     * @param annotation annotation 参数
     * @return 查询或转换后的结果
     */
    @Override
    Integer getSuffixKeep(CarLicenseDesensitize annotation) {
        return annotation.suffixKeep();
    }

    /**
     * 获取当前脱敏规则使用的字符替换器。
     *
     * @param annotation annotation 参数
     * @return 查询或转换后的结果
     */
    @Override
    String getReplacer(CarLicenseDesensitize annotation) {
        return annotation.replacer();
    }

    /**
     * 获取禁用标记。
     *
     * @param annotation annotation 参数
     * @return 查询或转换后的结果
     */
    @Override
    public String getDisable(CarLicenseDesensitize annotation) {
        return annotation.disable();
    }

}
