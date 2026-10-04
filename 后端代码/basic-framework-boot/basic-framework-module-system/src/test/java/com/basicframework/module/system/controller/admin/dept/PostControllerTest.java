package com.basicframework.module.system.controller.admin.dept;

import com.basicframework.framework.common.biz.system.dict.DictDataCommonApi;
import com.basicframework.framework.common.biz.system.dict.dto.DictDataRespDTO;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.controller.admin.dept.vo.post.PostPageReqVO;
import com.basicframework.module.system.controller.admin.dept.vo.post.PostRespVO;
import com.basicframework.module.system.controller.admin.dept.vo.post.PostSaveReqVO;
import com.basicframework.module.system.controller.admin.dept.vo.post.PostSimpleRespVO;
import com.basicframework.module.system.dal.dataobject.dept.PostDO;
import com.basicframework.framework.dict.core.DictFrameworkUtils;
import com.basicframework.module.system.enums.DictTypeConstants;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.service.dept.PostService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import com.basicframework.framework.excel.core.util.ExcelUtils;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证岗位管理接口的委派、排序、分页转换与导出限制契约。
 *
 * <p>岗位下拉列表有一个明确的业务约定：返回全部状态的岗位并按排序值升序，让前端下拉顺序稳定；
 * 导出接口则必须先截断到最大导出行数，超过上限时抛出"导出条数超限"而不是静默写出部分数据，
 * 否则运维会拿到不完整且无提示的表格。用例用真实响应对象与替身服务断言这些可观察结果。</p>
 *
 * @author shady2713
 */
class PostControllerTest {

    /** 被测控制器。 */
    private PostController controller;
    /** 岗位服务替身，用于隔离持久层并观察调用参数。 */
    private PostService postService;

    /** 为每个用例装配独立控制器与替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        controller = new PostController();
        postService = mock(PostService.class);
        ReflectionTestUtils.setField(controller, "postService", postService);
        // 导出使用字典转换器，绑定真实字典接口替身，让状态列按标签导出。
        DictDataCommonApi dictDataApi = type -> DictTypeConstants.COMMON_STATUS.equals(type)
                ? List.of(dictData("正常", "0"), dictData("停用", "1"))
                : List.of();
        DictFrameworkUtils.init(dictDataApi);
        DictFrameworkUtils.clearCache();
    }

    /** 清理字典缓存，避免把本用例的字典替身带出。 */
    @AfterEach
    void tearDown() {
        DictFrameworkUtils.clearCache();
    }

    /** 创建、更新与删除必须返回编号或成功标记，并把入参原样下传。 */
    @Test
    void writeOperationsDelegateRequests() {
        PostSaveReqVO createReqVO = new PostSaveReqVO();
        createReqVO.setName("DUMMY-岗位");
        when(postService.createPost(any())).thenReturn(2048L);
        PostSaveReqVO updateReqVO = new PostSaveReqVO();
        updateReqVO.setId(5L);

        assertThat(controller.createPost(createReqVO).getData()).isEqualTo(2048L);
        assertThat(controller.updatePost(updateReqVO).getData()).isTrue();
        assertThat(controller.deletePost(6L).getData()).isTrue();
        assertThat(controller.deletePostList(List.of(7L, 8L)).getData()).isTrue();
        verify(postService).createPost(createReqVO);
        verify(postService).updatePost(updateReqVO);
        verify(postService).deletePost(6L);
        verify(postService).deletePostList(List.of(7L, 8L));
    }

    /** 单个岗位查询必须转换为响应模型并保留编码、排序与状态。 */
    @Test
    void getPostConvertsRecord() {
        when(postService.getPost(9L)).thenReturn(post(9L, "研发岗", "dev", 1, 0));

        CommonResult<PostRespVO> result = controller.getPost(9L);

        assertThat(result.getCode()).isZero();
        assertThat(result.getData().getCode()).isEqualTo("dev");
        assertThat(result.getData().getSort()).isEqualTo(1);
        assertThat(result.getData().getStatus()).isEqualTo(0);
    }

