package com.basicframework.module.system.service.sms;

import cn.hutool.crypto.digest.DigestUtil;
import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.baomidou.mybatisplus.spring.MybatisSqlSessionFactoryBean;
import com.basicframework.framework.common.exception.ErrorCode;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeSendReqDTO;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeUseReqDTO;
import com.basicframework.module.system.api.sms.dto.code.SmsCodeValidateReqDTO;
import com.basicframework.module.system.dal.dataobject.sms.SmsCodeDO;
import com.basicframework.module.system.dal.mysql.sms.SmsCodeMapper;
import com.basicframework.module.system.dal.redis.sms.SmsSendRedisDAO;
import com.basicframework.module.system.dal.redis.sms.SmsVerificationRedisDAO;
import com.basicframework.module.system.enums.sms.SmsSceneEnum;
import com.basicframework.module.system.framework.sms.config.SmsCodeProperties;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.mybatis.spring.mapper.MapperFactoryBean;
import org.redisson.Redisson;
import org.redisson.api.RedissonClient;
import org.redisson.config.Config;
import org.redisson.spring.data.connection.RedissonConnectionFactory;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.AnnotationConfigUtils;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CODE_ATTEMPTS_EXHAUSTED;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CODE_EXCEED_SEND_MAXIMUM_QUANTITY_PER_DAY;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CODE_NOT_FOUND;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CODE_SEND_TOO_FAST;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CODE_USED;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CODE_VERIFY_TOO_FAST;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;

