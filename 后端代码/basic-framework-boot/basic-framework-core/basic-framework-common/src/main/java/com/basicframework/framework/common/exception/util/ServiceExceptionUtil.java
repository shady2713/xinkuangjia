package com.basicframework.framework.common.exception.util;

import com.basicframework.framework.common.exception.ErrorCode;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants;
import com.google.common.annotations.VisibleForTesting;
import lombok.extern.slf4j.Slf4j;

/**
 * {@link ServiceException} 工具类
 *
 * 目的在于，格式化异常信息提示。
 * 考虑到 String.format 在参数不正确时会报错，因此使用 {} 作为占位符，并使用 {@link #doFormat(int, String, Object...)} 方法来格式化
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-framework/yudao-common/src/main/java/cn/iocoder/yudao/
 * 上游文件续：framework/common/exception/util/ServiceExceptionUtil.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 33 行，移除或改写上游 0 行；补充注释 33 行，上游注释 0 行未保留。
 */
@Slf4j
public class ServiceExceptionUtil {

    // ========== 和 ServiceException 的集成 ==========

    /**
     * 根据错误码对象创建业务异常。
     *
     * @param errorCode 错误码对象
     * @return 业务异常
     */
    public static ServiceException exception(ErrorCode errorCode) {
        return exception0(errorCode.getCode(), errorCode.getMsg());
    }

    /**
     * 根据错误码对象和格式化参数创建业务异常。
     *
     * @param errorCode 错误码对象
     * @param params 格式化参数
     * @return 业务异常
     */
    public static ServiceException exception(ErrorCode errorCode, Object... params) {
        return exception0(errorCode.getCode(), errorCode.getMsg(), params);
    }

    /**
     * 根据错误码、消息模板和参数创建业务异常。
     *
     * @param code 错误码
     * @param messagePattern 消息模板，使用 {} 作为占位符
     * @param params 格式化参数
     * @return 业务异常
     */
    public static ServiceException exception0(Integer code, String messagePattern, Object... params) {
        String message = doFormat(code, messagePattern, params);
        return new ServiceException(code, message);
    }

    /**
     * 创建请求参数错误业务异常。
     *
     * @param messagePattern 消息模板，使用 {} 作为占位符
     * @param params 格式化参数
     * @return 业务异常
     */
    public static ServiceException invalidParamException(String messagePattern, Object... params) {
        return exception0(GlobalErrorCodeConstants.BAD_REQUEST.getCode(), messagePattern, params);
    }

    // ========== 格式化方法 ==========

    /**
     * 将错误编号对应的消息使用 params 进行格式化。
     *
     * @param code           错误编号
     * @param messagePattern 消息模版
     * @param params         参数
     * @return 格式化后的提示
     */
    @VisibleForTesting
    public static String doFormat(int code, String messagePattern, Object... params) {
        StringBuilder sbuf = new StringBuilder(messagePattern.length() + 50);
        int i = 0;
        int j;
        int l;
        for (l = 0; l < params.length; l++) {
            j = messagePattern.indexOf("{}", i);
            if (j == -1) {
                log.error("[doFormat][参数过多：错误码({})|错误内容({})|参数({})", code, messagePattern, params);
                if (i == 0) {
                    return messagePattern;
                } else {
                    sbuf.append(messagePattern.substring(i));
                    return sbuf.toString();
                }
            } else {
                sbuf.append(messagePattern, i, j);
                sbuf.append(params[l]);
                i = j + 2;
            }
        }
        if (messagePattern.indexOf("{}", i) != -1) {
            log.error("[doFormat][参数过少：错误码({})|错误内容({})|参数({})", code, messagePattern, params);
        }
        sbuf.append(messagePattern.substring(i));
        return sbuf.toString();
    }

}
