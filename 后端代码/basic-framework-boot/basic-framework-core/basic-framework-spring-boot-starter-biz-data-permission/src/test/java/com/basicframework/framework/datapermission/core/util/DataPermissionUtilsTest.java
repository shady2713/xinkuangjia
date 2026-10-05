package com.basicframework.framework.datapermission.core.util;

import com.basicframework.framework.datapermission.core.annotation.DataPermission;
import com.basicframework.framework.datapermission.core.aop.DataPermissionContextHolder;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.concurrent.Callable;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

/**
 * 验证数据权限忽略工具的反射元数据边界与失败透传契约。
 *
 * <p>忽略开关本身正确与否由 {@code DataPermissionPipelineTest} 从规则装配与 SQL 合并侧验证；
 * 本用例只锁定 {@code DataPermissionUtils} 自己的两个对外可观察契约：</p>
 * <ul>
 *   <li><b>元数据取得</b>：禁用标记必须来自本类私有方法上的 {@code @DataPermission(enable = false)}，
 *       而不是硬编码的注解实例，否则「在方法上声明禁用」这一唯一权威来源会与实际生效值脱钩；</li>
 *   <li><b>失败透传</b>：反射查找目标不存在时必须原样抛出 {@link NoSuchMethodException}，
 *       不得包装成运行时异常，也不得吞掉后返回 null。该契约过去由 Lombok
 *       {@code @SneakyThrows} 生成的 {@code catch Throwable -> athrow} 指令承接，
 *       在方法体内没有任何合法输入能让反射失败，因此这条指令在正式套件里从未被执行；
 *       现在它被组织为接受显式查找输入的内部边界，可以用真实异常输入驱动。</li>
 * </ul>
 *
 * <p>用例同时锁定上下文生命周期：无论被忽略的逻辑正常返回还是抛错，线程内的数据权限上下文
 * 都必须回到调用前的状态，否则一次失败的忽略调用会把后续所有查询变成无过滤查询。</p>
 *
 * @author shady2713
 */
class DataPermissionUtilsTest {

    /** 每例结束都清空线程上下文，避免用例之间互相污染。 */
    @AfterEach
    void clearContext() {
        DataPermissionContextHolder.clear();
    }

    /**
     * 反射查找目标不存在时必须原样透传受检异常。
     *
     * <p>这是失败透传的核心断言：使用真实反射与真实不存在的查找输入，不允许替身伪造异常。
     * 断言精确类型可以同时排除「包装成运行时异常」与「吞掉后返回 null」这两种错误实现——
     * 前者会让调用方失去可重试/可分类的信号，后者会让禁用标记静默变成 null，
     * 进而使 `add` 写入空注解、忽略开关彻底失效。</p>
     */
    @Test
    void missingReflectionTargetPropagatesCheckedExceptionUnwrapped() {
        Throwable thrown = catchThrowable(() ->
                DataPermissionUtils.readDisableDataPermission(DataPermissionUtils.class, "noSuchProbeMethod"));

        assertThat(thrown).as("查找失败必须抛出异常，不得吞掉后返回 null")
                .isInstanceOf(NoSuchMethodException.class);
        assertThat(thrown).as("受检异常必须原样透传，不得被包装成运行期异常")
                .isNotInstanceOf(RuntimeException.class);
        assertThat(thrown.getMessage()).contains("noSuchProbeMethod");
    }

    /**
     * 禁用标记必须真实取自声明了 {@code enable = false} 的本类方法。
     *
     * <p>正例对照：同一个边界用真实存在的查找输入必须取回真实注解，并且该注解的
     * {@code enable} 为 false。若实现退化成硬编码实例或找错声明位置，本断言会失败。</p>
     */
    @Test
    void disableMarkerIsReadFromTheDeclaredMethod() {
        DataPermission annotation = DataPermissionUtils.readDisableDataPermission(
                DataPermissionUtils.class, "getDisableDataPermissionDisable");

        assertThat(annotation).as("禁用标记必须来自真实注解声明").isNotNull();
        assertThat(annotation.enable()).as("禁用标记必须关闭数据权限").isFalse();
    }

    /**
     * 忽略逻辑正常完成与抛错后，上下文都必须回到调用前的空状态。
     *
     * <p>忽略开关用线程上下文栈实现；栈未弹出会让后续查询永久失去过滤条件。
     * 反射直调 {@code getDisableDataPermissionDisable} 会缓存注解实例，
     * 因此这里通过公开的 {@code addDisableDataPermission}/{@code removeDataPermission}
     * 驱动同一缓存路径，并断言两种出口都清空上下文。</p>
     */
    @Test
    void ignoreLifecycleRestoresContextOnSuccessAndFailure() {
        AtomicReference<String> observed = new AtomicReference<>();
        DataPermissionUtils.executeIgnore(
                () -> observed.set(DataPermissionContextHolder.get() == null ? "absent" : "present"));

        assertThat(observed.get()).as("忽略期间必须真的压入禁用标记").isEqualTo("present");
        assertThat(DataPermissionContextHolder.get()).as("成功出口必须弹出上下文").isNull();

        AtomicReference<String> failing = new AtomicReference<>();
        assertThatThrownBy(() -> DataPermissionUtils.executeIgnore((Callable<Void>) () -> {
            failing.set(DataPermissionContextHolder.get() == null ? "absent" : "present");
            throw new IllegalStateException("DUMMY-IGNORED-FAILURE");
        })).isInstanceOf(IllegalStateException.class)
                .hasMessage("DUMMY-IGNORED-FAILURE");

        assertThat(failing.get()).as("失败路径同样必须处于禁用上下文内").isEqualTo("present");
        assertThat(DataPermissionContextHolder.get()).as("失败出口同样必须弹出上下文").isNull();
    }

    /**
     * 以受检的反射调用包装执行一次查找，用于断言检查型异常的真实类型。
     *
     * @param action 需要执行的查找动作
     * @return 查找抛出的失败；没有抛出时返回 null
     */
    private static Throwable catchThrowable(ThrowingProbe action) {
        try {
            action.run();
            return null;
        } catch (Throwable failure) {
            return failure;
        }
    }

    /** 允许抛出受检异常的查找动作边界。 */
    @FunctionalInterface
    private interface ThrowingProbe {

        /** 执行一次可能失败的数据权限元数据查找。 */
        void run() throws Throwable;
    }

}
