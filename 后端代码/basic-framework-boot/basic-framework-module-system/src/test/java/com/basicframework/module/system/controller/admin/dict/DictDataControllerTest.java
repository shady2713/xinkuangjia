package com.basicframework.module.system.controller.admin.dict;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.controller.admin.dict.vo.data.DictDataPageReqVO;
import com.basicframework.module.system.controller.admin.dict.vo.data.DictDataRespVO;
import com.basicframework.module.system.controller.admin.dict.vo.data.DictDataSaveReqVO;
import com.basicframework.module.system.controller.admin.dict.vo.data.DictDataSimpleRespVO;
import com.basicframework.module.system.dal.dataobject.dict.DictDataDO;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.basicframework.module.system.service.dict.DictDataService;
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
 * 验证字典数据管理接口的委派、响应转换与导出限制契约。
 *
 * <p>字典数据是前端展示标签的来源：写操作必须原样下传并返回新编号或成功标记；查询必须把持久对象
 * 转换为响应模型并保留标签、字典值与排序等展示字段；精简列表还有一个真实约定——只取启用状态，
 * 且不限定字典类型，供管理后台一次性缓存全部字典。导出必须先截断到最大导出行数并在超限时显式报错。
 * 用例用真实响应对象与替身服务断言这些可观察结果。</p>
 *
 * @author shady2713
 */
class DictDataControllerTest {

    /** 被测控制器。 */
    private DictDataController controller;
    /** 字典数据服务替身，用于隔离持久层并观察调用参数。 */
    private DictDataService dictDataService;

    /** 为每个用例装配独立控制器与替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        controller = new DictDataController();
        dictDataService = mock(DictDataService.class);
        ReflectionTestUtils.setField(controller, "dictDataService", dictDataService);
    }

    /** 创建、更新与删除必须返回编号或成功标记，并把入参原样下传。 */
    @Test
    void writeOperationsDelegateRequests() {
        DictDataSaveReqVO createReqVO = new DictDataSaveReqVO();
        createReqVO.setLabel("DUMMY-标签");
        when(dictDataService.createDictData(any())).thenReturn(8192L);
        DictDataSaveReqVO updateReqVO = new DictDataSaveReqVO();
        updateReqVO.setId(1L);

        assertThat(controller.createDictData(createReqVO).getData()).isEqualTo(8192L);
        assertThat(controller.updateDictData(updateReqVO).getData()).isTrue();
        assertThat(controller.deleteDictData(2L).getData()).isTrue();
        assertThat(controller.deleteDictDataList(List.of(3L, 4L)).getData()).isTrue();
        verify(dictDataService).createDictData(createReqVO);
        verify(dictDataService).updateDictData(updateReqVO);
        verify(dictDataService).deleteDictData(2L);
        verify(dictDataService).deleteDictDataList(List.of(3L, 4L));
    }

    /** 精简列表必须只取启用状态且不限定字典类型。 */
    @Test
    void getSimpleDictDataListRequestsEnabledDataOfAllTypes() {
        when(dictDataService.getDictDataList(CommonStatusEnum.ENABLE.getStatus(), null))
                .thenReturn(List.of(data(1L, "男", "1", "sys_sex"), data(2L, "女", "2", "sys_sex")));

        CommonResult<List<DictDataSimpleRespVO>> result = controller.getSimpleDictDataList();

        assertThat(result.getCode()).isZero();
        assertThat(result.getData()).extracting(DictDataSimpleRespVO::getValue).containsExactly("1", "2");
        verify(dictDataService).getDictDataList(CommonStatusEnum.ENABLE.getStatus(), null);
    }

    /** 分页与单条查询必须保留总数并转换为响应模型。 */
    @Test
    void queryOperationsConvertRecords() {
        DictDataPageReqVO pageReqVO = new DictDataPageReqVO();
        when(dictDataService.getDictDataPage(any()))
                .thenReturn(new PageResult<>(List.of(data(5L, "男", "1", "sys_sex")), 11L));
        when(dictDataService.getDictData(6L)).thenReturn(data(6L, "女", "2", "sys_sex"));

        CommonResult<PageResult<DictDataRespVO>> page = controller.getDictTypePage(pageReqVO);
        CommonResult<DictDataRespVO> single = controller.getDictData(6L);

        assertThat(page.getData().getTotal()).as("总数必须保留").isEqualTo(11L);
        assertThat(page.getData().getList()).extracting(DictDataRespVO::getLabel).containsExactly("男");
        assertThat(single.getData().getDictType()).isEqualTo("sys_sex");
        assertThat(single.getData().getSort()).isEqualTo(1);
    }

    /** 导出必须把页码与页大小改成导出口径，并写出真实 Excel 附件。 */
    @Test
    void exportWritesExcelWithExportPaging() throws Exception {
        DictDataPageReqVO reqVO = new DictDataPageReqVO();
        when(dictDataService.getDictDataPage(any()))
                .thenReturn(new PageResult<>(List.of(data(1L, "男", "1", "sys_sex")), 1L));
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
        when(dictDataService.getDictDataPage(any())).thenReturn(new PageResult<>(List.of(), 10_001L));
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThatThrownBy(() -> controller.export(response, new DictDataPageReqVO()))
                .isInstanceOf(ServiceException.class)
                .hasFieldOrPropertyWithValue("code", ErrorCodeConstants.SYSTEM_EXPORT_SIZE_EXCEEDED.getCode());
        assertThat(response.getContentAsByteArray()).isEmpty();
    }

    /**
     * 构造字典数据持久对象，仅填充断言涉及的字段。
     *
     * @param id 编号
     * @param label 标签
     * @param value 字典值
     * @param dictType 字典类型
     * @return 字典数据持久对象
     */
    private static DictDataDO data(Long id, String label, String value, String dictType) {
        DictDataDO dictData = new DictDataDO();
        dictData.setId(id);
        dictData.setLabel(label);
        dictData.setValue(value);
        dictData.setDictType(dictType);
        dictData.setSort(1);
        return dictData;
    }

}
