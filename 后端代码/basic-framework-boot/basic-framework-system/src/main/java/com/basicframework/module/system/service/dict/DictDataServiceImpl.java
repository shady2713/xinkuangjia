package com.basicframework.module.system.service.dict;

import cn.hutool.core.collection.CollUtil;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.collection.CollectionUtils;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.module.system.controller.admin.dict.vo.data.DictDataPageReqVO;
import com.basicframework.module.system.controller.admin.dict.vo.data.DictDataSaveReqVO;
import com.basicframework.module.system.dal.dataobject.dict.DictDataDO;
import com.basicframework.module.system.dal.dataobject.dict.DictTypeDO;
import com.basicframework.module.system.dal.mysql.dict.DictDataMapper;
import com.google.common.annotations.VisibleForTesting;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.module.system.enums.ErrorCodeConstants.*;

/**
 * 字典数据服务实现类。
 * <p>
 * 负责字典数据维护、按类型查询和字典值有效性校验。
 *
 * @author 李杰
 */
@Service
@Slf4j
public class DictDataServiceImpl implements DictDataService {

    /**
     * 字典数据默认排序规则：先按字典类型，再按排序值。
     */
    private static final Comparator<DictDataDO> COMPARATOR_TYPE_AND_SORT = Comparator
            .comparing(DictDataDO::getDictType)
            .thenComparingInt(DictDataDO::getSort);

    @Resource
    private DictTypeService dictTypeService;

    @Resource
    private DictDataMapper dictDataMapper;

    /**
     * 查询字典数据列表。
     *
     * @param status   状态
     * @param dictType 字典类型
     * @return 字典数据列表
     */
    @Override
    public List<DictDataDO> getDictDataList(Integer status, String dictType) {
        List<DictDataDO> list = dictDataMapper.selectListByStatusAndDictType(status, dictType);
        list.sort(COMPARATOR_TYPE_AND_SORT);
        return list;
    }

    /**
     * 分页查询字典数据。
     *
     * @param pageReqVO 分页请求
     * @return 字典数据分页结果
     */
    @Override
    public PageResult<DictDataDO> getDictDataPage(DictDataPageReqVO pageReqVO) {
        return dictDataMapper.selectPage(pageReqVO);
    }

    /**
     * 按编号获取字典数据。
     *
     * @param id 字典数据编号
     * @return 字典数据
     */
    @Override
    public DictDataDO getDictData(Long id) {
        return dictDataMapper.selectById(id);
    }

    /**
     * 创建字典数据。
     *
     * @param createReqVO 字典数据创建参数
     * @return 字典数据编号
     */
    @Override
    public Long createDictData(DictDataSaveReqVO createReqVO) {
        validateDictTypeExists(createReqVO.getDictType());
        validateDictDataValueUnique(null, createReqVO.getDictType(), createReqVO.getValue());

        DictDataDO dictData = BeanUtils.toBean(createReqVO, DictDataDO.class);
        dictDataMapper.insert(dictData);
        return dictData.getId();
    }

    /**
     * 更新字典数据。
     *
     * @param updateReqVO 字典数据更新参数
     */
    @Override
    public void updateDictData(DictDataSaveReqVO updateReqVO) {
        validateDictDataExists(updateReqVO.getId());
        validateDictTypeExists(updateReqVO.getDictType());
        validateDictDataValueUnique(updateReqVO.getId(), updateReqVO.getDictType(), updateReqVO.getValue());

        DictDataDO updateObj = BeanUtils.toBean(updateReqVO, DictDataDO.class);
        dictDataMapper.updateById(updateObj);
    }

    /**
     * 删除字典数据。
     *
     * @param id 字典数据编号
     */
    @Override
    public void deleteDictData(Long id) {
        validateDictDataExists(id);
        dictDataMapper.deleteById(id);
    }

    /**
     * 批量删除字典数据。
     *
     * @param ids 字典数据编号列表
     */
    @Override
    public void deleteDictDataList(List<Long> ids) {
        dictDataMapper.deleteByIds(ids);
    }

