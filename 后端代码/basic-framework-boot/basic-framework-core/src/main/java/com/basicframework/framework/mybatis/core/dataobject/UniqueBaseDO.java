package com.basicframework.framework.mybatis.core.dataobject;

import com.baomidou.mybatisplus.annotation.TableField;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.ToString;

/**
 * 含业务唯一索引的逻辑删除实体基类。
 *
 * <p>数据库表通过联合唯一索引 {@code (业务唯一键..., deleted_tag)} 解决逻辑删除后的重名重建问题：
 * 未删除记录固定为 {@code 0}，逻辑删除时由 {@code SoftDeleteUniqueInnerInterceptor} 自动将
 * {@code deleted_tag} 更新为主键 {@code id}，使任意次数的删除与同编码重建在 MySQL 与 H2 下均保持唯一性语义。</p>
 *
 * @author shady
 */
@Data
@EqualsAndHashCode(callSuper = true)
@ToString(callSuper = true)
public abstract class UniqueBaseDO extends BaseDO {

    /**
     * 逻辑删除唯一性消歧标识；未删除记录为 0，已删除记录自动写为主键编号。
     */
    @TableField("deleted_tag")
    private Long deletedTag;

}
