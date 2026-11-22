package com.basicframework.framework.datapermission.core.rule.dept;

/**
 * {@link DeptDataPermissionRule} 的自定义配置接口。
 *
 * <p>业务模块通过实现该接口声明哪些表需要按部门编号或用户编号追加数据权限条件。</p>
 *
 * @author 李杰
 */
@FunctionalInterface
public interface DeptDataPermissionRuleCustomizer {

    /**
     * 自定义部门数据权限规则。
     *
     * <p>可调用 {@link DeptDataPermissionRule#addDeptColumn(Class, String)} 配置基于部门编号的过滤规则，
     * 也可调用 {@link DeptDataPermissionRule#addUserColumn(Class, String)} 配置基于用户编号的过滤规则。</p>
     *
     * @param rule 权限规则
     */
    void customize(DeptDataPermissionRule rule);

}
