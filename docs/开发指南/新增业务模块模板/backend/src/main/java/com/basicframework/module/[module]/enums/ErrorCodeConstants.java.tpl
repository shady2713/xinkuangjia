package com.basicframework.module.[module].enums;

import com.basicframework.framework.common.exception.ErrorCode;

/**
 * [module] 模块错误码枚举类。
 *
 * <p>[module] 业务使用 [error-segment]-000 段。新增业务前必须确认该段未被占用，核对命令：
 * {@code grep -rn "1_00[0-9]_[0-9]\{3\}_[0-9]\{3\}" --include=ErrorCodeConstants.java 后端代码}。
 * 段号一旦发布不得复用或改号，否则前端与运维看到的错误码会漂移。</p>
 *
 * <p>占位符：[module]、[error-segment]（形如 1_003_000，必须是未占用段）、
 * [ENTITY]（实体标识，大写下划线）、[entity-name]（业务中文名）。</p>
 *
 * @author [author]
 */
public interface ErrorCodeConstants {

    /** [entity-name]不存在：按编号更新、删除或查询时记录已被移除。 */
    ErrorCode [ENTITY]_NOT_EXISTS = new ErrorCode([error-segment]_000, "[entity-name]不存在");

    /** [entity-name]名称重复：名称是业务唯一键，重复将导致前端无法区分记录。 */
    ErrorCode [ENTITY]_NAME_DUPLICATE = new ErrorCode([error-segment]_001, "已经存在名为 {} 的[entity-name]");

}
