package com.basicframework.module.infra.service.file;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.infra.controller.admin.file.vo.file.FileCreateReqVO;
import com.basicframework.module.infra.controller.admin.file.vo.file.FilePageReqVO;
import com.basicframework.module.infra.controller.admin.file.vo.file.FilePresignedUrlRespVO;
import com.basicframework.module.infra.dal.dataobject.file.FileDO;
import com.basicframework.module.infra.framework.file.core.client.FileContentStream;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;

/**
 * 文件 Service 接口
 *
 * 定义文件上传、预签名访问、元数据登记和文件删除等基础能力。
 *
 * @author 李杰
 */
public interface FileService {

    /**
     * 获得文件分页
     *
     * @param pageReqVO 分页查询
     * @return 文件分页
     */
    PageResult<FileDO> getFilePage(FilePageReqVO pageReqVO);

    /**
     * 保存文件，并返回文件的访问路径
     *
     * @param content   文件内容
     * @param name      文件名称，允许空
     * @param directory 目录，允许空
     * @param type      文件的 MIME 类型，允许空
     * @return 文件路径
     */
    String createFile(@NotEmpty(message = "文件内容不能为空") byte[] content,
                      String name, String directory, String type);

    /**
     * 生成文件预签名地址信息，用于上传
     *
     * @param name      文件名
     * @param directory 目录
     * @return 预签名地址信息
     */
    FilePresignedUrlRespVO presignPutUrl(@NotEmpty(message = "文件名不能为空") String name,
                                         String directory);

    /**
     * 生成文件预签名地址信息，用于读取
     *
     * @param url 完整的文件访问地址
     * @param expirationSeconds 访问有效期，单位秒
     * @return 文件预签名地址
     */
    String presignGetUrl(String url, Integer expirationSeconds);

    /**
     * 创建文件
     *
     * @param createReqVO 创建信息
     * @return 编号
     */
    Long createFile(FileCreateReqVO createReqVO);

    /**
     * 获得文件元数据。
     *
     * @param id 文件编号
     * @return 文件元数据
     */
    FileDO getFile(Long id);

    /**
     * 删除文件
     *
     * @param id 编号
     * @throws Exception 存储客户端删除失败时抛出
     */
    void deleteFile(Long id) throws Exception;

    /**
     * 批量删除文件
     *
     * @param ids 编号列表
     * @throws Exception 存储客户端删除失败时抛出
     */
    void deleteFileList(List<Long> ids) throws Exception;

    /**
     * 按对象路径以流式方式打开未软删除的公开文件内容流及字节长度。
     *
     * @param path 文件路径
     * @return 文件内容流与长度封装；记录不存在、已删除或存储对象缺失时返回 null
     * @throws Exception 读取存储失败时抛出
     */
    FileContentStream openFileContent(String path) throws Exception;

    /**
     * 判断指定对象路径按当前存储策略是否属于私有附件。
     *
     * @param path 对象相对路径
     * @return 私有桶模式或命中 {@code private/} 路径约定时返回 true
     */
    default boolean isPrivateObject(String path) {
        return false;
    }

    /**
     * 执行统一私有对象级授权后，返回指定文件的元数据。
     *
     * @param id 文件记录编号
     * @return 已通过访问授权校验的文件元数据
     */
    FileDO getAuthorizedPrivateFile(Long id);

    /**
     * 执行统一私有对象级授权后，按契约（60~3600 秒，默认 900 秒）生成私有附件的限时读取地址。
     *
     * @param id 文件记录编号
     * @param expirationSeconds 访问有效期，单位秒；为空时使用默认值 900 秒
     * @return 限时预签名读取地址
     */
    String presignPrivateGetUrl(Long id, Integer expirationSeconds);

    /**
     * 执行统一私有对象级授权后，以流式方式打开私有附件内容流及字节长度。
     *
     * @param id 文件记录编号
     * @return 文件内容流与长度封装；存储对象缺失时返回 null
     * @throws Exception 读取存储失败时抛出
     */
    FileContentStream openPrivateFileContent(Long id) throws Exception;

    /**
     * 对已通过对象级授权校验的私有附件元数据直接打开内容流，避免重复查库与鉴权。
     *
     * @param file 已授权校验的文件元数据
     * @return 文件内容流与长度封装；存储对象缺失时返回 null
     * @throws Exception 读取存储失败时抛出
     */
    default FileContentStream openAuthorizedPrivateFileContent(FileDO file) throws Exception {
        return openPrivateFileContent(file.getId());
    }

}
