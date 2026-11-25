package com.basicframework.module.system.service.sms;

import cn.hutool.core.lang.Assert;
import cn.hutool.core.util.StrUtil;
import cn.hutool.crypto.digest.DigestUtil;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeSendReqDTO;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeUseReqDTO;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeValidateReqDTO;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.enums.sms.SmsSceneEnum;
import com.basicframework.module.system.framework.sms.config.SmsCodeProperties;
import com.basicframework.module.system.framework.sms.core.AliyunSmsSender;
import jakarta.annotation.Resource;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;
import org.springframework.validation.annotation.Validated;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Collections;
import java.util.concurrent.ConcurrentHashMap;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;

/**
 * 极简短信验证码服务：基于 Redis TTL（无 Redis 时单机内存兜底）+ 阿里云短信发送，不再依赖 4 张短信数据库表。
 *
 * @author shady
 */
@Service
@Validated
public class SmsCodeServiceImpl implements SmsCodeService {

    private static final int SMS_CODE_LENGTH = 6;
    private static final int SMS_CODE_BOUND = 1_000_000;
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final DateTimeFormatter DAY_FORMATTER = DateTimeFormatter.BASIC_ISO_DATE;

    private static final String KEY_COOLDOWN = "sms:code:cooldown:";
    private static final String KEY_DAILY = "sms:code:daily:";
    private static final String KEY_VALUE = "sms:code:val:";
    private static final String USED_MARKER = "__USED__";

    /**
     * 原子校验并标记验证码已使用的 Lua 脚本：
     * 返回值：1=消费成功，0=不存在，-1=已使用，-2=编码不匹配。
     */
    private static final DefaultRedisScript<Long> CONSUME_CODE_SCRIPT = new DefaultRedisScript<>(
            "local val = redis.call('GET', KEYS[1])\n"
                    + "if not val then return 0 end\n"
                    + "if val == '__USED__' then return -1 end\n"
                    + "if val ~= ARGV[1] then return -2 end\n"
                    + "local ttl = redis.call('PTTL', KEYS[1])\n"
                    + "if ttl and ttl > 0 then redis.call('PSETEX', KEYS[1], ttl, '__USED__') else redis.call('DEL', KEYS[1]) end\n"
                    + "return 1",
            Long.class);

    @Resource
    private SmsCodeProperties smsCodeProperties;

    @Resource
    private AliyunSmsSender aliyunSmsSender;

    @Resource
    private ObjectProvider<StringRedisTemplate> stringRedisTemplateProvider;

    /** 无 Redis 时的本地内存兜底存储（用于单测或单机降级）。 */
    private final ConcurrentHashMap<String, LocalCodeEntry> localStore = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Long> localCooldowns = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Integer> localDailyCounts = new ConcurrentHashMap<>();

    private record LocalCodeEntry(String code, long expireAtMillis, boolean used) {
    }

    @Override
    public void sendSmsCode(SmsCodeSendReqDTO reqDTO) {
        SmsSceneEnum sceneEnum = SmsSceneEnum.getCodeByScene(reqDTO.getScene());
        Assert.notNull(sceneEnum, "验证码场景({}) 查找不到配置", reqDTO.getScene());
        String code = createSmsCode(reqDTO.getMobile(), reqDTO.getScene());
        aliyunSmsSender.sendCode(reqDTO.getMobile(), sceneEnum, code);
    }

    private String createSmsCode(String mobile, Integer scene) {
        String mobileHash = DigestUtil.sha256Hex(mobile);
        StringRedisTemplate redisTemplate = getRedisTemplate();
        Duration sendFrequency = smsCodeProperties.getSendFrequency();
        Duration expireTimes = smsCodeProperties.getExpireTimes();
        int maxPerDay = smsCodeProperties.getSendMaximumQuantityPerDay();
        String code = String.format("%0" + SMS_CODE_LENGTH + "d", SECURE_RANDOM.nextInt(SMS_CODE_BOUND));

        if (redisTemplate != null) {
            String cooldownKey = KEY_COOLDOWN + mobileHash;
            boolean cooldownAcquired = false;
            if (sendFrequency != null && !sendFrequency.isZero() && !sendFrequency.isNegative()) {
                Boolean acquired = redisTemplate.opsForValue().setIfAbsent(cooldownKey, "1", sendFrequency);
                if (!Boolean.TRUE.equals(acquired)) {
                    throw exception(ErrorCodeConstants.SMS_CODE_SEND_TOO_FAST);
                }
                cooldownAcquired = true;
            }
            try {
                String dailyKey = KEY_DAILY + LocalDate.now().format(DAY_FORMATTER) + ":" + mobileHash;
                Long count = redisTemplate.opsForValue().increment(dailyKey);
                if (count != null && count == 1L) {
                    redisTemplate.expire(dailyKey, Duration.ofHours(25));
                }
                if (count != null && count > maxPerDay) {
                    throw exception(ErrorCodeConstants.SMS_CODE_EXCEED_SEND_MAXIMUM_QUANTITY_PER_DAY);
                }
                String valueKey = valueKey(scene, mobileHash);
                redisTemplate.opsForValue().set(valueKey, code, expireTimes);
                return code;
            } catch (RuntimeException ex) {
                if (cooldownAcquired && !(ex instanceof ServiceException)) {
                    redisTemplate.delete(cooldownKey);
                }
                throw ex;
            }
        }

        // 无 Redis 降级路径（用于本地单测与无 Redis 单机场景）
        long now = System.currentTimeMillis();
        Long cooldownUntil = localCooldowns.get(mobileHash);
        if (cooldownUntil != null && now < cooldownUntil) {
            throw exception(ErrorCodeConstants.SMS_CODE_SEND_TOO_FAST);
        }
        String dailyKey = LocalDate.now().format(DAY_FORMATTER) + ":" + mobileHash;
        int todayCount = localDailyCounts.getOrDefault(dailyKey, 0);
        if (todayCount >= maxPerDay) {
            throw exception(ErrorCodeConstants.SMS_CODE_EXCEED_SEND_MAXIMUM_QUANTITY_PER_DAY);
        }
        localDailyCounts.put(dailyKey, todayCount + 1);
        if (sendFrequency != null && !sendFrequency.isNegative()) {
            localCooldowns.put(mobileHash, now + sendFrequency.toMillis());
        }
        localStore.put(valueKey(scene, mobileHash), new LocalCodeEntry(code, now + expireTimes.toMillis(), false));
        return code;
    }

