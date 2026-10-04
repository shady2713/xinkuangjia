package com.basicframework.module.system.api.user;

import com.basicframework.module.system.api.user.dto.AdminUserRespDTO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 验证 Admin 用户 API 默认方法的行为契约。
 *
 * <p>两个默认方法都被跨模块消费方直接使用：{@code getUserMap} 为批量翻译用户信息提供
 * 按编号索引的结果，键错了会让列表显示成别人的昵称；{@code validateUser} 是单值入口，
 * 必须复用批量校验而不是另起一套判断，否则单值与批量校验会出现不同结论。</p>
 *
 * <p>本用例只实现接口的抽象方法作为边界替身，被测的是接口自身提供的默认实现。</p>
 *
 * @author shady2713
 */
class AdminUserApiTest {

    /** 记录调用参数的替身实现。 */
    private RecordingAdminUserApi api;

    /** 为每个用例创建独立替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        api = new RecordingAdminUserApi();
    }

    /** 用户 Map 必须以用户编号为键、用户对象为值，供调用方按编号回填。 */
    @Test
    void getUserMapKeysUsersByUserId() {
        api.users = List.of(user(1024L, "张三"), user(2048L, "李四"));

        Map<Long, AdminUserRespDTO> result = api.getUserMap(List.of(1024L, 2048L));

        assertThat(result).containsOnlyKeys(1024L, 2048L);
        assertThat(result.get(1024L).getNickname()).isEqualTo("张三");
        assertThat(result.get(2048L).getNickname()).isEqualTo("李四");
        assertThat(api.lastQueriedIds).as("查询必须按传入编号批量执行，不得逐个查询")
                .containsExactly(1024L, 2048L);
    }

    /** 查询结果为空时必须返回空 Map，而不是 null 或抛错，调用方可直接按编号取值。 */
    @Test
    void getUserMapReturnsEmptyMapWhenNoUserFound() {
        api.users = List.of();

        assertThat(api.getUserMap(List.of(1024L))).isEmpty();
    }

    /** 传入空编号集合时返回空 Map，且按原样批量转发，不按编号逐个查询。 */
    @Test
    void getUserMapReturnsEmptyMapWithoutQueryForEmptyIds() {
        assertThat(api.getUserMap(List.of())).isEmpty();
        assertThat(api.lastQueriedIds).as("空集合按原样转发，不得展开成逐个查询").isEmpty();
    }

    /** 单值校验必须复用批量校验入口，并以单元素集合传递编号，保证两条路径结论一致。 */
    @Test
    void validateUserDelegatesToBatchValidationWithSingleId() {
        api.validateUser(1024L);

        assertThat(api.lastValidatedIds).as("单值校验必须走批量入口").containsExactly(1024L);
    }

    /** 批量校验抛出的业务异常必须原样透出，调用方依赖错误码给出提示。 */
    @Test
    void validateUserPropagatesValidationFailure() {
        api.validationFailure = new IllegalStateException("synthetic-invalid-user");

        assertThatThrownBy(() -> api.validateUser(1024L)).isSameAs(api.validationFailure);
    }

    /** 单值校验传入 null 时必须原样传递，由批量校验给出“用户不存在”的业务结论。 */
    @Test
    void validateUserPassesNullIdToBatchValidation() {
        api.validateUser(null);

        assertThat(api.lastValidatedIds).hasSize(1);
        assertThat(api.lastValidatedIds.iterator().next()).isNull();
    }

    /**
     * 构造指定编号与昵称的用户响应对象。
     *
     * @param id 用户编号
     * @param nickname 用户昵称
     * @return 用户响应对象
     */
    private static AdminUserRespDTO user(Long id, String nickname) {
        AdminUserRespDTO user = new AdminUserRespDTO();
        user.setId(id);
        user.setNickname(nickname);
        return user;
    }

    /** 只记录调用参数的 API 替身，抽象方法不参与本用例验证。 */
    static class RecordingAdminUserApi implements AdminUserApi {

        /** 批量查询返回的固定用户列表。 */
        private List<AdminUserRespDTO> users = List.of();
        /** 最近一次批量查询的编号集合；null 表示未发起查询。 */
        private Collection<Long> lastQueriedIds;
        /** 最近一次批量校验的编号集合。 */
        private Collection<Long> lastValidatedIds;
        /** 批量校验要抛出的异常；null 表示校验通过。 */
        private RuntimeException validationFailure;

        /** 本用例不验证单值查询，返回 null。 */
        @Override
        public AdminUserRespDTO getUser(Long id) {
            return null;
        }

        /** 本用例不验证下属查询，返回空列表。 */
        @Override
        public List<AdminUserRespDTO> getUserListBySubordinate(Long id) {
            return List.of();
        }

        /** 记录查询编号并返回预设用户列表。 */
        @Override
        public List<AdminUserRespDTO> getUserList(Collection<Long> ids) {
            lastQueriedIds = new ArrayList<>(ids);
            return users;
        }

        /** 本用例不验证部门查询，返回空列表。 */
        @Override
        public List<AdminUserRespDTO> getUserListByDeptIds(Collection<Long> deptIds) {
            return List.of();
        }

        /** 本用例不验证岗位查询，返回空列表。 */
        @Override
        public List<AdminUserRespDTO> getUserListByPostIds(Collection<Long> postIds) {
            return List.of();
        }

        /** 记录校验编号，并按预设抛出业务异常。 */
        @Override
        public void validateUserList(Collection<Long> ids) {
            lastValidatedIds = new ArrayList<>(ids);
            if (validationFailure != null) {
                throw validationFailure;
            }
        }
    }
}
