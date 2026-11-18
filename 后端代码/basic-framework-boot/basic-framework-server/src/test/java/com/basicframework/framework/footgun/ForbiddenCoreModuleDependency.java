package com.basicframework.framework.footgun;

import com.basicframework.module.system.dal.mysql.footgun.ForbiddenFootgunMapper;

/**
 * 反向失败夹具：公共基础层违规引用业务模块类型。
 *
 * @author shady2713
 */
public class ForbiddenCoreModuleDependency {

    /** 故意持有业务模块的 Mapper 引用，用于触发模块反向依赖失败。 */
    private final ForbiddenFootgunMapper mapper;

    /**
     * 构造违规依赖夹具。
     *
     * @param mapper 业务模块假 Mapper
     */
    public ForbiddenCoreModuleDependency(ForbiddenFootgunMapper mapper) {
        this.mapper = mapper;
    }

    /**
     * 读取持有的假 Mapper，避免字段被视为未使用。
     *
     * @return 持有的假 Mapper
     */
    public ForbiddenFootgunMapper getMapper() {
        return mapper;
    }
}
