package com.basicframework.module.system.convert.user;

import com.basicframework.framework.common.util.collection.CollectionUtils;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.module.system.controller.admin.dept.vo.dept.DeptSimpleRespVO;
import com.basicframework.module.system.controller.admin.dept.vo.post.PostSimpleRespVO;
import com.basicframework.module.system.controller.admin.permission.vo.role.RoleSimpleRespVO;
import com.basicframework.module.system.controller.admin.user.vo.profile.UserProfileRespVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserRespVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserSimpleRespVO;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import com.basicframework.module.system.dal.dataobject.dept.PostDO;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import org.mapstruct.Mapper;
import org.mapstruct.factory.Mappers;

import java.util.List;
import java.util.Map;

/**
 * UserConvert 对象转换组件。
 *
 * @author 李杰
 */
@Mapper
public interface UserConvert {

    UserConvert INSTANCE = Mappers.getMapper(UserConvert.class);

    /**
     * 转换列表。
     *
     * @param list 数据集合
     * @param deptMap 键值映射
     * @return 转换结果
     */
    default List<UserRespVO> convertList(List<AdminUserDO> list, Map<Long, DeptDO> deptMap) {
        return CollectionUtils.convertList(list, user -> convert(user, deptMap.get(user.getDeptId())));
    }

    /**
     * 转换指定数据。
     *
     * @param user 用户参数
     * @param dept 部门参数
     * @return 转换结果
     */
    default UserRespVO convert(AdminUserDO user, DeptDO dept) {
        UserRespVO userVO = BeanUtils.toBean(user, UserRespVO.class);
        if (dept != null) {
            userVO.setDeptName(dept.getName());
        } else {
            userVO.setDeptId(null);
        }
        return userVO;
    }

    /**
     * 转换精简数据列表。
     *
     * @param list 数据集合
     * @param deptMap 键值映射
     * @return 转换结果
     */
    default List<UserSimpleRespVO> convertSimpleList(List<AdminUserDO> list, Map<Long, DeptDO> deptMap) {
        return CollectionUtils.convertList(list, user -> {
            UserSimpleRespVO userVO = BeanUtils.toBean(user, UserSimpleRespVO.class);
            if (deptMap != null && user.getDeptId() != null) {
                DeptDO dept = deptMap.get(user.getDeptId());
                if (dept != null) {
                    userVO.setDeptName(dept.getName());
                }
            }
            return userVO;
        });
    }

    /**
     * 转换指定数据。
     *
     * @param user 用户参数
     * @param userRoles 用户Roles参数
     * @param dept 部门参数
     * @param posts posts参数
     * @return 转换结果
     */
    default UserProfileRespVO convert(AdminUserDO user, List<RoleDO> userRoles,
                                      DeptDO dept, List<PostDO> posts) {
        UserProfileRespVO userVO = BeanUtils.toBean(user, UserProfileRespVO.class);
        userVO.setRoles(BeanUtils.toBean(userRoles, RoleSimpleRespVO.class));
        userVO.setDept(BeanUtils.toBean(dept, DeptSimpleRespVO.class));
        userVO.setPosts(BeanUtils.toBean(posts, PostSimpleRespVO.class));
        return userVO;
    }

}
