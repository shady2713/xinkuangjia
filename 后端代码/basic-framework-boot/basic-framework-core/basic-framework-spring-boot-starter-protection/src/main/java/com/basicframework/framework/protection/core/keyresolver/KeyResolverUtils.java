package com.basicframework.framework.protection.core.keyresolver;

import cn.hutool.core.util.ArrayUtil;
import cn.hutool.core.util.StrUtil;
import org.aspectj.lang.JoinPoint;

/**
 * 保护机制 Key 解析公共工具，统一处理方法参数的稳定拼接规则。
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
public final class KeyResolverUtils {

    /**
     * 工具类不允许实例化。
     */
    private KeyResolverUtils() {
    }

    /**
     * 拼接方法参数，并排除不适合序列化到限流或幂等 Key 的 Web 对象。
     *
     * @param joinPoint 当前方法连接点
     * @return 使用英文逗号拼接的参数文本；没有参数时返回空字符串
     */
    public static String joinMethodArgs(JoinPoint joinPoint) {
        Object[] args = joinPoint.getArgs();
        if (ArrayUtil.isEmpty(args)) {
            return "";
        }
        return ArrayUtil.join(args, ",", item -> {
            if (item == null) {
                return "";
            }
            // Servlet 和 Spring Web 对象通常不可稳定序列化，不能参与保护 Key 计算。
            String className = item.getClass().getName();
            if (StrUtil.startWithAny(className, "javax.servlet", "jakarta.servlet", "org.springframework.web")) {
                return "";
            }
            return item;
        });
    }

}