    /** 精简列表必须请求全部状态并按排序值升序返回。 */
    @Test
    void getSimplePostListSortsBySortAscending() {
        List<PostDO> unsorted = new ArrayList<>(List.of(
                post(3L, "第三", "c", 30, 0),
                post(1L, "第一", "a", 10, 0),
                post(2L, "第二", "b", 20, 0)));
        when(postService.getPostList(null, null)).thenReturn(unsorted);

        CommonResult<List<PostSimpleRespVO>> result = controller.getSimplePostList();

        assertThat(result.getData()).extracting(PostSimpleRespVO::getId)
                .as("精简模型只有编号与名称，按排序值升序即编号顺序").containsExactly(1L, 2L, 3L);
        assertThat(result.getData()).extracting(PostSimpleRespVO::getName).containsExactly("第一", "第二", "第三");
    }

    /** 分页查询必须保留总数并转换列表元素。 */
    @Test
    void getPostPageConvertsPageResult() {
        PostPageReqVO reqVO = new PostPageReqVO();
        when(postService.getPostPage(any())).thenReturn(new PageResult<>(List.of(post(4L, "财务岗", "fin", 2, 0)), 42L));

        CommonResult<PageResult<PostRespVO>> result = controller.getPostPage(reqVO);

        assertThat(result.getData().getTotal()).as("总数必须保留").isEqualTo(42L);
        assertThat(result.getData().getList()).extracting(PostRespVO::getName).containsExactly("财务岗");
    }

    /** 导出必须把页码与页大小改成导出口径，并写出真实 Excel 附件。 */
    @Test
    void exportWritesExcelWithExportPaging() throws Exception {
        PostPageReqVO reqVO = new PostPageReqVO();
        when(postService.getPostPage(any())).thenReturn(new PageResult<>(List.of(post(1L, "研发岗", "dev", 1, 0)), 1L));
        MockHttpServletResponse response = new MockHttpServletResponse();

        controller.export(response, reqVO);

        assertThat(reqVO.getPageNo()).as("导出必须从第一页开始").isEqualTo(1);
        assertThat(reqVO.getPageSize()).as("导出必须按最大导出行数取数").isEqualTo(10_000);
        assertThat(response.getContentType()).isEqualTo("application/vnd.ms-excel;charset=UTF-8");
        assertThat(response.getHeader("Content-Disposition")).contains("attachment");
        assertThat(response.getContentAsByteArray()).as("必须写出真实 Excel 内容").isNotEmpty();
        assertThat(ExcelUtils.read(new MockMultipartFile("file", "post.xls", "application/vnd.ms-excel",
                response.getContentAsByteArray()), PostRespVO.class).get(0).getStatus())
                .as("状态列必须按字典标签导出，读回时再还原为字典值").isZero();
    }

    /** 导出总数超过上限时必须抛出"导出条数超限"，不得写出不完整文件。 */
    @Test
    void exportRejectsResultOverLimit() {
        when(postService.getPostPage(any())).thenReturn(new PageResult<>(List.of(), 10_001L));
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThatThrownBy(() -> controller.export(response, new PostPageReqVO()))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.SYSTEM_EXPORT_SIZE_EXCEEDED.getCode());
        assertThat(response.getContentAsByteArray()).as("超限时不得写出任何内容").isEmpty();
    }

    /**
     * 构造字典数据，仅填充解析所需的标签与字典值。
     *
     * @param label 标签
     * @param value 字典值
     * @return 字典数据
     */
    private static DictDataRespDTO dictData(String label, String value) {
        DictDataRespDTO dictData = new DictDataRespDTO();
        dictData.setLabel(label);
        dictData.setValue(value);
        return dictData;
    }

    /**
     * 构造岗位持久对象，仅填充断言涉及的字段。
     *
     * @param id 编号
     * @param name 名称
     * @param code 编码
     * @param sort 排序值
     * @param status 状态
     * @return 岗位持久对象
     */
    private static PostDO post(Long id, String name, String code, Integer sort, Integer status) {
        PostDO post = new PostDO();
        post.setId(id);
        post.setName(name);
        post.setCode(code);
        post.setSort(sort);
        post.setStatus(status);
        return post;
    }

}
