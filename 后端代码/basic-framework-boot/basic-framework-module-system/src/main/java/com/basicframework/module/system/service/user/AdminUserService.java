package com.basicframework.module.system.service.user;

import cn.hutool.core.collection.CollUtil;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.collection.CollectionUtils;
import com.basicframework.module.system.controller.admin.auth.vo.AuthRegisterReqVO;
import com.basicframework.module.system.controller.admin.user.vo.profile.UserProfileUpdatePasswordReqVO;
import com.basicframework.module.system.controller.admin.user.vo.profile.UserProfileUpdateReqVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserImportExcelVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserImportRespVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserPageReqVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserSaveReqVO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import jakarta.validation.Valid;

import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 后台用户 Service 接口
 *
 * @author 李杰
 */
public interface AdminUserService {

    /**
     * 创建用户
     *
     * @param createReqVO 用户信息
     * @param userType 当前管理平台类型
     * @return 用户编号
     */
    Long createUser(@Valid UserSaveReqVO createReqVO, String userType);

    /**
     * 注册用户
     *
     * @param registerReqVO 用户信息
     * @return 用户编号
     */
    Long registerUser(@Valid AuthRegisterReqVO registerReqVO);

    /**
     * 修改用户
     *
     * @param updateReqVO 用户信息
     * @param userType 当前管理平台类型；目标用户不属于该平台时拒绝修改
     */
    void updateUser(@Valid UserSaveReqVO updateReqVO, String userType);

    /**
     * 更新用户的最后登陆信息
     *
     * @param id 用户编号
     * @param loginIp 登陆 IP
     */
    void updateUserLogin(Long id, String loginIp);

    /**
     * 修改用户个人信息
     *
     * @param id 用户编号
     * @param reqVO 用户个人信息
     */
    void updateUserProfile(Long id, @Valid UserProfileUpdateReqVO reqVO);

    /**
     * 修改用户个人密码
     *
     * @param id 用户编号
     * @param reqVO 更新用户个人密码
     */
    void updateUserPassword(Long id, @Valid UserProfileUpdatePasswordReqVO reqVO);

    /**
     * 修改密码
     *
     * @param id       用户编号
     * @param password 密码
     */
    void updateUserPassword(Long id, String password);

    /**
     * 由管理端修改指定平台用户的密码。
     *
     * @param id 用户编号
     * @param password 新密码
     * @param userType 当前管理平台类型；目标用户不属于该平台时拒绝修改
     */
    void updateUserPassword(Long id, String password, String userType);

    /**
     * 修改状态
     *
     * @param id 用户编号
     * @param status 状态
     * @param userType 当前管理平台类型；目标用户不属于该平台时拒绝修改
     */
    void updateUserStatus(Long id, Integer status, String userType);

    /**
     * 删除用户
     *
     * @param id 用户编号
     * @param userType 当前管理平台类型；目标用户不属于该平台时拒绝删除
     */
    void deleteUser(Long id, String userType);

    /**
     * 批量删除用户
     *
     * @param ids 用户编号数组
     * @param userType 当前管理平台类型；任一目标用户不属于该平台时整体拒绝删除
     */
    void deleteUserList(List<Long> ids, String userType);

    /**
     * 通过用户名查询用户
     *
     * @param username 用户名
     * @return 用户对象信息
     */
    AdminUserDO getUserByUsername(String username);

    /**
     * 通过用户名和后台平台类型查询用户。
     *
     * @param username 用户名
     * @param userType 后台平台类型
     * @return 用户对象信息
     */
    AdminUserDO getUserByUsernameAndType(String username, String userType);

    /**
     * 通过手机号获取用户
     *
     * @param mobile 手机号
     * @return 用户对象信息
     */
    AdminUserDO getUserByMobile(String mobile);

    /**
     * 获得用户分页列表
     *
     * @param reqVO 分页条件
     * @return 分页列表
     */
    PageResult<AdminUserDO> getUserPage(UserPageReqVO reqVO);

    /**
     * 通过用户 ID 查询用户
     *
     * @param id 用户ID
     * @return 用户对象信息
     */
    AdminUserDO getUser(Long id);

    /**
     * 查询当前管理平台可访问的用户。
     *
     * @param id 用户编号
     * @param userType 当前管理平台类型
     * @return 用户对象；不存在时返回 {@code null}
     */
    AdminUserDO getUser(Long id, String userType);

    /**
     * 获得指定用户的后台平台类型，老数据默认归属当前业务管理平台。
     *
     * @param id 用户编号
     * @return 后台平台类型
     */
    String getUserTypeOrDefault(Long id);

    /**
     * 获得当前登录用户的后台平台类型，用于接口侧自动隔离用户、角色和菜单。
     *
     * @return 后台平台类型
     */
    String getLoginUserTypeOrDefault();

    /**
     * 获得指定部门的用户数组
     *
     * @param deptIds 部门数组
     * @return 用户数组
     */
    List<AdminUserDO> getUserListByDeptIds(Collection<Long> deptIds);

    /**
     * 获得指定岗位的用户数组
     *
     * @param postIds 岗位数组
     * @return 用户数组
     */
    List<AdminUserDO> getUserListByPostIds(Collection<Long> postIds);

    /**
     * 获得用户列表
     *
     * @param ids 用户编号数组
     * @return 用户列表
     */
    List<AdminUserDO> getUserList(Collection<Long> ids);

    /**
     * 校验用户们是否有效。如下情况，视为无效：
     * 1. 用户编号不存在
     * 2. 用户被禁用
     *
     * @param ids 用户编号数组
     */
    void validateUserList(Collection<Long> ids);

    /**
     * 获得用户 Map
     *
     * @param ids 用户编号数组
     * @return 用户 Map
     */
    default Map<Long, AdminUserDO> getUserMap(Collection<Long> ids) {
        if (CollUtil.isEmpty(ids)) {
            return new HashMap<>();
        }
        return CollectionUtils.convertMap(getUserList(ids), AdminUserDO::getId);
    }

    /**
     * 获得用户列表，基于昵称模糊匹配
     *
     * @param nickname 昵称
     * @return 用户列表
     */
    List<AdminUserDO> getUserListByNickname(String nickname);

    /**
     * 批量导入用户
     *
     * @param importUsers     导入用户列表
     * @param isUpdateSupport 是否支持更新
     * @return 导入结果
     */
    UserImportRespVO importUserList(List<UserImportExcelVO> importUsers, boolean isUpdateSupport);

    /**
     * 获得指定状态的用户们
     *
     * @param status 状态
     * @return 用户们
     */
    List<AdminUserDO> getUserListByStatus(Integer status);

    /**
     * 获得指定状态及管理平台类型的用户。
     *
     * @param status 状态
     * @param userType 管理平台类型
     * @return 用户列表
     */
    List<AdminUserDO> getUserListByStatusAndType(Integer status, String userType);

    /**
     * 判断密码是否匹配
     *
     * @param rawPassword 未加密的密码
     * @param encodedPassword 加密后的密码
     * @return 是否匹配
     */
    boolean isPasswordMatch(String rawPassword, String encodedPassword);

}
