package com.basicframework.module.system.dal.mysql.dept;

import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.system.dal.dataobject.dept.UserPostDO;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import org.apache.ibatis.annotations.Mapper;

import java.util.Collection;
import java.util.List;

/**
 * UserPostMapper 数据访问接口，负责持久化查询与写入。
 *
 * @author 李杰
 */
@Mapper
public interface UserPostMapper extends BaseMapperX<UserPostDO> {

    /**
     * 查询列表By用户编号。
     *
     * @param userId 用户编号
     * @return 查询结果
     */
    default List<UserPostDO> selectListByUserId(Long userId) {
        return selectList(UserPostDO::getUserId, userId);
    }

    /**
     * 删除By用户编号And岗位编号。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param userId 用户编号
     * @param postIds 编号集合
     */
    default void deleteByUserIdAndPostId(Long userId, Collection<Long> postIds) {
        delete(new LambdaQueryWrapperX<UserPostDO>()
                .eq(UserPostDO::getUserId, userId)
                .in(UserPostDO::getPostId, postIds));
    }

    /**
     * 查询列表By岗位Ids。
     *
     * @param postIds 编号集合
     * @return 查询结果
     */
    default List<UserPostDO> selectListByPostIds(Collection<Long> postIds) {
        return selectList(UserPostDO::getPostId, postIds);
    }

    /**
     * 删除By用户编号。
     *
     * <p>该操作可能更新业务状态、持久化数据或外部资源。</p>
     *
     * @param userId 用户编号
     */
    default void deleteByUserId(Long userId) {
        delete(Wrappers.lambdaUpdate(UserPostDO.class).eq(UserPostDO::getUserId, userId));
    }
}
