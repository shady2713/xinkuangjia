package com.basicframework.framework.datapermission.config;

import com.basicframework.framework.common.biz.system.permission.PermissionCommonApi;
import com.basicframework.framework.datapermission.core.rule.dept.DeptDataPermissionRule;
import com.basicframework.framework.datapermission.core.rule.dept.DeptDataPermissionRuleCustomizer;
import com.basicframework.framework.security.core.LoginUser;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.context.annotation.Bean;

import java.util.List;

/**
 * 基于部门的数据权限自动配置类。
 *
 * <p>当业务侧提供 {@link DeptDataPermissionRuleCustomizer} 后，自动创建 {@link DeptDataPermissionRule}
 * 并应用所有自定义的表字段映射配置。</p>
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@AutoConfiguration
@ConditionalOnClass(LoginUser.class)
@ConditionalOnBean(value = {DeptDataPermissionRuleCustomizer.class})
public class BasicFrameworkDeptDataPermissionAutoConfiguration {

    /**
     * 创建基于部门的数据权限规则。
     *
     * @param permissionApi 权限公共 API，用于查询登录用户的数据权限范围
     * @param customizers 业务侧提供的部门数据权限规则自定义器
     * @return 基于部门的数据权限规则
     */
    @Bean
    public DeptDataPermissionRule deptDataPermissionRule(PermissionCommonApi permissionApi,
                                                         List<DeptDataPermissionRuleCustomizer> customizers) {
        DeptDataPermissionRule rule = new DeptDataPermissionRule(permissionApi);
        customizers.forEach(customizer -> customizer.customize(rule));
        return rule;
    }

}
