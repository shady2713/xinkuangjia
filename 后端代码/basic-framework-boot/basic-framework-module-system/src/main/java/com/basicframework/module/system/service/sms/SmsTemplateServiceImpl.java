package com.basicframework.module.system.service.sms;

import cn.hutool.core.exceptions.ExceptionUtil;
import cn.hutool.core.lang.Assert;
import cn.hutool.core.util.ReUtil;
import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.common.enums.CommonStatusEnum;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.module.system.controller.admin.sms.vo.template.SmsTemplatePageReqVO;
import com.basicframework.module.system.controller.admin.sms.vo.template.SmsTemplateSaveReqVO;
import com.basicframework.module.system.dal.dataobject.sms.SmsChannelDO;
import com.basicframework.module.system.dal.dataobject.sms.SmsTemplateDO;
import com.basicframework.module.system.dal.mysql.sms.SmsTemplateMapper;
import com.basicframework.module.system.dal.redis.RedisKeyConstants;
import com.basicframework.module.system.framework.sms.core.client.SmsClient;
import com.basicframework.module.system.framework.sms.core.client.dto.SmsTemplateRespDTO;
import com.basicframework.module.system.framework.sms.core.enums.SmsTemplateAuditStatusEnum;
import com.google.common.annotations.VisibleForTesting;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.module.system.enums.ErrorCodeConstants.*;

/**
 * 短信模板 Service 实现类
 *
 * @author 李杰
 * @since 2021/1/25 9:25
 */
@Service
@Slf4j
public class SmsTemplateServiceImpl implements SmsTemplateService {

    /**
     * 正则表达式，匹配 {} 中的变量
     */
    private static final Pattern PATTERN_PARAMS = Pattern.compile("\\{(.*?)}");

    @Resource
    private SmsTemplateMapper smsTemplateMapper;

    @Resource
    private SmsChannelService smsChannelService;

    /**
     * 创建短信模板。
     *
     * @param createReqVO createReqVO 参数
     * @return 操作结果
     */
    @Override
    public Long createSmsTemplate(SmsTemplateSaveReqVO createReqVO) {
        // 校验短信渠道
        SmsChannelDO channelDO = validateSmsChannel(createReqVO.getChannelId());
        // 校验短信编码是否重复
        validateSmsTemplateCodeDuplicate(null, createReqVO.getCode());
        // 校验短信模板
        validateApiTemplate(createReqVO.getChannelId(), createReqVO.getApiTemplateId());

        // 插入
        SmsTemplateDO template = BeanUtils.toBean(createReqVO, SmsTemplateDO.class);
        template.setParams(parseTemplateContentParams(template.getContent()));
        template.setChannelCode(channelDO.getCode());
        smsTemplateMapper.insert(template);
        // 返回
        return template.getId();
    }

    /**
     * 更新短信模板。
     *
     * @param updateReqVO updateReqVO 参数
     */
    @Override
    @CacheEvict(cacheNames = RedisKeyConstants.SMS_TEMPLATE,
            allEntries = true) // allEntries 清空所有缓存，因为可能修改到 code 字段，不好清理
    public void updateSmsTemplate(SmsTemplateSaveReqVO updateReqVO) {
        // 校验存在
        validateSmsTemplateExists(updateReqVO.getId());
        // 校验短信渠道
        SmsChannelDO channelDO = validateSmsChannel(updateReqVO.getChannelId());
        // 校验短信编码是否重复
        validateSmsTemplateCodeDuplicate(updateReqVO.getId(), updateReqVO.getCode());
        // 校验短信模板
        validateApiTemplate(updateReqVO.getChannelId(), updateReqVO.getApiTemplateId());

        // 更新
        SmsTemplateDO updateObj = BeanUtils.toBean(updateReqVO, SmsTemplateDO.class);
        updateObj.setParams(parseTemplateContentParams(updateObj.getContent()));
        updateObj.setChannelCode(channelDO.getCode());
        smsTemplateMapper.updateById(updateObj);
    }

    /**
     * 删除短信模板。
     *
     * @param id 主键编号
     */
    @Override
    @CacheEvict(cacheNames = RedisKeyConstants.SMS_TEMPLATE,
            allEntries = true) // allEntries 清空所有缓存，因为 id 不是直接的缓存 code，不好清理
    public void deleteSmsTemplate(Long id) {
        // 校验存在
        validateSmsTemplateExists(id);
        // 更新
        smsTemplateMapper.deleteById(id);
    }

    /**
     * 删除短信模板List。
     *
     * @param ids ids 编号集合
     */
    @Override
    @CacheEvict(cacheNames = RedisKeyConstants.SMS_TEMPLATE,
            allEntries = true) // allEntries 清空所有缓存，因为 id 不是直接的缓存 code，不好清理
    public void deleteSmsTemplateList(List<Long> ids) {
        smsTemplateMapper.deleteByIds(ids);
    }

