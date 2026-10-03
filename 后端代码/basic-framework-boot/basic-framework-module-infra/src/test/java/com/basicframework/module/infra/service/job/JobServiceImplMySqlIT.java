package com.basicframework.module.infra.service.job;

import cn.hutool.extra.spring.SpringUtil;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.config.GlobalConfig;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.baomidou.mybatisplus.spring.MybatisSqlSessionFactoryBean;
import com.basicframework.framework.common.exception.ErrorCode;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.handler.DefaultDBFieldHandler;
import com.basicframework.framework.quartz.core.handler.JobHandler;
import com.basicframework.framework.quartz.core.scheduler.SchedulerManager;
import com.basicframework.module.infra.controller.admin.job.vo.job.JobPageReqVO;
import com.basicframework.module.infra.controller.admin.job.vo.job.JobSaveReqVO;
import com.basicframework.module.infra.dal.dataobject.job.JobDO;
import com.basicframework.module.infra.dal.mysql.job.JobMapper;
import com.basicframework.module.infra.enums.job.JobStatusEnum;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.mybatis.spring.mapper.MapperFactoryBean;
import org.quartz.CronTrigger;
import org.quartz.Job;
import org.quartz.JobKey;
import org.quartz.Scheduler;
import org.quartz.SchedulerException;
import org.quartz.Trigger;
import org.quartz.Trigger.TriggerState;
import org.quartz.TriggerKey;
import org.quartz.impl.StdSchedulerFactory;
import org.quartz.impl.matchers.GroupMatcher;
import org.quartz.spi.JobFactory;
import org.quartz.spi.TriggerFiredBundle;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.AnnotationConfigUtils;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.EnableTransactionManagement;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Properties;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.regex.Pattern;

