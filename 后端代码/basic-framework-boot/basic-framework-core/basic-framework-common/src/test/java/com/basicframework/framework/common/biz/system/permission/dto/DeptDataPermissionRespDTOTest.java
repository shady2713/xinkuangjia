package com.basicframework.framework.common.biz.system.permission.dto;

import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证部门数据权限响应 DTO 的默认值与可写契约。
 *
 * <p>该 DTO 由权限服务按角色数据范围逐步放宽：先构造默认值，再按角色叠加 ALL 或部门编号。
 * 因此默认值必须是“拒绝”而不是“放行”——若默认 {@code all=true}，任何未命中角色的分支
 * 都会退化成全量可见；同时 {@code deptIds} 必须是非 null 的空集合，否则调用方的
 * {@code addAll} 会直接空指针，权限计算整体失败。</p>
 *
 * @author shady2713
 */
class DeptDataPermissionRespDTOTest {

    /**
     * 新建 DTO 必须默认拒绝全部数据，且部门集合可立即累加。
     *
     * <p>集合只断言非 null 与为空：调用方依赖它可直接写入，具体实现类型不属于对外契约。</p>
     */
    @Test
    void defaultConstructorDeniesAccessAndProvidesWritableDeptIds() {
        DeptDataPermissionRespDTO result = new DeptDataPermissionRespDTO();

        assertThat(result.getAll()).as("默认不得放行全部数据").isFalse();
        assertThat(result.getSelf()).as("默认不得放行本人数据，须由权限服务显式放开").isFalse();
        assertThat(result.getDeptIds()).as("部门集合必须非 null，否则调用方累加时空指针").isNotNull().isEmpty();
    }

    /** 默认部门集合必须可写，权限服务按角色累加部门编号后能被读取。 */
    @Test
    void deptIdsAccumulatesAssignedDepartments() {
        DeptDataPermissionRespDTO result = new DeptDataPermissionRespDTO();

        result.getDeptIds().addAll(Set.of(1024L, 2048L));

        assertThat(result.getDeptIds()).containsExactlyInAnyOrder(1024L, 2048L);
    }

    /** 各权限标记必须按设置值原样读回，供数据权限规则拼接查询条件。 */
    @Test
    void accessFlagsReflectAssignedValues() {
        DeptDataPermissionRespDTO result = new DeptDataPermissionRespDTO();

        result.setAll(true);
        result.setSelf(true);

        assertThat(result.getAll()).isTrue();
        assertThat(result.getSelf()).isTrue();
    }

    /** 相等性按字段值判定，便于缓存与断言比较，不受集合实现类型影响。 */
    @Test
    void equalityIsBasedOnFieldValues() {
        DeptDataPermissionRespDTO first = new DeptDataPermissionRespDTO();
        first.setAll(true);
        first.getDeptIds().add(1024L);
        DeptDataPermissionRespDTO second = new DeptDataPermissionRespDTO();
        second.setAll(true);
        second.getDeptIds().add(1024L);

        assertThat(first).isEqualTo(second).hasSameHashCodeAs(second);
        second.setSelf(true);
        assertThat(first).as("任一权限标记不同即不相等").isNotEqualTo(second);
    }
}
