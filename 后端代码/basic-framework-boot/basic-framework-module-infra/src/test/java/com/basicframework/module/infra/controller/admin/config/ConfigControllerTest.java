package com.basicframework.module.infra.controller.admin.config;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.dict.core.DictFrameworkUtils;
import com.basicframework.module.infra.controller.admin.config.vo.ConfigPageReqVO;
import com.basicframework.module.infra.controller.admin.config.vo.ConfigSaveReqVO;
import com.basicframework.module.infra.dal.dataobject.config.ConfigDO;
import com.basicframework.module.infra.enums.config.ConfigTypeEnum;
import com.basicframework.module.infra.service.config.ConfigService;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static com.basicframework.module.infra.enums.ErrorCodeConstants.CONFIG_GET_VALUE_ERROR_IF_VISIBLE;
import static com.basicframework.module.infra.enums.ErrorCodeConstants.EXPORT_SIZE_EXCEEDED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证参数配置管理接口的可见性边界、对象转换和导出上限。
 *
 * <p>按键取值的接口只能走 Service 的“可见配置值”读取路径；如果 Controller 改成直接读配置对象，
 * 不可见的敏感配置就会随响应一起返回前端，而这一层没有任何其他拦截。</p>
 *
 * @author shady2713
 */
class ConfigControllerTest {

    /** 单次导出上限，与生产接口保持一致。 */
    private static final int MAX_EXPORT_SIZE = 10_000;

    private ConfigService configService;
    private ConfigController controller;

    /**
     * 字典转换器在导出时需要字典公共 API；本测试用空字典替代，只关注导出编排。
     *
     * <p>不初始化时转换器会因缺少字典实现而失败，导致无法观察导出本身的行为。</p>
     */
    @BeforeAll
    static void initEmptyDictionary() {
        DictFrameworkUtils.init(dictType -> List.of());
    }

    /** 每例重建替身，避免调用记录跨用例累积。 */
    @BeforeEach
    void setUp() {
        configService = mock(ConfigService.class);
        controller = new ConfigController();
        ReflectionTestUtils.setField(controller, "configService", configService);
    }

    /** 写操作必须原样透传请求并返回成功。 */
    @Test
    void mutationsDelegateVerbatimAndReportSuccess() {
        when(configService.createConfig(any())).thenReturn(7L);
        ConfigSaveReqVO create = request("配置");
        ConfigSaveReqVO update = request("改名配置");
        update.setId(7L);

        assertThat(controller.createConfig(create).getData()).isEqualTo(7L);
        assertThat(controller.updateConfig(update).getData()).isTrue();
        assertThat(controller.deleteConfig(7L).getData()).isTrue();
        assertThat(controller.deleteConfigList(List.of(7L, 8L)).getData()).isTrue();

        verify(configService).createConfig(create);
        verify(configService).updateConfig(update);
        verify(configService).deleteConfig(7L);
        verify(configService).deleteConfigList(List.of(7L, 8L));
    }

    /** 详情必须转换为响应对象，配置键名从 configKey 映射为对外的 key 字段。 */
    @Test
    void detailConvertsConfigToResponseObject() {
        when(configService.getConfig(7L)).thenReturn(config(7L, "login", "值"));

        var detail = controller.getConfig(7L).getData();

        assertThat(detail.getId()).isEqualTo(7L);
        assertThat(detail.getKey()).isEqualTo("login");
        assertThat(detail.getValue()).isEqualTo("值");
        assertThat(detail.getType()).isEqualTo(ConfigTypeEnum.SYSTEM.getType());
    }

    /** 分页必须逐条转换为响应对象，并保留总数。 */
    @Test
    void pageConvertsEveryConfigAndKeepsTotal() {
        when(configService.getConfigPage(any()))
                .thenReturn(new PageResult<>(List.of(config(7L, "a", "1"), config(8L, "b", "2")), 2L));

        var page = controller.getConfigPage(new ConfigPageReqVO()).getData();

        assertThat(page.getTotal()).isEqualTo(2);
        assertThat(page.getList()).extracting(response -> response.getKey()).containsExactly("a", "b");
    }

