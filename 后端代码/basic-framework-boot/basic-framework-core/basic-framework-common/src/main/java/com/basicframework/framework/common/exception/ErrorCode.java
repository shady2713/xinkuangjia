package com.basicframework.framework.common.exception;

import com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants;
import com.basicframework.framework.common.exception.enums.ServiceErrorCodeRange;
import lombok.Data;

/**
 * 错误码对象
 *
 * 全局错误码，占用 [0, 999], 参见 {@link GlobalErrorCodeConstants}
 * 业务异常错误码，占用 [1 000 000 000, +∞)，参见 {@link ServiceErrorCodeRange}
 *
 * 错误码设计成对象，便于后续扩展国际化、文案映射等能力。
 *
 * @author 李杰
 */
@Data
public class ErrorCode {

    /**
     * 错误码
     */
    private final Integer code;
    /**
     * 错误提示
     */
    private final String msg;

    /**
     * 创建错误码对象。
     *
     * @param code 错误码
     * @param message 错误提示
     */
    public ErrorCode(Integer code, String message) {
        this.code = code;
        this.msg = message;
    }

}
