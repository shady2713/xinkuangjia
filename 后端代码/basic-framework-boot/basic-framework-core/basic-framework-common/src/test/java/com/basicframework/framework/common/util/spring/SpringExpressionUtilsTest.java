package com.basicframework.framework.common.util.spring;

import cn.hutool.extra.spring.SpringUtil;
import org.aspectj.lang.JoinPoint;
import org.aspectj.lang.reflect.MethodSignature;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationContext;
import org.springframework.context.support.GenericApplicationContext;

import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 验证 Spring EL 表达式工具在切面取参、Bean 解析与边界输入下的实际结果。
 *
 * <p>权限注解与数据权限规则都用该工具把表达式字符串翻译成方法参数或容器 Bean，取错变量或
 * 静默返回空值会让鉴权判断失真。用例固定以下可观察行为：空表达式集合与不可发现参数名时返回
 * 空结果而不抛错；可发现参数名时按形参名绑定实参；常量与运算符表达式按 SpEL 语义求值；
 * 解析 Bean 引用时必须走真实容器；空白表达式返回 null。</p>
 *
 * @author shady2713
 */
class SpringExpressionUtilsTest {

    /** 用例开始前的静态容器，结束后原样恢复，避免 Bean 解析结果在测试之间泄漏。 */
    private ApplicationContext previousContext;

    /** 记录进入用例前的容器，供还原使用。 */
    @BeforeEach
    void captureContext() {
        previousContext = SpringUtil.getApplicationContext();
    }

    /** 还原静态容器，避免影响同 JVM 内其他依赖 SpringUtil 的测试。 */
    @AfterEach
    void restoreContext() {
        new SpringUtils().setApplicationContext(previousContext);
    }

    /**
     * 批量解析必须按表达式原文为键返回结果，并按形参名绑定切面实参。
     */
    @Test
    void parseExpressionsResolvesMethodArguments() throws Exception {
        JoinPoint joinPoint = joinPoint(ProbeService.class.getDeclaredMethod("handle", String.class, int.class),
                new Object[]{"张三", 7});

        Map<String, Object> result = SpringExpressionUtils.parseExpressions(joinPoint, List.of("#name", "#count * 2"));

        assertThat(result).containsOnlyKeys("#name", "#count * 2");
        assertThat(result.get("#name")).isEqualTo("张三");
        assertThat(result.get("#count * 2")).isEqualTo(14);
    }

    /**
     * 单表达式解析复用批量结果，取不到键时返回 null 而不是抛错。
     */
    @Test
    void parseSingleExpressionFromJoinPointReturnsNullForUnknownKey() throws Exception {
        JoinPoint joinPoint = joinPoint(ProbeService.class.getDeclaredMethod("handle", String.class, int.class),
                new Object[]{"李四", 3});

        Object value = SpringExpressionUtils.parseExpression(joinPoint, "#name");
        Object missing = SpringExpressionUtils.parseExpression(joinPoint, "#absent");

        assertThat(value).isEqualTo("李四");
        assertThat(missing).as("表达式中不存在的变量必须返回 null").isNull();
    }

    /**
     * 表达式集合为空或为 null 时直接返回空结果，不得进入方法签名解析。
     */
    @Test
    void parseExpressionsReturnsEmptyMapForEmptyInput() {
        JoinPoint unusedJoinPoint = mock(JoinPoint.class);

        assertThat(SpringExpressionUtils.parseExpressions(unusedJoinPoint, List.of())).isEmpty();
        assertThat(SpringExpressionUtils.parseExpressions(unusedJoinPoint, null)).isEmpty();
    }

    /**
     * 方法签名取不到方法时返回空结果，不得抛空指针。
     */
    @Test
    void parseExpressionsReturnsEmptyMapWhenMethodMissing() {
        MethodSignature signature = mock(MethodSignature.class);
        when(signature.getMethod()).thenReturn(null);
        JoinPoint joinPoint = mock(JoinPoint.class);
        when(joinPoint.getSignature()).thenReturn(signature);

        assertThat(SpringExpressionUtils.parseExpressions(joinPoint, List.of("1 + 1"))).isEmpty();
    }

    /**
     * 方法形参名不可发现时不绑定变量，常量表达式仍可求值且不抛错。
     *
     * <p>参数名发现依赖编译期写入的 {@code MethodParameters} 属性，JDK 自带方法普遍没有该属性，
     * 因此以 {@code String.substring(int)} 代表"形参名不可发现"的真实来源。</p>
     */
    @Test
    void parseExpressionsKeepsConstantExpressionsWhenParameterNamesUnavailable() throws Exception {
        Method jdkMethod = String.class.getDeclaredMethod("substring", int.class);
        JoinPoint joinPoint = joinPoint(jdkMethod, new Object[]{1});

        Map<String, Object> result = SpringExpressionUtils.parseExpressions(joinPoint, List.of("'常量'"));

        assertThat(result.get("'常量'")).isEqualTo("常量");
    }

