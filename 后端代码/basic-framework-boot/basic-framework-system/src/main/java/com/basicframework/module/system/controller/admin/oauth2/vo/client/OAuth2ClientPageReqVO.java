package com.basicframework.module.system.controller.admin.oauth2.vo.client;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.*;
import com.basicframework.framework.common.pojo.PageParam;

/**
 * OAuth2ClientPageReqVO 请求对象，承载接口输入参数。
 *
 * @author 李杰
 */
@Schema(description = "管理后台 - OAuth2 客户端分页 Request VO")
@Data
@EqualsAndHashCode(callSuper = true)
@ToString(callSuper = true)
public class OAuth2ClientPageReqVO extends PageParam {

    /**
     * 应用名，模糊匹配。
     */
    @Schema(description = "应用名，模糊匹配", example = "土豆")
    private String name;

    /**
     * 状态，参见 CommonStatusEnum 枚举。
     */
    @Schema(description = "状态，参见 CommonStatusEnum 枚举", example = "1")
    private Integer status;

}
