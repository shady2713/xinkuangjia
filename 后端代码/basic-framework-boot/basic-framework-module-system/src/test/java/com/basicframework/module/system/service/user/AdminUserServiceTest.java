package com.basicframework.module.system.service.user;

import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Collection;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.CALLS_REAL_METHODS;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证 {@link AdminUserService#getUserMap(Collection)} 的批量索引契约。
 *
 * <p>该默认方法供跨模块批量回填用户信息使用：键错了会把数据挂到别人身上，
 * 空编号集合若仍发起查询会产生无意义的全量条件查询。因此这里用真实默认实现，
 * 只替身批量查询抽象方法并观察它收到的编号。</p>
 *
 * @author shady2713
 */
class AdminUserServiceTest {

    /** 被测服务：默认方法调用真实实现，未打桩的抽象方法使用替身。 */
    private final AdminUserService adminUserService = mock(AdminUserService.class, CALLS_REAL_METHODS);

    /** 用户 Map 必须以用户编号为键、用户对象为值，并按传入编号批量查询。 */
    @Test
    void getUserMapKeysUsersByUserId() {
        when(adminUserService.getUserList(anyCollection()))
                .thenReturn(List.of(user(1024L, "张三"), user(2048L, "李四")));

        Map<Long, AdminUserDO> result = adminUserService.getUserMap(List.of(1024L, 2048L));

        assertThat(result).containsOnlyKeys(1024L, 2048L);
        assertThat(result.get(1024L).getNickname()).isEqualTo("张三");
        assertThat(result.get(2048L).getNickname()).isEqualTo("李四");

        ArgumentCaptor<Collection<Long>> captor = ArgumentCaptor.forClass(Collection.class);
        verify(adminUserService).getUserList(captor.capture());
        assertThat(captor.getValue()).as("必须整体批量查询，不得逐个查询").containsExactly(1024L, 2048L);
    }

    /** 空编号集合必须直接返回空 Map，不得触达批量查询。 */
    @Test
    void getUserMapShortCircuitsEmptyIds() {
        assertThat(adminUserService.getUserMap(List.of())).isEmpty();

        verify(adminUserService, never()).getUserList(anyCollection());
    }

    /** null 编号集合与空集合同样处理，返回可写的空 Map 而不是抛空指针。 */
    @Test
    void getUserMapShortCircuitsNullIds() {
        assertThat(adminUserService.getUserMap(null)).isEmpty();

        verify(adminUserService, never()).getUserList(anyCollection());
    }

    /** 查询无结果时返回空 Map，调用方可以安全地按编号取值。 */
    @Test
    void getUserMapReturnsEmptyMapWhenNoUserFound() {
        when(adminUserService.getUserList(anyCollection())).thenReturn(List.of());

        assertThat(adminUserService.getUserMap(List.of(1024L))).isEmpty();
    }

    /**
     * 构造指定编号与昵称的用户对象。
     *
     * @param id 用户编号
     * @param nickname 用户昵称
     * @return 用户对象
     */
    private static AdminUserDO user(Long id, String nickname) {
        AdminUserDO user = new AdminUserDO();
        user.setId(id);
        user.setNickname(nickname);
        return user;
    }

}
