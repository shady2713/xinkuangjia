package com.basicframework.module.system.service.dept;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.exception.ErrorCode;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.controller.admin.dept.vo.post.PostPageReqVO;
import com.basicframework.module.system.controller.admin.dept.vo.post.PostSaveReqVO;
import com.basicframework.module.system.dal.dataobject.dept.PostDO;
import com.basicframework.module.system.dal.dataobject.dept.UserPostDO;
import com.basicframework.module.system.dal.mysql.dept.PostMapper;
import com.basicframework.module.system.dal.mysql.dept.UserPostMapper;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证岗位服务的唯一性校验、禁用保护、批量查询与批量校验契约。
 *
 * <p>岗位是用户归属与数据范围的组成部分：名称与编码必须唯一，否则前端下拉无法区分岗位；
 * 禁用已被用户引用的岗位必须被拦住，否则在职用户会失去岗位归属；批量查询与批量校验必须
 * 区分"编号为空"与"编号不存在"，把空集合当成错误会让空表单无法提交。</p>
 *
 * <p>持久层按进程外边界替换为替身，服务内的校验与异常逻辑真实执行，异常断言逐条核对
 * 真实业务错误码。</p>
 *
 * @author shady2713
 */
class PostServiceImplTest {

    /** 被测服务。 */
    private PostServiceImpl postService;
    /** 岗位持久层替身。 */
    private PostMapper postMapper;
    /** 用户岗位关联持久层替身。 */
    private UserPostMapper userPostMapper;

    /** 装配服务与替身。 */
    @BeforeEach
    void setUp() {
        postService = new PostServiceImpl();
        postMapper = mock(PostMapper.class);
        userPostMapper = mock(UserPostMapper.class);
        ReflectionTestUtils.setField(postService, "postMapper", postMapper);
        ReflectionTestUtils.setField(postService, "userPostMapper", userPostMapper);
    }

    /** 创建岗位必须校验名称与编码唯一后落库，并返回新编号。 */
    @Test
    void createPostValidatesUniquenessAndReturnsId() {
        PostSaveReqVO reqVO = new PostSaveReqVO();
        reqVO.setName("DUMMY-岗位");
        reqVO.setCode("DUMMY_CODE");
        when(postMapper.selectByName("DUMMY-岗位")).thenReturn(null);
        when(postMapper.selectByCode("DUMMY_CODE")).thenReturn(null);

        postService.createPost(reqVO);

        ArgumentCaptor<PostDO> captor = ArgumentCaptor.forClass(PostDO.class);
        verify(postMapper).insert(captor.capture());
        assertThat(captor.getValue().getName()).isEqualTo("DUMMY-岗位");
        assertThat(captor.getValue().getCode()).isEqualTo("DUMMY_CODE");
    }

    /** 创建岗位遇到同名或同编码时必须拒绝，且不得落库。 */
    @Test
    void createPostRejectsDuplicateNameAndCode() {
        PostSaveReqVO duplicateName = new PostSaveReqVO();
        duplicateName.setName("DUMMY-岗位");
        duplicateName.setCode("DUMMY_CODE");
        when(postMapper.selectByName("DUMMY-岗位")).thenReturn(post(1L, "DUMMY-岗位", "OTHER_CODE"));
        assertBusinessError(() -> postService.createPost(duplicateName), ErrorCodeConstants.POST_NAME_DUPLICATE);

        PostSaveReqVO duplicateCode = new PostSaveReqVO();
        duplicateCode.setName("DUMMY-其它岗位");
        duplicateCode.setCode("DUMMY_CODE");
        when(postMapper.selectByName("DUMMY-其它岗位")).thenReturn(null);
        when(postMapper.selectByCode("DUMMY_CODE")).thenReturn(post(1L, "OTHER_NAME", "DUMMY_CODE"));
        assertBusinessError(() -> postService.createPost(duplicateCode), ErrorCodeConstants.POST_CODE_DUPLICATE);

        verify(postMapper, never()).insert(any(PostDO.class));
    }

