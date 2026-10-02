package com.basicframework.module.system.service.dept;

import cn.hutool.core.collection.CollUtil;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.module.system.controller.admin.dept.vo.post.PostPageReqVO;
import com.basicframework.module.system.controller.admin.dept.vo.post.PostSaveReqVO;
import com.basicframework.module.system.dal.dataobject.dept.PostDO;
import com.basicframework.module.system.dal.mysql.dept.PostMapper;
import com.basicframework.module.system.dal.mysql.dept.UserPostMapper;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;
import org.springframework.validation.annotation.Validated;

import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.framework.common.util.collection.CollectionUtils.convertMap;
import static com.basicframework.module.system.enums.ErrorCodeConstants.*;

/**
 * 岗位 Service 实现类。
 * <p>
 * 处理岗位增删改查及岗位与用户关系校验。
 *
 * @author 李杰
 */
@Service
@Validated
public class PostServiceImpl implements PostService {

    @Resource
    private PostMapper postMapper;

    @Resource
    private UserPostMapper userPostMapper;

    /**
     * 创建岗位。
     *
     * @param createReqVO 创建岗位请求
     * @return 岗位编号
     */
    @Override
    public Long createPost(PostSaveReqVO createReqVO) {
        // 校验岗位名称和编码唯一性
        validatePostForCreateOrUpdate(null, createReqVO.getName(), createReqVO.getCode());

        // 插入岗位
        PostDO post = BeanUtils.toBean(createReqVO, PostDO.class);
        postMapper.insert(post);
        return post.getId();
    }

    /**
     * 更新岗位。
     *
     * @param updateReqVO 更新岗位请求
     */
    @Override
    public void updatePost(PostSaveReqVO updateReqVO) {
        // 校验岗位是否可编辑
        validatePostForCreateOrUpdate(updateReqVO.getId(), updateReqVO.getName(), updateReqVO.getCode());

        // 校验当前岗位若被禁用，且已有用户关联
        PostDO post = getPost(updateReqVO.getId());
        if (CommonStatusEnum.isEnable(post.getStatus())
                && CommonStatusEnum.isDisable(updateReqVO.getStatus())
                && CollUtil.isNotEmpty(userPostMapper.selectListByPostIds(
                        Collections.singletonList(updateReqVO.getId())))) {
            throw exception(POST_IS_REFERENCED, post.getName());
        }

        // 更新岗位
        PostDO updateObj = BeanUtils.toBean(updateReqVO, PostDO.class);
        postMapper.updateById(updateObj);
    }

    /**
     * 删除岗位。
     *
     * @param id 岗位编号
     */
    @Override
    public void deletePost(Long id) {
        // 校验岗位存在
        validatePostExists(id);
        // 删除岗位
        postMapper.deleteById(id);
    }

    /**
     * 批量删除岗位。
     *
     * @param ids 岗位编号列表
     */
    @Override
    public void deletePostList(List<Long> ids) {
        postMapper.deleteByIds(ids);
    }

    /**
     * 新增/更新时的重复性校验。
     *
     * @param id   岗位编号；新增时为空
     * @param name 岗位名称
     * @param code 岗位编码
     */
    private void validatePostForCreateOrUpdate(Long id, String name, String code) {
        validatePostExists(id);
        validatePostNameUnique(id, name);
        validatePostCodeUnique(id, code);
    }

    /**
     * 校验岗位名称唯一。
     *
     * @param id   岗位编号
     * @param name 岗位名称
     */
    private void validatePostNameUnique(Long id, String name) {
        PostDO post = postMapper.selectByName(name);
        if (post == null) {
            return;
        }
        if (id == null) {
            throw exception(POST_NAME_DUPLICATE);
        }
        if (!post.getId().equals(id)) {
            throw exception(POST_NAME_DUPLICATE);
        }
    }

    /**
     * 校验岗位编码唯一。
     *
     * @param id   岗位编号
     * @param code 岗位编码
     */
    private void validatePostCodeUnique(Long id, String code) {
        PostDO post = postMapper.selectByCode(code);
        if (post == null) {
            return;
        }
        if (id == null) {
            throw exception(POST_CODE_DUPLICATE);
        }
        if (!post.getId().equals(id)) {
            throw exception(POST_CODE_DUPLICATE);
        }
    }

    /**
     * 校验岗位存在。
     *
     * @param id 岗位编号
     */
    private void validatePostExists(Long id) {
        if (id == null) {
            return;
        }
        if (postMapper.selectById(id) == null) {
            throw exception(POST_NOT_FOUND);
        }
    }

    /**
     * 按编号批量查询岗位。
     *
     * @param ids 岗位编号列表
     * @return 岗位列表
     */
    @Override
    public List<PostDO> getPostList(Collection<Long> ids) {
        if (CollUtil.isEmpty(ids)) {
            return Collections.emptyList();
        }
        return postMapper.selectByIds(ids);
    }

    /**
     * 按编号和状态查询岗位。
     *
     * @param ids      岗位编号列表
     * @param statuses 状态列表
     * @return 岗位列表
     */
    @Override
    public List<PostDO> getPostList(Collection<Long> ids, Collection<Integer> statuses) {
        return postMapper.selectList(ids, statuses);
    }

    /**
     * 分页查询岗位。
     *
     * @param reqVO 分页请求参数
     * @return 岗位分页结果
     */
    @Override
    public PageResult<PostDO> getPostPage(PostPageReqVO reqVO) {
        return postMapper.selectPage(reqVO);
    }

    /**
     * 查询岗位。
     *
     * @param id 岗位编号
     * @return 岗位信息
     */
    @Override
    public PostDO getPost(Long id) {
        return postMapper.selectById(id);
    }

    /**
     * 校验岗位列表有效性。
     * <p>
     * 逐个校验岗位是否存在且处于启用状态。
     *
     * @param ids 岗位编号列表
     */
    @Override
    public void validatePostList(Collection<Long> ids) {
        if (CollUtil.isEmpty(ids)) {
            return;
        }
        // 获取岗位信息
        List<PostDO> posts = postMapper.selectByIds(ids);
        Map<Long, PostDO> postMap = convertMap(posts, PostDO::getId);
        // 校验
        ids.forEach(id -> {
            PostDO post = postMap.get(id);
            if (post == null) {
                throw exception(POST_NOT_FOUND);
            }
            if (!CommonStatusEnum.ENABLE.getStatus().equals(post.getStatus())) {
                throw exception(POST_NOT_ENABLE, post.getName());
            }
        });
    }
}
