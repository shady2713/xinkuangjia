package com.basicframework.module.system.controller.admin.dict;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.controller.admin.dict.vo.type.DictTypePageReqVO;
import com.basicframework.module.system.controller.admin.dict.vo.type.DictTypeRespVO;
import com.basicframework.module.system.controller.admin.dict.vo.type.DictTypeSaveReqVO;
import com.basicframework.module.system.controller.admin.dict.vo.type.DictTypeSimpleRespVO;
import com.basicframework.module.system.dal.dataobject.dict.DictTypeDO;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.service.dict.DictTypeService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证字典类型管理接口的委派、响应转换与导出限制契约。
 *
 * <p>字典类型是字典数据的上层分组：写操作必须原样下传并返回新编号或成功标记，查询必须把持久对象
 * 转换为响应模型，精简列表用于前端下拉。导出接口必须先截断到最大导出行数并在超限时显式报错，
 * 否则运维会拿到不完整且无提示的数据。用例用真实响应对象与替身服务断言这些可观察结果。</p>
 *
 * @author shady2713
 */
class DictTypeControllerTest {

    /** 被测控制器。 */
    private DictTypeController controller;
    /** 字典类型服务替身，用于隔离持久层并观察调用参数。 */
    private DictTypeService dictTypeService;

    /** 为每个用例装配独立控制器与替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        controller = new DictTypeController();
        dictTypeService = mock(DictTypeService.class);
        ReflectionTestUtils.setField(controller, "dictTypeService", dictTypeService);
    }

    /** 创建、更新与删除必须返回编号或成功标记，并把入参原样下传。 */
    @Test
    void writeOperationsDelegateRequests() {
        DictTypeSaveReqVO createReqVO = new DictTypeSaveReqVO();
        createReqVO.setType("sys_dict_probe");
        when(dictTypeService.createDictType(any())).thenReturn(4096L);
        DictTypeSaveReqVO updateReqVO = new DictTypeSaveReqVO();
        updateReqVO.setId(3L);

        assertThat(controller.createDictType(createReqVO).getData()).isEqualTo(4096L);
        assertThat(controller.updateDictType(updateReqVO).getData()).isTrue();
        assertThat(controller.deleteDictType(4L).getData()).isTrue();
        assertThat(controller.deleteDictTypeList(List.of(5L, 6L)).getData()).isTrue();
        verify(dictTypeService).createDictType(createReqVO);
        verify(dictTypeService).updateDictType(updateReqVO);
        verify(dictTypeService).deleteDictType(4L);
        verify(dictTypeService).deleteDictTypeList(List.of(5L, 6L));
    }

    /** 分页与单条查询必须保留总数并转换为响应模型。 */
    @Test
    void queryOperationsConvertRecords() {
        DictTypePageReqVO pageReqVO = new DictTypePageReqVO();
        when(dictTypeService.getDictTypePage(any()))
                .thenReturn(new PageResult<>(List.of(type(1L, "sys_sex", "性别")), 7L));
        when(dictTypeService.getDictType(2L)).thenReturn(type(2L, "sys_status", "状态"));

        CommonResult<PageResult<DictTypeRespVO>> page = controller.pageDictTypes(pageReqVO);
        CommonResult<DictTypeRespVO> single = controller.getDictType(2L);

        assertThat(page.getData().getTotal()).as("总数必须保留").isEqualTo(7L);
        assertThat(page.getData().getList()).extracting(DictTypeRespVO::getType).containsExactly("sys_sex");
        assertThat(single.getData().getName()).isEqualTo("状态");
    }

    /** 精简列表必须返回全部字典类型的编码与名称。 */
    @Test
    void getSimpleDictTypeListConvertsAllTypes() {
        when(dictTypeService.getDictTypeList())
                .thenReturn(List.of(type(1L, "sys_sex", "性别"), type(2L, "sys_status", "状态")));

        CommonResult<List<DictTypeSimpleRespVO>> result = controller.getSimpleDictTypeList();

        assertThat(result.getCode()).isZero();
        assertThat(result.getData()).extracting(DictTypeSimpleRespVO::getType).containsExactly("sys_sex", "sys_status");
    }

    /** 导出必须把页码与页大小改成导出口径，并写出真实 Excel 附件。 */
    @Test
    void exportWritesExcelWithExportPaging() throws Exception {
        DictTypePageReqVO reqVO = new DictTypePageReqVO();
        when(dictTypeService.getDictTypePage(any()))
                .thenReturn(new PageResult<>(List.of(type(1L, "sys_sex", "性别")), 1L));
        MockHttpServletResponse response = new MockHttpServletResponse();

        controller.export(response, reqVO);

        assertThat(reqVO.getPageNo()).as("导出必须从第一页开始").isEqualTo(1);
        assertThat(reqVO.getPageSize()).as("导出必须按最大导出行数取数").isEqualTo(10_000);
        assertThat(response.getContentType()).isEqualTo("application/vnd.ms-excel;charset=UTF-8");
        assertThat(response.getHeader("Content-Disposition")).contains("attachment");
        assertThat(response.getContentAsByteArray()).as("必须写出真实 Excel 内容").isNotEmpty();
    }

    /** 导出总数超过上限时必须抛出"导出条数超限"，不得写出不完整文件。 */
    @Test
    void exportRejectsResultOverLimit() {
        when(dictTypeService.getDictTypePage(any())).thenReturn(new PageResult<>(List.of(), 10_001L));
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThatThrownBy(() -> controller.export(response, new DictTypePageReqVO()))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.SYSTEM_EXPORT_SIZE_EXCEEDED.getCode());
        assertThat(response.getContentAsByteArray()).isEmpty();
    }

    /**
     * 构造字典类型持久对象，仅填充断言涉及的字段。
     *
     * @param id 编号
     * @param type 字典类型编码
     * @param name 名称
     * @return 字典类型持久对象
     */
    private static DictTypeDO type(Long id, String type, String name) {
        DictTypeDO dictType = new DictTypeDO();
        dictType.setId(id);
        dictType.setType(type);
        dictType.setName(name);
        return dictType;
    }

}
