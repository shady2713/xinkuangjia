package com.basicframework.module.system.service.permission;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.collection.CollectionUtil;
import cn.hutool.core.util.ArrayUtil;
import cn.hutool.extra.spring.SpringUtil;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.util.collection.CollectionUtils;
import com.basicframework.framework.datapermission.core.annotation.DataPermission;
import com.basicframework.framework.common.biz.system.permission.dto.DeptDataPermissionRespDTO;
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
import com.basicframework.module.system.service.dept.DeptService;
import com.basicframework.module.system.service.user.AdminUserService;
import com.baomidou.dynamic.datasource.annotation.DSTransactional;
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

import static com.basicframework.framework.common.util.collection.CollectionUtils.convertSet;
import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED;

/**
 * 权限 Service 实现类
 *
 * @author 李杰
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
                // permission 也必须落在当前平台菜单下，避免跨平台权限穿透。
                .filter(menu -> AdminPlatformTypeEnum.isSame(menu.getMenuType(), loginUserType))
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
                    // 内置超管也只对当前平台菜单生效，不能跨到另一个平台。
                    .anyMatch(menu -> AdminPlatformTypeEnum.isSame(menu.getMenuType(), loginUserType));
            if (existsInCurrentPlatform) {
                return true;
            }
        }
        return false;
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
    @DSTransactional // 多数据源，使用 @DSTransactional 保证本地事务，以及数据源的切换
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
    @DSTransactional // 多数据源，使用 @DSTransactional 保证本地事务，以及数据源的切换
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
        roleService.updateRoleDataScope(roleId, dataScope, dataScopeDeptIds);
    }

    /**
     * 获取部门数据权限。
     *
     * @param userId 用户编号
     * @return 查询或转换后的结果
     */
    @Override
    @DataPermission(enable = false) // 关闭数据权限，不然就会出现递归获取数据权限的问题
    public DeptDataPermissionRespDTO getDeptDataPermission(Long userId) {
        // 获得用户的角色
        List<RoleDO> roles = getEnableUserRoleListByUserIdFromCache(userId);

        // 如果角色为空，则只能查看自己
        DeptDataPermissionRespDTO result = new DeptDataPermissionRespDTO();
        if (CollUtil.isEmpty(roles)) {
            result.setSelf(true);
            return result;
        }

        // 获得用户的部门编号的缓存，通过 Guava 的 Suppliers 惰性求值，即有且仅有第一次发起 DB 的查询
        Supplier<Long> userDeptId = Suppliers.memoize(() -> userService.getUser(userId).getDeptId());
        // 遍历每个角色，计算
        for (RoleDO role : roles) {
            // 为空时，跳过
            if (role.getDataScope() == null) {
                continue;
            }
            // 情况一，ALL
            if (Objects.equals(role.getDataScope(), DataScopeEnum.ALL.getScope())) {
                result.setAll(true);
                continue;
            }
            // 情况二，DEPT_CUSTOM
            if (Objects.equals(role.getDataScope(), DataScopeEnum.DEPT_CUSTOM.getScope())) {
                CollUtil.addAll(result.getDeptIds(), role.getDataScopeDeptIds());
                // 自定义可见部门时，保证可以看到自己所在的部门。否则，一些场景下可能会有问题。
                // 例如说，登录时，基于 t_user 的 username 查询会可能被 dept_id 过滤掉
                CollUtil.addAll(result.getDeptIds(), userDeptId.get());
                continue;
            }
            // 情况三，DEPT_ONLY
            if (Objects.equals(role.getDataScope(), DataScopeEnum.DEPT_ONLY.getScope())) {
                CollectionUtils.addIfNotNull(result.getDeptIds(), userDeptId.get());
                continue;
            }
            // 情况四，DEPT_DEPT_AND_CHILD
            if (Objects.equals(role.getDataScope(), DataScopeEnum.DEPT_AND_CHILD.getScope())) {
                CollUtil.addAll(result.getDeptIds(), deptService.getChildDeptIdListFromCache(userDeptId.get()));
                // 添加本身部门编号
                CollUtil.addAll(result.getDeptIds(), userDeptId.get());
                continue;
            }
            // 情况五，SELF
            if (Objects.equals(role.getDataScope(), DataScopeEnum.SELF.getScope())) {
                result.setSelf(true);
                continue;
            }
            // 未知情况，error log 即可
            log.error("[getDeptDataPermission][loginUserId({}) roleId({}) dataScope({}) 无法处理]",
                    userId, role.getId(), role.getDataScope());
        }
        return result;
    }

    /**
     * 获得自身的代理对象，解决 AOP 生效问题
     *
     * @return 自己
     */
    private void validateRoleMenuPlatform(Long roleId, Set<Long> menuIds) {
        validateRolePlatform(roleId);
        String loginUserType = userService.getLoginUserTypeOrDefault();
        for (MenuDO menu : menuService.getMenuList(menuIds)) {
            // 角色只能绑定同平台菜单，防止当前平台角色拿到新管理平台菜单权限。
            if (!AdminPlatformTypeEnum.isSame(menu.getMenuType(), loginUserType)) {
                throw exception(SYSTEM_PLATFORM_ACCESS_DENIED);
            }
        }
    }

    /**
     * 校验 validateUserRolePlatform 对应的输入与业务约束。
     */
    private void validateUserRolePlatform(Long userId, Set<Long> roleIds) {
        AdminUserDO user = userService.getUser(userId);
        String loginUserType = userService.getLoginUserTypeOrDefault();
        if (user != null && !AdminPlatformTypeEnum.isSame(user.getUserType(), loginUserType)) {
            throw exception(SYSTEM_PLATFORM_ACCESS_DENIED);
        }
        for (RoleDO role : roleService.getRoleList(roleIds)) {
            // 用户只能绑定同平台角色，防止当前平台账号被授予新管理平台角色。
            if (!AdminPlatformTypeEnum.isSame(role.getRoleType(), loginUserType)) {
                throw exception(SYSTEM_PLATFORM_ACCESS_DENIED);
            }
        }
    }

    /**
     * 校验 validateRolePlatform 对应的输入与业务约束。
     */
    private void validateRolePlatform(Long roleId) {
        RoleDO role = roleService.getRole(roleId);
        if (role != null && !AdminPlatformTypeEnum.isSame(role.getRoleType(), userService.getLoginUserTypeOrDefault())) {
            throw exception(SYSTEM_PLATFORM_ACCESS_DENIED);
        }
    }

    /**
     * 获取Self。
     */
    private PermissionServiceImpl getSelf() {
        return SpringUtil.getBean(getClass());
    }

}
