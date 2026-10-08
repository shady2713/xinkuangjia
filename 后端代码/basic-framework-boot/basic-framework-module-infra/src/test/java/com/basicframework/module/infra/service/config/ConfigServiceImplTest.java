package com.basicframework.module.infra.service.config;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.infra.controller.admin.config.vo.ConfigPageReqVO;
import com.basicframework.module.infra.controller.admin.config.vo.ConfigSaveReqVO;
import com.basicframework.module.infra.dal.dataobject.config.ConfigDO;
import com.basicframework.module.infra.dal.mysql.config.ConfigMapper;
import com.basicframework.module.infra.enums.config.ConfigTypeEnum;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Arrays;
import java.util.List;

import static com.basicframework.module.infra.enums.ErrorCodeConstants.CONFIG_CAN_NOT_DELETE_SYSTEM_TYPE;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.CONFIG_GET_VALUE_ERROR_IF_VISIBLE;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.CONFIG_KEY_DUPLICATE;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.CONFIG_NOT_EXISTS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证参数配置服务的配置键唯一性、内置配置删除保护与可见性读取边界。
 *
 * <p>参数配置被后台所有按 key 取值的业务共用，三条规则一旦失效就会出现跨模块的数据问题：
 * 新建时未拦住重复 key 会让 {@code selectByKey} 命中不确定的一条记录；内置配置被删除会让依赖系统
 * 默认值的模块直接读不到配置；对不可见配置放行会把本应只对服务端可见的敏感参数原样返回给管理端。
 * 因此这里逐条验证拒绝时机（校验必须发生在写库之前）与错误码，而不是只验证调用次数。</p>
 *
 * <p>持久层替换为 Mapper 替身，服务内的唯一性判定、内置类型判定、可见性判定与异常类型全部真实执行；
 * 断言同时核对错误码、写库对象的类型与键值映射，以及替身实际收到的参数。</p>
 *
 * @author shady2713
 */
class ConfigServiceImplTest {

    /** 替换数据库自增的编号，用于核对写入后返回的主键。 */
    private static final Long GENERATED_ID = 1024L;

    /** 被测服务。 */
    private ConfigServiceImpl configService;
    /** 参数配置持久层替身。 */
    private ConfigMapper configMapper;

    /**
     * 装配服务与 Mapper 替身。
     */
    @BeforeEach
    void setUp() {
        configService = new ConfigServiceImpl();
        configMapper = mock(ConfigMapper.class);
        ReflectionTestUtils.setField(configService, "configMapper", configMapper);
    }

    /**
     * 构造一条参数配置记录。
     *
     * @param id 配置编号
     * @param configKey 配置键
     * @param type 配置类型
     * @return 参数配置记录
     */
    private static ConfigDO configDO(Long id, String configKey, Integer type) {
        ConfigDO config = new ConfigDO();
        config.setId(id);
        config.setConfigKey(configKey);
        config.setType(type);
        return config;
    }

    /**
     * 构造一条参数配置保存请求。
     *
     * @param key 配置键
     * @return 保存请求
     */
    private static ConfigSaveReqVO saveReqVO(String key) {
        ConfigSaveReqVO reqVO = new ConfigSaveReqVO();
        reqVO.setCategory("biz");
        reqVO.setName("业务参数");
        reqVO.setKey(key);
        reqVO.setValue("value");
        reqVO.setVisible(true);
        return reqVO;
    }

    /** 配置键未被占用时按自定义类型落库，并把请求里的 key 映射为持久化字段。 */
    @Test
    void createConfigStoresCustomTypeAndGeneratedId() {
        when(configMapper.selectByKey("biz.limit")).thenReturn(null);
        doAnswer(invocation -> {
            ConfigDO inserted = invocation.getArgument(0);
            inserted.setId(GENERATED_ID);
            return 1;
        }).when(configMapper).insert(any(ConfigDO.class));

        Long id = configService.createConfig(saveReqVO("biz.limit"));

        ArgumentCaptor<ConfigDO> captor = ArgumentCaptor.forClass(ConfigDO.class);
        verify(configMapper).insert(captor.capture());
        assertThat(id).isEqualTo(GENERATED_ID);
        assertThat(captor.getValue().getType()).isEqualTo(ConfigTypeEnum.CUSTOM.getType());
        assertThat(captor.getValue().getConfigKey()).isEqualTo("biz.limit");
    }

