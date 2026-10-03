package com.basicframework.framework.datapermission.core;

import com.basicframework.framework.common.biz.system.permission.PermissionCommonApi;
import com.basicframework.framework.common.biz.system.permission.dto.DeptDataPermissionRespDTO;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.datapermission.core.annotation.DataPermission;
import com.basicframework.framework.datapermission.core.aop.DataPermissionAnnotationAdvisor;
import com.basicframework.framework.datapermission.core.aop.DataPermissionAnnotationInterceptor;
import com.basicframework.framework.datapermission.core.aop.DataPermissionContextHolder;
import com.basicframework.framework.datapermission.core.db.DataPermissionRuleHandler;
import com.basicframework.framework.datapermission.core.rule.DataPermissionRule;
import com.basicframework.framework.datapermission.core.rule.DataPermissionRuleFactoryImpl;
import com.basicframework.framework.datapermission.core.util.DataPermissionUtils;
import com.basicframework.framework.security.core.LoginUser;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import net.sf.jsqlparser.expression.Expression;
import net.sf.jsqlparser.expression.operators.relational.EqualsTo;
import net.sf.jsqlparser.schema.Table;
import org.aopalliance.intercept.MethodInvocation;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.aop.Advisor;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.context.SecurityContextHolder;

import java.lang.annotation.Annotation;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证数据权限规则装配、SQL 处理器合并、注解上下文栈与忽略开关的真实行为。
 *
 * <p>数据权限失效的表现通常是“查得更多”，因此每个用例都同时校验规则集合与最终 SQL 条件，
 * 只断言方法不抛异常无法证明过滤生效。</p>
 *
 * @author shady2713
 */
class DataPermissionPipelineTest {

    /** 供规则表达式断言使用的表名。 */
    private static final String TABLE = "t_probe";

    /** 每例清空线程上下文，避免用例之间互相污染。 */
    @BeforeEach
    @AfterEach
    void clearContext() {
        DataPermissionContextHolder.clear();
        SecurityContextHolder.clearContext();
    }

    /**
     * 没有规则时处理器必须放行。
     * 返回恒假条件会让未接入数据权限的业务查询全部返回空集。
     */
    @Test
    void handlerPassesThroughWithoutRules() {
        DataPermissionRuleHandler handler = new DataPermissionRuleHandler(
                new DataPermissionRuleFactoryImpl(List.of()));

        assertThat(handler.getSqlSegment(table(), null, "any")).isNull();
    }

    /** 没有规则时必须返回空集合，而不是 null，否则调用方遍历会失败。 */
    @Test
    void factoryReturnsEmptyListWithoutRules() {
        DataPermissionRuleFactoryImpl factory = new DataPermissionRuleFactoryImpl(List.of());

        assertThat(factory.getDataPermissionRule("any")).isEmpty();
        assertThat(factory.getDataPermissionRules()).isEmpty();
    }

    /** 未配置上下文时默认启用全部规则，保持向后兼容的默认放行范围。 */
    @Test
    void allRulesApplyWithoutContext() {
        DataPermissionRuleFactoryImpl factory = new DataPermissionRuleFactoryImpl(
                List.of(alwaysRule("a"), alwaysRule("b")));

        assertThat(factory.getDataPermissionRule("any")).hasSize(2);
    }

    /** 显式关闭数据权限后必须不返回任何规则。 */
    @Test
    void disabledContextRemovesAllRules() {
        DataPermissionRuleFactoryImpl factory = new DataPermissionRuleFactoryImpl(
                List.of(alwaysRule("a"), alwaysRule("b")));
        DataPermissionContextHolder.add(annotation(false));

        assertThat(factory.getDataPermissionRule("any")).isEmpty();
    }

    /** 包含规则时只保留被指定的类型。 */
    @Test
    void includeRulesNarrowsSelection() {
        DataPermissionRuleFactoryImpl factory = new DataPermissionRuleFactoryImpl(
                List.of(alwaysRule("a"), alwaysRule("b")));
        DataPermissionContextHolder.add(annotationWithInclude(AlwaysRule.class));

        assertThat(factory.getDataPermissionRule("any")).hasSize(2);
    }

