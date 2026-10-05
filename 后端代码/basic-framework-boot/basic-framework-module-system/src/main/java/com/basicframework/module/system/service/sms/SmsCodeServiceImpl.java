package com.basicframework.module.system.service.sms;

import cn.hutool.core.date.LocalDateTimeUtil;
import cn.hutool.core.lang.Assert;
import cn.hutool.core.map.MapUtil;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeSendReqDTO;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeUseReqDTO;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeValidateReqDTO;
import com.basicframework.module.system.dal.dataobject.sms.SmsCodeDO;
import com.basicframework.module.system.dal.mysql.sms.SmsCodeMapper;
import com.basicframework.module.system.dal.redis.sms.SmsVerificationRedisDAO;
import com.basicframework.module.system.dal.redis.sms.SmsSendRedisDAO;
import com.basicframework.module.system.enums.sms.SmsSceneEnum;
import com.basicframework.module.system.framework.sms.config.SmsCodeProperties;
import org.springframework.stereotype.Service;
import org.springframework.validation.annotation.Validated;

import jakarta.annotation.Resource;
import java.security.SecureRandom;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
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

    /** 失败预算返回码：可用尝试次数已耗尽。 */
    private static final long VERIFY_BUDGET_EXHAUSTED = 2;

    /** 失败预算返回码：本次校验通过且预算已扣减。 */
    private static final long VERIFY_MATCHED = 1;

    private static final int SMS_CODE_LENGTH = 6;
    private static final int SMS_CODE_BOUND = 1_000_000;
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    @Resource
    private SmsCodeProperties smsCodeProperties;

    @Resource
    private SmsCodeMapper smsCodeMapper;

    @Resource
    private SmsSendService smsSendService;

    @Resource
    private SmsVerificationRedisDAO smsVerificationRedisDAO;

    @Resource
    private SmsSendRedisDAO smsSendRedisDAO;

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
     * 在持久化和调用供应商前原子预约额度；并发请求不能重复占用同一个发送间隔。
     */
    private String createSmsCode(String mobile, Integer scene, String ip) {
        if (ip == null || ip.isBlank()) {
            throw exception(SMS_CODE_SEND_TOO_FAST);
        }
        // 不按场景筛选，同一手机切换登录与找回场景也共用发送预算。
        SmsCodeDO lastSmsCode = smsCodeMapper.selectLastByMobile(mobile, null, null);
        long dailyIndex = smsSendRedisDAO.reserve(mobile, ip, smsCodeProperties,
                lastSmsCode == null ? null : lastSmsCode.getCreateTime(),
                lastSmsCode == null ? 0 : lastSmsCode.getTodayIndex());
        if (dailyIndex == -2) {
            throw exception(SMS_CODE_EXCEED_SEND_MAXIMUM_QUANTITY_PER_DAY);
        }
        if (dailyIndex <= 0) {
            throw exception(SMS_CODE_SEND_TOO_FAST);
        }

        // 创建验证码记录
        String code = String.format("%0" + SMS_CODE_LENGTH + "d", SECURE_RANDOM.nextInt(SMS_CODE_BOUND));
        SmsCodeDO newSmsCode = SmsCodeDO.builder().mobile(mobile).code(code).scene(scene)
                .todayIndex(Math.toIntExact(dailyIndex))
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
        SmsCodeDO lastSmsCode = validateSmsCode0(reqDTO.getMobile(), reqDTO.getCode(), reqDTO.getScene(), reqDTO.getUsedIp());
        // 条件更新用于阻止两个并发请求同时消费同一验证码。
        LocalDateTime now = LocalDateTime.now();
        int updated = smsCodeMapper.updateUsedIfUnused(lastSmsCode.getId(), now, reqDTO.getUsedIp(),
                now.minus(smsCodeProperties.getExpireTimes()));
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
        validateSmsCode0(reqDTO.getMobile(), reqDTO.getCode(), reqDTO.getScene(), reqDTO.getValidateIp());
    }

    /**
     * 对每次尝试执行请求预算检查，仅接受最新未消费验证码并原子记入错误预算。
     */
    private SmsCodeDO validateSmsCode0(String mobile, String code, Integer scene, String clientIp) {
        if (clientIp == null || clientIp.isBlank()
                || !smsVerificationRedisDAO.allowRequest(mobile, clientIp, smsCodeProperties)) {
            throw exception(SMS_CODE_VERIFY_TOO_FAST);
        }
        // 校验验证码
        SmsCodeDO lastSmsCode = smsCodeMapper.selectLastByMobile(mobile, null, scene);
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
        boolean matched = code != null && MessageDigest.isEqual(code.getBytes(StandardCharsets.UTF_8),
                lastSmsCode.getCode().getBytes(StandardCharsets.UTF_8));
        long result = smsVerificationRedisDAO.checkFailureBudget(mobile, lastSmsCode.getId(), matched,
                smsCodeProperties.getExpireTimes().toMillis(), smsCodeProperties.getVerificationMaximumFailures());
        if (result == VERIFY_BUDGET_EXHAUSTED) {
            throw exception(SMS_CODE_ATTEMPTS_EXHAUSTED);
        }
        if (result != VERIFY_MATCHED) {
            throw exception(SMS_CODE_NOT_FOUND);
        }
        return lastSmsCode;
    }

}
