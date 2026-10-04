package com.basicframework.module.system.service.dict;

import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.exception.ErrorCode;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.controller.admin.dict.vo.data.DictDataPageReqVO;
import com.basicframework.module.system.controller.admin.dict.vo.data.DictDataSaveReqVO;
import com.basicframework.module.system.dal.dataobject.dict.DictDataDO;
import com.basicframework.module.system.dal.dataobject.dict.DictTypeDO;
import com.basicframework.module.system.dal.mysql.dict.DictDataMapper;
import com.basicframework.module.system.enums.ErrorCodeConstants;
import com.baomidou.mybatisplus.core.toolkit.support.SFunction;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.ArgumentMatchers;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证字典数据服务的排序契约、唯一性校验、类型状态前置检查与批量校验语义。
 *
 * <p>字典数据是前端下拉项的真实来源：按状态与类型查询时必须先按字典类型、再按排序值升序返回，
 * 否则同一页面内多个字典的展示顺序会随数据库返回顺序漂移；按类型查询时只按排序值升序。
 * 创建与更新都必须先确认父级字典类型存在且为开启状态，否则会写出前端无法解析的孤儿字典值；
 * 同一字典类型下的 value 必须唯一，更新时命中自身记录不算冲突。</p>
 *
 * <p>批量校验 {@code validateDictDataList} 逐个值核对存在性与启用状态，命中禁用数据时必须带上
 * 该数据的标签，便于前端提示具体是哪一项不可用；空集合直接放行且不访问持久层。</p>
 *
 * <p>持久层与父级字典类型服务按进程外边界替换为替身，服务内的排序、转换、校验与异常逻辑真实执行，
 * 异常断言逐条核对真实业务错误码。</p>
 *
 * @author shady2713
 */
class DictDataServiceImplTest {

    /** 被测服务。 */
    private DictDataServiceImpl dictDataService;
    /** 字典数据持久层替身。 */
    private DictDataMapper dictDataMapper;
    /** 字典类型服务替身，用于父级存在性与启用状态校验。 */
    private DictTypeService dictTypeService;

    /** 装配服务与替身。 */
    @BeforeEach
    void setUp() {
        dictDataService = new DictDataServiceImpl();
        dictDataMapper = mock(DictDataMapper.class);
        dictTypeService = mock(DictTypeService.class);
        ReflectionTestUtils.setField(dictDataService, "dictDataMapper", dictDataMapper);
        ReflectionTestUtils.setField(dictDataService, "dictTypeService", dictTypeService);
    }

    /** 按状态与类型查询必须先按字典类型、再按排序值升序，与数据库返回顺序无关。 */
    @Test
    void getDictDataListSortsByTypeThenSort() {
        DictDataDO secondOfAlpha = dictData(3L, "DUMMY_TYPE_ALPHA", "DUMMY-甲-二", 2);
        DictDataDO firstOfAlpha = dictData(1L, "DUMMY_TYPE_ALPHA", "DUMMY-甲-一", 1);
        DictDataDO firstOfBeta = dictData(2L, "DUMMY_TYPE_BETA", "DUMMY-乙-一", 1);
        when(dictDataMapper.selectListByStatusAndDictType(CommonStatusEnum.ENABLE.getStatus(), "DUMMY_TYPE_ALPHA"))
                .thenReturn(new ArrayList<>(List.of(secondOfAlpha, firstOfBeta, firstOfAlpha)));

        List<DictDataDO> result = dictDataService.getDictDataList(
                CommonStatusEnum.ENABLE.getStatus(), "DUMMY_TYPE_ALPHA");

        assertThat(result).extracting(DictDataDO::getId).containsExactly(1L, 3L, 2L);
    }

    /** 分页与按编号查询必须原样转发到持久层，不在服务层改写条件。 */
    @Test
    void pageAndIdQueriesDelegateToMapper() {
        DictDataPageReqVO pageReqVO = new DictDataPageReqVO();
        when(dictDataMapper.selectPage(pageReqVO))
                .thenReturn(new PageResult<>(List.of(dictData(1L, "DUMMY_TYPE", "DUMMY-值", 1)), 1L));
        assertThat(dictDataService.getDictDataPage(pageReqVO).getTotal()).isEqualTo(1L);

        when(dictDataMapper.selectById(1L)).thenReturn(dictData(1L, "DUMMY_TYPE", "DUMMY-值", 1));
        assertThat(dictDataService.getDictData(1L).getDictType()).isEqualTo("DUMMY_TYPE");
    }

