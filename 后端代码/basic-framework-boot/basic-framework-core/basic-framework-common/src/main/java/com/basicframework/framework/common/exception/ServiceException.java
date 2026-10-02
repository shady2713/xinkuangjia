package com.basicframework.framework.common.exception;

import com.basicframework.framework.common.exception.enums.ServiceErrorCodeRange;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 业务逻辑异常 Exception
 *
 * @author 李杰
 */
@Data
@EqualsAndHashCode(callSuper = true)
public final class ServiceException extends RuntimeException {

    /**
     * 业务错误码
     *
     * @see ServiceErrorCodeRange
     */
    private Integer code;
    /**
     * 错误提示
     */
    private String message;

    /**
     * 空构造方法，避免反序列化问题
     */
    public ServiceException() {
    }

    /**
     * 根据错误码对象创建业务异常。
     *
     * @param errorCode 错误码对象
     */
    public ServiceException(ErrorCode errorCode) {
        this.code = errorCode.getCode();
        this.message = errorCode.getMsg();
    }

    /**
     * 根据错误码和提示信息创建业务异常。
     *
     * @param code 错误码
     * @param message 错误提示
     */
    public ServiceException(Integer code, String message) {
        this.code = code;
        this.message = message;
    }

    /**
     * 获取业务错误码。
     *
     * @return 业务错误码
     */
    public Integer getCode() {
        return code;
    }

    /**
     * 设置业务错误码，支持链式调用。
     *
     * @param code 业务错误码
     * @return 当前异常对象
     */
    public ServiceException setCode(Integer code) {
        this.code = code;
        return this;
    }

    /**
     * 获取业务错误提示。
     *
     * @return 业务错误提示
     */
    @Override
    public String getMessage() {
        return message;
    }

    /**
     * 设置业务错误提示，支持链式调用。
     *
     * @param message 业务错误提示
     * @return 当前异常对象
     */
    public ServiceException setMessage(String message) {
        this.message = message;
        return this;
    }

}
