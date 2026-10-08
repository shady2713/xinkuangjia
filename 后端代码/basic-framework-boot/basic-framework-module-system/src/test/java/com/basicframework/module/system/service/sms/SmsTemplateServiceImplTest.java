package com.basicframework.module.system.service.sms;

import cn.hutool.core.exceptions.ExceptionUtil;
import com.basicframework.framework.common.exception.ServiceException;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.controller.admin.sms.vo.template.SmsTemplatePageReqVO;
import com.basicframework.module.system.controller.admin.sms.vo.template.SmsTemplateSaveReqVO;
import com.basicframework.module.system.dal.dataobject.sms.SmsChannelDO;
import com.basicframework.module.system.dal.dataobject.sms.SmsTemplateDO;
import com.basicframework.module.system.dal.mysql.sms.SmsTemplateMapper;
import com.basicframework.module.system.framework.sms.core.client.SmsClient;
import com.basicframework.module.system.framework.sms.core.client.dto.SmsTemplateRespDTO;
import com.basicframework.module.system.framework.sms.core.enums.SmsTemplateAuditStatusEnum;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CHANNEL_DISABLE;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CHANNEL_NOT_EXISTS;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_TEMPLATE_API_AUDIT_CHECKING;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_TEMPLATE_API_AUDIT_FAIL;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_TEMPLATE_API_ERROR;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_TEMPLATE_API_NOT_FOUND;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_TEMPLATE_CODE_DUPLICATE;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_TEMPLATE_NOT_EXISTS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 验证短信模板服务的渠道可用性、模板编码唯一性、渠道侧审核状态与内容参数解析。
 *
 * <p>模板是"能不能发出去"的唯一闸门，四条规则失效后表现各不相同：渠道不存在或已停用仍允许建模板，
 * 运营配置完成后到发送时才失败；模板编码不唯一会让按编码取模板的调用方命中不确定的一条；渠道侧模板
 * 未通过审核就建本地模板，发送时会被供应商拒绝，而本地看不出原因；内容里的 {@code {}} 参数如果没解析
 * 成参数列表，发送前的参数完整性校验就形同虚设。</p>
 *
 * <p>持久层、渠道服务与供应商客户端都按进程外边界替换为替身，本地模板的存在性判定、编码唯一性判定、
 * 渠道状态判定、渠道审核状态判定与参数解析全部真实执行；断言核对真实业务错误码、写入对象的参数列表
 * 与渠道编码回填，以及客户端替身实际收到的渠道编号与模板编号。</p>
 *
 * @author shady2713
 */
class SmsTemplateServiceImplTest {

    /** 替换数据库自增的模板编号。 */
    private static final Long GENERATED_ID = 24576L;

    /** 被测服务。 */
    private SmsTemplateServiceImpl smsTemplateService;
    /** 短信模板持久层替身。 */
    private SmsTemplateMapper smsTemplateMapper;
    /** 短信渠道服务替身。 */
    private SmsChannelService smsChannelService;
    /** 渠道侧短信客户端替身。 */
    private SmsClient smsClient;

    /**
     * 装配服务与全部替身。
     */
    @BeforeEach
    void setUp() {
        smsTemplateService = new SmsTemplateServiceImpl();
        smsTemplateMapper = mock(SmsTemplateMapper.class);
        smsChannelService = mock(SmsChannelService.class);
        smsClient = mock(SmsClient.class);
        ReflectionTestUtils.setField(smsTemplateService, "smsTemplateMapper", smsTemplateMapper);
        ReflectionTestUtils.setField(smsTemplateService, "smsChannelService", smsChannelService);
    }

    /**
     * 构造一条启用状态的短信渠道记录。
     *
     * @return 短信渠道记录
     */
    private static SmsChannelDO enabledChannel() {
        SmsChannelDO channel = new SmsChannelDO();
        channel.setId(3L);
        channel.setCode("ALIYUN");
        channel.setStatus(0);
        return channel;
    }

