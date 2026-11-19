package com.basicframework.module.infra.controller.admin.config;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.CommonResult;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.infra.controller.admin.config.vo.ConfigPageReqVO;
import com.basicframework.module.infra.controller.admin.config.vo.ConfigRespVO;
import com.basicframework.module.infra.controller.admin.config.vo.ConfigSaveReqVO;
import com.basicframework.module.infra.dal.dataobject.config.ConfigDO;
import com.basicframework.module.infra.dal.mysql.config.ConfigMapper;
import com.basicframework.module.infra.enums.config.ConfigTypeEnum;
import com.basicframework.module.infra.service.config.ConfigService;
import com.basicframework.module.infra.service.config.ConfigServiceImpl;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static com.basicframework.module.infra.enums.ErrorCodeConstants.CONFIG_CAN_NOT_UPDATE_SYSTEM_KEY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证参数配置的不可见值脱敏、系统内置键名保护与脱敏占位保值语义。
 *
 * @author shady2713
 */
class ConfigControllerTest {

    /** 验证 /get 与 /page 对 visible=false 的配置统一返回脱敏占位符，不暴露明文敏感值。 */
    @Test
    void masksInvisibleConfigValueInGetAndPage() {
        ConfigService configService = mock(ConfigService.class);
        ConfigController controller = new ConfigController();
        ReflectionTestUtils.setField(controller, "configService", configService);

        ConfigDO hidden = new ConfigDO();
        hidden.setId(1L);
        hidden.setConfigKey("system.user.init-password");
        hidden.setValue("CHANGE_ME_INIT_VALUE");
        hidden.setVisible(false);

        ConfigDO visible = new ConfigDO();
        visible.setId(2L);
        visible.setConfigKey("ui.title");
        visible.setValue("管理后台");
        visible.setVisible(true);

        when(configService.getConfig(1L)).thenReturn(hidden);
        when(configService.getConfigPage(org.mockito.ArgumentMatchers.any(ConfigPageReqVO.class)))
                .thenReturn(new PageResult<>(List.of(hidden, visible), 2L));

        CommonResult<ConfigRespVO> single = controller.getConfig(1L);
        assertThat(single.getData().getValue()).isEqualTo(ConfigService.HIDDEN_CONFIG_VALUE_MASK);

        CommonResult<PageResult<ConfigRespVO>> page = controller.getConfigPage(new ConfigPageReqVO());
        assertThat(page.getData().getList()).hasSize(2);
        assertThat(page.getData().getList().get(0).getValue()).isEqualTo(ConfigService.HIDDEN_CONFIG_VALUE_MASK);
        assertThat(page.getData().getList().get(1).getValue()).isEqualTo("管理后台");
    }

    /** 验证更新系统内置配置时禁止改名 configKey，且提交脱敏占位符时保留原值。 */
    @Test
    void updateConfigProtectsSystemKeyAndPreservesMaskedSecret() {
        ConfigMapper configMapper = mock(ConfigMapper.class);
        ConfigServiceImpl service = new ConfigServiceImpl();
        ReflectionTestUtils.setField(service, "configMapper", configMapper);

        ConfigDO existing = new ConfigDO();
        existing.setId(1L);
        existing.setType(ConfigTypeEnum.SYSTEM.getType());
        existing.setConfigKey("system.user.init-password");
        existing.setValue("CHANGE_ME_REAL_VALUE");
        existing.setVisible(false);
        when(configMapper.selectById(1L)).thenReturn(existing);

        ConfigSaveReqVO renameReq = new ConfigSaveReqVO();
        renameReq.setId(1L);
        renameReq.setKey("system.user.other-key");
        renameReq.setValue(ConfigService.HIDDEN_CONFIG_VALUE_MASK);

        assertThatThrownBy(() -> service.updateConfig(renameReq))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(CONFIG_CAN_NOT_UPDATE_SYSTEM_KEY.getCode()));

        ConfigSaveReqVO flipVisibleReq = new ConfigSaveReqVO();
        flipVisibleReq.setId(1L);
        flipVisibleReq.setCategory("system");
        flipVisibleReq.setName("初始密码");
        flipVisibleReq.setKey("system.user.init-password");
        flipVisibleReq.setValue(ConfigService.HIDDEN_CONFIG_VALUE_MASK);
        flipVisibleReq.setVisible(true);
        when(configMapper.selectByKey("system.user.init-password")).thenReturn(existing);

        assertThatThrownBy(() -> service.updateConfig(flipVisibleReq))
                .isInstanceOfSatisfying(ServiceException.class,
                        ex -> assertThat(ex.getCode()).isEqualTo(400));

        ConfigSaveReqVO keepSecretReq = new ConfigSaveReqVO();
        keepSecretReq.setId(1L);
        keepSecretReq.setCategory("system");
        keepSecretReq.setName("初始密码");
        keepSecretReq.setKey("system.user.init-password");
        keepSecretReq.setValue(ConfigService.HIDDEN_CONFIG_VALUE_MASK);
        keepSecretReq.setVisible(false);

        service.updateConfig(keepSecretReq);

        ArgumentCaptor<ConfigDO> captor = ArgumentCaptor.forClass(ConfigDO.class);
        verify(configMapper).updateById(captor.capture());
        assertThat(captor.getValue().getValue()).isEqualTo("CHANGE_ME_REAL_VALUE");
    }

}
