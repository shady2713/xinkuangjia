package com.basicframework.module.system.service.footgun;

/**
 * 反向失败夹具：产品形态的标准流与堆栈打印用法。
 *
 * @author shady
 */
public class ForbiddenStandardStreamUsage {

    /**
     * 故意使用 System.out 与 printStackTrace，供规则检测。
     */
    public void leak() {
        System.out.println("forbidden-standard-stream");
        new IllegalStateException("forbidden-stack").printStackTrace();
    }
}
