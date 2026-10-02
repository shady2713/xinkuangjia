package com.basicframework.module.system.api.sms;

import com.basicframework.module.system.api.sms.dto.send.SmsSendSingleToUserReqDTO;
import com.basicframework.module.system.service.sms.SmsSendService;
import org.springframework.stereotype.Service;
import org.springframework.validation.annotation.Validated;

import jakarta.annotation.Resource;

/**
 * 短信发送 API 接口
 *
 * @author 李杰
 */
@Service
@Validated
public class SmsSendApiImpl implements SmsSendApi {

    @Resource
    private SmsSendService smsSendService;

    /**
     * 发送Single短信ToAdmin。
     *
     * @param reqDTO reqDTO 参数
     * @return 操作结果
     */
    @Override
    public Long sendSingleSmsToAdmin(SmsSendSingleToUserReqDTO reqDTO) {
        return smsSendService.sendSingleSmsToAdmin(reqDTO.getMobile(), reqDTO.getUserId(),
                reqDTO.getTemplateCode(), reqDTO.getTemplateParams());
    }

    /**
     * 发送Single短信To会员。
     *
     * @param reqDTO reqDTO 参数
     * @return 操作结果
     */
    @Override
    public Long sendSingleSmsToMember(SmsSendSingleToUserReqDTO reqDTO) {
        return smsSendService.sendSingleSmsToMember(reqDTO.getMobile(), reqDTO.getUserId(),
                reqDTO.getTemplateCode(), reqDTO.getTemplateParams());
    }

}
