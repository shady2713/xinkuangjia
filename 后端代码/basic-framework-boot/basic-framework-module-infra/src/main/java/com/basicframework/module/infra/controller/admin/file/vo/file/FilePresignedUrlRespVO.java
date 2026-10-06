package com.basicframework.module.infra.controller.admin.file.vo.file;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.Map;

/**
 * 文件预签名上传信息。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-infra/src/main/java/cn/iocoder/yudao/module/infra/controller/admin/file/vo/file/FilePresignedUrlRespVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配、配置前缀由 yudao.* 改为 basic-framework.*；本地改写/新增代码 3 行，上游代码 4 行在本地被移除或改写，例如 example = "https://s3.example.com/basic-framework/example.png?X-Amz-Signature=CHANGE_ME_SIGNATURE")；private Map<String, String> headers;；本地补充注释 4 行，上游注释 6 行未保留。
 */
@AllArgsConstructor
@NoArgsConstructor
@Schema(description = "管理后台 - 文件预签名地址 Response VO")
@Data
public class FilePresignedUrlRespVO {

    /**
     * 文件上传 URL。
     */
    @Schema(description = "文件上传 URL", requiredMode = Schema.RequiredMode.REQUIRED,
            example = "https://s3.example.com/basic-framework/example.png?X-Amz-Signature=CHANGE_ME_SIGNATURE")
    private String uploadUrl;

    /** PUT 必须携带的签名请求头；Content-Length 由浏览器按实际文件设置。 */
    private Map<String, String> headers;

    /**
     * 预约的最终访问地址；必须等待完成接口成功后才可作为有效文件使用。
     */
    @Schema(description = "文件访问 URL", requiredMode = Schema.RequiredMode.REQUIRED,
            example = "https://test.basic-framework.example.com/758d3a5387507358c7236de4c8f96de1c7f5097ff6a7722b34772fb7b76b140f.png")
    private String url;

    /**
     * 预约的最终对象键，完成接口据此核对服务端记录及当前登录用户。
     */
    @Schema(description = "文件路径", requiredMode = Schema.RequiredMode.REQUIRED, example = "xxx.png")
    private String path;

}
