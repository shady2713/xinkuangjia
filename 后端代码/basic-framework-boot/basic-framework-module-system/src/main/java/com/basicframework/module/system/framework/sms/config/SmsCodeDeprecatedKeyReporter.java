package com.basicframework.module.system.framework.sms.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.env.ConfigurableEnvironment;

import java.util.List;

/**
 * 启动期检测已被删除的短信验证码配置键，并输出 WARN 告警。
 *
 * <p>固定上游版本 {@code ruoyi-vue-pro@ac022b15} 在 {@code SmsCodeProperties} 上声明了
 * {@code beginCode} 与 {@code endCode} 两个验证码取值字段，本地版本把它们删除，验证码长度与取值上界
 * 改为固定在 {@code SmsCodeServiceImpl} 的常量上。属性类保留 Spring Boot 默认的
 * {@code ignoreUnknownFields = true}，因此照抄旧部署配置的环境会**正常启动、旧键不生效、日志无任何提示**，
 * 运维侧只能观察到「改了配置没反应」。</p>
 *
 * <p>本类把这种静默变成有据可查：命中即打一条 WARN，指明该键已移除、没有替代配置键、以及现在由什么决定
 * 验证码取值。检测**只记录不抛错**，旧配置不会打断启动。</p>
 *
 * <p>检测面与上一轮实测一致：本地配置前缀与固定上游配置前缀下各有一份同形状的旧键，两者都无落点。
 * 断言只按属性是否存在判断，YAML、system properties、环境变量（含 {@code BASIC_FRAMEWORK_SMS_CODE_*}
 * 这类大写下划线写法）与命令行参数都会被 {@link ConfigurableEnvironment#containsProperty(String)} 命中；
 * 仅在 YAML 中把键名写成驼峰 {@code beginCode} 的写法不在检测范围内。</p>
 *
 * @author 证据与契约方向执行代理
 */
@Slf4j
public class SmsCodeDeprecatedKeyReporter implements EnvironmentPostProcessor {

    /**
     * 待检测的已删除配置键。
     *
     * <p>前两个是本地配置前缀下的形态，后两个是固定上游配置前缀下的形态；上游前缀形态的旧配置同样
     * 既不报错也不生效，因此一并检测。</p>
     */
    static final List<String> REMOVED_KEYS = List.of(
            "basic-framework.sms-code.begin-code",
            "basic-framework.sms-code.end-code",
            "yudao.sms-code.begin-code",
            "yudao.sms-code.end-code");

    /**
     * 在环境准备完成后检查旧配置键是否仍然存在。
     *
     * <p>本方法只输出告警，任何情况下都不抛出异常、不改变属性面，也不阻止应用启动。</p>
     *
     * @param environment 运行环境配置
     * @param application 应用实例；本检测不读取其状态
     */
    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        for (String key : REMOVED_KEYS) {
            if (environment.containsProperty(key)) {
                log.warn("[reportRemovedKeys][检测到已删除的短信验证码配置键 {}：该配置已移除且不生效，验证码长度"
                        + "与取值上界固定在 SmsCodeServiceImpl 的常量上，没有替代配置键，请从部署配置中删除]", key);
            }
        }
    }

}