package com.basicframework.module.system.service.dict;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.framework.security.core.util.SecurityFrameworkUtils;
import com.basicframework.module.system.controller.admin.dict.vo.type.DictTypePageReqVO;
import com.basicframework.module.system.controller.admin.dict.vo.type.DictTypeSaveReqVO;
import com.basicframework.module.system.dal.dataobject.dict.DictTypeDO;
import com.basicframework.module.system.dal.mysql.dict.DictTypeMapper;
import com.google.common.annotations.VisibleForTesting;
import jakarta.annotation.Resource;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Objects;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.module.system.enums.ErrorCodeConstants.*;

/**
 * 字典类型 Service 实现类
 *
 * @author 芋道源码
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
@Service
public class DictTypeServiceImpl implements DictTypeService {

    /**
     * 软删除唯一索引使用的非空占位时间。
     */
    private static final LocalDateTime EMPTY_DELETED_TIME = LocalDateTime.of(1970, 1, 1, 0, 0);

    @Resource
    private ObjectProvider<DictDataService> dictDataServiceProvider;

    @Resource
    private DictTypeMapper dictTypeMapper;

    /**
     * 分页查询字典类型。
     *
     * @param pageReqVO 分页请求
     * @return 分页结果
     */
    @Override
    public PageResult<DictTypeDO> getDictTypePage(DictTypePageReqVO pageReqVO) {
        return dictTypeMapper.selectPage(pageReqVO);
    }

    /**
     * 按编号查询字典类型。
     *
     * @param id 字典类型编号
     * @return 字典类型
     */
    @Override
    public DictTypeDO getDictType(Long id) {
        return dictTypeMapper.selectById(id);
    }

    /**
     * 按类型编码查询字典类型。
     *
     * @param type 类型编码
     * @return 字典类型
     */
    @Override
    public DictTypeDO getDictType(String type) {
        return dictTypeMapper.selectByType(type);
    }

    /**
     * 校验唯一性并创建字典类型。
     *
     * @param createReqVO 创建请求
     * @return 新字典类型编号
     */
    @Override
    public Long createDictType(DictTypeSaveReqVO createReqVO) {
        // 校验字典类型的名字的唯一性
        validateDictTypeNameUnique(null, createReqVO.getName());
        // 校验字典类型的类型的唯一性
        validateDictTypeUnique(null, createReqVO.getType());

        // 插入字典类型
        DictTypeDO dictType = BeanUtils.toBean(createReqVO, DictTypeDO.class);
        dictType.setDeletedTime(EMPTY_DELETED_TIME); // 唯一索引，避免 null 值
        dictTypeMapper.insert(dictType);
        return dictType.getId();
    }

    /**
     * 校验存在性和唯一性后更新字典类型。
     *
     * @param updateReqVO 更新请求
     */
    @Override
    public void updateDictType(DictTypeSaveReqVO updateReqVO) {
        // 校验自己存在
        validateDictTypeExists(updateReqVO.getId());
        // 校验字典类型的名字的唯一性
        validateDictTypeNameUnique(updateReqVO.getId(), updateReqVO.getName());
        // 校验字典类型的类型的唯一性
        validateDictTypeUnique(updateReqVO.getId(), updateReqVO.getType());

        // 更新字典类型
        DictTypeDO updateObj = BeanUtils.toBean(updateReqVO, DictTypeDO.class);
        dictTypeMapper.updateById(updateObj);
    }

    /**
     * 确认没有字典数据后软删除字典类型。
     *
     * @param id 字典类型编号
     */
    @Override
    public void deleteDictType(Long id) {
        // 校验是否存在
        DictTypeDO dictType = validateDictTypeExists(id);
        // 校验是否有字典数据
        if (getDictDataService().getDictDataCountByDictType(dictType.getType()) > 0) {
            throw exception(DICT_TYPE_HAS_CHILDREN);
        }
        // 删除字典类型：连同操作人一起写入，否则审计会保留上一位操作人
        dictTypeMapper.updateToDelete(id, LocalDateTime.now(), currentUpdater());
    }

    /**
     * 一次性校验子数据并批量软删除字典类型。
     *
     * @param ids 字典类型编号列表
     */
    @Override
    public void deleteDictTypeList(List<Long> ids) {
        if (CollUtil.isEmpty(ids)) {
            return;
        }
        if (ids.stream().anyMatch(Objects::isNull)) {
            throw exception(DICT_TYPE_NOT_EXISTS);
        }
        List<Long> distinctIds = ids.stream().distinct().toList();
        List<DictTypeDO> dictTypes = dictTypeMapper.selectByIds(distinctIds);
        if (dictTypes.size() != distinctIds.size()) {
            throw exception(DICT_TYPE_NOT_EXISTS);
        }
        List<String> dictTypeCodes = dictTypes.stream().map(DictTypeDO::getType).toList();
        if (getDictDataService().getDictDataCountByDictTypes(dictTypeCodes) > 0) {
            throw exception(DICT_TYPE_HAS_CHILDREN);
        }

        // 校验通过后一次性更新，避免逐项计数和逐项删除造成 2N 次数据库访问。
        dictTypeMapper.updateToDeleteByIds(distinctIds, LocalDateTime.now(), currentUpdater());
    }

    /**
     * 取本次删除的操作人编号文本。
     *
     * <p>软删除走的是 {@code update(null, wrapper)}，空实体不会触发 MyBatis-Plus 的
     * {@code updateFill}，因此操作人必须在服务层取出后显式写入；没有登录上下文时返回
     * {@code null}，由 Mapper 保留原值而不是写入空操作人。</p>
     *
     * @return 当前登录用户编号的文本形式；无登录上下文时为 {@code null}
     */
    private String currentUpdater() {
        Long userId = SecurityFrameworkUtils.getLoginUserId();
        return userId == null ? null : userId.toString();
    }

    /**
     * 查询全部字典类型。
     *
     * @return 字典类型列表
     */
    @Override
    public List<DictTypeDO> getDictTypeList() {
        return dictTypeMapper.selectList();
    }

    /**
     * 校验字典名称在其他记录中不存在。
     *
     * @param id 当前字典类型编号，创建时为空
     * @param name 字典名称
     */
    @VisibleForTesting
    void validateDictTypeNameUnique(Long id, String name) {
        DictTypeDO dictType = dictTypeMapper.selectByName(name);
        if (dictType == null) {
            return;
        }
        // 如果 id 为空，说明不用比较是否为相同 id 的字典类型
        if (id == null) {
            throw exception(DICT_TYPE_NAME_DUPLICATE);
        }
        if (!dictType.getId().equals(id)) {
            throw exception(DICT_TYPE_NAME_DUPLICATE);
        }
    }

    /**
     * 校验字典类型编码在其他记录中不存在。
     *
     * @param id 当前字典类型编号，创建时为空
     * @param type 字典类型编码
     */
    @VisibleForTesting
    void validateDictTypeUnique(Long id, String type) {
        if (StrUtil.isEmpty(type)) {
            return;
        }
        DictTypeDO dictType = dictTypeMapper.selectByType(type);
        if (dictType == null) {
            return;
        }
        // 如果 id 为空，说明不用比较是否为相同 id 的字典类型
        if (id == null) {
            throw exception(DICT_TYPE_TYPE_DUPLICATE);
        }
        if (!dictType.getId().equals(id)) {
            throw exception(DICT_TYPE_TYPE_DUPLICATE);
        }
    }

    /**
     * 延迟获取字典数据服务，避免两个字典服务形成初始化循环依赖。
     *
     * @return 字典数据服务
     */
    private DictDataService getDictDataService() {
        return dictDataServiceProvider.getObject();
    }

    /**
     * 校验字典类型存在并返回记录。
     *
     * @param id 字典类型编号
     * @return 字典类型；编号为空时返回空
     */
    @VisibleForTesting
    DictTypeDO validateDictTypeExists(Long id) {
        if (id == null) {
            return null;
        }
        DictTypeDO dictType = dictTypeMapper.selectById(id);
        if (dictType == null) {
            throw exception(DICT_TYPE_NOT_EXISTS);
        }
        return dictType;
    }

}
