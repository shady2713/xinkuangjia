package com.basicframework.framework.datapermission.core.annotation;

import com.basicframework.framework.datapermission.core.rule.DataPermissionRule;

import java.lang.annotation.*;

/**
 * 数据权限注解。
 *
 * <p>可声明在类或方法上，用于控制当前调用链使用哪些数据权限规则，也可以临时关闭数据权限过滤。</p>
 *
 * @author 李杰
 */
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface DataPermission {

    /**
     * 当前类或方法是否开启数据权限
     * 即使不添加 @DataPermission 注解，默认是开启状态
     * 可通过设置 enable 为 false 禁用
     *
     * @return 是否开启数据权限
     */
    boolean enable() default true;

    /**
     * 生效的数据权限规则数组，优先级高于 {@link #excludeRules()}
     *
     * @return 仅允许生效的数据权限规则类型
     */
    Class<? extends DataPermissionRule>[] includeRules() default {};

    /**
     * 排除的数据权限规则数组，优先级最低
     *
     * @return 需要排除的数据权限规则类型
     */
    Class<? extends DataPermissionRule>[] excludeRules() default {};

}
