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
 * @author 李杰
 */
public class DataPermissionContextHolder {

    /**
     * 当前线程的数据权限栈。
     *
     * <p>使用 {@link TransmittableThreadLocal} 是为了在异步任务场景下传递调用方的数据权限上下文。</p>
     */
    private static final ThreadLocal<LinkedList<DataPermission>> DATA_PERMISSIONS =
            TransmittableThreadLocal.withInitial(LinkedList::new);

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
     * @return 被移除的数据权限注解
     */
    public static DataPermission remove() {
        DataPermission dataPermission = DATA_PERMISSIONS.get().removeLast();
        if (DATA_PERMISSIONS.get().isEmpty()) {
            DATA_PERMISSIONS.remove();
        }
        return dataPermission;
    }

    /**
     * 获得当前线程的完整数据权限栈。
     *
     * @return 当前线程的数据权限栈
     */
    public static List<DataPermission> getAll() {
        return DATA_PERMISSIONS.get();
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