    /** 更新岗位保持自身名称与编码时不得判为重复。 */
    @Test
    void updatePostAllowsKeepingOwnNameAndCode() {
        PostSaveReqVO reqVO = new PostSaveReqVO();
        reqVO.setId(1L);
        reqVO.setName("DUMMY-岗位");
        reqVO.setCode("DUMMY_CODE");
        reqVO.setStatus(CommonStatusEnum.ENABLE.getStatus());
        when(postMapper.selectById(1L)).thenReturn(post(1L, "DUMMY-岗位", "DUMMY_CODE"));
        when(postMapper.selectByName("DUMMY-岗位")).thenReturn(post(1L, "DUMMY-岗位", "DUMMY_CODE"));
        when(postMapper.selectByCode("DUMMY_CODE")).thenReturn(post(1L, "DUMMY-岗位", "DUMMY_CODE"));

        postService.updatePost(reqVO);

        ArgumentCaptor<PostDO> captor = ArgumentCaptor.forClass(PostDO.class);
        verify(postMapper).updateById(captor.capture());
        assertThat(captor.getValue().getId()).isEqualTo(1L);
    }

    /** 把启用岗位改成禁用且已有用户引用时必须拒绝更新。 */
    @Test
    void updatePostRejectsDisablingReferencedPost() {
        PostSaveReqVO reqVO = new PostSaveReqVO();
        reqVO.setId(1L);
        reqVO.setName("DUMMY-岗位");
        reqVO.setCode("DUMMY_CODE");
        reqVO.setStatus(CommonStatusEnum.DISABLE.getStatus());
        when(postMapper.selectById(1L)).thenReturn(post(1L, "DUMMY-岗位", "DUMMY_CODE"));
        when(postMapper.selectByName("DUMMY-岗位")).thenReturn(null);
        when(postMapper.selectByCode("DUMMY_CODE")).thenReturn(null);
        when(userPostMapper.selectListByPostIds(Collections.singletonList(1L))).thenReturn(List.of());

        postService.updatePost(reqVO);
        verify(postMapper).updateById(any(PostDO.class));

        when(userPostMapper.selectListByPostIds(Collections.singletonList(1L)))
                .thenReturn(List.of(new UserPostDO()));
        assertBusinessError(() -> postService.updatePost(reqVO), ErrorCodeConstants.POST_IS_REFERENCED);
    }

    /** 岗位名称或编码被其它岗位占用时必须拒绝更新，避免两个岗位同名同码。 */
    @Test
    void updatePostRejectsNameAndCodeOwnedByAnotherPost() {
        PostSaveReqVO reqVO = new PostSaveReqVO();
        reqVO.setId(1L);
        reqVO.setName("DUMMY-岗位");
        reqVO.setCode("DUMMY_CODE");
        reqVO.setStatus(CommonStatusEnum.ENABLE.getStatus());
        when(postMapper.selectById(1L)).thenReturn(post(1L, "DUMMY-旧名", "DUMMY_OLD_CODE"));

        when(postMapper.selectByName("DUMMY-岗位")).thenReturn(post(2L, "DUMMY-岗位", "OTHER_CODE"));
        assertBusinessError(() -> postService.updatePost(reqVO), ErrorCodeConstants.POST_NAME_DUPLICATE);

        when(postMapper.selectByName("DUMMY-岗位")).thenReturn(null);
        when(postMapper.selectByCode("DUMMY_CODE")).thenReturn(post(2L, "OTHER_NAME", "DUMMY_CODE"));
        assertBusinessError(() -> postService.updatePost(reqVO), ErrorCodeConstants.POST_CODE_DUPLICATE);

        verify(postMapper, never()).updateById(any(PostDO.class));
    }

    /** 更新不存在的岗位必须拒绝，且不得写库。 */
    @Test
    void updatePostRejectsAbsentPost() {
        PostSaveReqVO reqVO = new PostSaveReqVO();
        reqVO.setId(9L);
        reqVO.setName("DUMMY-岗位");
        reqVO.setCode("DUMMY_CODE");
        when(postMapper.selectById(9L)).thenReturn(null);

        assertBusinessError(() -> postService.updatePost(reqVO), ErrorCodeConstants.POST_NOT_FOUND);
        verify(postMapper, never()).updateById(any(PostDO.class));
    }

    /** 删除岗位必须校验存在性；批量删除直接按编号删除。 */
    @Test
    void deletePostValidatesExistenceAndDeleteListDelegates() {
        when(postMapper.selectById(1L)).thenReturn(post(1L, "DUMMY-岗位", "DUMMY_CODE"));
        postService.deletePost(1L);
        verify(postMapper).deleteById(1L);

        when(postMapper.selectById(9L)).thenReturn(null);
        assertBusinessError(() -> postService.deletePost(9L), ErrorCodeConstants.POST_NOT_FOUND);

        postService.deletePostList(List.of(1L, 2L));
        verify(postMapper).deleteByIds(List.of(1L, 2L));
    }

