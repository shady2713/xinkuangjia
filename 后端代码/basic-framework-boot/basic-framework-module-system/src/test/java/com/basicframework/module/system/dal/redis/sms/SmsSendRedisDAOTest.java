package com.basicframework.module.system.dal.redis.sms;

import cn.hutool.crypto.digest.DigestUtil;
import com.basicframework.module.system.framework.sms.config.SmsCodeProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.ZonedDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;

/**
 * 验证短信发送额度预约的键构造与参数下传。
 *
 * <p>手机间隔、手机日额度和可信 IP 请求窗口三个维度必须在同一次原子操作里完成判断：分三次判断会让
 * 并发请求在中间状态插入，绕过间隔或日额度。三个键因此必须落在同一散列槽。</p>
 *
 * <p>数据库历史为 Redis 冷启动提供下限：历史发送时间落在当天时，剩余冷却时间与当日已用条数必须
 * 一并下传，否则重启后限流会从零重新开始，等于绕过限额。Redis 返回空值时按拒绝处理并给出
 * {@code -3}，把"不知道额度是否用完"当成可用等于让限额失效。</p>
 *
 * @author shady2713
 */
class SmsSendRedisDAOTest {

    /** 脚本键的散列槽标记，集群下决定同槽计算。 */
    private static final String HASH_TAG = "{budget}";
    /** 键前缀。 */
    private static final String KEY_PREFIX = "sms_send:" + HASH_TAG + ":";

    /** 缓存模板替身。 */
    private StringRedisTemplate stringRedisTemplate;
    /** 最近一次执行脚本时使用的键。 */
    private List<String> scriptKeys;
    /** 最近一次执行脚本时下传的参数。 */
    private List<String> scriptArgs;
    /** 脚本替身要返回的结果。 */
    private Long scriptResult;
    /** 被测 DAO。 */
    private SmsSendRedisDAO redisDAO;

    /** 装配被测 DAO 并记录脚本的真实键与参数。 */
    @BeforeEach
    void setUp() {
        scriptKeys = null;
        scriptArgs = null;
        scriptResult = 1L;
        stringRedisTemplate = mock(StringRedisTemplate.class);
        org.mockito.Mockito.doAnswer(invocation -> {
            scriptKeys = invocation.getArgument(1);
            scriptArgs = ScriptArguments.flatten(invocation.getArguments());
            return scriptResult;
        }).when(stringRedisTemplate).execute(any(RedisScript.class), anyList(), any(Object[].class));
        redisDAO = new SmsSendRedisDAO();
        ReflectionTestUtils.setField(redisDAO, "stringRedisTemplate", stringRedisTemplate);
    }

    /** 三个维度的键必须落在同一散列槽，且手机号与 IP 只保存散列。 */
    @Test
    void reservePutsAllDimensionsInTheSameHashSlotWithoutPlainIdentifiers() {
        redisDAO.reserve("13800000000", "10.0.0.1", properties(), null, 0);

        assertThat(scriptKeys).hasSize(3);
        assertThat(scriptKeys.get(0)).isEqualTo(KEY_PREFIX + "interval:" + DigestUtil.sha256Hex("13800000000"));
        assertThat(scriptKeys.get(1)).startsWith(KEY_PREFIX + "daily:" + DigestUtil.sha256Hex("13800000000") + ":");
        assertThat(scriptKeys.get(1)).endsWith(ZonedDateTime.now().toLocalDate().toString());
        assertThat(scriptKeys.get(2)).isEqualTo(KEY_PREFIX + "ip:" + DigestUtil.sha256Hex("10.0.0.1"));
        assertThat(scriptKeys).allSatisfy(key -> assertThat(key).contains(HASH_TAG));
        assertThat(scriptKeys).as("手机号与 IP 只保存散列").noneMatch(key -> key.contains("13800000000"));
    }

    /** 无历史记录时剩余冷却为 0、已用条数为 0，重启后的第一封短信不会被人为延迟。 */
    @Test
    void reserveWithoutHistoryForwardsZeroCooldownAndCount() {
        redisDAO.reserve("13800000000", "10.0.0.1", properties(), null, 0);

        assertThat(scriptArgs.subList(0, 6)).containsExactly("60000", "50", "0", "0", "30", "60000");
        assertThat(Long.parseLong(scriptArgs.get(6))).as("日内计数键的存活时间必须接近一整天").isBetween(1L, 86_400_000L);
        assertThat(scriptArgs.get(2)).isEqualTo("0");
        assertThat(scriptArgs.get(3)).isEqualTo("0");
    }

