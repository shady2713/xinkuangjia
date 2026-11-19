package com.basicframework.module.system.service.user;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.collection.CollectionUtil;
import cn.hutool.core.util.ObjUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.crypto.digest.DigestUtil;
import com.basicframework.framework.common.api.config.ConfigApi;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.common.util.validation.ValidationUtils;
import com.basicframework.framework.datapermission.core.util.DataPermissionUtils;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import com.basicframework.module.system.controller.admin.user.vo.profile.UserProfileUpdatePasswordReqVO;
import com.basicframework.module.system.controller.admin.user.vo.profile.UserProfileUpdateReqVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserImportExcelVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserImportRespVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserPageReqVO;
import com.basicframework.module.system.controller.admin.user.vo.user.UserSaveReqVO;
import com.basicframework.module.system.dal.dataobject.dept.DeptDO;
import com.basicframework.module.system.dal.dataobject.dept.UserPostDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.dal.mysql.dept.UserPostMapper;
import com.basicframework.module.system.dal.mysql.user.AdminUserMapper;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.logger.LoginLogTypeEnum;
import com.basicframework.module.system.enums.logger.LoginResultEnum;
import com.basicframework.module.system.enums.permission.RoleCodeEnum;
import com.basicframework.module.system.enums.security.UserTokenInvalidationReasonEnum;
import com.basicframework.module.system.framework.security.audit.SecurityAuditService;
import com.basicframework.module.system.framework.security.login.LoginFailureLockService;
import com.basicframework.module.system.mq.message.user.UserStatusChangedEvent;
import com.basicframework.module.system.mq.message.user.UserTokenInvalidatedEvent;
import com.basicframework.module.system.service.dept.DeptService;
import com.basicframework.module.system.service.dept.PostService;
import com.basicframework.module.system.service.permission.PermissionService;

import com.google.common.annotations.VisibleForTesting;
import com.mzt.logapi.context.LogRecordContext;
import com.mzt.logapi.service.impl.DiffParseFunction;
import com.mzt.logapi.starter.annotation.LogRecord;
import jakarta.annotation.Resource;
import jakarta.validation.ConstraintViolationException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.ApplicationContext;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.framework.common.util.collection.CollectionUtils.*;
import static com.basicframework.module.system.enums.ErrorCodeConstants.*;
import static com.basicframework.module.system.enums.LogRecordConstants.*;

/**
 * 后台用户 Service 实现类
 *
 * @author 李杰
 */
@Service("adminUserService")
@Slf4j
public class AdminUserServiceImpl implements AdminUserService {

    static final String USER_INIT_PASSWORD_KEY = "system.user.init-password";

    @Resource
    private AdminUserMapper userMapper;

    @Resource
    private DeptService deptService;
    @Resource
    private PostService postService;
    @Resource
    private ObjectProvider<PermissionService> permissionServiceProvider;
    @Resource
    private PasswordEncoder passwordEncoder;

    @Resource
    private ApplicationContext applicationContext;

    @Resource
    private UserPostMapper userPostMapper;

    @Resource
    private ConfigApi configApi;

    @Resource
    private SecurityAuditService securityAuditService;

    @Resource
    private ObjectProvider<LoginFailureLockService> loginFailureLockServiceProvider;

