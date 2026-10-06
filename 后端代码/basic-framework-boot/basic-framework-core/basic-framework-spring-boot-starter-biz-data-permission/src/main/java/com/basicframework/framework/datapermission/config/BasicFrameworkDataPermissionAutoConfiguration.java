package com.basicframework.framework.datapermission.config;

import com.basicframework.framework.datapermission.core.aop.DataPermissionAnnotationAdvisor;
import com.basicframework.framework.datapermission.core.db.DataPermissionRuleHandler;
import com.basicframework.framework.datapermission.core.rule.DataPermissionRule;
import com.basicframework.framework.datapermission.core.rule.DataPermissionRuleFactory;
import com.basicframework.framework.datapermission.core.rule.DataPermissionRuleFactoryImpl;
import com.basicframework.framework.mybatis.core.util.MyBatisUtils;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.DataPermissionInterceptor;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.Bean;

import java.util.List;

/**
 * 数据权限自动配置类。
 *
 * <p>负责注册数据权限规则工厂、MyBatis Plus 数据权限拦截器和 {@link DataPermissionAnnotationAdvisor}，
 * 让业务代码可以通过 {@code @DataPermission} 控制 SQL 查询范围。</p>
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@AutoConfiguration
public class BasicFrameworkDataPermissionAutoConfiguration {

    /**
     * 创建数据权限规则工厂。
     *
     * @param rules 容器中所有数据权限规则
     * @return 数据权限规则工厂
     */
    @Bean
    public DataPermissionRuleFactory dataPermissionRuleFactory(List<DataPermissionRule> rules) {
        return new DataPermissionRuleFactoryImpl(rules);
    }

    /**
     * 创建数据权限 SQL 处理器，并注册到 MyBatis Plus 拦截器链。
     *
     * <p>数据权限拦截器需要放在分页插件前，避免分页 SQL 先生成后再追加数据权限条件。</p>
     *
     * @param interceptor MyBatis Plus 主拦截器
     * @param ruleFactory 数据权限规则工厂
     * @return 数据权限 SQL 处理器
     */
    @Bean
    public DataPermissionRuleHandler dataPermissionRuleHandler(MybatisPlusInterceptor interceptor,
                                                               DataPermissionRuleFactory ruleFactory) {
        DataPermissionRuleHandler handler = new DataPermissionRuleHandler(ruleFactory);
        DataPermissionInterceptor inner = new DataPermissionInterceptor(handler);
        MyBatisUtils.addInterceptor(interceptor, inner, 0);
        return handler;
    }

    /**
     * 创建 {@link com.basicframework.framework.datapermission.core.annotation.DataPermission} 注解切面。
     *
     * @return 数据权限注解 Advisor
     */
    @Bean
    public DataPermissionAnnotationAdvisor dataPermissionAnnotationAdvisor() {
        return new DataPermissionAnnotationAdvisor();
    }

}
