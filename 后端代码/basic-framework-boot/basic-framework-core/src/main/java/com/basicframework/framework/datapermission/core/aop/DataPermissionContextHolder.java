package com.basicframework.framework.datapermission.core.aop;

import com.basicframework.framework.datapermission.core.annotation.DataPermission;
import com.alibaba.ttl.TransmittableThreadLocal;

import java.util.LinkedList;
import java.util.List;

/**
 * {@link DataPermission} 注解的线程上下文。
 *
 * <p>上下文使用栈结构保存数据权限配置，支持方法嵌套调用时正确恢复外层规则。</p>
 *
 * @author shady
 */
public class DataPermissionContextHolder {

    /**
     * 当前线程的数据权限栈。
     *
     * <p>使用自定义 {@link TransmittableThreadLocal} 并在跨线程传递与快照复制时深拷贝栈容器，
     * 避免父子线程或线程池并发任务共享同一个可变 {@link LinkedList} 引发状态污染。</p>
     */
    private static final TransmittableThreadLocal<LinkedList<DataPermission>> DATA_PERMISSIONS =
            new TransmittableThreadLocal<>() {
                /** 初始化当前线程的空数据权限栈。 */
                @Override
                protected LinkedList<DataPermission> initialValue() {
                    return new LinkedList<>();
                }

                /** 线程池懒创建或裸线程启动时返回空栈，避免将触发建线程请求的禁用权限固化为工作线程基线。 */
                @Override
                protected LinkedList<DataPermission> childValue(LinkedList<DataPermission> parentValue) {
                    return new LinkedList<>();
                }

                /** 为 TTL 异步捕获建立独立浅拷贝快照，防止父子线程与并发任务共享可变栈导致状态串扰。 */
                @Override
                public LinkedList<DataPermission> copy(LinkedList<DataPermission> parentValue) {
                    return parentValue == null ? new LinkedList<>() : new LinkedList<>(parentValue);
                }
            };

    /**
     * 获得当前生效的 DataPermission 注解。
     *
     * @return 当前栈顶的数据权限注解；上下文为空时返回 null
     */
    public static DataPermission get() {
        return DATA_PERMISSIONS.get().peekLast();
    }

    /**
     * 将 DataPermission 注解压入当前线程上下文。
     *
     * @param dataPermission 需要生效的数据权限注解
     */
    public static void add(DataPermission dataPermission) {
        DATA_PERMISSIONS.get().addLast(dataPermission);
    }

    /**
     * 移除当前线程最近一次压入的数据权限注解。
     *
     * @return 被移除的数据权限注解；栈为空时返回 null
     */
    public static DataPermission remove() {
        LinkedList<DataPermission> stack = DATA_PERMISSIONS.get();
        DataPermission dataPermission = stack.pollLast();
        if (stack.isEmpty()) {
            DATA_PERMISSIONS.remove();
        }
        return dataPermission;
    }

    /**
     * 获得当前线程数据权限栈的不可变快照。
     *
     * @return 当前线程数据权限栈的只读副本
     */
    public static List<DataPermission> getAll() {
        return List.copyOf(DATA_PERMISSIONS.get());
    }

    /**
     * 清空当前线程的数据权限上下文。
     *
     * <p>目前仅用于单元测试，业务代码应优先通过 {@link #add(DataPermission)} 和 {@link #remove()} 成对维护上下文。</p>
     */
    public static void clear() {
        DATA_PERMISSIONS.remove();
    }

}
