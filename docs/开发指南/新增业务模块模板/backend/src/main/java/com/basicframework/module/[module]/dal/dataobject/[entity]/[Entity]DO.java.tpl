package com.basicframework.module.[module].dal.dataobject.[entity];

import com.basicframework.framework.mybatis.core.dataobject.BaseDO;
import com.baomidou.mybatisplus.annotation.KeySequence;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * [entity-name]表 [table]。
 *
 * <p>继承 BaseDO 取得创建人、创建时间、更新人、更新时间与逻辑删除标记；逻辑删除由框架拦截器
 * 统一附加 deleted = 0 条件，业务查询不得自行绕过。字段与 Flyway 迁移文件中的表结构必须一致。</p>
 *
 * <p>占位符：[module]、[entity]、[Entity]、[entity-name]、[table]。</p>
 *
 * @author [author]
 */
@TableName("[table]")
@KeySequence("[table]_seq") // Oracle、PostgreSQL、Kingbase、DB2、H2 主键自增使用；MySQL 可走表自增
@Data
@EqualsAndHashCode(callSuper = true)
public class [Entity]DO extends BaseDO {

    /** 主键编号。 */
    @TableId
    private Long id;

    /** [entity-name]名称，业务唯一键。 */
    private String name;

    /** 状态：0 开启、1 关闭，取值见 CommonStatusEnum。 */
    private Integer status;

    /** 备注。 */
    private String remark;

}
