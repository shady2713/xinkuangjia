package com.basicframework.module.infra.service.file;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.infra.controller.admin.file.vo.file.FileCreateReqVO;
import com.basicframework.module.infra.controller.admin.file.vo.file.FilePageReqVO;
import com.basicframework.module.infra.controller.admin.file.vo.file.FilePresignedUrlRespVO;
import com.basicframework.module.infra.dal.dataobject.file.FileDO;
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
     * @param size 精确上传字节数；最终登记由服务端核实内容与大小
     * @return 预签名地址信息
     */
    FilePresignedUrlRespVO presignPutUrl(@NotEmpty(message = "文件名不能为空") String name,
                                         String directory, long size);

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
     * 逐项删除文件；后续失败时保留先前已完成项的删除结果。
     *
     * @param ids 编号列表
     * @throws Exception 任一存储或元数据删除失败时停止，调用方可刷新列表后重试剩余项
     */
    void deleteFileList(List<Long> ids) throws Exception;

    /**
     * 获得文件内容
     *
     * @param path 文件路径
     * @return 文件内容
     * @throws Exception 读取存储失败时抛出
     */
    byte[] getFileContent(String path) throws Exception;

}
