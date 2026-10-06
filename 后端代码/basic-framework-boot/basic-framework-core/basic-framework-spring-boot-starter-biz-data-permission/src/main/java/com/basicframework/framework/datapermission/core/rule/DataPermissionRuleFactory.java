package com.basicframework.framework.datapermission.core.rule;

import java.util.List;

/**
 * {@link DataPermissionRule} 工厂接口。
 *
 * <p>作为数据权限规则容器，根据当前调用上下文筛选实际需要参与 SQL 重写的规则。</p>
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
public interface DataPermissionRuleFactory {

    /**
     * 获得系统内注册的所有数据权限规则。
     *
     * @return 所有数据权限规则
     */
    List<DataPermissionRule> getDataPermissionRules();

    /**
     * 获得指定 Mapper 当前可用的数据权限规则。
     *
     * @return 当前 Mapper 可用的数据权限规则
     */
    List<DataPermissionRule> getDataPermissionRule(String mappedStatementId);

}
