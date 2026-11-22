package com.basicframework.module.system.service.dict;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.controller.admin.dict.vo.data.DictDataPageReqVO;
import com.basicframework.module.system.controller.admin.dict.vo.data.DictDataSaveReqVO;
import com.basicframework.module.system.dal.dataobject.dict.DictDataDO;
import org.springframework.lang.Nullable;

import java.util.Collection;
import java.util.List;

/**
 * 字典数据服务接口。
 * <p>
 * 提供字典数据维护、查询、解析和有效性校验能力。
 *
 * @author 李杰
 */
public interface DictDataService {

    /**
     * 创建字典数据。
     *
     * @param createReqVO 字典数据创建参数
     * @return 字典数据编号
     */
    Long createDictData(DictDataSaveReqVO createReqVO);

    /**
     * 更新字典数据。
     *
     * @param updateReqVO 字典数据更新参数
     */
    void updateDictData(DictDataSaveReqVO updateReqVO);

    /**
     * 删除字典数据。
     *
     * @param id 字典数据编号
     */
    void deleteDictData(Long id);

    /**
     * 批量删除字典数据。
     *
     * @param ids 字典数据编号列表
     */
    void deleteDictDataList(List<Long> ids);

    /**
     * 查询字典数据列表。
     *
     * @param status   状态，可为空
     * @param dictType 字典类型，可为空
     * @return 字典数据列表
     */
    List<DictDataDO> getDictDataList(@Nullable Integer status, @Nullable String dictType);

    /**
     * 分页查询字典数据。
     *
     * @param pageReqVO 分页请求
     * @return 字典数据分页结果
     */
    PageResult<DictDataDO> getDictDataPage(DictDataPageReqVO pageReqVO);

    /**
     * 按编号获取字典数据。
     *
     * @param id 字典数据编号
     * @return 字典数据
     */
    DictDataDO getDictData(Long id);

    /**
     * 查询指定字典类型的数据数量。
     *
     * @param dictType 字典类型
     * @return 数据数量
     */
    long getDictDataCountByDictType(String dictType);

    /**
     * 查询多个字典类型的数据总数，避免批量操作逐项查询。
     *
     * @param dictTypes 字典类型集合
     * @return 数据总数
     */
    long getDictDataCountByDictTypes(Collection<String> dictTypes);

    /**
     * 校验字典数据列表有效性。
     * <p>
     * 逐个校验字典值是否存在且处于启用状态。
     *
     * @param dictType 字典类型
     * @param values   字典值集合
     */
    void validateDictDataList(String dictType, Collection<String> values);

    /**
     * 根据类型和值获取字典数据。
     *
     * @param dictType 字典类型
     * @param value    字典值
     * @return 字典数据
     */
    DictDataDO getDictData(String dictType, String value);

    /**
     * 根据类型和标签解析字典数据。
     *
     * @param dictType 字典类型
     * @param label    字典标签
     * @return 字典数据
     */
    DictDataDO parseDictData(String dictType, String label);

    /**
     * 查询指定类型的字典数据列表。
     *
     * @param dictType 字典类型
     * @return 字典数据列表
     */
    List<DictDataDO> getDictDataListByDictType(String dictType);

}
