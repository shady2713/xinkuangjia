package com.basicframework.module.system.api.dict;

import com.basicframework.framework.common.biz.system.dict.DictDataCommonApi;
import com.basicframework.framework.common.biz.system.dict.dto.DictDataRespDTO;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.module.system.dal.dataobject.dict.DictDataDO;
import com.basicframework.module.system.service.dict.DictDataService;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 字典数据核心 SPI 实现，供 core 层字典工具与 Excel 字典转换调用。
 *
 * @author shady
 */
@Service
public class DictDataApiImpl implements DictDataCommonApi {

    @Resource
    private DictDataService dictDataService;

    /**
     * 获取指定字典类型的字典数据列表。
     *
     * @param dictType 字典类型
     * @return 字典数据列表
     */
    @Override
    public List<DictDataRespDTO> getDictDataList(String dictType) {
        List<DictDataDO> list = dictDataService.getDictDataListByDictType(dictType);
        return BeanUtils.toBean(list, DictDataRespDTO.class);
    }

}