    /** 历史发送时间落在当天时，剩余冷却必须按配置的发送间隔折算后下传。 */
    @Test
    void reserveCarriesRemainingCooldownFromTodayHistory() {
        LocalDateTime sentAt = LocalDateTime.now().minusSeconds(10);

        redisDAO.reserve("13800000000", "10.0.0.1", properties(), sentAt, 4);

        long cooldown = Long.parseLong(scriptArgs.get(2));
        assertThat(cooldown).as("剩余冷却应接近 50 秒").isBetween(45_000L, 50_000L);
        assertThat(scriptArgs.get(3)).as("当日已用条数必须下传，重启后不能从零开始").isEqualTo("4");
    }

    /** 历史发送时间早于当天时，冷却与已用条数都必须按"当天无历史"处理。 */
    @Test
    void reserveIgnoresHistoryFromPreviousDay() {
        LocalDateTime sentAt = LocalDateTime.now().minusDays(1).minusSeconds(5);

        redisDAO.reserve("13800000000", "10.0.0.1", properties(), sentAt, 7);

        assertThat(scriptArgs.get(2)).isEqualTo("0");
        assertThat(scriptArgs.get(3)).isEqualTo("0");
    }

    /** 参数顺序固定为 IP 窗口、IP 上限、持久化冷却、持久化已用、日额度与发送间隔，错位会让限流按错误维度生效。 */
    @Test
    void reserveForwardsArgumentsInTheOrderTheScriptExpects() {
        redisDAO.reserve("13800000000", "10.0.0.1", properties(), null, 0);

        assertThat(scriptArgs).hasSize(7);
        assertThat(scriptArgs.get(0)).as("IP 计数窗口是第一个参数").isEqualTo("60000");
        assertThat(scriptArgs.get(1)).as("IP 上限是第二个参数").isEqualTo("50");
        assertThat(scriptArgs.get(2)).as("持久化冷却是第三个参数").isEqualTo("0");
        assertThat(scriptArgs.get(3)).as("持久化已用条数是第四个参数").isEqualTo("0");
        assertThat(scriptArgs.get(4)).as("日额度是第五个参数").isEqualTo("30");
        assertThat(scriptArgs.get(5)).as("发送间隔是第六个参数").isEqualTo("60000");
        assertThat(Long.parseLong(scriptArgs.get(6))).as("日内计数存活时间是第七个参数").isPositive();
    }

    /** 脚本返回的日内序号必须原样透出，它同时就是本次验证码的发送序号。 */
    @Test
    void reserveReturnsTheDailyIndexFromTheScript() {
        scriptResult = 3L;

        assertThat(redisDAO.reserve("13800000000", "10.0.0.1", properties(), null, 0)).isEqualTo(3L);
        assertThat(scriptKeys).hasSize(3);
    }

    /** 间隔不足返回 -1、日额度耗尽返回 -2、IP 限流返回 -3，三种拒绝必须各自原样透出。 */
    @Test
    void reserveReturnsEachRejectionCodeUnchanged() {
        for (long rejection : List.of(-1L, -2L, -3L)) {
            scriptResult = rejection;
            assertThat(redisDAO.reserve("13800000000", "10.0.0.1", properties(), null, 0)).isEqualTo(rejection);
        }
        assertThat(scriptKeys).hasSize(3);
    }

    /** 脚本结果为空时按 -3 拒绝处理，Redis 故障不得被当成额度可用。 */
    @Test
    void reserveFailsClosedOnNullResult() {
        scriptResult = null;

        assertThat(redisDAO.reserve("13800000000", "10.0.0.1", properties(), null, 0)).isEqualTo(-3L);
        assertThat(scriptKeys).hasSize(3);
    }

    /**
     * 构造一份可用的发送限额配置。
     *
     * @return 间隔 1 分钟、日额度 30、IP 窗口 1 分钟且上限 50 的配置
     */
    private SmsCodeProperties properties() {
        SmsCodeProperties properties = new SmsCodeProperties();
        properties.setSendFrequency(Duration.ofMinutes(1));
        properties.setSendMaximumQuantityPerDay(30);
        properties.setSendIpWindow(Duration.ofMinutes(1));
        properties.setSendMaximumPerIp(50);
        return properties;
    }

    /**
     * 把脚本调用实参里位于脚本与键之后的部分还原成参数字符串列表。
     *
     * <p>可变参数在不同 Mockito 版本下可能被还原成展开的元素列表，也可能被保留成一个对象数组，
     * 两种形态都要支持，否则键与参数的断言会随依赖升级失效。</p>
     */
    static final class ScriptArguments {

        /** 禁止实例化工具类。 */
        private ScriptArguments() {
        }

        /**
         * 取出脚本实参并统一转成字符串。
         *
         * @param all 脚本调用收到的全部实参，前两个分别是脚本与键
         * @return 参数字符串列表
         */
        static java.util.List<String> flatten(Object[] all) {
            if (all.length == 3 && all[2] instanceof Object[]) {
                return java.util.Arrays.stream((Object[]) all[2]).map(String::valueOf).toList();
            }
            return java.util.Arrays.stream(all, 2, all.length).map(String::valueOf).toList();
        }

    }
}
