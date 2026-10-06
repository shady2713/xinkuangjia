package com.basicframework.module.infra.controller.admin.file;

import java.io.InputStream;
import com.basicframework.module.infra.framework.file.config.FileUploadProperties;
import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.FILE_SIZE_EXCEEDED;
import cn.hutool.core.util.StrUtil;
import cn.hutool.core.util.URLUtil;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;

import com.basicframework.module.infra.controller.admin.file.vo.file.FileCreateReqVO;
import com.basicframework.module.infra.controller.admin.file.vo.file.FilePageReqVO;
import com.basicframework.module.infra.controller.admin.file.vo.file.FilePresignedUrlRespVO;
import com.basicframework.module.infra.controller.admin.file.vo.file.FileRespVO;
import com.basicframework.module.infra.controller.admin.file.vo.file.FileUploadReqVO;
import com.basicframework.module.infra.dal.dataobject.file.FileDO;
import com.basicframework.module.infra.framework.file.core.utils.FilePathUtils;
import com.basicframework.module.infra.service.file.FileService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.Parameters;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.annotation.security.PermitAll;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.Positive;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static com.basicframework.framework.common.pojo.CommonResult.success;
import static com.basicframework.module.infra.framework.file.core.utils.FileTypeUtils.writeAttachment;

/**
 * 管理后台文件接口。
 *
 * <p>上传和登记沿用管理端登录边界，删除操作使用文件删除权限；公开读取只允许按完整对象路径获取单个文件。</p>
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-infra/src/main/java/cn/iocoder/yudao/module/infra/controller/admin/file/FileController.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；改写/新增 29 行，移除或改写上游 19 行；import 新增 21 行、移除 10 行；补充注释 69 行，上游注释 3 行未保留。
 * 来源验收：尚未验收
 */
@Tag(name = "管理后台 - 文件存储")
@RestController
@RequestMapping("/infra/file")
@Validated
@Slf4j
public class FileController {

    /** 管理端单次批量删除上限。 */
    private static final int MAX_BATCH_DELETE_SIZE = 100;

    /** 文件业务服务。 */
    @Resource
    private FileService fileService;

    /** 与实际对象校验一致的单次上传内存上限。 */
    @Resource
    private FileUploadProperties uploadLimits;

    /**
     * 上传文件并登记文件元数据。
     *
     * @param uploadReqVO 上传文件及目标目录
     * @return 文件长期访问地址
     * @throws Exception 文件读取或对象存储上传失败时抛出
     */
    @PostMapping("/upload")
    @Operation(summary = "上传文件", description = "模式一：后端上传文件")
    @Parameter(name = "file", description = "文件附件", required = true,
            schema = @Schema(type = "string", format = "binary"))
    public CommonResult<String> uploadFile(@Valid FileUploadReqVO uploadReqVO) throws Exception {
        MultipartFile file = uploadReqVO.getFile();
        if (file.getSize() > uploadLimits.getMaxBytes()) {
            throw exception(FILE_SIZE_EXCEEDED);
        }
        byte[] content;
        try (InputStream input = file.getInputStream()) {
            content = input.readNBytes(uploadLimits.getMaxBytes() + 1);
        }
        if (content.length > uploadLimits.getMaxBytes()) {
            throw exception(FILE_SIZE_EXCEEDED);
        }
        return success(fileService.createFile(content, file.getOriginalFilename(),
                uploadReqVO.getDirectory(), file.getContentType()));
    }

    /**
     * 生成前端直传对象存储所需的预签名地址。
     *
     * @param name 文件名称
     * @param directory 目标目录；为空时写入默认日期目录
     * @param size 文件精确字节数，签名和登记均校验
     * @return 上传地址、访问地址和对象路径
     */
    @GetMapping("/presigned-url")
    @Operation(summary = "获取文件预签名地址（上传）", description = "预约有界直传；浏览器上传暂存对象后必须调用完成接口")
    @Parameters({
            @Parameter(name = "name", description = "文件名称", required = true),
            @Parameter(name = "directory", description = "文件目录")
    })
    public CommonResult<FilePresignedUrlRespVO> getFilePresignedUrl(
            @RequestParam("name") @NotBlank(message = "文件名不能为空")
            @Size(max = FilePathUtils.MAX_FILE_NAME_LENGTH, message = "文件名长度不能超过 {max} 个字符") String name,
            @RequestParam(value = "directory", required = false)
            @Size(max = FilePathUtils.MAX_DIRECTORY_LENGTH, message = "文件目录长度不能超过 {max} 个字符")
            String directory,
            @RequestParam("size") @Positive(message = "文件大小必须大于 0") long size) {
        return success(fileService.presignPutUrl(name, directory, size));
    }

