package com.basicframework.module.system.service.user;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.collection.CollectionUtil;
import cn.hutool.core.util.ObjUtil;
import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.api.config.ConfigApi;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.common.util.validation.ValidationUtils;
import com.basicframework.framework.datapermission.core.util.DataPermissionUtils;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import com.basicframework.module.system.controller.admin.auth.vo.AuthRegisterReqVO;
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
import com.basicframework.module.system.framework.auth.config.AdminAuthenticationProperties;
import com.basicframework.module.system.mq.message.user.UserStatusChangedEvent;
import com.basicframework.module.system.service.dept.DeptService;
import com.basicframework.module.system.service.dept.PostService;
import com.basicframework.module.system.service.permission.PermissionService;
import com.basicframework.module.system.service.oauth2.OAuth2TokenService;

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
import org.springframework.transaction.annotation.Propagation;

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
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@Service("adminUserService")
@Slf4j
public class AdminUserServiceImpl implements AdminUserService {

    static final String USER_INIT_PASSWORD_KEY = "system.user.init-password";

    static final String USER_REGISTER_ENABLED_KEY = "system.user.register-enabled";

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
    private AdminAuthenticationProperties authenticationProperties;

    @Resource
    private ObjectProvider<OAuth2TokenService> oauth2TokenServiceProvider;

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
        user.setPassword(encodePassword(createReqVO.getPassword())); // 加密密码
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
     * 注册用户。
     *
     * @param registerReqVO registerReqVO 参数
     * @return 方法处理结果
     */
    @Override
    public Long registerUser(AuthRegisterReqVO registerReqVO) {
        // 1.1 校验是否开启注册
        if (!authenticationProperties.isRegistrationEnabled()
                || ObjUtil.notEqual(configApi.getConfigValueByKey(USER_REGISTER_ENABLED_KEY), "true")) {
            throw exception(USER_REGISTER_DISABLED);
        }
        // 1.2 校验正确性
        validateUserForCreateOrUpdate(null, registerReqVO.getUsername(), null, null, null, null,
                AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());

        // 2. 插入用户
        AdminUserDO user = BeanUtils.toBean(registerReqVO, AdminUserDO.class);
        // 注册入口只服务当前业务管理平台，不允许通过注册生成新管理平台账号。
        user.setUserType(AdminPlatformTypeEnum.BUSINESS_ADMIN.getType());
        user.setStatus(CommonStatusEnum.ENABLE.getStatus()); // 默认开启
        user.setPassword(encodePassword(registerReqVO.getPassword())); // 加密密码
        userMapper.insert(user);
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
        // 与部门/平台迁移串行，避免通过可见性校验后目标又被移出授权范围。
        lockUser(updateReqVO.getId());
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
        // 校验正确性
        validateUserExists(id);
        validateEmailUnique(id, reqVO.getEmail());
        validateMobileUnique(id, reqVO.getMobile());
        // 执行更新
        AdminUserDO updateUser = BeanUtils.toBean(reqVO, AdminUserDO.class);
        updateUser.setId(id);
        userMapper.updateById(updateUser);
    }

