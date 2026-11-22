package com.basicframework.module.system.framework.sms.config;

import cn.hutool.core.util.StrUtil;
import jakarta.validation.constraints.AssertTrue;
import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * 阿里云短信配置属性（环境变量驱动，取代数据库渠道与模板表）。
 *
 * @author 李杰
 */
@ConfigurationProperties(prefix = "basic-framework.sms.aliyun")
@Validated
@Data
public class AliyunSmsProperties {

    /**
     * 是否启用真实阿里云短信发送；默认 false（本地开发/测试环境走安全空发送）。
     */
    private boolean enabled = false;

    /**
     * 阿里云 AccessKey ID。
     */
    private String accessKeyId = "";

    /**
     * 阿里云 AccessKey Secret。
     */
    private String accessKeySecret = "";

    /**
     * 阿里云审核通过的短信签名。
     */
    private String signName = "";

    /**
     * 后台手机验证码登录模板编码（例如 {@code SMS_123456789}）。
     */
    private String loginTemplateCode = "";

    /**
     * 后台找回/重置密码模板编码。
     */
    private String resetPasswordTemplateCode = "";

    @AssertTrue(message = "启用阿里云短信时必须配置 access-key-id、access-key-secret 与 sign-name")
    public boolean isAliyunConfigComplete() {
        if (!enabled) {
            return true;
        }
        return StrUtil.isNotBlank(accessKeyId)
                && StrUtil.isNotBlank(accessKeySecret)
                && StrUtil.isNotBlank(signName);
    }

}
