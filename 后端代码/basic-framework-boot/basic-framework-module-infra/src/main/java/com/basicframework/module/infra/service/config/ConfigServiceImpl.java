package com.basicframework.module.infra.service.config;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.infra.controller.admin.config.vo.ConfigPageReqVO;
import com.basicframework.module.infra.controller.admin.config.vo.ConfigSaveReqVO;
import com.basicframework.module.infra.convert.config.ConfigConvert;
import com.basicframework.module.infra.dal.dataobject.config.ConfigDO;
import com.basicframework.module.infra.dal.mysql.config.ConfigMapper;
import com.basicframework.module.infra.enums.config.ConfigTypeEnum;
import com.google.common.annotations.VisibleForTesting;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.validation.annotation.Validated;

import java.util.List;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.*;

/**
 * 参数配置 Service 实现类
 *
 * 负责参数配置的增删改查、系统内置配置保护和配置键唯一性校验。
 *
 * @author 李杰
 */
@Service
@Slf4j
@Validated
public class ConfigServiceImpl implements ConfigService {

    @Resource
    private ConfigMapper configMapper;

    /**
     * 创建参数配置。
     *
     * @param createReqVO 创建请求
     * @return 参数配置编号
     */
    @Override
    public Long createConfig(ConfigSaveReqVO createReqVO) {
        // 校验参数配置 key 的唯一性
        validateConfigKeyUnique(null, createReqVO.getKey());

        // 插入参数配置
        ConfigDO config = ConfigConvert.INSTANCE.convert(createReqVO);
        config.setType(ConfigTypeEnum.CUSTOM.getType());
        configMapper.insert(config);
        return config.getId();
    }

    /**
     * 更新参数配置。
     *
     * @param updateReqVO 更新请求
     */
    @Override
    public void updateConfig(ConfigSaveReqVO updateReqVO) {
        // 校验自己存在
        validateConfigExists(updateReqVO.getId());
        // 校验参数配置 key 的唯一性
        validateConfigKeyUnique(updateReqVO.getId(), updateReqVO.getKey());

        // 更新参数配置
        ConfigDO updateObj = ConfigConvert.INSTANCE.convert(updateReqVO);
        configMapper.updateById(updateObj);
    }

    /**
     * 删除参数配置。
     *
     * <p>系统内置配置不允许删除。</p>
     *
     * @param id 参数配置编号
     */
    @Override
    public void deleteConfig(Long id) {
        // 校验配置存在
        ConfigDO config = validateConfigExists(id);
        // 内置配置，不允许删除
        if (ConfigTypeEnum.SYSTEM.getType().equals(config.getType())) {
            throw exception(CONFIG_CAN_NOT_DELETE_SYSTEM_TYPE);
        }
        // 删除
        configMapper.deleteById(id);
    }

    /**
     * 批量删除参数配置。
     *
     * <p>待删除列表中存在系统内置配置时，整体拒绝删除。</p>
     *
     * @param ids 参数配置编号列表
     */
    @Override
    public void deleteConfigList(List<Long> ids) {
        // 校验是否有内置配置
        List<ConfigDO> configs = configMapper.selectByIds(ids);
        configs.forEach(config -> {
            if (ConfigTypeEnum.SYSTEM.getType().equals(config.getType())) {
                throw exception(CONFIG_CAN_NOT_DELETE_SYSTEM_TYPE);
            }
        });

        // 批量删除
        configMapper.deleteByIds(ids);
    }

    /**
     * 获取参数配置详情。
     *
     * @param id 参数配置编号
     * @return 参数配置；不存在时返回 null
     */
    @Override
    public ConfigDO getConfig(Long id) {
        return configMapper.selectById(id);
    }

    /**
     * 根据配置键获取参数配置。
     *
     * @param key 配置键
     * @return 参数配置；不存在时返回 null
     */
    @Override
    public ConfigDO getConfigByKey(String key) {
        return configMapper.selectByKey(key);
    }

    /**
     * 根据配置键获取允许向管理端返回的配置值。
     *
     * <p>可见性是配置读取的业务安全边界，由 Service 统一执行，避免其他 HTTP 入口绕过。</p>
     *
     * @param key 配置键
     * @return 可见配置值；配置不存在时返回 null
     */
    @Override
    public String getVisibleConfigValueByKey(String key) {
        ConfigDO config = getConfigByKey(key);
        if (config == null) {
            return null;
        }
        if (!Boolean.TRUE.equals(config.getVisible())) {
            throw exception(CONFIG_GET_VALUE_ERROR_IF_VISIBLE);
        }
        return config.getValue();
    }

    /**
     * 分页查询参数配置。
     *
     * @param pageReqVO 分页查询条件
     * @return 参数配置分页结果
     */
    @Override
    public PageResult<ConfigDO> getConfigPage(ConfigPageReqVO pageReqVO) {
        return configMapper.selectPage(pageReqVO);
    }

    /**
     * 校验参数配置存在。
     *
     * @param id 参数配置编号
     * @return 参数配置；id 为空时返回 null
     */
    @VisibleForTesting
    public ConfigDO validateConfigExists(Long id) {
        if (id == null) {
            return null;
        }
        ConfigDO config = configMapper.selectById(id);
        if (config == null) {
            throw exception(CONFIG_NOT_EXISTS);
        }
        return config;
    }

    /**
     * 校验参数键在系统内唯一。
     *
     * @param id 当前参数配置编号，创建时为空
     * @param key 参数键
     */
    @VisibleForTesting
    public void validateConfigKeyUnique(Long id, String key) {
        ConfigDO config = configMapper.selectByKey(key);
        if (config == null) {
            return;
        }
        // 如果 id 为空，说明不用比较是否为相同 id 的参数配置
        if (id == null) {
            throw exception(CONFIG_KEY_DUPLICATE);
        }
        if (!config.getId().equals(id)) {
            throw exception(CONFIG_KEY_DUPLICATE);
        }
    }

}