    /**
     * 按键取值必须走“可见配置值”接口。
     *
     * <p>可见性判断只在 Service 内实现；这里验证 Controller 不会绕过它去读完整配置对象。</p>
     */
    @Test
    void valueByKeyUsesVisibleValueLookupOnly() {
        when(configService.getVisibleConfigValueByKey("login")).thenReturn("值");

        assertThat(controller.getConfigKey("login").getData()).isEqualTo("值");

        verify(configService).getVisibleConfigValueByKey("login");
        verify(configService, never()).getConfigByKey("login");
        verify(configService, never()).getConfig(7L);
    }

    /** 不可见配置的业务错误必须原样冒泡，不能被 Controller 吞掉后当成空值返回。 */
    @Test
    void invisibleConfigErrorIsNotSwallowed() {
        when(configService.getVisibleConfigValueByKey("hidden"))
                .thenThrow(com.basicframework.framework.common.exception.util.ServiceExceptionUtil
                        .exception(CONFIG_GET_VALUE_ERROR_IF_VISIBLE));

        assertThatThrownBy(() -> controller.getConfigKey("hidden"))
                .isInstanceOfSatisfying(ServiceException.class,
                        failure -> assertThat(failure.getCode())
                                .isEqualTo(CONFIG_GET_VALUE_ERROR_IF_VISIBLE.getCode()));
    }

    /** 配置不存在时返回空值而不是空集合，调用方据此区分“没有配置”和“配置为空串”。 */
    @Test
    void valueByKeyReturnsNullForMissingConfig() {
        when(configService.getVisibleConfigValueByKey("absent")).thenReturn(null);

        assertThat(controller.getConfigKey("absent").getData()).isNull();
    }

    /** 导出必须覆盖分页参数为全量查询，并对超限结果直接失败。 */
    @Test
    void exportForcesFullPageQueryAndRejectsOversizedResult() {
        ConfigPageReqVO request = new ConfigPageReqVO();
        request.setPageNo(3);
        request.setPageSize(20);
        when(configService.getConfigPage(any()))
                .thenReturn(new PageResult<>(List.of(), (long) MAX_EXPORT_SIZE + 1));

        assertThatThrownBy(() -> controller.exportConfig(request, new MockHttpServletResponse()))
                .isInstanceOfSatisfying(ServiceException.class,
                        failure -> assertThat(failure.getCode()).isEqualTo(EXPORT_SIZE_EXCEEDED.getCode()));

        ArgumentCaptor<ConfigPageReqVO> captor = ArgumentCaptor.forClass(ConfigPageReqVO.class);
        verify(configService).getConfigPage(captor.capture());
        assertThat(captor.getValue().getPageNo()).isEqualTo(1);
        assertThat(captor.getValue().getPageSize()).isEqualTo(MAX_EXPORT_SIZE);
    }

    /** 未超限时必须真正写出 Excel 并设置下载响应头。 */
    @Test
    void exportWritesExcelWhenResultFitsLimit() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        when(configService.getConfigPage(any()))
                .thenReturn(new PageResult<>(List.of(config(7L, "login", "值")), 1L));

        controller.exportConfig(new ConfigPageReqVO(), response);

        assertThat(response.getContentType()).isEqualTo("application/vnd.ms-excel;charset=UTF-8");
        assertThat(response.getHeader("Content-Disposition")).contains("attachment");
        assertThat(response.getContentAsByteArray()).isNotEmpty();
    }

    /** 构造带完整字段的配置对象，覆盖响应转换的每个字段。 */
    private ConfigDO config(Long id, String key, String value) {
        ConfigDO config = new ConfigDO();
        config.setId(id);
        config.setCategory("分组");
        config.setName("名称-" + key);
        config.setConfigKey(key);
        config.setValue(value);
        config.setType(ConfigTypeEnum.SYSTEM.getType());
        config.setVisible(true);
        return config;
    }

    /** 构造合法保存请求。 */
    private ConfigSaveReqVO request(String name) {
        ConfigSaveReqVO request = new ConfigSaveReqVO();
        request.setCategory("分组");
        request.setName(name);
        request.setKey("key-" + name);
        request.setValue("值");
        request.setVisible(true);
        return request;
    }
}