    /**
     * 创建用户。
     *
     * @param createReqVO createReqVO 参数
     * @param userType 当前管理平台类型
     * @return 操作结果
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    @LogRecord(type = SYSTEM_USER_TYPE, subType = SYSTEM_USER_CREATE_SUB_TYPE, bizNo = "{{#user.id}}",
            success = SYSTEM_USER_CREATE_SUCCESS)
    public Long createUser(UserSaveReqVO createReqVO, String userType) {
        String resolvedUserType = AdminPlatformTypeEnum.defaultType(userType);
        // 1.1 校验正确性
        validateUserForCreateOrUpdate(null, createReqVO.getUsername(),
                createReqVO.getMobile(), createReqVO.getEmail(), createReqVO.getDeptId(), createReqVO.getPostIds(),
                resolvedUserType);
        // 2.1 插入用户
        AdminUserDO user = BeanUtils.toBean(createReqVO, AdminUserDO.class);
        // 用户归属必须以可信的登录平台为准，不能使用 HTTP 请求体中的平台字段。
        user.setUserType(resolvedUserType);
        user.setStatus(ObjUtil.defaultIfNull(user.getStatus(), CommonStatusEnum.ENABLE.getStatus())); // 默认开启
        validatePasswordPolicy(createReqVO.getPassword());
        user.setPassword(encodePassword(createReqVO.getPassword())); // 加密密码
        // 管理员设置初始密码后，用户首次登录必须先修改密码。
        user.setPasswordChangeRequired(true);
        userMapper.insert(user);
        // 2.2 插入关联岗位
        if (CollectionUtil.isNotEmpty(user.getPostIds())) {
            userPostMapper.insertBatch(convertList(user.getPostIds(),
                    postId -> {
                        UserPostDO userPost = new UserPostDO();
                        userPost.setUserId(user.getId());
                        userPost.setPostId(postId);
                        return userPost;
                    }));
        }

        // 3. 记录操作日志上下文
        LogRecordContext.putVariable("user", user);
        return user.getId();
    }

    /**
     * 更新用户。
     *
     * @param updateReqVO updateReqVO 参数
     * @param userType 当前管理平台类型
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    @LogRecord(type = SYSTEM_USER_TYPE, subType = SYSTEM_USER_UPDATE_SUB_TYPE, bizNo = "{{#updateReqVO.id}}",
            success = SYSTEM_USER_UPDATE_SUCCESS)
    public void updateUser(UserSaveReqVO updateReqVO, String userType) {
        updateReqVO.setPassword(null); // 特殊：此处不更新密码
        String resolvedUserType = AdminPlatformTypeEnum.defaultType(userType);
        // 1. 校验正确性
        AdminUserDO oldUser = validateUserForCreateOrUpdate(updateReqVO.getId(), updateReqVO.getUsername(),
                updateReqVO.getMobile(), updateReqVO.getEmail(), updateReqVO.getDeptId(), updateReqVO.getPostIds(),
                resolvedUserType);

        // 2.1 更新用户
        AdminUserDO updateObj = BeanUtils.toBean(updateReqVO, AdminUserDO.class);
        // 防止请求体伪造平台字段导致账号被迁移到其他管理平台。
        updateObj.setUserType(resolvedUserType);
        userMapper.updateById(updateObj);
        // 2.2 更新岗位
        updateUserPost(updateReqVO, updateObj);

        // 3. 记录操作日志上下文
        // 避免前端未传递 avatar 字段时，操作日志 diff 误报为删除头像
        if (updateReqVO.getAvatar() == null) {
            updateReqVO.setAvatar(oldUser.getAvatar());
        }
        LogRecordContext.putVariable(DiffParseFunction.OLD_OBJECT, BeanUtils.toBean(oldUser, UserSaveReqVO.class));
        LogRecordContext.putVariable("user", oldUser);
    }

    /**
     * 更新用户Post。
     */
    private void updateUserPost(UserSaveReqVO reqVO, AdminUserDO updateObj) {
        Long userId = reqVO.getId();
        Set<Long> dbPostIds = convertSet(userPostMapper.selectListByUserId(userId), UserPostDO::getPostId);
        // 计算新增和删除的岗位编号
        Set<Long> postIds = CollUtil.emptyIfNull(updateObj.getPostIds());
        Collection<Long> createPostIds = CollUtil.subtract(postIds, dbPostIds);
        Collection<Long> deletePostIds = CollUtil.subtract(dbPostIds, postIds);
        // 执行新增和删除。对于已经授权的岗位，不用做任何处理
        if (!CollectionUtil.isEmpty(createPostIds)) {
            userPostMapper.insertBatch(convertList(createPostIds,
                    postId -> {
                        UserPostDO userPost = new UserPostDO();
                        userPost.setUserId(userId);
                        userPost.setPostId(postId);
                        return userPost;
                    }));
        }
        if (!CollectionUtil.isEmpty(deletePostIds)) {
            userPostMapper.deleteByUserIdAndPostId(userId, deletePostIds);
        }
    }

    /**
     * 更新用户登录。
     *
     * @param id 主键编号
     * @param loginIp loginIp 参数
     */
    @Override
    public void updateUserLogin(Long id, String loginIp) {
        AdminUserDO updateObj = new AdminUserDO();
        updateObj.setId(id);
        updateObj.setLoginIp(loginIp);
        updateObj.setLoginDate(LocalDateTime.now());
        userMapper.updateById(updateObj);
    }

    /**
     * 更新用户Profile。
     *
     * @param id 主键编号
     * @param reqVO 请求参数
     */
    @Override
    public void updateUserProfile(Long id, UserProfileUpdateReqVO reqVO) {
        // 个人资料自助修改需忽略部门数据权限，防止 deptId 为空用户被锁死且确保手机号/邮箱全库唯一。
        DataPermissionUtils.executeIgnore(() -> {
            validateUserExists(id);
            validateEmailUnique(id, reqVO.getEmail());
            validateMobileUnique(id, reqVO.getMobile());
            AdminUserDO updateUser = BeanUtils.toBean(reqVO, AdminUserDO.class);
            updateUser.setId(id);
            userMapper.updateById(updateUser);
        });
    }

