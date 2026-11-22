package com.basicframework.module.system.dal.dataobject.permission;

import com.basicframework.framework.mybatis.core.dataobject.BaseDO;
import com.baomidou.mybatisplus.annotation.KeySequence;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 角色和菜单关联
 *
 * @author 李杰
 */
@TableName("system_role_menu")
@KeySequence("system_role_menu_seq") // 用于 Oracle、PostgreSQL、Kingbase、DB2、H2 数据库的主键自增。如果是 MySQL 等数据库，可不写。
@Data
@EqualsAndHashCode(callSuper = true)
public class RoleMenuDO extends BaseDO {

    /**
     * 自增主键。
     */
    @TableId
    private Long id;
    /**
     * 角色 ID。
     */
    private Long roleId;
    /**
     * 菜单 ID。
     */
    private Long menuId;

}
