package com.basicframework.module.system.service.sms;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeValidateReqDTO;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeSendReqDTO;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeUseReqDTO;

import jakarta.validation.Valid;

/**
 * 短信验证码服务接口。
 * <p>
 * 提供验证码发送、校验和使用标记能力。
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
public interface SmsCodeService {

    /**
     * 创建短信验证码并发送。
     *
     * @param reqDTO 发送请求
     */
    void sendSmsCode(@Valid SmsCodeSendReqDTO reqDTO);

    /**
     * 在手机、可信 IP 和单挑战错误预算内消费最新短信验证码。
     *
     * @param reqDTO 使用请求，IP 必须由可信调用方确定；请求及错误预算不随数据库事务回滚
     * @throws ServiceException 验证码无效、过期、已使用、被新码替代或预算耗尽时抛出
     */
    void useSmsCode(@Valid SmsCodeUseReqDTO reqDTO);

    /**
     * 在相同请求和错误预算内校验最新验证码，但不标记消费。
     *
     * @param reqDTO 校验请求，必须包含可信调用方确定的 validateIp
     * @throws ServiceException 验证码无效、过期、已使用或预算耗尽时抛出
     */
    void validateSmsCode(@Valid SmsCodeValidateReqDTO reqDTO);

}
