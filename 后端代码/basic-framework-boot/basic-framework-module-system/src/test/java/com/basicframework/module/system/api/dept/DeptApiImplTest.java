package com.basicframework.module.system.api.dept;

import com.basicframework.module.system.api.dept.dto.DeptRespDTO;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import com.basicframework.module.system.service.dept.DeptService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证部门跨模块 API 的模型转换与校验委派契约。
 *
 * <p>该实现是其它模块读取部门信息的唯一入口，跨模块契约要求返回稳定 DTO 而不是 DO。
 * 用例锁定：单条与批量查询把 DO 字段完整映射为 DTO；部门不存在时返回 null 而不是抛异常
 * （调用方按“无此部门”处理）；校验入口必须把待校验编号原样交给 Service 并由其决定拒绝方式，
 * 失败必须原样抛出，不能吞掉导致调用方误以为关联合法。</p>
 *
 * @author shady2713
 */
class DeptApiImplTest {

    /** 被测 API 实现。 */
    private final DeptApiImpl deptApi = new DeptApiImpl();

    /** 部门服务替身。 */
    private final DeptService deptService = mock(DeptService.class);

    /** 单条查询把部门字段映射为 DTO，不返回持久化对象。 */
    @Test
    void getDeptMapsPersistentObjectToDto() {
        ReflectionTestUtils.setField(deptApi, "deptService", deptService);
        when(deptService.getDept(7L)).thenReturn(dept(7L, "研发部", 0L, 3L));

        DeptRespDTO result = deptApi.getDept(7L);

        assertThat(result).isNotNull();
        assertThat(result.getId()).isEqualTo(7L);
        assertThat(result.getName()).isEqualTo("研发部");
        assertThat(result.getParentId()).isEqualTo(0L);
        assertThat(result.getLeaderUserId()).isEqualTo(3L);
        assertThat(result.getStatus()).isEqualTo(0);
    }

    /** 部门不存在时返回 null，调用方据此按“无此部门”处理。 */
    @Test
    void getDeptReturnsNullWhenAbsent() {
        ReflectionTestUtils.setField(deptApi, "deptService", deptService);
        when(deptService.getDept(99L)).thenReturn(null);

        assertThat(deptApi.getDept(99L)).isNull();
    }

    /** 批量查询保持入参顺序并逐个映射为 DTO。 */
    @Test
    void getDeptListKeepsOrderAndMapsEveryElement() {
        ReflectionTestUtils.setField(deptApi, "deptService", deptService);
        when(deptService.getDeptList(List.of(2L, 1L)))
                .thenReturn(List.of(dept(2L, "财务部", 0L, null), dept(1L, "研发部", 0L, null)));

        List<DeptRespDTO> result = deptApi.getDeptList(List.of(2L, 1L));

        assertThat(result).extracting(DeptRespDTO::getName).containsExactly("财务部", "研发部");
        verify(deptService).getDeptList(List.of(2L, 1L));
    }

    /** 批量查询为空时返回空列表，不返回 null。 */
    @Test
    void getDeptListReturnsEmptyListForEmptyInput() {
        ReflectionTestUtils.setField(deptApi, "deptService", deptService);
        when(deptService.getDeptList(List.of())).thenReturn(List.of());

        assertThat(deptApi.getDeptList(List.of())).isEmpty();
    }

    /** 校验入口把编号原样交给 Service；Service 拒绝时异常必须原样抛出。 */
    @Test
    void validateDeptListDelegatesAndPropagatesFailure() {
        ReflectionTestUtils.setField(deptApi, "deptService", deptService);
        List<Long> ids = List.of(1L, 2L);
        deptApi.validateDeptList(ids);
        verify(deptService).validateDeptList(ids);

        IllegalStateException failure = new IllegalStateException("部门不存在");
        doThrow(failure).when(deptService).validateDeptList(List.of(404L));
        assertThatThrownBy(() -> deptApi.validateDeptList(List.of(404L))).isSameAs(failure);
    }

    /** 子部门查询把 DO 列表映射为 DTO 列表，保持服务返回顺序。 */
    @Test
    void getChildDeptListMapsEveryElement() {
        ReflectionTestUtils.setField(deptApi, "deptService", deptService);
        when(deptService.getChildDeptList(1L))
                .thenReturn(List.of(dept(3L, "前端组", 1L, null), dept(4L, "后端组", 1L, null)));

        List<DeptRespDTO> result = deptApi.getChildDeptList(1L);

        assertThat(result).extracting(DeptRespDTO::getName).containsExactly("前端组", "后端组");
        verify(deptService).getChildDeptList(1L);
    }

    /**
     * 构造部门记录。
     *
     * @param id 部门编号
     * @param name 部门名称
     * @param parentId 父部门编号
     * @param leaderUserId 负责人编号，可为 null
     * @return 部门记录
     */
    private static DeptDO dept(Long id, String name, Long parentId, Long leaderUserId) {
        DeptDO dept = new DeptDO();
        dept.setId(id);
        dept.setName(name);
        dept.setParentId(parentId);
        dept.setLeaderUserId(leaderUserId);
        dept.setStatus(0);
        return dept;
    }

}
