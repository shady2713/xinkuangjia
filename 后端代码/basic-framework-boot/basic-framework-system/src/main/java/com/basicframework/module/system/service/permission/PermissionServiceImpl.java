package com.basicframework.module.system.service.permission;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.collection.CollectionUtil;
import cn.hutool.core.util.ArrayUtil;
import cn.hutool.extra.spring.SpringUtil;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.util.collection.CollectionUtils;
import com.basicframework.framework.datapermission.core.annotation.DataPermission;
import com.basicframework.framework.datapermission.core.util.DataPermissionUtils;
import com.basicframework.framework.common.biz.system.permission.dto.DeptDataPermissionRespDTO;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import com.basicframework.module.system.dal.dataobject.permission.MenuDO;
import com.basicframework.module.system.dal.dataobject.permission.RoleDO;
import com.basicframework.module.system.dal.dataobject.permission.RoleMenuDO;
import com.basicframework.module.system.dal.dataobject.permission.UserRoleDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.basicframework.module.system.dal.mysql.permission.RoleMenuMapper;
import com.basicframework.module.system.dal.mysql.permission.UserRoleMapper;
import com.basicframework.module.system.dal.redis.RedisKeyConstants;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.permission.DataScopeEnum;
import com.basicframework.module.system.enums.permission.RoleCodeEnum;
import com.basicframework.module.system.service.dept.DeptService;
import com.basicframework.module.system.service.user.AdminUserService;
import com.google.common.annotations.VisibleForTesting;
import com.google.common.base.Suppliers;
import com.google.common.collect.Sets;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.cache.annotation.Caching;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import jakarta.annotation.Resource;
import java.util.*;
import java.util.function.Supplier;

import com.basicframework.module.system.enums.ErrorCodeConstants;

import static com.basicframework.framework.common.util.collection.CollectionUtils.convertSet;
import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;

/**
 * 权限 Service 实现类
 *
 * @author shady
 */
@Service
@Slf4j
public class PermissionServiceImpl implements PermissionService {

    /**
     * 批量补齐用户列表角色名，不改变权限，也不返回跨平台角色。
     * @param userIds 已经数据权限裁剪的当前页用户编号
     * @param userType 当前管理平台类型
     * @return 用户编号到角色名称列表的映射；空输入返回空映射
     */
    @Override
    public Map<Long, List<String>> getUserRoleNames(Collection<Long> userIds, String userType) {
        if (userIds == null || userIds.isEmpty()) {
            return Map.of();
        }
        List<UserRoleDO> relations = userRoleMapper.selectListByUserIds(
                userIds.stream().filter(Objects::nonNull).distinct().toList());
        if (relations.isEmpty()) {
            return Map.of();
        }
        Map<Long, String> roleNames = new HashMap<>();
        // 与授权链路一致，历史跨平台关联不能进入当前业务平台的角色展示。
        for (RoleDO role : roleService.getRoleList(convertSet(relations, UserRoleDO::getRoleId))) {
            if (AdminPlatformTypeEnum.isSame(role.getRoleType(), userType)) {
                roleNames.put(role.getId(), role.getName());
            }
        }
        Map<Long, List<String>> result = new HashMap<>();
        for (UserRoleDO relation : relations) {
            String name = roleNames.get(relation.getRoleId());
            // 角色已删除或跨平台时跳过，不伪造名称或泄露其他平台信息。
            if (name != null) {
                List<String> names = result.computeIfAbsent(relation.getUserId(), ignored -> new ArrayList<>());
                if (!names.contains(name)) {
                    names.add(name);
                }
            }
        }
        result.values().forEach(Collections::sort);
        return result;
    }

    @Resource
    private RoleMenuMapper roleMenuMapper;
    @Resource
    private UserRoleMapper userRoleMapper;

    @Resource
    private RoleService roleService;
    @Resource
    private MenuService menuService;
    @Resource
    private DeptService deptService;
    @Resource
    private AdminUserService userService;

