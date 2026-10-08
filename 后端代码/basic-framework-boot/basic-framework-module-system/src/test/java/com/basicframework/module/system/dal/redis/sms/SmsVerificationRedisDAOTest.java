package com.basicframework.module.system.dal.redis.sms;

import cn.hutool.crypto.digest.DigestUtil;
import com.basicframework.module.system.framework.sms.config.SmsCodeProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Duration;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 验证短信验证预算在 Redis 上的键构造与参数下传。
 *
 * <p>三个预算维度必须落在同一个散列槽：请求预算要在一次原子操作里同时推进手机与 IP 两个计数器，
 * 键分散到不同槽时 Redis 集群会拒绝跨槽脚本，预算就退化成无效。</p>
 *
 * <p>手机号与 IP 只保存散列，不落明文：Redis 是最容易被整库导出的存储，明文手机号一旦随备份泄漏
 * 就无法收回。计数结果出现空值时必须失败关闭，把"不知道"当成"仍在预算内"等于让限流失效。</p>
 *
 * @author shady2713
 */
class SmsVerificationRedisDAOTest {

    /** 脚本键的散列槽标记，集群下决定同槽计算。 */
    private static final String HASH_TAG = "{budget}";
    /** 键前缀。 */
    private static final String KEY_PREFIX = "sms_verify:" + HASH_TAG + ":";

    /** 缓存模板替身。 */
    private StringRedisTemplate stringRedisTemplate;
    /** 最近一次执行脚本时使用的键。 */
    private List<String> scriptKeys;
    /** 最近一次执行脚本时下传的参数。 */
    private List<String> scriptArgs;
    /** 脚本替身要返回的结果。 */
    private Long scriptResult;
    /** 被测 DAO。 */
    private SmsVerificationRedisDAO redisDAO;

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
        redisDAO = new SmsVerificationRedisDAO();
        ReflectionTestUtils.setField(redisDAO, "stringRedisTemplate", stringRedisTemplate);
    }

    /** 手机与 IP 的计数键必须落在同一散列槽，否则集群会拒绝跨槽脚本。 */
    @Test
    void allowRequestPutsBothDimensionsInTheSameHashSlot() {
        redisDAO.allowRequest("13800000000", "10.0.0.1", properties());

        assertThat(scriptKeys).hasSize(2);
        assertThat(scriptKeys.get(0)).isEqualTo(KEY_PREFIX + "mobile:" + DigestUtil.sha256Hex("13800000000"));
        assertThat(scriptKeys.get(1)).isEqualTo(KEY_PREFIX + "ip:" + DigestUtil.sha256Hex("10.0.0.1"));
        assertThat(scriptKeys).allSatisfy(key -> assertThat(key).contains(HASH_TAG));
        assertThat(scriptKeys).as("手机号与 IP 只保存散列").noneMatch(key -> key.contains("13800000000"));
    }

    /** 窗口与两个阈值必须按顺序下传，顺序错位会让限流按错误的维度生效。 */
    @Test
    void allowRequestForwardsWindowAndBothThresholdsInOrder() {
        redisDAO.allowRequest("13800000000", "10.0.0.1", properties());

        assertThat(scriptArgs).containsExactly("60000", "10", "50");
    }

    /** 计数结果为 1 时放行，预算内的请求继续走验证码校验。 */
    @Test
    void allowRequestAcceptsRequestsInsideTheBudget() {
        scriptResult = 1L;

        assertThat(redisDAO.allowRequest("13800000000", "10.0.0.1", properties())).isTrue();
        assertThat(scriptKeys).hasSize(2);
    }

    /** 任一维度超出预算时拒绝，脚本返回 0 必须被映射为 false 而不是放行。 */
    @Test
    void allowRequestRejectsRequestsOverBudget() {
        scriptResult = 0L;

        assertThat(redisDAO.allowRequest("13800000000", "10.0.0.1", properties())).isFalse();
        assertThat(scriptKeys).hasSize(2);
    }

    /** 计数结果为空时必须失败关闭：把"未知"当成"仍在预算内"等于让限流失效。 */
    @Test
    void allowRequestFailsClosedOnNullResult() {
        scriptResult = null;

        assertThat(redisDAO.allowRequest("13800000000", "10.0.0.1", properties())).isFalse();
    }

    /** 错误预算键必须同时限定手机号与验证码编号，否则新验证码会让旧验证码的错误次数归零。 */
    @Test
    void checkFailureBudgetScopesTheCounterToTheCurrentChallenge() {
        redisDAO.checkFailureBudget("13800000000", 42L, false, 300_000L, 5);

        assertThat(scriptKeys).containsExactly(
                KEY_PREFIX + "failure:" + DigestUtil.sha256Hex("13800000000") + ":" + 42L);
        assertThat(scriptArgs).containsExactly("5", "false", "300000");
    }

    /** 匹配成功时把布尔值下传为 true，脚本据此不增加错误计数。 */
    @Test
    void checkFailureBudgetForwardsMatchedFlag() {
        redisDAO.checkFailureBudget("13800000000", 42L, true, 300_000L, 5);

        assertThat(scriptArgs).containsExactly("5", "true", "300000");
        assertThat(scriptKeys).hasSize(1);
    }

    /** 脚本返回 1 表示允许正确匹配，必须原样透出。 */
    @Test
    void checkFailureBudgetReturnsMatchedWhenBudgetRemains() {
        scriptResult = 1L;

        assertThat(redisDAO.checkFailureBudget("13800000000", 42L, true, 300_000L, 5)).isEqualTo(1L);
        assertThat(scriptKeys).hasSize(1);
    }

    /** 脚本返回 0 表示本次不匹配并已记错，调用方据此提示输入错误。 */
    @Test
    void checkFailureBudgetReturnsMismatchWhenRecorded() {
        scriptResult = 0L;

        assertThat(redisDAO.checkFailureBudget("13800000000", 42L, false, 300_000L, 5)).isZero();
        assertThat(scriptArgs).contains("false");
    }

    /** 脚本返回 2 表示错误预算耗尽，即使这次输入正确也必须拒绝。 */
    @Test
    void checkFailureBudgetReturnsExhaustedWhenLimitReached() {
        scriptResult = 2L;

        assertThat(redisDAO.checkFailureBudget("13800000000", 42L, true, 300_000L, 5)).isEqualTo(2L);
        assertThat(scriptArgs).contains("true");
    }

    /** 脚本结果为空时按预算耗尽处理，失败关闭而不是放行一次正确输入。 */
    @Test
    void checkFailureBudgetFailsClosedOnNullResult() {
        scriptResult = null;

        assertThat(redisDAO.checkFailureBudget("13800000000", 42L, true, 300_000L, 5)).isEqualTo(2L);
        assertThat(scriptKeys).hasSize(1);
    }

    /**
     * 构造一份可用的验证码计数配置。
     *
     * @return 计数窗口 1 分钟、手机 10 次、IP 50 次的配置
     */
    private SmsCodeProperties properties() {
        SmsCodeProperties properties = new SmsCodeProperties();
        properties.setVerificationWindow(Duration.ofMinutes(1));
        properties.setVerificationMaximumPerMobile(10);
        properties.setVerificationMaximumPerIp(50);
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
