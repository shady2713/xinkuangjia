package com.basicframework.module.system.api.dept;

import com.basicframework.module.system.api.dept.dto.PostRespDTO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证岗位 API 默认方法 {@code getPostMap} 的行为契约。
 *
 * <p>消费方用该 Map 按岗位编号回填岗位名称。除了键的正确性，还必须锁定空编号集合的短路行为：
 * 空集合不发起查询，否则会产生一次无意义的全量/空条件查询。</p>
 *
 * <p>本用例只实现接口的抽象方法作为边界替身，被测的是接口自身提供的默认实现。</p>
 *
 * @author shady2713
 */
class PostApiTest {

    /** 记录调用参数的替身实现。 */
    private RecordingPostApi api;

    /** 为每个用例创建独立替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        api = new RecordingPostApi();
    }

    /** 岗位 Map 必须以岗位编号为键、岗位对象为值，并按传入编号批量查询。 */
    @Test
    void getPostMapKeysPostsByPostId() {
        api.posts = List.of(post(10L, "架构师"), post(20L, "测试工程师"));

        Map<Long, PostRespDTO> result = api.getPostMap(List.of(10L, 20L));

        assertThat(result).containsOnlyKeys(10L, 20L);
        assertThat(result.get(10L).getName()).isEqualTo("架构师");
        assertThat(api.lastQueriedIds).containsExactly(10L, 20L);
    }

    /** 空编号集合必须直接返回空 Map，不得发起查询。 */
    @Test
    void getPostMapShortCircuitsEmptyIds() {
        assertThat(api.getPostMap(List.of())).isEmpty();
        assertThat(api.lastQueriedIds).as("空集合不得触达下游查询").isNull();
    }

    /** null 编号集合与空集合同样处理，返回空 Map 而不是抛空指针。 */
    @Test
    void getPostMapShortCircuitsNullIds() {
        assertThat(api.getPostMap(null)).isEmpty();
        assertThat(api.lastQueriedIds).isNull();
    }

    /** 查询无结果时返回空 Map，调用方可以安全地按编号取值。 */
    @Test
    void getPostMapReturnsEmptyMapWhenNothingFound() {
        api.posts = List.of();

        assertThat(api.getPostMap(List.of(10L))).isEmpty();
    }

    /**
     * 构造指定编号与名称的岗位响应对象。
     *
     * @param id 岗位编号
     * @param name 岗位名称
     * @return 岗位响应对象
     */
    private static PostRespDTO post(Long id, String name) {
        PostRespDTO post = new PostRespDTO();
        post.setId(id);
        post.setName(name);
        return post;
    }

    /** 只记录批量查询参数的 API 替身。 */
    static class RecordingPostApi implements PostApi {

        /** 批量查询返回的岗位列表。 */
        private List<PostRespDTO> posts = List.of();
        /** 最近一次批量查询的编号集合；null 表示未发起查询。 */
        private List<Long> lastQueriedIds;

        /** 本用例不验证岗位校验。 */
        @Override
        public void validPostList(Collection<Long> ids) {
            throw new UnsupportedOperationException("本用例不验证岗位校验");
        }

        /** 记录查询编号并返回预设岗位列表。 */
        @Override
        public List<PostRespDTO> getPostList(Collection<Long> ids) {
            lastQueriedIds = new ArrayList<>(ids);
            return posts;
        }
    }

}
