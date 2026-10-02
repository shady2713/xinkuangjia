package com.basicframework.module.system.service.sms;

import cn.hutool.core.date.LocalDateTimeUtil;
import cn.hutool.core.lang.Assert;
import cn.hutool.core.map.MapUtil;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeSendReqDTO;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeUseReqDTO;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeValidateReqDTO;
import com.basicframework.module.system.dal.dataobject.sms.SmsCodeDO;
import com.basicframework.module.system.dal.mysql.sms.SmsCodeMapper;
import com.basicframework.module.system.enums.sms.SmsSceneEnum;
import com.basicframework.module.system.framework.sms.config.SmsCodeProperties;
import org.springframework.stereotype.Service;
import org.springframework.validation.annotation.Validated;

import jakarta.annotation.Resource;
import java.security.SecureRandom;
import java.time.LocalDateTime;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.module.system.enums.ErrorCodeConstants.*;

/**
 * 短信验证码 Service 实现类
 *
 * @author 李杰
 */
@Service
@Validated
public class SmsCodeServiceImpl implements SmsCodeService {

    private static final int SMS_CODE_LENGTH = 6;
    private static final int SMS_CODE_BOUND = 1_000_000;
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    @Resource
    private SmsCodeProperties smsCodeProperties;

    @Resource
    private SmsCodeMapper smsCodeMapper;

    @Resource
    private SmsSendService smsSendService;

    /**
     * 发送短信验证码。
     *
     * @param reqDTO reqDTO 参数
     */
    @Override
    public void sendSmsCode(SmsCodeSendReqDTO reqDTO) {
        SmsSceneEnum sceneEnum = SmsSceneEnum.getCodeByScene(reqDTO.getScene());
        Assert.notNull(sceneEnum, "验证码场景({}) 查找不到配置", reqDTO.getScene());
        // 创建验证码
        String code = createSmsCode(reqDTO.getMobile(), reqDTO.getScene(), reqDTO.getCreateIp());
        // 发送验证码
        smsSendService.sendSingleSms(reqDTO.getMobile(), null, null,
                sceneEnum.getTemplateCode(), MapUtil.of("code", code));
    }

    /**
     * 创建短信验证码。
     */
    private String createSmsCode(String mobile, Integer scene, String ip) {
        // 校验是否可以发送验证码，不用筛选场景
        SmsCodeDO lastSmsCode = smsCodeMapper.selectLastByMobile(mobile, null, null);
        if (lastSmsCode != null) {
            if (LocalDateTimeUtil.between(lastSmsCode.getCreateTime(), LocalDateTime.now()).toMillis()
                    < smsCodeProperties.getSendFrequency().toMillis()) { // 发送过于频繁
                throw exception(SMS_CODE_SEND_TOO_FAST);
            }
            if (LocalDateTimeUtil.isSameDay(lastSmsCode.getCreateTime(), LocalDateTime.now()) && // 必须是今天，才能计算超过当天的上限
                    lastSmsCode.getTodayIndex() >= smsCodeProperties.getSendMaximumQuantityPerDay()) { // 超过当天发送的上限。
                throw exception(SMS_CODE_EXCEED_SEND_MAXIMUM_QUANTITY_PER_DAY);
            }
            // 当前仅按手机号做发送频控，IP 维度限流后续如有明确需求再单独补充。
        }

        // 创建验证码记录
        String code = String.format("%0" + SMS_CODE_LENGTH + "d", SECURE_RANDOM.nextInt(SMS_CODE_BOUND));
        SmsCodeDO newSmsCode = SmsCodeDO.builder().mobile(mobile).code(code).scene(scene)
                .todayIndex(lastSmsCode != null
                        && LocalDateTimeUtil.isSameDay(lastSmsCode.getCreateTime(), LocalDateTime.now())
                        ? lastSmsCode.getTodayIndex() + 1 : 1)
                .createIp(ip).used(false).build();
        smsCodeMapper.insert(newSmsCode);
        return code;
    }

    /**
     * 校验并消费短信验证码。
     *
     * <p>最终通过数据库条件更新完成原子消费；并发请求只有一个可以成功。</p>
     *
     * @param reqDTO 验证码使用请求
     */
    @Override
    public void useSmsCode(SmsCodeUseReqDTO reqDTO) {
        // 检测验证码是否有效
        SmsCodeDO lastSmsCode = validateSmsCode0(reqDTO.getMobile(), reqDTO.getCode(), reqDTO.getScene());
        // 条件更新用于阻止两个并发请求同时消费同一验证码。
        int updated = smsCodeMapper.updateUsedIfUnused(lastSmsCode.getId(), LocalDateTime.now(), reqDTO.getUsedIp());
        if (updated == 0) {
            throw exception(SMS_CODE_USED);
        }
    }

    /**
     * 校验短信验证码。
     *
     * @param reqDTO reqDTO 参数
     */
    @Override
    public void validateSmsCode(SmsCodeValidateReqDTO reqDTO) {
        validateSmsCode0(reqDTO.getMobile(), reqDTO.getCode(), reqDTO.getScene());
    }

    /**
     * 校验 validateSmsCode0 对应的输入与业务约束。
     */
    private SmsCodeDO validateSmsCode0(String mobile, String code, Integer scene) {
        // 校验验证码
        SmsCodeDO lastSmsCode = smsCodeMapper.selectLastByMobile(mobile, code, scene);
        // 若验证码不存在，抛出异常
        if (lastSmsCode == null) {
            throw exception(SMS_CODE_NOT_FOUND);
        }
        // 超过时间
        if (LocalDateTimeUtil.between(lastSmsCode.getCreateTime(), LocalDateTime.now()).toMillis()
                >= smsCodeProperties.getExpireTimes().toMillis()) { // 验证码已过期
            throw exception(SMS_CODE_EXPIRED);
        }
        // 判断验证码是否已被使用
        if (Boolean.TRUE.equals(lastSmsCode.getUsed())) {
            throw exception(SMS_CODE_USED);
        }
        return lastSmsCode;
    }

}
