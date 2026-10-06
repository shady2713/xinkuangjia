package com.basicframework.module.system.controller.admin.oauth2.vo.client;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.*;
import com.basicframework.framework.common.pojo.PageParam;

/**
 * OAuth2ClientPageReqVO 请求对象，承载接口输入参数。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/controller/admin/oauth2/vo/client/OAuth2ClientPageReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地补充注释 6 行。
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
