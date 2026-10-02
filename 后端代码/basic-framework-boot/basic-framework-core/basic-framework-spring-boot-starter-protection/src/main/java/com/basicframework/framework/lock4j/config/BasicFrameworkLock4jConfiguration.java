package com.basicframework.framework.lock4j.config;

import com.basicframework.framework.lock4j.core.DefaultLockFailureStrategy;
import com.baomidou.lock.spring.boot.autoconfigure.LockAutoConfiguration;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.context.annotation.Bean;

/**
 * Lock4j 自动配置类，提供项目统一的获取锁失败处理策略。
 *
 * @author 李杰
 */
@AutoConfiguration(before = LockAutoConfiguration.class)
@ConditionalOnClass(name = "com.baomidou.lock.annotation.Lock4j")
public class BasicFrameworkLock4jConfiguration {

    /**
     * 创建默认获取锁失败策略。
     *
     * @return 默认获取锁失败策略
     */
    @Bean
    public DefaultLockFailureStrategy lockFailureStrategy() {
        return new DefaultLockFailureStrategy();
    }

}
