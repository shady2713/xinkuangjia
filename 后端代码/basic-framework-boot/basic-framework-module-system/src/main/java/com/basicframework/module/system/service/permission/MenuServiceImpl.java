package com.basicframework.module.system.service.permission;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.ObjUtil;
import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.module.system.controller.admin.permission.vo.menu.MenuListReqVO;
import com.basicframework.module.system.controller.admin.permission.vo.menu.MenuSaveVO;
import com.basicframework.module.system.dal.dataobject.permission.MenuDO;
import com.basicframework.module.system.dal.mysql.permission.MenuMapper;
import com.basicframework.module.system.dal.redis.RedisKeyConstants;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.enums.common.AdminPlatformTypeEnum;
import com.basicframework.module.system.enums.permission.MenuTypeEnum;

import com.google.common.annotations.VisibleForTesting;
import com.google.common.collect.Lists;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.framework.common.util.collection.CollectionUtils.convertList;
import static com.basicframework.framework.common.util.collection.CollectionUtils.convertMap;
import static com.basicframework.module.system.dal.dataobject.permission.MenuDO.ID_ROOT;

/**
 * 菜单 Service 实现，负责菜单树维护、层级约束校验和权限缓存失效。
 *
 * @author 李杰
 */
@Service
@Slf4j
public class MenuServiceImpl implements MenuService {

    @Resource
    private MenuMapper menuMapper;
    @Resource
    private ObjectProvider<PermissionService> permissionServiceProvider;


    /**
     * 创建菜单。
     *
     * @param createReqVO createReqVO 参数
     * @return 操作结果
     */
    @Override
    @CacheEvict(value = RedisKeyConstants.PERMISSION_MENU_ID_LIST, key = "#createReqVO.permission",
            condition = "#createReqVO.permission != null")
    public Long createMenu(MenuSaveVO createReqVO) {
        // 校验父菜单存在
        validateParentMenu(createReqVO.getParentId(), null);
        validateParentMenuType(createReqVO.getParentId(), createReqVO.getMenuType());
        // 校验菜单（自己）
        validateMenuName(createReqVO.getParentId(), createReqVO.getName(), null);
        validateMenuComponentName(createReqVO.getComponentName(), null);

        // 插入数据库
        MenuDO menu = BeanUtils.toBean(createReqVO, MenuDO.class);
        initMenuProperty(menu);
        menuMapper.insert(menu);
        // 返回
        return menu.getId();
    }

    /**
     * 更新菜单。
     *
     * @param updateReqVO updateReqVO 参数
     */
    @Override
    @CacheEvict(value = RedisKeyConstants.PERMISSION_MENU_ID_LIST,
            allEntries = true) // allEntries 清空所有缓存，因为 permission 如果变更，涉及到新老两个 permission。直接清理，简单有效
    public void updateMenu(MenuSaveVO updateReqVO) {
        // 校验更新的菜单是否存在
        if (menuMapper.selectById(updateReqVO.getId()) == null) {
            throw exception(ErrorCodeConstants.MENU_NOT_EXISTS);
        }
        // 校验父菜单存在
        validateParentMenu(updateReqVO.getParentId(), updateReqVO.getId());
        validateParentMenuType(updateReqVO.getParentId(), updateReqVO.getMenuType());
        // 校验菜单（自己）
        validateMenuName(updateReqVO.getParentId(), updateReqVO.getName(), updateReqVO.getId());
        validateMenuComponentName(updateReqVO.getComponentName(), updateReqVO.getId());

        // 更新到数据库
        MenuDO updateObj = BeanUtils.toBean(updateReqVO, MenuDO.class);
        initMenuProperty(updateObj);
        menuMapper.updateById(updateObj);
    }