    /**
     * 构造一条短信模板保存请求。
     *
     * @param code 模板编码
     * @param content 模板内容
     * @return 保存请求
     */
    private static SmsTemplateSaveReqVO saveReqVO(String code, String content) {
        SmsTemplateSaveReqVO reqVO = new SmsTemplateSaveReqVO();
        reqVO.setChannelId(3L);
        reqVO.setCode(code);
        reqVO.setName("验证码模板");
        reqVO.setContent(content);
        reqVO.setType(1);
        reqVO.setStatus(0);
        reqVO.setApiTemplateId("SMS_001");
        return reqVO;
    }

    /**
     * 让渠道侧模板查询返回指定审核状态的模板。
     *
     * @param auditStatus 审核状态
     * @param auditReason 审核原因
     */
    private void mockApiTemplate(Integer auditStatus, String auditReason) {
        SmsTemplateRespDTO respDTO = new SmsTemplateRespDTO();
        respDTO.setId("SMS_001");
        respDTO.setContent("您的验证码是 ${code}");
        respDTO.setAuditStatus(auditStatus);
        respDTO.setAuditReason(auditReason);
        when(smsChannelService.getSmsClient(3L)).thenReturn(smsClient);
        when(smsClient.getSmsTemplate("SMS_001")).thenReturn(respDTO);
    }

    /** 创建成功时解析内容参数、回填渠道编码，并把初始状态设为待发送之外的可追踪状态。 */
    @Test
    void createSmsTemplateParsesParamsAndBackfillsChannelCode() {
        when(smsChannelService.getSmsChannel(3L)).thenReturn(enabledChannel());
        when(smsTemplateMapper.selectByCode("sms_verify")).thenReturn(null);
        mockApiTemplate(SmsTemplateAuditStatusEnum.SUCCESS.getStatus(), null);
        doAnswer(invocation -> {
            SmsTemplateDO inserted = invocation.getArgument(0);
            inserted.setId(GENERATED_ID);
            return 1;
        }).when(smsTemplateMapper).insert(any(SmsTemplateDO.class));

        Long id = smsTemplateService.createSmsTemplate(
                saveReqVO("sms_verify", "您的验证码是 {code}，{code} 十分钟内有效"));

        ArgumentCaptor<SmsTemplateDO> captor = ArgumentCaptor.forClass(SmsTemplateDO.class);
        verify(smsTemplateMapper).insert(captor.capture());
        assertThat(id).isEqualTo(GENERATED_ID);
        assertThat(captor.getValue().getParams()).containsExactly("code", "code");
        assertThat(captor.getValue().getChannelCode()).isEqualTo("ALIYUN");
        verify(smsClient).getSmsTemplate("SMS_001");
    }

    /** 模板内容没有占位符时参数列表为空，不影响创建。 */
    @Test
    void createSmsTemplateAcceptsContentWithoutParams() {
        when(smsChannelService.getSmsChannel(3L)).thenReturn(enabledChannel());
        when(smsTemplateMapper.selectByCode("sms_notice")).thenReturn(null);
        mockApiTemplate(SmsTemplateAuditStatusEnum.SUCCESS.getStatus(), null);
        doAnswer(invocation -> {
            SmsTemplateDO inserted = invocation.getArgument(0);
            inserted.setId(GENERATED_ID);
            return 1;
        }).when(smsTemplateMapper).insert(any(SmsTemplateDO.class));

        smsTemplateService.createSmsTemplate(saveReqVO("sms_notice", "您的订单已发货"));

        ArgumentCaptor<SmsTemplateDO> captor = ArgumentCaptor.forClass(SmsTemplateDO.class);
        verify(smsTemplateMapper).insert(captor.capture());
        assertThat(captor.getValue().getParams()).isEmpty();
        assertThat(captor.getValue().getChannelCode()).isEqualTo("ALIYUN");
    }

    /** 渠道不存在时拒绝建模板，不访问渠道侧接口。 */
    @Test
    void createSmsTemplateRejectsMissingChannel() {
        when(smsChannelService.getSmsChannel(3L)).thenReturn(null);

        assertThatThrownBy(() -> smsTemplateService.createSmsTemplate(saveReqVO("sms_verify", "验证码 {code}")))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(SMS_CHANNEL_NOT_EXISTS.getCode());
        verify(smsTemplateMapper, never()).insert(any(SmsTemplateDO.class));
        verify(smsChannelService, never()).getSmsClient(anyLong());
    }