    /**
     * 校验 validateSmsTemplateExists 对应的输入与业务约束。
     */
    private void validateSmsTemplateExists(Long id) {
        if (smsTemplateMapper.selectById(id) == null) {
            throw exception(SMS_TEMPLATE_NOT_EXISTS);
        }
    }

    /**
     * 获取短信模板。
     *
     * @param id 主键编号
     * @return 查询或转换后的结果
     */
    @Override
    public SmsTemplateDO getSmsTemplate(Long id) {
        return smsTemplateMapper.selectById(id);
    }

    /**
     * 获取短信模板By验证码FromCache。
     *
     * @param code code 参数
     * @return 查询或转换后的结果
     */
    @Override
    @Cacheable(cacheNames = RedisKeyConstants.SMS_TEMPLATE, key = "#code",
            unless = "#result == null")
    public SmsTemplateDO getSmsTemplateByCodeFromCache(String code) {
        return smsTemplateMapper.selectByCode(code);
    }

    /**
     * 获取短信模板分页数据。
     *
     * @param pageReqVO pageReqVO 参数
     * @return 查询或转换后的结果
     */
    @Override
    public PageResult<SmsTemplateDO> getSmsTemplatePage(SmsTemplatePageReqVO pageReqVO) {
        return smsTemplateMapper.selectPage(pageReqVO);
    }

    /**
     * 获取短信模板数量ByChannelId。
     *
     * @param channelId channelId 编号
     * @return 查询或转换后的结果
     */
    @Override
    public Long getSmsTemplateCountByChannelId(Long channelId) {
        return smsTemplateMapper.selectCountByChannelId(channelId);
    }

    /**
     * 校验短信渠道。
     *
     * @param channelId 渠道编号
     * @return 方法处理结果
     */
    @VisibleForTesting
    public SmsChannelDO validateSmsChannel(Long channelId) {
        SmsChannelDO channelDO = smsChannelService.getSmsChannel(channelId);
        if (channelDO == null) {
            throw exception(SMS_CHANNEL_NOT_EXISTS);
        }
        if (CommonStatusEnum.isDisable(channelDO.getStatus())) {
            throw exception(SMS_CHANNEL_DISABLE);
        }
        return channelDO;
    }

    /**
     * 校验短信模板编码Duplicate。
     *
     * @param id 主键编号
     * @param code 编码
     */
    @VisibleForTesting
    public void validateSmsTemplateCodeDuplicate(Long id, String code) {
        SmsTemplateDO template = smsTemplateMapper.selectByCode(code);
        if (template == null) {
            return;
        }
        // 如果 id 为空，说明不用比较是否为相同 id 的字典类型
        if (id == null) {
            throw exception(SMS_TEMPLATE_CODE_DUPLICATE, code);
        }
        if (!template.getId().equals(id)) {
            throw exception(SMS_TEMPLATE_CODE_DUPLICATE, code);
        }
    }

    /**
     * 校验 API 短信平台的模板是否有效
     *
     * @param channelId 渠道编号
     * @param apiTemplateId API 模板编号
     */
    @VisibleForTesting
    void validateApiTemplate(Long channelId, String apiTemplateId) {
        // 获得短信模板
        SmsClient smsClient = smsChannelService.getSmsClient(channelId);
        Assert.notNull(smsClient, String.format("短信客户端(%d) 不存在", channelId));
        SmsTemplateRespDTO template;
        try {
            template = smsClient.getSmsTemplate(apiTemplateId);
        } catch (Exception ex) {
            throw exception(SMS_TEMPLATE_API_ERROR, ExceptionUtil.getRootCauseMessage(ex));
        }
        // 校验短信模版
        if (template == null) {
            throw exception(SMS_TEMPLATE_API_NOT_FOUND);
        }
        if (Objects.equals(template.getAuditStatus(), SmsTemplateAuditStatusEnum.CHECKING.getStatus())) {
            throw exception(SMS_TEMPLATE_API_AUDIT_CHECKING);
        }
        if (Objects.equals(template.getAuditStatus(), SmsTemplateAuditStatusEnum.FAIL.getStatus())) {
            throw exception(SMS_TEMPLATE_API_AUDIT_FAIL, template.getAuditReason());
        }
        if (!Objects.equals(template.getAuditStatus(), SmsTemplateAuditStatusEnum.SUCCESS.getStatus())) {
            throw new IllegalArgumentException(
                    String.format("短信模板(%s) 审核状态(%d) 不正确", apiTemplateId, template.getAuditStatus()));
        }
    }

    /**
     * 格式化短信模板内容。
     *
     * @param content content 参数
     * @param params params 参数
     * @return 方法处理结果
     */
    @Override
    public String formatSmsTemplateContent(String content, Map<String, Object> params) {
        return StrUtil.format(content, params);
    }

    /**
     * 解析模板内容Params。
     */
    @VisibleForTesting
    List<String> parseTemplateContentParams(String content) {
        return ReUtil.findAllGroup1(PATTERN_PARAMS, content);
    }

}