    /**
     * 删除菜单。
     *
     * @param id 主键编号
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    @CacheEvict(value = RedisKeyConstants.PERMISSION_MENU_ID_LIST,
            allEntries = true) // allEntries 清空所有缓存，因为此时不知道 id 对应的 permission 是多少。直接清理，简单有效
    public void deleteMenu(Long id) {
        // 校验是否还有子菜单
        if (menuMapper.selectCountByParentId(id) > 0) {
            throw exception(ErrorCodeConstants.MENU_EXISTS_CHILDREN);
        }
        // 校验删除的菜单是否存在
        if (menuMapper.selectById(id) == null) {
            throw exception(ErrorCodeConstants.MENU_NOT_EXISTS);
        }
        // 标记删除
        menuMapper.deleteById(id);
        // 删除授予给角色的权限
        getPermissionService().processMenuDeleted(id);
    }

    /**
     * 删除菜单List。
     *
     * @param ids ids 编号集合
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    @CacheEvict(value = RedisKeyConstants.PERMISSION_MENU_ID_LIST,
            allEntries = true) // allEntries 清空所有缓存，因为 Spring Cache 不支持按照 ids 批量删除
    public void deleteMenuList(List<Long> ids) {
        // 校验是否还有子菜单
        ids.forEach(id -> {
            if (menuMapper.selectCountByParentId(id) > 0) {
                throw exception(ErrorCodeConstants.MENU_EXISTS_CHILDREN);
            }
        });

        // 标记删除
        menuMapper.deleteByIds(ids);
        // 删除授予给角色的权限
        ids.forEach(id -> getPermissionService().processMenuDeleted(id));
    }

    /**
     * 获取菜单List。
     *
     * @return 查询或转换后的结果
     */
    @Override
    public List<MenuDO> getMenuList() {
        return menuMapper.selectList();
    }

    /**
     * 获取菜单ListBy菜单类型。
     *
     * @param menuType menuType 参数
     * @return 查询或转换后的结果
     */
    @Override
    public List<MenuDO> getMenuListByMenuType(String menuType) {
        return menuMapper.selectListByMenuType(AdminPlatformTypeEnum.defaultType(menuType));
    }

    /**
     * 获取菜单ListFiltered。
     *
     * @param reqVO 请求参数
     * @return 查询或转换后的结果
     */
    @Override
    public List<MenuDO> getMenuListFiltered(MenuListReqVO reqVO) {
        return getMenuList(reqVO);
    }

    /**
     * 过滤已禁用及父级不可见的菜单。
     *
     * @param menuList menuList 数据集合
     * @return 方法处理结果
     */
    @Override
    public List<MenuDO> filterDisableMenus(List<MenuDO> menuList) {
        if (CollUtil.isEmpty(menuList)){
            return Collections.emptyList();
        }
        Map<Long, MenuDO> menuMap = convertMap(menuList, MenuDO::getId);

        // 遍历 menu 菜单，查找不是禁用的菜单，添加到 enabledMenus 结果
        List<MenuDO> enabledMenus = new ArrayList<>();
        Set<Long> disabledMenuCache = new HashSet<>(); // 存下递归搜索过被禁用的菜单，防止重复的搜索
        for (MenuDO menu : menuList) {
            if (isMenuDisabled(menu, menuMap, disabledMenuCache)) {
                continue;
            }
            enabledMenus.add(menu);
        }
        return enabledMenus;
    }

    /**
     * 判断菜单Disabled 是否满足业务条件。
     */
    private boolean isMenuDisabled(MenuDO node, Map<Long, MenuDO> menuMap, Set<Long> disabledMenuCache) {
        // 如果已经判定是禁用的节点，直接结束
        if (disabledMenuCache.contains(node.getId())) {
            return true;
        }

        // 1. 先判断自身是否禁用
        if (CommonStatusEnum.isDisable(node.getStatus())) {
            disabledMenuCache.add(node.getId());
            return true;
        }

        // 2. 遍历到 parentId 为根节点，则无需判断
        Long parentId = node.getParentId();
        if (ObjUtil.equal(parentId, ID_ROOT)) {
            return false;
        }

        // 3. 继续遍历 parent 节点
        MenuDO parent = menuMap.get(parentId);
        if (parent == null || isMenuDisabled(parent, menuMap, disabledMenuCache)) {
            disabledMenuCache.add(node.getId());
            return true;
        }
        return false;
    }

    /**
     * 获取菜单List。
     *
     * @param reqVO 请求参数
     * @return 查询或转换后的结果
     */
    @Override
    public List<MenuDO> getMenuList(MenuListReqVO reqVO) {
        return menuMapper.selectList(reqVO);
    }

    /**
     * 获取菜单IdListBy权限FromCache。
     *
     * @param permission permission 参数
     * @return 查询或转换后的结果
     */
    @Override
    @Cacheable(value = RedisKeyConstants.PERMISSION_MENU_ID_LIST, key = "#permission")
    public List<Long> getMenuIdListByPermissionFromCache(String permission) {
        List<MenuDO> menus = menuMapper.selectListByPermission(permission);
        return convertList(menus, MenuDO::getId);
    }

    /**
     * 获取菜单。
     *
     * @param id 主键编号
     * @return 查询或转换后的结果
     */
    @Override
    public MenuDO getMenu(Long id) {
        return menuMapper.selectById(id);
    }