/**
 * 用生产 DDL、真实 MyBatis Mapper 与真实 Redis 验证短信验证码的限流与挑战轮换边界。
 *
 * <p>验证码是登录与改密的唯一凭据，本测试只锁定四类真实风险：发送额度必须原子预约，
 * 并发请求不能超发当日额度；额度一旦预约就不因供应商失败而退还；验证请求的预算必须在
 * 查库之前判定，否则匿名来源可以用空 IP 反复试探；签发新挑战后旧挑战必须立即失效。</p>
 *
 * <p>限流预算完全落在 Redis 脚本里，替身会绕过真正的原子性，因此这里始终使用真实 Redis；
 * 只有已在 SmsSendPipelineMySqlIT 覆盖的短信供应商发送通道使用替身，避免向阿里云、
 * 腾讯云发起真实网络请求。</p>
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class SmsCodeServiceImplMySqlIT {

    /** 本测试使用的生产建表语句。 */
    private static final String TABLE = "system_sms_code";

    /** 发送与验证预算的键前缀，与生产 Redis DAO 保持一致。 */
    private static final String SEND_KEY_PREFIX = "sms_send:{budget}:";
    private static final String VERIFY_KEY_PREFIX = "sms_verify:{budget}:";

    /** 验证码固定 6 位，断言随机码格式而不是断言随机值本身。 */
    private static final Pattern SIX_DIGITS = Pattern.compile("\\d{6}");

    /** 固定的历史验证码值，便于构造挑战轮换与错误预算。 */
    private static final String SEEDED_CODE = "123456";
    private static final String ROTATED_CODE = "654321";

    /** 并发用例的竞争线程数，必须大于 1 才有原子性意义。 */
    private static final int RACERS = 8;

    private final String schema = "bf_smscode_" + UUID.randomUUID().toString().replace("-", "");

    private AnnotationConfigApplicationContext context;
    private RedissonClient redisClient;
    private StringRedisTemplate redisTemplate;
    private JdbcTemplate jdbc;
    private SmsCodeService smsCodeService;
    private SmsCodeMapper smsCodeMapper;
    private SmsSendService smsSendService;
    private SmsCodeProperties properties;
    private TransactionTemplate transactionTemplate;

    private String adminUrl;
    private String databaseUser;
    private String databasePassword;
    private boolean schemaCreated;

    /** 手机号与 IP 使用独立计数，保证每例的 Redis 键互不串扰。 */
    private int mobileSequence;
    private int ipSequence;

    /**
     * 每次 JVM 运行的随机前缀。
     *
     * <p>当日额度键在 Redis 中保留到当天结束，跨运行复用同一手机号会让上一次运行的计数
     * 成为本次的下限，掩盖真实的“额度不超发”。手机号首位固定 1，取 8 位随机前缀加 2 位
     * 序号共 11 位，满足 varchar(11) 与手机号格式；IP 第三段同样随机，避免可信 IP 预算被上次运行消耗。</p>
     */
    private final int runMobilePrefix = ThreadLocalRandom.current().nextInt(10_000_000, 100_000_000);
    private final int runNetworkOctet = ThreadLocalRandom.current().nextInt(1, 255);

    /** 实际交给供应商的验证码，每个元素对应一次真实发送。 */
    private final Set<String> deliveredCodes = ConcurrentHashMap.newKeySet();

    /** 发送替身当前要抛出的异常，用于复现供应商失败；为空表示发送成功。 */
    private RuntimeException deliveryFailure;

    /** 建立随机 schema、真实 Mapper、真实 Redis 预算与被测 Service。 */
    @BeforeAll
    void startEnvironment() throws Exception {
        adminUrl = requiredEnvironment("AUTH_TEST_MYSQL_URL");
        if (!adminUrl.matches("jdbc:mysql://(?:127\\.0\\.0\\.1|localhost):[0-9]+/(?:\\?.*)?")) {
            throw new IllegalArgumentException("测试 MySQL 必须位于环回地址且 URL 不得包含数据库名");
        }
        databaseUser = requiredEnvironment("AUTH_TEST_MYSQL_USERNAME");
        databasePassword = requiredEnvironment("AUTH_TEST_MYSQL_PASSWORD");
        try (Connection connection = DriverManager.getConnection(adminUrl, databaseUser, databasePassword);
             Statement statement = connection.createStatement()) {
            statement.execute("CREATE DATABASE `" + schema + "` CHARACTER SET utf8mb4");
            schemaCreated = true;
        }
        String[] parts = adminUrl.split("\\?", 2);
        DataSource dataSource = new DriverManagerDataSource(
                parts[0] + schema + (parts.length == 2 ? "?" + parts[1] : ""), databaseUser, databasePassword);
        jdbc = new JdbcTemplate(dataSource);
        String ddl = Files.readString(schemaSource());
        Matcher matcher = Pattern.compile("CREATE TABLE `" + TABLE + "`[\\s\\S]*?;").matcher(ddl);
        assertThat(matcher.find()).as("生产表 %s 必须存在", TABLE).isTrue();
        jdbc.execute(matcher.group());

        Config redis = new Config();
        redis.useSingleServer().setAddress("redis://127.0.0.1:"
                + Integer.parseInt(requiredEnvironment("BF_TEST_REDIS_PORT")))
                .setPassword(requiredEnvironment("BF_TEST_REDIS_PASSWORD"))
                .setConnectionMinimumIdleSize(1).setConnectionPoolSize(8);
        redisClient = Redisson.create(redis);
        RedissonConnectionFactory connectionFactory = new RedissonConnectionFactory(redisClient);
        connectionFactory.afterPropertiesSet();
        redisTemplate = new StringRedisTemplate(connectionFactory);
        redisTemplate.afterPropertiesSet();
        String ping = redisTemplate.execute(connection -> connection.ping(), true);
        assertThat(ping).as("限流用例必须跑在真实 Redis 上，内存替身无法证明脚本原子性").isEqualTo("PONG");

        properties = new SmsCodeProperties();
        smsSendService = mock(SmsSendService.class);
        recordDeliveredCodes();

        context = new AnnotationConfigApplicationContext();
        // 被测 Service 用 @Resource 按名注入，测试改为显式装配，必须移除按名处理器避免误报缺 Bean
        context.removeBeanDefinition(AnnotationConfigUtils.COMMON_ANNOTATION_PROCESSOR_BEAN_NAME);
        context.register(TransactionConfiguration.class);
        context.registerBean(DataSource.class, () -> dataSource);
        context.registerBean(PlatformTransactionManager.class, () -> new DataSourceTransactionManager(dataSource));
        context.registerBean(SqlSessionFactory.class, () -> sqlSessionFactory(dataSource));
        context.registerBean(SmsCodeMapper.class, () -> {
            try {
                MapperFactoryBean<SmsCodeMapper> mapper = new MapperFactoryBean<>(SmsCodeMapper.class);
                mapper.setSqlSessionFactory(context.getBean(SqlSessionFactory.class));
                mapper.afterPropertiesSet();
                return mapper.getObject();
            } catch (Exception exception) {
                throw new IllegalStateException("测试 Mapper 创建失败", exception);
            }
        });
        context.registerBean(SmsCodeService.class, () -> {
            SmsCodeServiceImpl service = new SmsCodeServiceImpl();
            ReflectionTestUtils.setField(service, "smsCodeProperties", properties);
            ReflectionTestUtils.setField(service, "smsCodeMapper", context.getBean(SmsCodeMapper.class));
            ReflectionTestUtils.setField(service, "smsSendService", smsSendService);
            ReflectionTestUtils.setField(service, "smsSendRedisDAO",
                    wire(new SmsSendRedisDAO(), "stringRedisTemplate", redisTemplate));
            ReflectionTestUtils.setField(service, "smsVerificationRedisDAO",
                    wire(new SmsVerificationRedisDAO(), "stringRedisTemplate", redisTemplate));
            return service;
        });
        context.refresh();
        smsCodeService = context.getBean(SmsCodeService.class);
        smsCodeMapper = context.getBean(SmsCodeMapper.class);
        transactionTemplate = new TransactionTemplate(context.getBean(PlatformTransactionManager.class));
    }

    /** 每例恢复生产默认阈值并清空数据库与发送记录，避免用例之间互相影响。 */
    @BeforeEach
    void resetFixture() {
        jdbc.update("DELETE FROM " + TABLE);
        deliveredCodes.clear();
        // 必须 reset 而非 clearInvocations：上一例留下的桩会污染本例的发送行为
        reset(smsSendService);
        deliveryFailure = null;
        recordDeliveredCodes();
        properties.setExpireTimes(Duration.ofMinutes(10));
        properties.setSendFrequency(Duration.ofMinutes(1));
        properties.setSendMaximumQuantityPerDay(10);
        properties.setSendIpWindow(Duration.ofMinutes(1));
        properties.setSendMaximumPerIp(50);
        properties.setVerificationMaximumFailures(5);
        properties.setVerificationWindow(Duration.ofMinutes(1));
        properties.setVerificationMaximumPerMobile(10);
        properties.setVerificationMaximumPerIp(50);
    }

    /**
     * 缺失或空白发送 IP 必须在预约任何额度之前被拒绝。
     *
     * <p>该守卫先于数据库与 Redis 执行，因此既不会消耗可信 IP 额度，也不会让未认证来源
     * 通过空 IP 无限触发验证码；用 Redis 中不存在发送键证明拒绝确实发生在预约之前。</p>
     */
    @Test
    void missingCreateIpIsRejectedBeforeReservingAnyBudget() {
        String mobile = nextMobile();
        String ip = nextIp();

        assertBusinessError(() -> smsCodeService.sendSmsCode(
                sendRequest(mobile, SmsSceneEnum.ADMIN_MEMBER_LOGIN, null)), SMS_CODE_SEND_TOO_FAST);
        assertBusinessError(() -> smsCodeService.sendSmsCode(
                sendRequest(mobile, SmsSceneEnum.ADMIN_MEMBER_LOGIN, "   ")), SMS_CODE_SEND_TOO_FAST);

        assertThat(countCodes()).as("被拒绝的请求不得落库").isZero();
        assertThat(deliveredCodes).as("被拒绝的请求不得触达供应商").isEmpty();
        assertThat(redisTemplate.hasKey(SEND_KEY_PREFIX + "interval:" + DigestUtil.sha256Hex(mobile)))
                .as("守卫必须早于额度预约").isFalse();
        assertThat(redisTemplate.hasKey(SEND_KEY_PREFIX + "ip:" + DigestUtil.sha256Hex(ip)))
                .as("空 IP 不得消耗可信 IP 的请求预算").isFalse();
    }

    /** 正常发送必须先原子预约再落库，日序号、来源 IP 与发送内容都要与实际验证码一致。 */
    @Test
    void successfulSendReservesBudgetAndDeliversGeneratedCode() {
        String mobile = nextMobile();
        String ip = nextIp();

        smsCodeService.sendSmsCode(sendRequest(mobile, SmsSceneEnum.ADMIN_MEMBER_LOGIN, ip));

        SmsCodeDO stored = onlyCode();
        assertThat(stored.getMobile()).isEqualTo(mobile);
        assertThat(stored.getScene()).isEqualTo(SmsSceneEnum.ADMIN_MEMBER_LOGIN.getScene());
        assertThat(stored.getCreateIp()).isEqualTo(ip);
        assertThat(stored.getTodayIndex()).as("首个验证码的日内序号必须为 1").isEqualTo(1);
        assertThat(stored.getUsed()).isFalse();
        assertThat(stored.getCode()).matches(SIX_DIGITS);
        assertThat(deliveredCodes).as("供应商收到的必须就是落库的那个码").containsExactly(stored.getCode());
        assertThat(dailyKeyValue(mobile)).as("日计数落在 Redis").isEqualTo("1");
    }

    /**
     * 同一手机的发送预算不按场景切分。
     *
     * <p>生产实现刻意在查历史时传空场景，因此切换登录与找回场景也共用同一份额度；
     * 若按场景放宽，攻击者只要轮换场景就能绕过当日额度。</p>
     */
    @Test
    void sendBudgetIsSharedAcrossScenesOfSameMobile() {
        String mobile = nextMobile();
        String ip = nextIp();

        smsCodeService.sendSmsCode(sendRequest(mobile, SmsSceneEnum.ADMIN_MEMBER_LOGIN, ip));

        assertBusinessError(() -> smsCodeService.sendSmsCode(
                sendRequest(mobile, SmsSceneEnum.MEMBER_RESET_PASSWORD, ip)), SMS_CODE_SEND_TOO_FAST);
        assertBusinessError(() -> smsCodeService.sendSmsCode(
                sendRequest(mobile, SmsSceneEnum.MEMBER_LOGIN, ip)), SMS_CODE_SEND_TOO_FAST);

        assertThat(countCodes()).as("被拒请求不得补发新挑战").isEqualTo(1);
        assertThat(deliveredCodes).hasSize(1);
    }

    /**
     * 并发请求不能超发当日额度，也不能重复落库。
     *
     * <p>所有线程都在读到“无历史”之后才竞争同一份 Redis 额度，真实脚本必须让其中恰好
     * 一个成功；日计数停在 1 是“未超发”的直接证据，同时核对每个失败线程拿到的错误码，
     * 避免把意外异常当成限流通过。</p>
     */
    @Test
    void concurrentSendsOnSameMobileIssueExactlyOneChallenge() throws Exception {
        String mobile = nextMobile();
        String ip = nextIp();
        CyclicBarrier allArrived = new CyclicBarrier(RACERS);
        AtomicInteger succeeded = new AtomicInteger();
        AtomicInteger rejectedAsTooFast = new AtomicInteger();
        AtomicInteger unexpected = new AtomicInteger();
        ExecutorService executor = Executors.newFixedThreadPool(RACERS);
        try {
            for (int racer = 0; racer < RACERS; racer++) {
                executor.submit(() -> {
                    allArrived.await(10, TimeUnit.SECONDS);
                    try {
                        smsCodeService.sendSmsCode(sendRequest(mobile, SmsSceneEnum.ADMIN_MEMBER_LOGIN, ip));
                        succeeded.incrementAndGet();
                    } catch (ServiceException exception) {
                        if (exception.getCode() == SMS_CODE_SEND_TOO_FAST.getCode()) {
                            rejectedAsTooFast.incrementAndGet();
                        } else {
                            unexpected.incrementAndGet();
                        }
                    } catch (RuntimeException | Error other) {
                        unexpected.incrementAndGet();
                    }
                    return null;
                });
            }
            executor.shutdown();
            assertThat(executor.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        } finally {
            executor.shutdownNow();
        }

        assertThat(unexpected.get()).as("竞争失败必须只来自限流业务错误").isZero();
        assertThat(succeeded.get()).isEqualTo(1);
        assertThat(rejectedAsTooFast.get()).isEqualTo(RACERS - 1);
        SmsCodeDO stored = onlyCode();
        assertThat(stored.getTodayIndex()).isEqualTo(1);
        assertThat(deliveredCodes).as("并发下只发生一次真实发送").hasSize(1);
        assertThat(dailyKeyValue(mobile)).as("日计数停在 1 才说明额度未被超发").isEqualTo("1");
    }

    /**
     * 供应商失败时数据库回滚，但已预约的当日额度不退还。
     *
     * <p>失败后真实发送结果不确定，重试只会放大发送量，因此预约必须保留。本例用当日
     * 额度而非发送间隔验证，避免与既有集成测试的间隔键断言重复；外层事务用来复现生产
     * 中验证码发送被更大的业务事务包裹、失败后整段回滚的真实情形。</p>
     */
    @Test
    void failedDeliveryRollsBackRowButKeepsReservedDailyBudget() {
        properties.setSendFrequency(Duration.ofMillis(1));
        properties.setSendMaximumQuantityPerDay(2);
        String mobile = nextMobile();
        String ip = nextIp();
        deliveryFailure = new IllegalStateException("controlled-delivery-failure");

        assertThatThrownBy(() -> transactionTemplate.executeWithoutResult(
                status -> smsCodeService.sendSmsCode(sendRequest(mobile, SmsSceneEnum.ADMIN_MEMBER_LOGIN, ip))))
                .isInstanceOf(IllegalStateException.class);

        assertThat(countCodes()).as("发送失败后外层事务回滚，不留半条记录").isZero();
        assertThat(dailyKeyValue(mobile)).as("失败尝试已计入当日额度且不退还").isEqualTo("1");

        deliveryFailure = null;
        smsCodeService.sendSmsCode(sendRequest(mobile, SmsSceneEnum.ADMIN_MEMBER_LOGIN, ip));
        assertThat(onlyCode().getTodayIndex()).isEqualTo(2);

        // 间隔键与数据库历史冷却都要先过去，否则会先命中发送过快而看不到当日额度耗尽
        awaitSendWindowOpen(mobile);
        assertBusinessError(() -> smsCodeService.sendSmsCode(
                sendRequest(mobile, SmsSceneEnum.ADMIN_MEMBER_LOGIN, ip)),
                SMS_CODE_EXCEED_SEND_MAXIMUM_QUANTITY_PER_DAY);
        assertThat(countCodes()).isEqualTo(1);
    }

    /** 校验成功不等于消费：校验通过后验证码仍未使用，并且还能被消费一次。 */
    @Test
    void validateSmsCodeAcceptsCurrentChallengeWithoutConsumingIt() {
        String mobile = nextMobile();
        SmsCodeDO issued = issue(mobile, SmsSceneEnum.ADMIN_MEMBER_LOGIN);

        assertThatCode(() -> smsCodeService.validateSmsCode(validateRequest(mobile, issued.getCode(),
                SmsSceneEnum.ADMIN_MEMBER_LOGIN, nextIp()))).doesNotThrowAnyException();
        assertThat(smsCodeMapper.selectById(issued.getId()).getUsed())
                .as("校验只确认码有效，不得代替消费").isFalse();

        assertThatCode(() -> smsCodeService.useSmsCode(
                useRequest(mobile, issued.getCode(), SmsSceneEnum.ADMIN_MEMBER_LOGIN, nextIp())))
                .doesNotThrowAnyException();
        SmsCodeDO consumed = smsCodeMapper.selectById(issued.getId());
        assertThat(consumed.getUsed()).isTrue();
        assertThat(consumed.getUsedTime()).isNotNull();
        assertBusinessError(() -> smsCodeService.useSmsCode(
                useRequest(mobile, issued.getCode(), SmsSceneEnum.ADMIN_MEMBER_LOGIN, nextIp())), SMS_CODE_USED);
    }

    /** 签发新挑战后旧挑战立即失效，即使旧码本身正确也必须被拒绝。 */
    @Test
    void validateSmsCodeRejectsSupersededChallengeAfterRotation() {
        String mobile = nextMobile();
        SmsCodeDO old = issue(mobile, SmsSceneEnum.ADMIN_MEMBER_LOGIN);
        SmsCodeDO current = issue(mobile, SmsSceneEnum.ADMIN_MEMBER_LOGIN);
        current.setCode(ROTATED_CODE);
        smsCodeMapper.updateById(current);
        assertThat(current.getId()).isGreaterThan(old.getId());

        assertBusinessError(() -> smsCodeService.validateSmsCode(validateRequest(mobile, SEEDED_CODE,
                SmsSceneEnum.ADMIN_MEMBER_LOGIN, nextIp())), SMS_CODE_NOT_FOUND);

        assertThatCode(() -> smsCodeService.validateSmsCode(validateRequest(mobile, ROTATED_CODE,
                SmsSceneEnum.ADMIN_MEMBER_LOGIN, nextIp()))).doesNotThrowAnyException();
        assertThat(smsCodeMapper.selectById(old.getId()).getUsed())
                .as("旧挑战不得被误消费").isFalse();
    }

    /**
     * 缺失或空白的验证 IP 在查库之前就被拒绝。
     *
     * <p>守卫先于验证码查询与错误预算，因此空 IP 既拿不到“码不存在”与“码已过期”的
     * 区分信息，也不会为同一挑战白白记入错误次数。</p>
     */
    @Test
    void missingValidateIpIsRejectedBeforeLookupAndFailureCharging() {
        String mobile = nextMobile();
        SmsCodeDO issued = issue(mobile, SmsSceneEnum.ADMIN_MEMBER_LOGIN);

        assertBusinessError(() -> smsCodeService.validateSmsCode(validateRequest(mobile, SEEDED_CODE,
                SmsSceneEnum.ADMIN_MEMBER_LOGIN, null)), SMS_CODE_VERIFY_TOO_FAST);
        assertBusinessError(() -> smsCodeService.validateSmsCode(validateRequest(mobile, SEEDED_CODE,
                SmsSceneEnum.ADMIN_MEMBER_LOGIN, "  ")), SMS_CODE_VERIFY_TOO_FAST);

        assertThat(redisTemplate.hasKey(failureKey(mobile, issued.getId())))
                .as("被预算拒绝的请求不得记入挑战的错误预算").isFalse();
        assertThat(redisTemplate.hasKey(VERIFY_KEY_PREFIX + "mobile:" + DigestUtil.sha256Hex(mobile)))
                .as("空 IP 不得消耗手机号的验证请求预算").isFalse();
        assertThat(smsCodeMapper.selectById(issued.getId()).getUsed()).isFalse();
    }

    /**
     * 验证请求预算耗尽后，即使验证码正确也必须先被预算拒绝。
     *
     * <p>预算判定发生在查库之前，因此耗尽后不会再返回“码不存在”“码已过期”或“码正确”，
     * 避免攻击者用预算耗尽的窗口反复试探；本例同时确认换 IP 也无法绕过手机号预算。</p>
     */
    @Test
    void exhaustedVerificationRequestBudgetRejectsBeforeLookup() {
        properties.setVerificationMaximumPerMobile(2);
        String mobile = nextMobile();
        SmsCodeDO issued = issue(mobile, SmsSceneEnum.ADMIN_MEMBER_LOGIN);

        // 两次错误把请求预算用满；错误预算独立于请求预算，因此这里仍能走到码比较
        assertBusinessError(() -> smsCodeService.validateSmsCode(validateRequest(mobile, "000000",
                SmsSceneEnum.ADMIN_MEMBER_LOGIN, nextIp())), SMS_CODE_NOT_FOUND);
        assertBusinessError(() -> smsCodeService.validateSmsCode(validateRequest(mobile, "111111",
                SmsSceneEnum.ADMIN_MEMBER_LOGIN, nextIp())), SMS_CODE_NOT_FOUND);

        assertBusinessError(() -> smsCodeService.validateSmsCode(validateRequest(mobile, SEEDED_CODE,
                SmsSceneEnum.ADMIN_MEMBER_LOGIN, nextIp())), SMS_CODE_VERIFY_TOO_FAST);
        // 换 IP 只影响 IP 维度预算，手机号维度的请求预算已耗尽，仍然拒绝
        assertBusinessError(() -> smsCodeService.validateSmsCode(validateRequest(mobile, SEEDED_CODE,
                SmsSceneEnum.ADMIN_MEMBER_LOGIN, nextIp())), SMS_CODE_VERIFY_TOO_FAST);

        assertThat(redisTemplate.opsForValue().get(failureKey(mobile, issued.getId())))
                .as("被请求预算拒绝的尝试不得再记入挑战错误预算").isEqualTo("2");
        assertThat(smsCodeMapper.selectById(issued.getId()).getUsed()).isFalse();
    }

    /** 同一手机在另一场景的验证码不能满足当前场景校验，否则登录码可被当作改密码使用。 */
    @Test
    void validateSmsCodeRejectsChallengeIssuedForAnotherScene() {
        String mobile = nextMobile();
        issue(mobile, SmsSceneEnum.ADMIN_MEMBER_LOGIN);

        assertBusinessError(() -> smsCodeService.validateSmsCode(validateRequest(mobile, SEEDED_CODE,
                SmsSceneEnum.MEMBER_LOGIN, nextIp())), SMS_CODE_NOT_FOUND);
    }

    /** 完全没有验证码时必须报“不存在”，而不是继续比较而抛出空指针。 */
    @Test
    void validateSmsCodeReportsMissingChallengeAsNotFound() {
        String mobile = nextMobile();

        assertBusinessError(() -> smsCodeService.validateSmsCode(validateRequest(mobile, SEEDED_CODE,
                SmsSceneEnum.ADMIN_MEMBER_LOGIN, nextIp())), SMS_CODE_NOT_FOUND);
    }

    /**
     * 错误预算耗尽后即使输入正确也拒绝，且不消费验证码。
     *
     * <p>耗尽判定先于匹配结果，最后一次猜中不能把码带走；同一预算在消费入口同样生效。</p>
     */
    @Test
    void exhaustedFailureBudgetRejectsCorrectCodeAndKeepsChallengeUnused() {
        properties.setVerificationMaximumFailures(2);
        String mobile = nextMobile();
        SmsCodeDO issued = issue(mobile, SmsSceneEnum.ADMIN_MEMBER_LOGIN);
        String ip = nextIp();

        assertBusinessError(() -> smsCodeService.validateSmsCode(validateRequest(mobile, "000000",
                SmsSceneEnum.ADMIN_MEMBER_LOGIN, ip)), SMS_CODE_NOT_FOUND);
        assertThat(redisTemplate.opsForValue().get(failureKey(mobile, issued.getId())))
                .as("第一次错误只记一次").isEqualTo("1");
        // 第二次错误刚好把预算用满，同一次调用即返回预算耗尽。
        assertBusinessError(() -> smsCodeService.validateSmsCode(validateRequest(mobile, "111111",
                SmsSceneEnum.ADMIN_MEMBER_LOGIN, ip)), SMS_CODE_ATTEMPTS_EXHAUSTED);

        assertBusinessError(() -> smsCodeService.validateSmsCode(validateRequest(mobile, SEEDED_CODE,
                SmsSceneEnum.ADMIN_MEMBER_LOGIN, ip)), SMS_CODE_ATTEMPTS_EXHAUSTED);
        assertThat(smsCodeMapper.selectById(issued.getId()).getUsed())
                .as("预算耗尽不得顺带消费验证码").isFalse();
        assertBusinessError(() -> smsCodeService.useSmsCode(
                useRequest(mobile, SEEDED_CODE, SmsSceneEnum.ADMIN_MEMBER_LOGIN, ip)),
                SMS_CODE_ATTEMPTS_EXHAUSTED);
    }

    /** 已被消费的验证码在校验阶段必须被识别为已使用，而不是退化成“码不存在”。 */
    @Test
    void validateSmsCodeReportsConsumedChallengeAsUsed() {
        String mobile = nextMobile();
        SmsCodeDO issued = issue(mobile, SmsSceneEnum.ADMIN_MEMBER_LOGIN);
        jdbc.update("UPDATE " + TABLE + " SET used=1, used_time=? WHERE id=?", LocalDateTime.now(), issued.getId());

        assertBusinessError(() -> smsCodeService.validateSmsCode(validateRequest(mobile, SEEDED_CODE,
                SmsSceneEnum.ADMIN_MEMBER_LOGIN, nextIp())), SMS_CODE_USED);
    }

    /**
     * 让发送替身记录真实交付的验证码，并按当前开关复现供应商失败。
     *
     * <p>替身只拦截供应商通道，验证码生成、限流预约与落库仍走生产实现；记录交付码用于
     * 断言“供应商收到的就是落库的那个码”，而不是校验某个随机值。失败通过开关表达而不再
     * 重新打桩，因为重新打桩会覆盖这里的记录行为。</p>
     */
    private void recordDeliveredCodes() {
        doAnswer(invocation -> {
            if (deliveryFailure != null) {
                throw deliveryFailure;
            }
            Object templateParams = invocation.getArgument(4);
            Object code = templateParams instanceof Map<?, ?> map ? map.get("code") : null;
            if (code != null) {
                deliveredCodes.add(String.valueOf(code));
            }
            return 1L;
        }).when(smsSendService).sendSingleSms(anyString(), any(), any(), anyString(), any());
    }

    /** 断言当前只有一条验证码记录，避免多写一行仍然通过。 */
    private SmsCodeDO onlyCode() {
        assertThat(countCodes()).isEqualTo(1);
        String mobile = jdbc.queryForObject("SELECT mobile FROM " + TABLE + " LIMIT 1", String.class);
        return smsCodeMapper.selectLastByMobile(mobile, null, null);
    }

    /** 直接插入一条历史验证码，用于构造挑战轮换与已消费的前置状态。 */
    private SmsCodeDO issue(String mobile, SmsSceneEnum scene) {
        SmsCodeDO code = SmsCodeDO.builder().mobile(mobile).code(SEEDED_CODE).scene(scene.getScene())
                .todayIndex(1).createIp(nextIp()).used(false).build();
        smsCodeMapper.insert(code);
        return code;
    }

    /** 构造发送请求；IP 为空时由生产守卫自行判定。 */
    private SmsCodeSendReqDTO sendRequest(String mobile, SmsSceneEnum scene, String createIp) {
        SmsCodeSendReqDTO request = new SmsCodeSendReqDTO();
        request.setMobile(mobile);
        request.setScene(scene.getScene());
        request.setCreateIp(createIp);
        return request;
    }

    /** 构造校验请求。 */
    private SmsCodeValidateReqDTO validateRequest(String mobile, String code, SmsSceneEnum scene, String ip) {
        SmsCodeValidateReqDTO request = new SmsCodeValidateReqDTO();
        request.setMobile(mobile);
        request.setCode(code);
        request.setScene(scene.getScene());
        request.setValidateIp(ip);
        return request;
    }

    /** 构造消费请求。 */
    private SmsCodeUseReqDTO useRequest(String mobile, String code, SmsSceneEnum scene, String ip) {
        SmsCodeUseReqDTO request = new SmsCodeUseReqDTO();
        request.setMobile(mobile);
        request.setCode(code);
        request.setScene(scene.getScene());
        request.setUsedIp(ip);
        return request;
    }

    /**
     * 等待该手机的下一次发送窗口真正打开。
     *
     * <p>发送间隔同时由 Redis 间隔键与数据库历史的冷却时间决定，两者都要过去；
     * 只等 Redis 会让断言偶发命中“发送过快”而不是额度耗尽。</p>
     */
    private void awaitSendWindowOpen(String mobile) {
        String intervalKey = SEND_KEY_PREFIX + "interval:" + DigestUtil.sha256Hex(mobile);
        await().atMost(Duration.ofSeconds(5)).pollInterval(Duration.ofMillis(20)).until(() -> {
            if (redisTemplate.hasKey(intervalKey)) {
                return false;
            }
            SmsCodeDO last = smsCodeMapper.selectLastByMobile(mobile, null, null);
            return last == null || last.getCreateTime().plus(properties.getSendFrequency())
                    .isBefore(LocalDateTime.now());
        });
    }

    /** 当日额度键只含手机号哈希与日期，不含手机号明文。 */
    private String dailyKeyValue(String mobile) {
        return redisTemplate.opsForValue().get(
                SEND_KEY_PREFIX + "daily:" + DigestUtil.sha256Hex(mobile) + ":" + LocalDate.now());
    }

    /** 挑战的错误预算键，只含手机号哈希与验证码编号。 */
    private String failureKey(String mobile, Long codeId) {
        return VERIFY_KEY_PREFIX + "failure:" + DigestUtil.sha256Hex(mobile) + ":" + codeId;
    }

    /**
     * 每例唯一的手机号。
     *
     * <p>取值由运行级随机前缀加两位序号组成，长度 11 位落在 varchar(11) 内；前缀保证
     * 重新运行不会命中上一次留在 Redis 的当日额度键。</p>
     */
    private String nextMobile() {
        return "1" + runMobilePrefix + String.format("%02d", ++mobileSequence % 100);
    }

    /**
     * 每例唯一的文档保留网段 IP。
     *
     * <p>第三段取运行级随机值，保证可信 IP 发送与验证预算不被上一次运行消耗。</p>
     */
    private String nextIp() {
        ipSequence++;
        return "198.18." + runNetworkOctet + "." + (ipSequence % 200 + 1);
    }

    /**
     * 只接受预期业务拒绝，SQL 异常或装配异常不能冒充安全边界通过。
     *
     * @param action 被测动作
     * @param expectedCode 预期的业务错误码
     */
    private void assertBusinessError(Runnable action, ErrorCode expectedCode) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(ServiceException.class,
                exception -> assertThat(exception.getCode()).isEqualTo(expectedCode.getCode()));
    }

    /** 统计未删除的验证码行数，验证真实持久化副作用。 */
    private int countCodes() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + TABLE + " WHERE deleted=0", Integer.class);
    }

    /** 显式注入依赖。 */
    private static <T> T wire(T target, String field, Object value) {
        ReflectionTestUtils.setField(target, field, value);
        return target;
    }

    /** 装配真实 MyBatis 工厂，分页插件与生产一致，不做内存替身。 */
    private SqlSessionFactory sqlSessionFactory(DataSource dataSource) {
        try {
            MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
            interceptor.addInnerInterceptor(new PaginationInnerInterceptor(DbType.MYSQL));
            MybatisSqlSessionFactoryBean factory = new MybatisSqlSessionFactoryBean();
            factory.setDataSource(dataSource);
            MybatisConfiguration configuration = new MybatisConfiguration();
            configuration.setMapUnderscoreToCamelCase(true);
            factory.setConfiguration(configuration);
            GlobalConfig global = new GlobalConfig();
            global.setDbConfig(new GlobalConfig.DbConfig().setIdType(IdType.AUTO));
            global.setMetaObjectHandler(new DefaultDBFieldHandler());
            factory.setGlobalConfig(global);
            factory.setPlugins(interceptor);
            return factory.getObject();
        } catch (Exception exception) {
            throw new IllegalStateException("测试 Mapper 装配失败", exception);
        }
    }

    /** 测试环境必须显式提供，不跳过集成测试。 */
    private String requiredEnvironment(String key) {
        String value = System.getenv(key);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("缺少测试环境变量 " + key);
        }
        return value;
    }

    /** 定位当前工作区生产 DDL，不维护脱节的测试表结构。 */
    private Path schemaSource() {
        for (Path path = Path.of("").toAbsolutePath(); path != null; path = path.getParent()) {
            Path candidate = path.resolve("数据库文件/basic_framework.sql");
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException("未找到生产 DDL");
    }

    /** 只删除本测试创建的随机 schema，并关闭 Redis 连接与 Spring 上下文。 */
    @AfterAll
    void closeEnvironment() throws Exception {
        if (context != null) {
            context.close();
        }
        if (redisClient != null) {
            redisClient.shutdown();
        }
        if (schemaCreated) {
            try (Connection connection = DriverManager.getConnection(adminUrl, databaseUser, databasePassword);
                 Statement statement = connection.createStatement()) {
                statement.execute("DROP DATABASE `" + schema + "`");
            }
        }
    }

    /** 开启生产事务边界，让发送失败时的数据库回滚与生产一致。 */
    @Configuration(proxyBeanMethods = false)
    @EnableTransactionManagement(proxyTargetClass = true)
    static class TransactionConfiguration {
    }
}
