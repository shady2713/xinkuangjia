package com.basicframework.module.system.framework.datapermission.config;

import com.basicframework.framework.datapermission.core.rule.dept.DeptDataPermissionRule;
import com.basicframework.framework.datapermission.core.rule.dept.DeptDataPermissionRuleCustomizer;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;

/**
 * 验证 system 模块注册的数据权限列映射：用户表按部门列过滤、部门表按自身主键过滤、
 * 同时为用户表开启“仅本人”列映射。
 *
 * <p>这三条映射决定部门数据权限拼接出的 SQL：用户表默认按 {@code dept_id} 过滤，部门表
 * 本身就是部门主体因此使用主键 {@code id}，用户表的 {@code id} 用于“仅本人”范围。任何一处
 * 列写错都会让数据范围失效（越权可见）或直接报错，而编译与启动都不会发现。</p>
 *
 * @author shady2713
 */
class DataPermissionConfigurationTest {

    /** 注册的定制器必须把三条列映射精确交给规则对象。 */
    @Test
    void customizerRegistersDeptAndUserColumns() {
        DeptDataPermissionRuleCustomizer customizer =
                new DataPermissionConfiguration().sysDeptDataPermissionRuleCustomizer();
        assertThat(customizer).as("数据权限配置必须注册定制器 Bean").isNotNull();

        DeptDataPermissionRule rule = mock(DeptDataPermissionRule.class);

        customizer.customize(rule);

        verify(rule).addDeptColumn(AdminUserDO.class);
        verify(rule).addDeptColumn(DeptDO.class, "id");
        verify(rule).addUserColumn(AdminUserDO.class, "id");
        verifyNoMoreInteractions(rule);
    }
}