    /**
     * 校验旧密码后更新个人密码。
     *
     * @param id 当前登录用户编号
     * @param reqVO 已解密的旧密码和新密码
     */
    @Override
    public void updateUserPassword(Long id, UserProfileUpdatePasswordReqVO reqVO) {
        String lockKey = "profile-pwd:" + id;
        LoginFailureLockService lockService = loginFailureLockServiceProvider != null
                ? loginFailureLockServiceProvider.getIfAvailable() : null;
        if (lockService != null) {
            lockService.assertNotLocked(lockKey);
        }
        // 旧密码允许历史 bcrypt(md5(明文)) 格式通过，且自助改密忽略部门数据权限以免空部门用户无法完成强制改密。
        AdminUserDO user;
        try {
            user = DataPermissionUtils.executeIgnore(() -> validateOldPassword(id, reqVO.getOldPassword()));
        } catch (ServiceException ex) {
            if (lockService != null) {
                lockService.recordFailure(lockKey);
            }
            securityAuditService.record(LoginLogTypeEnum.PASSWORD_CHANGE,
                    LoginResultEnum.PASSWORD_VERIFY_FAILED, id, null);
            throw ex;
        }
        if (lockService != null) {
            lockService.clearFailures(lockKey);
        }
        try {
            validatePasswordPolicy(reqVO.getNewPassword());
        } catch (ServiceException ex) {
            securityAuditService.record(LoginLogTypeEnum.PASSWORD_CHANGE,
                    LoginResultEnum.PASSWORD_POLICY_REJECTED, id, user.getUsername());
            throw ex;
        }
        // 执行更新
        AdminUserDO updateObj = new AdminUserDO();
        updateObj.setId(id);
        updateObj.setPassword(encodePassword(reqVO.getNewPassword()));
        // 用户自行修改密码后不再要求强制改密。
        updateObj.setPasswordChangeRequired(false);
        DataPermissionUtils.executeIgnore(() -> userMapper.updateById(updateObj));

        // 先吊销旧令牌，再写审计，避免审计写入失败导致旧会话继续有效。
        publishTokenInvalidated(id, UserTypeEnum.ADMIN.getValue(),
                UserTokenInvalidationReasonEnum.PASSWORD_CHANGED);
        securityAuditService.record(LoginLogTypeEnum.PASSWORD_CHANGE, LoginResultEnum.SUCCESS,
                id, user.getUsername());
    }

    /**
     * 更新用户密码。
     *
     * @param id 主键编号
     * @param password password 参数
     */
    @Override
    @LogRecord(type = SYSTEM_USER_TYPE, subType = SYSTEM_USER_UPDATE_PASSWORD_SUB_TYPE, bizNo = "{{#id}}",
            success = SYSTEM_USER_UPDATE_PASSWORD_SUCCESS)
    public void updateUserPassword(Long id, String password) {
        // 1. 校验用户存在和密码复杂度
        AdminUserDO user = validateUserExists(id);
        try {
            validatePasswordPolicy(password);
        } catch (ServiceException ex) {
            securityAuditService.record(LoginLogTypeEnum.PASSWORD_RESET,
                    LoginResultEnum.PASSWORD_POLICY_REJECTED, id, user.getUsername());
            throw ex;
        }

        // 2. 更新密码；短信重置由用户自己设置新密码，不触发首次改密。
        AdminUserDO updateObj = new AdminUserDO();
        updateObj.setId(id);
        updateObj.setPassword(encodePassword(password)); // 加密密码
        updateObj.setPasswordChangeRequired(false);
        userMapper.updateById(updateObj);

        // 先吊销旧令牌，再写审计，避免审计写入失败导致旧会话继续有效。
        publishTokenInvalidated(id, UserTypeEnum.ADMIN.getValue(),
                UserTokenInvalidationReasonEnum.PASSWORD_RESET);
        securityAuditService.record(LoginLogTypeEnum.PASSWORD_RESET, LoginResultEnum.SUCCESS,
                id, user.getUsername());

        // 3. 记录操作日志上下文
        LogRecordContext.putVariable("user", user);
    }

    /**
     * 由管理端更新当前平台用户的密码，目标用户不属于当前平台时拒绝写入。
     *
     * @param id 用户编号
     * @param password 新密码
     * @param userType 当前管理平台类型
     */
    @Override
    @LogRecord(type = SYSTEM_USER_TYPE, subType = SYSTEM_USER_UPDATE_PASSWORD_SUB_TYPE, bizNo = "{{#id}}",
            success = SYSTEM_USER_UPDATE_PASSWORD_SUCCESS)
    public void updateUserPassword(Long id, String password, String userType) {
        AdminUserDO user = validateUserForPlatform(id, userType);
        try {
            validatePasswordPolicy(password);
        } catch (ServiceException ex) {
            securityAuditService.record(LoginLogTypeEnum.PASSWORD_RESET,
                    LoginResultEnum.PASSWORD_POLICY_REJECTED, id, user.getUsername());
            throw ex;
        }

        AdminUserDO updateObj = new AdminUserDO();
        updateObj.setId(id);
        updateObj.setPassword(encodePassword(password));
        // 管理员重置密码后，用户首次登录必须先修改密码。
        updateObj.setPasswordChangeRequired(true);
        userMapper.updateById(updateObj);

        // 先吊销旧令牌，再写审计，避免审计写入失败导致旧会话继续有效。
        publishTokenInvalidated(id, UserTypeEnum.ADMIN.getValue(),
                UserTokenInvalidationReasonEnum.PASSWORD_RESET);
        securityAuditService.record(LoginLogTypeEnum.PASSWORD_RESET, LoginResultEnum.SUCCESS,
                id, user.getUsername());

        LogRecordContext.putVariable("user", user);
    }