    /** 配置键已被占用时必须先拒绝，不得让重复键落库。 */
    @Test
    void createConfigRejectsDuplicatedKeyBeforeInsert() {
        when(configMapper.selectByKey("biz.limit"))
                .thenReturn(configDO(7L, "biz.limit", ConfigTypeEnum.SYSTEM.getType()));

        assertThatThrownBy(() -> configService.createConfig(saveReqVO("biz.limit")))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(CONFIG_KEY_DUPLICATE.getCode());
        verify(configMapper, never()).insert(any(ConfigDO.class));
    }

    /** 目标配置不存在时更新整体拒绝，不再继续做配置键判重。 */
    @Test
    void updateConfigRejectsMissingConfig() {
        when(configMapper.selectById(9L)).thenReturn(null);

        ConfigSaveReqVO reqVO = saveReqVO("biz.limit");
        reqVO.setId(9L);
        assertThatThrownBy(() -> configService.updateConfig(reqVO))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(CONFIG_NOT_EXISTS.getCode());
        verify(configMapper, never()).selectByKey(any());
        verify(configMapper, never()).updateById(any(ConfigDO.class));
    }

    /** 保留自己的配置键再保存不算重复，允许继续更新。 */
    @Test
    void updateConfigAllowsOwnKeyAndMapsKeyField() {
        when(configMapper.selectById(9L)).thenReturn(configDO(9L, "biz.limit", ConfigTypeEnum.CUSTOM.getType()));
        when(configMapper.selectByKey("biz.limit")).thenReturn(configDO(9L, "biz.limit", ConfigTypeEnum.CUSTOM.getType()));

        ConfigSaveReqVO reqVO = saveReqVO("biz.limit");
        reqVO.setId(9L);
        reqVO.setValue("new-value");
        configService.updateConfig(reqVO);

        ArgumentCaptor<ConfigDO> captor = ArgumentCaptor.forClass(ConfigDO.class);
        verify(configMapper).updateById(captor.capture());
        assertThat(captor.getValue().getConfigKey()).isEqualTo("biz.limit");
        assertThat(captor.getValue().getValue()).isEqualTo("new-value");
    }

    /** 配置键已被别的配置占用时更新被拒绝，不允许改键覆盖他人配置。 */
    @Test
    void updateConfigRejectsKeyOwnedByOtherConfig() {
        when(configMapper.selectById(9L)).thenReturn(configDO(9L, "old.key", ConfigTypeEnum.CUSTOM.getType()));
        when(configMapper.selectByKey("biz.limit")).thenReturn(configDO(8L, "biz.limit", ConfigTypeEnum.CUSTOM.getType()));

        ConfigSaveReqVO reqVO = saveReqVO("biz.limit");
        reqVO.setId(9L);
        assertThatThrownBy(() -> configService.updateConfig(reqVO))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(CONFIG_KEY_DUPLICATE.getCode());
        verify(configMapper, never()).updateById(any(ConfigDO.class));
    }

