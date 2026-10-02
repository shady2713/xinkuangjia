package com.basicframework.module.system.api.dept;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.map.MapUtil;
import com.basicframework.framework.common.util.collection.CollectionUtils;
import com.basicframework.module.system.api.dept.dto.PostRespDTO;

import java.util.Collection;
import java.util.List;
import java.util.Map;

/**
 * 岗位 API 接口
 *
 * @author 李杰
 */
public interface PostApi {

    /**
     * 校验岗位们是否有效。如下情况，视为无效：
     * 1. 岗位编号不存在
     * 2. 岗位被禁用
     *
     * @param ids 岗位编号数组
     */
    void validPostList(Collection<Long> ids);

    /**
     * 获取岗位列表。
     *
     * @param ids 编号集合
     * @return 查询结果
     */
    List<PostRespDTO> getPostList(Collection<Long> ids);

    /**
     * 获取岗位映射。
     *
     * @param ids 编号集合
     * @return 查询结果
     */
    default Map<Long, PostRespDTO> getPostMap(Collection<Long> ids) {
        if (CollUtil.isEmpty(ids)) {
            return MapUtil.empty();
        }

        List<PostRespDTO> list = getPostList(ids);
        return CollectionUtils.convertMap(list, PostRespDTO::getId);
    }

}
