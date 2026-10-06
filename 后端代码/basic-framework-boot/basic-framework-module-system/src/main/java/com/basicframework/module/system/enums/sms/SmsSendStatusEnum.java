package com.basicframework.module.system.enums.sms;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 短信的发送状态枚举
 *
 * @date 2021/2/1 13:39
 * @author zzf
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@Getter
@AllArgsConstructor
public enum SmsSendStatusEnum {

    /** 待发送，状态值 0；日志落库时的初始状态，随后由发送结果改写。 */
    INIT(0),
    /** 发送成功，状态值 10；短信 API 已受理。 */
    SUCCESS(10),
    /** 发送失败，状态值 20；失败编码与提示记录在同一条日志的 api_send_code、api_send_msg。 */
    FAILURE(20),
    /** 忽略，状态值 30；模板或渠道被禁用时不投递，只保留日志。 */
    IGNORE(30),
    ;

    /**
     * 状态值，对应 system_sms_log.send_status
     */
    private final int status;

}
