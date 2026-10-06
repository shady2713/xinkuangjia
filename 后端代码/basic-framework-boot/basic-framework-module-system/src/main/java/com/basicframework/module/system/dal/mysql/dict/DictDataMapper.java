package com.basicframework.module.system.dal.mysql.dict;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.system.controller.admin.dict.vo.data.DictDataPageReqVO;
import com.basicframework.module.system.dal.dataobject.dict.DictDataDO;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import org.apache.ibatis.annotations.Mapper;

import java.util.Arrays;
import java.util.Collection;
import java.util.List;

/**
 * 字典数据访问接口。
 *
 * 来源：YunaiV/ruoyi-vue-pro @ ac022b15a094cf9cf82903d429b9729e72309da5（该版本未声明作者）
 * 上游文件：yudao-module-system/src/main/java/cn/iocoder/yudao/module/system/dal/mysql/dict/DictDataMapper.java
 * 来源依据：固定见证版本；历史引入版本未核实。
 * 本地修改：basic-framework 命名空间、模块名与类名前缀适配；本地改写/新增代码 2 行，例如 default long selectCountByDictTypes(Collection<String> dictTypes) {；return selectCount(new LambdaQueryWrapper<DictDataDO>().in(DictDataDO::getDictType, dictTypes));；本地补充注释 46 行。
 */
@Mapper
public interface DictDataMapper extends BaseMapperX<DictDataDO> {

    /**
     * 按字典类型和值查询唯一字典数据。
     *
     * @param dictType 字典类型
     * @param value 字典值
     * @return 匹配的字典数据
     */
    default DictDataDO selectByDictTypeAndValue(String dictType, String value) {
        return selectOne(DictDataDO::getDictType, dictType, DictDataDO::getValue, value);
    }

    /**
     * 按字典类型和标签查询唯一字典数据。
     *
     * @param dictType 字典类型
     * @param label 字典标签
     * @return 匹配的字典数据
     */
    default DictDataDO selectByDictTypeAndLabel(String dictType, String label) {
        return selectOne(DictDataDO::getDictType, dictType, DictDataDO::getLabel, label);
    }

    /**
     * 查询字典类型下指定值的数据列表。
     *
     * @param dictType 字典类型
     * @param values 字典值集合
     * @return 字典数据列表
     */
    default List<DictDataDO> selectByDictTypeAndValues(String dictType, Collection<String> values) {
        return selectList(new LambdaQueryWrapper<DictDataDO>().eq(DictDataDO::getDictType, dictType)
                .in(DictDataDO::getValue, values));
    }

    /**
     * 统计单个字典类型的数据数量。
     *
     * @param dictType 字典类型
     * @return 数据数量
     */
    default long selectCountByDictType(String dictType) {
        return selectCount(DictDataDO::getDictType, dictType);
    }

    /**
     * 统计多个字典类型下的数据总数，供批量删除前一次性校验。
     *
     * @param dictTypes 字典类型集合
     * @return 匹配的数据总数
     */
    default long selectCountByDictTypes(Collection<String> dictTypes) {
        return selectCount(new LambdaQueryWrapper<DictDataDO>().in(DictDataDO::getDictType, dictTypes));
    }

    /**
     * 分页查询字典数据。
     *
     * @param reqVO 分页请求
     * @return 分页结果
     */
    default PageResult<DictDataDO> selectPage(DictDataPageReqVO reqVO) {
        return selectPage(reqVO, new LambdaQueryWrapperX<DictDataDO>()
                .likeIfPresent(DictDataDO::getLabel, reqVO.getLabel())
                .eqIfPresent(DictDataDO::getDictType, reqVO.getDictType())
                .eqIfPresent(DictDataDO::getStatus, reqVO.getStatus())
                .orderByDesc(Arrays.asList(DictDataDO::getDictType, DictDataDO::getSort)));
    }

    /**
     * 按状态和字典类型查询数据列表。
     *
     * @param status 状态
     * @param dictType 字典类型
     * @return 字典数据列表
     */
    default List<DictDataDO> selectListByStatusAndDictType(Integer status, String dictType) {
        return selectList(new LambdaQueryWrapperX<DictDataDO>()
                .eqIfPresent(DictDataDO::getStatus, status)
                .eqIfPresent(DictDataDO::getDictType, dictType));
    }

}
