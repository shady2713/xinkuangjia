package com.basicframework.module.system.dal.dataobject.oauth2;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.mybatis.core.dataobject.UniqueBaseDO;
import com.basicframework.module.system.enums.oauth2.OAuth2GrantTypeEnum;
import com.baomidou.mybatisplus.annotation.KeySequence;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.util.List;

/**
 * OAuth2 客户端 DO（面向第三方开放 API {@code client_credentials} 授权接入）。
 *
 * @author 李杰
 */
@TableName(value = "system_oauth2_client", autoResultMap = true)
@KeySequence("system_oauth2_client_seq")
@Data
@EqualsAndHashCode(callSuper = true)
public class OAuth2ClientDO extends UniqueBaseDO {

    @TableId
    private Long id;

    /** 客户端编号。 */
    private String clientId;

    /** 客户端密钥（BCrypt 哈希）。 */
    private String secret;

    /** 应用名。 */
    private String name;

    /** 应用描述。 */
    private String description;

    /** 状态，参见 {@link CommonStatusEnum}。 */
    private Integer status;

    /** 访问令牌有效期（秒）。 */
    private Integer accessTokenValiditySeconds;

    /** 刷新令牌有效期（秒）。 */
    private Integer refreshTokenValiditySeconds;

    /** 授权类型，参见 {@link OAuth2GrantTypeEnum}。 */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<String> authorizedGrantTypes;

    /** 授权范围。 */
    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<String> scopes;

}
