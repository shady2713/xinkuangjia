package com.basicframework.module.system.enums.sms;

import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 短信的接收状态枚举
 *
 * @date 2021/2/1 13:39
 * @author 李杰
 */
@Getter
@AllArgsConstructor
public enum SmsReceiveStatusEnum {

    /** 等待回执，状态值 0；回执未到达时的初始状态，回执补偿任务按该状态捞取记录。 */
    INIT(0),
    /** 接收成功，状态值 10；渠道回执确认送达。 */
    SUCCESS(10),
    /** 接收失败，状态值 20；渠道回执确认失败。 */
    FAILURE(20),
    ;

    /**
     * 状态值，对应 system_sms_log.receive_status
     */
    private final int status;

}