    /**
     * 更新用户状态。
     *
     * @param id 主键编号
     * @param status status 参数
     * @param userType 当前管理平台类型
     */
    @Override
    public void updateUserStatus(Long id, Integer status, String userType) {
        // 平台归属和用户存在性必须在写入前由 Service 一并校验。
        validateUserForPlatform(id, userType);
        // 更新状态
        AdminUserDO updateObj = new AdminUserDO();
        updateObj.setId(id);
        updateObj.setStatus(status);
        userMapper.updateById(updateObj);

        // 发布用户状态变更事件（如果禁用，消费者会清除 Token）
        applicationContext.publishEvent(
                new UserStatusChangedEvent(id, UserTypeEnum.ADMIN.getValue(), status));
    }

    /**
     * 删除用户。
     *
     * @param id 主键编号
     * @param userType 当前管理平台类型
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    @LogRecord(type = SYSTEM_USER_TYPE, subType = SYSTEM_USER_DELETE_SUB_TYPE, bizNo = "{{#id}}",
            success = SYSTEM_USER_DELETE_SUCCESS)
    public void deleteUser(Long id, String userType) {
        // 1. 校验用户存在并属于当前管理平台
        AdminUserDO user = validateUserForPlatform(id, userType);

        // 2.1 删除用户
        userMapper.deleteById(id);
        // 2.2 删除用户关联数据
        getPermissionService().processUserDeleted(id);
        // 2.2 删除用户岗位
        userPostMapper.deleteByUserId(id);

        // 2.3 删除后立即撤销用户全部令牌，避免已删除账号继续访问。
        publishTokenInvalidated(id, UserTypeEnum.ADMIN.getValue(),
                UserTokenInvalidationReasonEnum.USER_DELETED);

        // 3. 记录操作日志上下文
        LogRecordContext.putVariable("user", user);
    }

    /**
     * 删除用户List。
     *
     * @param ids ids 编号集合
     * @param userType 当前管理平台类型
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deleteUserList(List<Long> ids, String userType) {
        // 先一次性查询并校验全部用户，任一用户不存在或跨平台时整体拒绝删除。
        List<Long> validatedIds = validateUserListForPlatform(ids, userType);
        if (validatedIds.isEmpty()) {
            return;
        }
        userMapper.deleteByIds(validatedIds);

        // 2. 批量删除用户关联数据
        validatedIds.forEach(id -> {
            getPermissionService().processUserDeleted(id);
            userPostMapper.deleteByUserId(id);
            // 逐个用户撤销令牌，保证批量删除与单个删除的失效语义一致。
            publishTokenInvalidated(id, UserTypeEnum.ADMIN.getValue(),
                    UserTokenInvalidationReasonEnum.USER_DELETED);
        });
    }

    /**
     * 获取用户ByUsername。
     *
     * @param username username 参数
     * @return 查询或转换后的结果
     */
    @Override
    public AdminUserDO getUserByUsername(String username) {
        return userMapper.selectByUsername(username);
    }

    /**
     * 获取用户ByUsernameAnd类型。
     *
     * @param username username 参数
     * @param userType userType 参数
     * @return 查询或转换后的结果
     */
    @Override
    public AdminUserDO getUserByUsernameAndType(String username, String userType) {
        return userMapper.selectByUsernameAndUserType(username, AdminPlatformTypeEnum.defaultType(userType));
    }

    /**
     * 获取用户ByMobile。
     *
     * @param mobile mobile 参数
     * @return 查询或转换后的结果
     */
    @Override
    public AdminUserDO getUserByMobile(String mobile) {
        return userMapper.selectByMobile(mobile);
    }

    /**
     * 获取用户分页数据。
     *
     * @param reqVO 请求参数
     * @return 查询或转换后的结果
     */
    @Override
    public PageResult<AdminUserDO> getUserPage(UserPageReqVO reqVO) {
        // 如果有角色编号，查询角色对应的用户编号
        Set<Long> userIds = null;
        if (reqVO.getRoleId() != null) {
            userIds = getPermissionService().getUserRoleIdListByRoleId(singleton(reqVO.getRoleId()));
            if (CollUtil.isEmpty(userIds)) {
                return PageResult.empty();
            }
        }

        // 分页查询
        return userMapper.selectPage(reqVO, getDeptCondition(reqVO.getDeptId()), userIds);
    }

    /**
     * 获取用户。
     *
     * @param id 主键编号
     * @return 查询或转换后的结果
     */
    @Override
    public AdminUserDO getUser(Long id) {
        return userMapper.selectById(id);
    }

