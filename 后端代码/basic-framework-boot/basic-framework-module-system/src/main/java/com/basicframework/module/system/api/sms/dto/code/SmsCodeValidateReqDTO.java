package com.basicframework.module.system.api.sms.dto.code;

import com.basicframework.framework.common.validation.InEnum;
import com.basicframework.framework.common.validation.Mobile;
import com.basicframework.module.system.enums.sms.SmsSceneEnum;
import lombok.Data;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

/**
 * 短信验证码的校验 Request DTO
 *
 * @author 李杰
 */
@Data
public class SmsCodeValidateReqDTO {

    /**
     * 手机号
     */
    @Mobile
    @NotEmpty(message = "手机号不能为空")
    private String mobile;
    /**
     * 发送场景
     */
    @NotNull(message = "发送场景不能为空")
    @InEnum(SmsSceneEnum.class)
    private Integer scene;
    /**
     * 验证码
     */
    @NotEmpty(message = "验证码")
    private String code;

    /** 由可信调用方从连接信息确定的验证 IP，不接受匿名请求体直接指定。 */
    @NotEmpty(message = "验证 IP 不能为空")
    private String validateIp;

}