    /**
     * 判断任一Permissions 是否满足业务条件。
     *
     * @param userId 用户编号
     * @param permissions permissions 参数
     * @return 业务条件成立时返回 true，否则返回 false
     */
    @Override
    public boolean hasAnyPermissions(Long userId, String... permissions) {
        // 如果为空，说明已经有权限
        if (ArrayUtil.isEmpty(permissions)) {
            return true;
        }

        // 获得当前登录的角色。如果为空，说明没有权限
        String loginUserType = userService.getUserTypeOrDefault(userId);
        List<RoleDO> roles = getEnableUserRoleListByUserIdFromCache(userId).stream()
                // 用户只继承同平台角色，避免旧平台内置超管穿透到新管理平台权限。
                .filter(role -> AdminPlatformTypeEnum.isSame(role.getRoleType(), loginUserType))
                .toList();
        if (CollUtil.isEmpty(roles)) {
            return false;
        }

        // 情况一：遍历判断每个权限，如果有一满足，说明有权限
        for (String permission : permissions) {
            if (hasAnyPermission(roles, permission, loginUserType)) {
                return true;
            }
        }

        // 情况二：如果是超管，也说明有权限
        return roleService.hasAnySuperAdmin(convertSet(roles, RoleDO::getId))
                && hasAnyPermissionMenu(permissions, loginUserType);
    }

