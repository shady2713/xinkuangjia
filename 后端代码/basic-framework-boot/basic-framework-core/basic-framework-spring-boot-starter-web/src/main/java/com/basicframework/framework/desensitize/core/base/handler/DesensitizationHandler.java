package com.basicframework.framework.desensitize.core.base.handler;

import cn.hutool.core.util.ReflectUtil;

import java.lang.annotation.Annotation;

/**
 * 脱敏处理器接口
 *
 * @author 李杰
 */
public interface DesensitizationHandler<T extends Annotation> {

    /**
     * 脱敏
     *
     * @param origin     原始字符串
     * @param annotation 注解信息
     * @return 脱敏后的字符串
     */
    String desensitize(String origin, T annotation);

    /**
     * 是否禁用脱敏的 Spring EL 表达式
     *
     * 如果返回 true 则跳过脱敏
     *
     * @param annotation 注解信息
     * @return 是否禁用脱敏的 Spring EL 表达式
     */
    @SuppressWarnings("PMD.GenericExceptionSwallowed") // 注解未声明 disable() 时反射必然失败，属探测语义；失败即表示「不额外禁用脱敏」，不是吞掉故障。
    default String getDisable(T annotation) {
        // 约定：默认就是 enable() 属性。如果不符合，子类重写
        try {
            return (String) ReflectUtil.invoke(annotation, "disable");
        } catch (Exception ex) {
            return "";
        }
    }

}