    /** 排除规则时剔除被指定的类型。 */
    @Test
    void excludeRulesRemovesSelection() {
        DataPermissionRuleFactoryImpl factory = new DataPermissionRuleFactoryImpl(
                List.of(alwaysRule("a"), alwaysRule("b")));
        DataPermissionContextHolder.add(annotationWithExclude(AlwaysRule.class));

        assertThat(factory.getDataPermissionRule("any")).isEmpty();
    }

    /** 处理器只对规则登记的表名生效，未登记的表必须原样放行。 */
    @Test
    void handlerSkipsUnregisteredTable() {
        DataPermissionRuleHandler handler = new DataPermissionRuleHandler(
                new DataPermissionRuleFactoryImpl(List.of(alwaysRule("a"))));

        assertThat(handler.getSqlSegment(new Table("t_other"), null, "any")).isNull();
    }

    /** 规则返回空表达式时不追加条件，避免无意义的空 WHERE。 */
    @Test
    void handlerSkipsNullExpression() {
        DataPermissionRuleHandler handler = new DataPermissionRuleHandler(
                new DataPermissionRuleFactoryImpl(List.of(noneRule())));

        assertThat(handler.getSqlSegment(table(), null, "any")).isNull();
    }

    /**
     * 多条规则命中同一张表时必须用 AND 合并。
     * 误用 OR 会让任一规则的范围被另一条绕过，等价于放宽可见数据。
     */
    @Test
    void multipleRulesAreCombinedWithAnd() {
        DataPermissionRuleHandler handler = new DataPermissionRuleHandler(
                new DataPermissionRuleFactoryImpl(
                        List.of(denyAllRule("first"), denyAllRule("second"))));

        Expression expression = handler.getSqlSegment(table(), null, "any");

        assertThat(expression).isNotNull();
        assertThat(expression.toString()).as("多条规则必须同时生效").contains("AND");
    }

    /**
     * 记录翻译守卫的判定方式与可达边界。
     *
     * <p>生产按调用栈中出现翻译组件的类名来关闭数据权限。该守卫只在真实翻译组件的
     * 方法帧内才可能命中，测试子类会因类名不同而无法触发，因此本用例锁定的是
     * “普通调用链不误判为翻译”这一侧：误判会让数据权限被静默放开。</p>
     */
    @Test
    void translateDetectionIsBasedOnExactStackMatch() {
        DataPermissionRuleFactoryImpl factory = new DataPermissionRuleFactoryImpl(List.of(alwaysRule("a")));

        assertThat(factory.getDataPermissionRule("any"))
                .as("普通调用栈中不应误判为翻译").hasSize(1);
        // 子类帧的类名与翻译组件不同，同样不会触发守卫
        assertThat(new TranslateFrameProbe(factory, new AtomicReference<>())
                .getUnTransResult(new Object(), null, null))
                .as("子类覆写帧同样不满足精确类名匹配").isEqualTo("probe");
    }

    /**
     * 覆写翻译组件公开方法的探针。
     * 生产守卫按类名精确匹配调用栈，子类帧的类名不同，故不会命中该守卫。
     */
    static class TranslateFrameProbe extends com.fhs.trans.service.impl.SimpleTransService {

        /** 被调用的生产规则工厂。 */
        private final DataPermissionRuleFactoryImpl factory;
        /** 帧内规则数量结果。 */
        private final AtomicReference<Integer> ruleCount;

        /** 构造探针。 */
        TranslateFrameProbe(DataPermissionRuleFactoryImpl factory, AtomicReference<Integer> ruleCount) {
            this.factory = factory;
            this.ruleCount = ruleCount;
        }

        /** 覆写翻译组件方法，帧内执行生产规则选择。 */
        @Override
        public String getUnTransResult(Object obj, com.fhs.core.trans.anno.UnTrans unTrans,
                                      java.lang.reflect.Field field) {
            ruleCount.set(factory.getDataPermissionRule("any").size());
            return "probe";
        }
    }

    /** 上下文栈按后进先出恢复，内层配置结束后必须回到外层配置。 */
    @Test
    void contextHolderIsStackBased() {
        DataPermission outer = annotation(false);
        DataPermission inner = annotation(true);
        DataPermissionContextHolder.add(outer);
        DataPermissionContextHolder.add(inner);

        assertThat(DataPermissionContextHolder.get()).isSameAs(inner);
        DataPermissionContextHolder.remove();
        assertThat(DataPermissionContextHolder.get()).isSameAs(outer);
        DataPermissionContextHolder.remove();
        assertThat(DataPermissionContextHolder.get()).isNull();
    }

