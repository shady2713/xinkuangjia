package com.basicframework.module.system.api.dept;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.module.system.api.dept.dto.PostRespDTO;
import com.basicframework.module.system.dal.dataobject.dept.PostDO;
import com.basicframework.module.system.service.dept.PostService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证岗位跨模块 API 实现类的转发与对象转换契约。
 *
 * <p>与接口默认方法 {@code getPostMap} 不同，本类是要点：校验入口必须把编号集合与失败
 * 原样交给下游（吞掉异常会把无效岗位写进关联表），查询入口必须把持久化对象真实转换为
 * 跨模块 DTO（字段漏转会让消费方拿到空的岗位名称）。因此转换结果按字段逐一断言，
 * 而不是只断言列表长度。</p>
 *
 * @author shady2713
 */
class PostApiImplTest {

    /** 被测 API 实现。 */
    private PostApiImpl postApi;
    /** 下游岗位服务替身，用于观察真实转发参数。 */
    private PostService postService;

    /** 为每个用例创建独立 API 与下游替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        postApi = new PostApiImpl();
        postService = mock(PostService.class);
        ReflectionTestUtils.setField(postApi, "postService", postService);
    }

    /** 岗位校验必须原样转发编号集合。 */
    @Test
    void validPostListForwardsSameCollection() {
        List<Long> ids = List.of(1L, 2L);

        postApi.validPostList(ids);

        verify(postService).validatePostList(ids);
        verifyNoMoreInteractions(postService);
    }

    /** 岗位校验失败必须原样传播，避免无效岗位被写入关联关系。 */
    @Test
    void validPostListPropagatesFailureUnchanged() {
        List<Long> ids = List.of(99L);
        IllegalArgumentException failure = new IllegalArgumentException("synthetic-invalid-post");
        doThrow(failure).when(postService).validatePostList(ids);

        assertThatThrownBy(() -> postApi.validPostList(ids)).isSameAs(failure);
    }

    /**
     * 岗位查询必须按编号批量转发，并把持久化对象的字段完整转换到跨模块 DTO。
     *
     * <p>消费方用返回的 DTO 回填用户列表中的岗位名称与状态，字段漏转会让界面显示空岗位。</p>
     */
    @Test
    void getPostListMapsPersistenceObjectToResponseDto() {
        List<Long> ids = List.of(1L, 2L);
        when(postService.getPostList(ids)).thenReturn(List.of(
                post(1L, "架构师", "architect", 1, CommonStatusEnum.ENABLE.getStatus()),
                post(2L, "测试工程师", "tester", 2, CommonStatusEnum.DISABLE.getStatus())));

        List<PostRespDTO> result = postApi.getPostList(ids);

        assertThat(result).hasSize(2);
        assertThat(result.get(0).getId()).isEqualTo(1L);
        assertThat(result.get(0).getName()).isEqualTo("架构师");
        assertThat(result.get(0).getCode()).isEqualTo("architect");
        assertThat(result.get(0).getSort()).isEqualTo(1);
        assertThat(result.get(0).getStatus()).isEqualTo(CommonStatusEnum.ENABLE.getStatus());
        assertThat(result.get(1).getId()).as("顺序必须与下游返回一致").isEqualTo(2L);
        assertThat(result.get(1).getName()).isEqualTo("测试工程师");
        assertThat(result.get(1).getStatus()).isEqualTo(CommonStatusEnum.DISABLE.getStatus());

        verify(postService).getPostList(ids);
        verifyNoMoreInteractions(postService);
    }

    /** 下游返回空列表时结果必须是空列表，调用方无需判空。 */
    @Test
    void getPostListReturnsEmptyListWhenNothingFound() {
        List<Long> ids = List.of(404L);
        when(postService.getPostList(ids)).thenReturn(List.of());

        assertThat(postApi.getPostList(ids)).isEmpty();

        verify(postService).getPostList(ids);
    }

    /**
     * 下游返回 null 时结果保持 null，不得凭空构造空列表掩盖数据缺失。
     *
     * <p>转换工具对 null 列表返回 null，属既有语义；改成空列表会让调用方无法区分
     * "没有岗位"与"下游未返回数据"。</p>
     */
    @Test
    void getPostListKeepsNullWhenDownstreamReturnsNull() {
        List<Long> ids = List.of(404L);
        when(postService.getPostList(ids)).thenReturn(null);

        assertThat(postApi.getPostList(ids)).isNull();

        verify(postService).getPostList(ids);
    }

    /** 未传编号时按 null 原样转发，由下游决定是否查询全部。 */
    @Test
    void getPostListForwardsNullIds() {
        when(postService.getPostList(null)).thenReturn(List.of());

        assertThat(postApi.getPostList(null)).isEmpty();

        verify(postService).getPostList(null);
    }

    /**
     * 构造指定字段的岗位持久化对象。
     *
     * @param id 岗位编号
     * @param name 岗位名称
     * @param code 岗位编码
     * @param sort 排序值
     * @param status 状态值
     * @return 岗位持久化对象
     */
    private static PostDO post(Long id, String name, String code, Integer sort, Integer status) {
        PostDO post = new PostDO();
        post.setId(id);
        post.setName(name);
        post.setCode(code);
        post.setSort(sort);
        post.setStatus(status);
        return post;
    }
}
