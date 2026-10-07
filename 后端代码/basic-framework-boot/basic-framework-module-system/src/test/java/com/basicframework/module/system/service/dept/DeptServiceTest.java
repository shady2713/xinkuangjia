package com.basicframework.module.system.service.dept;

import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Collection;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.CALLS_REAL_METHODS;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证部门服务默认方法把单编号包装成集合后委派的契约。
 *
 * <p>{@link DeptService#getChildDeptList(Long)} 是"查某个部门的子树"这条最常用入口，
 * 它把单个编号包成只含该编号的集合，再委派给集合版本。包装这一步本身就是契约：委派参数若退化成
 * 空集合，子树查询会静默返回空结果，调用方会误判该部门没有任何下级；参数里若混入别的编号，
 * 数据权限就会拿到不属于当前部门的子树。因此这里锁定委派参数、返回结果和失败传播三件事。</p>
 *
 * <p><b>白盒直调：</b>被测方法是接口上的默认方法，用 {@code CALLS_REAL_METHODS} 执行真实实现，
 * 只把集合版本替换为替身，避免触达数据库与缓存。</p>
 *
 * @author shady2713
 */
class DeptServiceTest {

    /** 被测服务：默认方法执行真实实现，集合版本由替身提供。 */
    private final DeptService deptService = mock(DeptService.class, CALLS_REAL_METHODS);

    /**
     * 单编号入口必须只委派被点名的那一个编号，并原样返回集合版本的结果。
     */
    @Test
    void getChildDeptListWrapsSingleIdAndReturnsResult() {
        DeptDO child = new DeptDO();
        child.setId(103L);
        child.setName("运营部");
        when(deptService.getChildDeptList(anyCollection())).thenReturn(List.of(child));

        List<DeptDO> result = deptService.getChildDeptList(100L);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<Long>> captor = ArgumentCaptor.forClass(Collection.class);
        verify(deptService).getChildDeptList(captor.capture());
        assertThat(captor.getValue()).as("只能查询被点名部门的子树，不得混入其它编号")
                .containsExactly(100L);
        assertThat(result).as("单编号入口必须原样返回集合版本的结果").containsExactly(child);
    }

    /**
     * 子树查询失败必须原样传播，不得降级成空列表掩盖数据问题。
     */
    @Test
    void getChildDeptListPropagatesLookupFailure() {
        when(deptService.getChildDeptList(anyCollection()))
                .thenThrow(new IllegalStateException("synthetic-dept-lookup-failure"));

        assertThatThrownBy(() -> deptService.getChildDeptList(100L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("synthetic-dept-lookup-failure");

        verify(deptService).getChildDeptList(Set.of(100L));
    }

}