package com.basicframework.module.system.dal.mysql.permission;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.dataobject.BaseDO;
import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.system.controller.admin.permission.vo.role.RolePageReqVO;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import org.apache.ibatis.annotations.Mapper;
import org.springframework.lang.Nullable;

import java.util.Collection;
import java.util.List;

/**
 * RoleMapper 数据访问接口，负责持久化查询与写入。
 *
 * @author 李杰
 */
@Mapper
public interface RoleMapper extends BaseMapperX<RoleDO> {

    /**
     * 查询分页数据。
     *
     * @param reqVO 请求参数
     * @return 查询结果
     */
    default PageResult<RoleDO> selectPage(RolePageReqVO reqVO) {
        return selectPage(reqVO, new LambdaQueryWrapperX<RoleDO>()
                .likeIfPresent(RoleDO::getName, reqVO.getName())
                .likeIfPresent(RoleDO::getCode, reqVO.getCode())
                .eqIfPresent(RoleDO::getStatus, reqVO.getStatus())
                .eqIfPresent(RoleDO::getRoleType, reqVO.getRoleType())
                .betweenIfPresent(BaseDO::getCreateTime, reqVO.getCreateTime())
                .orderByAsc(RoleDO::getSort));
    }

    /**
     * 查询By名称。
     *
     * @param name 名称
     * @return 查询结果
     */
    default RoleDO selectByName(String name) {
        return selectOne(RoleDO::getName, name);
    }

    /**
     * 查询By编码。
     *
     * @param code 编码
     * @return 查询结果
     */
    default RoleDO selectByCode(String code) {
        return selectOne(RoleDO::getCode, code);
    }

    /**
     * 查询列表By状态。
     *
     * @param statuses statuses参数
     * @return 查询结果
     */
    default List<RoleDO> selectListByStatus(@Nullable Collection<Integer> statuses) {
        return selectList(RoleDO::getStatus, statuses);
    }

    /**
     * 查询列表By角色类型。
     *
     * @param roleType 角色类型参数
     * @return 查询结果
     */
    default List<RoleDO> selectListByRoleType(String roleType) {
        return selectList(RoleDO::getRoleType, roleType);
    }

}