    /**
     * 获取菜单List。
     *
     * @param ids ids 编号集合
     * @return 查询或转换后的结果
     */
    @Override
    public List<MenuDO> getMenuList(Collection<Long> ids) {
        // 当 ids 为空时，返回一个空的实例对象
        if (CollUtil.isEmpty(ids)) {
            return Lists.newArrayList();
        }
        return menuMapper.selectByIds(ids);
    }

    /**
     * 校验父菜单是否合法
     * <p>
     * 1. 不能设置自己为父菜单
     * 2. 父菜单不存在
     * 3. 父菜单必须是 {@link MenuTypeEnum#MENU} 菜单类型
     *
     * @param parentId 父菜单编号
     * @param childId  当前菜单编号
     */
    @VisibleForTesting
    void validateParentMenu(Long parentId, Long childId) {
        if (parentId == null || ID_ROOT.equals(parentId)) {
            return;
        }
        // 不能设置自己为父菜单
        if (parentId.equals(childId)) {
            throw exception(ErrorCodeConstants.MENU_PARENT_ERROR);
        }
        MenuDO menu = menuMapper.selectById(parentId);
        // 父菜单不存在
        if (menu == null) {
            throw exception(ErrorCodeConstants.MENU_PARENT_NOT_EXISTS);
        }
        // 父菜单必须是目录或者菜单类型
        if (!MenuTypeEnum.DIR.getType().equals(menu.getType())
                && !MenuTypeEnum.MENU.getType().equals(menu.getType())) {
            throw exception(ErrorCodeConstants.MENU_PARENT_NOT_DIR_OR_MENU);
        }
    }

    /**
     * 校验父子菜单所属平台一致，避免新管理平台菜单挂到当前业务平台目录下。
     */
    private void validateParentMenuType(Long parentId, String menuType) {
        if (parentId == null || ID_ROOT.equals(parentId)) {
            return;
        }
        MenuDO parentMenu = menuMapper.selectById(parentId);
        if (parentMenu == null) {
            return;
        }
        if (!AdminPlatformTypeEnum.isSame(parentMenu.getMenuType(), menuType)) {
            throw exception(ErrorCodeConstants.SYSTEM_PLATFORM_ACCESS_DENIED);
        }
    }

    /**
     * 校验菜单是否合法
     * <p>
     * 1. 校验相同父菜单编号下，是否存在相同的菜单名
     *
     * @param name     菜单名字
     * @param parentId 父菜单编号
     * @param id       菜单编号
     */
    @VisibleForTesting
    void validateMenuName(Long parentId, String name, Long id) {
        MenuDO menu = menuMapper.selectByParentIdAndName(parentId, name);
        if (menu == null) {
            return;
        }
        // 如果 id 为空，说明不用比较是否为相同 id 的菜单
        if (id == null) {
            throw exception(ErrorCodeConstants.MENU_NAME_DUPLICATE);
        }
        if (!menu.getId().equals(id)) {
            throw exception(ErrorCodeConstants.MENU_NAME_DUPLICATE);
        }
    }

    /**
     * 校验菜单组件名是否合法
     *
     * @param componentName 组件名
     * @param id            菜单编号
     */
    @VisibleForTesting
    void validateMenuComponentName(String componentName, Long id) {
        if (StrUtil.isBlank(componentName)) {
            return;
        }
        MenuDO menu = menuMapper.selectByComponentName(componentName);
        if (menu == null) {
            return;
        }
        // 如果 id 为空，说明不用比较是否为相同 id 的菜单
        if (id == null) {
            throw exception(ErrorCodeConstants.MENU_COMPONENT_NAME_DUPLICATE);
        }
        if (!menu.getId().equals(id)) {
            throw exception(ErrorCodeConstants.MENU_COMPONENT_NAME_DUPLICATE);
        }
    }

    /**
     * 获取权限Service。
     */
    private PermissionService getPermissionService() {
        return permissionServiceProvider.getObject();
    }

    /**
     * 初始化菜单的通用属性。
     * <p>
     * 例如说，只有目录或者菜单类型的菜单，才设置 icon
     *
     * @param menu 菜单
     */
    private void initMenuProperty(MenuDO menu) {
        // 菜单平台类型是菜单树隔离边界，缺省按历史业务平台处理。
        menu.setMenuType(AdminPlatformTypeEnum.defaultType(menu.getMenuType()));
        // 菜单为按钮类型时，无需 component、icon、path 属性，进行置空
        if (MenuTypeEnum.BUTTON.getType().equals(menu.getType())) {
            menu.setComponent("");
            menu.setComponentName("");
            menu.setIcon("");
            menu.setPath("");
        }
    }

}
