package com.basicframework.module.system.controller.admin.sms;

import com.basicframework.framework.apilog.core.annotation.ApiAccessLog;
import com.basicframework.framework.common.util.monitor.TracerUtils;

import com.basicframework.module.system.controller.admin.sms.vo.callback.AliyunSmsCallbackRespVO;
import com.basicframework.module.system.controller.admin.sms.vo.callback.TencentSmsCallbackRespVO;
import com.basicframework.module.system.framework.sms.core.enums.SmsChannelEnum;
import com.basicframework.module.system.framework.sms.core.client.SmsReceiptException;
import com.basicframework.module.system.service.sms.SmsSendService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import jakarta.annotation.Resource;
import jakarta.annotation.security.PermitAll;
import jakarta.servlet.http.HttpServletRequest;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * 短信供应商状态回执入口。
 *
 * <p>合法回执保留供应商成功响应；协议错误返回 4XX，仅内部故障返回 500 供重试。</p>
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/sms/SmsCallbackController.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 55 行，上游代码 24 行在本地被移除或改写，例如 @Slf4j；@ApiAccessLog(requestEnable = false)；本地补充注释 23 行。
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
     * @return 合法回执为 200；媒体类型不支持为 415，内容无效为 400，内部故障为 500
     */
    @PostMapping("/aliyun")
    @PermitAll
    @ApiAccessLog(requestEnable = false)
    @Operation(summary = "阿里云短信的回调",
            description = "参见 https://help.aliyun.com/zh/sms/developer-reference/smsreport-http")
    public ResponseEntity<AliyunSmsCallbackRespVO> receiveAliyunSmsStatus(HttpServletRequest request) {
        HttpStatus status = receiveStatus(request, SmsChannelEnum.ALIYUN.getCode());
        return ResponseEntity.status(status).body(status == HttpStatus.OK
                ? AliyunSmsCallbackRespVO.success() : AliyunSmsCallbackRespVO.failure());
    }

    /**
     * 接收腾讯云短信状态回执。
     *
     * @param request HTTP 请求
     * @return 合法回执为 200；媒体类型不支持为 415，内容无效为 400，内部故障为 500
     */
    @PostMapping("/tencent")
    @PermitAll
    @ApiAccessLog(requestEnable = false)
    @Operation(summary = "腾讯云短信的回调",
            description = "参见 https://cloud.tencent.com/document/product/382/59178")
    public ResponseEntity<TencentSmsCallbackRespVO> receiveTencentSmsStatus(HttpServletRequest request) {
        HttpStatus status = receiveStatus(request, SmsChannelEnum.TENCENT.getCode());
        return ResponseEntity.status(status).body(status == HttpStatus.OK
                ? TencentSmsCallbackRespVO.success() : TencentSmsCallbackRespVO.failure());
    }

    /**
     * 专用读取回执并区分协议拒绝与内部故障，避免改变公共请求体缓存契约。
     *
     * @param request 当前匿名请求，只读取 JSON 正文，不探测其它协议
     * @param channelCode 端点固定的供应商编码
     * @return 200 表示接收，415/400 表示协议拒绝，500 表示内部故障；拒绝日志仅含安全元数据
     */
    private HttpStatus receiveStatus(HttpServletRequest request, String channelCode) {
        String mediaType = normalizeMediaType(request.getContentType());
        long bodyLength = request.getContentLengthLong();
        if (!isJsonMediaType(mediaType)) {
            logFailure("unsupported_media_type", mediaType, bodyLength);
            return HttpStatus.UNSUPPORTED_MEDIA_TYPE;
        }
        try {
            byte[] body = request.getInputStream().readAllBytes();
            bodyLength = body.length;
            String text = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(body)).toString();
            SmsCallbackPayloadValidator.validate(channelCode, text);
            smsSendService.receiveSmsStatus(channelCode, text);
            return HttpStatus.OK;
        } catch (SmsReceiptException ex) {
            logFailure(ex.getMessage(), mediaType, bodyLength);
            return HttpStatus.BAD_REQUEST;
        } catch (CharacterCodingException ex) {
            logFailure("invalid_encoding", mediaType, bodyLength);
            return HttpStatus.BAD_REQUEST;
        } catch (IOException ex) {
            logFailure("unreadable_body", mediaType, bodyLength);
            return HttpStatus.BAD_REQUEST;
        } catch (Exception ex) {
            // 原异常可能包含报文、手机号或认证信息，内部故障也只能记录固定归类。
            logFailure("processing_failure", mediaType, bodyLength);
            return HttpStatus.INTERNAL_SERVER_ERROR;
        }
    }

    /** 媒体类型只保留规范化 type/subtype，去除参数并限制日志字段长度，不记录原始请求头。 */
    private static String normalizeMediaType(String contentType) {
        if (contentType == null) {
            return "missing";
        }
        try {
            MediaType parsed = MediaType.parseMediaType(contentType);
            String normalized = (parsed.getType() + "/" + parsed.getSubtype()).toLowerCase(Locale.ROOT);
            return normalized.length() <= 128 ? normalized : "invalid";
        } catch (IllegalArgumentException ex) {
            return "invalid";
        }
    }

    /** 仅接收明确的 JSON 媒体类型，结构化 JSON 使用专用流读取而不要求公共过滤器缓存。 */
    private static boolean isJsonMediaType(String mediaType) {
        return mediaType.startsWith("application/") && !mediaType.contains("*")
                && (MediaType.APPLICATION_JSON_VALUE.equals(mediaType) || mediaType.endsWith("+json"));
    }

    /** 仅记录固定归类和关联元数据，禁止将解析异常或回执正文写入日志。 */
    private static void logFailure(String reason, String mediaType, long bodyLength) {
        log.warn("[smsCallback][reason({}) traceId({}) mediaType({}) bodyLength({})]",
                reason, TracerUtils.getTraceId(), mediaType, bodyLength);
    }

}