import static com.basicframework.module.infra.enums.ErrorCodeConstants.JOB_CHANGE_STATUS_EQUALS;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.JOB_CHANGE_STATUS_INVALID;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.JOB_CRON_EXPRESSION_VALID;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.JOB_HANDLER_BEAN_NOT_EXISTS;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.JOB_HANDLER_BEAN_TYPE_ERROR;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.JOB_HANDLER_EXISTS;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.JOB_NOT_EXISTS;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.JOB_UPDATE_ONLY_NORMAL_STATUS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 用独立 MySQL 库、生产 Mapper、生产 DDL 与真实内存 Quartz 调度器验证定时任务与调度器的同步契约。
 *
 * <p>定时任务的真正风险不是字段赋值，而是“数据库状态”和“Quartz 调度状态”分叉：数据库显示开启而
 * 调度器里没有任务，任务就永远不会执行；数据库显示暂停而触发器仍在运行，被暂停的任务就会继续跑。
 * 因此本测试用真实 Quartz 的 {@code RAMJobStore} 观察任务与触发器状态，而不是只断言方法被调用。</p>
 *
 * <p>Quartz 的执行体被替换为空实现：本模块只负责“任务配置与调度器保持一致”这一契约，
 * 真正调用 {@code JobHandler} 的链路属于 job starter，已由其自身测试覆盖；执行体会去 Spring 容器里
 * 找处理器，在没有 Spring 注入的调度工厂中失败只会产生与断言无关的噪声。</p>
 *
 * <p>显式执行此集成入口必须提供环回测试环境，缺失环境直接失败，不连接业务库或已有调度器。</p>
 *
 * @author shady2713
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class JobServiceImplMySqlIT {

    /** 本测试使用的生产建表语句。 */
    private static final String JOB_TABLE = "infra_job";
    /** 合法且足够远的 Cron：让触发器稳定停在等待状态，避免执行时序污染状态断言。 */
    private static final String FAR_FUTURE_CRON = "0 0 3 1 1 ? 2099";
    /** 第二个远期 Cron，用于验证更新确实替换了触发器而不是留下旧配置。 */
    private static final String OTHER_FAR_FUTURE_CRON = "0 0 4 1 1 ? 2099";
    /** 明显不是 Quartz 表达式的输入。 */
    private static final String BROKEN_CRON = "not-a-cron";
    /** 测试中注册为合法处理器的 Bean 名称。 */
    private static final String VALID_HANDLER = "testJobHandler";
    /** 测试中注册为普通对象的 Bean 名称，用于验证类型校验。 */
    private static final String WRONG_TYPE_HANDLER = "notAJobHandlerBean";
    /** 批量删除与同步用例各自使用的处理器名，保证同一调度器上的任务可区分。 */
    private static final List<String> EXTRA_HANDLERS =
            List.of("batchHandlerOne", "batchHandlerTwo", "syncRunningHandler", "syncStoppedHandler");

    private final String schema = "bf_job_" + UUID.randomUUID().toString().replace("-", "");
    private final String quartzInstance = "bf-infra-job-it-" + UUID.randomUUID();
    private AnnotationConfigApplicationContext context;
    private JdbcTemplate jdbc;
    private JobMapper jobMapper;
    private JobService jobService;
    private RecordingSchedulerManager schedulerManager;
    private Scheduler scheduler;
    private String adminUrl;
    private String databaseUser;
    private String databasePassword;
    private boolean schemaCreated;
    private Object previousSpringBeanFactory;
    private Object previousSpringContext;

    /** 建立随机数据库、真实调度器和生产服务实例；只导入本测试用到的生产表。 */
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
        String ddl = Files.readString(repositoryRoot().resolve("数据库文件/basic_framework.sql"));
        var matcher = Pattern.compile("CREATE TABLE `" + JOB_TABLE + "`[\\s\\S]*?;").matcher(ddl);
        assertThat(matcher.find()).as("生产表 %s 必须存在", JOB_TABLE).isTrue();
        jdbc.execute(matcher.group());

        scheduler = new StdSchedulerFactory(quartzProperties()).getScheduler();
        schedulerManager = new RecordingSchedulerManager(scheduler);

        context = new AnnotationConfigApplicationContext();
        previousSpringBeanFactory = ReflectionTestUtils.getField(SpringUtil.class, "beanFactory");
        previousSpringContext = ReflectionTestUtils.getField(SpringUtil.class, "applicationContext");
        context.registerBean(SpringUtil.class);
        context.register(JobTestConfiguration.class);
        // 生产 Service 用 @Resource 按名注入，测试改为显式装配，必须移除按名处理器避免误报缺 Bean
        context.removeBeanDefinition(AnnotationConfigUtils.COMMON_ANNOTATION_PROCESSOR_BEAN_NAME);
        context.registerBean(DataSourceTransactionManager.class, () -> new DataSourceTransactionManager(dataSource));
        context.registerBean(DataSource.class, () -> dataSource);
        context.registerBean(SqlSessionFactory.class, () -> sqlSessionFactory(dataSource));
        context.registerBean(JobMapper.class, () -> {
            try {
                MapperFactoryBean<JobMapper> factory = new MapperFactoryBean<>(JobMapper.class);
                factory.setSqlSessionFactory(context.getBean(SqlSessionFactory.class));
                factory.afterPropertiesSet();
                return factory.getObject();
            } catch (Exception failure) {
                throw new IllegalStateException("定时任务测试 Mapper 创建失败", failure);
            }
        });
        context.registerBean(VALID_HANDLER, RecordingJobHandler.class, RecordingJobHandler::new);
        context.registerBean(WRONG_TYPE_HANDLER, Object.class, Object::new);
        // 批量删除与同步用例需要各自的处理器名，才能在同一调度器上区分任务
        for (String handler : EXTRA_HANDLERS) {
            context.registerBean(handler, RecordingJobHandler.class, RecordingJobHandler::new);
        }
        // 显式声明供应者类型：否则块式 lambda 无法在 registerBean 的重载之间确定返回值
        context.registerBean(JobService.class, (Supplier<JobService>) () -> {
            JobServiceImpl service = new JobServiceImpl();
            ReflectionTestUtils.setField(service, "jobMapper", context.getBean(JobMapper.class));
            ReflectionTestUtils.setField(service, "schedulerManager", schedulerManager);
            return service;
        });
        context.refresh();
        jobMapper = context.getBean(JobMapper.class);
        jobService = context.getBean(JobService.class);
    }

    /** 每例清空数据库与调度器；调度调用记录跨用例累积，断言前必须重置。 */
    @BeforeEach
    void resetFixtures() throws Exception {
        jdbc.update("DELETE FROM " + JOB_TABLE);
        // 先复制键集合再删除，避免遍历存储视图期间修改调度器状态
        for (JobKey key : new ArrayList<>(scheduler.getJobKeys(GroupMatcher.anyJobGroup()))) {
            scheduler.deleteJob(key);
        }
        scheduler.resumeAll();
        schedulerManager.calls.clear();
    }

    /** Cron 非法时必须在写库和调度之前失败，否则会留下永远不会被触发的任务记录。 */
    @Test
    void createJobRejectsBrokenCronBeforeAnyWrite() {
        assertBusinessError(() -> jobService.createJob(request("broken", BROKEN_CRON)), JOB_CRON_EXPRESSION_VALID);

        assertThat(countJobs()).isZero();
        assertThat(schedulerManager.calls).isEmpty();
    }

    /** 同一处理器名只允许存在一条任务；重复创建时不得覆盖原任务或新增调度。 */
    @Test
    void createJobRejectsDuplicateHandlerName() throws Exception {
        Long first = jobService.createJob(request("first", FAR_FUTURE_CRON));
        assertBusinessError(() -> jobService.createJob(request("second", FAR_FUTURE_CRON)), JOB_HANDLER_EXISTS);

        assertThat(countJobs()).isEqualTo(1);
        assertThat(jobMapper.selectByHandlerName(VALID_HANDLER).getId()).isEqualTo(first);
        // 第一条任务仍按最初请求保留自己的名称
        assertThat(jobMapper.selectById(first).getName()).isEqualTo("first");
        assertThat(schedulerManager.calls).containsExactly("addJob:" + VALID_HANDLER);
    }

    /** 处理器 Bean 缺失或不是 JobHandler 都必须拒绝，避免调度后在运行期才失败。 */
    @Test
    void createJobRejectsMissingOrWrongTypeHandlerBean() {
        JobSaveReqVO missing = request("missing", FAR_FUTURE_CRON);
        missing.setHandlerName("noSuchHandlerBean");
        assertBusinessError(() -> jobService.createJob(missing), JOB_HANDLER_BEAN_NOT_EXISTS);

        JobSaveReqVO wrongType = request("wrongType", FAR_FUTURE_CRON);
        wrongType.setHandlerName(WRONG_TYPE_HANDLER);
        assertBusinessError(() -> jobService.createJob(wrongType), JOB_HANDLER_BEAN_TYPE_ERROR);

        assertThat(countJobs()).isZero();
        assertThat(schedulerManager.calls).isEmpty();
    }

    /**
     * 调度器成功接管后任务才允许进入开启状态；监控超时空值补 0 表示不监控。
     *
     * <p>状态 INIT 只在 Quartz 写入失败的瞬间存在，因此成功路径必须断言最终为 NORMAL，
     * 且数据库状态与真实触发器状态一致。</p>
     */
    @Test
    void createJobSchedulesAndEndsInNormalState() throws Exception {
        JobSaveReqVO request = request("正常任务", FAR_FUTURE_CRON);
        request.setHandlerParam("param-1");
        request.setRetryCount(3);
        request.setRetryInterval(1500);

        Long id = jobService.createJob(request);

        JobDO job = jobMapper.selectById(id);
        assertThat(job.getStatus()).isEqualTo(JobStatusEnum.NORMAL.getStatus());
        assertThat(job.getMonitorTimeout()).as("未配置监控超时表示不监控").isZero();
        assertThat(job.getCronExpression()).isEqualTo(FAR_FUTURE_CRON);
        assertThat(scheduler.checkExists(new JobKey(VALID_HANDLER))).isTrue();
        assertThat(scheduler.getTriggerState(new TriggerKey(VALID_HANDLER)))
                .isEqualTo(TriggerState.NORMAL);
        assertThat(cronExpressionOf(VALID_HANDLER)).isEqualTo(FAR_FUTURE_CRON);
        assertThat(schedulerManager.calls).containsExactly("addJob:" + VALID_HANDLER);
    }

    /** 显式配置的监控超时必须原样保留，不能被默认值覆盖成 0。 */
    @Test
    void createJobKeepsExplicitMonitorTimeout() throws Exception {
        JobSaveReqVO request = request("带监控任务", FAR_FUTURE_CRON);
        request.setMonitorTimeout(30_000);

        Long id = jobService.createJob(request);

        assertThat(jobMapper.selectById(id).getMonitorTimeout()).isEqualTo(30_000);
    }

    /**
     * 调度器拒绝任务时数据库必须整体回滚。
     *
     * <p>数据库已提交而调度器没有任务时，管理端会显示一个永不执行的任务；
     * 反向分叉同样无法自愈，所以这一条必须由真实事务回滚保证。</p>
     */
    @Test
    void createJobRollsBackRowWhenSchedulerRejectsTask() {
        schedulerManager.addJobFailure = new SchedulerException("受控调度失败");

        assertThatThrownBy(() -> jobService.createJob(request("回滚任务", FAR_FUTURE_CRON)))
                .isInstanceOf(SchedulerException.class);

        assertThat(countJobs()).as("调度失败时不得留下任务记录").isZero();
    }

    /** 暂停中的任务不得被修改，否则更新会顺带把已暂停的触发器重新启用。 */
    @Test
    void updateJobRejectsStoppedTaskSoPauseSurvives() throws Exception {
        Long id = jobService.createJob(request("暂停任务", FAR_FUTURE_CRON));
        jobService.updateJobStatus(id, JobStatusEnum.STOP.getStatus());
        assertThat(scheduler.getTriggerState(new TriggerKey(VALID_HANDLER)))
                .isEqualTo(TriggerState.PAUSED);

        JobSaveReqVO update = request("暂停任务", OTHER_FAR_FUTURE_CRON);
        update.setId(id);
        assertBusinessError(() -> jobService.updateJob(update), JOB_UPDATE_ONLY_NORMAL_STATUS);

        assertThat(cronExpressionOf(VALID_HANDLER)).as("被拒绝的更新不得改动触发器")
                .isEqualTo(FAR_FUTURE_CRON);
        assertThat(scheduler.getTriggerState(new TriggerKey(VALID_HANDLER)))
                .isEqualTo(TriggerState.PAUSED);
    }

    /** 开启中的任务更新后，数据库字段与真实触发器表达式必须同时变化。 */
    @Test
    void updateJobReschedulesEnabledTaskInScheduler() throws Exception {
        Long id = jobService.createJob(request("更新任务", FAR_FUTURE_CRON));

        JobSaveReqVO update = request("更新后的名称", OTHER_FAR_FUTURE_CRON);
        update.setId(id);
        update.setHandlerParam("param-2");
        update.setRetryCount(5);
        update.setRetryInterval(0);
        update.setMonitorTimeout(1_000);
        jobService.updateJob(update);

        JobDO job = jobMapper.selectById(id);
        assertThat(job.getName()).isEqualTo("更新后的名称");
        assertThat(job.getHandlerParam()).isEqualTo("param-2");
        assertThat(job.getRetryCount()).isEqualTo(5);
        assertThat(job.getMonitorTimeout()).isEqualTo(1_000);
        assertThat(cronExpressionOf(VALID_HANDLER)).isEqualTo(OTHER_FAR_FUTURE_CRON);
        assertThat(schedulerManager.calls)
                .containsExactly("addJob:" + VALID_HANDLER, "updateJob:" + VALID_HANDLER);
    }

    /** 更新时未提供监控超时同样补 0，保持与创建一致的口径。 */
    @Test
    void updateJobDefaultsAbsentMonitorTimeout() throws Exception {
        Long id = jobService.createJob(request("默认值任务", FAR_FUTURE_CRON));
        jdbc.update("UPDATE " + JOB_TABLE + " SET monitor_timeout = 5000 WHERE id = ?", id);

        JobSaveReqVO update = request("默认值任务", OTHER_FAR_FUTURE_CRON);
        update.setId(id);
        jobService.updateJob(update);

        assertThat(jobMapper.selectById(id).getMonitorTimeout()).isZero();
    }

    /** 状态只允许在开启与暂停之间切换，且不允许提交与当前相同的状态。 */
    @Test
    void statusChangeRejectsInvalidAndUnchangedTargets() throws Exception {
        Long id = jobService.createJob(request("状态任务", FAR_FUTURE_CRON));

        assertBusinessError(() -> jobService.updateJobStatus(id, 3), JOB_CHANGE_STATUS_INVALID);
        assertBusinessError(() -> jobService.updateJobStatus(id, JobStatusEnum.INIT.getStatus()),
                JOB_CHANGE_STATUS_INVALID);
        assertBusinessError(() -> jobService.updateJobStatus(id, JobStatusEnum.NORMAL.getStatus()),
                JOB_CHANGE_STATUS_EQUALS);

        assertThat(jobMapper.selectById(id).getStatus()).isEqualTo(JobStatusEnum.NORMAL.getStatus());
        assertThat(scheduler.getTriggerState(new TriggerKey(VALID_HANDLER)))
                .isEqualTo(TriggerState.NORMAL);
    }

    /** 状态流转必须同时落到数据库和真实触发器：暂停真的停，恢复真的恢复。 */
    @Test
    void statusTransitionDrivesBothDatabaseAndQuartz() throws Exception {
        Long id = jobService.createJob(request("流转任务", FAR_FUTURE_CRON));

        jobService.updateJobStatus(id, JobStatusEnum.STOP.getStatus());
        assertThat(jobMapper.selectById(id).getStatus()).isEqualTo(JobStatusEnum.STOP.getStatus());
        assertThat(scheduler.getTriggerState(new TriggerKey(VALID_HANDLER)))
                .isEqualTo(TriggerState.PAUSED);

        jobService.updateJobStatus(id, JobStatusEnum.NORMAL.getStatus());
        assertThat(jobMapper.selectById(id).getStatus()).isEqualTo(JobStatusEnum.NORMAL.getStatus());
        assertThat(scheduler.getTriggerState(new TriggerKey(VALID_HANDLER)))
                .isEqualTo(TriggerState.NORMAL);
        assertThat(schedulerManager.calls).containsExactly(
                "addJob:" + VALID_HANDLER, "pauseJob:" + VALID_HANDLER, "resumeJob:" + VALID_HANDLER);
    }

    /** 手动触发必须使用数据库里的任务编号、处理器名和参数，且不改变既有调度。 */
    @Test
    void triggerJobUsesPersistedTaskData() throws Exception {
        JobSaveReqVO request = request("触发任务", FAR_FUTURE_CRON);
        request.setHandlerParam("manual-param");
        Long id = jobService.createJob(request);
        schedulerManager.calls.clear();

        jobService.triggerJob(id);

        assertThat(schedulerManager.calls).containsExactly("triggerJob:" + id + ":" + VALID_HANDLER
                + ":manual-param");
        assertThat(scheduler.checkExists(new JobKey(VALID_HANDLER))).isTrue();
        assertThat(cronExpressionOf(VALID_HANDLER)).isEqualTo(FAR_FUTURE_CRON);
    }

    /** 所有依赖任务存在性的操作对缺失任务给出同一个业务错误。 */
    @Test
    void missingTaskIsRejectedByEveryOperation() {
        Long missing = 999_999L;

        assertBusinessError(() -> jobService.updateJob(request("缺失", FAR_FUTURE_CRON)), JOB_NOT_EXISTS);
        assertBusinessError(() -> jobService.updateJobStatus(missing, JobStatusEnum.STOP.getStatus()),
                JOB_NOT_EXISTS);
        assertBusinessError(() -> jobService.triggerJob(missing), JOB_NOT_EXISTS);
        assertBusinessError(() -> jobService.deleteJob(missing), JOB_NOT_EXISTS);
        assertThat(jobService.getJob(missing)).isNull();
    }

    /** 删除任务必须同时删除数据库记录和调度器任务，避免调度器里残留孤儿任务。 */
    @Test
    void deleteJobRemovesRowAndSchedulerTask() throws Exception {
        Long id = jobService.createJob(request("删除任务", FAR_FUTURE_CRON));

        jobService.deleteJob(id);

        assertThat(jobService.getJob(id)).isNull();
        assertThat(scheduler.checkExists(new JobKey(VALID_HANDLER))).isFalse();
        assertThat(scheduler.getTriggerState(new TriggerKey(VALID_HANDLER)))
                .isEqualTo(TriggerState.NONE);
    }

    /**
     * 批量删除必须逐条清理调度器。
     *
     * <p>只删数据库不删调度器时，Quartz 会继续按旧触发器执行一个已不存在的任务；
     * 该路径没有逐条回滚，任一条失败都必须由调用方重试，所以这里断言调度记录顺序完整。</p>
     */
    @Test
    void deleteJobListRemovesEverySchedulerTask() throws Exception {
        JobSaveReqVO first = request("批量一", FAR_FUTURE_CRON);
        first.setHandlerName("batchHandlerOne");
        Long firstId = jobService.createJob(first);
        JobSaveReqVO second = request("批量二", OTHER_FAR_FUTURE_CRON);
        second.setHandlerName("batchHandlerTwo");
        Long secondId = jobService.createJob(second);
        schedulerManager.calls.clear();

        jobService.deleteJobList(List.of(firstId, secondId));

        assertThat(jobService.getJob(firstId)).isNull();
        assertThat(jobService.getJob(secondId)).isNull();
        assertThat(scheduler.checkExists(new JobKey("batchHandlerOne"))).isFalse();
        assertThat(scheduler.checkExists(new JobKey("batchHandlerTwo"))).isFalse();
        assertThat(schedulerManager.calls).containsExactly(
                "deleteJob:batchHandlerOne", "deleteJob:batchHandlerTwo");
    }

    /**
     * 同步必须以数据库为准重建调度器，并恢复暂停状态。
     *
     * <p>重启后调度器内存为空，若不同步，数据库里暂停的任务会全部开始执行；
     * 若同步时不恢复暂停状态，已暂停的任务会被误启用。</p>
     */
    @Test
    void syncJobRebuildsSchedulerAndRestoresPausedState() throws Exception {
        JobSaveReqVO running = request("同步-开启", FAR_FUTURE_CRON);
        running.setHandlerName("syncRunningHandler");
        Long runningId = jobService.createJob(running);
        JobSaveReqVO stopped = request("同步-暂停", OTHER_FAR_FUTURE_CRON);
        stopped.setHandlerName("syncStoppedHandler");
        Long stoppedId = jobService.createJob(stopped);
        jobService.updateJobStatus(stoppedId, JobStatusEnum.STOP.getStatus());
        // 模拟进程重启：调度器丢失全部任务，数据库仍是唯一事实来源
        for (String name : List.of("syncRunningHandler", "syncStoppedHandler")) {
            scheduler.deleteJob(new JobKey(name));
        }
        schedulerManager.calls.clear();

        jobService.syncJob();

        assertThat(schedulerManager.calls).containsExactly(
                "deleteJob:syncRunningHandler", "addJob:syncRunningHandler",
                "deleteJob:syncStoppedHandler", "addJob:syncStoppedHandler", "pauseJob:syncStoppedHandler");
        assertThat(scheduler.getTriggerState(new TriggerKey("syncRunningHandler")))
                .isEqualTo(TriggerState.NORMAL);
        assertThat(scheduler.getTriggerState(new TriggerKey("syncStoppedHandler")))
                .isEqualTo(TriggerState.PAUSED);
        assertThat(cronExpressionOf("syncRunningHandler")).isEqualTo(FAR_FUTURE_CRON);
        assertThat(cronExpressionOf("syncStoppedHandler")).isEqualTo(OTHER_FAR_FUTURE_CRON);
        assertThat(jobMapper.selectById(runningId).getStatus()).isEqualTo(JobStatusEnum.NORMAL.getStatus());
    }

    /** 空库同步是幂等的无操作，不得凭空创建调度任务。 */
    @Test
    void syncJobOnEmptyTableDoesNothing() throws Exception {
        jobService.syncJob();

        assertThat(schedulerManager.calls).isEmpty();
        assertThat(scheduler.getJobKeys(GroupMatcher.anyJobGroup())).isEmpty();
    }

    /**
     * 分页按名称、处理器名和状态过滤，并按编号倒序。
     *
     * <p>过滤条件缺失时不能退化成全表：管理端依赖该查询定位单个任务，
     * 漏过滤会把已暂停的任务混进可见结果。</p>
     */
    @Test
    void jobPageFiltersByStatusNameAndHandler() {
        seedJob("开启任务", VALID_HANDLER, JobStatusEnum.NORMAL.getStatus(), FAR_FUTURE_CRON);
        seedJob("暂停任务", VALID_HANDLER, JobStatusEnum.STOP.getStatus(), FAR_FUTURE_CRON);
        seedJob("其他任务", "otherHandler", JobStatusEnum.NORMAL.getStatus(), OTHER_FAR_FUTURE_CRON);

        JobPageReqVO statusQuery = new JobPageReqVO();
        statusQuery.setStatus(JobStatusEnum.STOP.getStatus());
        PageResult<JobDO> stopped = jobService.getJobPage(statusQuery);
        assertThat(stopped.getTotal()).isEqualTo(1);
        assertThat(stopped.getList().get(0).getName()).isEqualTo("暂停任务");

        JobPageReqVO nameQuery = new JobPageReqVO();
        nameQuery.setName("任务");
        PageResult<JobDO> all = jobService.getJobPage(nameQuery);
        assertThat(all.getTotal()).isEqualTo(3);
        assertThat(all.getList()).extracting(JobDO::getId)
                .isSortedAccordingTo(Comparator.reverseOrder());

        JobPageReqVO handlerQuery = new JobPageReqVO();
        handlerQuery.setHandlerName(VALID_HANDLER);
        assertThat(jobService.getJobPage(handlerQuery).getTotal()).isEqualTo(2);

        JobPageReqVO paged = new JobPageReqVO();
        paged.setPageNo(1);
        paged.setPageSize(2);
        PageResult<JobDO> firstPage = jobService.getJobPage(paged);
        assertThat(firstPage.getList()).hasSize(2);
        assertThat(firstPage.getTotal()).isEqualTo(3);
    }

    /** 关闭上下文和调度器，并还原全局 Spring 工具状态；异常时也继续回收随机数据库。 */
    @AfterAll
    void closeEnvironment() throws Exception {
        try {
            if (context != null) {
                context.close();
                ReflectionTestUtils.setField(SpringUtil.class, "beanFactory", previousSpringBeanFactory);
                ReflectionTestUtils.setField(SpringUtil.class, "applicationContext", previousSpringContext);
            }
            if (scheduler != null) scheduler.shutdown(true);
        } finally {
            if (schemaCreated) {
                try (Connection connection = DriverManager.getConnection(adminUrl, databaseUser, databasePassword);
                     Statement statement = connection.createStatement()) {
                    statement.execute("DROP DATABASE `" + schema + "`");
                }
            }
        }
    }

    /** 构造指向本测试注册处理器的合法保存请求。 */
    private JobSaveReqVO request(String name, String cronExpression) {
        JobSaveReqVO request = new JobSaveReqVO();
        request.setName(name);
        request.setHandlerName(VALID_HANDLER);
        request.setCronExpression(cronExpression);
        request.setRetryCount(0);
        request.setRetryInterval(0);
        return request;
    }

    /** 直接写入一条未删除任务，用于只验证查询契约的用例。 */
    private Long seedJob(String name, String handlerName, Integer status, String cronExpression) {
        JobDO job = JobDO.builder().name(name).handlerName(handlerName).status(status)
                .cronExpression(cronExpression).retryCount(0).retryInterval(0).monitorTimeout(0).build();
        jobMapper.insert(job);
        return job.getId();
    }

    /** 读取真实触发器的 Cron 表达式；触发器缺失直接失败，避免空值掩盖同步分叉。 */
    private String cronExpressionOf(String handlerName) throws Exception {
        Trigger trigger = scheduler.getTrigger(new TriggerKey(handlerName));
        assertThat(trigger).as("调度器必须存在触发器 %s", handlerName).isNotNull();
        assertThat(trigger).isInstanceOf(CronTrigger.class);
        return ((CronTrigger) trigger).getCronExpression();
    }

    /** 断言是指定错误码的业务异常，避免测试只依赖异常类型。 */
    private void assertBusinessError(org.assertj.core.api.ThrowableAssert.ThrowingCallable callable,
                                     ErrorCode errorCode) {
        assertThatThrownBy(callable).isInstanceOfSatisfying(ServiceException.class,
                failure -> assertThat(failure.getCode()).isEqualTo(errorCode.getCode()));
    }

    /** 统计未逻辑删除的任务行数；跨用例共享的表必须按实际可见行计数。 */
    private int countJobs() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + JOB_TABLE + " WHERE deleted = b'0'", Integer.class);
    }

    /** 缺失隔离环境时直接失败，避免退化成跳过真实数据库证据。 */
    private String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException("缺少隔离测试环境变量 " + name);
        return value;
    }

    /** 定位版本控制中的生产 DDL，不依赖测试进程从哪个模块启动。 */
    private Path repositoryRoot() {
        Path directory = Path.of("").toAbsolutePath();
        while (directory != null && !Files.isRegularFile(directory.resolve("数据库文件/basic_framework.sql"))) {
            directory = directory.getParent();
        }
        if (directory == null) throw new IllegalStateException("未找到框架空库基线");
        return directory;
    }

    /** 使用内存存储的独立调度器：只承载同步契约，不做任何远程导出和升级检查。 */
    private Properties quartzProperties() {
        Properties properties = new Properties();
        properties.setProperty("org.quartz.scheduler.instanceName", quartzInstance);
        properties.setProperty("org.quartz.threadPool.class", "org.quartz.simpl.SimpleThreadPool");
        properties.setProperty("org.quartz.threadPool.threadCount", "2");
        properties.setProperty("org.quartz.jobStore.class", "org.quartz.simpl.RAMJobStore");
        properties.setProperty("org.quartz.jobFactory.class", NoOpJobFactory.class.getName());
        properties.setProperty("org.quartz.scheduler.rmi.export", "false");
        properties.setProperty("org.quartz.scheduler.rmi.proxy", "false");
        properties.setProperty("org.quartz.scheduler.skipUpdateCheck", "true");
        return properties;
    }

    /** 使用真实 MyBatis 配置、分页插件和审计填充器，防止内存替身掩盖映射或事务错误。 */
    private SqlSessionFactory sqlSessionFactory(DataSource dataSource) {
        try {
            MybatisSqlSessionFactoryBean factory = new MybatisSqlSessionFactoryBean();
            factory.setDataSource(dataSource);
            MybatisConfiguration configuration = new MybatisConfiguration();
            configuration.setMapUnderscoreToCamelCase(true);
            factory.setConfiguration(configuration);
            MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
            // 不显式指定库类型：分页插件按测试数据源的实际连接自动识别，避免与生产枚举耦合
            interceptor.addInnerInterceptor(new PaginationInnerInterceptor());
            factory.setPlugins(interceptor);
            GlobalConfig config = new GlobalConfig();
            config.setDbConfig(new GlobalConfig.DbConfig().setIdType(IdType.AUTO));
            config.setMetaObjectHandler(new DefaultDBFieldHandler());
            factory.setGlobalConfig(config);
            return factory.getObject();
        } catch (Exception failure) {
            throw new IllegalStateException("定时任务测试 Mapper 初始化失败", failure);
        }
    }

    /** 开启生产服务的事务代理，异常必须回滚真实 MySQL。 */
    @Configuration(proxyBeanMethods = false)
    @EnableTransactionManagement(proxyTargetClass = true)
    static class JobTestConfiguration {
    }

    /**
     * 在真实 Quartz 之上记录调度调用。
     *
     * <p>手动触发生成的临时触发器不保留可查询的状态，无法像常规触发器那样断言；
     * 这里只在真实调用前后记录参数，调度器本身的行为仍由真实 Quartz 执行。</p>
     */
    static class RecordingSchedulerManager extends SchedulerManager {

        /** 已发生的调度动作，用于断言服务确实按契约调用了调度器。 */
        private final List<String> calls = new ArrayList<>();
        /** 非空时让下一次 addJob 抛出受控异常，验证数据库回滚。 */
        private SchedulerException addJobFailure;

        /** 使用真实调度器，除单次注入外保持生产调度行为。 */
        RecordingSchedulerManager(Scheduler scheduler) {
            super(scheduler);
        }

        /** 记录新增任务后交给真实 Quartz 建立 Job 与 Trigger。 */
        @Override
        public void addJob(Long jobId, String jobHandlerName, String jobHandlerParam, String cronExpression,
                           Integer retryCount, Integer retryInterval) throws SchedulerException {
            if (addJobFailure != null) {
                SchedulerException failure = addJobFailure;
                addJobFailure = null;
                throw failure;
            }
            calls.add("addJob:" + jobHandlerName);
            super.addJob(jobId, jobHandlerName, jobHandlerParam, cronExpression, retryCount, retryInterval);
        }

        /** 记录更新任务后交给真实 Quartz 重新调度触发器。 */
        @Override
        public void updateJob(String jobHandlerName, String jobHandlerParam, String cronExpression,
                              Integer retryCount, Integer retryInterval) throws SchedulerException {
            calls.add("updateJob:" + jobHandlerName);
            super.updateJob(jobHandlerName, jobHandlerParam, cronExpression, retryCount, retryInterval);
        }

        /** 记录删除任务后交给真实 Quartz 移除触发器和任务。 */
        @Override
        public void deleteJob(String jobHandlerName) throws SchedulerException {
            calls.add("deleteJob:" + jobHandlerName);
            super.deleteJob(jobHandlerName);
        }

        /** 记录暂停动作并由真实 Quartz 暂停任务。 */
        @Override
        public void pauseJob(String jobHandlerName) throws SchedulerException {
            calls.add("pauseJob:" + jobHandlerName);
            super.pauseJob(jobHandlerName);
        }

        /** 记录恢复动作并由真实 Quartz 恢复任务。 */
        @Override
        public void resumeJob(String jobHandlerName) throws SchedulerException {
            calls.add("resumeJob:" + jobHandlerName);
            super.resumeJob(jobHandlerName);
        }

        /** 记录手动触发的完整参数，真实一次性触发器没有可断言的持久状态。 */
        @Override
        public void triggerJob(Long jobId, String jobHandlerName, String jobHandlerParam)
                throws SchedulerException {
            calls.add("triggerJob:" + jobId + ":" + jobHandlerName + ":" + jobHandlerParam);
            super.triggerJob(jobId, jobHandlerName, jobHandlerParam);
        }
    }

    /** 测试注册的合法任务处理器：只作为 Bean 存在性契约的证据，不参与执行。 */
    static class RecordingJobHandler implements JobHandler {

        /** 生产处理器签名的占位实现；本测试只验证 Bean 校验，不验证处理器逻辑。 */
        @Override
        public String execute(String param) {
            return "unused";
        }
    }

    /**
     * 用空执行体替换 {@code JobHandlerInvoker}，避免与本模块断言无关的执行失败噪声。
     *
     * <p>Quartz 按类名反射实例化该工厂，因此类型必须公开且有无参构造。</p>
     *
     * @author shady2713
     */
    public static class NoOpJobFactory implements JobFactory {

        /** 公开无参构造是 Quartz 按类名实例化工厂的前提。 */
        public NoOpJobFactory() {
        }

        /** 无论调度详情是什么都返回空任务，保证测试调度器不会执行业务处理器。 */
        @Override
        public Job newJob(TriggerFiredBundle bundle, Scheduler scheduler) {
            return context -> {
            };
        }
    }
}