    /**
     * 登记已经通过预签名地址上传的文件。
     *
     * @param createReqVO 文件对象路径和元数据
     * @return 文件记录编号
     */
    @PostMapping("/create")
    @Operation(summary = "创建文件", description = "完成当前身份的上传预约，验证真实对象内容后登记")
    public CommonResult<Long> createFile(@Valid @RequestBody FileCreateReqVO createReqVO) {
        return success(fileService.createFile(createReqVO));
    }

    /**
     * 查询文件元数据。
     *
     * @param id 文件记录编号
     * @return 文件元数据
     */
    @GetMapping("/get")
    @Operation(summary = "获得文件")
    @Parameter(name = "id", description = "编号", required = true)
    @PreAuthorize("@ss.hasPermission('infra:file:query')")
    public CommonResult<FileRespVO> getFile(@RequestParam("id") Long id) {
        return success(BeanUtils.toBean(fileService.getFile(id), FileRespVO.class));
    }

    /**
     * 删除单个文件及其对象存储内容。
     *
     * @param id 文件记录编号
     * @return 删除成功标记
     * @throws Exception 对象存储删除失败时抛出
     */
    @DeleteMapping("/delete")
    @Operation(summary = "删除文件")
    @Parameter(name = "id", description = "编号", required = true)
    @PreAuthorize("@ss.hasPermission('infra:file:delete')")
    public CommonResult<Boolean> deleteFile(@RequestParam("id") Long id) throws Exception {
        fileService.deleteFile(id);
        return success(true);
    }

    /**
     * 批量删除文件及其对象存储内容。
     *
     * @param ids 文件记录编号列表，单次最多 100 条
     * @return 删除成功标记
     * @throws Exception 任一删除失败时停止；先前已删除项保持生效，刷新列表后可重试剩余项
     */
    @DeleteMapping("/delete-list")
    @Operation(summary = "批量删除文件")
    @Parameter(name = "ids", description = "编号列表", required = true)
    @PreAuthorize("@ss.hasPermission('infra:file:delete')")
    public CommonResult<Boolean> deleteFileList(
            @RequestParam("ids") @NotEmpty(message = "文件编号列表不能为空")
            @Size(max = MAX_BATCH_DELETE_SIZE, message = "单次最多删除 100 个文件") List<Long> ids)
            throws Exception {
        fileService.deleteFileList(ids);
        return success(true);
    }

    /**
     * 按对象路径读取公开文件内容。
     *
     * <p>业务约束要求文件 URL 长期可访问，因此该入口允许匿名读取，但不提供目录列举和写操作。</p>
     *
     * @param request HTTP 请求，用于提取对象路径
     * @param response HTTP 响应，用于写入文件内容
     * @throws Exception 对象存储读取或响应写入失败时抛出
     */
    @GetMapping("/content/**")
    @PermitAll
    @Operation(summary = "下载文件")
    public void getFileContent(HttpServletRequest request,
                               HttpServletResponse response) throws Exception {
        // 获取请求的路径
        String path = StrUtil.subAfter(request.getRequestURI(), "/content/", false);
        if (StrUtil.isEmpty(path)) {
            throw new IllegalArgumentException("结尾的 path 路径必须传递");
        }
        // 解码，解决中文路径的问题
        // https://example.com/basic_framework/pulls/807/
        // https://example.com/basic_framework/pulls/1432/
        path = URLUtil.decode(path, StandardCharsets.UTF_8, false);

        // 读取内容
        byte[] content = fileService.getFileContent(path);
        if (content == null) {
            log.warn("[getFileContent][path({}) 文件不存在]", path);
            response.setStatus(HttpStatus.NOT_FOUND.value());
            return;
        }
        writeAttachment(response, path, content);
    }

    /**
     * 分页查询文件元数据。
     *
     * @param pageVO 分页查询条件
     * @return 文件分页结果
     */
    @GetMapping("/page")
    @Operation(summary = "获得文件分页")
    @PreAuthorize("@ss.hasPermission('infra:file:query')")
    public CommonResult<PageResult<FileRespVO>> getFilePage(@Valid FilePageReqVO pageVO) {
        PageResult<FileDO> pageResult = fileService.getFilePage(pageVO);
        return success(BeanUtils.toBean(pageResult, FileRespVO.class));
    }

}
