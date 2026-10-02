package com.basicframework.framework.datasource.core.enums;

/**
 * 多数据源名称常量。
 *
 * <p>通过在方法上使用 {@link com.baomidou.dynamic.datasource.annotation.DS} 注解切换数据源。
 * 默认数据源为 {@link #MASTER}。</p>
 *
 * @author 李杰
 */
public interface DataSourceEnum {

    /**
     * 主库，推荐使用 {@link com.baomidou.dynamic.datasource.annotation.Master} 注解
     */
    String MASTER = "master";
    /**
     * 从库，推荐使用 {@link com.baomidou.dynamic.datasource.annotation.Slave} 注解
     */
    String SLAVE = "slave";

}
