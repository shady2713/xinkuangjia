package com.basicframework.module.system.service.dept;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.controller.admin.dept.vo.post.PostPageReqVO;
import com.basicframework.module.system.controller.admin.dept.vo.post.PostSaveReqVO;
import com.basicframework.module.system.dal.dataobject.dept.PostDO;
import org.springframework.lang.Nullable;

import java.util.Collection;
import java.util.List;

/**
 * 岗位服务接口。
 * <p>
 * 提供岗位的增删改查与校验能力。
 *
 * @author 李杰
 */
public interface PostService {

    /**
     * 创建岗位。
     *
     * @param createReqVO 岗位信息
     * @return 岗位编号
     */
    Long createPost(PostSaveReqVO createReqVO);

    /**
     * 修改岗位。
     *
     * @param updateReqVO 岗位信息
     */
    void updatePost(PostSaveReqVO updateReqVO);

    /**
     * 删除岗位。
     *
     * @param id 岗位编号
     */
    void deletePost(Long id);

    /**
     * 批量删除岗位。
     *
     * @param ids 岗位编号列表
     */
    void deletePostList(List<Long> ids);

    /**
     * 批量查询岗位。
     *
     * @param ids 岗位编号列表
     * @return 岗位列表
     */
    List<PostDO> getPostList(@Nullable Collection<Long> ids);

    /**
     * 按条件查询岗位。
     *
     * @param ids      岗位编号列表，可为空
     * @param statuses 状态列表，可为空
     * @return 岗位列表
     */
    List<PostDO> getPostList(@Nullable Collection<Long> ids,
                             @Nullable Collection<Integer> statuses);

    /**
     * 分页查询岗位。
     *
     * @param reqVO 分页请求
     * @return 岗位分页结果
     */
    PageResult<PostDO> getPostPage(PostPageReqVO reqVO);

    /**
     * 获取岗位。
     *
     * @param id 岗位编号
     * @return 岗位信息
     */
    PostDO getPost(Long id);

    /**
     * 校验岗位列表有效性。
     * <p>
     * 逐个校验岗位是否存在且已启用。
     *
     * @param ids 岗位编号列表
     */
    void validatePostList(Collection<Long> ids);

}
