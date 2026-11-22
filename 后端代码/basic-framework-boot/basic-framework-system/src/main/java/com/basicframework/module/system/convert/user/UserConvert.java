package com.basicframework.module.system.convert.user;

import com.basicframework.framework.common.util.collection.CollectionUtils;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.module.system.controller.admin.dept.vo.dept.DeptSimpleRespVO;
import com.basicframework.module.system.controller.admin.permission.vo.role.RoleSimpleRespVO;
import com.basicframework.module.system.controller.admin.user.vo.profile.UserProfileRespVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserRespVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserSimpleRespVO;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
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

    default List<UserRespVO> convertList(List<AdminUserDO> list, Map<Long, DeptDO> deptMap) {
        return CollectionUtils.convertList(list, user -> convert(user, deptMap.get(user.getDeptId())));
    }

    default UserRespVO convert(AdminUserDO user, DeptDO dept) {
        UserRespVO userVO = BeanUtils.toBean(user, UserRespVO.class);
        if (dept != null) {
            userVO.setDeptName(dept.getName());
        } else {
            userVO.setDeptId(null);
        }
        return userVO;
    }

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

    default UserProfileRespVO convert(AdminUserDO user, List<RoleDO> userRoles, DeptDO dept) {
        UserProfileRespVO userVO = BeanUtils.toBean(user, UserProfileRespVO.class);
        userVO.setRoles(BeanUtils.toBean(userRoles, RoleSimpleRespVO.class));
        userVO.setDept(BeanUtils.toBean(dept, DeptSimpleRespVO.class));
        return userVO;
    }

}
