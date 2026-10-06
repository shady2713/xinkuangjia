package com.basicframework.module.system.controller.admin.oauth2.vo.token;

import com.basicframework.framework.common.pojo.PageParam;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * OAuth2AccessTokenPageReqVO 请求对象，承载接口输入参数。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/oauth2/vo/token/OAuth2AccessTokenPageReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地补充注释 9 行。
 */
@Schema(description = "管理后台 - 访问令牌分页 Request VO")
@Data
@EqualsAndHashCode(callSuper = true)
public class OAuth2AccessTokenPageReqVO extends PageParam {

    /**
     * 用户编号。
     */
    @Schema(description = "用户编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "666")
    private Long userId;

    /**
     * 用户类型，参见 UserTypeEnum 枚举。
     */
    @Schema(description = "用户类型，参见 UserTypeEnum 枚举", requiredMode = Schema.RequiredMode.REQUIRED, example = "2")
    private Integer userType;

    /**
     * 客户端编号。
     */
    @Schema(description = "客户端编号", requiredMode = Schema.RequiredMode.REQUIRED, example = "2")
    private String clientId;

}
