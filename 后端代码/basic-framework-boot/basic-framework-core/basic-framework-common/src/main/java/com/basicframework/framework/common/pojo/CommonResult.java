package com.basicframework.framework.common.pojo;

import cn.hutool.core.lang.Assert;
import com.basicframework.framework.common.exception.ErrorCode;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants;
import com.basicframework.framework.common.exception.util.ServiceExceptionUtil;
import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;

import java.io.Serializable;
import java.util.Objects;

/**
 * 通用返回
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-framework/yudao-common/src/main/java/cn/iocoder/yudao/framework/common/pojo/CommonResult.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地补充注释 32 行。
 *
 * @param <T> 数据泛型
 */
@Data
public class CommonResult<T> implements Serializable {

    /**
     * 错误码
     *
     * @see ErrorCode#getCode()
     */
    private Integer code;
    /**
     * 错误提示，用户可阅读
     *
     * @see ErrorCode#getMsg() ()
     */
    private String msg;
    /**
     * 返回数据
     */
    private T data;

    /**
     * 将传入的 result 对象，转换成另外一个泛型结果的对象
     *
     * 因为 A 方法返回的 CommonResult 对象，不满足调用其的 B 方法的返回，所以需要进行转换。
     *
     * @param result 传入的 result 对象
     * @param <T> 返回的泛型
     * @return 新的 CommonResult 对象
     */
    public static <T> CommonResult<T> error(CommonResult<?> result) {
        return error(result.getCode(), result.getMsg());
    }

    /**
     * 构建错误响应。
     *
     * @param code 错误码，不能等于成功码
     * @param message 错误提示
     * @param <T> 数据泛型
     * @return 错误响应
     */
    public static <T> CommonResult<T> error(Integer code, String message) {
        Assert.notEquals(GlobalErrorCodeConstants.SUCCESS.getCode(), code, "code 必须是错误的！");
        CommonResult<T> result = new CommonResult<>();
        result.code = code;
        result.msg = message;
        return result;
    }

    /**
     * 根据错误码枚举和占位参数构建错误响应。
     *
     * @param errorCode 错误码枚举
     * @param params 错误提示占位参数
     * @param <T> 数据泛型
     * @return 错误响应
     */
    public static <T> CommonResult<T> error(ErrorCode errorCode, Object... params) {
        Assert.notEquals(GlobalErrorCodeConstants.SUCCESS.getCode(), errorCode.getCode(), "code 必须是错误的！");
        CommonResult<T> result = new CommonResult<>();
        result.code = errorCode.getCode();
        result.msg = ServiceExceptionUtil.doFormat(errorCode.getCode(), errorCode.getMsg(), params);
        return result;
    }

    /**
     * 根据错误码枚举构建错误响应。
     *
     * @param errorCode 错误码枚举
     * @param <T> 数据泛型
     * @return 错误响应
     */
    public static <T> CommonResult<T> error(ErrorCode errorCode) {
        return error(errorCode.getCode(), errorCode.getMsg());
    }

    /**
     * 构建成功响应。
     *
     * @param data 响应数据
     * @param <T> 数据泛型
     * @return 成功响应
     */
    public static <T> CommonResult<T> success(T data) {
        CommonResult<T> result = new CommonResult<>();
        result.code = GlobalErrorCodeConstants.SUCCESS.getCode();
        result.data = data;
        result.msg = "";
        return result;
    }

    /**
     * 判断错误码是否表示成功。
     *
     * @param code 错误码
     * @return 是否成功
     */
    public static boolean isSuccess(Integer code) {
        return Objects.equals(code, GlobalErrorCodeConstants.SUCCESS.getCode());
    }

    /**
     * 判断当前响应是否成功。
     *
     * @return 是否成功
     */
    @JsonIgnore // 避免 jackson 序列化
    public boolean isSuccess() {
        return isSuccess(code);
    }

    /**
     * 判断当前响应是否失败。
     *
     * @return 是否失败
     */
    @JsonIgnore // 避免 jackson 序列化
    public boolean isError() {
        return !isSuccess();
    }

    // ========= 和 Exception 异常体系集成 =========

    /**
     * 判断是否有异常。如果有，则抛出 {@link ServiceException} 异常
     *
     * @throws ServiceException 当前响应为错误结果时抛出
     */
    public void checkError() throws ServiceException {
        if (isSuccess()) {
            return;
        }
        // 业务异常
        throw new ServiceException(code, msg);
    }

    /**
     * 判断是否有异常。如果有，则抛出 {@link ServiceException} 异常
     * 如果没有，则返回 {@link #data} 数据
     *
     * @return 校验通过后的响应数据
     * @throws ServiceException 当前响应为错误结果时抛出
     */
    @JsonIgnore // 避免 jackson 序列化
    public T getCheckedData() {
        checkError();
        return data;
    }

    /**
     * 根据业务异常构建错误响应。
     *
     * @param serviceException 业务异常
     * @param <T> 数据泛型
     * @return 错误响应
     */
    public static <T> CommonResult<T> error(ServiceException serviceException) {
        return error(serviceException.getCode(), serviceException.getMessage());
    }

}