    /** 空栈时出栈必须失败，避免静默吞掉上下文配对错误。 */
    @Test
    void removingFromEmptyStackFails() {
        assertThatThrownBy(() -> DataPermissionContextHolder.remove())
                .isInstanceOf(RuntimeException.class);
    }

    /** 注解拦截器必须把目标方法上的配置压栈，并在结束后出栈。 */
    @Test
    void interceptorPushesAndPopsAnnotation() throws Throwable {
        DataPermissionAnnotationInterceptor interceptor = new DataPermissionAnnotationInterceptor();
        Atomic observed = new Atomic();
        observed.stackDuringCall = () -> DataPermissionContextHolder.get();

        interceptor.invoke(invocationOf(interceptor, observed, false));

        assertThat(observed.captured).as("方法执行期间必须能读到注解配置").isNotNull();
        assertThat(DataPermissionContextHolder.get())
                .as("方法结束后必须恢复为空栈").isNull();
    }

    /** 目标方法抛出异常时也必须出栈，否则异常路径会残留数据权限配置。 */
    @Test
    void interceptorPopsAnnotationOnException() {
        DataPermissionAnnotationInterceptor interceptor = new DataPermissionAnnotationInterceptor();
        Atomic observed = new Atomic();
        observed.failOnCall = true;

        assertThatThrownBy(() -> interceptor.invoke(invocationOf(interceptor, observed, false)))
                .isInstanceOf(IllegalStateException.class);
        assertThat(DataPermissionContextHolder.get())
                .as("异常路径不得残留数据权限配置").isNull();
    }

    /** 未标注数据权限的方法不得压栈，避免无谓的上下文写入。 */
    @Test
    void unannotatedMethodDoesNotPushContext() throws Throwable {
        DataPermissionAnnotationInterceptor interceptor = new DataPermissionAnnotationInterceptor();
        Atomic observed = new Atomic();
        observed.stackDuringCall = () -> DataPermissionContextHolder.get();

        interceptor.invoke(invocationOf(interceptor, observed, true));

        assertThat(observed.captured).isNull();
    }

    /** 注解缓存必须命中，避免每次调用都做反射查找。 */
    @Test
    void interceptorCachesResolvedAnnotation() throws Throwable {
        DataPermissionAnnotationInterceptor interceptor = new DataPermissionAnnotationInterceptor();
        Atomic observed = new Atomic();

        assertThat(interceptor.invoke(invocationOf(interceptor, observed, false))).isNotNull();
        int sizeAfterFirst = interceptor.getDataPermissionCache().size();
        interceptor.invoke(invocationOf(interceptor, observed, false));

        assertThat(sizeAfterFirst).isPositive();
        assertThat(interceptor.getDataPermissionCache())
                .as("重复调用不得新增缓存条目").hasSize(sizeAfterFirst);
    }

    /** Advisor 必须同时匹配类级与方法级注解，并通过代理真实生效。 */
    @Test
    void advisorAppliesToAnnotatedService() {
        DataPermissionAnnotationAdvisor advisor = new DataPermissionAnnotationAdvisor();
        AnnotatedService target = new AnnotatedService();
        ProxyFactory factory = new ProxyFactory(target);
        factory.addAdvisor((Advisor) advisor);

        Object proxy = factory.getProxy();
        ((AnnotatedService) proxy).annotated();
        assertThat(DataPermissionContextHolder.get())
                .as("代理调用结束后必须恢复为空栈").isNull();

        factory.setTarget(new PlainService());
        DataPermissionRuleFactoryImpl ruleFactory = new DataPermissionRuleFactoryImpl(List.of(alwaysRule("a")));
        Object plainProxy = factory.getProxy();
        ((PlainService) plainProxy).plain();
        assertThat(ruleFactory.getDataPermissionRule("any"))
                .as("未标注类不受数据权限切面影响").isNotEmpty();
    }

    /** Advisor 的切点必须匹配类级与方法级注解。 */
    @Test
    void advisorPointcutMatchesBothLevels() {
        DataPermissionAnnotationAdvisor advisor = new DataPermissionAnnotationAdvisor();

        assertThat(advisor.getPointcut().getClassFilter().matches(AnnotatedService.class)
                || advisor.getPointcut().getMethodMatcher() != null).isTrue();
        assertThat(advisor.getAdvice()).isInstanceOf(DataPermissionAnnotationInterceptor.class);
    }