    /**
     * 查询当前管理平台可访问的用户，不存在时返回空，跨平台时拒绝访问。
     *
     * @param id 用户编号
     * @param userType 当前管理平台类型
     * @return 用户对象；不存在时返回 {@code null}
     */
    @Override
    public AdminUserDO getUser(Long id, String userType) {
        AdminUserDO user = userMapper.selectById(id);
        if (user == null) {
            return null;
        }
        validateUserPlatform(user, userType);
        return user;
    }

    /**
     * 获取用户类型OrDefault。
     *
     * @param id 主键编号
     * @return 查询或转换后的结果
     */
    @Override
    public String getUserTypeOrDefault(Long id) {
        if (id == null) {
            return AdminPlatformTypeEnum.BUSINESS_ADMIN.getType();
        }
        AdminUserDO user = DataPermissionUtils.executeIgnore(() -> userMapper.selectById(id));
        // 老数据没有 user_type 时，默认归入当前业务管理平台，避免历史账号登录异常。
        return AdminPlatformTypeEnum.defaultType(user == null ? null : user.getUserType());
    }

    /**
     * 获取登录用户类型OrDefault。
     *
     * @return 查询或转换后的结果
     */
    @Override
    public String getLoginUserTypeOrDefault() {
        return getUserTypeOrDefault(SecurityFrameworkUtils.getLoginUserId());
    }

    /**
     * 获取用户ListBy部门Ids。
     *
     * @param deptIds deptIds 编号集合
     * @return 查询或转换后的结果
     */
    @Override
    public List<AdminUserDO> getUserListByDeptIds(Collection<Long> deptIds) {
        if (CollUtil.isEmpty(deptIds)) {
            return Collections.emptyList();
        }
        return userMapper.selectListByDeptIds(deptIds);
    }

    /**
     * 获取用户ListByPostIds。
     *
     * @param postIds postIds 编号集合
     * @return 查询或转换后的结果
     */
    @Override
    public List<AdminUserDO> getUserListByPostIds(Collection<Long> postIds) {
        if (CollUtil.isEmpty(postIds)) {
            return Collections.emptyList();
        }
        Set<Long> userIds = convertSet(userPostMapper.selectListByPostIds(postIds), UserPostDO::getUserId);
        if (CollUtil.isEmpty(userIds)) {
            return Collections.emptyList();
        }
        return userMapper.selectByIds(userIds);
    }

    /**
     * 获取用户List。
     *
     * @param ids ids 编号集合
     * @return 查询或转换后的结果
     */
    @Override
    public List<AdminUserDO> getUserList(Collection<Long> ids) {
        if (CollUtil.isEmpty(ids)) {
            return Collections.emptyList();
        }
        return userMapper.selectByIds(ids);
    }

    /**
     * 校验用户List。
     *
     * @param ids ids 编号集合
     */
    @Override
    public void validateUserList(Collection<Long> ids) {
        if (CollUtil.isEmpty(ids)) {
            return;
        }
        // 获得岗位信息
        List<AdminUserDO> users = userMapper.selectByIds(ids);
        Map<Long, AdminUserDO> userMap = convertMap(users, AdminUserDO::getId);
        // 校验
        ids.forEach(id -> {
            AdminUserDO user = userMap.get(id);
            if (user == null) {
                throw exception(USER_NOT_EXISTS);
            }
            if (!CommonStatusEnum.ENABLE.getStatus().equals(user.getStatus())) {
                throw exception(USER_IS_DISABLE, user.getNickname());
            }
        });
    }

    /**
     * 获取用户ListByNickname。
     *
     * @param nickname nickname 参数
     * @return 查询或转换后的结果
     */
    @Override
    public List<AdminUserDO> getUserListByNickname(String nickname) {
        return userMapper.selectListByNickname(nickname);
    }

    /**
     * 获得部门条件：查询指定部门的子部门编号们，包括自身
     *
     * @param deptId 部门编号
     * @return 部门编号集合
     */
    private Set<Long> getDeptCondition(Long deptId) {
        if (deptId == null) {
            return Collections.emptySet();
        }
        Set<Long> deptIds = convertSet(deptService.getChildDeptList(deptId), DeptDO::getId);
        deptIds.add(deptId); // 包括自身
        return deptIds;
    }

    /**
     * 校验创建或更新用户时的可见性、平台边界与全局唯一性约束。
     *
     * <p>目标用户存在性及目标部门合法性必须在当前调用者的数据权限范围内校验，防止跨部门越权修改用户或将用户迁入无权部门；
     * 仅账号、手机号和邮箱的全库唯一性检查忽略数据权限，避免跨部门重名触发底层唯一索引异常。</p>
     */
    private AdminUserDO validateUserForCreateOrUpdate(Long id, String username, String mobile, String email,
                                               Long deptId, Set<Long> postIds, String userType) {
        AdminUserDO user = validateUserExists(id);
        String resolvedUserType = AdminPlatformTypeEnum.defaultType(
                user != null && StrUtil.isBlank(userType) ? user.getUserType() : userType);
        if (user != null) {
            validateUserPlatform(user, resolvedUserType);
        }
        deptService.validateDeptList(singleton(deptId));
        postService.validatePostList(postIds);
        DataPermissionUtils.executeIgnore(() -> {
            validateUsernameUnique(id, username, resolvedUserType);
            validateMobileUnique(id, mobile);
            validateEmailUnique(id, email);
        });
        return user;
    }

