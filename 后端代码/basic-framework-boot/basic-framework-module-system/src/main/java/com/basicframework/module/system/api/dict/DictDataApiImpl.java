package com.basicframework.module.system.api.dict;

import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.common.biz.system.dict.dto.DictDataRespDTO;
import com.basicframework.module.system.dal.dataobject.dict.DictDataDO;
import com.basicframework.module.system.service.dict.DictDataService;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.List;

/**
 * 字典数据 API 实现类
 *
 * @author 李杰
 */
@Service
public class DictDataApiImpl implements DictDataApi {

    @Resource
    private DictDataService dictDataService;

    /**
     * 校验字典数据List。
     *
     * @param dictType dictType 参数
     * @param values values 数据集合
     */
    @Override
    public void validateDictDataList(String dictType, Collection<String> values) {
        dictDataService.validateDictDataList(dictType, values);
    }

    /**
     * 获取字典数据List。
     *
     * @param dictType dictType 参数
     * @return 查询或转换后的结果
     */
    @Override
    public List<DictDataRespDTO> getDictDataList(String dictType) {
        List<DictDataDO> list = dictDataService.getDictDataListByDictType(dictType);
        return BeanUtils.toBean(list, DictDataRespDTO.class);
    }

}
