package com.basicframework.module.system.dal.mysql.user;

import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.system.controller.admin.user.vo.user.UserPageReqVO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import org.apache.ibatis.annotations.Mapper;

import java.util.Collection;
import java.util.List;

/**
 * AdminUserMapper 数据访问接口，负责持久化查询与写入。
 *
 * @author shady
 */
@Mapper
public interface AdminUserMapper extends BaseMapperX<AdminUserDO> {

    /**
     * 查询By用户名。
     *
     * @param username 用户名参数
     * @return 查询结果
     */
    default AdminUserDO selectByUsername(String username) {
        return selectOne(AdminUserDO::getUsername, username);
    }

    /**
     * 查询By用户名And用户类型。
     *
     * @param username 用户名参数
     * @param userType 用户类型参数
     * @return 查询结果
     */
    default AdminUserDO selectByUsernameAndUserType(String username, String userType) {
        // 管理平台和业务平台允许使用相同账号名，查询时必须带平台类型避免串号登录。
        return selectOne(new LambdaQueryWrapperX<AdminUserDO>()
                .eq(AdminUserDO::getUsername, username)
                .eq(AdminUserDO::getUserType, userType));
    }

    /**
     * 查询By邮箱。
     *
     * @param email 邮箱参数
     * @return 查询结果
     */
    default AdminUserDO selectByEmail(String email) {
        return selectOne(AdminUserDO::getEmail, email);
    }

    /**
     * 查询By手机号。
     *
     * @param mobile 手机号参数
     * @return 查询结果
     */
    default AdminUserDO selectByMobile(String mobile) {
        return selectOne(AdminUserDO::getMobile, mobile);
    }

    /**
     * 查询分页数据。
     *
     * @param reqVO 请求参数
     * @param deptIds 编号集合
     * @param userIds 编号集合
     * @return 查询结果
     */
    default PageResult<AdminUserDO> selectPage(UserPageReqVO reqVO, Collection<Long> deptIds, Collection<Long> userIds) {
        return selectPage(reqVO, new LambdaQueryWrapperX<AdminUserDO>()
                .likeIfPresent(AdminUserDO::getUsername, reqVO.getUsername())
                .likeIfPresent(AdminUserDO::getMobile, reqVO.getMobile())
                .eqIfPresent(AdminUserDO::getStatus, reqVO.getStatus())
                .eqIfPresent(AdminUserDO::getUserType, reqVO.getUserType())
                .betweenIfPresent(AdminUserDO::getCreateTime, reqVO.getCreateTime())
                .inIfPresent(AdminUserDO::getDeptId, deptIds)
                .inIfPresent(AdminUserDO::getId, userIds)
                .orderByDesc(AdminUserDO::getId));
    }

    /**
     * 查询列表By昵称。
     *
     * @param nickname 昵称参数
     * @return 查询结果
     */
    default List<AdminUserDO> selectListByNickname(String nickname) {
        return selectList(new LambdaQueryWrapperX<AdminUserDO>().like(AdminUserDO::getNickname, nickname));
    }

    /**
     * 查询列表By状态。
     *
     * @param status 目标状态
     * @return 查询结果
     */
    default List<AdminUserDO> selectListByStatus(Integer status) {
        return selectList(AdminUserDO::getStatus, status);
    }

    /**
     * 按状态和管理平台类型查询用户列表。
     *
     * @param status 目标状态；为 null 时不限制状态
     * @param userType 管理平台类型
     * @return 查询结果
     */
    default List<AdminUserDO> selectListByStatusAndUserType(Integer status, String userType) {
        return selectList(platformUsers(userType).eqIfPresent(AdminUserDO::getStatus, status));
    }

    /**
     * 按当前身份的主键读取平台，保留 ID 以区分空平台记录和不存在的账号。
     *
     * @param id 用户主键
     * @return 仅含 ID 和平台字段的用户
     */
    default AdminUserDO selectPlatformById(Long id) {
        return selectOne(new LambdaQueryWrapperX<AdminUserDO>()
                .eq(AdminUserDO::getId, id)
                .select(AdminUserDO::getId, AdminUserDO::getUserType));
    }

    /**
     * 按管理平台统计账号总数（业务平台自动兼容历史空 user_type 记录）。
     */
    default Long selectCountByPlatform(String userType, Integer status) {
        return selectCount(platformUsers(userType).eqIfPresent(AdminUserDO::getStatus, status));
    }

    /**
     * 首页日志按用户归属限定查询，只读取用户编号。
     */
    default List<Long> selectIdsByPlatform(String userType) {
        return selectList(platformUsers(userType).select(AdminUserDO::getId))
                .stream().map(AdminUserDO::getId).toList();
    }

    /**
     * 平台用户查询统一兼容归属业务平台的历史空值。
     */
    private static LambdaQueryWrapperX<AdminUserDO> platformUsers(String userType) {
        LambdaQueryWrapperX<AdminUserDO> query = new LambdaQueryWrapperX<>();
        if (AdminPlatformTypeEnum.BUSINESS_ADMIN.getType().equals(userType)) {
            // 老账号的平台字段可能为空；只允许业务管理平台兼容读取，不能扩大到其他平台。
            query.and(item -> item.eq(AdminUserDO::getUserType, userType)
                    .or().isNull(AdminUserDO::getUserType)
                    .or().eq(AdminUserDO::getUserType, ""));
        } else {
            query.eq(AdminUserDO::getUserType, userType);
        }
        return query;
    }

    /**
     * 查询列表By部门Ids。
     *
     * @param deptIds 编号集合
     * @return 查询结果
     */
    default List<AdminUserDO> selectListByDeptIds(Collection<Long> deptIds) {
        return selectList(AdminUserDO::getDeptId, deptIds);
    }

    /**
     * 仅当存储密码仍等于已校验值时更新密码哈希。
     *
     * @param id 用户编号
     * @param expectedPassword 已校验的当前存储值
     * @param newPassword 新密码哈希
     * @return 受影响行数；为 0 表示存储值已被并发修改
     */
    default int updatePasswordByIdAndPassword(Long id, String expectedPassword, String newPassword) {
        AdminUserDO updateObj = new AdminUserDO();
        updateObj.setPassword(newPassword);
        return update(updateObj, new LambdaUpdateWrapper<AdminUserDO>()
                .eq(AdminUserDO::getId, id)
                .apply("CAST(`password` AS BINARY) = CAST({0} AS BINARY)", expectedPassword));
    }

}