    /** 创建字典数据必须先校验父级类型与值唯一，再落库并返回新编号。 */
    @Test
    void createDictDataValidatesThenInserts() {
        DictDataSaveReqVO reqVO = saveReqVO(null, "DUMMY_TYPE", "DUMMY-值", 3);
        when(dictTypeService.getDictType("DUMMY_TYPE"))
                .thenReturn(dictType(9L, "DUMMY_TYPE", CommonStatusEnum.ENABLE.getStatus()));
        when(dictDataMapper.selectByDictTypeAndValue("DUMMY_TYPE", "DUMMY-值")).thenReturn(null);

        dictDataService.createDictData(reqVO);

        ArgumentCaptor<DictDataDO> captor = ArgumentCaptor.forClass(DictDataDO.class);
        verify(dictDataMapper).insert(captor.capture());
        assertThat(captor.getValue().getDictType()).isEqualTo("DUMMY_TYPE");
        assertThat(captor.getValue().getValue()).isEqualTo("DUMMY-值");
        assertThat(captor.getValue().getSort()).isEqualTo(3);
        assertThat(captor.getValue().getStatus()).isEqualTo(CommonStatusEnum.ENABLE.getStatus());
    }

    /** 创建字典数据在父级类型不存在或未开启时必须拒绝，且不得落库。 */
    @Test
    void createDictDataRejectsMissingOrDisabledDictType() {
        DictDataSaveReqVO reqVO = saveReqVO(null, "DUMMY_TYPE", "DUMMY-值", 3);
        when(dictTypeService.getDictType("DUMMY_TYPE")).thenReturn(null);
        assertBusinessError(() -> dictDataService.createDictData(reqVO), ErrorCodeConstants.DICT_TYPE_NOT_EXISTS);

        when(dictTypeService.getDictType("DUMMY_TYPE"))
                .thenReturn(dictType(9L, "DUMMY_TYPE", CommonStatusEnum.DISABLE.getStatus()));
        assertBusinessError(() -> dictDataService.createDictData(reqVO), ErrorCodeConstants.DICT_TYPE_NOT_ENABLE);

        verify(dictDataMapper, never()).insert(any(DictDataDO.class));
    }

    /** 创建字典数据遇到同类型下已存在的值时必须拒绝。 */
    @Test
    void createDictDataRejectsDuplicateValue() {
        DictDataSaveReqVO reqVO = saveReqVO(null, "DUMMY_TYPE", "DUMMY-值", 3);
        when(dictTypeService.getDictType("DUMMY_TYPE"))
                .thenReturn(dictType(9L, "DUMMY_TYPE", CommonStatusEnum.ENABLE.getStatus()));
        when(dictDataMapper.selectByDictTypeAndValue("DUMMY_TYPE", "DUMMY-值"))
                .thenReturn(dictData(1L, "DUMMY_TYPE", "DUMMY-值", 1));

        assertBusinessError(() -> dictDataService.createDictData(reqVO),
                ErrorCodeConstants.DICT_DATA_VALUE_DUPLICATE);
        verify(dictDataMapper, never()).insert(any(DictDataDO.class));
    }

    /** 更新字典数据必须先校验存在性、父级类型与值唯一，再按编号更新。 */
    @Test
    void updateDictDataValidatesThenUpdates() {
        DictDataSaveReqVO reqVO = saveReqVO(1L, "DUMMY_TYPE", "DUMMY-值", 3);
        when(dictDataMapper.selectById(1L)).thenReturn(dictData(1L, "DUMMY_TYPE", "DUMMY-值", 1));
        when(dictTypeService.getDictType("DUMMY_TYPE"))
                .thenReturn(dictType(9L, "DUMMY_TYPE", CommonStatusEnum.ENABLE.getStatus()));
        when(dictDataMapper.selectByDictTypeAndValue("DUMMY_TYPE", "DUMMY-值"))
                .thenReturn(dictData(1L, "DUMMY_TYPE", "DUMMY-值", 1));

        dictDataService.updateDictData(reqVO);

        ArgumentCaptor<DictDataDO> captor = ArgumentCaptor.forClass(DictDataDO.class);
        verify(dictDataMapper).updateById(captor.capture());
        assertThat(captor.getValue().getId()).isEqualTo(1L);
        assertThat(captor.getValue().getSort()).isEqualTo(3);
    }