    /**
     * 校验 validateUserExists 对应的输入与业务约束。
     */
    @VisibleForTesting
    AdminUserDO validateUserExists(Long id) {
        if (id == null) {
            return null;
        }
        AdminUserDO user = userMapper.selectById(id);
        if (user == null) {
            throw exception(USER_NOT_EXISTS);
        }
        return user;
    }

    /**
     * 校验用户存在并属于指定管理平台。
     *
     * @param id 用户编号
     * @param userType 当前管理平台类型
     * @return 已通过平台归属校验的用户
     */
    @VisibleForTesting
    AdminUserDO validateUserForPlatform(Long id, String userType) {
        AdminUserDO user = validateUserExists(id);
        validateUserPlatform(user, userType);
        return user;
    }

    /**
     * 一次性校验批量用户的存在性和平台归属，避免循环逐条查询。
     *
     * @param ids 用户编号集合
     * @param userType 当前管理平台类型
     * @return 去重后且保持请求顺序的用户编号
     */
    @VisibleForTesting
    List<Long> validateUserListForPlatform(List<Long> ids, String userType) {
        if (CollUtil.isEmpty(ids)) {
            return Collections.emptyList();
        }
        List<Long> distinctIds = new ArrayList<>(new LinkedHashSet<>(ids));
        List<AdminUserDO> users = userMapper.selectByIds(distinctIds);
        Map<Long, AdminUserDO> userMap = convertMap(users, AdminUserDO::getId);
        for (Long id : distinctIds) {
            AdminUserDO user = userMap.get(id);
            if (user == null) {
                throw exception(USER_NOT_EXISTS);
            }
            validateUserPlatform(user, userType);
        }
        return distinctIds;
    }

    /**
     * 校验用户是否属于指定管理平台。
     *
     * @param user 目标用户
     * @param userType 当前管理平台类型
     */
    private void validateUserPlatform(AdminUserDO user, String userType) {
        // 平台类型是账号对象级权限边界，不允许任何管理端操作跨平台访问用户。
        if (!AdminPlatformTypeEnum.isSame(user.getUserType(), userType)) {
            throw exception(SYSTEM_PLATFORM_ACCESS_DENIED);
        }
        validateOperatorCanManageTarget(user);
    }

    /**
     * 校验非超管操作员不得越权修改、重置、禁用或删除持有 {@code super_admin} 角色的账号。
     *
     * <p>防止同属 {@code super_admin} 管理平台的普通子管理员通过用户管理或导入接口接管超级管理员账号。</p>
     *
     * @param target 目标用户
     */
    private void validateOperatorCanManageTarget(AdminUserDO target) {
        if (target == null || target.getId() == null) {
            return;
        }
        Long operatorId = SecurityFrameworkUtils.getLoginUserId();
        if (operatorId == null || Objects.equals(operatorId, target.getId())) {
            return;
        }
        PermissionService permissionService = permissionServiceProvider != null
                ? permissionServiceProvider.getIfAvailable() : null;
        if (permissionService == null) {
            return;
        }
        boolean targetIsSuperAdmin = permissionService.hasAnyRoles(
                target.getId(), RoleCodeEnum.SUPER_ADMIN.getCode());
        if (targetIsSuperAdmin
                && !permissionService.hasAnyRoles(operatorId, RoleCodeEnum.SUPER_ADMIN.getCode())) {
            throw exception(SYSTEM_PLATFORM_ACCESS_DENIED);
        }
    }

    /**
     * 校验 validateUsernameUnique 对应的输入与业务约束。
     */
    @VisibleForTesting
    void validateUsernameUnique(Long id, String username, String userType) {
        if (StrUtil.isBlank(username)) {
            return;
        }
        AdminUserDO user = userMapper.selectByUsernameAndUserType(
                username, AdminPlatformTypeEnum.defaultType(userType));
        if (user == null) {
            return;
        }
        // 如果 id 为空，说明不用比较是否为相同 id 的用户
        if (id == null) {
            throw exception(USER_USERNAME_EXISTS);
        }
        if (!user.getId().equals(id)) {
            throw exception(USER_USERNAME_EXISTS);
        }
    }

