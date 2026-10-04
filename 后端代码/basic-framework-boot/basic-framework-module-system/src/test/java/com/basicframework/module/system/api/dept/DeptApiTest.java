package com.basicframework.module.system.api.dept;

import com.basicframework.module.system.api.dept.dto.DeptRespDTO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证部门 API 默认方法 {@code getDeptMap} 的行为契约。
 *
 * <p>跨模块消费方用该 Map 按部门编号回填部门名称与负责人，键错了会把数据挂到别的部门上；
 * 因此这里锁定：键必须是部门编号、批量查询必须整体转发而不是逐个查询、结果为空时返回空 Map。</p>
 *
 * <p>本用例只实现接口的抽象方法作为边界替身，被测的是接口自身提供的默认实现。</p>
 *
 * @author shady2713
 */
class DeptApiTest {

    /** 记录调用参数的替身实现。 */
    private RecordingDeptApi api;

    /** 为每个用例创建独立替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        api = new RecordingDeptApi();
    }

    /** 部门 Map 必须以部门编号为键、部门对象为值，并保持批量查询。 */
    @Test
    void getDeptMapKeysDeptsByDeptId() {
        api.depts = List.of(dept(100L, "研发部"), dept(200L, "财务部"));

        Map<Long, DeptRespDTO> result = api.getDeptMap(List.of(100L, 200L));

        assertThat(result).containsOnlyKeys(100L, 200L);
        assertThat(result.get(100L).getName()).isEqualTo("研发部");
        assertThat(result.get(200L).getName()).isEqualTo("财务部");
        assertThat(api.lastQueriedIds).as("必须按传入编号批量查询，不得逐个查询")
                .containsExactly(100L, 200L);
    }

    /** 查询无结果时返回空 Map，调用方可以安全地按编号取值。 */
    @Test
    void getDeptMapReturnsEmptyMapWhenNothingFound() {
        api.depts = List.of();

        assertThat(api.getDeptMap(List.of(100L))).isEmpty();
    }

    /** 空编号集合按原样转发，不展开成逐个查询，也不返回 null。 */
    @Test
    void getDeptMapForwardsEmptyIdsUnchanged() {
        assertThat(api.getDeptMap(List.of())).isEmpty();
        assertThat(api.lastQueriedIds).isEmpty();
    }

    /**
     * 构造指定编号与名称的部门响应对象。
     *
     * @param id 部门编号
     * @param name 部门名称
     * @return 部门响应对象
     */
    private static DeptRespDTO dept(Long id, String name) {
        DeptRespDTO dept = new DeptRespDTO();
        dept.setId(id);
        dept.setName(name);
        return dept;
    }

    /** 只记录批量查询参数的 API 替身，其余抽象方法不参与本用例验证。 */
    static class RecordingDeptApi implements DeptApi {

        /** 批量查询返回的部门列表。 */
        private List<DeptRespDTO> depts = List.of();
        /** 最近一次批量查询的编号集合。 */
        private List<Long> lastQueriedIds;

        /** 本用例不验证单值查询，返回 null。 */
        @Override
        public DeptRespDTO getDept(Long id) {
            return null;
        }

        /** 记录查询编号并返回预设部门列表。 */
        @Override
        public List<DeptRespDTO> getDeptList(Collection<Long> ids) {
            lastQueriedIds = new ArrayList<>(ids);
            return depts;
        }

        /** 本用例不验证部门校验。 */
        @Override
        public void validateDeptList(Collection<Long> ids) {
            throw new UnsupportedOperationException("本用例不验证部门校验");
        }

        /** 本用例不验证子部门查询，返回空列表。 */
        @Override
        public List<DeptRespDTO> getChildDeptList(Long id) {
            return List.of();
        }
    }

}
