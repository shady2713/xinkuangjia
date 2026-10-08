package com.basicframework.module.system.service.sms;

import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.controller.admin.sms.vo.channel.SmsChannelPageReqVO;
import com.basicframework.module.system.controller.admin.sms.vo.channel.SmsChannelSaveReqVO;
import com.basicframework.module.system.dal.dataobject.sms.SmsChannelDO;
import com.basicframework.module.system.dal.mysql.sms.SmsChannelMapper;
import com.basicframework.module.system.framework.sms.core.client.SmsClient;
import com.basicframework.module.system.framework.sms.core.client.SmsClientFactory;
import com.basicframework.module.system.framework.sms.core.enums.SmsChannelEnum;
import com.basicframework.module.system.framework.sms.core.property.SmsChannelProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.ArgumentMatchers;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CHANNEL_CODE_DUPLICATE;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CHANNEL_HAS_CHILDREN;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CHANNEL_NOT_EXISTS;
import static org.assertj.core.api.Assertions.assertThat;
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
 * 验证短信渠道服务的渠道编码唯一性、删除前的子模板保护与客户端装配参数。
 *
 * <p>短信渠道是一组模板共用的出口，渠道记录与供应商凭据是一体的。三条规则失效后果不同：编码判重
 * 失效会让两个渠道指向同一供应商账号，发送时用错凭据；删除时若不先确认没有模板在用，模板会变成指向
 * 已删除渠道的悬空数据；按编号装配客户端时若凭据映射不全，供应商会返回鉴权失败，而这类错误在日志里
 * 与"余额不足"难以区分。</p>
 *
 * <p>持久层与客户端工厂替换为进程外替身，服务内的唯一性判定、子资源保护、凭据映射与异常类型全部
 * 真实执行；断言核对真实业务错误码、写入对象的字段映射，以及工厂替身实际收到的渠道属性。</p>
 *
 * @author shady2713
 */
class SmsChannelServiceImplTest {

    /** 替换数据库自增的渠道编号。 */
    private static final Long GENERATED_ID = 8192L;

    /** 被测服务。 */
    private SmsChannelServiceImpl smsChannelService;
    /** 短信渠道持久层替身。 */
    private SmsChannelMapper smsChannelMapper;
    /** 短信客户端工厂替身。 */
    private SmsClientFactory smsClientFactory;
    /** 短信模板服务替身，服务经延迟提供者获取。 */
    private SmsTemplateService smsTemplateService;

