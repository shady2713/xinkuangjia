package com.basicframework.module.system.api.dict;

import com.basicframework.framework.common.biz.system.dict.dto.DictDataRespDTO;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.module.system.dal.dataobject.dict.DictDataDO;
import com.basicframework.module.system.service.dict.DictDataService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证字典数据跨模块 API 实现类的转发与对象转换契约。
 *
 * <p>校验入口负责挡住其它模块写入的未定义字典值，抛错必须原样传播；查询入口把持久化
 * 对象转换成跨模块 DTO，消费方用它渲染标签与状态，字段漏转会让下拉框显示空标签。
 * 因此转换结果按字段逐一断言，空值与空集合分别锁定。</p>
 *
 * @author shady2713
 */
class DictDataApiImplTest {

    /** 被测 API 实现。 */
    private DictDataApiImpl dictDataApi;
    /** 下游字典数据服务替身，用于观察真实转发参数。 */
    private DictDataService dictDataService;

    /** 为每个用例创建独立 API 与下游替身，避免共享调用记录。 */
    @BeforeEach
    void setUp() {
        dictDataApi = new DictDataApiImpl();
        dictDataService = mock(DictDataService.class);
        ReflectionTestUtils.setField(dictDataApi, "dictDataService", dictDataService);
    }

    /** 字典类型与取值集合必须原样转发给下游校验。 */
    @Test
    void validateDictDataListForwardsSameArguments() {
        List<String> values = List.of("1", "2");

        dictDataApi.validateDictDataList("system_user_sex", values);

        verify(dictDataService).validateDictDataList("system_user_sex", values);
        verifyNoMoreInteractions(dictDataService);
    }

    /** 未提供取值集合时按 null 原样转发，由下游决定空集合语义。 */
    @Test
    void validateDictDataListForwardsNullValues() {
        dictDataApi.validateDictDataList("system_user_sex", null);

        verify(dictDataService).validateDictDataList("system_user_sex", null);
    }

    /** 字典校验失败必须原样传播，避免未定义字典值落库。 */
    @Test
    void validateDictDataListPropagatesFailureUnchanged() {
        List<String> values = List.of("99");
        IllegalArgumentException failure = new IllegalArgumentException("synthetic-invalid-dict-value");
        doThrow(failure).when(dictDataService).validateDictDataList("system_user_sex", values);

        assertThatThrownBy(() -> dictDataApi.validateDictDataList("system_user_sex", values)).isSameAs(failure);
    }

    /** 字典查询必须按类型转发，并把标签、取值、类型与状态完整转换到跨模块 DTO。 */
    @Test
    void getDictDataListMapsPersistenceObjectToResponseDto() {
        when(dictDataService.getDictDataListByDictType("system_user_sex")).thenReturn(List.of(
                dictData(1L, "男", "1", "system_user_sex", CommonStatusEnum.ENABLE.getStatus(), 1),
                dictData(2L, "女", "2", "system_user_sex", CommonStatusEnum.DISABLE.getStatus(), 2)));

        List<DictDataRespDTO> result = dictDataApi.getDictDataList("system_user_sex");

        assertThat(result).hasSize(2);
        assertThat(result.get(0).getLabel()).isEqualTo("男");
        assertThat(result.get(0).getValue()).isEqualTo("1");
        assertThat(result.get(0).getDictType()).isEqualTo("system_user_sex");
        assertThat(result.get(0).getStatus()).isEqualTo(CommonStatusEnum.ENABLE.getStatus());
        assertThat(result.get(1).getLabel()).as("顺序必须与下游返回一致").isEqualTo("女");
        assertThat(result.get(1).getValue()).isEqualTo("2");
        assertThat(result.get(1).getStatus()).isEqualTo(CommonStatusEnum.DISABLE.getStatus());

        verify(dictDataService).getDictDataListByDictType("system_user_sex");
        verifyNoMoreInteractions(dictDataService);
    }

    /** 该字典类型无数据时返回空列表，调用方无需判空。 */
    @Test
    void getDictDataListReturnsEmptyListWhenNothingFound() {
        when(dictDataService.getDictDataListByDictType("system_absent")).thenReturn(List.of());

        assertThat(dictDataApi.getDictDataList("system_absent")).isEmpty();

        verify(dictDataService).getDictDataListByDictType("system_absent");
    }

    /** 下游返回 null 时结果保持 null，不得伪造空列表掩盖数据缺失。 */
    @Test
    void getDictDataListKeepsNullWhenDownstreamReturnsNull() {
        when(dictDataService.getDictDataListByDictType("system_absent")).thenReturn(null);

        assertThat(dictDataApi.getDictDataList("system_absent")).isNull();

        verify(dictDataService).getDictDataListByDictType("system_absent");
    }

    /**
     * 构造指定字段的字典数据持久化对象。
     *
     * @param id 字典数据编号
     * @param label 字典标签
     * @param value 字典取值
     * @param dictType 字典类型
     * @param status 状态值
     * @param sort 排序值
     * @return 字典数据持久化对象
     */
    private static DictDataDO dictData(Long id, String label, String value, String dictType,
                                       Integer status, Integer sort) {
        DictDataDO dictData = new DictDataDO();
        dictData.setId(id);
        dictData.setLabel(label);
        dictData.setValue(value);
        dictData.setDictType(dictType);
        dictData.setStatus(status);
        dictData.setSort(sort);
        return dictData;
    }
}