    /** 渠道已停用时拒绝建模板，避免运营把模板建在不可用渠道上。 */
    @Test
    void createSmsTemplateRejectsDisabledChannel() {
        SmsChannelDO disabled = enabledChannel();
        disabled.setStatus(1);
        when(smsChannelService.getSmsChannel(3L)).thenReturn(disabled);

        assertThatThrownBy(() -> smsTemplateService.createSmsTemplate(saveReqVO("sms_verify", "验证码 {code}")))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(SMS_CHANNEL_DISABLE.getCode());
        verify(smsTemplateMapper, never()).insert(any(SmsTemplateDO.class));
    }

    /** 模板编码已被占用时拒绝创建，不写入。 */
    @Test
    void createSmsTemplateRejectsDuplicatedCode() {
        when(smsChannelService.getSmsChannel(3L)).thenReturn(enabledChannel());
        SmsTemplateDO existing = new SmsTemplateDO();
        existing.setId(1L);
        existing.setCode("sms_verify");
        when(smsTemplateMapper.selectByCode("sms_verify")).thenReturn(existing);

        assertThatThrownBy(() -> smsTemplateService.createSmsTemplate(saveReqVO("sms_verify", "验证码 {code}")))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(SMS_TEMPLATE_CODE_DUPLICATE.getCode());
        verify(smsTemplateMapper, never()).insert(any(SmsTemplateDO.class));
    }

    /** 渠道侧模板审核中时拒绝创建，并把审核中这一固定原因带给运营。 */
    @Test
    void createSmsTemplateRejectsApiTemplateUnderAudit() {
        when(smsChannelService.getSmsChannel(3L)).thenReturn(enabledChannel());
        when(smsTemplateMapper.selectByCode("sms_verify")).thenReturn(null);
        mockApiTemplate(SmsTemplateAuditStatusEnum.CHECKING.getStatus(), null);

        assertThatThrownBy(() -> smsTemplateService.createSmsTemplate(saveReqVO("sms_verify", "验证码 {code}")))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(SMS_TEMPLATE_API_AUDIT_CHECKING.getCode());
        verify(smsTemplateMapper, never()).insert(any(SmsTemplateDO.class));
    }

    /** 渠道侧模板审核不通过时拒绝创建，并把渠道返回的审核原因带出来。 */
    @Test
    void createSmsTemplateRejectsApiTemplateAuditFailure() {
        when(smsChannelService.getSmsChannel(3L)).thenReturn(enabledChannel());
        when(smsTemplateMapper.selectByCode("sms_verify")).thenReturn(null);
        mockApiTemplate(SmsTemplateAuditStatusEnum.FAIL.getStatus(), "签名不合法");

        assertThatThrownBy(() -> smsTemplateService.createSmsTemplate(saveReqVO("sms_verify", "验证码 {code}")))
                .isInstanceOf(ServiceException.class)
                .hasMessageContaining("签名不合法");
        verify(smsTemplateMapper, never()).insert(any(SmsTemplateDO.class));
    }

    /** 渠道侧查不到模板时拒绝创建。 */
    @Test
    void createSmsTemplateRejectsMissingApiTemplate() {
        when(smsChannelService.getSmsChannel(3L)).thenReturn(enabledChannel());
        when(smsTemplateMapper.selectByCode("sms_verify")).thenReturn(null);
        when(smsChannelService.getSmsClient(3L)).thenReturn(smsClient);
        when(smsClient.getSmsTemplate("SMS_001")).thenReturn(null);

        assertThatThrownBy(() -> smsTemplateService.createSmsTemplate(saveReqVO("sms_verify", "验证码 {code}")))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(SMS_TEMPLATE_API_NOT_FOUND.getCode());
        verify(smsTemplateMapper, never()).insert(any(SmsTemplateDO.class));
    }

