package com.basicframework.module.system.controller.admin.oauth2.vo.token;

import com.basicframework.framework.common.enums.UserTypeEnum;
import com.basicframework.framework.common.pojo.PageParam;
import com.basicframework.framework.common.validation.InEnum;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Size;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * OAuth2AccessTokenPageReqVO 请求对象，承载接口输入参数。
 *
 * @author shady
 */
@Schema(description = "管理后台 - 访问令牌分页 Request VO")
@Data
@EqualsAndHashCode(callSuper = true)
public class OAuth2AccessTokenPageReqVO extends PageParam {

    /**
     * 用户编号。
     */
    @Schema(description = "用户编号", example = "666")
    private Long userId;

    /**
     * 用户类型，参见 UserTypeEnum 枚举。
     */
    @Schema(description = "用户类型，参见 UserTypeEnum 枚举", example = "2")
    @InEnum(value = UserTypeEnum.class, message = "用户类型必须是 {value}")
    private Integer userType;

    /**
     * 客户端编号。
     */
    @Schema(description = "客户端编号", example = "portal-web")
    @Size(max = 255, message = "客户端编号长度不能超过 255 个字符")
    private String clientId;

}
