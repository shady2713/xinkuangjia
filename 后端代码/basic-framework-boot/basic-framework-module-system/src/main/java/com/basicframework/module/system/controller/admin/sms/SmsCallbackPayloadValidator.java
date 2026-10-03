package com.basicframework.module.system.controller.admin.sms;

import com.basicframework.module.system.framework.sms.core.client.SmsReceiptException;
import com.basicframework.module.system.framework.sms.core.enums.SmsChannelEnum;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectReader;

/**
 * 在匿名回调边界严格校验两家供应商的 JSON 数组协议，阻止宽松解析把坏输入当作有效回执。
 *
 * @author shady2713
 */
final class SmsCallbackPayloadValidator {

    /** 严格拒绝尾随内容和重复字段，避免协议校验与供应商解析器理解不同。 */
    private static final ObjectReader READER = new ObjectMapper()
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY)
            .readerFor(JsonNode.class);

    /** 校验器无实例状态，防止被作为业务服务创建。 */
    private SmsCallbackPayloadValidator() {
    }

    /**
     * 整批校验后才允许调用业务层，避免前几条落库后才发现后续回执无效。
     *
     * @param channelCode 当前端点固定的供应商编码
     * @param text UTF-8 JSON 正文，null 和空内容均无有效回执
     * @throws SmsReceiptException JSON 语法、数组结构或必要协议字段无效
     */
    static void validate(String channelCode, String text) {
        JsonNode receipts;
        if (text == null || text.isBlank()) {
            throw new SmsReceiptException("empty_receipt");
        }
        try {
            receipts = READER.readTree(text);
        } catch (JsonProcessingException ex) {
            // 解析器异常可能包含原文，只向协议入口传递固定原因。
            throw new SmsReceiptException("invalid_json");
        }
        if (receipts == null || !receipts.isArray() || receipts.isEmpty()) {
            throw new SmsReceiptException("empty_receipt");
        }
        boolean aliyun = SmsChannelEnum.ALIYUN.getCode().equals(channelCode);
        for (JsonNode receipt : receipts) {
            if (!receipt.isObject()) {
                throw new SmsReceiptException("invalid_fields");
            }
            requireText(receipt, aliyun ? "phone_number" : "mobile");
            requireText(receipt, aliyun ? "biz_id" : "sid");
            requireText(receipt, aliyun ? "report_time" : "user_receive_time");
            if (aliyun) {
                if (!receipt.path("success").isBoolean()) {
                    throw new SmsReceiptException("invalid_fields");
                }
            } else {
                requireText(receipt, "report_status");
            }
        }
    }

    /** 必须用非空字符串提供匹配标识与协议字段，禁止宽松转换把对象或数字当作标识。 */
    private static void requireText(JsonNode receipt, String field) {
        JsonNode value = receipt.path(field);
        if (!value.isTextual() || value.asText().isBlank()) {
            throw new SmsReceiptException("invalid_fields");
        }
    }
}
