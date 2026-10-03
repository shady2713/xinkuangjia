package com.basicframework.module.infra.controller.admin.file.vo.file;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.Map;

/**
 * 文件预签名上传信息。
 *
 * @author 李杰
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