    /**
     * 无变量的表达式解析必须支持常量与 Bean 引用，Bean 来自真实容器。
     */
    @Test
    void parseExpressionResolvesBeanReferenceFromApplicationContext() {
        GenericApplicationContext context = new GenericApplicationContext();
        context.registerBean("probeBean", ProbeBean.class);
        context.refresh();
        new SpringUtils().setApplicationContext(context);
        try {
            Object beanValue = SpringExpressionUtils.parseExpression("@probeBean.greet()");
            Object constant = SpringExpressionUtils.parseExpression("1 + 1");
            Object blank = SpringExpressionUtils.parseExpression("   ");

            assertThat(beanValue).isEqualTo("hello");
            assertThat(constant).isEqualTo(2);
            assertThat(blank).as("空白表达式返回 null").isNull();
        } finally {
            context.close();
        }
    }

    /**
     * 传入变量表时表达式按变量求值，变量表为空时按常量求值。
     */
    @Test
    void parseExpressionUsesVariablesWhenProvided() {
        withApplicationContext(() -> {
            Object resolved = SpringExpressionUtils.parseExpression("#limit * 10", Map.of("limit", 5));
            Object withoutVariables = SpringExpressionUtils.parseExpression("2 * 3", Map.of());

            assertThat(resolved).isEqualTo(50);
            assertThat(withoutVariables).isEqualTo(6);
        });
    }

    /**
     * 变量未绑定时求值返回 null，该工具不校验变量存在性，调用方需自行判空。
     */
    @Test
    void parseExpressionReturnsNullForUnboundVariable() {
        withApplicationContext(() -> assertThat(SpringExpressionUtils.parseExpression("#absent")).isNull());
    }

    /**
     * 没有可用容器时非空白表达式必须立即失败，不能返回 null 让调用方误判为"表达式为空"。
     *
     * <p>{@code BeanFactoryResolver} 拒绝 null BeanFactory，因此该类在容器未装配时只能解析空白表达式；
     * 这是当前实现的真实边界，调用方必须保证表达式解析发生在 Spring 容器启动之后。</p>
     */
    @Test
    void parseExpressionRejectsNonBlankExpressionWithoutApplicationContext() {
        new SpringUtils().setApplicationContext(null);

        assertThat(SpringExpressionUtils.parseExpression("  ")).isNull();
        assertThatThrownBy(() -> SpringExpressionUtils.parseExpression("1 + 1"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("BeanFactory must not be null");
    }

    /**
     * 在独立容器中执行表达式断言，执行结束后关闭容器。
     *
     * @param assertion 需要容器存在的断言逻辑
     */
    private static void withApplicationContext(Runnable assertion) {
        GenericApplicationContext context = new GenericApplicationContext();
        context.refresh();
        new SpringUtils().setApplicationContext(context);
        try {
            assertion.run();
        } finally {
            context.close();
        }
    }

    /**
     * 构造切面替身：方法签名取指定方法，实参按顺序返回。
     *
     * @param method 被切方法的反射对象
     * @param args 切面实参
     * @return 具有真实签名与实参的切面替身
     */
    private static JoinPoint joinPoint(Method method, Object[] args) {
        MethodSignature signature = mock(MethodSignature.class);
        when(signature.getMethod()).thenReturn(method);
        JoinPoint joinPoint = mock(JoinPoint.class);
        when(joinPoint.getSignature()).thenReturn(signature);
        when(joinPoint.getArgs()).thenReturn(args);
        return joinPoint;
    }

    /**
     * 携带两个命名形参的探针方法，用于验证按形参名绑定实参。
     */
    private static class ProbeService {

        /**
         * 探针方法，仅提供可发现的形参名。
         *
         * @param name 名称
         * @param count 数量
         * @return 固定结果，不代表业务语义
         */
        public String handle(String name, int count) {
            return name + count;
        }

    }

    /**
     * 容器 Bean 夹具，用于验证表达式能按名称解析真实 Bean 并调用方法。
     *
     * @author shady2713
     */
    public static class ProbeBean {

        /**
         * 返回固定文本，供表达式断言调用结果。
         *
         * @return 固定文本
         */
        public String greet() {
            return "hello";
        }

    }

}