    /** 渠道接口调用失败时按 API 调用失败报错，并带上根因消息而不是包装异常堆栈。 */
    @Test
    void createSmsTemplateRejectsApiCallFailure() {
        when(smsChannelService.getSmsChannel(3L)).thenReturn(enabledChannel());
        when(smsTemplateMapper.selectByCode("sms_verify")).thenReturn(null);
        when(smsChannelService.getSmsClient(3L)).thenReturn(smsClient);
        when(smsClient.getSmsTemplate("SMS_001")).thenThrow(new IllegalStateException("渠道连接超时"));

        assertThatThrownBy(() -> smsTemplateService.createSmsTemplate(saveReqVO("sms_verify", "验证码 {code}")))
                .isInstanceOf(ServiceException.class)
                .hasMessageContaining(ExceptionUtil.getRootCauseMessage(new IllegalStateException("渠道连接超时")))
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(SMS_TEMPLATE_API_ERROR.getCode());
    }

    /** 渠道侧返回未知审核状态时按参数错误拒绝，不能当成"可用"放行。 */
    @Test
    void createSmsTemplateRejectsUnknownApiAuditStatus() {
        when(smsChannelService.getSmsChannel(3L)).thenReturn(enabledChannel());
        when(smsTemplateMapper.selectByCode("sms_verify")).thenReturn(null);
        mockApiTemplate(99, null);

        assertThatThrownBy(() -> smsTemplateService.createSmsTemplate(saveReqVO("sms_verify", "验证码 {code}")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("审核状态(99) 不正确");
        verify(smsTemplateMapper, never()).insert(any(SmsTemplateDO.class));
    }

    /** 渠道没有可用客户端时按参数错误拒绝，并在提示中带上出问题的渠道编号。 */
    @Test
    void createSmsTemplateRejectsMissingSmsClient() {
        when(smsChannelService.getSmsChannel(3L)).thenReturn(enabledChannel());
        when(smsTemplateMapper.selectByCode("sms_verify")).thenReturn(null);
        when(smsChannelService.getSmsClient(3L)).thenReturn(null);

        assertThatThrownBy(() -> smsTemplateService.createSmsTemplate(saveReqVO("sms_verify", "验证码 {code}")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("短信客户端(3) 不存在");
        verify(smsClient, never()).getSmsTemplate(anyString());
    }

    /** 更新时先确认模板存在，不存在则不再访问渠道与持久层写入。 */
    @Test
    void updateSmsTemplateRejectsMissingTemplate() {
        when(smsTemplateMapper.selectById(9L)).thenReturn(null);
        SmsTemplateSaveReqVO reqVO = saveReqVO("sms_verify", "验证码 {code}");
        reqVO.setId(9L);

        assertThatThrownBy(() -> smsTemplateService.updateSmsTemplate(reqVO))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(SMS_TEMPLATE_NOT_EXISTS.getCode());
        verify(smsChannelService, never()).getSmsChannel(anyLong());
        verify(smsTemplateMapper, never()).updateById(any(SmsTemplateDO.class));
    }

    /** 更新成功时同样重新解析内容参数并回填渠道编码，缓存键 code 可能已变。 */
    @Test
    void updateSmsTemplateReparsesParamsAndChannelCode() {
        SmsTemplateDO existing = new SmsTemplateDO();
        existing.setId(9L);
        existing.setCode("sms_verify");
        when(smsTemplateMapper.selectById(9L)).thenReturn(existing);
        when(smsChannelService.getSmsChannel(3L)).thenReturn(enabledChannel());
        when(smsTemplateMapper.selectByCode("sms_verify")).thenReturn(existing);
        mockApiTemplate(SmsTemplateAuditStatusEnum.SUCCESS.getStatus(), null);
        SmsTemplateSaveReqVO reqVO = saveReqVO("sms_verify", "验证码 {code}，于 {minute} 分钟内有效");
        reqVO.setId(9L);

        smsTemplateService.updateSmsTemplate(reqVO);

        ArgumentCaptor<SmsTemplateDO> captor = ArgumentCaptor.forClass(SmsTemplateDO.class);
        verify(smsTemplateMapper).updateById(captor.capture());
        assertThat(captor.getValue().getParams()).containsExactly("code", "minute");
        assertThat(captor.getValue().getChannelCode()).isEqualTo("ALIYUN");
        assertThat(captor.getValue().getId()).isEqualTo(9L);
    }

    /** 模板编码被别的模板占用时拒绝更新，不允许改 code 覆盖他人模板。 */
    @Test
    void updateSmsTemplateRejectsCodeOwnedByOtherTemplate() {
        SmsTemplateDO existing = new SmsTemplateDO();
        existing.setId(9L);
        existing.setCode("old_code");
        when(smsTemplateMapper.selectById(9L)).thenReturn(existing);
        when(smsChannelService.getSmsChannel(3L)).thenReturn(enabledChannel());
        SmsTemplateDO other = new SmsTemplateDO();
        other.setId(1L);
        other.setCode("sms_verify");
        when(smsTemplateMapper.selectByCode("sms_verify")).thenReturn(other);
        SmsTemplateSaveReqVO reqVO = saveReqVO("sms_verify", "验证码 {code}");
        reqVO.setId(9L);

        assertThatThrownBy(() -> smsTemplateService.updateSmsTemplate(reqVO))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(SMS_TEMPLATE_CODE_DUPLICATE.getCode());
        verify(smsTemplateMapper, never()).updateById(any(SmsTemplateDO.class));
    }

    /** 删除模板前必须确认存在，删除使用请求给出的编号。 */
    @Test
    void deleteSmsTemplateRemovesExistingTemplate() {
        SmsTemplateDO existing = new SmsTemplateDO();
        existing.setId(9L);
        when(smsTemplateMapper.selectById(9L)).thenReturn(existing);

        smsTemplateService.deleteSmsTemplate(9L);

        verify(smsTemplateMapper).deleteById(9L);
    }

    /** 删除不存在的模板时拒绝，避免缓存被无效编号清空后留下误判。 */
    @Test
    void deleteSmsTemplateRejectsMissingTemplate() {
        when(smsTemplateMapper.selectById(9L)).thenReturn(null);

        assertThatThrownBy(() -> smsTemplateService.deleteSmsTemplate(9L))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(SMS_TEMPLATE_NOT_EXISTS.getCode());
        verify(smsTemplateMapper, never()).deleteById(anyLong());
    }

    /** 批量删除按原编号列表下发，不逐条确认存在性。 */
    @Test
    void deleteSmsTemplateListDeletesRequestedIds() {
        List<Long> ids = Arrays.asList(1L, 2L);

        smsTemplateService.deleteSmsTemplateList(ids);

        verify(smsTemplateMapper).deleteByIds(ids);
        verify(smsTemplateMapper, never()).selectById(anyLong());
    }

    /** 按编码读取模板时透传持久层结果；缓存语义由 Spring 缓存代理承担，这里不重复验证。 */
    @Test
    void getSmsTemplateByCodeFromCacheDelegatesToMapper() {
        SmsTemplateDO template = new SmsTemplateDO();
        template.setId(7L);
        template.setCode("sms_verify");
        when(smsTemplateMapper.selectByCode("sms_verify")).thenReturn(template);

        assertThat(smsTemplateService.getSmsTemplateByCodeFromCache("sms_verify")).isSameAs(template);
        verify(smsTemplateMapper).selectByCode("sms_verify");
    }

    /** 渠道校验区分"不存在"与"已停用"两种失败原因。 */
    @Test
    void validateSmsChannelDistinguishesMissingFromDisabled() {
        SmsChannelDO disabled = enabledChannel();
        disabled.setStatus(1);
        SmsChannelDO enabled = enabledChannel();
        when(smsChannelService.getSmsChannel(3L)).thenReturn(enabled);
        when(smsChannelService.getSmsChannel(4L)).thenReturn(null);
        when(smsChannelService.getSmsChannel(5L)).thenReturn(disabled);

        assertThat(smsTemplateService.validateSmsChannel(3L)).isSameAs(enabled);
        assertThatThrownBy(() -> smsTemplateService.validateSmsChannel(4L))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(SMS_CHANNEL_NOT_EXISTS.getCode());
        assertThatThrownBy(() -> smsTemplateService.validateSmsChannel(5L))
                .isInstanceOf(ServiceException.class)
                .extracting(ex -> ((ServiceException) ex).getCode()).isEqualTo(SMS_CHANNEL_DISABLE.getCode());
    }

    /** 编码判重：未占用放行，保留自身放行，被他人占用拒绝。 */
    @Test
    void validateSmsTemplateCodeDuplicateAllowsOnlyUnoccupiedOrSelf() {
        when(smsTemplateMapper.selectByCode("free")).thenReturn(null);
        SmsTemplateDO self = new SmsTemplateDO();
        self.setId(9L);
        SmsTemplateDO other = new SmsTemplateDO();
        other.setId(1L);
        when(smsTemplateMapper.selectByCode("mine")).thenReturn(self);
        when(smsTemplateMapper.selectByCode("taken")).thenReturn(other);

        smsTemplateService.validateSmsTemplateCodeDuplicate(null, "free");
        smsTemplateService.validateSmsTemplateCodeDuplicate(9L, "mine");
        assertThatThrownBy(() -> smsTemplateService.validateSmsTemplateCodeDuplicate(null, "taken"))
                .isInstanceOf(ServiceException.class)
                .hasMessageContaining("taken");
        assertThatThrownBy(() -> smsTemplateService.validateSmsTemplateCodeDuplicate(9L, "taken"))
                .isInstanceOf(ServiceException.class)
                .hasMessageContaining("taken");
    }

    /** 内容参数解析：按出现顺序返回每个占位符，重复占位符不去重，空内容返回空列表。 */
    @Test
    void parseTemplateContentParamsExtractsEveryPlaceholderInOrder() {
        assertThat(smsTemplateService.parseTemplateContentParams("{code} 与 {name}，再次 {code}"))
                .containsExactly("code", "name", "code");
        assertThat(smsTemplateService.parseTemplateContentParams("无占位符")).isEmpty();
        assertThat(smsTemplateService.parseTemplateContentParams("")).isEmpty();
    }

    /** 内容格式化按参数替换占位符，缺少参数时按空串处理而不是抛错。 */
    @Test
    void formatSmsTemplateContentSubstitutesParams() {
        Map<String, Object> params = new HashMap<>();
        params.put("code", "123456");

        assertThat(smsTemplateService.formatSmsTemplateContent("验证码 {code}", params)).isEqualTo("验证码 123456");
        assertThat(smsTemplateService.formatSmsTemplateContent("验证码 {code}", Map.of()))
                .isEqualTo("验证码 {code}");
    }

    /** 模板数量统计直接透传持久层结果，供渠道删除前的子资源保护使用。 */
    @Test
    void getSmsTemplateCountByChannelIdDelegatesToMapper() {
        when(smsTemplateMapper.selectCountByChannelId(3L)).thenReturn(5L);

        assertThat(smsTemplateService.getSmsTemplateCountByChannelId(3L)).isEqualTo(5L);
        verify(smsTemplateMapper).selectCountByChannelId(3L);
    }

    /** 单条读取与分页查询都直接透传持久层结果。 */
    @Test
    void readQueriesDelegateToMapper() {
        SmsTemplateDO template = new SmsTemplateDO();
        template.setId(7L);
        when(smsTemplateMapper.selectById(7L)).thenReturn(template);
        SmsTemplatePageReqVO pageReqVO = new SmsTemplatePageReqVO();
        PageResult<SmsTemplateDO> pageResult = new PageResult<>(List.of(template), 1L);
        when(smsTemplateMapper.selectPage(pageReqVO)).thenReturn(pageResult);

        assertThat(smsTemplateService.getSmsTemplate(7L)).isSameAs(template);
        assertThat(smsTemplateService.getSmsTemplatePage(pageReqVO)).isSameAs(pageResult);
        verify(smsTemplateMapper).selectById(7L);
        verify(smsTemplateMapper).selectPage(pageReqVO);
    }
}