    /** 更新不存在的字典数据必须拒绝；更新到他人已占用的值同样必须拒绝。 */
    @Test
    void updateDictDataRejectsMissingRecordAndValueConflict() {
        DictDataSaveReqVO absent = saveReqVO(9L, "DUMMY_TYPE", "DUMMY-值", 3);
        when(dictDataMapper.selectById(9L)).thenReturn(null);
        assertBusinessError(() -> dictDataService.updateDictData(absent), ErrorCodeConstants.DICT_DATA_NOT_EXISTS);

        DictDataSaveReqVO conflict = saveReqVO(1L, "DUMMY_TYPE", "DUMMY-值", 3);
        when(dictDataMapper.selectById(1L)).thenReturn(dictData(1L, "DUMMY_TYPE", "DUMMY-值", 1));
        when(dictTypeService.getDictType("DUMMY_TYPE"))
                .thenReturn(dictType(9L, "DUMMY_TYPE", CommonStatusEnum.ENABLE.getStatus()));
        when(dictDataMapper.selectByDictTypeAndValue("DUMMY_TYPE", "DUMMY-值"))
                .thenReturn(dictData(2L, "DUMMY_TYPE", "DUMMY-值", 1));
        assertBusinessError(() -> dictDataService.updateDictData(conflict),
                ErrorCodeConstants.DICT_DATA_VALUE_DUPLICATE);

        verify(dictDataMapper, never()).updateById(any(DictDataDO.class));
    }

    /** 删除字典数据必须先确认存在，再按编号删除。 */
    @Test
    void deleteDictDataValidatesThenDeletes() {
        when(dictDataMapper.selectById(1L)).thenReturn(dictData(1L, "DUMMY_TYPE", "DUMMY-值", 1));

        dictDataService.deleteDictData(1L);

        verify(dictDataMapper).deleteById(1L);

        when(dictDataMapper.selectById(9L)).thenReturn(null);
        assertBusinessError(() -> dictDataService.deleteDictData(9L), ErrorCodeConstants.DICT_DATA_NOT_EXISTS);
        verify(dictDataMapper, never()).deleteById(9L);
    }

    /** 批量删除必须原样转发编号集合，不做逐条存在性校验。 */
    @Test
    void deleteDictDataListForwardsIds() {
        dictDataService.deleteDictDataList(List.of(1L, 2L));

        verify(dictDataMapper).deleteByIds(List.of(1L, 2L));
    }

    /** 按类型与多类型统计必须转发到持久层；空类型集合直接返回 0 且不访问持久层。 */
    @Test
    void countQueriesShortCircuitEmptyTypes() {
        when(dictDataMapper.selectCountByDictType("DUMMY_TYPE")).thenReturn(2L);
        assertThat(dictDataService.getDictDataCountByDictType("DUMMY_TYPE")).isEqualTo(2L);

        assertThat(dictDataService.getDictDataCountByDictTypes(Collections.emptyList())).isZero();
        verify(dictDataMapper, never()).selectCountByDictTypes(anyCollection());

        when(dictDataMapper.selectCountByDictTypes(List.of("DUMMY_TYPE", "DUMMY_TYPE_2"))).thenReturn(5L);
        assertThat(dictDataService.getDictDataCountByDictTypes(List.of("DUMMY_TYPE", "DUMMY_TYPE_2")))
                .isEqualTo(5L);
    }

    /** 值唯一性校验必须区分未命中、新增冲突、改到他人值与保持自身值四种情况。 */
    @Test
    void validateDictDataValueUniqueDistinguishesCases() {
        when(dictDataMapper.selectByDictTypeAndValue("DUMMY_TYPE", "DUMMY-值")).thenReturn(null);
        dictDataService.validateDictDataValueUnique(1L, "DUMMY_TYPE", "DUMMY-值");

        when(dictDataMapper.selectByDictTypeAndValue("DUMMY_TYPE", "DUMMY-值"))
                .thenReturn(dictData(2L, "DUMMY_TYPE", "DUMMY-值", 1));
        assertBusinessError(() -> dictDataService.validateDictDataValueUnique(null, "DUMMY_TYPE", "DUMMY-值"),
                ErrorCodeConstants.DICT_DATA_VALUE_DUPLICATE);
        assertBusinessError(() -> dictDataService.validateDictDataValueUnique(1L, "DUMMY_TYPE", "DUMMY-值"),
                ErrorCodeConstants.DICT_DATA_VALUE_DUPLICATE);

        dictDataService.validateDictDataValueUnique(2L, "DUMMY_TYPE", "DUMMY-值");
    }

