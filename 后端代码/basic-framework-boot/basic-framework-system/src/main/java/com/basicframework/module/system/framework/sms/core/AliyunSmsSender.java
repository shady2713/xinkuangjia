package com.basicframework.module.system.framework.sms.core;

import cn.hutool.core.date.format.FastDateFormat;
import cn.hutool.core.util.IdUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.crypto.SecureUtil;
import cn.hutool.crypto.digest.DigestUtil;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.basicframework.framework.common.util.http.HttpUtils;
import com.basicframework.framework.common.util.json.JsonUtils;
import com.basicframework.module.system.enums.sms.SmsSceneEnum;
import com.basicframework.module.system.framework.sms.config.AliyunSmsProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.TimeZone;
import java.util.TreeMap;
import java.util.stream.Collectors;

import static com.basicframework.framework.common.exception.enums.GlobalErrorCodeConstants.INTERNAL_SERVER_ERROR;
import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception0;

/**
 * 极简阿里云短信发送器（ACS3-HMAC-SHA256 签名，无重型云 SDK 依赖）。
 *
 * @author shady
 */
@Slf4j
@RequiredArgsConstructor
public class AliyunSmsSender {

    private static final String ENDPOINT = "https://dysmsapi.aliyuncs.com";
    private static final String HOST = "dysmsapi.aliyuncs.com";
    private static final String VERSION = "2017-05-25";
    private static final String ACTION_SEND_SMS = "SendSms";
    private static final String RESPONSE_CODE_SUCCESS = "OK";
    private static final FastDateFormat ISO_DATE_FORMAT =
            FastDateFormat.getInstance("yyyy-MM-dd'T'HH:mm:ss'Z'", TimeZone.getTimeZone("GMT"));

    private final AliyunSmsProperties properties;

    /**
     * 发送场景验证码短信；未启用阿里云短信时记录脱敏日志并返回。
     *
     * @param mobile 接收手机号
     * @param scene 业务场景
     * @param code 6 位数字验证码
     */
    public void sendCode(String mobile, SmsSceneEnum scene, String code) {
        if (!properties.isEnabled()) {
            log.info("[sendCode][aliyun sms disabled, skip real send: mobile={}, scene={}]",
                    maskMobile(mobile), scene.getScene());
            return;
        }
        String templateCode = resolveTemplateCode(scene);
        if (StrUtil.isBlank(templateCode)) {
            log.error("[sendCode][sms template code missing for scene={}]", scene.getScene());
            throw exception0(INTERNAL_SERVER_ERROR.getCode(), "短信服务配置异常，请联系管理员");
        }
        TreeMap<String, Object> queryParam = new TreeMap<>();
        queryParam.put("PhoneNumbers", mobile);
        queryParam.put("SignName", properties.getSignName());
        queryParam.put("TemplateCode", templateCode);
        queryParam.put("TemplateParam", JsonUtils.toJsonString(Map.of("code", code)));

        JSONObject response = executeSendSms(queryParam);
        if (!Objects.equals(response.getStr("Code"), RESPONSE_CODE_SUCCESS)) {
            log.error("[sendCode][aliyun sms failed: mobile={}, code={}, msg={}, requestId={}]",
                    maskMobile(mobile), response.getStr("Code"), response.getStr("Message"), response.getStr("RequestId"));
            throw exception0(INTERNAL_SERVER_ERROR.getCode(), "短信发送失败，请稍后重试");
        }
    }

    private String resolveTemplateCode(SmsSceneEnum scene) {
        if (scene == SmsSceneEnum.ADMIN_MEMBER_RESET_PASSWORD || scene == SmsSceneEnum.MEMBER_RESET_PASSWORD) {
            return StrUtil.blankToDefault(properties.getResetPasswordTemplateCode(), properties.getLoginTemplateCode());
        }
        return properties.getLoginTemplateCode();
    }

    private JSONObject executeSendSms(TreeMap<String, Object> queryParam) {
        String canonicalQuery = queryParam.entrySet().stream()
                .map(entry -> percentCode(entry.getKey()) + "=" + percentCode(String.valueOf(entry.getValue())))
                .collect(Collectors.joining("&"));
        String payloadHash = DigestUtil.sha256Hex("");

        TreeMap<String, String> headers = new TreeMap<>();
        headers.put("host", HOST);
        headers.put("x-acs-version", VERSION);
        headers.put("x-acs-action", ACTION_SEND_SMS);
        headers.put("x-acs-date", ISO_DATE_FORMAT.format(new Date()));
        headers.put("x-acs-signature-nonce", IdUtil.randomUUID());
        headers.put("x-acs-content-sha256", payloadHash);

        StringBuilder canonicalHeaders = new StringBuilder();
        StringBuilder signedHeaders = new StringBuilder();
        headers.forEach((k, v) -> {
            canonicalHeaders.append(k).append(':').append(v.trim()).append('\n');
            if (!signedHeaders.isEmpty()) {
                signedHeaders.append(';');
            }
            signedHeaders.append(k);
        });
        String canonicalRequest = "POST\n/\n" + canonicalQuery + "\n" + canonicalHeaders + "\n"
                + signedHeaders + "\n" + payloadHash;
        String stringToSign = "ACS3-HMAC-SHA256\n" + DigestUtil.sha256Hex(canonicalRequest);
        String signature = SecureUtil.hmacSha256(properties.getAccessKeySecret()).digestHex(stringToSign);

        Map<String, String> requestHeaders = new HashMap<>(headers);
        requestHeaders.put("Authorization",
                "ACS3-HMAC-SHA256 Credential=" + properties.getAccessKeyId()
                        + ",SignedHeaders=" + signedHeaders
                        + ",Signature=" + signature);
        String responseBody = HttpUtils.post(ENDPOINT + "?" + canonicalQuery, requestHeaders, "");
        return JSONUtil.parseObj(responseBody);
    }

    private static String percentCode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8)
                .replace("+", "%20")
                .replace("*", "%2A")
                .replace("%7E", "~");
    }

    private static String maskMobile(String mobile) {
        if (StrUtil.isBlank(mobile) || mobile.length() < 7) {
            return "***";
        }
        return mobile.substring(0, 3) + "****" + mobile.substring(mobile.length() - 4);
    }

}
