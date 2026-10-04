package com.basicframework.framework.common.util.spring;

import cn.hutool.extra.spring.SpringUtil;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationContext;
import org.springframework.context.support.StaticApplicationContext;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 {@link SpringUtils} 的生产环境判定只依据 Spring 活动 profile。
 *
 * <p>{@code isProd()} 被启动期与运行期逻辑用于区分生产与开发行为，判定错误会让开发环境
 * 走生产分支或让生产环境走开发分支。该工具类继承 Hutool 的 {@code SpringUtil}
 * （一个 {@code ApplicationContextAware} 组件），因此这里按真实使用方式实例化它并注入
 * 上下文，而不是直接改写静态字段。</p>
 *
 * @author shady2713
 */
class SpringUtilsTest {

    /** 用例开始前的静态上下文，结束后原样恢复，避免污染同 JVM 的其他测试。 */
    private ApplicationContext previousContext;

    /** 记录进入用例前的静态上下文，供还原使用。 */
    @BeforeEach
    void captureContext() {
        previousContext = SpringUtil.getApplicationContext();
    }

    /** 还原静态上下文，避免活动 profile 在测试之间泄漏。 */
    @AfterEach
    void restoreContext() {
        new SpringUtils().setApplicationContext(previousContext);
    }

    /**
     * 活动 profile 为 prod 时判定为生产环境，并确认 profile 真的从注入的上下文读取。
     */
    @Test
    void prodProfileIsDetected() {
        SpringUtils utils = new SpringUtils();
        utils.setApplicationContext(contextWithProfiles("prod"));

        assertThat(SpringUtils.getActiveProfile()).isEqualTo("prod");
        assertThat(SpringUtils.isProd()).isTrue();
    }

    /**
     * 活动 profile 为 dev 时不得判定为生产环境，避免开发环境误走生产分支。
     */
    @Test
    void devProfileIsNotProd() {
        new SpringUtils().setApplicationContext(contextWithProfiles("dev"));

        assertThat(SpringUtils.getActiveProfile()).isEqualTo("dev");
        assertThat(SpringUtils.isProd()).isFalse();
    }

    /**
     * 未设置任何活动 profile 时判定为“非生产”。
     *
     * <p>取值来自 {@code getActiveProfile()} 的 null，此时放行开发分支比默认按生产处理更安全：
     * 生产部署必须显式声明 profile。</p>
     */
    @Test
    void absentProfileIsNotProd() {
        new SpringUtils().setApplicationContext(contextWithProfiles());

        assertThat(SpringUtils.getActiveProfile()).isNull();
        assertThat(SpringUtils.isProd()).isFalse();
    }

    /**
     * 构造带指定活动 profile 的最小上下文。
     *
     * @param profiles 活动 profile，允许为空表示不显式激活
     * @return 可供 {@code SpringUtil} 读取环境信息的最小上下文
     */
    private StaticApplicationContext contextWithProfiles(String... profiles) {
        StaticApplicationContext context = new StaticApplicationContext();
        context.getEnvironment().setActiveProfiles(profiles);
        return context;
    }

}
