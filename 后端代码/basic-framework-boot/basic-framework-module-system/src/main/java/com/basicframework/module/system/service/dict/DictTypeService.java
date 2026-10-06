package com.basicframework.module.system.service.dict;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.controller.admin.dict.vo.type.DictTypePageReqVO;
import com.basicframework.module.system.controller.admin.dict.vo.type.DictTypeSaveReqVO;
import com.basicframework.module.system.dal.dataobject.dict.DictTypeDO;

import java.util.List;

/**
 * 字典类型服务接口。
 * <p>
 * 提供字典类型的维护、分页查询和全量查询能力。
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
public interface DictTypeService {

    /**
     * 创建字典类型。
     *
     * @param createReqVO 字典类型创建参数
     * @return 字典类型编号
     */
    Long createDictType(DictTypeSaveReqVO createReqVO);

    /**
     * 更新字典类型。
     *
     * @param updateReqVO 字典类型更新参数
     */
    void updateDictType(DictTypeSaveReqVO updateReqVO);

    /**
     * 删除字典类型。
     *
     * @param id 字典类型编号
     */
    void deleteDictType(Long id);

    /**
     * 批量删除字典类型。
     *
     * @param ids 字典类型编号列表
     */
    void deleteDictTypeList(List<Long> ids);

    /**
     * 分页查询字典类型。
     *
     * @param pageReqVO 分页请求
     * @return 字典类型分页结果
     */
    PageResult<DictTypeDO> getDictTypePage(DictTypePageReqVO pageReqVO);

    /**
     * 按编号获取字典类型。
     *
     * @param id 字典类型编号
     * @return 字典类型信息
     */
    DictTypeDO getDictType(Long id);

    /**
     * 按类型编码获取字典类型。
     *
     * @param type 字典类型编码
     * @return 字典类型信息
     */
    DictTypeDO getDictType(String type);

    /**
     * 查询全部字典类型。
     *
     * @return 字典类型列表
     */
    List<DictTypeDO> getDictTypeList();

}
