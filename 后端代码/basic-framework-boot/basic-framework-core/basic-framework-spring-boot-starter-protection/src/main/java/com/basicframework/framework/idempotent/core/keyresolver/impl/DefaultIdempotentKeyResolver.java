package com.basicframework.framework.idempotent.core.keyresolver.impl;

import cn.hutool.crypto.SecureUtil;
import com.basicframework.framework.idempotent.core.annotation.Idempotent;
import com.basicframework.framework.idempotent.core.keyresolver.IdempotentKeyResolver;
import com.basicframework.framework.protection.core.keyresolver.KeyResolverUtils;
import org.aspectj.lang.JoinPoint;

/**
 * 默认（全局级别）幂等 Key 解析器，使用方法名 + 方法参数，组装成一个 Key
 *
 * 为了避免 Key 过长，使用 MD5 进行“压缩”
 *
 * @author 李杰
 */
public class DefaultIdempotentKeyResolver implements IdempotentKeyResolver {

    /**
     * 解析当前扩展点对应的业务值。
     *
     * @param joinPoint joinPoint 参数
     * @param idempotent idempotent 参数
     * @return 查询或转换后的结果
     */
    @Override
    public String resolver(JoinPoint joinPoint, Idempotent idempotent) {
        String methodName = joinPoint.getSignature().toString();
        String argsStr = KeyResolverUtils.joinMethodArgs(joinPoint);
        return SecureUtil.md5(methodName + argsStr);
    }

}
