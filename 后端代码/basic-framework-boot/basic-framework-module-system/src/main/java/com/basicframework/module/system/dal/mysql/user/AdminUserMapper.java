package com.basicframework.module.system.dal.mysql.user;

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
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/dal/mysql/user/AdminUserMapper.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：命名空间适配；分页查询补平台类型条件；新增按主键行锁查询；补全类型与方法 JavaDoc。
 */
@Mapper
public interface AdminUserMapper extends BaseMapperX<AdminUserDO> {

    /**
     * 在调用方事务中锁定用户，以当前读串行化密码变更和会话签发。
     *
     * @param id 用户编号
     * @return 当前未删除用户；不存在时返回 {@code null}；行锁持续到事务结束
     */
    default AdminUserDO selectByIdForUpdate(Long id) {
        return selectOne(new LambdaQueryWrapperX<AdminUserDO>()
                .eq(AdminUserDO::getId, id).last("FOR UPDATE"));
    }

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
     * 按手机号和可信平台查询认证目标，避免短信入口跨平台选中身份。
     *
     * @param mobile 手机号
     * @param userType 入口固定的平台类型
     * @return 当前平台账号，不存在时返回 {@code null}
     */
    default AdminUserDO selectByMobileAndUserType(String mobile, String userType) {
        return selectOne(new LambdaQueryWrapperX<AdminUserDO>()
                .eq(AdminUserDO::getMobile, mobile).eq(AdminUserDO::getUserType, userType));
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
     * @param status 目标状态
     * @param userType 管理平台类型
     * @return 查询结果
     */
    default List<AdminUserDO> selectListByStatusAndUserType(Integer status, String userType) {
        LambdaQueryWrapperX<AdminUserDO> query = new LambdaQueryWrapperX<AdminUserDO>()
                .eq(AdminUserDO::getStatus, status);
        if (AdminPlatformTypeEnum.BUSINESS_ADMIN.getType().equals(userType)) {
            // 老账号的平台字段可能为空；只允许业务管理平台兼容读取，不能扩大到其他平台。
            query.and(item -> item.eq(AdminUserDO::getUserType, userType)
                    .or().isNull(AdminUserDO::getUserType)
                    .or().eq(AdminUserDO::getUserType, ""));
        } else {
            query.eq(AdminUserDO::getUserType, userType);
        }
        return selectList(query);
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

}
