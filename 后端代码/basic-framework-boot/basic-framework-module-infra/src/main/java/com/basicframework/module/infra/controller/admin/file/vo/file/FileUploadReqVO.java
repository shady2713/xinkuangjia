package com.basicframework.module.infra.controller.admin.file.vo.file;

import com.basicframework.module.infra.framework.file.core.utils.FilePathUtils;
import com.fasterxml.jackson.annotation.JsonIgnore;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;
import org.springframework.web.multipart.MultipartFile;

/**
 * 管理后台文件上传请求。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-infra/src/main/java/cn/iocoder/yudao/module/infra/controller/admin/file/vo/file/FileUploadReqVO.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 1 行；import 新增 3 行、移除 2 行；补充注释 22 行。
 */
@Schema(description = "管理后台 - 上传文件 Request VO")
@Data
public class FileUploadReqVO {

    /**
     * 文件附件。
     */
    @Schema(description = "文件附件", requiredMode = Schema.RequiredMode.REQUIRED)
    @NotNull(message = "文件附件不能为空")
    private MultipartFile file;

    /**
     * 文件目录。
     */
    @Schema(description = "文件目录", example = "XXX/YYY")
    @Size(max = FilePathUtils.MAX_DIRECTORY_LENGTH, message = "文件目录长度不能超过 {max} 个字符")
    private String directory;

    /**
     * 校验对象目录只能使用相对路径，防止调用方改变预期存储前缀。
     *
     * @return 目录为空或格式安全时返回 true
     */
    @AssertTrue(message = "文件目录不正确")
    @JsonIgnore
    public boolean isDirectoryValid() {
        return isDirectoryValid(directory);
    }

    /**
     * 校验管理端上传使用的对象目录格式。
     *
     * @param directory 待校验目录
     * @return 目录为空或格式安全时返回 true
     */
    public static boolean isDirectoryValid(String directory) {
        return FilePathUtils.isDirectoryValid(directory);
    }

}
