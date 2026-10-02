package com.basicframework.module.system.controller.admin.sms;

import com.basicframework.framework.common.util.servlet.ServletUtils;

import com.basicframework.module.system.controller.admin.sms.vo.callback.AliyunSmsCallbackRespVO;
import com.basicframework.module.system.controller.admin.sms.vo.callback.TencentSmsCallbackRespVO;
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
 * <p>回调保持匿名访问，但按供应商协议返回固定响应；处理失败返回 HTTP 50X 触发重试。</p>
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

    /**
     * 接收阿里云短信状态回执。
     *
     * @param request HTTP 请求
     * @return 阿里云协议响应；处理失败时 HTTP 状态为 500
     */
    @PostMapping("/aliyun")
    @PermitAll
    @Operation(summary = "阿里云短信的回调",
            description = "参见 https://help.aliyun.com/zh/sms/developer-reference/smsreport-http")
    public ResponseEntity<AliyunSmsCallbackRespVO> receiveAliyunSmsStatus(HttpServletRequest request) {
        try {
            String text = ServletUtils.getBody(request);
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
     * @param request HTTP 请求
     * @return 腾讯云协议响应；处理失败时 HTTP 状态为 500
     */
    @PostMapping("/tencent")
    @PermitAll
    @Operation(summary = "腾讯云短信的回调",
            description = "参见 https://cloud.tencent.com/document/product/382/59178")
    public ResponseEntity<TencentSmsCallbackRespVO> receiveTencentSmsStatus(HttpServletRequest request) {
        try {
            String text = ServletUtils.getBody(request);
            smsSendService.receiveSmsStatus(SmsChannelEnum.TENCENT.getCode(), text);
            return ResponseEntity.ok(TencentSmsCallbackRespVO.success());
        } catch (Exception ex) {
            log.warn("[receiveTencentSmsStatus][短信回执处理失败]", ex);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(TencentSmsCallbackRespVO.failure());
        }
    }

}