    /**
     * 装配服务与全部替身，并把延迟提供者固定到同一替身实例。
     */
    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        smsChannelService = new SmsChannelServiceImpl();
        smsChannelMapper = mock(SmsChannelMapper.class);
        smsClientFactory = mock(SmsClientFactory.class);
        smsTemplateService = mock(SmsTemplateService.class);
        ObjectProvider<SmsTemplateService> templateServiceProvider = mock(ObjectProvider.class);
        when(templateServiceProvider.getObject()).thenReturn(smsTemplateService);
        ReflectionTestUtils.setField(smsChannelService, "smsChannelMapper", smsChannelMapper);
        ReflectionTestUtils.setField(smsChannelService, "smsClientFactory", smsClientFactory);
        ReflectionTestUtils.setField(smsChannelService, "smsTemplateServiceProvider", templateServiceProvider);
    }

    /**
     * 构造一条短信渠道记录。
     *
     * @param id 渠道编号
     * @param code 渠道编码
     * @return 短信渠道记录
     */
    private static SmsChannelDO channelDO(Long id, String code) {
        SmsChannelDO channel = new SmsChannelDO();
        channel.setId(id);
        channel.setCode(code);
        channel.setStatus(0);
        channel.setSignature("框架");
        channel.setApiKey("key");
        channel.setApiSecret("secret");
        return channel;
    }

    /**
     * 构造一条渠道保存请求。
     *
     * @param code 渠道编码
     * @return 保存请求
     */
    private static SmsChannelSaveReqVO saveReqVO(String code) {
        SmsChannelSaveReqVO reqVO = new SmsChannelSaveReqVO();
        reqVO.setCode(code);
        reqVO.setStatus(0);
        reqVO.setSignature("框架");
        reqVO.setApiKey("key");
        reqVO.setApiSecret("secret");
        return reqVO;
    }

    /** 渠道编码未占用时按请求落库，并返回数据库生成的编号。 */
    @Test
    void createSmsChannelStoresRequestedFields() {
        when(smsChannelMapper.selectByCode("YIDIYUN")).thenReturn(null);
        doAnswer(invocation -> {
            SmsChannelDO inserted = invocation.getArgument(0);
            inserted.setId(GENERATED_ID);
            return 1;
        }).when(smsChannelMapper).insert(any(SmsChannelDO.class));

        Long id = smsChannelService.createSmsChannel(saveReqVO("YIDIYUN"));

        ArgumentCaptor<SmsChannelDO> captor = ArgumentCaptor.forClass(SmsChannelDO.class);
        verify(smsChannelMapper).insert(captor.capture());
        assertThat(id).isEqualTo(GENERATED_ID);
        assertThat(captor.getValue().getCode()).isEqualTo("YIDIYUN");
        assertThat(captor.getValue().getSignature()).isEqualTo("框架");
    }

    /** 渠道编码已被占用时按枚举友好名拒绝创建，不写入。 */
    @Test
    void createSmsChannelRejectsDuplicatedCodeWithEnumName() {
        when(smsChannelMapper.selectByCode("ALIYUN")).thenReturn(channelDO(1L, "ALIYUN"));

        assertThatThrownBy(() -> smsChannelService.createSmsChannel(saveReqVO("ALIYUN")))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(SMS_CHANNEL_CODE_DUPLICATE.getCode());
        assertThatThrownBy(() -> smsChannelService.createSmsChannel(saveReqVO("ALIYUN")))
                .hasMessageContaining(SmsChannelEnum.ALIYUN.getName());
        verify(smsChannelMapper, never()).insert(any(SmsChannelDO.class));
    }

    /** 渠道编码未登记在枚举中时按编码本身提示，仍然拒绝创建。 */
    @Test
    void createSmsChannelReportsRawCodeForUnknownChannel() {
        when(smsChannelMapper.selectByCode("CUSTOM_VENDOR")).thenReturn(channelDO(1L, "CUSTOM_VENDOR"));

        assertThatThrownBy(() -> smsChannelService.createSmsChannel(saveReqVO("CUSTOM_VENDOR")))
                .isInstanceOf(ServiceException.class)
                .hasMessageContaining("CUSTOM_VENDOR");
        assertThat(SmsChannelEnum.getByCode("CUSTOM_VENDOR")).isNull();
        verify(smsChannelMapper, never()).insert(any(SmsChannelDO.class));
    }

    /** 目标渠道不存在时更新整体拒绝，不再做编码判重。 */
    @Test
    void updateSmsChannelRejectsMissingChannel() {
        when(smsChannelMapper.selectById(9L)).thenReturn(null);
        SmsChannelSaveReqVO reqVO = saveReqVO("YIDIYUN");
        reqVO.setId(9L);

        assertThatThrownBy(() -> smsChannelService.updateSmsChannel(reqVO))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(SMS_CHANNEL_NOT_EXISTS.getCode());
        verify(smsChannelMapper, never()).selectByCode(any());
        verify(smsChannelMapper, never()).updateById(any(SmsChannelDO.class));
    }

    /** 保留自己的渠道编码再保存不算重复，允许继续更新凭据。 */
    @Test
    void updateSmsChannelAllowsOwnCode() {
        when(smsChannelMapper.selectById(1L)).thenReturn(channelDO(1L, "ALIYUN"));
        when(smsChannelMapper.selectByCode("ALIYUN")).thenReturn(channelDO(1L, "ALIYUN"));
        SmsChannelSaveReqVO reqVO = saveReqVO("ALIYUN");
        reqVO.setId(1L);
        reqVO.setApiSecret("new-secret");

        smsChannelService.updateSmsChannel(reqVO);

        ArgumentCaptor<SmsChannelDO> captor = ArgumentCaptor.forClass(SmsChannelDO.class);
        verify(smsChannelMapper).updateById(captor.capture());
        assertThat(captor.getValue().getApiSecret()).isEqualTo("new-secret");
        assertThat(captor.getValue().getId()).isEqualTo(1L);
    }

    /** 渠道编码被别的渠道占用时拒绝更新，不允许抢占他人编码。 */
    @Test
    void updateSmsChannelRejectsCodeOwnedByOtherChannel() {
        when(smsChannelMapper.selectById(1L)).thenReturn(channelDO(1L, "OLD"));
        when(smsChannelMapper.selectByCode("ALIYUN")).thenReturn(channelDO(2L, "ALIYUN"));
        SmsChannelSaveReqVO reqVO = saveReqVO("ALIYUN");
        reqVO.setId(1L);

        assertThatThrownBy(() -> smsChannelService.updateSmsChannel(reqVO))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(SMS_CHANNEL_CODE_DUPLICATE.getCode());
        verify(smsChannelMapper, never()).updateById(any(SmsChannelDO.class));
    }

    /** 删除渠道前必须确认没有模板在用，否则整体拒绝删除。 */
    @Test
    void deleteSmsChannelRejectsChannelWithTemplates() {
        when(smsChannelMapper.selectById(1L)).thenReturn(channelDO(1L, "ALIYUN"));
        when(smsTemplateService.getSmsTemplateCountByChannelId(1L)).thenReturn(2L);

        assertThatThrownBy(() -> smsChannelService.deleteSmsChannel(1L))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(SMS_CHANNEL_HAS_CHILDREN.getCode());
        verify(smsChannelMapper, never()).deleteById(anyLong());
    }

    /** 没有模板在用的渠道可以删除，删除使用请求给出的编号。 */
    @Test
    void deleteSmsChannelRemovesUnusedChannel() {
        when(smsChannelMapper.selectById(1L)).thenReturn(channelDO(1L, "ALIYUN"));
        when(smsTemplateService.getSmsTemplateCountByChannelId(1L)).thenReturn(0L);

        smsChannelService.deleteSmsChannel(1L);

        verify(smsChannelMapper).deleteById(1L);
        verify(smsTemplateService).getSmsTemplateCountByChannelId(1L);
    }

    /** 批量删除中任一渠道仍有模板时整体拒绝，已确认可删的渠道也不得被删。 */
    @Test
    void deleteSmsChannelListRejectsWholeBatchWhenTemplateRemains() {
        List<Long> ids = Arrays.asList(1L, 2L);
        when(smsTemplateService.getSmsTemplateCountByChannelId(1L)).thenReturn(0L);
        when(smsTemplateService.getSmsTemplateCountByChannelId(2L)).thenReturn(1L);

        assertThatThrownBy(() -> smsChannelService.deleteSmsChannelList(ids))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(SMS_CHANNEL_HAS_CHILDREN.getCode());
        verify(smsChannelMapper, never()).deleteByIds(anyList());
    }

    /** 批量删除全部无模板依赖时按原编号列表删除，不逐条查询渠道是否存在。 */
    @Test
    void deleteSmsChannelListRemovesUnusedChannels() {
        List<Long> ids = Arrays.asList(1L, 2L);
        when(smsTemplateService.getSmsTemplateCountByChannelId(anyLong())).thenReturn(0L);

        smsChannelService.deleteSmsChannelList(ids);

        verify(smsChannelMapper).deleteByIds(ids);
        verify(smsChannelMapper, never()).selectById(anyLong());
    }

    /** 空编号列表不查询模板依赖，但仍把空列表下发给持久层，行为与真实入口一致。 */
    @Test
    void deleteSmsChannelListWithEmptyIdsSkipsTemplateLookup() {
        List<Long> ids = Collections.emptyList();

        smsChannelService.deleteSmsChannelList(ids);

        verify(smsTemplateService, never()).getSmsTemplateCountByChannelId(anyLong());
        verify(smsChannelMapper).deleteByIds(ids);
    }

    /** 按编号装配客户端时把渠道凭据完整映射成客户端属性后交给工厂。 */
    @Test
    void getSmsClientByIdMapsChannelProperties() {
        when(smsChannelMapper.selectById(1L)).thenReturn(channelDO(1L, "ALIYUN"));
        SmsClient smsClient = mock(SmsClient.class);
        when(smsClientFactory.createOrUpdateSmsClient(any(SmsChannelProperties.class))).thenReturn(smsClient);

        assertThat(smsChannelService.getSmsClient(1L)).isSameAs(smsClient);
        ArgumentCaptor<SmsChannelProperties> captor = ArgumentCaptor.forClass(SmsChannelProperties.class);
        verify(smsClientFactory).createOrUpdateSmsClient(captor.capture());
        assertThat(captor.getValue().getId()).isEqualTo(1L);
        assertThat(captor.getValue().getCode()).isEqualTo("ALIYUN");
        assertThat(captor.getValue().getApiKey()).isEqualTo("key");
        assertThat(captor.getValue().getApiSecret()).isEqualTo("secret");
        assertThat(captor.getValue().getSignature()).isEqualTo("框架");
    }

    /** 渠道不存在时不凭空补凭据：属性为空交给工厂，由工厂按缺配置处理。 */
    @Test
    void getSmsClientByIdPassesEmptyPropertiesWhenChannelMissing() {
        when(smsChannelMapper.selectById(99L)).thenReturn(null);

        assertThat(smsChannelService.getSmsClient(99L)).isNull();
        verify(smsClientFactory).createOrUpdateSmsClient(ArgumentMatchers.isNull());
    }

    /** 按编码取客户端直接委托工厂，由工厂决定复用还是新建。 */
    @Test
    void getSmsClientByCodeDelegatesToFactory() {
        SmsClient smsClient = mock(SmsClient.class);
        when(smsClientFactory.getSmsClient("ALIYUN")).thenReturn(smsClient);

        assertThat(smsChannelService.getSmsClient("ALIYUN")).isSameAs(smsClient);
        verify(smsClientFactory).getSmsClient("ALIYUN");
    }

    /** 单条、列表与分页读取都直接透传持久层结果。 */
    @Test
    void readQueriesDelegateToMapper() {
        SmsChannelDO channel = channelDO(1L, "ALIYUN");
        when(smsChannelMapper.selectById(1L)).thenReturn(channel);
        when(smsChannelMapper.selectList()).thenReturn(List.of(channel));
        SmsChannelPageReqVO pageReqVO = new SmsChannelPageReqVO();
        PageResult<SmsChannelDO> pageResult = new PageResult<>(List.of(channel), 1L);
        when(smsChannelMapper.selectPage(pageReqVO)).thenReturn(pageResult);

        assertThat(smsChannelService.getSmsChannel(1L)).isSameAs(channel);
        assertThat(smsChannelService.getSmsChannelList()).containsExactly(channel);
        assertThat(smsChannelService.getSmsChannelPage(pageReqVO)).isSameAs(pageResult);
        verify(smsChannelMapper).selectById(1L);
        verify(smsChannelMapper).selectPage(pageReqVO);
    }

    /** 渠道不存在时先拒绝，不再统计模板依赖，避免为不存在的渠道做无用查询。 */
    @Test
    void deleteSmsChannelRejectsMissingChannelBeforeCheckingTemplates() {
        when(smsChannelMapper.selectById(99L)).thenReturn(null);

        assertThatThrownBy(() -> smsChannelService.deleteSmsChannel(99L))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(SMS_CHANNEL_NOT_EXISTS.getCode());
        verify(smsTemplateService, never()).getSmsTemplateCountByChannelId(anyLong());
        verify(smsChannelMapper, never()).deleteById(anyLong());
    }
}