    /**
     * 校验 validateEmailUnique 对应的输入与业务约束。
     */
    @VisibleForTesting
    void validateEmailUnique(Long id, String email) {
        if (StrUtil.isBlank(email)) {
            return;
        }
        AdminUserDO user = userMapper.selectByEmail(email);
        if (user == null) {
            return;
        }
        // 如果 id 为空，说明不用比较是否为相同 id 的用户
        if (id == null) {
            throw exception(USER_EMAIL_EXISTS);
        }
        if (!user.getId().equals(id)) {
            throw exception(USER_EMAIL_EXISTS);
        }
    }

    /**
     * 校验 validateMobileUnique 对应的输入与业务约束。
     */
    @VisibleForTesting
    void validateMobileUnique(Long id, String mobile) {
        if (StrUtil.isBlank(mobile)) {
            return;
        }
        AdminUserDO user = userMapper.selectByMobile(mobile);
        if (user == null) {
            return;
        }
        // 如果 id 为空，说明不用比较是否为相同 id 的用户
        if (id == null) {
            throw exception(USER_MOBILE_EXISTS);
        }
        if (!user.getId().equals(id)) {
            throw exception(USER_MOBILE_EXISTS);
        }
    }

    /**
     * 校验旧密码，并返回校验通过的当前用户。
     *
     * @param id          用户 id
     * @param oldPassword 旧密码
     * @return 当前用户
     * @throws com.basicframework.framework.common.exception.ServiceException 用户不存在或旧密码不匹配时抛出
     */
    @VisibleForTesting
    AdminUserDO validateOldPassword(Long id, String oldPassword) {
        AdminUserDO user = userMapper.selectById(id);
        if (user == null) {
            throw exception(USER_NOT_EXISTS);
        }
        if (!isPasswordMatch(oldPassword, user.getPassword())
                && !isPasswordMatchLegacy(oldPassword, user.getPassword())) {
            throw exception(USER_PASSWORD_FAILED);
        }
        return user;
    }

    /**
     * 导入用户List。
     *
     * @param importUsers importUsers 数据集合
     * @param isUpdateSupport isUpdateSupport 参数
     * @return 方法处理结果
     */
    @Override
    @Transactional(rollbackFor = Exception.class) // 添加事务，异常则回滚所有导入
    public UserImportRespVO importUserList(List<UserImportExcelVO> importUsers, boolean isUpdateSupport) {
        // 1.1 参数校验
        if (CollUtil.isEmpty(importUsers)) {
            throw exception(USER_IMPORT_LIST_IS_EMPTY);
        }
        // 1.2 初始化密码不能为空
        String initPassword = configApi.getConfigValueByKey(USER_INIT_PASSWORD_KEY);
        if (StrUtil.isEmpty(initPassword)) {
            throw exception(USER_IMPORT_INIT_PASSWORD);
        }
        // 初始密码同样必须满足密码复杂度，并在循环外一次性计算 BCrypt 摘要，避免批量导入按行重复哈希。
        validatePasswordPolicy(initPassword);
        String encodedInitPassword = encodePassword(initPassword);
        String importUserType = getLoginUserTypeOrDefault();

        // 2. 遍历，逐个创建或更新
        UserImportRespVO respVO = UserImportRespVO.builder().createUsernames(new ArrayList<>())
                .updateUsernames(new ArrayList<>()).failureUsernames(new LinkedHashMap<>()).build();
        AtomicInteger index = new AtomicInteger(1);
        importUsers.forEach(importUser -> {
            int currentIndex = index.getAndIncrement();
            // 2.1.1 校验字段是否符合要求
            try {
                UserSaveReqVO validationRequest = BeanUtils.toBean(importUser, UserSaveReqVO.class);
                validationRequest.setPassword(initPassword);
                ValidationUtils.validate(validationRequest);
            } catch (ConstraintViolationException ex) {
                String key = StrUtil.blankToDefault(importUser.getUsername(), "第 " + currentIndex + " 行");
                respVO.getFailureUsernames().put(key, ex.getMessage());
                return;
            }
            // 2.1.2 根据部门名称查找部门编号
            Long deptId = null;
            if (StrUtil.isNotBlank(importUser.getDeptName())) {
                DeptDO dept = deptService.getDeptByName(importUser.getDeptName());
                if (dept == null) {
                    respVO.getFailureUsernames().put(importUser.getUsername(), "部门名称不存在");
                    return;
                }
                deptId = dept.getId();
            }

            // 2.1.3 优先查询同平台存量账号，以便在更新分支按其真实主键核验邮箱/手机号唯一性与可见范围
            AdminUserDO existUser = DataPermissionUtils.executeIgnore(
                    () -> userMapper.selectByUsernameAndUserType(importUser.getUsername(), importUserType));
            try {
                validateUserForCreateOrUpdate(existUser != null ? existUser.getId() : null,
                        null, importUser.getMobile(), importUser.getEmail(),
                        deptId, null, importUserType);
            } catch (ServiceException ex) {
                respVO.getFailureUsernames().put(importUser.getUsername(), ex.getMessage());
                return;
            }

            // 2.2.1 不存在时创建新用户
            if (existUser == null) {
                AdminUserDO newUser = BeanUtils.toBean(importUser, AdminUserDO.class);
                newUser.setUserType(importUserType);
                newUser.setDeptId(deptId);
                newUser.setPassword(encodedInitPassword);
                newUser.setPasswordChangeRequired(true);
                newUser.setPostIds(new HashSet<>());
                userMapper.insert(newUser);
                respVO.getCreateUsernames().add(importUser.getUsername());
                return;
            }
            // 2.2.2 已存在时按更新开关更新，若状态变更为停用则发布下线事件清理令牌
            if (!isUpdateSupport) {
                respVO.getFailureUsernames().put(importUser.getUsername(), USER_USERNAME_EXISTS.getMsg());
                return;
            }
            AdminUserDO updateUser = BeanUtils.toBean(importUser, AdminUserDO.class);
            updateUser.setId(existUser.getId());
            updateUser.setDeptId(deptId);
            userMapper.updateById(updateUser);
            if (importUser.getStatus() != null && !Objects.equals(existUser.getStatus(), importUser.getStatus())) {
                applicationContext.publishEvent(
                        new UserStatusChangedEvent(existUser.getId(), UserTypeEnum.ADMIN.getValue(), importUser.getStatus()));
            }
            respVO.getUpdateUsernames().add(importUser.getUsername());
        });
        return respVO;
    }