    /**
     * 判断指定角色，是否拥有该 permission 权限
     *
     * @param roles 指定角色数组
     * @param permission 权限标识
     * @return 是否拥有
     */
    private boolean hasAnyPermission(List<RoleDO> roles, String permission, String loginUserType) {
        List<Long> menuIds = menuService.getMenuIdListByPermissionFromCache(permission);
        // 采用严格模式，如果权限找不到对应的 Menu 的话，也认为没有权限
        if (CollUtil.isEmpty(menuIds)) {
            return false;
        }
        List<MenuDO> permissionMenus = menuService.getMenuList(menuIds).stream()
                // permission 也必须落在当前平台且实际启用的菜单下，避免跨平台渗透或已禁用菜单被直调。
                .filter(menu -> AdminPlatformTypeEnum.isSame(menu.getMenuType(), loginUserType))
                .filter(this::isMenuEffectivelyEnabled)
                .toList();
        if (CollUtil.isEmpty(permissionMenus)) {
            return false;
        }

        // 判断是否有权限
        Set<Long> roleIds = convertSet(roles, RoleDO::getId);
        for (MenuDO menu : permissionMenus) {
            // 获得拥有该菜单的角色编号集合
            Set<Long> menuRoleIds = getSelf().getMenuRoleIdListByMenuIdFromCache(menu.getId());
            // 如果有交集，说明有权限
            if (CollUtil.containsAny(menuRoleIds, roleIds)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 判断任一权限菜单 是否满足业务条件。
     */
    private boolean hasAnyPermissionMenu(String[] permissions, String loginUserType) {
        for (String permission : permissions) {
            List<Long> menuIds = menuService.getMenuIdListByPermissionFromCache(permission);
            if (CollUtil.isEmpty(menuIds)) {
                continue;
            }
            boolean existsInCurrentPlatform = menuService.getMenuList(menuIds).stream()
                    // 内置超管也只对当前平台且启用的菜单生效，不能绕过停用状态或跨平台访问。
                    .filter(menu -> AdminPlatformTypeEnum.isSame(menu.getMenuType(), loginUserType))
                    .anyMatch(this::isMenuEffectivelyEnabled);
            if (existsInCurrentPlatform) {
                return true;
            }
        }
        return false;
    }

    /**
     * 校验菜单自身及其所有祖先目录/菜单节点均处于启用状态，防止仅前端隐藏而后端接口继续放行。
     *
     * @param menu 待校验菜单节点
     * @return 自身与全部祖先均启用时返回 true
     */
    private boolean isMenuEffectivelyEnabled(MenuDO menu) {
        if (menu == null || !CommonStatusEnum.ENABLE.getStatus().equals(menu.getStatus())) {
            return false;
        }
        Set<Long> visited = new HashSet<>();
        if (menu.getId() != null) {
            visited.add(menu.getId());
        }
        Long parentId = menu.getParentId();
        for (int depth = 0; depth < 64 && parentId != null && !MenuDO.ID_ROOT.equals(parentId); depth++) {
            if (!visited.add(parentId)) {
                return false;
            }
            MenuDO parent = menuService.getMenu(parentId);
            if (parent == null || !CommonStatusEnum.ENABLE.getStatus().equals(parent.getStatus())) {
                return false;
            }
            parentId = parent.getParentId();
        }
        return parentId == null || MenuDO.ID_ROOT.equals(parentId);
    }

    /**
     * 判断任一Roles 是否满足业务条件。
     *
     * @param userId 用户编号
     * @param roles roles 参数
     * @return 业务条件成立时返回 true，否则返回 false
     */
    @Override
    public boolean hasAnyRoles(Long userId, String... roles) {
        // 如果为空，说明已经有权限
        if (ArrayUtil.isEmpty(roles)) {
            return true;
        }

        // 获得当前登录的角色。如果为空，说明没有权限
        String loginUserType = userService.getUserTypeOrDefault(userId);
        List<RoleDO> roleList = getEnableUserRoleListByUserIdFromCache(userId).stream()
                // 角色标识判断同样只在当前用户所属平台内生效。
                .filter(role -> AdminPlatformTypeEnum.isSame(role.getRoleType(), loginUserType))
                .toList();
        if (CollUtil.isEmpty(roleList)) {
            return false;
        }

        // 判断是否有角色
        Set<String> userRoles = convertSet(roleList, RoleDO::getCode);
        return CollUtil.containsAny(userRoles, Sets.newHashSet(roles));
    }

    // ========== 角色-菜单的相关方法  ==========

    /**
     * 分配角色菜单。
     *
     * @param roleId 角色编号
     * @param menuIds menuIds 编号集合
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    @Caching(evict = {
            @CacheEvict(value = RedisKeyConstants.MENU_ROLE_ID_LIST,
            allEntries = true),
            @CacheEvict(value = RedisKeyConstants.PERMISSION_MENU_ID_LIST,
            allEntries = true) // allEntries 清空所有缓存，主要一次更新涉及到的 menuIds 较多，反倒批量会更快
    })
    public void assignRoleMenu(Long roleId, Set<Long> menuIds) {
        validateRoleMenuPlatform(roleId, menuIds);
        // 获得角色拥有菜单编号
        Set<Long> dbMenuIds = convertSet(roleMenuMapper.selectListByRoleId(roleId), RoleMenuDO::getMenuId);
        // 计算新增和删除的菜单编号
        Set<Long> menuIdList = CollUtil.emptyIfNull(menuIds);
        Collection<Long> createMenuIds = CollUtil.subtract(menuIdList, dbMenuIds);
        Collection<Long> deleteMenuIds = CollUtil.subtract(dbMenuIds, menuIdList);
        // 执行新增和删除。对于已经授权的菜单，不用做任何处理
        if (CollUtil.isNotEmpty(createMenuIds)) {
            roleMenuMapper.insertBatch(CollectionUtils.convertList(createMenuIds, menuId -> {
                RoleMenuDO entity = new RoleMenuDO();
                entity.setRoleId(roleId);
                entity.setMenuId(menuId);
                return entity;
            }));
        }
        if (CollUtil.isNotEmpty(deleteMenuIds)) {
            roleMenuMapper.deleteListByRoleIdAndMenuIds(roleId, deleteMenuIds);
        }
    }

    /**
     * 处理角色Deleted。
     *
     * @param roleId 角色编号
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    @Caching(evict = {
            @CacheEvict(value = RedisKeyConstants.MENU_ROLE_ID_LIST,
                    allEntries = true), // allEntries 清空所有缓存，此处无法方便获得 roleId 对应的 menu 缓存们
            @CacheEvict(value = RedisKeyConstants.USER_ROLE_ID_LIST,
                    allEntries = true) // allEntries 清空所有缓存，此处无法方便获得 roleId 对应的 user 缓存们
    })
    public void processRoleDeleted(Long roleId) {
        // 标记删除 UserRole
        userRoleMapper.deleteListByRoleId(roleId);
        // 标记删除 RoleMenu
        roleMenuMapper.deleteListByRoleId(roleId);
    }

    /**
     * 处理菜单Deleted。
     *
     * @param menuId menuId 编号
     */
    @Override
    @CacheEvict(value = RedisKeyConstants.MENU_ROLE_ID_LIST, key = "#menuId")
    public void processMenuDeleted(Long menuId) {
        roleMenuMapper.deleteListByMenuId(menuId);
    }

    /**
     * 获取角色菜单ListBy角色Id。
     *
     * @param roleIds roleIds 编号集合
     * @return 查询或转换后的结果
     */
    @Override
    public Set<Long> getRoleMenuListByRoleId(Collection<Long> roleIds) {
        if (CollUtil.isEmpty(roleIds)) {
            return Collections.emptySet();
        }

        // 如果是管理员的情况下，获取全部菜单编号
        if (roleService.hasAnySuperAdmin(roleIds)) {
            return convertSet(menuService.getMenuList(), MenuDO::getId);
        }
        // 如果是非管理员的情况下，获得拥有的菜单编号
        return convertSet(roleMenuMapper.selectListByRoleId(roleIds), RoleMenuDO::getMenuId);
    }

    /**
     * 获取菜单角色IdListBy菜单IdFromCache。
     *
     * @param menuId menuId 编号
     * @return 查询或转换后的结果
     */
    @Override
    @Cacheable(value = RedisKeyConstants.MENU_ROLE_ID_LIST, key = "#menuId")
    public Set<Long> getMenuRoleIdListByMenuIdFromCache(Long menuId) {
        return convertSet(roleMenuMapper.selectListByMenuId(menuId), RoleMenuDO::getRoleId);
    }

    // ========== 用户-角色的相关方法  ==========

    /**
     * 分配用户角色。
     *
     * @param userId 用户编号
     * @param roleIds roleIds 编号集合
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    @CacheEvict(value = RedisKeyConstants.USER_ROLE_ID_LIST, key = "#userId")
    public void assignUserRole(Long userId, Set<Long> roleIds) {
        validateUserRolePlatform(userId, roleIds);
        // 获得角色拥有角色编号
        Set<Long> dbRoleIds = convertSet(userRoleMapper.selectListByUserId(userId),
                UserRoleDO::getRoleId);
        // 计算新增和删除的角色编号
        Set<Long> roleIdList = CollUtil.emptyIfNull(roleIds);
        Collection<Long> createRoleIds = CollUtil.subtract(roleIdList, dbRoleIds);
        Collection<Long> deleteMenuIds = CollUtil.subtract(dbRoleIds, roleIdList);
        // 执行新增和删除。对于已经授权的角色，不用做任何处理
        if (!CollectionUtil.isEmpty(createRoleIds)) {
            userRoleMapper.insertBatch(CollectionUtils.convertList(createRoleIds, roleId -> {
                UserRoleDO entity = new UserRoleDO();
                entity.setUserId(userId);
                entity.setRoleId(roleId);
                return entity;
            }));
        }
        if (!CollectionUtil.isEmpty(deleteMenuIds)) {
            userRoleMapper.deleteListByUserIdAndRoleIdIds(userId, deleteMenuIds);
        }
    }

    /**
     * 处理用户Deleted。
     *
     * @param userId 用户编号
     */
    @Override
    @CacheEvict(value = RedisKeyConstants.USER_ROLE_ID_LIST, key = "#userId")
    public void processUserDeleted(Long userId) {
        userRoleMapper.deleteListByUserId(userId);
    }

    /**
     * 获取用户角色IdListBy用户Id。
     *
     * @param userId 用户编号
     * @return 查询或转换后的结果
     */
    @Override
    public Set<Long> getUserRoleIdListByUserId(Long userId) {
        return convertSet(userRoleMapper.selectListByUserId(userId), UserRoleDO::getRoleId);
    }

    /**
     * 获取用户角色IdListBy用户IdFromCache。
     *
     * @param userId 用户编号
     * @return 查询或转换后的结果
     */
    @Override
    @Cacheable(value = RedisKeyConstants.USER_ROLE_ID_LIST, key = "#userId")
    public Set<Long> getUserRoleIdListByUserIdFromCache(Long userId) {
        return getUserRoleIdListByUserId(userId);
    }

    /**
     * 获取用户角色IdListBy角色Id。
     *
     * @param roleIds roleIds 编号集合
     * @return 查询或转换后的结果
     */
    @Override
    public Set<Long> getUserRoleIdListByRoleId(Collection<Long> roleIds) {
        return convertSet(userRoleMapper.selectListByRoleIds(roleIds), UserRoleDO::getUserId);
    }

    /**
     * 获得用户拥有的角色，并且这些角色是开启状态的
     *
     * @param userId 用户编号
     * @return 用户拥有的角色
     */
    @VisibleForTesting
    List<RoleDO> getEnableUserRoleListByUserIdFromCache(Long userId) {
        // 获得用户拥有的角色编号
        Set<Long> roleIds = getSelf().getUserRoleIdListByUserIdFromCache(userId);
        // 获得角色数组，并过滤被禁用的角色，避免修改缓存返回的集合。
        return roleService.getRoleListFromCache(roleIds).stream()
                .filter(role -> CommonStatusEnum.ENABLE.getStatus().equals(role.getStatus()))
                .toList();
    }

    // ========== 用户-部门的相关方法  ==========

    /**
     * 分配角色数据Scope。
     *
     * @param roleId 角色编号
     * @param dataScope dataScope 参数
     * @param dataScopeDeptIds dataScopeDeptIds 编号集合
     */
    @Override
    public void assignRoleDataScope(Long roleId, Integer dataScope, Set<Long> dataScopeDeptIds) {
        validateRolePlatform(roleId);
        Set<Long> holderUserIds = convertSet(
                userRoleMapper.selectListByRoleIds(Collections.singleton(roleId)), UserRoleDO::getUserId);
        List<AdminUserDO> holderUsers = CollUtil.isEmpty(holderUserIds)
                ? Collections.emptyList()
                : DataPermissionUtils.executeIgnore(() -> userService.getUserList(holderUserIds));
        validateOperatorDataScopeAuthority(dataScope, dataScopeDeptIds, holderUsers, true);
        roleService.updateRoleDataScope(roleId, dataScope, dataScopeDeptIds);
    }

    /**
     * 获取操作员在当前管理平台下处于启用状态的角色列表。
     *
     * @param operatorId    操作员编号
     * @param loginUserType 当前登录平台类型
     * @return 同平台启用角色列表
     */
    private List<RoleDO> getSamePlatformEnableRoles(Long operatorId, String loginUserType) {
        return getEnableUserRoleListByUserIdFromCache(operatorId).stream()
                .filter(role -> AdminPlatformTypeEnum.isSame(role.getRoleType(), loginUserType))
                .toList();
    }

    /**
     * 获取操作员在当前管理平台下处于启用状态的角色编号集合，防止跨平台历史超管角色绕过反提权校验。
     *
     * @param operatorId    操作员编号
     * @param loginUserType 当前登录平台类型
     * @return 同平台启用角色编号集合
     */
    private Set<Long> getSamePlatformEnableRoleIds(Long operatorId, String loginUserType) {
        return convertSet(getSamePlatformEnableRoles(operatorId, loginUserType), RoleDO::getId);
    }

    /**
     * 判断非超管操作员在当前平台下是否持有不低于目标动态数据范围的授权能力。
     *
     * @param operatorRoles   操作员同平台启用角色列表
     * @param targetDataScope 目标数据范围编码
     * @return 持有匹配或更宽动态数据范围能力时返回 true
     */
    private boolean hasSamePlatformDynamicScopeCapability(List<RoleDO> operatorRoles, Integer targetDataScope) {
        if (Objects.equals(targetDataScope, DataScopeEnum.DEPT_AND_CHILD.getScope())) {
            return operatorRoles.stream()
                    .anyMatch(role -> Objects.equals(role.getDataScope(), DataScopeEnum.DEPT_AND_CHILD.getScope()));
        }
        if (Objects.equals(targetDataScope, DataScopeEnum.DEPT_ONLY.getScope())) {
            return operatorRoles.stream().anyMatch(role ->
                    Objects.equals(role.getDataScope(), DataScopeEnum.DEPT_ONLY.getScope())
                            || Objects.equals(role.getDataScope(), DataScopeEnum.DEPT_AND_CHILD.getScope()));
        }
        return true;
    }

    /**
     * 校验非超管操作员授予角色的数据权限范围不得超越自身数据权限边界及受影响用户的部门边界。
     *
     * @param dataScope           目标数据范围
     * @param dataScopeDeptIds    指定部门数据范围集合
     * @param affectedUsers       受该角色影响的用户列表
     * @param includeOperatorDept 修改角色数据范围时同时校验操作员自身部门，防止空持有人角色后续越权复用
     */
    private void validateOperatorDataScopeAuthority(Integer dataScope, Set<Long> dataScopeDeptIds,
            List<AdminUserDO> affectedUsers, boolean includeOperatorDept) {
        Long operatorId = SecurityFrameworkUtils.getLoginUserId();
        if (operatorId == null) {
            // 缺少已认证操作者上下文时 fail-closed 拒绝，防止绕过数据权限反提权防线。
            throw exception(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED);
        }
        String loginUserType = userService.getLoginUserTypeOrDefault();
        List<RoleDO> operatorRoles = getSamePlatformEnableRoles(operatorId, loginUserType);
        Set<Long> operatorRoleIds = convertSet(operatorRoles, RoleDO::getId);
        if (roleService.hasAnySuperAdmin(operatorRoleIds)) {
            return;
        }
        DeptDataPermissionRespDTO operatorPerm = getDeptDataPermission(operatorId);
        if (Boolean.TRUE.equals(operatorPerm.getAll())) {
            return;
        }
        if (Objects.equals(dataScope, DataScopeEnum.ALL.getScope())) {
            throw exception(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED);
        }
        if (Objects.equals(dataScope, DataScopeEnum.DEPT_CUSTOM.getScope())) {
            validateDeptCustomAuthority(dataScopeDeptIds, operatorPerm, affectedUsers);
            return;
        }
        if (Objects.equals(dataScope, DataScopeEnum.DEPT_ONLY.getScope())
                || Objects.equals(dataScope, DataScopeEnum.DEPT_AND_CHILD.getScope())) {
            validateDynamicDeptAuthority(dataScope, operatorRoles, operatorPerm, operatorId,
                    affectedUsers, includeOperatorDept);
        }
    }

    /**
     * 校验自定义部门数据范围及其受影响用户的所属部门均不超过操作员自身可见部门集合。
     *
     * @param dataScopeDeptIds 指定的部门编号集合
     * @param operatorPerm     操作员当前部门数据权限
     * @param affectedUsers    受影响的用户集合
     */
    private void validateDeptCustomAuthority(Set<Long> dataScopeDeptIds, DeptDataPermissionRespDTO operatorPerm,
            List<AdminUserDO> affectedUsers) {
        if (CollUtil.isEmpty(dataScopeDeptIds) || !operatorPerm.getDeptIds().containsAll(dataScopeDeptIds)) {
            throw exception(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED);
        }
        // DEPT_CUSTOM 会在解析阶段隐式并入持有人自身 deptId，因此既有或目标持有人部门也必须在操作员授权范围内。
        for (AdminUserDO affectedUser : CollUtil.emptyIfNull(affectedUsers)) {
            if (affectedUser != null && affectedUser.getDeptId() != null
                    && !operatorPerm.getDeptIds().contains(affectedUser.getDeptId())) {
                throw exception(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED);
            }
        }
    }

    /**
     * 校验动态部门数据范围（本部门、本部门及以下）的授予权限与受影响用户部门子集关系。
     *
     * @param dataScope           目标数据范围
     * @param operatorRoles       操作员同平台启用角色列表
     * @param operatorPerm        操作员当前部门数据权限
     * @param operatorId          操作员用户编号
     * @param affectedUsers       受影响的用户集合
     * @param includeOperatorDept 是否一并校验操作员自身部门
     */
    private void validateDynamicDeptAuthority(Integer dataScope, List<RoleDO> operatorRoles,
            DeptDataPermissionRespDTO operatorPerm, Long operatorId,
            List<AdminUserDO> affectedUsers, boolean includeOperatorDept) {
        if (!hasSamePlatformDynamicScopeCapability(operatorRoles, dataScope)) {
            throw exception(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED);
        }
        Set<Long> deptIdsToVerify = new LinkedHashSet<>();
        if (includeOperatorDept) {
            AdminUserDO operator = DataPermissionUtils.executeIgnore(() -> userService.getUser(operatorId));
            if (operator == null || operator.getDeptId() == null) {
                throw exception(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED);
            }
            deptIdsToVerify.add(operator.getDeptId());
        }
        for (AdminUserDO affectedUser : CollUtil.emptyIfNull(affectedUsers)) {
            if (affectedUser == null || affectedUser.getDeptId() == null) {
                throw exception(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED);
            }
            deptIdsToVerify.add(affectedUser.getDeptId());
        }
        boolean includeChildren = Objects.equals(dataScope, DataScopeEnum.DEPT_AND_CHILD.getScope());
        for (Long deptId : deptIdsToVerify) {
            if (!operatorPerm.getDeptIds().contains(deptId)) {
                throw exception(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED);
            }
            if (includeChildren) {
                Set<Long> requiredDeptIds = new HashSet<>(
                        CollUtil.emptyIfNull(deptService.getChildDeptIdListFromCache(deptId)));
                requiredDeptIds.add(deptId);
                if (!operatorPerm.getDeptIds().containsAll(requiredDeptIds)) {
                    throw exception(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED);
                }
            }
        }
    }

    /**
     * 获取部门数据权限。
     *
     * @param userId 用户编号
     * @return 查询或转换后的结果
     */
    @Override
    @DataPermission(enable = false)
    public DeptDataPermissionRespDTO getDeptDataPermission(Long userId) {
        String loginUserType = userService.getUserTypeOrDefault(userId);
        // 仅聚合当前用户所属平台的启用角色，防止跨平台历史角色数据范围穿透。
        List<RoleDO> roles = getEnableUserRoleListByUserIdFromCache(userId).stream()
                .filter(role -> AdminPlatformTypeEnum.isSame(role.getRoleType(), loginUserType))
                .toList();

        DeptDataPermissionRespDTO result = new DeptDataPermissionRespDTO();
        if (CollUtil.isEmpty(roles)) {
            result.setSelf(true);
            return result;
        }

        Supplier<Long> userDeptId = Suppliers.memoize(() -> {
            AdminUserDO user = userService.getUser(userId);
            return user != null ? user.getDeptId() : null;
        });
        for (RoleDO role : roles) {
            if (role.getDataScope() == null) {
                continue;
            }
            if (Objects.equals(role.getDataScope(), DataScopeEnum.ALL.getScope())) {
                result.setAll(true);
                continue;
            }
            if (Objects.equals(role.getDataScope(), DataScopeEnum.DEPT_CUSTOM.getScope())) {
                CollUtil.addAll(result.getDeptIds(), role.getDataScopeDeptIds());
                CollectionUtils.addIfNotNull(result.getDeptIds(), userDeptId.get());
                continue;
            }
            if (Objects.equals(role.getDataScope(), DataScopeEnum.DEPT_ONLY.getScope())) {
                CollectionUtils.addIfNotNull(result.getDeptIds(), userDeptId.get());
                continue;
            }
            if (Objects.equals(role.getDataScope(), DataScopeEnum.DEPT_AND_CHILD.getScope())) {
                Long deptId = userDeptId.get();
                if (deptId != null) {
                    CollUtil.addAll(result.getDeptIds(), deptService.getChildDeptIdListFromCache(deptId));
                    CollectionUtils.addIfNotNull(result.getDeptIds(), deptId);
                }
                continue;
            }
            if (Objects.equals(role.getDataScope(), DataScopeEnum.SELF.getScope())) {
                result.setSelf(true);
                continue;
            }
            log.error("[getDeptDataPermission][loginUserId({}) roleId({}) dataScope({}) 无法处理]",
                    userId, role.getId(), role.getDataScope());
        }
        return result;
    }

    /**
     * 校验角色存在、非系统内置角色、同平台归属，且非超管操作员不得越权分配自身未持有的菜单。
     */
    private void validateRoleMenuPlatform(Long roleId, Set<Long> menuIds) {
        RoleDO role = validateRolePlatform(roleId);
        if (com.basicframework.module.system.enums.permission.RoleTypeEnum.SYSTEM.getType().equals(role.getType())) {
            throw exception(ErrorCodeConstants.ROLE_CAN_NOT_UPDATE_SYSTEM_TYPE_ROLE);
        }
        String loginUserType = userService.getLoginUserTypeOrDefault();
        // 空集合表示有意清空授权；非空时每个目标菜单都必须真实存在，避免写入悬空关联。
        List<MenuDO> menus = CollUtil.isEmpty(menuIds) ? Collections.emptyList() : menuService.getMenuList(menuIds);
        if (CollUtil.isNotEmpty(menuIds) && !convertSet(menus, MenuDO::getId).containsAll(menuIds)) {
            throw exception(ErrorCodeConstants.MENU_NOT_EXISTS);
        }
        for (MenuDO menu : menus) {
            if (!AdminPlatformTypeEnum.isSame(menu.getMenuType(), loginUserType)) {
                throw exception(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED);
            }
        }
        Long operatorId = SecurityFrameworkUtils.getLoginUserId();
        if (operatorId == null) {
            throw exception(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED);
        }
        if (CollUtil.isNotEmpty(menuIds)) {
            Set<Long> operatorRoleIds = getSamePlatformEnableRoleIds(operatorId, loginUserType);
            if (!roleService.hasAnySuperAdmin(operatorRoleIds)) {
                Set<Long> operatorMenuIds = getRoleMenuListByRoleId(operatorRoleIds);
                if (!operatorMenuIds.containsAll(menuIds)) {
                    throw exception(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED);
                }
            }
        }
    }

    /**
     * 校验目标用户存在（受调用方数据权限约束）、同平台归属，且非超管不得授予超管角色或超越自身权限边界的角色。
     */
    private void validateUserRolePlatform(Long userId, Set<Long> roleIds) {
        AdminUserDO user = userService.getUser(userId);
        if (user == null) {
            throw exception(ErrorCodeConstants.USER_NOT_EXISTS);
        }
        String loginUserType = userService.getLoginUserTypeOrDefault();
        if (!AdminPlatformTypeEnum.isSame(user.getUserType(), loginUserType)) {
            throw exception(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED);
        }
        Long operatorId = SecurityFrameworkUtils.getLoginUserId();
        if (operatorId == null) {
            throw exception(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED);
        }
        Set<Long> operatorRoleIds = getSamePlatformEnableRoleIds(operatorId, loginUserType);
        boolean operatorIsSuperAdmin = roleService.hasAnySuperAdmin(operatorRoleIds);
        // 非超管操作员禁止修改超级管理员的角色集合（包括传入空集合摘除超管角色）。
        if (!operatorIsSuperAdmin) {
            Set<Long> dbRoleIds = convertSet(userRoleMapper.selectListByUserId(userId), UserRoleDO::getRoleId);
            if (roleService.hasAnySuperAdmin(dbRoleIds)) {
                throw exception(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED);
            }
        }
        if (CollUtil.isNotEmpty(roleIds)) {
            roleService.validateRoleList(roleIds);
        }
        Set<Long> operatorMenuIds = null;
        for (RoleDO role : roleService.getRoleList(roleIds)) {
            if (!AdminPlatformTypeEnum.isSame(role.getRoleType(), loginUserType)) {
                throw exception(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED);
            }
            if (!operatorIsSuperAdmin && RoleCodeEnum.isSuperAdmin(role.getCode())) {
                throw exception(ErrorCodeConstants.ROLE_ADMIN_CODE_ERROR, role.getCode());
            }
            if (!operatorIsSuperAdmin) {
                validateOperatorDataScopeAuthority(role.getDataScope(), role.getDataScopeDeptIds(),
                        Collections.singletonList(user), false);
                Set<Long> targetRoleMenus = convertSet(
                        roleMenuMapper.selectListByRoleId(role.getId()), RoleMenuDO::getMenuId);
                if (CollUtil.isNotEmpty(targetRoleMenus)) {
                    if (operatorMenuIds == null) {
                        operatorMenuIds = getRoleMenuListByRoleId(operatorRoleIds);
                    }
                    if (!operatorMenuIds.containsAll(targetRoleMenus)) {
                        throw exception(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED);
                    }
                }
            }
        }
    }

    /**
     * 校验目标角色存在并归属当前登录平台。
     *
     * @param roleId 角色编号
     * @return 校验通过的角色记录
     */
    private RoleDO validateRolePlatform(Long roleId) {
        RoleDO role = roleService.getRole(roleId);
        if (role == null) {
            throw exception(ErrorCodeConstants.ROLE_NOT_EXISTS);
        }
        if (!AdminPlatformTypeEnum.isSame(role.getRoleType(), userService.getLoginUserTypeOrDefault())) {
            throw exception(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED);
        }
        return role;
    }

    /**
     * 获取Self。
     */
    private PermissionServiceImpl getSelf() {
        return SpringUtil.getBean(getClass());
    }

}
