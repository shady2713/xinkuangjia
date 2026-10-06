package com.basicframework.framework.datasource.core.enums;

/**
 * 多数据源名称常量。
 *
 * <p>通过在方法上使用 {@link com.baomidou.dynamic.datasource.annotation.DS} 注解切换数据源。
 * 默认数据源为 {@link #MASTER}。</p>
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-framework/yudao-spring-boot-starter-mybatis/src/main/java/cn/
 * 上游文件续：iocoder/yudao/framework/datasource/core/enums/DataSourceEnum.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；该类型自身无其他改动。
 * 来源验收：尚未验收
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