    /** 批量查询对空集合直接返回空列表，非空时按编号查询。 */
    @Test
    void getPostListShortCircuitsEmptyIds() {
        assertThat(postService.getPostList(Collections.emptyList())).isEmpty();
        verify(postMapper, never()).selectByIds(anyCollection());

        when(postMapper.selectByIds(List.of(1L))).thenReturn(List.of(post(1L, "DUMMY-岗位", "DUMMY_CODE")));
        assertThat(postService.getPostList(List.of(1L))).hasSize(1);
    }

    /** 按状态查询与分页查询必须原样转发到持久层。 */
    @Test
    void getPostListByStatusAndPageDelegate() {
        when(postMapper.selectList(List.of(1L), List.of(CommonStatusEnum.ENABLE.getStatus())))
                .thenReturn(List.of(post(1L, "DUMMY-岗位", "DUMMY_CODE")));
        assertThat(postService.getPostList(List.of(1L), List.of(CommonStatusEnum.ENABLE.getStatus()))).hasSize(1);

        PostPageReqVO reqVO = new PostPageReqVO();
        when(postMapper.selectPage(reqVO)).thenReturn(new PageResult<>(List.of(post(1L, "DUMMY-岗位", "DUMMY_CODE")), 1L));
        assertThat(postService.getPostPage(reqVO).getTotal()).isEqualTo(1L);
    }

    /** 按编号查询岗位必须原样返回持久层结果。 */
    @Test
    void getPostDelegatesToMapper() {
        when(postMapper.selectById(1L)).thenReturn(post(1L, "DUMMY-岗位", "DUMMY_CODE"));

        assertThat(postService.getPost(1L).getName()).isEqualTo("DUMMY-岗位");
    }

    /** 批量校验必须跳过空集合，并对不存在与已禁用岗位给出各自的业务错误。 */
    @Test
    void validatePostListRejectsAbsentAndDisabledPosts() {
        postService.validatePostList(Collections.emptyList());
        verify(postMapper, never()).selectByIds(anyCollection());

        when(postMapper.selectByIds(List.of(1L, 2L)))
                .thenReturn(List.of(post(1L, "DUMMY-岗位", "DUMMY_CODE")));
        assertBusinessError(() -> postService.validatePostList(List.of(1L, 2L)), ErrorCodeConstants.POST_NOT_FOUND);

        PostDO disabled = post(1L, "DUMMY-禁用岗位", "DUMMY_CODE");
        disabled.setStatus(CommonStatusEnum.DISABLE.getStatus());
        when(postMapper.selectByIds(List.of(1L))).thenReturn(List.of(disabled));
        assertBusinessError(() -> postService.validatePostList(List.of(1L)), ErrorCodeConstants.POST_NOT_ENABLE);
    }

    /** 批量校验通过时必须正常返回，不得因为存在性校验而误报错误。 */
    @Test
    void validatePostListAcceptsEnabledPosts() {
        when(postMapper.selectByIds(List.of(1L, 2L))).thenReturn(List.of(
                post(1L, "DUMMY-岗位1", "DUMMY_CODE_1"), post(2L, "DUMMY-岗位2", "DUMMY_CODE_2")));

        postService.validatePostList(List.of(1L, 2L));

        verify(postMapper).selectByIds(List.of(1L, 2L));
    }

    /**
     * 断言业务异常的错误码。
     *
     * @param action 触发业务校验的动作
     * @param expected 期望的业务错误码
     */
    private static void assertBusinessError(ThrowingCallable action, ErrorCode expected) {
        assertThatThrownBy(action).isInstanceOfSatisfying(ServiceException.class,
                exception -> assertThat(exception.getCode()).isEqualTo(expected.getCode()));
    }

    /** 构造岗位持久对象。 */
    private static PostDO post(Long id, String name, String code) {
        PostDO post = new PostDO();
        post.setId(id);
        post.setName(name);
        post.setCode(code);
        post.setStatus(CommonStatusEnum.ENABLE.getStatus());
        return post;
    }

}