    /** 存在性校验对空编号直接放行，对不存在编号抛错，命中时不做任何返回处理。 */
    @Test
    void validateDictDataExistsDistinguishesCases() {
        dictDataService.validateDictDataExists(null);
        verify(dictDataMapper, never()).selectById(null);

        when(dictDataMapper.selectById(9L)).thenReturn(null);
        assertBusinessError(() -> dictDataService.validateDictDataExists(9L), ErrorCodeConstants.DICT_DATA_NOT_EXISTS);

        when(dictDataMapper.selectById(1L)).thenReturn(dictData(1L, "DUMMY_TYPE", "DUMMY-值", 1));
        dictDataService.validateDictDataExists(1L);
    }

    /** 父级类型校验必须区分不存在与未开启，两者错误码不同。 */
    @Test
    void validateDictTypeExistsDistinguishesMissingAndDisabled() {
        when(dictTypeService.getDictType("DUMMY_TYPE")).thenReturn(null);
        assertBusinessError(() -> dictDataService.validateDictTypeExists("DUMMY_TYPE"),
                ErrorCodeConstants.DICT_TYPE_NOT_EXISTS);

        when(dictTypeService.getDictType("DUMMY_TYPE"))
                .thenReturn(dictType(9L, "DUMMY_TYPE", CommonStatusEnum.DISABLE.getStatus()));
        assertBusinessError(() -> dictDataService.validateDictTypeExists("DUMMY_TYPE"),
                ErrorCodeConstants.DICT_TYPE_NOT_ENABLE);

        when(dictTypeService.getDictType("DUMMY_TYPE"))
                .thenReturn(dictType(9L, "DUMMY_TYPE", CommonStatusEnum.ENABLE.getStatus()));
        dictDataService.validateDictTypeExists("DUMMY_TYPE");
    }

    /** 批量字典值校验必须逐个核对：空集合放行、缺失值报不存在、禁用值带上标签报不可用。 */
    @Test
    void validateDictDataListChecksEachValue() {
        dictDataService.validateDictDataList("DUMMY_TYPE", Collections.emptyList());
        verify(dictDataMapper, never()).selectByDictTypeAndValues(anyString(), anyCollection());

        when(dictDataMapper.selectByDictTypeAndValues(eq("DUMMY_TYPE"), anyCollection()))
                .thenReturn(List.of(dictData(1L, "DUMMY_TYPE", "DUMMY-甲", 1)));
        assertBusinessError(() -> dictDataService.validateDictDataList("DUMMY_TYPE", List.of("DUMMY-甲", "DUMMY-乙")),
                ErrorCodeConstants.DICT_DATA_NOT_EXISTS);

        when(dictDataMapper.selectByDictTypeAndValues(eq("DUMMY_TYPE"), anyCollection()))
                .thenReturn(List.of(dictData(1L, "DUMMY_TYPE", "DUMMY-甲", 1,
                        CommonStatusEnum.DISABLE.getStatus())));
        assertThatThrownBy(() -> dictDataService.validateDictDataList("DUMMY_TYPE", List.of("DUMMY-甲")))
                .isInstanceOfSatisfying(ServiceException.class, exception -> {
                    assertThat(exception.getCode()).isEqualTo(ErrorCodeConstants.DICT_DATA_NOT_ENABLE.getCode());
                    assertThat(exception.getMessage()).as("必须指出具体哪一项字典数据不可用").contains("DUMMY-标签-1");
                });

        when(dictDataMapper.selectByDictTypeAndValues(eq("DUMMY_TYPE"), anyCollection()))
                .thenReturn(List.of(dictData(1L, "DUMMY_TYPE", "DUMMY-甲", 1)));
        dictDataService.validateDictDataList("DUMMY_TYPE", List.of("DUMMY-甲"));
    }

