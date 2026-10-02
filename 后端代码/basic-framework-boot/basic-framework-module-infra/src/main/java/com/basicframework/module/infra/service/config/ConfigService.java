package com.basicframework.module.infra.service.config;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.infra.controller.admin.config.vo.ConfigPageReqVO;
import com.basicframework.module.infra.controller.admin.config.vo.ConfigSaveReqVO;
import com.basicframework.module.infra.dal.dataobject.config.ConfigDO;
import jakarta.validation.Valid;

import java.util.List;

/**
 * 参数配置 Service 接口
 *
 * 定义参数配置的维护、查询和配置键检索能力。
 *
 * @author 李杰
 */
public interface ConfigService {

    /**
     * 创建参数配置
     *
     * @param createReqVO 创建信息
     * @return 配置编号
     */
    Long createConfig(@Valid ConfigSaveReqVO createReqVO);

    /**
     * 更新参数配置
     *
     * @param updateReqVO 更新信息
     */
    void updateConfig(@Valid ConfigSaveReqVO updateReqVO);

    /**
     * 删除参数配置
     *
     * @param id 配置编号
     */
    void deleteConfig(Long id);

    /**
     * 批量删除参数配置
     *
     * @param ids 配置编号列表
     */
    void deleteConfigList(List<Long> ids);

    /**
     * 获得参数配置
     *
     * @param id 配置编号
     * @return 参数配置
     */
    ConfigDO getConfig(Long id);

    /**
     * 根据参数键，获得参数配置
     *
     * @param key 配置键
     * @return 参数配置
     */
    ConfigDO getConfigByKey(String key);

    /**
     * 根据参数键获取允许向管理端返回的配置值。
     *
     * @param key 配置键
     * @return 可见配置值；配置不存在时返回 null
     * @throws com.basicframework.framework.common.exception.ServiceException 配置不允许对外展示时抛出
     */
    String getVisibleConfigValueByKey(String key);

    /**
     * 获得参数配置分页列表
     *
     * @param reqVO 分页条件
     * @return 分页列表
     */
    PageResult<ConfigDO> getConfigPage(ConfigPageReqVO reqVO);

}
