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
 * @author 李杰
 */
public interface SmsCodeService {

    /**
     * 创建短信验证码并发送。
     *
     * @param reqDTO 发送请求
     */
    void sendSmsCode(@Valid SmsCodeSendReqDTO reqDTO);

    /**
     * 校验短信验证码并标记为已使用。
     *
     * @param reqDTO 使用请求
     * @throws ServiceException 验证码不存在、过期、已使用或错误时抛出
     */
    void useSmsCode(@Valid SmsCodeUseReqDTO reqDTO);

    /**
     * 校验短信验证码是否有效。
     *
     * @param reqDTO 校验请求
     * @throws ServiceException 验证码不存在、过期、已使用或错误时抛出
     */
    void validateSmsCode(@Valid SmsCodeValidateReqDTO reqDTO);

}
