package com.basicframework.framework.common.exception.enums;

import java.util.Map;

/**
 * 业务异常错误码号段分配表，避免跨模块定义重复错误码。
 *
 * <p>错误码固定为 10 位十进制正整数 {@code 1_SSS_MMM_CCC}：
 * 第一段 {@code 1} 表示业务异常，第二段 {@code SSS} 表示模块号段（步长 1,000,000），
 * 第三段 {@code MMM} 表示子域，第四段 {@code CCC} 表示具体错误序号。</p>
 *
 * @author 李杰
 */
public final class ServiceErrorCodeRange {

    /** 基础设施模块 {@code module-infra} 起始错误码（含）。 */
    public static final int INFRA_BEGIN = 1_001_000_000;
    /** 基础设施模块 {@code module-infra} 结束错误码（不含）。 */
    public static final int INFRA_END = 1_002_000_000;

    /** 系统管理模块 {@code module-system} 起始错误码（含）。 */
    public static final int SYSTEM_BEGIN = 1_002_000_000;
    /** 系统管理模块 {@code module-system} 结束错误码（不含）。 */
    public static final int SYSTEM_END = 1_003_000_000;

    /** 模块名称到半开区间 {@code [begin, end)} 的权威注册表（新业务模块从 1_003_000_000 起递增）。 */
    public static final Map<String, int[]> MODULE_RANGES = Map.of(
            "infra", new int[]{INFRA_BEGIN, INFRA_END},
            "system", new int[]{SYSTEM_BEGIN, SYSTEM_END}
    );

    /**
     * 静态常量工具类，禁止外部实例化。
     */
    private ServiceErrorCodeRange() {
    }

}