    /**
     * 获取用户ListBy状态。
     *
     * @param status status 参数
     * @return 查询或转换后的结果
     */
    @Override
    public List<AdminUserDO> getUserListByStatus(Integer status) {
        return userMapper.selectListByStatus(status);
    }

    /**
     * 获取指定状态及管理平台类型的用户列表。
     *
     * @param status 目标状态
     * @param userType 管理平台类型
     * @return 用户列表
     */
    @Override
    public List<AdminUserDO> getUserListByStatusAndType(Integer status, String userType) {
        return userMapper.selectListByStatusAndUserType(status, AdminPlatformTypeEnum.defaultType(userType));
    }

    /**
     * 判断密码Match 是否满足业务条件。
     *
     * @param rawPassword rawPassword 参数
     * @param encodedPassword encodedPassword 参数
     * @return 业务条件成立时返回 true，否则返回 false
     */
    @Override
    public boolean isPasswordMatch(String rawPassword, String encodedPassword) {
        return passwordEncoder.matches(rawPassword, encodedPassword);
    }

    /**
     * 校验历史 bcrypt(md5(明文)) 格式密码。
     *
     * <p>兼容范围只覆盖前端 MD5 传输方案下线前的存量哈希。确认所有活跃账号
     * 完成一次登录升级后，删除本方法和调用点。MD5 在这里只作为历史输入，
     * 不作为新的存储或传输算法。</p>
     *
     * @param rawPassword 未加密的密码
     * @param encodedPassword 历史加密后的密码
     * @return 是否匹配
     */
    @Override
    public boolean isPasswordMatchLegacy(String rawPassword, String encodedPassword) {
        if (StrUtil.isEmpty(rawPassword) || StrUtil.isEmpty(encodedPassword)) {
            return false;
        }
        String legacyRawPassword = DigestUtil.md5Hex(rawPassword);
        return passwordEncoder.matches(legacyRawPassword, encodedPassword);
    }

    /**
     * 登录成功后将历史哈希原地升级为当前 BCrypt(明文) 格式。
     *
     * @param id 用户编号
     * @param rawPassword 未加密的密码
     */
    @Override
    public void updatePasswordHash(Long id, String rawPassword) {
        AdminUserDO updateObj = new AdminUserDO();
        updateObj.setId(id);
        updateObj.setPassword(encodePassword(rawPassword));
        userMapper.updateById(updateObj);
    }

    /**
     * 校验新密码是否符合等保二级复杂度。
     *
     * @param password 明文密码
     * @throws ServiceException 不满足复杂度时抛出
     */
    private void validatePasswordPolicy(String password) {
        if (!ValidationUtils.isPassword(password)) {
            throw exception(PASSWORD_POLICY_NOT_MATCH);
        }
    }

    /**
     * 获取权限Service。
     */
    private PermissionService getPermissionService() {
        return permissionServiceProvider.getObject();
    }

    /**
     * 对密码进行加密
     *
     * @param password 密码
     * @return 加密后的密码
     */
    private String encodePassword(String password) {
        return passwordEncoder.encode(password);
    }

    /**
     * 发布用户令牌失效事件，由监听器统一撤销该用户的访问令牌和刷新令牌。
     *
     * @param userId 用户编号
     * @param userType 用户类型
     * @param reason 失效原因
     */
    private void publishTokenInvalidated(Long userId, Integer userType,
                                         UserTokenInvalidationReasonEnum reason) {
        applicationContext.publishEvent(new UserTokenInvalidatedEvent(userId, userType, reason));
    }

}
