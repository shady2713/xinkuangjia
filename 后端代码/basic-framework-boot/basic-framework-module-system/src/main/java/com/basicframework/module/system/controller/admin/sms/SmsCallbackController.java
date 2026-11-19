package com.basicframework.module.system.controller.admin.sms;

import com.basicframework.framework.common.util.servlet.ServletUtils;

import com.basicframework.module.system.controller.admin.sms.vo.callback.AliyunSmsCallbackRespVO;
import com.basicframework.module.system.controller.admin.sms.vo.callback.TencentSmsCallbackRespVO;
import com.basicframework.module.system.framework.sms.core.callback.SmsCallbackSignatureVerifier;
import com.basicframework.module.system.framework.sms.core.callback.SmsCallbackVerificationResult;
import com.basicframework.module.system.framework.sms.core.enums.SmsChannelEnum;
import com.basicframework.module.system.service.sms.SmsSendService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import jakarta.annotation.Resource;
import jakarta.annotation.security.PermitAll;
import jakarta.servlet.http.HttpServletRequest;

/**
 * 短信供应商状态回执入口。
 *
 * <p>回调保持匿名访问，但写入回执状态前必须通过按渠道密钥计算的 HMAC-SHA256 验签与重放窗口校验；
 * 渠道未配置密钥、验签失败或重放请求均按失败关闭统一返回 HTTP 403，不暴露渠道配置状态且不写入回执。
 * 验签通过后按供应商协议返回固定响应，解析或落库失败返回 HTTP 500 触发重试。</p>
 *
 * @author 李杰
 */
@Tag(name = "管理后台 - 短信回调")
@RestController
@RequestMapping("/system/sms/callback")
@Slf4j
public class SmsCallbackController {

    @Resource
    private SmsSendService smsSendService;

    @Resource
    private SmsCallbackSignatureVerifier smsCallbackSignatureVerifier;

    /**
     * 接收阿里云短信状态回执。
     *
     * <p>请求必须携带 {@code X-Sms-Callback-Timestamp} 与 {@code X-Sms-Callback-Signature}
     * 请求头，签名覆盖 {@code ALIYUN\n时间戳\n原始请求体}；只有验签通过才交给业务服务解析。</p>
     *
     * @param request HTTP 请求
     * @return 阿里云协议响应；未配置密钥或验签失败统一返回 HTTP 403，处理失败为 500
     */
    @PostMapping("/aliyun")
    @PermitAll
    @Operation(summary = "阿里云短信的回调",
            description = "参见 https://help.aliyun.com/zh/sms/developer-reference/smsreport-http")
    public ResponseEntity<AliyunSmsCallbackRespVO> receiveAliyunSmsStatus(HttpServletRequest request) {
        try {
            String text = ServletUtils.getBody(request);
            SmsCallbackVerificationResult verification = smsCallbackSignatureVerifier.verify(
                    SmsChannelEnum.ALIYUN.getCode(), request, text);
            if (verification != SmsCallbackVerificationResult.PASS) {
                log.warn("[receiveAliyunSmsStatus][短信回执验签未通过({})]", verification);
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                        .body(AliyunSmsCallbackRespVO.failure());
            }
            smsSendService.receiveSmsStatus(SmsChannelEnum.ALIYUN.getCode(), text);
            return ResponseEntity.ok(AliyunSmsCallbackRespVO.success());
        } catch (Exception ex) {
            log.warn("[receiveAliyunSmsStatus][短信回执处理失败]", ex);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(AliyunSmsCallbackRespVO.failure());
        }
    }

    /**
     * 接收腾讯云短信状态回执。
     *
     * <p>请求必须携带 {@code X-Sms-Callback-Timestamp} 与 {@code X-Sms-Callback-Signature}
     * 请求头，签名覆盖 {@code TENCENT\n时间戳\n原始请求体}；只有验签通过才交给业务服务解析。</p>
     *
     * @param request HTTP 请求
     * @return 腾讯云协议响应；未配置密钥或验签失败统一返回 HTTP 403，处理失败为 500
     */
    @PostMapping("/tencent")
    @PermitAll
    @Operation(summary = "腾讯云短信的回调",
            description = "参见 https://cloud.tencent.com/document/product/382/59178")
    public ResponseEntity<TencentSmsCallbackRespVO> receiveTencentSmsStatus(HttpServletRequest request) {
        try {
            String text = ServletUtils.getBody(request);
            SmsCallbackVerificationResult verification = smsCallbackSignatureVerifier.verify(
                    SmsChannelEnum.TENCENT.getCode(), request, text);
            if (verification != SmsCallbackVerificationResult.PASS) {
                log.warn("[receiveTencentSmsStatus][短信回执验签未通过({})]", verification);
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                        .body(TencentSmsCallbackRespVO.failure());
            }
            smsSendService.receiveSmsStatus(SmsChannelEnum.TENCENT.getCode(), text);
            return ResponseEntity.ok(TencentSmsCallbackRespVO.success());
        } catch (Exception ex) {
            log.warn("[receiveTencentSmsStatus][短信回执处理失败]", ex);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(TencentSmsCallbackRespVO.failure());
        }
    }

}