    @Override
    public void useSmsCode(SmsCodeUseReqDTO reqDTO) {
        String key = valueKey(reqDTO.getScene(), DigestUtil.sha256Hex(reqDTO.getMobile()));
        StringRedisTemplate redisTemplate = getRedisTemplate();
        if (redisTemplate != null) {
            Long status = redisTemplate.execute(CONSUME_CODE_SCRIPT, Collections.singletonList(key), reqDTO.getCode());
            if (status == null || status == 0L) {
                throw exception(ErrorCodeConstants.SMS_CODE_NOT_FOUND);
            }
            if (status == -1L) {
                throw exception(ErrorCodeConstants.SMS_CODE_USED);
            }
            if (status == -2L) {
                throw exception(ErrorCodeConstants.SMS_CODE_NOT_FOUND);
            }
            return;
        }
        localStore.compute(key, (k, entry) -> {
            if (entry == null) {
                throw exception(ErrorCodeConstants.SMS_CODE_NOT_FOUND);
            }
            if (!constantTimeEquals(entry.code(), reqDTO.getCode())) {
                throw exception(ErrorCodeConstants.SMS_CODE_NOT_FOUND);
            }
            if (System.currentTimeMillis() > entry.expireAtMillis()) {
                throw exception(ErrorCodeConstants.SMS_CODE_EXPIRED);
            }
            if (entry.used()) {
                throw exception(ErrorCodeConstants.SMS_CODE_USED);
            }
            return new LocalCodeEntry(entry.code(), entry.expireAtMillis(), true);
        });
    }

    @Override
    public void validateSmsCode(SmsCodeValidateReqDTO reqDTO) {
        String key = valueKey(reqDTO.getScene(), DigestUtil.sha256Hex(reqDTO.getMobile()));
        StringRedisTemplate redisTemplate = getRedisTemplate();
        if (redisTemplate != null) {
            String stored = redisTemplate.opsForValue().get(key);
            if (StrUtil.isEmpty(stored)) {
                throw exception(ErrorCodeConstants.SMS_CODE_NOT_FOUND);
            }
            if (USED_MARKER.equals(stored)) {
                throw exception(ErrorCodeConstants.SMS_CODE_USED);
            }
            if (!constantTimeEquals(stored, reqDTO.getCode())) {
                throw exception(ErrorCodeConstants.SMS_CODE_NOT_FOUND);
            }
            return;
        }
        LocalCodeEntry entry = localStore.get(key);
        if (entry == null) {
            throw exception(ErrorCodeConstants.SMS_CODE_NOT_FOUND);
        }
        if (!constantTimeEquals(entry.code(), reqDTO.getCode())) {
            throw exception(ErrorCodeConstants.SMS_CODE_NOT_FOUND);
        }
        if (System.currentTimeMillis() > entry.expireAtMillis()) {
            throw exception(ErrorCodeConstants.SMS_CODE_EXPIRED);
        }
        if (entry.used()) {
            throw exception(ErrorCodeConstants.SMS_CODE_USED);
        }
    }

    private StringRedisTemplate getRedisTemplate() {
        return stringRedisTemplateProvider != null ? stringRedisTemplateProvider.getIfAvailable() : null;
    }

    private static String valueKey(Integer scene, String mobileHash) {
        return KEY_VALUE + scene + ":" + mobileHash;
    }

    private static boolean constantTimeEquals(String expected, String actual) {
        if (expected == null || actual == null) {
            return false;
        }
        return MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8),
                actual.getBytes(StandardCharsets.UTF_8));
    }

}
