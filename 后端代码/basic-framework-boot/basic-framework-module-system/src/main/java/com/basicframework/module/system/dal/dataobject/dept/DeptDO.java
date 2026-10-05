package com.basicframework.module.system.dal.dataobject.dept;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.mybatis.core.dataobject.BaseDO;
import com.basicframework.module.system.dal.dataobject.user.AdminUserDO;
import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.KeySequence;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 部门表
 *
 * @author 李杰
 */
@TableName("system_dept")
@KeySequence("system_dept_seq") // 用于 Oracle、PostgreSQL、Kingbase、DB2、H2 数据库的主键自增。如果是 MySQL 等数据库，可不写。
@Data
@EqualsAndHashCode(callSuper = true)
public class DeptDO extends BaseDO {

    /**
     * 根部门的父编号；parentId 等于该值表示顶级部门，校验上级时直接跳过。
     */
    public static final Long PARENT_ID_ROOT = 0L;

    /**
     * 部门 ID。
     */
    @TableId
    private Long id;
    /**
     * 部门名称。
     */
    private String name;
    /** 所属管理平台，映射既有 role_type 列；由服务端登录上下文确定，创建后不可跨平台迁移。 */
    private String roleType;
    /**
     * 父部门 ID
     *
     * 关联 {@link #id}。
     */
    private Long parentId;
    /**
     * 显示顺序。
     */
    private Integer sort;
    /**
     * 负责人
     *
     * 关联 {@link AdminUserDO#getId()}。
     */
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private Long leaderUserId;
    /**
     * 联系电话。
     */
    private String phone;
    /**
     * 邮箱。
     */
    private String email;
    /**
     * 部门状态
     *
     * 枚举 {@link CommonStatusEnum}。
     */
    private Integer status;

}
