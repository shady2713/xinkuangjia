package com.basicframework.module.system.service.sms;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.common.util.object.BeanUtils;
import com.basicframework.module.system.controller.admin.sms.vo.channel.SmsChannelPageReqVO;
import com.basicframework.module.system.controller.admin.sms.vo.channel.SmsChannelSaveReqVO;
import com.basicframework.module.system.dal.dataobject.sms.SmsChannelDO;
import com.basicframework.module.system.dal.mysql.sms.SmsChannelMapper;
import com.basicframework.module.system.framework.sms.core.client.SmsClient;
import com.basicframework.module.system.framework.sms.core.client.SmsClientFactory;
import com.basicframework.module.system.framework.sms.core.enums.SmsChannelEnum;
import com.basicframework.module.system.framework.sms.core.property.SmsChannelProperties;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.List;

import static com.basicframework.framework.common.exception.util.ServiceExceptionUtil.exception;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CHANNEL_CODE_DUPLICATE;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CHANNEL_HAS_CHILDREN;
import static com.basicframework.module.system.enums.ErrorCodeConstants.SMS_CHANNEL_NOT_EXISTS;

/**
 * 短信渠道 Service 实现类
 *
 * @author 李杰
 */
@Service
@Slf4j
public class SmsChannelServiceImpl implements SmsChannelService {

    @Resource
    private SmsClientFactory smsClientFactory;

    @Resource
    private SmsChannelMapper smsChannelMapper;

    @Resource
    private ObjectProvider<SmsTemplateService> smsTemplateServiceProvider;

    /**
     * 创建短信Channel。
     *
     * @param createReqVO createReqVO 参数
     * @return 操作结果
     */
    @Override
    public Long createSmsChannel(SmsChannelSaveReqVO createReqVO) {
        // 校验渠道编码唯一
        validateSmsChannelCodeUnique(null, createReqVO.getCode());

        SmsChannelDO channel = BeanUtils.toBean(createReqVO, SmsChannelDO.class);
        smsChannelMapper.insert(channel);
        return channel.getId();
    }

    /**
     * 更新短信Channel。
     *
     * @param updateReqVO updateReqVO 参数
     */
    @Override
    public void updateSmsChannel(SmsChannelSaveReqVO updateReqVO) {
        // 校验存在
        validateSmsChannelExists(updateReqVO.getId());
        // 校验渠道编码唯一
        validateSmsChannelCodeUnique(updateReqVO.getId(), updateReqVO.getCode());

        // 更新
        SmsChannelDO updateObj = BeanUtils.toBean(updateReqVO, SmsChannelDO.class);
        smsChannelMapper.updateById(updateObj);
    }

    /**
     * 删除短信Channel。
     *
     * @param id 主键编号
     */
    @Override
    public void deleteSmsChannel(Long id) {
        // 校验存在
        validateSmsChannelExists(id);
        // 校验是否有在使用该账号的模版
        if (getSmsTemplateService().getSmsTemplateCountByChannelId(id) > 0) {
            throw exception(SMS_CHANNEL_HAS_CHILDREN);
        }
        // 删除
        smsChannelMapper.deleteById(id);
    }

    /**
     * 删除短信ChannelList。
     *
     * @param ids ids 编号集合
     */
    @Override
    public void deleteSmsChannelList(List<Long> ids) {
        // 1. 校验是否有在使用该账号的模版
        ids.forEach(id -> {
            if (getSmsTemplateService().getSmsTemplateCountByChannelId(id) > 0) {
                throw exception(SMS_CHANNEL_HAS_CHILDREN);
            }
        });

        // 2. 批量删除
        smsChannelMapper.deleteByIds(ids);
    }

    /**
     * 获取短信模板Service。
     */
    private SmsTemplateService getSmsTemplateService() {
        return smsTemplateServiceProvider.getObject();
    }

    /**
     * 校验 validateSmsChannelExists 对应的输入与业务约束。
     */
    private SmsChannelDO validateSmsChannelExists(Long id) {
        SmsChannelDO channel = smsChannelMapper.selectById(id);
        if (channel == null) {
            throw exception(SMS_CHANNEL_NOT_EXISTS);
        }
        return channel;
    }

    /**
     * 校验 validateSmsChannelCodeUnique 对应的输入与业务约束。
     */
    private void validateSmsChannelCodeUnique(Long id, String code) {
        SmsChannelDO channel = smsChannelMapper.selectByCode(code);
        if (channel == null) {
            return;
        }
        SmsChannelEnum channelEnum = SmsChannelEnum.getByCode(code);
        String channelName = channelEnum != null ? channelEnum.getName() : code;
        if (id == null) {
            throw exception(SMS_CHANNEL_CODE_DUPLICATE, channelName);
        }
        if (!channel.getId().equals(id)) {
            throw exception(SMS_CHANNEL_CODE_DUPLICATE, channelName);
        }
    }

    /**
     * 获取短信Channel。
     *
     * @param id 主键编号
     * @return 查询或转换后的结果
     */
    @Override
    public SmsChannelDO getSmsChannel(Long id) {
        return smsChannelMapper.selectById(id);
    }

    /**
     * 获取短信ChannelList。
     *
     * @return 查询或转换后的结果
     */
    @Override
    public List<SmsChannelDO> getSmsChannelList() {
        return smsChannelMapper.selectList();
    }

    /**
     * 获取短信Channel分页数据。
     *
     * @param pageReqVO pageReqVO 参数
     * @return 查询或转换后的结果
     */
    @Override
    public PageResult<SmsChannelDO> getSmsChannelPage(SmsChannelPageReqVO pageReqVO) {
        return smsChannelMapper.selectPage(pageReqVO);
    }

    /**
     * 获取短信客户端。
     *
     * @param id 主键编号
     * @return 查询或转换后的结果
     */
    @Override
    public SmsClient getSmsClient(Long id) {
        SmsChannelDO channel = smsChannelMapper.selectById(id);
        SmsChannelProperties properties = BeanUtils.toBean(channel, SmsChannelProperties.class);
        return smsClientFactory.createOrUpdateSmsClient(properties);
    }

    /**
     * 获取短信客户端。
     *
     * @param code code 参数
     * @return 查询或转换后的结果
     */
    @Override
    public SmsClient getSmsClient(String code) {
        return smsClientFactory.getSmsClient(code);
    }

}