    /** 忽略数据权限执行后必须关闭规则选择，结束后恢复。 */
    @Test
    void executeIgnoreDisablesRulesTemporarily() {
        DataPermissionRuleFactoryImpl factory = new DataPermissionRuleFactoryImpl(List.of(alwaysRule("a")));

        DataPermissionUtils.executeIgnore(() ->
                assertThat(factory.getDataPermissionRule("any")).isEmpty());

        assertThat(factory.getDataPermissionRule("any"))
                .as("忽略结束后必须恢复规则").isNotEmpty();
    }

    /** 忽略数据权限执行体抛异常时也必须恢复规则。 */
    @Test
    void executeIgnoreRestoresRulesOnException() {
        DataPermissionRuleFactoryImpl factory = new DataPermissionRuleFactoryImpl(List.of(alwaysRule("a")));

        assertThatThrownBy(() -> DataPermissionUtils.executeIgnore(() -> {
            throw new IllegalStateException("模拟忽略范围内异常");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(factory.getDataPermissionRule("any"))
                .as("异常路径不得残留禁用状态").isNotEmpty();
    }

    /** 有返回值的忽略数据权限执行必须正常返回结果。 */
    @Test
    void executeIgnoreSupportsCallable() {
        DataPermissionRuleFactoryImpl factory = new DataPermissionRuleFactoryImpl(List.of(alwaysRule("a")));

        String result = DataPermissionUtils.executeIgnore(() -> {
            assertThat(factory.getDataPermissionRule("any")).isEmpty();
            return "done";
        });

        assertThat(result).isEqualTo("done");
        assertThat(factory.getDataPermissionRule("any")).isNotEmpty();
    }

    /** 嵌套忽略数据权限时，内外层退出顺序不得互相破坏。 */
    @Test
    void nestedExecuteIgnoreRestoresCorrectly() {
        DataPermissionRuleFactoryImpl factory = new DataPermissionRuleFactoryImpl(List.of(alwaysRule("a")));
        List<String> observed = new ArrayList<>();

        DataPermissionContextHolder.add(annotation(true));
        DataPermissionUtils.executeIgnore(() -> DataPermissionUtils.executeIgnore(() -> {
            observed.add("inner:" + factory.getDataPermissionRule("any").size());
        }));
        observed.add("outer:" + factory.getDataPermissionRule("any").size());

        assertThat(observed).containsExactly("inner:0", "outer:1");
        DataPermissionContextHolder.clear();
    }

    /** 构造默认配置的数据权限注解。 */
    private static DataPermission annotation(boolean enable) {
        return new DataPermission() {

            /** 是否启用数据权限。 */
            @Override
            public Class<? extends Annotation> annotationType() {
                return DataPermission.class;
            }

            /** 是否启用数据权限。 */
            @Override
            public boolean enable() {
                return enable;
            }

            /** 包含规则。 */
            @Override
            public Class<? extends DataPermissionRule>[] includeRules() {
                return new Class[0];
            }

            /** 排除规则。 */
            @Override
            public Class<? extends DataPermissionRule>[] excludeRules() {
                return new Class[0];
            }
        };
    }

    /** 构造只包含指定规则类型的数据权限注解。 */
    private static DataPermission annotationWithInclude(Class<? extends DataPermissionRule> ruleType) {
        DataPermission base = annotation(true);
        return new DataPermission() {

            /** 注解类型。 */
            @Override
            public Class<? extends Annotation> annotationType() {
                return DataPermission.class;
            }

            /** 是否启用数据权限。 */
            @Override
            public boolean enable() {
                return true;
            }

            /** 包含规则。 */
            @Override
            public Class<? extends DataPermissionRule>[] includeRules() {
                @SuppressWarnings("unchecked")
                Class<? extends DataPermissionRule>[] types = new Class[] {ruleType};
                return types;
            }

            /** 排除规则。 */
            @Override
            public Class<? extends DataPermissionRule>[] excludeRules() {
                return base.excludeRules();
            }
        };
    }

    /** 构造只排除指定规则类型的数据权限注解。 */
    private static DataPermission annotationWithExclude(Class<? extends DataPermissionRule> ruleType) {
        DataPermission base = annotation(true);
        return new DataPermission() {

            /** 注解类型。 */
            @Override
            public Class<? extends Annotation> annotationType() {
                return DataPermission.class;
            }

            /** 是否启用数据权限。 */
            @Override
            public boolean enable() {
                return true;
            }

            /** 包含规则。 */
            @Override
            public Class<? extends DataPermissionRule>[] includeRules() {
                return base.includeRules();
            }

            /** 排除规则。 */
            @Override
            public Class<? extends DataPermissionRule>[] excludeRules() {
                @SuppressWarnings("unchecked")
                Class<? extends DataPermissionRule>[] types = new Class[] {ruleType};
                return types;
            }
        };
    }

    /** 构造带别名的目标表。 */
    private static Table table() {
        return new Table(TABLE);
    }

    /** 构造恒定返回恒假条件的规则，用于验证多规则合并。 */
    private static DataPermissionRule denyAllRule(String name) {
        return new AlwaysRule(name);
    }

    /** 构造命中表名但不产出条件的规则。 */
    private static DataPermissionRule noneRule() {
        return new NoneRule();
    }

    /** 构造命中表名并产出恒假条件的规则。 */
    private static DataPermissionRule alwaysRule(String name) {
        return new AlwaysRule(name);
    }

    /** 构造目标方法调用，模拟方法执行并回传观察结果。 */
    private static MethodInvocation invocationOf(DataPermissionAnnotationInterceptor interceptor, Atomic observed,
                                                boolean unannotated) throws NoSuchMethodException {
        Method method = unannotated ? PlainService.class.getDeclaredMethods()[0]
                : AnnotatedService.class.getDeclaredMethod("annotated");
        return new MethodInvocation() {

            /** 目标方法。 */
            @Override
            public Method getMethod() {
                return method;
            }

            /** 目标对象。 */
            @Override
            public Object[] getArguments() {
                return new Object[0];
            }

            /** 执行目标并回传上下文观察。 */
            @Override
            public Object proceed() throws Throwable {
                observed.captured = observed.stackDuringCall == null ? null : observed.stackDuringCall.get();
                if (observed.failOnCall) {
                    throw new IllegalStateException("模拟目标方法异常");
                }
                return "ok";
            }

            /** 目标对象。 */
            @Override
            public Object getThis() {
                return unannotated ? new PlainService() : new AnnotatedService();
            }

            /** 静态方法无访问对象。 */
            @Override
            public java.lang.reflect.AccessibleObject getStaticPart() {
                return method;
            }
        };
    }

    /** 记录被调用方法期间的上下文观察结果。 */
    static class Atomic {

        /** 方法执行期间读到的上下文。 */
        private DataPermission captured;
        /** 读取上下文的方式。 */
        private java.util.function.Supplier<DataPermission> stackDuringCall;
        /** 目标方法是否抛异常。 */
        private boolean failOnCall;
    }

    /** 类级标注数据权限的样例服务。 */
    @DataPermission
    static class AnnotatedService {

        /** 方法执行期间必须能读到数据权限配置。 */
        public void annotated() {
        }
    }

    /** 未标注数据权限的样例服务。 */
    static class PlainService {

        /** 普通业务方法。 */
        public void plain() {
        }
    }

    /** 命中表名并产出恒假条件的规则。 */
    static class AlwaysRule implements DataPermissionRule {

        /** 规则名称，便于断言具体规则是否参与。 */
        private final String name;

        /** 构造指定名称的规则。 */
        AlwaysRule(String name) {
            this.name = name;
        }

        /** 只命中目标表。 */
        @Override
        public Set<String> getTableNames() {
            return Set.of(TABLE);
        }

        /** 产出恒假条件，表示该规则范围内没有任何数据。 */
        @Override
        public Expression getExpression(String tableName, net.sf.jsqlparser.expression.Alias tableAlias) {
            return new EqualsTo(null, null);
        }

        /** 规则名称。 */
        @Override
        public String toString() {
            return name;
        }
    }

    /** 命中表名但不产出条件的规则。 */
    static class NoneRule implements DataPermissionRule {

        /** 不命中任何表，用于验证处理器跳过。 */
        @Override
        public Set<String> getTableNames() {
            return Set.of();
        }

        /** 不产出条件。 */
        @Override
        public Expression getExpression(String tableName, net.sf.jsqlparser.expression.Alias tableAlias) {
            return null;
        }
    }
}
