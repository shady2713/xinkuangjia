package com.basicframework.framework.xss.core.clean;

/**
 * 对 html 文本中的有 Xss 风险的数据进行清理
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-framework/yudao-spring-boot-starter-web/src/main/java/cn/iocoder/yudao/framework/xss/core/clean/XssCleaner.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；该类型自身无其他改动。
 */
public interface XssCleaner {

    /**
     * 清理有 Xss 风险的文本
     *
     * @param html 原 html
     * @return 清理后的 html
     */
    String clean(String html);

}
