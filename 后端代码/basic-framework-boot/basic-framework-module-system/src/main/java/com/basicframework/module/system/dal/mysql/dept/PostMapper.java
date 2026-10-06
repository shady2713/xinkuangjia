package com.basicframework.module.system.dal.mysql.dept;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.system.controller.admin.dept.vo.post.PostPageReqVO;
import com.basicframework.module.system.dal.dataobject.dept.PostDO;
import org.apache.ibatis.annotations.Mapper;

import java.util.Collection;
import java.util.List;

/**
 * PostMapper 数据访问接口，负责持久化查询与写入。
 *
 * @author 李杰
 * 署名验收：尚未验收
 */
@Mapper
public interface PostMapper extends BaseMapperX<PostDO> {

    /**
     * 查询列表。
     *
     * @param ids 编号集合
     * @param statuses statuses参数
     * @return 查询结果
     */
    default List<PostDO> selectList(Collection<Long> ids, Collection<Integer> statuses) {
        return selectList(new LambdaQueryWrapperX<PostDO>()
                .inIfPresent(PostDO::getId, ids)
                .inIfPresent(PostDO::getStatus, statuses));
    }

    /**
     * 查询分页数据。
     *
     * @param reqVO 请求参数
     * @return 查询结果
     */
    default PageResult<PostDO> selectPage(PostPageReqVO reqVO) {
        return selectPage(reqVO, new LambdaQueryWrapperX<PostDO>()
                .likeIfPresent(PostDO::getCode, reqVO.getCode())
                .likeIfPresent(PostDO::getName, reqVO.getName())
                .eqIfPresent(PostDO::getStatus, reqVO.getStatus())
                .orderByDesc(PostDO::getId));
    }

    /**
     * 查询By名称。
     *
     * @param name 名称
     * @return 查询结果
     */
    default PostDO selectByName(String name) {
        return selectOne(PostDO::getName, name);
    }

    /**
     * 查询By编码。
     *
     * @param code 编码
     * @return 查询结果
     */
    default PostDO selectByCode(String code) {
        return selectOne(PostDO::getCode, code);
    }

}
