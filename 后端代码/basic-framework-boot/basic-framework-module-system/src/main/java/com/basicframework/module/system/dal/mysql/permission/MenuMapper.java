package com.basicframework.module.system.dal.mysql.permission;

import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.system.controller.admin.permission.vo.menu.MenuListReqVO;
import com.basicframework.module.system.dal.dataobject.permission.MenuDO;
import org.apache.ibatis.annotations.Mapper;

import java.util.List;

/**
 * MenuMapper 数据访问接口，负责持久化查询与写入。
 *
 * @author 李杰
 */
@Mapper
public interface MenuMapper extends BaseMapperX<MenuDO> {

    /**
     * 查询By父级编号And名称。
     *
     * @param parentId 父级编号
     * @param name 名称
     * @return 查询结果
     */
    default MenuDO selectByParentIdAndName(Long parentId, String name) {
        return selectOne(MenuDO::getParentId, parentId, MenuDO::getName, name);
    }

    /**
     * 查询数量By父级编号。
     *
     * @param parentId 父级编号
     * @return 统计数量
     */
    default Long selectCountByParentId(Long parentId) {
        return selectCount(MenuDO::getParentId, parentId);
    }

    /**
     * 查询列表。
     *
     * @param reqVO 请求参数
     * @return 查询结果
     */
    default List<MenuDO> selectList(MenuListReqVO reqVO) {
        return selectList(new LambdaQueryWrapperX<MenuDO>()
                .likeIfPresent(MenuDO::getName, reqVO.getName())
                .eqIfPresent(MenuDO::getStatus, reqVO.getStatus())
                .eqIfPresent(MenuDO::getMenuType, reqVO.getMenuType()));
    }

    /**
     * 查询列表By权限。
     *
     * @param permission 权限参数
     * @return 查询结果
     */
    default List<MenuDO> selectListByPermission(String permission) {
        return selectList(MenuDO::getPermission, permission);
    }

    /**
     * 查询列表By菜单类型。
     *
     * @param menuType 菜单类型参数
     * @return 查询结果
     */
    default List<MenuDO> selectListByMenuType(String menuType) {
        return selectList(MenuDO::getMenuType, menuType);
    }

    /**
     * 查询ByComponent名称。
     *
     * @param componentName component名称参数
     * @return 查询结果
     */
    default MenuDO selectByComponentName(String componentName) {
        return selectOne(MenuDO::getComponentName, componentName);
    }

}
