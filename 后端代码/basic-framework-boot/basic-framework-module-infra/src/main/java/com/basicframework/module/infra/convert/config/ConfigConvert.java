package com.basicframework.module.infra.convert.config;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.infra.controller.admin.config.vo.ConfigRespVO;
import com.basicframework.module.infra.controller.admin.config.vo.ConfigSaveReqVO;
import com.basicframework.module.infra.dal.dataobject.config.ConfigDO;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.factory.Mappers;

import java.util.List;

/**
 * 参数配置对象转换器。
 *
 * @author 李杰
 * 署名验收：尚未验收
 */
@Mapper
public interface ConfigConvert {

    /** MapStruct 生成的转换器实例。 */
    ConfigConvert INSTANCE = Mappers.getMapper(ConfigConvert.class);

    /**
     * 将参数配置分页数据转换为响应分页数据。
     *
     * @param page 参数配置分页数据
     * @return 响应分页数据
     */
    PageResult<ConfigRespVO> convertPage(PageResult<ConfigDO> page);

    /**
     * 将参数配置列表转换为响应列表。
     *
     * @param list 参数配置列表
     * @return 响应列表
     */
    List<ConfigRespVO> convertList(List<ConfigDO> list);

    /**
     * 将参数配置数据对象转换为响应对象。
     *
     * @param bean 参数配置数据对象
     * @return 参数配置响应对象
     */
    @Mapping(source = "configKey", target = "key")
    ConfigRespVO convert(ConfigDO bean);

    /**
     * 将保存请求转换为参数配置数据对象。
     *
     * @param bean 参数配置保存请求
     * @return 参数配置数据对象
     */
    @Mapping(source = "key", target = "configKey")
    ConfigDO convert(ConfigSaveReqVO bean);

}