    /** 按类型和值、按类型和标签查询必须原样转发到持久层。 */
    @Test
    void typedQueriesDelegateToMapper() {
        when(dictDataMapper.selectByDictTypeAndValue("DUMMY_TYPE", "DUMMY-值"))
                .thenReturn(dictData(1L, "DUMMY_TYPE", "DUMMY-值", 1));
        assertThat(dictDataService.getDictData("DUMMY_TYPE", "DUMMY-值").getId()).isEqualTo(1L);

        when(dictDataMapper.selectByDictTypeAndLabel("DUMMY_TYPE", "DUMMY-标签"))
                .thenReturn(dictData(2L, "DUMMY_TYPE", "DUMMY-值", 1));
        assertThat(dictDataService.parseDictData("DUMMY_TYPE", "DUMMY-标签").getId()).isEqualTo(2L);
    }

    /** 按字典类型查询列表必须只按排序值升序返回，与数据库返回顺序无关。 */
    @Test
    void getDictDataListByDictTypeSortsBySortOnly() {
        when(dictDataMapper.selectList(ArgumentMatchers.<SFunction<DictDataDO, ?>>any(), eq("DUMMY_TYPE")))
                .thenReturn(new ArrayList<>(List.of(
                dictData(2L, "DUMMY_TYPE", "DUMMY-乙", 2),
                dictData(1L, "DUMMY_TYPE", "DUMMY-甲", 1))));

        List<DictDataDO> result = dictDataService.getDictDataListByDictType("DUMMY_TYPE");

        assertThat(result).extracting(DictDataDO::getSort).containsExactly(1, 2);
    }

    /**
     * 断言业务异常的错误码。
     *
     * @param action 触发业务校验的动作
     * @param expected 期望的业务错误码
     */
    private static void assertBusinessError(ThrowingCallable action, ErrorCode expected) {
        assertThatThrownBy(action).isInstanceOfSatisfying(ServiceException.class,
                exception -> assertThat(exception.getCode()).isEqualTo(expected.getCode()));
    }

    /**
     * 构造字典数据保存参数。
     *
     * @param id 字典数据编号，创建时为空
     * @param dictType 字典类型
     * @param value 字典值
     * @param sort 显示顺序
     * @return 保存参数
     */
    private static DictDataSaveReqVO saveReqVO(Long id, String dictType, String value, Integer sort) {
        DictDataSaveReqVO reqVO = new DictDataSaveReqVO();
        reqVO.setId(id);
        reqVO.setDictType(dictType);
        reqVO.setLabel("DUMMY-标签");
        reqVO.setValue(value);
        reqVO.setSort(sort);
        reqVO.setStatus(CommonStatusEnum.ENABLE.getStatus());
        return reqVO;
    }

    /**
     * 构造启用状态的字典数据。
     *
     * @param id 编号
     * @param dictType 字典类型
     * @param value 字典值
     * @param sort 显示顺序
     * @return 字典数据
     */
    private static DictDataDO dictData(Long id, String dictType, String value, Integer sort) {
        return dictData(id, dictType, value, sort, CommonStatusEnum.ENABLE.getStatus());
    }

    /**
     * 构造指定状态的字典数据。
     *
     * @param id 编号
     * @param dictType 字典类型
     * @param value 字典值
     * @param sort 显示顺序
     * @param status 状态
     * @return 字典数据
     */
    private static DictDataDO dictData(Long id, String dictType, String value, Integer sort, Integer status) {
        DictDataDO dictData = new DictDataDO();
        dictData.setId(id);
        dictData.setDictType(dictType);
        dictData.setLabel("DUMMY-标签-" + id);
        dictData.setValue(value);
        dictData.setSort(sort);
        dictData.setStatus(status);
        return dictData;
    }

    /**
     * 构造字典类型。
     *
     * @param id 编号
     * @param type 字典类型
     * @param status 状态
     * @return 字典类型
     */
    private static DictTypeDO dictType(Long id, String type, Integer status) {
        DictTypeDO dictType = new DictTypeDO();
        dictType.setId(id);
        dictType.setType(type);
        dictType.setName("DUMMY-类型-" + id);
        dictType.setStatus(status);
        return dictType;
    }

}
