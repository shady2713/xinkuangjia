package com.basicframework.module.system.dal.dataobject.dict;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.mybatis.core.dataobject.UniqueBaseDO;
import com.baomidou.mybatisplus.annotation.KeySequence;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;
import lombok.ToString;

/**
 * 字典类型表。
 *
 * @author shady
 */
@TableName("system_dict_type")
@KeySequence("system_dict_type_seq")
@Data
@EqualsAndHashCode(callSuper = true)
@ToString(callSuper = true)
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DictTypeDO extends UniqueBaseDO {

    /**
     * 字典主键。
     */
    @TableId
    private Long id;
    /**
     * 字典名称。
     */
    private String name;
    /**
     * 字典类型。
     */
    private String type;
    /**
     * 状态，参见 {@link CommonStatusEnum}。
     */
    private Integer status;
    /**
     * 备注。
     */
    private String remark;

}
