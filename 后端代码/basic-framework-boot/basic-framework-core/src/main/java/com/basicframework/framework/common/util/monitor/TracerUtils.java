package com.basicframework.framework.common.util.monitor;

import org.slf4j.MDC;

/**
 * 链路追踪工具类。
 *
 * <p>基于 SLF4J {@link MDC} 读取当前线程的 {@code traceId}，未设置时返回空串。</p>
 *
 * @author shady
 */
public final class TracerUtils {

    private TracerUtils() {
    }

    /**
     * 获得当前线程的链路追踪编号。
     *
     * @return 链路追踪编号，不存在时返回空串
     */
    public static String getTraceId() {
        String traceId = MDC.get("traceId");
        return traceId != null ? traceId : "";
    }

}
