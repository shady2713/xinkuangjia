package com.basicframework.module.infra.controller.admin.file;

import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.infra.controller.admin.file.vo.file.FileCreateReqVO;
import com.basicframework.module.infra.controller.admin.file.vo.file.FilePageReqVO;
import com.basicframework.module.infra.controller.admin.file.vo.file.FilePresignedUrlRespVO;
import com.basicframework.module.infra.controller.admin.file.vo.file.FileRespVO;
import com.basicframework.module.infra.dal.dataobject.file.FileDO;
import com.basicframework.module.infra.service.file.FileService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证文件管理入口的委派与响应模型映射契约。
 *
 * <p>这些入口只做参数传递与模型转换：预签名地址由服务决定（控制器不得自行拼接存储地址），
 * 查询必须返回响应模型而不是持久化对象，删除必须整批交给服务（控制器逐个删除会留下
 * 部分删除状态）。用例同时锁定批量删除的入参顺序，避免服务拿到被重排的编号列表。</p>
 *
 * @author shady2713
 */
class FileControllerAdminEntryTest {

    /** 被测控制器。 */
    private final FileController controller = new FileController();

    /** 文件服务替身。 */
    private final FileService fileService = mock(FileService.class);

    /** 预签名上传入口把三个参数原样交给服务并返回服务结果。 */
    @Test
    void presignedPutUrlDelegatesAllParameters() {
        injectDependencies();
        FilePresignedUrlRespVO expected = new FilePresignedUrlRespVO();
        expected.setUploadUrl("https://minio.example.test/upload");
        expected.setPath("demo/a.txt");
        when(fileService.presignPutUrl("a.txt", "demo", 1024L)).thenReturn(expected);

        CommonResult<FilePresignedUrlRespVO> result = controller.getFilePresignedUrl("a.txt", "demo", 1024L);

        assertThat(result.getData()).isSameAs(expected);
        verify(fileService).presignPutUrl("a.txt", "demo", 1024L);
    }

    /** 创建入口返回服务生成的编号，并把请求对象原样交给服务。 */
    @Test
    void createFileReturnsGeneratedId() {
        injectDependencies();
        FileCreateReqVO createReqVO = new FileCreateReqVO();
        createReqVO.setName("a.txt");
        createReqVO.setPath("demo/a.txt");
        when(fileService.createFile(createReqVO)).thenReturn(1024L);

        assertThat(controller.createFile(createReqVO).getData()).isEqualTo(1024L);
        verify(fileService).createFile(createReqVO);
    }

    /** 查询入口把持久化对象映射为响应模型，字段与访问地址一并返回。 */
    @Test
    void getFileMapsPersistentObjectToResponse() {
        injectDependencies();
        FileDO file = new FileDO();
        file.setId(1024L);
        file.setName("a.txt");
        file.setPath("demo/a.txt");
        file.setUrl("https://cdn.example.test/demo/a.txt");
        file.setType("text/plain");
        file.setSize(3L);
        when(fileService.getFile(1024L)).thenReturn(file);

        CommonResult<FileRespVO> result = controller.getFile(1024L);

        assertThat(result.getData().getId()).isEqualTo(1024L);
        assertThat(result.getData().getName()).isEqualTo("a.txt");
        assertThat(result.getData().getUrl()).isEqualTo("https://cdn.example.test/demo/a.txt");
        assertThat(result.getData().getSize()).isEqualTo(3L);
    }

    /** 单个删除委派服务并返回成功。 */
    @Test
    void deleteFileDelegatesToService() throws Exception {
        injectDependencies();

        assertThat(controller.deleteFile(1024L).getData()).isTrue();
        verify(fileService).deleteFile(1024L);
    }

    /** 批量删除必须保持入参顺序整批交给服务。 */
    @Test
    void deleteFileListKeepsOrderAndDelegatesOnce() throws Exception {
        injectDependencies();
        List<Long> ids = List.of(3L, 1L, 2L);

        assertThat(controller.deleteFileList(ids).getData()).isTrue();
        ArgumentCaptor<List<Long>> captor = ArgumentCaptor.forClass(List.class);
        verify(fileService).deleteFileList(captor.capture());
        assertThat(captor.getValue()).containsExactly(3L, 1L, 2L);
    }

    /** 分页入口把 DO 分页映射为响应分页并保留总数。 */
    @Test
    void getFilePageMapsFieldsAndTotal() {
        injectDependencies();
        FilePageReqVO pageVO = new FilePageReqVO();
        pageVO.setPath("demo");
        FileDO file = new FileDO();
        file.setId(1024L);
        file.setName("a.txt");
        file.setPath("demo/a.txt");
        when(fileService.getFilePage(pageVO)).thenReturn(new PageResult<>(List.of(file), 5L));

        CommonResult<PageResult<FileRespVO>> result = controller.getFilePage(pageVO);

        assertThat(result.getData().getTotal()).isEqualTo(5L);
        assertThat(result.getData().getList().get(0).getPath()).isEqualTo("demo/a.txt");
        verify(fileService).getFilePage(pageVO);
    }

    /** 注入文件服务替身，保证控制器只访问受控边界。 */
    private void injectDependencies() {
        ReflectionTestUtils.setField(controller, "fileService", fileService);
    }

}