    /** 系统内置配置不允许删除，且删除动作必须被完整拦下。 */
    @Test
    void deleteConfigRejectsSystemType() {
        when(configMapper.selectById(3L)).thenReturn(configDO(3L, "sys.flag", ConfigTypeEnum.SYSTEM.getType()));

        assertThatThrownBy(() -> configService.deleteConfig(3L))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode())
                .isEqualTo(CONFIG_CAN_NOT_DELETE_SYSTEM_TYPE.getCode());
        verify(configMapper, never()).deleteById(anyLong());
    }

    /** 自定义配置可以删除，删除使用请求给出的编号。 */
    @Test
    void deleteConfigRemovesCustomType() {
        when(configMapper.selectById(3L)).thenReturn(configDO(3L, "biz.flag", ConfigTypeEnum.CUSTOM.getType()));

        configService.deleteConfig(3L);

        verify(configMapper).deleteById(3L);
        verify(configMapper).selectById(3L);
    }

    /** 批量删除中只要含内置配置就整体拒绝，列表内的其他配置也不得被删。 */
    @Test
    void deleteConfigListRejectsWholeBatchWhenSystemTypePresent() {
        List<Long> ids = Arrays.asList(1L, 2L);
        when(configMapper.selectByIds(ids)).thenReturn(Arrays.asList(
                configDO(1L, "biz.a", ConfigTypeEnum.CUSTOM.getType()),
                configDO(2L, "sys.b", ConfigTypeEnum.SYSTEM.getType())));

        assertThatThrownBy(() -> configService.deleteConfigList(ids))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode())
                .isEqualTo(CONFIG_CAN_NOT_DELETE_SYSTEM_TYPE.getCode());
        verify(configMapper, never()).deleteByIds(anyList());
    }

    /** 批量删除全部为自定义配置时按原编号列表删除。 */
    @Test
    void deleteConfigListRemovesAllCustomTypes() {
        List<Long> ids = Arrays.asList(1L, 2L);
        when(configMapper.selectByIds(ids)).thenReturn(Arrays.asList(
                configDO(1L, "biz.a", ConfigTypeEnum.CUSTOM.getType()),
                configDO(2L, "biz.b", ConfigTypeEnum.CUSTOM.getType())));

        configService.deleteConfigList(ids);

        verify(configMapper).deleteByIds(ids);
        verify(configMapper).selectByIds(ids);
    }

    /** 编号为空表示新增场景，不得发起按编号查询。 */
    @Test
    void validateConfigExistsSkipsQueryWithoutId() {
        assertThat(configService.validateConfigExists(null)).isNull();

        verify(configMapper, never()).selectById(any());
    }

    /** 编号存在时返回配置本身，供调用方继续判断业务类型。 */
    @Test
    void validateConfigExistsReturnsConfig() {
        ConfigDO config = configDO(5L, "biz.a", ConfigTypeEnum.CUSTOM.getType());
        when(configMapper.selectById(5L)).thenReturn(config);

        assertThat(configService.validateConfigExists(5L)).isSameAs(config);
        verify(configMapper).selectById(5L);
    }

    /** 编号查无配置时抛出不存在错误码。 */
    @Test
    void validateConfigExistsThrowsWhenMissing() {
        when(configMapper.selectById(404L)).thenReturn(null);

        assertThatThrownBy(() -> configService.validateConfigExists(404L))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(CONFIG_NOT_EXISTS.getCode());
    }

    /** 配置键未被占用时判重通过，且判重必须按请求给出的键查询。 */
    @Test
    void validateConfigKeyUniquePassesForUnusedKey() {
        when(configMapper.selectByKey("free.key")).thenReturn(null);

        assertThatCode(() -> configService.validateConfigKeyUnique(null, "free.key")).doesNotThrowAnyException();
        verify(configMapper).selectByKey("free.key");
    }

    /** 已有配置占用该键时，换编号和新增两种调用方式都必须被拒绝。 */
    @Test
    void validateConfigKeyUniqueThrowsWhenKeyOccupied() {
        when(configMapper.selectByKey("busy.key")).thenReturn(configDO(1L, "busy.key", ConfigTypeEnum.CUSTOM.getType()));

        assertThatThrownBy(() -> configService.validateConfigKeyUnique(2L, "busy.key"))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(CONFIG_KEY_DUPLICATE.getCode());
        assertThatThrownBy(() -> configService.validateConfigKeyUnique(null, "busy.key"))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(CONFIG_KEY_DUPLICATE.getCode());
    }

    /** 按编号读取详情时透传持久层结果，不存在时返回空。 */
    @Test
    void getConfigDelegatesToMapper() {
        ConfigDO config = configDO(6L, "biz.a", ConfigTypeEnum.CUSTOM.getType());
        when(configMapper.selectById(6L)).thenReturn(config);
        when(configMapper.selectById(7L)).thenReturn(null);

        assertThat(configService.getConfig(6L)).isSameAs(config);
        assertThat(configService.getConfig(7L)).isNull();
    }

    /** 按配置键读取详情时按请求键查询，透传持久层结果。 */
    @Test
    void getConfigByKeyDelegatesToMapper() {
        ConfigDO config = configDO(6L, "biz.a", ConfigTypeEnum.CUSTOM.getType());
        when(configMapper.selectByKey("biz.a")).thenReturn(config);

        assertThat(configService.getConfigByKey("biz.a")).isSameAs(config);
        verify(configMapper).selectByKey("biz.a");
    }

    /** 配置不存在时返回空值而不是抛出可见性异常，调用方据此区分“没有配置”和“不可见”。 */
    @Test
    void getVisibleConfigValueByKeyReturnsNullWhenConfigMissing() {
        when(configMapper.selectByKey("missing")).thenReturn(null);

        assertThat(configService.getVisibleConfigValueByKey("missing")).isNull();
        verify(configMapper).selectByKey("missing");
    }

    /** 不可见配置必须被拒绝，避免敏感参数原样返回给管理端。 */
    @Test
    void getVisibleConfigValueByKeyRejectsInvisibleConfig() {
        ConfigDO config = configDO(6L, "secret", ConfigTypeEnum.CUSTOM.getType());
        config.setVisible(false);
        config.setValue("secret-value");
        when(configMapper.selectByKey("secret")).thenReturn(config);

        assertThatThrownBy(() -> configService.getVisibleConfigValueByKey("secret"))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode())
                .isEqualTo(CONFIG_GET_VALUE_ERROR_IF_VISIBLE.getCode());
    }

    /** 可见配置正常返回配置值，可见标记缺失时同样按不可见处理。 */
    @Test
    void getVisibleConfigValueByKeyReturnsValueForVisibleConfig() {
        ConfigDO config = configDO(6L, "biz.a", ConfigTypeEnum.CUSTOM.getType());
        config.setVisible(true);
        config.setValue("100");
        when(configMapper.selectByKey("biz.a")).thenReturn(config);
        assertThat(configService.getVisibleConfigValueByKey("biz.a")).isEqualTo("100");

        config.setVisible(null);
        assertThatThrownBy(() -> configService.getVisibleConfigValueByKey("biz.a"))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode())
                .isEqualTo(CONFIG_GET_VALUE_ERROR_IF_VISIBLE.getCode());
    }

    /** 分页查询把请求原样交给持久层并透传分页结果。 */
    @Test
    void getConfigPageDelegatesToMapper() {
        ConfigPageReqVO pageReqVO = new ConfigPageReqVO();
        PageResult<ConfigDO> pageResult = new PageResult<>(Arrays.asList(configDO(1L, "biz.a", ConfigTypeEnum.CUSTOM.getType())), 1L);
        when(configMapper.selectPage(pageReqVO)).thenReturn(pageResult);

        assertThat(configService.getConfigPage(pageReqVO)).isSameAs(pageResult);
        verify(configMapper).selectPage(pageReqVO);
    }

    /** 批量删除中查不到记录时按请求编号整体删除，不因少一条而缩小删除范围。 */
    @Test
    void deleteConfigListDeletesRequestedIdsEvenWhenLookupMisses() {
        List<Long> ids = Arrays.asList(1L, 2L, 3L);
        when(configMapper.selectByIds(ids))
                .thenReturn(List.of(configDO(2L, "biz.b", ConfigTypeEnum.CUSTOM.getType())));

        configService.deleteConfigList(ids);

        verify(configMapper).deleteByIds(ids);
        verify(configMapper).selectByIds(ids);
    }
}