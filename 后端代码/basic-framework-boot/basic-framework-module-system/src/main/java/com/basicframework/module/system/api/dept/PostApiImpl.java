package com.basicframework.module.system.api.dept;

import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.module.system.api.dept.dto.PostRespDTO;
import com.basicframework.module.system.dal.dataobject.dept.PostDO;
import com.basicframework.module.system.service.dept.PostService;
import org.springframework.stereotype.Service;

import jakarta.annotation.Resource;
import java.util.Collection;
import java.util.List;

/**
 * 岗位 API 实现类
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@Service
public class PostApiImpl implements PostApi {

    @Resource
    private PostService postService;

    /**
     * 筛选有效PostList。
     *
     * @param ids ids 编号集合
     */
    @Override
    public void validPostList(Collection<Long> ids) {
        postService.validatePostList(ids);
    }

    /**
     * 获取PostList。
     *
     * @param ids ids 编号集合
     * @return 查询或转换后的结果
     */
    @Override
    public List<PostRespDTO> getPostList(Collection<Long> ids) {
        List<PostDO> list = postService.getPostList(ids);
        return BeanUtils.toBean(list, PostRespDTO.class);
    }

}
