package com.basicframework.module.system.service.permission;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Collection;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.CALLS_REAL_METHODS;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证 {@link PermissionService} 单值入口 {@code getRoleMenuListByRoleId(Long)} 的委托契约。
 *
 * <p>单值入口是业务代码的常用写法，它必须复用批量实现并把角色编号包成单元素集合：
 * 若单值入口自行实现查询，两条路径的菜单集合可能不一致，导致同一用户在不同入口下看到不同菜单。
 * 因此这里用真实默认方法调用，只替身批量抽象方法并观察它收到的集合。</p>
 *
 * @author shady2713
 */
class PermissionServiceTest {

    /** 被测服务：默认方法调用真实实现，未打桩的抽象方法使用替身。 */
    private final PermissionService service = mock(PermissionService.class, CALLS_REAL_METHODS);

    /** 单值入口必须把角色编号包成单元素集合后交给批量入口，并透出批量结果。 */
    @Test
    void singleRoleEntryDelegatesToBatchWithSingleton() {
        when(service.getRoleMenuListByRoleId(anyCollection())).thenReturn(Set.of(100L, 200L));

        assertThat(service.getRoleMenuListByRoleId(9L)).containsExactlyInAnyOrder(100L, 200L);

        ArgumentCaptor<Collection<Long>> captor = ArgumentCaptor.forClass(Collection.class);
        verify(service).getRoleMenuListByRoleId(captor.capture());
        assertThat(captor.getValue()).as("必须走批量入口并只带这一个角色编号").containsExactly(9L);
    }

    /** 角色编号为 null 时同样按单元素集合转发，由批量实现给出“角色不存在”的业务结论。 */
    @Test
    void singleRoleEntryPassesNullRoleIdUnchanged() {
        when(service.getRoleMenuListByRoleId(anyCollection())).thenReturn(Set.of());

        assertThat(service.getRoleMenuListByRoleId((Long) null)).isEmpty();

        ArgumentCaptor<Collection<Long>> captor = ArgumentCaptor.forClass(Collection.class);
        verify(service).getRoleMenuListByRoleId(captor.capture());
        assertThat(captor.getValue()).hasSize(1);
        assertThat(captor.getValue().iterator().next()).isNull();
    }

    /** 批量入口返回的集合必须原样透出，不得复制成新的可变集合或做二次过滤。 */
    @Test
    void singleRoleEntryReturnsBatchResultUnchanged() {
        List<Long> batchResult = List.of(300L);
        when(service.getRoleMenuListByRoleId(anyCollection())).thenReturn(Set.copyOf(batchResult));

        assertThat(service.getRoleMenuListByRoleId(11L)).isEqualTo(Set.copyOf(batchResult));
    }

}
