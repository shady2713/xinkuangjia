package com.basicframework.framework.datapermission.core.util;

import com.basicframework.framework.datapermission.core.annotation.DataPermission;
import com.basicframework.framework.datapermission.core.aop.DataPermissionContextHolder;
import lombok.SneakyThrows;

import java.util.concurrent.Callable;

/**
 * 数据权限 Util
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
public class DataPermissionUtils {

    private static DataPermission dataPermissionDisable;

    /**
     * 获取禁用标记数据权限禁用标记。
     */
    @DataPermission(enable = false)
    private static synchronized DataPermission getDisableDataPermissionDisable() {
        if (dataPermissionDisable == null) {
            dataPermissionDisable = readDisableDataPermission(
                    DataPermissionUtils.class, "getDisableDataPermissionDisable");
        }
        return dataPermissionDisable;
    }

    /**
     * 内部可测边界：反射取得指定方法上的 {@link DataPermission} 元数据，查找失败时原样透传受检异常。
     *
     * <p>失败透传契约与既有 {@code @SneakyThrows} 生成的
     * 「{@code catch Throwable -> athrow}」指令完全一致：{@link NoSuchMethodException} 不包装、
     * 不吞掉，也不转成运行时异常。把反射取得与失败透传独立出来后，失败边界可以用真实异常输入
     * 断言，而调用方 {@link #getDisableDataPermissionDisable()} 仍保持「先查询后缓存」的行为，
     * 数据权限上下文的新增与移除生命周期不变。</p>
     *
     * @param declaringType 声明目标方法的类型
     * @param methodName 目标方法名
     * @return 目标方法上的注解实例；方法上确实没有该注解时同样返回 null
     * @throws NoSuchMethodException 目标类型上不存在该方法时原样抛出
     */
    @SneakyThrows
    static DataPermission readDisableDataPermission(Class<?> declaringType, String methodName) {
        return declaringType.getDeclaredMethod(methodName).getAnnotation(DataPermission.class);
    }

    /**
     * 忽略数据权限，执行对应的逻辑
     *
     * @param runnable 逻辑
     */
    public static void executeIgnore(Runnable runnable) {
        addDisableDataPermission();
        try {
            // 执行 runnable
            runnable.run();
        } finally {
            removeDataPermission();
        }
    }

    /**
     * 忽略数据权限，执行对应的逻辑
     *
     * @param callable 逻辑
     * @return 执行结果
     */
    @SneakyThrows
    public static <T> T executeIgnore(Callable<T> callable) {
        addDisableDataPermission();
        try {
            // 执行 callable
            return callable.call();
        } finally {
            removeDataPermission();
        }
    }

    /**
     * 添加忽略数据权限
     */
    public static void addDisableDataPermission(){
        DataPermission dataPermission = getDisableDataPermissionDisable();
        DataPermissionContextHolder.add(dataPermission);
    }

    /**
     * 清除当前线程的数据权限上下文。
     */
    public static void removeDataPermission(){
        DataPermissionContextHolder.remove();
    }

}
