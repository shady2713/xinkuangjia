package com.basicframework.module.system.service.sms;

import cn.hutool.extra.spring.SpringUtil;
import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.baomidou.mybatisplus.spring.MybatisSqlSessionFactoryBean;
import com.basicframework.framework.common.core.KeyValue;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.exception.ErrorCode;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.basicframework.module.system.controller.admin.sms.vo.channel.SmsChannelPageReqVO;
import com.basicframework.module.system.controller.admin.sms.vo.channel.SmsChannelSaveReqVO;
import com.basicframework.module.system.controller.admin.sms.vo.template.SmsTemplatePageReqVO;
import com.basicframework.module.system.controller.admin.sms.vo.template.SmsTemplateSaveReqVO;
import com.basicframework.module.system.dal.dataobject.sms.SmsChannelDO;
import com.basicframework.module.system.dal.dataobject.sms.SmsLogDO;
import com.basicframework.module.system.dal.dataobject.sms.SmsTemplateDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.dal.mysql.sms.SmsChannelMapper;
import com.basicframework.module.system.dal.mysql.sms.SmsLogMapper;
import com.basicframework.module.system.dal.mysql.sms.SmsTemplateMapper;
import com.basicframework.module.system.enums.sms.SmsReceiveStatusEnum;
import com.basicframework.module.system.enums.sms.SmsSendStatusEnum;
import com.basicframework.module.system.enums.sms.SmsTemplateTypeEnum;
import com.basicframework.module.system.framework.sms.core.client.SmsClient;
import com.basicframework.module.system.framework.sms.core.client.SmsClientFactory;
import com.basicframework.module.system.framework.sms.core.client.SmsReceiptException;
import com.basicframework.module.system.framework.sms.core.client.dto.SmsReceiveRespDTO;
import com.basicframework.module.system.framework.sms.core.client.dto.SmsSendRespDTO;
import com.basicframework.module.system.framework.sms.core.client.dto.SmsTemplateRespDTO;
import com.basicframework.module.system.framework.sms.core.enums.SmsTemplateAuditStatusEnum;
import com.basicframework.module.system.framework.sms.core.property.SmsChannelProperties;
import com.basicframework.module.system.mq.message.sms.SmsSendMessage;
import com.basicframework.module.system.mq.producer.sms.SmsProducer;
import com.basicframework.module.system.service.user.AdminUserService;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.session.SqlSession;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.mybatis.spring.mapper.MapperFactoryBean;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.concurrent.ConcurrentMapCacheManager;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.AnnotationConfigUtils;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.EnableAspectJAutoProxy;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CHANNEL_CODE_DUPLICATE;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CHANNEL_DISABLE;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CHANNEL_HAS_CHILDREN;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CHANNEL_NOT_EXISTS;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_SEND_MOBILE_NOT_EXISTS;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_SEND_MOBILE_TEMPLATE_PARAM_MISS;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_SEND_TEMPLATE_NOT_EXISTS;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_TEMPLATE_API_AUDIT_CHECKING;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_TEMPLATE_API_AUDIT_FAIL;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_TEMPLATE_API_ERROR;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_TEMPLATE_API_NOT_FOUND;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_TEMPLATE_CODE_DUPLICATE;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_TEMPLATE_NOT_EXISTS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 使用生产 DDL、真实 Mapper、真实 Spring 缓存与真实事件派发验证短信渠道、模板、发送与回执链路。
 *
 * <p>短信是登录验证码的承载通道，本测试只锁定三类真实风险：被禁用的模板与渠道不得进入实际发送；
 * 事件里的模板参数顺序必须来自模板而不是调用方 Map，否则按数组下标取值的供应商会填错位置；
     * 回执必须按渠道、流水号与手机号同时匹配，并只能从初始状态写入首次终态，
     * 避免把结果串写到他人日志或被供应商重复、乱序投递覆盖。</p>
 *
 * <p>真实短信客户端会向阿里云、腾讯云发起带签名的网络请求，测试环境不能也不应发起，
 * 因此 {@link SmsClient} 由可编程替身提供；渠道编码到客户端实现的真实创建、
 * 复用与刷新规则由 SmsClientFactoryImplTest 单独用真实工厂验证。</p>
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class SmsSendPipelineMySqlIT {

    /** 本测试使用的生产建表语句清单。 */
    private static final List<String> TABLES =
            List.of("system_sms_channel", "system_sms_template", "system_sms_log");

    /** 阿里云渠道编码，生产支持的两种实现之一。 */
    private static final String ALIYUN = "ALIYUN";
    /** 腾讯云渠道编码，用于验证多渠道互不干扰。 */
    private static final String TENCENT = "TENCENT";
    /** 种子模板编码，绝大多数发送用例复用它。 */
    private static final String LOGIN_TEMPLATE = "sms_login";
    /** 种子渠道编号，固定主键便于断言事件与日志的冗余字段。 */
    private static final long ALIYUN_CHANNEL_ID = 1L;
    /** 固定手机号，长度必须落在 varchar(11) 内。 */
    private static final String MOBILE = "13800000001";
    /** 每例种子数据的渠道条数。 */
    private static final int SEEDED_CHANNELS = 1;
    /** 每例种子数据的模板条数。 */
    private static final int SEEDED_TEMPLATES = 1;

    private final String schema = "bf_sms_" + UUID.randomUUID().toString().replace("-", "");
    private String adminUrl;
    private String databaseUser;
    private String databasePassword;
    private boolean schemaCreated;
    private AnnotationConfigApplicationContext context;
    private JdbcTemplate jdbc;
    private SmsSendService smsSendService;
    private SmsChannelService smsChannelService;
    private SmsTemplateService smsTemplateService;
    private SmsLogService smsLogService;
    private RecordingSmsClientFactory clientFactory;
    private SmsSendMessageRecorder recorder;
    private AdminUserService adminUserService;
    private Object previousSpringBeanFactory;
    private Object previousSpringContext;

    /** 只向随机测试 schema 导入生产建表语句，不执行种子数据或重建脚本。 */
    @BeforeAll
    void startDatabase() throws Exception {
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
        for (String table : TABLES) {
            Matcher matcher = Pattern.compile("CREATE TABLE `" + table + "`[\\s\\S]*?;").matcher(ddl);
            assertThat(matcher.find()).as("生产表 %s 必须存在", table).isTrue();
            jdbc.execute(matcher.group());
        }
        context = new AnnotationConfigApplicationContext();
        previousSpringBeanFactory = ReflectionTestUtils.getField(SpringUtil.class, "beanFactory");
        previousSpringContext = ReflectionTestUtils.getField(SpringUtil.class, "applicationContext");
        context.registerBean(SpringUtil.class);
        context.register(SmsTestConfiguration.class);
        // 生产 Service 用 @Resource 按名注入，测试改为显式装配，必须移除按名处理器避免误报缺 Bean
        context.removeBeanDefinition(AnnotationConfigUtils.COMMON_ANNOTATION_PROCESSOR_BEAN_NAME);
        context.registerBean(PlatformTransactionManager.class, () -> new DataSourceTransactionManager(dataSource));
        context.registerBean(DataSource.class, () -> dataSource);
        context.registerBean(CacheManager.class, () -> new ConcurrentMapCacheManager());
        context.registerBean(SqlSessionFactory.class, () -> sqlSessionFactory(dataSource));
        registerMapper(SmsChannelMapper.class);
        registerMapper(SmsTemplateMapper.class);
        registerMapper(SmsLogMapper.class);
        clientFactory = new RecordingSmsClientFactory();
        context.registerBean(SmsClientFactory.class, () -> clientFactory);
        recorder = new SmsSendMessageRecorder();
        context.registerBean(SmsSendMessageRecorder.class, () -> recorder);
        context.registerBean(SmsProducer.class, () -> wire(new SmsProducer(), "applicationContext", context));
        adminUserService = mock(AdminUserService.class);
        context.registerBean(AdminUserService.class, () -> adminUserService);
        context.registerBean(SmsChannelService.class, () -> {
            SmsChannelServiceImpl service = new SmsChannelServiceImpl();
            wire(service, "smsClientFactory", context.getBean(SmsClientFactory.class));
            SmsChannelServiceImpl wired = wire(service, "smsChannelMapper", context.getBean(SmsChannelMapper.class));
            return wire(wired, "smsTemplateServiceProvider", context.getBeanProvider(SmsTemplateService.class));
        });
        context.registerBean(SmsTemplateService.class, () -> {
            SmsTemplateServiceImpl service = new SmsTemplateServiceImpl();
            wire(service, "smsTemplateMapper", context.getBean(SmsTemplateMapper.class));
            return wire(service, "smsChannelService", context.getBean(SmsChannelService.class));
        });
        context.registerBean(SmsLogService.class,
                () -> wire(new SmsLogServiceImpl(), "smsLogMapper", context.getBean(SmsLogMapper.class)));
        context.registerBean(SmsSendService.class, () -> {
            SmsSendServiceImpl service = new SmsSendServiceImpl();
            wire(service, "adminUserService", context.getBean(AdminUserService.class));
            wire(service, "smsChannelService", context.getBean(SmsChannelService.class));
            wire(service, "smsTemplateService", context.getBean(SmsTemplateService.class));
            wire(service, "smsLogService", context.getBean(SmsLogService.class));
            return wire(service, "smsProducer", context.getBean(SmsProducer.class));
        });
        context.refresh();
        smsSendService = context.getBean(SmsSendService.class);
        smsChannelService = context.getBean(SmsChannelService.class);
        smsTemplateService = context.getBean(SmsTemplateService.class);
        smsLogService = context.getBean(SmsLogService.class);
    }

    /**
     * 每例重建固定种子：一条启用的阿里云渠道与一条启用的登录验证码模板。
     *
     * <p>固定种子让“本例新增了几行”可以直接计数，任何提前写库的分支都会立刻显形。</p>
     */
    @BeforeEach
    void seedFixtures() {
        CacheManager cacheManager = context.getBean(CacheManager.class);
        cacheManager.getCacheNames().forEach(name -> cacheManager.getCache(name).clear());
        for (String table : TABLES) {
            jdbc.update("DELETE FROM " + table);
        }
        jdbc.update("INSERT INTO system_sms_channel (id,signature,code,status,api_key,api_secret) "
                + "VALUES (?,?,?,?,?,?)", ALIYUN_CHANNEL_ID, "测试签名", ALIYUN,
                CommonStatusEnum.ENABLE.getStatus(), "test-api-key", "test-api-secret");
        jdbc.update("INSERT INTO system_sms_template "
                        + "(id,type,status,code,name,content,params,api_template_id,channel_id,channel_code) "
                        + "VALUES (?,?,?,?,?,?,?,?,?,?)",
                100L, 1, CommonStatusEnum.ENABLE.getStatus(), LOGIN_TEMPLATE, "登录验证码",
                "验证码 {code}", "[\"code\"]", "SMS_001", ALIYUN_CHANNEL_ID, ALIYUN);
        clientFactory.reset();
        recorder.reset();
        // 共享 mock 的调用次数会跨用例累积，校验“从未调用”前必须清空记录
        clearInvocations(adminUserService);
    }

    /**
     * 模板参数与渠道编码必须由服务端从内容与渠道派生。
     *
     * <p>参数顺序决定腾讯云按数组下标取值的正确性，渠道编码冗余字段决定日志展示与排查口径，
     * 两者都必须由服务端计算，才不会被请求体伪造。</p>
     */
    @Test
    void templateParamsAndChannelCodeAreDerivedServerSide() {
        Long id = smsTemplateService.createSmsTemplate(
                templateRequest("sms_order", "你好，{name}，订单 {orderNo} 已发货", null));

        assertThat(jdbc.queryForObject("SELECT params FROM system_sms_template WHERE id=?", String.class, id))
                .isEqualTo("[\"name\",\"orderNo\"]");
        assertThat(jdbc.queryForObject("SELECT channel_code FROM system_sms_template WHERE id=?", String.class, id))
                .isEqualTo(ALIYUN);
        assertThat(smsTemplateService.getSmsTemplate(id).getParams())
                .as("参数顺序必须与内容中的出现顺序一致").containsExactly("name", "orderNo");
    }

    /** 模板编码重复必须在写入前失败，错误信息回带编码便于定位。 */
    @Test
    void duplicateTemplateCodeIsRejectedBeforeInsert() {
        smsTemplateService.createSmsTemplate(templateRequest("sms_dup", "验证码 {code}", null));

        assertBusinessError(() -> smsTemplateService.createSmsTemplate(
                templateRequest("sms_dup", "另一个内容 {code}", null)), SMS_TEMPLATE_CODE_DUPLICATE);

        assertThat(count("system_sms_template")).isEqualTo(SEEDED_TEMPLATES + 1);
        assertThat(jdbc.queryForObject("SELECT content FROM system_sms_template WHERE code='sms_dup'", String.class))
                .as("原模板内容不得被第二次请求覆盖").isEqualTo("验证码 {code}");
    }

    /** 渠道不存在或已禁用时都不能建模板，否则后续发送会落到不可用渠道上。 */
    @Test
    void templateRequiresAnEnabledChannel() {
        jdbc.update("INSERT INTO system_sms_channel (id,signature,code,status,api_key,api_secret) "
                + "VALUES (900,'签名','TEST_DISABLED',1,'k','s')");

        assertBusinessError(() -> smsTemplateService.createSmsTemplate(
                templateRequest("sms_disabled", "验证码 {code}", 900L)), SMS_CHANNEL_DISABLE);
        assertBusinessError(() -> smsTemplateService.createSmsTemplate(
                templateRequest("sms_absent", "验证码 {code}", 999L)), SMS_CHANNEL_NOT_EXISTS);

        assertThat(count("system_sms_template")).isEqualTo(SEEDED_TEMPLATES);
    }

    /** 供应商侧审核中的模板不得登记，写库前就要拦下。 */
    @Test
    void apiTemplateAuditCheckingIsRejected() {
        clientFactory.scriptedClient(ALIYUN_CHANNEL_ID).templateResponse =
                templateWithAudit(SmsTemplateAuditStatusEnum.CHECKING);

        assertBusinessError(() -> smsTemplateService.createSmsTemplate(
                templateRequest("sms_checking", "验证码 {code}", null)), SMS_TEMPLATE_API_AUDIT_CHECKING);

        assertThat(count("system_sms_template")).isEqualTo(SEEDED_TEMPLATES);
    }

    /** 审核失败必须把供应商给出的原因透出，便于运营定位被拒原因。 */
    @Test
    void apiTemplateAuditFailureKeepsProviderReason() {
        SmsTemplateRespDTO rejected = templateWithAudit(SmsTemplateAuditStatusEnum.FAIL);
        rejected.setAuditReason("变量数量不匹配");
        clientFactory.scriptedClient(ALIYUN_CHANNEL_ID).templateResponse = rejected;

        assertThatThrownBy(() -> smsTemplateService.createSmsTemplate(
                templateRequest("sms_rejected", "验证码 {code}", null)))
                .isInstanceOfSatisfying(ServiceException.class, exception -> {
                    assertThat(exception.getCode()).isEqualTo(SMS_TEMPLATE_API_AUDIT_FAIL.getCode());
                    assertThat(exception.getMessage()).as("供应商审核原因必须透出").contains("变量数量不匹配");
                });

        assertThat(count("system_sms_template")).isEqualTo(SEEDED_TEMPLATES);
    }

    /** 供应商查不到模板与调用异常都必须转成业务错误，不能让建模板接口返回 5XX。 */
    @Test
    void apiTemplateLookupFailureIsTranslated() {
        clientFactory.scriptedClient(ALIYUN_CHANNEL_ID).templateResponse = null;
        assertBusinessError(() -> smsTemplateService.createSmsTemplate(
                templateRequest("sms_not_found", "验证码 {code}", null)), SMS_TEMPLATE_API_NOT_FOUND);

        clientFactory.scriptedClient(ALIYUN_CHANNEL_ID).templateFailure =
                new IllegalStateException("provider unreachable");
        assertThatThrownBy(() -> smsTemplateService.createSmsTemplate(
                templateRequest("sms_error", "验证码 {code}", null)))
                .isInstanceOfSatisfying(ServiceException.class, exception -> {
                    assertThat(exception.getCode()).isEqualTo(SMS_TEMPLATE_API_ERROR.getCode());
                    assertThat(exception.getMessage()).as("根因必须透出").contains("provider unreachable");
                });

        assertThat(count("system_sms_template")).isEqualTo(SEEDED_TEMPLATES);
    }

    /** 审核状态无法识别时必须失败关闭，不能默认放行一条状态未知的供应商模板。 */
    @Test
    void unknownApiTemplateAuditStatusFailsClosed() {
        clientFactory.scriptedClient(ALIYUN_CHANNEL_ID).templateResponse = templateWithAudit(null);

        assertThatThrownBy(() -> smsTemplateService.createSmsTemplate(
                templateRequest("sms_unknown", "验证码 {code}", null)))
                .isInstanceOf(IllegalArgumentException.class);

        assertThat(count("system_sms_template")).isEqualTo(SEEDED_TEMPLATES);
    }

    /**
     * 更新模板必须清空按编码缓存。
     *
     * <p>缓存键是模板编码而更新入口拿到的是编号，无法定点删除，只能整段清空。
     * 若清空失效，登录验证码模板会一直用旧内容发送，验证码格式变更无法生效。</p>
     */
    @Test
    void templateUpdateEvictsTheCodeCache() {
        assertThat(smsTemplateService.getSmsTemplateByCodeFromCache(LOGIN_TEMPLATE)).isNotNull();
        jdbc.update("UPDATE system_sms_template SET content='绕过服务改库 {code}' WHERE code=?", LOGIN_TEMPLATE);
        assertThat(smsTemplateService.getSmsTemplateByCodeFromCache(LOGIN_TEMPLATE).getContent())
                .as("缓存命中时读到的是改库前的旧内容").isEqualTo("验证码 {code}");

        SmsTemplateSaveReqVO update = templateRequest(LOGIN_TEMPLATE, "新验证码 {code}", null);
        update.setId(templateIdOf(LOGIN_TEMPLATE));
        smsTemplateService.updateSmsTemplate(update);

        assertThat(smsTemplateService.getSmsTemplateByCodeFromCache(LOGIN_TEMPLATE).getContent())
                .as("更新后必须读到新内容，说明按编码缓存已被清空").isEqualTo("新验证码 {code}");
    }

    /** 删除模板同样要清缓存，否则已删除的模板会继续被命中并继续发短信。 */
    @Test
    void templateDeletionEvictsTheCodeCache() {
        Long id = templateIdOf(LOGIN_TEMPLATE);
        assertThat(smsTemplateService.getSmsTemplateByCodeFromCache(LOGIN_TEMPLATE)).isNotNull();

        smsTemplateService.deleteSmsTemplate(id);

        assertThat(smsTemplateService.getSmsTemplateByCodeFromCache(LOGIN_TEMPLATE))
                .as("已删除模板不得再从缓存命中").isNull();
        assertBusinessError(() -> smsTemplateService.deleteSmsTemplate(id), SMS_TEMPLATE_NOT_EXISTS);
    }

    /**
     * 空结果不得进缓存。
     *
     * <p>若把“查不到”也缓存起来，随后建好的模板在一段时间内会持续返回空，
     * 表现为新建的登录验证码模板发不出短信。</p>
     */
    @Test
    void missingTemplateIsNotCached() {
        assertThat(smsTemplateService.getSmsTemplateByCodeFromCache("sms_new")).isNull();

        smsTemplateService.createSmsTemplate(templateRequest("sms_new", "验证码 {code}", null));

        assertThat(smsTemplateService.getSmsTemplateByCodeFromCache("sms_new"))
                .as("空结果未被缓存，新建模板应立即可见").isNotNull();
    }

    /** 渠道编码重复必须报出供应商可读名称而不是内部编码。 */
    @Test
    void duplicateChannelCodeReportsSupplierName() {
        assertThatThrownBy(() -> smsChannelService.createSmsChannel(channelRequest(ALIYUN)))
                .isInstanceOfSatisfying(ServiceException.class, exception -> {
                    assertThat(exception.getCode()).isEqualTo(SMS_CHANNEL_CODE_DUPLICATE.getCode());
                    assertThat(exception.getMessage()).as("应回带枚举里的供应商名称").contains("阿里云");
                });

        assertThat(count("system_sms_channel")).isEqualTo(SEEDED_CHANNELS);
    }

    /**
     * 改渠道时允许保留自身编码，但不得占用他人编码。
     *
     * <p>唯一性校验若不排除自身，正常改名就会被判重复；若排除条件写错，
     * 就会允许把一个渠道的编码改成另一个渠道已占用的编码。</p>
     */
    @Test
    void channelUpdateKeepsOwnCodeAndRejectsForeignCode() {
        SmsChannelSaveReqVO keepOwn = channelRequest(ALIYUN);
        keepOwn.setId(ALIYUN_CHANNEL_ID);
        keepOwn.setSignature("改后的签名");
        smsChannelService.updateSmsChannel(keepOwn);

        assertThat(smsChannelService.getSmsChannel(ALIYUN_CHANNEL_ID).getSignature()).isEqualTo("改后的签名");

        Long tencentId = smsChannelService.createSmsChannel(channelRequest(TENCENT));
        SmsChannelSaveReqVO steal = channelRequest(ALIYUN);
        steal.setId(tencentId);
        assertBusinessError(() -> smsChannelService.updateSmsChannel(steal), SMS_CHANNEL_CODE_DUPLICATE);

        assertThat(smsChannelService.getSmsChannel(tencentId).getCode()).isEqualTo(TENCENT);
    }

    /** 仍有模板引用的渠道不能删除，否则模板会指向不存在的渠道。 */
    @Test
    void channelWithTemplatesCannotBeDeleted() {
        assertBusinessError(() -> smsChannelService.deleteSmsChannel(ALIYUN_CHANNEL_ID), SMS_CHANNEL_HAS_CHILDREN);

        assertThat(count("system_sms_channel")).isEqualTo(SEEDED_CHANNELS);
    }

    /**
     * 批量删除渠道是全有或全无。
     *
     * <p>只要集合里有任意一个渠道仍被模板引用，整批都不能删；
     * 若先删后校验，被引用的渠道会被误删且无法回退。</p>
     */
    @Test
    void bulkChannelDeletionIsAllOrNothing() {
        Long tencentId = smsChannelService.createSmsChannel(channelRequest(TENCENT));

        assertBusinessError(() -> smsChannelService.deleteSmsChannelList(List.of(tencentId, ALIYUN_CHANNEL_ID)),
                SMS_CHANNEL_HAS_CHILDREN);

        assertThat(count("system_sms_channel")).as("被模板引用的阿里云渠道必须保留").isEqualTo(SEEDED_CHANNELS + 1);

        smsChannelService.deleteSmsChannelList(List.of(tencentId));
        assertThat(count("system_sms_channel")).isEqualTo(SEEDED_CHANNELS);
    }

    /** 渠道到客户端的凭据映射必须来自渠道行，否则会用错账号发送。 */
    @Test
    void channelClientLookupCarriesRowCredentials() {
        jdbc.update("UPDATE system_sms_channel SET signature='签名A', api_key='keyA', api_secret='secretA', "
                + "callback_url='http://127.0.0.1/callback' WHERE id=?", ALIYUN_CHANNEL_ID);

        SmsClient client = smsChannelService.getSmsClient(ALIYUN_CHANNEL_ID);

        assertThat(client).isNotNull();
        SmsChannelProperties properties = clientFactory.lastCreated();
        assertThat(properties.getId()).isEqualTo(ALIYUN_CHANNEL_ID);
        assertThat(properties.getSignature()).isEqualTo("签名A");
        assertThat(properties.getApiKey()).isEqualTo("keyA");
        assertThat(properties.getApiSecret()).isEqualTo("secretA");
        assertThat(properties.getCallbackUrl()).isEqualTo("http://127.0.0.1/callback");
    }

    /** 按编码取客户端用于解析回执，与按编号取客户端是两条独立注册路径。 */
    @Test
    void channelClientLookupByCodeUsesCodeRegistry() {
        clientFactory.registerByCode(TENCENT, new ScriptedSmsClient(77L));

        assertThat(smsChannelService.getSmsClient(TENCENT)).isNotNull();
        assertThat(smsChannelService.getSmsClient("NOT_REGISTERED")).isNull();
    }

    /**
     * 发送成功必须落一条待发送日志并派发一条事件。
     *
     * <p>日志是事后对账的唯一依据，事件是实际发送的入口，两者缺一都会让短信不可追溯。</p>
     */
    @Test
    void sendRecordsInitLogAndPublishesMessage() {
        Long logId = smsSendService.sendSingleSms(MOBILE, 7L, UserTypeEnum.ADMIN.getValue(),
                LOGIN_TEMPLATE, Map.of("code", "1234"));

        SmsLogDO log = readLog(logId);
        assertThat(log.getSendStatus()).isEqualTo(SmsSendStatusEnum.INIT.getStatus());
        assertThat(log.getReceiveStatus()).isEqualTo(SmsReceiveStatusEnum.INIT.getStatus());
        assertThat(log.getMobile()).isEqualTo(MOBILE);
        assertThat(log.getUserId()).isEqualTo(7L);
        assertThat(log.getUserType()).isEqualTo(UserTypeEnum.ADMIN.getValue());
        assertThat(log.getTemplateContent()).isEqualTo("验证码 1234");
        assertThat(log.getTemplateParams()).containsEntry("code", "1234");
        assertThat(log.getChannelId()).isEqualTo(ALIYUN_CHANNEL_ID);
        assertThat(log.getChannelCode()).isEqualTo(ALIYUN);
        assertThat(log.getTemplateId()).isEqualTo(templateIdOf(LOGIN_TEMPLATE));
        assertThat(log.getTemplateCode()).isEqualTo(LOGIN_TEMPLATE);
        assertThat(log.getApiTemplateId()).isEqualTo("SMS_001");
        assertThat(recorder.messages).hasSize(1);
        assertThat(recorder.messages.get(0).getLogId()).isEqualTo(logId);
        assertThat(recorder.messages.get(0).getChannelId()).isEqualTo(ALIYUN_CHANNEL_ID);
        assertThat(recorder.messages.get(0).getApiTemplateId()).isEqualTo("SMS_001");
    }

    /**
     * 事件里的参数顺序必须来自模板声明顺序。
     *
     * <p>腾讯云按数组下标取值，调用方 Map 的迭代顺序与模板顺序不一致时会把验证码填进签名位，
     * 用户收到的是错位内容。</p>
     */
    @Test
    void eventParamsFollowTemplateOrderNotCallerMap() {
        jdbc.update("UPDATE system_sms_template SET content='{second} 与 {first}', params='[\"second\",\"first\"]' "
                + "WHERE code=?", LOGIN_TEMPLATE);
        Map<String, Object> callerParams = new LinkedHashMap<>();
        callerParams.put("first", "甲");
        callerParams.put("second", "乙");

        smsSendService.sendSingleSms(MOBILE, 7L, UserTypeEnum.ADMIN.getValue(), LOGIN_TEMPLATE, callerParams);

        List<KeyValue<String, Object>> params = recorder.messages.get(0).getTemplateParams();
        assertThat(params).extracting(KeyValue::getKey).containsExactly("second", "first");
        assertThat(params).extracting(KeyValue::getValue).containsExactly("乙", "甲");
    }

    /**
     * 被禁用的模板只记日志不发短信。
     *
     * <p>模板开关是运营侧的最终熔断，失效时仍继续发送等于开关形同虚设；
     * 但日志仍要写，发送状态标记为忽略以便区分“未发送”与“发送失败”。</p>
     */
    @Test
    void disabledTemplateRecordsIgnoreAndSendsNothing() {
        jdbc.update("UPDATE system_sms_template SET status=? WHERE code=?",
                CommonStatusEnum.DISABLE.getStatus(), LOGIN_TEMPLATE);

        Long logId = smsSendService.sendSingleSms(MOBILE, 7L, UserTypeEnum.ADMIN.getValue(),
                LOGIN_TEMPLATE, Map.of("code", "1234"));

        assertThat(readLog(logId).getSendStatus()).isEqualTo(SmsSendStatusEnum.IGNORE.getStatus());
        assertThat(recorder.messages).as("被禁用的模板不得派发发送事件").isEmpty();
    }

    /** 被禁用的渠道同样只记日志不发短信。 */
    @Test
    void disabledChannelRecordsIgnoreAndSendsNothing() {
        jdbc.update("UPDATE system_sms_channel SET status=? WHERE id=?",
                CommonStatusEnum.DISABLE.getStatus(), ALIYUN_CHANNEL_ID);

        Long logId = smsSendService.sendSingleSms(MOBILE, 7L, UserTypeEnum.ADMIN.getValue(),
                LOGIN_TEMPLATE, Map.of("code", "1234"));

        assertThat(readLog(logId).getSendStatus()).isEqualTo(SmsSendStatusEnum.IGNORE.getStatus());
        assertThat(recorder.messages).isEmpty();
    }

    /**
     * 参数缺失必须在写日志前失败。
     *
     * <p>先记日志再校验参数会留下一条内容残缺的“已发送”记录，
     * 排查时无法区分是没传参还是发送失败。</p>
     */
    @Test
    void missingTemplateParamFailsBeforeAnyLog() {
        assertThatThrownBy(() -> smsSendService.sendSingleSms(MOBILE, 7L, UserTypeEnum.ADMIN.getValue(),
                LOGIN_TEMPLATE, Map.of()))
                .isInstanceOfSatisfying(ServiceException.class, exception -> {
                    assertThat(exception.getCode()).isEqualTo(SMS_SEND_MOBILE_TEMPLATE_PARAM_MISS.getCode());
                    assertThat(exception.getMessage()).as("必须指出缺失的参数名").contains("code");
                });

        assertThat(count("system_sms_log")).isZero();
        assertThat(recorder.messages).isEmpty();
    }

    /** 手机号为空必须在落库前失败，避免生成一条无处投递的日志。 */
    @Test
    void emptyMobileFailsBeforeAnyLog() {
        assertBusinessError(() -> smsSendService.sendSingleSms("", 7L, UserTypeEnum.ADMIN.getValue(),
                LOGIN_TEMPLATE, Map.of("code", "1234")), SMS_SEND_MOBILE_NOT_EXISTS);

        assertThat(count("system_sms_log")).isZero();
        assertThat(recorder.messages).isEmpty();
    }

    /** 模板不存在与模板指向的渠道已消失都必须被拒绝，不能带着悬空引用发送。 */
    @Test
    void unknownTemplateOrChannelIsRejected() {
        assertBusinessError(() -> smsSendService.sendSingleSms(MOBILE, 7L, UserTypeEnum.ADMIN.getValue(),
                "sms_absent", Map.of("code", "1234")), SMS_SEND_TEMPLATE_NOT_EXISTS);

        jdbc.update("UPDATE system_sms_template SET channel_id=999 WHERE code=?", LOGIN_TEMPLATE);
        assertBusinessError(() -> smsSendService.sendSingleSms(MOBILE, 7L, UserTypeEnum.ADMIN.getValue(),
                LOGIN_TEMPLATE, Map.of("code", "1234")), SMS_CHANNEL_NOT_EXISTS);

        assertThat(count("system_sms_log")).isZero();
    }

    /** 管理员发送未指定手机号时按用户档案补齐，模板参数仍然生效。 */
    @Test
    void sendToAdminResolvesMobileFromUserRecord() {
        when(adminUserService.getUser(7L)).thenReturn(adminUser(MOBILE));

        Long logId = smsSendService.sendSingleSmsToAdmin(null, 7L, LOGIN_TEMPLATE, Map.of("code", "1234"));

        assertThat(readLog(logId).getMobile()).isEqualTo(MOBILE);
    }

    /**
     * 查不到用户档案时必须失败，不能把空手机号当成可发送。
     *
     * <p>继续执行会把 null 写进手机号列，供应商侧要么拒发要么退化成异常短信。</p>
     */
    @Test
    void sendToAdminWithUnknownUserFailsInsteadOfSendingToNull() {
        when(adminUserService.getUser(7L)).thenReturn(null);

        assertBusinessError(() -> smsSendService.sendSingleSmsToAdmin(null, 7L, LOGIN_TEMPLATE,
                Map.of("code", "1234")), SMS_SEND_MOBILE_NOT_EXISTS);

        assertThat(count("system_sms_log")).isZero();
    }

    /** 会员发送没有管理员档案可查，不得回落到管理员手机号，否则验证码会发到管理员手机上。 */
    @Test
    void sendToMemberNeverFallsBackToAdminUserRecord() {
        when(adminUserService.getUser(7L)).thenReturn(adminUser(MOBILE));

        assertBusinessError(() -> smsSendService.sendSingleSmsToMember(null, 7L, LOGIN_TEMPLATE,
                Map.of("code", "1234")), SMS_SEND_MOBILE_NOT_EXISTS);

        verify(adminUserService, never()).getUser(7L);
        assertThat(count("system_sms_log")).isZero();
    }

    /** 发送成功必须把供应商返回的编码、流水号与请求编号全部落库，供对账与重投使用。 */
    @Test
    void doSendSmsPersistsProviderSuccess() {
        Long logId = sendAndCaptureMessage();
        ScriptedSmsClient client = clientFactory.scriptedClient(ALIYUN_CHANNEL_ID);
        client.sendResponse = sendResponse(true, "OK", "短信发送成功", "serial-1", "request-1");

        smsSendService.doSendSms(recorder.messages.get(0));

        SmsLogDO log = readLog(logId);
        assertThat(log.getSendStatus()).isEqualTo(SmsSendStatusEnum.SUCCESS.getStatus());
        assertThat(log.getApiSendCode()).isEqualTo("OK");
        assertThat(log.getApiSendMsg()).isEqualTo("短信发送成功");
        assertThat(log.getApiSerialNo()).isEqualTo("serial-1");
        assertThat(log.getApiRequestId()).isEqualTo("request-1");
        assertThat(log.getSendTime()).as("成功发送必须记录发送时间").isNotNull();
        assertThat(client.sentMobile).as("发送给供应商的手机号必须来自消息").isEqualTo(MOBILE);
        assertThat(client.sentParams).extracting(KeyValue::getKey).containsExactly("code");
    }

    /**
     * 供应商异常不得中断消费者。
     *
     * <p>异常向上抛会让消息被反复重投；吞掉异常又会让日志停在待发送。
     * 正确行为是记为失败并保留根因。</p>
     */
    @Test
    void doSendSmsMarksFailureWhenClientThrows() {
        Long logId = sendAndCaptureMessage();
        clientFactory.scriptedClient(ALIYUN_CHANNEL_ID).sendFailure = new IllegalStateException("socket closed");

        assertThatCode(() -> smsSendService.doSendSms(recorder.messages.get(0)))
                .as("供应商异常必须被兜住，否则消息会被无限重投").doesNotThrowAnyException();

        SmsLogDO log = readLog(logId);
        assertThat(log.getSendStatus()).isEqualTo(SmsSendStatusEnum.FAILURE.getStatus());
        assertThat(log.getApiSendCode()).isEqualTo("EXCEPTION");
        assertThat(log.getApiSendMsg()).as("必须保留根因信息").contains("socket closed");
        assertThat(log.getSendTime()).isNotNull();
    }

    /**
     * 渠道客户端缺失必须显式失败。
     *
     * <p>若此时把日志标成发送失败，就会把配置缺失伪装成供应商故障，掩盖真正的配置问题。</p>
     */
    @Test
    void doSendSmsFailsLoudlyForUnknownChannel() {
        Long logId = sendAndCaptureMessage();
        clientFactory.markChannelWithoutClient(ALIYUN_CHANNEL_ID);

        assertThatThrownBy(() -> smsSendService.doSendSms(recorder.messages.get(0)))
                .isInstanceOf(IllegalArgumentException.class);

        assertThat(readLog(logId).getSendStatus())
                .as("客户端缺失时日志必须保持待发送").isEqualTo(SmsSendStatusEnum.INIT.getStatus());
    }

    /**
     * 回执按渠道、流水号与手机号同时匹配。
     *
     * <p>腾讯云不回内部日志编号，只能靠发送时保存的流水号关联；
     * 匹配成功后必须把供应商的接收时间与结果一并落库。</p>
     */
    @Test
    void receiptIsMatchedByChannelSerialNoAndMobile() {
        Long logId = sendAndMarkDelivered();
        SmsReceiveRespDTO received = new SmsReceiveRespDTO();
        received.setSuccess(false);
        received.setSerialNo("serial-1");
        received.setMobile(MOBILE);
        received.setErrorCode("isv.BUSINESS_LIMIT_CONTROL");
        received.setErrorMsg("触发流控");
        received.setReceiveTime(LocalDateTime.now().minusMinutes(1));
        ScriptedSmsClient client = clientFactory.receiptClient();
        client.receiveResults = List.of(received);

        smsSendService.receiveSmsStatus(ALIYUN, "receipt-body");

        SmsLogDO log = readLog(logId);
        assertThat(log.getReceiveStatus()).isEqualTo(SmsReceiveStatusEnum.FAILURE.getStatus());
        assertThat(log.getApiReceiveCode()).isEqualTo("isv.BUSINESS_LIMIT_CONTROL");
        assertThat(log.getApiReceiveMsg()).isEqualTo("触发流控");
        assertThat(log.getReceiveTime()).isNotNull();
        assertThat(client.parsedText).isEqualTo("receipt-body");
    }

    /** 空解析结果属于无效回执，必须拒绝且不改写日志，不能向匿名入口虚报成功。 */
    @Test
    void emptyReceiptLeavesLogUntouched() {
        Long logId = sendAndMarkDelivered();
        clientFactory.receiptClient().receiveResults = List.of();

        assertThatThrownBy(() -> smsSendService.receiveSmsStatus(ALIYUN, "unparsable"))
                .isInstanceOf(SmsReceiptException.class);

        assertThat(readLog(logId).getReceiveStatus()).isEqualTo(SmsReceiveStatusEnum.INIT.getStatus());
    }

    /**
     * 回执匹配不到发送日志时必须拒绝，由回调入口返回 400 且不新建日志。
     *
     * <p>匿名公网输入不能靠伪造流水号创建日志，也不能用服务端失败引发无意义重试。</p>
     */
    @Test
    void unmatchedReceiptIsRejectedWithoutCreatingLog() {
        Long logId = sendAndMarkDelivered();
        ScriptedSmsClient client = clientFactory.receiptClient();
        client.receiveResults = List.of(receiveResult(true, "serial-unknown", MOBILE));

        assertThatThrownBy(() -> smsSendService.receiveSmsStatus(ALIYUN, "receipt-body"))
                .isInstanceOf(SmsReceiptException.class);

        assertThat(readLog(logId).getReceiveStatus())
                .as("匹配失败时不得改写任何日志").isEqualTo(SmsReceiveStatusEnum.INIT.getStatus());
        assertThat(count("system_sms_log")).isEqualTo(1);
    }

    /**
     * 流水号相同但手机号不同不得命中。
     *
     * <p>只按流水号匹配会让一条短信的接收结果写到另一个收件人的日志上，
     * 是把用户数据串到错误记录上的越界问题。</p>
     */
    @Test
    void receiptForAnotherMobileDoesNotMatch() {
        Long logId = sendAndMarkDelivered();
        ScriptedSmsClient client = clientFactory.receiptClient();
        client.receiveResults = List.of(receiveResult(true, "serial-1", "13900000009"));

        assertThatThrownBy(() -> smsSendService.receiveSmsStatus(ALIYUN, "receipt-body"))
                .isInstanceOf(SmsReceiptException.class);

        assertThat(readLog(logId).getReceiveStatus()).isEqualTo(SmsReceiveStatusEnum.INIT.getStatus());
    }

    /** 回执缺少渠道、流水号、手机号或接收结果时必须拒绝，不能退化成部分条件匹配。 */
    @Test
    void receiptWithoutIdentifyingFieldsIsRejected() {
        Long logId = sendAndMarkDelivered();

        assertThatThrownBy(() -> smsLogService.updateSmsReceiveResult(
                ALIYUN, null, "serial-1", "", true, LocalDateTime.now(), "OK", "成功"))
                .isInstanceOf(SmsReceiptException.class);
        assertThatThrownBy(() -> smsLogService.updateSmsReceiveResult(
                ALIYUN, null, "", MOBILE, true, LocalDateTime.now(), "OK", "成功"))
                .isInstanceOf(SmsReceiptException.class);
        assertThatThrownBy(() -> smsLogService.updateSmsReceiveResult(
                " ", null, "serial-1", MOBILE, true, LocalDateTime.now(), "OK", "成功"))
                .isInstanceOf(SmsReceiptException.class);
        assertThatThrownBy(() -> smsLogService.updateSmsReceiveResult(
                ALIYUN, null, "serial-1", MOBILE, null, LocalDateTime.now(), "OK", "成功"))
                .isInstanceOf(SmsReceiptException.class);
        assertThatThrownBy(() -> smsLogService.updateSmsReceiveResult(
                ALIYUN, null, "serial-1", MOBILE, true, null, "OK", "成功"))
                .isInstanceOf(SmsReceiptException.class);

        assertThat(readLog(logId).getReceiveStatus()).isEqualTo(SmsReceiveStatusEnum.INIT.getStatus());
    }

    /** 按编号关联时编号必须同时命中，防止串号改写他人日志。 */
    @Test
    void receiptByLogIdCrossChecksInternalId() {
        Long logId = sendAndMarkDelivered();

        assertThatThrownBy(() -> smsLogService.updateSmsReceiveResult(
                ALIYUN, logId + 1000, "serial-1", MOBILE, true, LocalDateTime.now(), "OK", "成功"))
                .isInstanceOf(SmsReceiptException.class);
        assertThat(readLog(logId).getReceiveStatus()).isEqualTo(SmsReceiveStatusEnum.INIT.getStatus());

        smsLogService.updateSmsReceiveResult(ALIYUN, logId, "serial-1", MOBILE, true, LocalDateTime.now(), "OK", "成功");

        assertThat(readLog(logId).getReceiveStatus()).isEqualTo(SmsReceiveStatusEnum.SUCCESS.getStatus());
    }

    /** 相同流水号和手机号出现在另一渠道时，只能更新当前回调渠道的日志。 */
    @Test
    void receiptCannotCrossChannelsWithMatchingSerialAndMobile() {
        Long aliyunLogId = sendAndMarkDelivered();
        Long tencentChannelId = smsChannelService.createSmsChannel(channelRequest(TENCENT));
        SmsLogDO tencentLog = readLog(aliyunLogId);
        tencentLog.setId(null);
        tencentLog.setChannelId(tencentChannelId);
        tencentLog.setChannelCode(TENCENT);
        context.getBean(SmsLogMapper.class).insert(tencentLog);

        smsLogService.updateSmsReceiveResult(ALIYUN, null, "serial-1", MOBILE,
                true, LocalDateTime.now(), "OK", "成功");

        assertThat(readLog(aliyunLogId).getReceiveStatus()).isEqualTo(SmsReceiveStatusEnum.SUCCESS.getStatus());
        assertThat(readLog(tencentLog.getId()).getReceiveStatus()).isEqualTo(SmsReceiveStatusEnum.INIT.getStatus());
        assertThatThrownBy(() -> smsLogService.updateSmsReceiveResult(TENCENT, aliyunLogId, "serial-1", MOBILE,
                false, LocalDateTime.now(), "FAIL", "失败"))
                .isInstanceOf(SmsReceiptException.class);
        assertThat(count("system_sms_log")).isEqualTo(2);
    }

    /** 批次后部出现未知流水号时必须回滚先前匹配记录，不能返回拒绝却只落库半批回执。 */
    @Test
    void unmatchedReceiptRollsBackEarlierResultsInBatch() {
        Long logId = sendAndMarkDelivered();
        clientFactory.receiptClient().receiveResults = List.of(
                receiveResult(true, "serial-1", MOBILE), receiveResult(false, "unknown", MOBILE));

        assertThatThrownBy(() -> smsSendService.receiveSmsStatus(ALIYUN, "receipt-body"))
                .isInstanceOf(SmsReceiptException.class);

        SmsLogDO received = readLog(logId);
        assertThat(received.getReceiveStatus()).isEqualTo(SmsReceiveStatusEnum.INIT.getStatus());
        assertThat(received.getApiReceiveCode()).isNull();
        assertThat(received.getReceiveTime()).isNull();
        assertThat(count("system_sms_log")).isEqualTo(1);
    }

    /** 原子更新入口缺少任一关联标识时必须零写入，不能因 Wrapper 省略条件扩大更新范围。 */
    @Test
    void conditionalReceiptUpdateRequiresEveryIdentifier() {
        Long logId = sendAndMarkDelivered();
        SmsLogMapper mapper = context.getBean(SmsLogMapper.class);
        SmsLogDO update = new SmsLogDO();
        update.setReceiveStatus(SmsReceiveStatusEnum.SUCCESS.getStatus());

        assertThat(mapper.updateReceiveResultIfInitial(null, ALIYUN, "serial-1", MOBILE, update)).isZero();
        assertThat(mapper.updateReceiveResultIfInitial(logId, " ", "serial-1", MOBILE, update)).isZero();
        assertThat(mapper.updateReceiveResultIfInitial(logId, ALIYUN, " ", MOBILE, update)).isZero();
        assertThat(mapper.updateReceiveResultIfInitial(logId, ALIYUN, "serial-1", " ", update)).isZero();
        assertThat(readLog(logId).getReceiveStatus()).isEqualTo(SmsReceiveStatusEnum.INIT.getStatus());
    }

    /** 重复成功回执不能刷新已确认的接收时间或供应商结果，保证重投的幂等性。 */
    @Test
    void duplicateReceiptPreservesFirstTerminalDetails() {
        Long logId = sendAndMarkDelivered();
        LocalDateTime firstTime = LocalDateTime.of(2026, 1, 2, 3, 4, 5);
        smsLogService.updateSmsReceiveResult(ALIYUN, logId, "serial-1", MOBILE,
                true, firstTime, "FIRST", "首次结果");

        smsLogService.updateSmsReceiveResult(ALIYUN, logId, "serial-1", MOBILE,
                true, firstTime.plusMinutes(1), "DUPLICATE", "重复结果");

        SmsLogDO received = readLog(logId);
        assertThat(received.getReceiveStatus()).isEqualTo(SmsReceiveStatusEnum.SUCCESS.getStatus());
        assertThat(received.getReceiveTime()).isEqualTo(firstTime);
        assertThat(received.getApiReceiveCode()).isEqualTo("FIRST");
        assertThat(received.getApiReceiveMsg()).isEqualTo("首次结果");
    }

    /** 失败同样是终态；更早成功回执与更晚矛盾回执都不能重写首次确认的失败。 */
    @Test
    void outOfOrderReceiptCannotOverwriteFailure() {
        Long logId = sendAndMarkDelivered();
        LocalDateTime firstTime = LocalDateTime.of(2026, 1, 2, 3, 4, 5);
        smsLogService.updateSmsReceiveResult(ALIYUN, logId, "serial-1", MOBILE,
                false, firstTime, "FAIL", "首次失败");

        smsLogService.updateSmsReceiveResult(ALIYUN, logId, "serial-1", MOBILE,
                true, firstTime.minusMinutes(1), "OLD", "旧成功");
        smsLogService.updateSmsReceiveResult(ALIYUN, logId, "serial-1", MOBILE,
                true, firstTime.plusMinutes(1), "LATER", "后到成功");

        SmsLogDO received = readLog(logId);
        assertThat(received.getReceiveStatus()).isEqualTo(SmsReceiveStatusEnum.FAILURE.getStatus());
        assertThat(received.getReceiveTime()).isEqualTo(firstTime);
        assertThat(received.getApiReceiveCode()).isEqualTo("FAIL");
        assertThat(received.getApiReceiveMsg()).isEqualTo("首次失败");
    }

    /** 逻辑删除的发送日志不是匿名回执可更新的对象，不能通过原子更新绕过生命周期边界。 */
    @Test
    void receiptCannotUpdateDeletedLog() {
        Long logId = sendAndMarkDelivered();
        context.getBean(SmsLogMapper.class).deleteById(logId);

        assertThatThrownBy(() -> smsLogService.updateSmsReceiveResult(ALIYUN, logId, "serial-1", MOBILE,
                true, LocalDateTime.now(), "OK", "成功"))
                .isInstanceOf(SmsReceiptException.class);
        assertThat(jdbc.queryForObject("SELECT receive_status FROM system_sms_log WHERE id=?", Integer.class, logId))
                .isEqualTo(SmsReceiveStatusEnum.INIT.getStatus());
    }

    /**
     * 两条回执都读取初始状态后竞争真实 SQL 更新，数据库只能接受一次终态写入。
     *
     * <p>预读屏障固定了原先“查后按编号更新”的竞争窗口，不依赖线程碰巧同时读到初始值；
     * 两个独立 MyBatis 会话只共享生产数据库记录，不能用同一会话缓存掩盖真实状态。</p>
     *
     * @throws Exception 并发任务失败、等待超时或线程中断时向测试运行器传播失败
     */
    @Test
    void competingReceiptsWriteOnlyOneTerminal() throws Exception {
        Long logId = sendAndMarkDelivered();
        CountDownLatch selected = new CountDownLatch(2);
        CountDownLatch updateGate = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<Integer> success = executor.submit(() -> writeCompetingReceipt(logId, true, selected, updateGate));
            Future<Integer> failure = executor.submit(() -> writeCompetingReceipt(logId, false, selected, updateGate));
            assertThat(selected.await(5, TimeUnit.SECONDS)).as("两条回执都必须先完成初始状态读取").isTrue();
            updateGate.countDown();

            assertThat(List.of(success.get(5, TimeUnit.SECONDS), failure.get(5, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(1, 0);
            SmsLogDO received = readLog(logId);
            assertThat(received.getReceiveStatus()).isIn(
                    SmsReceiveStatusEnum.SUCCESS.getStatus(), SmsReceiveStatusEnum.FAILURE.getStatus());
            assertThat(received.getApiReceiveCode()).isEqualTo(
                    received.getReceiveStatus() == SmsReceiveStatusEnum.SUCCESS.getStatus() ? "SUCCESS" : "FAILURE");
        } finally {
            updateGate.countDown();
            executor.shutdownNow();
            assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).as("竞争回执线程必须退出").isTrue();
        }
    }

    /**
     * 在独立真实会话中固定初始快照，再通过生产 Mapper 争夺首次终态写入。
     *
     * @param logId 两条竞争回执共同关联的发送日志编号
     * @param success 本条回执报告的终态
     * @param selected 两条回执完成预读的屏障
     * @param updateGate 主线程确认两次预读后释放的写入许可
     * @return 原子更新的行数，竞争获胜为一、已确认终态为零
     * @throws InterruptedException 等待写入许可时被测试清理线程中断
     */
    private int writeCompetingReceipt(Long logId, boolean success, CountDownLatch selected,
                                       CountDownLatch updateGate) throws InterruptedException {
        try (SqlSession session = context.getBean(SqlSessionFactory.class).openSession(true)) {
            SmsLogMapper mapper = session.getMapper(SmsLogMapper.class);
            SmsLogDO initial = mapper.selectByReceiveCallback(ALIYUN, logId, "serial-1", MOBILE);
            assertThat(initial.getReceiveStatus()).isEqualTo(SmsReceiveStatusEnum.INIT.getStatus());
            selected.countDown();
            assertThat(updateGate.await(5, TimeUnit.SECONDS)).as("预读屏障必须及时释放").isTrue();
            SmsLogDO update = new SmsLogDO();
            update.setReceiveStatus(success ? SmsReceiveStatusEnum.SUCCESS.getStatus() : SmsReceiveStatusEnum.FAILURE.getStatus());
            update.setApiReceiveCode(success ? "SUCCESS" : "FAILURE");
            return mapper.updateReceiveResultIfInitial(logId, ALIYUN, "serial-1", MOBILE, update);
        }
    }

    /** 没有模板引用的渠道可以正常删除，删除后不得再被查到。 */
    @Test
    void channelWithoutTemplatesCanBeDeleted() {
        Long tencentId = smsChannelService.createSmsChannel(channelRequest(TENCENT));

        smsChannelService.deleteSmsChannel(tencentId);

        assertThat(smsChannelService.getSmsChannel(tencentId)).isNull();
        assertThat(count("system_sms_channel")).isEqualTo(SEEDED_CHANNELS);
    }

    /** 渠道不存在时改与删都必须失败，不能对不存在的行执行写操作后静默返回。 */
    @Test
    void channelMustExistBeforeUpdateOrDelete() {
        SmsChannelSaveReqVO update = channelRequest(TENCENT);
        update.setId(999L);

        assertBusinessError(() -> smsChannelService.updateSmsChannel(update), SMS_CHANNEL_NOT_EXISTS);
        assertBusinessError(() -> smsChannelService.deleteSmsChannel(999L), SMS_CHANNEL_NOT_EXISTS);
    }

    /**
     * 渠道列表与分页必须落到真实查询条件。
     *
     * <p>分页条件拼错会让管理端看到不属于当前筛选的渠道，属于可见数据越界。</p>
     */
    @Test
    void channelListAndPageQueriesApplyRealFilters() {
        Long tencentId = smsChannelService.createSmsChannel(channelRequest(TENCENT));

        assertThat(smsChannelService.getSmsChannelList()).extracting(SmsChannelDO::getId)
                .containsExactlyInAnyOrder(ALIYUN_CHANNEL_ID, tencentId);

        SmsChannelPageReqVO byCode = new SmsChannelPageReqVO();
        byCode.setCode(TENCENT);
        assertThat(smsChannelService.getSmsChannelPage(byCode).getList()).extracting(SmsChannelDO::getId)
                .as("按编码精确过滤").containsExactly(tencentId);

        SmsChannelPageReqVO bySignature = new SmsChannelPageReqVO();
        bySignature.setSignature("测试");
        assertThat(smsChannelService.getSmsChannelPage(bySignature).getTotal()).isEqualTo(2L);

        SmsChannelPageReqVO byStatus = new SmsChannelPageReqVO();
        byStatus.setStatus(CommonStatusEnum.DISABLE.getStatus());
        assertThat(smsChannelService.getSmsChannelPage(byStatus).getList())
                .as("按状态过滤").isEmpty();
    }

    /**
     * 模板分页与按渠道计数必须落到真实查询条件。
     *
     * <p>按渠道计数直接决定渠道能否被删除，计数放宽会让仍有模板的渠道被删掉。</p>
     */
    @Test
    void templatePageAndChannelCountApplyRealFilters() {
        Long second = smsTemplateService.createSmsTemplate(
                templateRequest("sms_order", "订单 {orderNo} 已发货", null));
        assertThat(smsTemplateService.getSmsTemplateCountByChannelId(ALIYUN_CHANNEL_ID)).isEqualTo(2L);
        assertThat(smsTemplateService.getSmsTemplateCountByChannelId(999L)).isZero();

        SmsTemplatePageReqVO byCode = new SmsTemplatePageReqVO();
        byCode.setCode("sms_order");
        assertThat(smsTemplateService.getSmsTemplatePage(byCode).getList()).extracting(SmsTemplateDO::getId)
                .as("按编码模糊匹配").containsExactly(second);

        SmsTemplatePageReqVO byContent = new SmsTemplatePageReqVO();
        byContent.setContent("已发货");
        assertThat(smsTemplateService.getSmsTemplatePage(byContent).getList()).extracting(SmsTemplateDO::getId)
                .as("按内容模糊匹配").containsExactly(second);

        SmsTemplatePageReqVO byType = new SmsTemplatePageReqVO();
        byType.setType(SmsTemplateTypeEnum.PROMOTION.getType());
        assertThat(smsTemplateService.getSmsTemplatePage(byType).getList())
                .as("按类型精确过滤").isEmpty();
    }

    /** 批量删除模板必须清缓存并真正删行，不能只删不失效。 */
    @Test
    void templateBulkDeleteRemovesRowsAndEvictsCache() {
        Long second = smsTemplateService.createSmsTemplate(templateRequest("sms_order", "订单 {orderNo}", null));
        assertThat(smsTemplateService.getSmsTemplateByCodeFromCache(LOGIN_TEMPLATE)).isNotNull();

        smsTemplateService.deleteSmsTemplateList(List.of(templateIdOf(LOGIN_TEMPLATE), second));

        assertThat(count("system_sms_template")).isZero();
        assertThat(smsTemplateService.getSmsTemplateByCodeFromCache(LOGIN_TEMPLATE))
                .as("批量删除同样要清缓存").isNull();
    }

    /** 改模板时占用他人编码必须失败，避免两条模板共享同一个业务编码。 */
    @Test
    void templateUpdateRejectsAnotherTemplateCode() {
        Long second = smsTemplateService.createSmsTemplate(templateRequest("sms_order", "订单 {orderNo}", null));
        SmsTemplateSaveReqVO steal = templateRequest(LOGIN_TEMPLATE, "改内容 {code}", null);
        steal.setId(second);

        assertBusinessError(() -> smsTemplateService.updateSmsTemplate(steal), SMS_TEMPLATE_CODE_DUPLICATE);

        assertThat(smsTemplateService.getSmsTemplate(second).getCode())
                .as("被冒用的模板编码不得被改走").isEqualTo("sms_order");
    }

    /** 会员发送必须按会员用户类型落库，不得混入管理员类型导致统计口径错误。 */
    @Test
    void memberSendIsRecordedWithMemberUserType() {
        Long logId = smsSendService.sendSingleSmsToMember(MOBILE, null, LOGIN_TEMPLATE, Map.of("code", "1234"));

        SmsLogDO log = readLog(logId);
        assertThat(log.getUserType()).isEqualTo(UserTypeEnum.MEMBER.getValue());
        assertThat(log.getUserId()).isNull();
        assertThat(recorder.messages).hasSize(1);
    }

    /** 模板类型枚举必须暴露稳定的类型编码，模板创建与分页都依赖它。 */
    @Test
    void templateTypeEnumExposesStableCodes() {
        assertThat(SmsTemplateTypeEnum.VERIFICATION_CODE.getType()).isEqualTo(1);
        assertThat(SmsTemplateTypeEnum.NOTICE.getType()).isEqualTo(2);
        assertThat(SmsTemplateTypeEnum.PROMOTION.getType()).isEqualTo(3);
        assertThat(SmsTemplateTypeEnum.values()).as("新增类型必须显式登记，避免模板落到未知分类")
                .containsExactly(SmsTemplateTypeEnum.VERIFICATION_CODE, SmsTemplateTypeEnum.NOTICE,
                        SmsTemplateTypeEnum.PROMOTION);
    }

    /** 发送一条短信并返回日志编号，同时保留生产生产者真实派发出的事件。 */
    private Long sendAndCaptureMessage() {
        return smsSendService.sendSingleSms(MOBILE, 7L, UserTypeEnum.ADMIN.getValue(),
                LOGIN_TEMPLATE, Map.of("code", "1234"));
    }

    /** 发送一条短信并让供应商返回流水号，使日志具备被回执匹配的条件。 */
    private Long sendAndMarkDelivered() {
        Long logId = sendAndCaptureMessage();
        ScriptedSmsClient client = clientFactory.scriptedClient(ALIYUN_CHANNEL_ID);
        client.sendResponse = sendResponse(true, "OK", "短信发送成功", "serial-1", "request-1");
        smsSendService.doSendSms(recorder.messages.get(0));
        return logId;
    }

    /** 读取真实落库的短信日志，避免用内存对象断言掩盖持久化问题。 */
    private SmsLogDO readLog(Long id) {
        return context.getBean(SmsLogMapper.class).selectById(id);
    }

    /** 构造渠道请求；调用方按需设置编号表示修改。 */
    private SmsChannelSaveReqVO channelRequest(String code) {
        SmsChannelSaveReqVO request = new SmsChannelSaveReqVO();
        request.setSignature("测试签名");
        request.setCode(code);
        request.setStatus(CommonStatusEnum.ENABLE.getStatus());
        request.setApiKey("test-api-key");
        request.setApiSecret("test-api-secret");
        return request;
    }

    /** 构造模板请求；渠道为空时使用阿里云渠道，参数与渠道编码由生产代码自行派生。 */
    private SmsTemplateSaveReqVO templateRequest(String code, String content, Long channelId) {
        SmsTemplateSaveReqVO request = new SmsTemplateSaveReqVO();
        request.setType(1);
        request.setStatus(CommonStatusEnum.ENABLE.getStatus());
        request.setCode(code);
        request.setName("模板-" + code);
        request.setContent(content);
        request.setApiTemplateId("SMS_001");
        request.setChannelId(channelId != null ? channelId : ALIYUN_CHANNEL_ID);
        return request;
    }

    /** 构造带指定手机号的管理员档案，密码为随机值且不参与断言。 */
    private AdminUserDO adminUser(String mobile) {
        AdminUserDO user = new AdminUserDO();
        user.setId(7L);
        user.setUsername("account_7");
        user.setPassword(UUID.randomUUID().toString());
        user.setMobile(mobile);
        return user;
    }

    /** 构造指定审核状态的供应商模板响应；状态为空用于覆盖无法识别的分支。 */
    private static SmsTemplateRespDTO templateWithAudit(SmsTemplateAuditStatusEnum auditStatus) {
        SmsTemplateRespDTO response = new SmsTemplateRespDTO();
        response.setId("SMS_001");
        response.setContent("验证码 {code}");
        response.setAuditStatus(auditStatus != null ? auditStatus.getStatus() : null);
        return response;
    }

    /** 构造审核通过、供默认路径使用的供应商模板响应。 */
    private static SmsTemplateRespDTO approvedTemplate() {
        return templateWithAudit(SmsTemplateAuditStatusEnum.SUCCESS);
    }

    /** 构造供应商发送响应。 */
    private static SmsSendRespDTO sendResponse(boolean success, String apiCode, String apiMsg,
                                                 String serialNo, String requestId) {
        SmsSendRespDTO response = new SmsSendRespDTO();
        response.setSuccess(success);
        response.setApiCode(apiCode);
        response.setApiMsg(apiMsg);
        response.setSerialNo(serialNo);
        response.setApiRequestId(requestId);
        return response;
    }

    /** 构造供应商回执响应。 */
    private static SmsReceiveRespDTO receiveResult(boolean success, String serialNo, String mobile) {
        SmsReceiveRespDTO response = new SmsReceiveRespDTO();
        response.setSuccess(success);
        response.setSerialNo(serialNo);
        response.setMobile(mobile);
        response.setReceiveTime(LocalDateTime.now());
        return response;
    }

    /** 按编码取出模板编号，测试不使用除种子渠道外的写死主键。 */
    private Long templateIdOf(String code) {
        return jdbc.queryForObject("SELECT id FROM system_sms_template WHERE code=?", Long.class, code);
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

    /** 对本测试固定表名计数，检查真实持久化副作用。 */
    private int count(String table) {
        assertThat(TABLES).contains(table);
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE deleted=0", Integer.class);
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

    /** 为每个生产 Mapper 建立真实代理，不扫描无关业务依赖。 */
    private <T> void registerMapper(Class<T> type) {
        context.registerBean(type, () -> {
            try {
                MapperFactoryBean<T> mapper = new MapperFactoryBean<>(type);
                mapper.setSqlSessionFactory(context.getBean(SqlSessionFactory.class));
                mapper.afterPropertiesSet();
                return mapper.getObject();
            } catch (Exception exception) {
                throw new IllegalStateException("测试 Mapper 创建失败", exception);
            }
        });
    }

    /** 显式注入本测试所需依赖，由 Spring 为生产方法建立实际缓存与事务代理。 */
    private static <T> T wire(T target, String field, Object value) {
        ReflectionTestUtils.setField(target, field, value);
        return target;
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

    /** 每例结束后复位共享替身，避免失败用例污染下一例的断言。 */
    @AfterEach
    void clearStubs() {
        clientFactory.reset();
        recorder.reset();
    }

    /** 只删除本测试创建的随机 schema，并关闭所属 Spring 上下文。 */
    @AfterAll
    void closeDatabase() throws Exception {
        if (context != null) {
            context.close();
            ReflectionTestUtils.setField(SpringUtil.class, "beanFactory", previousSpringBeanFactory);
            ReflectionTestUtils.setField(SpringUtil.class, "applicationContext", previousSpringContext);
        }
        if (schemaCreated) {
            try (Connection connection = DriverManager.getConnection(adminUrl, databaseUser, databasePassword);
                 Statement statement = connection.createStatement()) {
                statement.execute("DROP DATABASE `" + schema + "`");
            }
        }
    }

    /** 开启生产服务的事务边界与缓存代理，异常必须回滚真实 MySQL。 */
    @Configuration(proxyBeanMethods = false)
    @EnableTransactionManagement(proxyTargetClass = true)
    @EnableCaching(proxyTargetClass = true)
    @EnableAspectJAutoProxy(proxyTargetClass = true)
    static class SmsTestConfiguration {
    }

    /**
     * 可编程的短信客户端替身。
     *
     * <p>真实客户端会向阿里云、腾讯云发起带签名的网络请求，测试环境不能也不应发起；
     * 替身保留生产工厂的调用契约，只把供应商响应变成可断言的输入。</p>
     */
    static class ScriptedSmsClient implements SmsClient {

        /** 渠道编号，与生产客户端语义一致。 */
        private final Long id;
        /** 供应商模板查询响应，默认审核通过。 */
        private SmsTemplateRespDTO templateResponse = approvedTemplate();
        /** 供应商模板查询抛出的异常，用于覆盖 API 调用失败分支。 */
        private RuntimeException templateFailure;
        /** 发送响应。 */
        private SmsSendRespDTO sendResponse = sendResponse(true, "OK", "短信发送成功", "serial-0", "request-0");
        /** 发送时抛出的异常，用于覆盖消费者异常分支。 */
        private RuntimeException sendFailure;
        /** 供应商回执解析结果。 */
        private List<SmsReceiveRespDTO> receiveResults = List.of();
        /** 记录实际发送时使用的手机号。 */
        private String sentMobile;
        /** 记录实际收到的模板编号。 */
        private String sentApiTemplateId;
        /** 记录实际发送的模板参数。 */
        private List<KeyValue<String, Object>> sentParams;
        /** 记录实际收到的回执原文。 */
        private String parsedText;

        /** 构造替身并绑定渠道编号。 */
        ScriptedSmsClient(Long id) {
            this.id = id;
        }

        /** 返回渠道编号。 */
        @Override
        public Long getId() {
            return id;
        }

        /** 记录发送入参并返回预设响应，异常分支优先于响应。 */
        @Override
        public SmsSendRespDTO sendSms(Long logId, String mobile, String apiTemplateId,
                                       List<KeyValue<String, Object>> templateParams) {
            sentMobile = mobile;
            sentApiTemplateId = apiTemplateId;
            sentParams = templateParams;
            if (sendFailure != null) {
                throw sendFailure;
            }
            return sendResponse;
        }

        /** 记录回执原文并返回预设解析结果。 */
        @Override
        public List<SmsReceiveRespDTO> parseSmsReceiveStatus(String text) {
            parsedText = text;
            return receiveResults;
        }

        /** 返回预设模板响应，异常分支优先于响应。 */
        @Override
        public SmsTemplateRespDTO getSmsTemplate(String apiTemplateId) {
            if (templateFailure != null) {
                throw templateFailure;
            }
            return templateResponse;
        }
    }

    /**
     * 记录渠道到客户端映射关系的工厂替身。
     *
     * <p>按编号注册的客户端供发送与回执使用，按编码注册的客户端供解析回执使用，
     * 与生产工厂的两张注册表语义一致；同一个渠道编号始终复用同一实例，
     * 否则用例中预设的供应商响应会在实际发送时被新实例顶掉。</p>
     */
    static class RecordingSmsClientFactory implements SmsClientFactory {

        /** 按渠道编号注册的客户端。 */
        private final Map<Long, ScriptedSmsClient> clientsById = new LinkedHashMap<>();
        /** 按渠道编码注册的客户端。 */
        private final Map<String, ScriptedSmsClient> clientsByCode = new LinkedHashMap<>();
        /** 被显式标记为“没有客户端”的渠道编号。 */
        private final Set<Long> channelsWithoutClient = new LinkedHashSet<>();
        /** 每次创建或刷新客户端收到的配置，用于校验渠道凭据映射。 */
        private final List<SmsChannelProperties> received = new ArrayList<>();

        /** 按渠道编号复用或创建客户端，语义与生产工厂一致。 */
        @Override
        public SmsClient createOrUpdateSmsClient(SmsChannelProperties properties) {
            received.add(properties);
            if (channelsWithoutClient.contains(properties.getId())) {
                return null;
            }
            return clientsById.computeIfAbsent(properties.getId(), id -> new ScriptedSmsClient(id));
        }

        /** 按渠道编号取客户端。 */
        @Override
        public SmsClient getSmsClient(Long channelId) {
            return clientsById.get(channelId);
        }

        /** 按渠道编码取客户端。 */
        @Override
        public SmsClient getSmsClient(String channelCode) {
            return clientsByCode.get(channelCode);
        }

        /** 取出指定渠道编号的脚本化客户端，未注册时先注册一个审核通过的默认实现。 */
        ScriptedSmsClient scriptedClient(Long channelId) {
            return clientsById.computeIfAbsent(channelId, id -> new ScriptedSmsClient(id));
        }

        /**
         * 取出按渠道编码注册的客户端。
         *
         * <p>生产工厂只在构造期为每个编码放入一个无凭据的占位客户端，
         * 解析回执不依赖渠道凭据，因此回执用例必须操作编码表里的那一个。</p>
         */
        ScriptedSmsClient receiptClient() {
            return clientsByCode.computeIfAbsent(ALIYUN, code -> new ScriptedSmsClient(ALIYUN_CHANNEL_ID));
        }

        /** 标记某渠道没有可用客户端，用于覆盖客户端缺失分支。 */
        void markChannelWithoutClient(Long channelId) {
            clientsById.remove(channelId);
            channelsWithoutClient.add(channelId);
        }

        /** 按渠道编码登记客户端。 */
        void registerByCode(String channelCode, ScriptedSmsClient client) {
            clientsByCode.put(channelCode, client);
        }

        /** 返回最后一次创建或刷新客户端收到的配置。 */
        SmsChannelProperties lastCreated() {
            assertThat(received).isNotEmpty();
            return received.get(received.size() - 1);
        }

        /** 清空全部注册表，模拟服务重启后重新装配。 */
        void reset() {
            clientsById.clear();
            clientsByCode.clear();
            channelsWithoutClient.clear();
            received.clear();
        }
    }

    /** 收集生产生产者真实派发的短信发送事件，验证异步入口确实被触发。 */
    static class SmsSendMessageRecorder {

        /** 按派发顺序记录事件。 */
        private final List<SmsSendMessage> messages = new ArrayList<>();

        /** 接收生产生产者发布的事件。 */
        @EventListener
        public void onSmsSendMessage(SmsSendMessage message) {
            messages.add(message);
        }

        /** 清空已记录事件。 */
        void reset() {
            messages.clear();
        }
    }
}
