package com.basicframework.module.system.dal.dataobject.auth;

import com.baomidou.mybatisplus.annotation.KeySequence;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.mybatis.core.dataobject.BaseDO;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 自动登录固定分享码 DO。
 *
 * <p>分享码长期有效，通过 status 字段统一控制是否允许继续使用。</p>
 * @author 李杰
 */
@TableName("system_auto_login_ticket")
@KeySequence("system_auto_login_ticket_seq")
@Data
@EqualsAndHashCode(callSuper = true)
public class AutoLoginTicketDO extends BaseDO {

    /**
     * 编号。
     */
    @TableId
    private Long id;

    /**
     * 固定分享码，对应链接中的 ticket 参数。
     */
    private String ticket;

    /**
     * 绑定的后台用户账号。
     */
    private String username;

    /**
     * 状态
     *
     * 枚举 {@link CommonStatusEnum}。
     */
    private Integer status;

    /**
     * 备注。
     */
    private String remark;

}
