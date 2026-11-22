package com.basicframework.framework.mybatis.core.dataobject;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableLogic;
import lombok.Data;
import org.apache.ibatis.type.JdbcType;

import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * MyBatis 基础实体对象，提供审计字段与软删除标记。
 *
 * @author 李杰
 */
@Data
public abstract class BaseDO implements Serializable {

    /**
     * 创建时间。
     */
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    /**
     * 最后更新时间。
     */
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;

    /**
     * 创建者编号。
     */
    @TableField(fill = FieldFill.INSERT, jdbcType = JdbcType.VARCHAR)
    private String creator;

    /**
     * 更新者编号。
     */
    @TableField(fill = FieldFill.INSERT_UPDATE, jdbcType = JdbcType.VARCHAR)
    private String updater;

    /**
     * 是否删除。
     */
    @TableLogic
    private Boolean deleted;

    /**
     * 清空自动填充字段，避免更新入参直接覆盖审计列。
     */
    public void clean() {
        this.creator = null;
        this.createTime = null;
        this.updater = null;
        this.updateTime = null;
    }

}