    /**
     * 查询指定字典类型的数据数量。
     *
     * @param dictType 字典类型
     * @return 数据数量
     */
    @Override
    public long getDictDataCountByDictType(String dictType) {
        return dictDataMapper.selectCountByDictType(dictType);
    }

    /**
     * 查询多个字典类型的数据总数。
     *
     * @param dictTypes 字典类型集合
     * @return 数据总数
     */
    @Override
    public long getDictDataCountByDictTypes(Collection<String> dictTypes) {
        return CollUtil.isEmpty(dictTypes) ? 0 : dictDataMapper.selectCountByDictTypes(dictTypes);
    }

    /**
     * 校验字典值在同一字典类型下是否唯一。
     *
     * @param id       字典数据编号
     * @param dictType 字典类型
     * @param value    字典值
     */
    @VisibleForTesting
    public void validateDictDataValueUnique(Long id, String dictType, String value) {
        DictDataDO dictData = dictDataMapper.selectByDictTypeAndValue(dictType, value);
        if (dictData == null) {
            return;
        }
        if (id == null) {
            throw exception(DICT_DATA_VALUE_DUPLICATE);
        }
        if (!dictData.getId().equals(id)) {
            throw exception(DICT_DATA_VALUE_DUPLICATE);
        }
    }

    /**
     * 校验字典数据是否存在。
     *
     * @param id 字典数据编号
     */
    @VisibleForTesting
    public void validateDictDataExists(Long id) {
        if (id == null) {
            return;
        }
        DictDataDO dictData = dictDataMapper.selectById(id);
        if (dictData == null) {
            throw exception(DICT_DATA_NOT_EXISTS);
        }
    }

    /**
     * 校验字典类型是否存在且启用。
     *
     * @param type 字典类型
     */
    @VisibleForTesting
    public void validateDictTypeExists(String type) {
        DictTypeDO dictType = dictTypeService.getDictType(type);
        if (dictType == null) {
            throw exception(DICT_TYPE_NOT_EXISTS);
        }
        if (!CommonStatusEnum.ENABLE.getStatus().equals(dictType.getStatus())) {
            throw exception(DICT_TYPE_NOT_ENABLE);
        }
    }

    /**
     * 校验字典数据列表是否有效。
     *
     * @param dictType 字典类型
     * @param values   字典值集合
     */
    @Override
    public void validateDictDataList(String dictType, Collection<String> values) {
        if (CollUtil.isEmpty(values)) {
            return;
        }
        Map<String, DictDataDO> dictDataMap = CollectionUtils.convertMap(
                dictDataMapper.selectByDictTypeAndValues(dictType, values), DictDataDO::getValue);
        values.forEach(value -> {
            DictDataDO dictData = dictDataMap.get(value);
            if (dictData == null) {
                throw exception(DICT_DATA_NOT_EXISTS);
            }
            if (!CommonStatusEnum.ENABLE.getStatus().equals(dictData.getStatus())) {
                throw exception(DICT_DATA_NOT_ENABLE, dictData.getLabel());
            }
        });
    }

    /**
     * 根据类型和值获取字典数据。
     *
     * @param dictType 字典类型
     * @param value    字典值
     * @return 字典数据
     */
    @Override
    public DictDataDO getDictData(String dictType, String value) {
        return dictDataMapper.selectByDictTypeAndValue(dictType, value);
    }

    /**
     * 根据类型和标签解析字典数据。
     *
     * @param dictType 字典类型
     * @param label    字典标签
     * @return 字典数据
     */
    @Override
    public DictDataDO parseDictData(String dictType, String label) {
        return dictDataMapper.selectByDictTypeAndLabel(dictType, label);
    }

    /**
     * 查询指定字典类型的数据列表。
     *
     * @param dictType 字典类型
     * @return 字典数据列表
     */
    @Override
    public List<DictDataDO> getDictDataListByDictType(String dictType) {
        List<DictDataDO> list = dictDataMapper.selectList(DictDataDO::getDictType, dictType);
        list.sort(Comparator.comparing(DictDataDO::getSort));
        return list;
    }

}