    /**
     * 锁定用户后校验旧密码、更新个人密码并撤销全部会话，要求重新登录。
     *
     * @param id 当前登录用户编号
     * @param reqVO 前端提交的新旧密码 MD5 摘要
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public void updateUserPassword(Long id, UserProfileUpdatePasswordReqVO reqVO) {
        // 旧密码沿用当前登录协议的 MD5 摘要；校验失败时不得写入新密码。
        AdminUserDO user = lockUser(id);
        if (!isPasswordMatch(reqVO.getOldPassword(), user.getPassword())) {
            throw exception(USER_PASSWORD_FAILED);
        }
        // 执行更新
        AdminUserDO updateObj = new AdminUserDO();
        updateObj.setId(id);
        // 新密码已由前端转换为 MD5，直接使用 BCrypt 存储，不能再次摘要导致与登录请求不一致。
        updateObj.setPassword(encodePassword(reqVO.getNewPassword()));
        userMapper.updateById(updateObj);
        oauth2TokenServiceProvider.getObject().removeAccessToken(id, UserTypeEnum.ADMIN.getValue());
    }

    /**
     * 更新用户密码并在同一事务中撤销其全部访问和刷新会话。
     *
     * @param id 主键编号
     * @param password password 参数
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    @LogRecord(type = SYSTEM_USER_TYPE, subType = SYSTEM_USER_UPDATE_PASSWORD_SUB_TYPE, bizNo = "{{#id}}",
            success = SYSTEM_USER_UPDATE_PASSWORD_SUCCESS)
    public void updateUserPassword(Long id, String password) {
        // 1. 校验用户存在
        AdminUserDO user = lockUser(id);

        // 2. 更新密码
        AdminUserDO updateObj = new AdminUserDO();
        updateObj.setId(id);
        updateObj.setPassword(encodePassword(password)); // 加密密码
        userMapper.updateById(updateObj);
        oauth2TokenServiceProvider.getObject().removeAccessToken(id, UserTypeEnum.ADMIN.getValue());

        // 3. 记录操作日志上下文
        LogRecordContext.putVariable("user", user);
    }

    /**
     * 由管理端更新当前平台用户密码并撤销全部会话，跨平台目标拒绝写入。
     *
     * @param id 用户编号
     * @param password 新密码
     * @param userType 当前管理平台类型
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    @LogRecord(type = SYSTEM_USER_TYPE, subType = SYSTEM_USER_UPDATE_PASSWORD_SUB_TYPE, bizNo = "{{#id}}",
            success = SYSTEM_USER_UPDATE_PASSWORD_SUCCESS)
    public void updateUserPassword(Long id, String password, String userType) {
        AdminUserDO user = lockUser(id);
        validateUserPlatform(user, AdminPlatformTypeEnum.defaultType(userType));

        AdminUserDO updateObj = new AdminUserDO();
        updateObj.setId(id);
        updateObj.setPassword(encodePassword(password));
        userMapper.updateById(updateObj);
        oauth2TokenServiceProvider.getObject().removeAccessToken(id, UserTypeEnum.ADMIN.getValue());

        LogRecordContext.putVariable("user", user);
    }

    /**
     * 通过数据库当前读持有用户行锁；认证与密码写入共享此串行化边界。
     *
     * @param id 用户编号
     * @return 最新用户记录；用户不存在时抛出业务异常；无事务调用由框架拒绝
     */
    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public AdminUserDO lockUser(Long id) {
        AdminUserDO user = userMapper.selectByIdForUpdate(id);
        if (user == null) {
            throw exception(USER_NOT_EXISTS);
        }
        return user;
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
     * 查询固定平台的手机号身份，不回退到其他管理平台。
     *
     * @param mobile 手机号
     * @param userType 可信入口的平台类型
     * @return 匹配账号，不存在时返回 {@code null}
     */
    @Override
    public AdminUserDO getUserByMobileAndType(String mobile, String userType) {
        return userMapper.selectByMobileAndUserType(mobile, AdminPlatformTypeEnum.defaultType(userType));
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
        AdminUserDO user = userMapper.selectById(id);
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
     * 先在调用者的数据范围内校验目标用户、部门和岗位，仅唯一性查询忽略数据范围。
     */
    private AdminUserDO validateUserForCreateOrUpdate(Long id, String username, String mobile, String email,
                                               Long deptId, Set<Long> postIds, String userType) {
        // 目标不可见即拒绝，避免主表 UPDATE 被拦截但关联岗位仍被修改。
        AdminUserDO user = validateUserExists(id);
        String resolvedUserType = AdminPlatformTypeEnum.defaultType(
                user != null && StrUtil.isBlank(userType) ? user.getUserType() : userType);
        if (user != null) {
            validateUserPlatform(user, resolvedUserType);
        }
        deptService.validateDeptList(deptId == null ? Collections.emptySet() : singleton(deptId));
        postService.validatePostList(postIds);
        // 唯一键必须覆盖不可见数据，但不允许将对象访问校验包含在豁免范围内。
        DataPermissionUtils.executeIgnore(() -> {
            // 校验用户名唯一
            validateUsernameUnique(id, username, resolvedUserType);
            // 校验手机号唯一
            validateMobileUnique(id, mobile);
            // 校验邮箱唯一
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

        // 2. 遍历，逐个创建 or 更新
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

            // 2.1.3 校验，判断是否有不符合的原因
            try {
                validateUserForCreateOrUpdate(null, null, importUser.getMobile(), importUser.getEmail(),
                        deptId, null, getLoginUserTypeOrDefault());
            } catch (ServiceException ex) {
                respVO.getFailureUsernames().put(importUser.getUsername(), ex.getMessage());
                return;
            }

            // 2.2.1 判断如果不存在，在进行插入
            String importUserType = getLoginUserTypeOrDefault();
            AdminUserDO existUser = userMapper.selectByUsernameAndUserType(importUser.getUsername(), importUserType);
            if (existUser == null) {
                AdminUserDO newUser = BeanUtils.toBean(importUser, AdminUserDO.class);
                // 导入入口按当前登录平台写入，避免导入数据绕过平台隔离。
                newUser.setUserType(importUserType);
                newUser.setDeptId(deptId);
                newUser.setPassword(encodePassword(initPassword));
                newUser.setPostIds(new HashSet<>()); // 设置默认密码及空岗位编号数组
                userMapper.insert(newUser);
                respVO.getCreateUsernames().add(importUser.getUsername());
                return;
            }
            // 2.2.2 如果存在，判断是否允许更新
            if (!isUpdateSupport) {
                respVO.getFailureUsernames().put(importUser.getUsername(), USER_USERNAME_EXISTS.getMsg());
                return;
            }
            AdminUserDO updateUser = BeanUtils.toBean(importUser, AdminUserDO.class);
            updateUser.setId(existUser.getId());
            updateUser.setDeptId(deptId);
            userMapper.updateById(updateUser);
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

}
