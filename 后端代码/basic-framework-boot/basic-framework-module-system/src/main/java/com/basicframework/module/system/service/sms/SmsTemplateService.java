package com.basicframework.module.system.service.sms;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.controller.admin.sms.vo.template.SmsTemplatePageReqVO;
import com.basicframework.module.system.controller.admin.sms.vo.template.SmsTemplateSaveReqVO;
import com.basicframework.module.system.dal.dataobject.sms.SmsTemplateDO;
import jakarta.validation.Valid;

import java.util.List;
import java.util.Map;

/**
 * 短信模板服务接口。
 * <p>
 * 提供短信模板维护、缓存查询、渠道依赖统计和内容格式化能力。
 *
 * @author 李杰
 */
public interface SmsTemplateService {

    /**
     * 创建短信模板。
     *
     * @param createReqVO 模板创建参数
     * @return 模板编号
     */
    Long createSmsTemplate(@Valid SmsTemplateSaveReqVO createReqVO);

    /**
     * 更新短信模板。
     *
     * @param updateReqVO 模板更新参数
     */
    void updateSmsTemplate(@Valid SmsTemplateSaveReqVO updateReqVO);

    /**
     * 删除短信模板。
     *
     * @param id 模板编号
     */
    void deleteSmsTemplate(Long id);

    /**
     * 批量删除短信模板。
     *
     * @param ids 模板编号列表
     */
    void deleteSmsTemplateList(List<Long> ids);

    /**
     * 获取短信模板。
     *
     * @param id 模板编号
     * @return 短信模板信息
     */
    SmsTemplateDO getSmsTemplate(Long id);

    /**
     * 根据编码从缓存获取短信模板。
     *
     * @param code 模板编码
     * @return 短信模板信息
     */
    SmsTemplateDO getSmsTemplateByCodeFromCache(String code);

    /**
     * 分页查询短信模板。
     *
     * @param pageReqVO 分页查询参数
     * @return 模板分页结果
     */
    PageResult<SmsTemplateDO> getSmsTemplatePage(SmsTemplatePageReqVO pageReqVO);

    /**
     * 查询指定短信渠道下的模板数量。
     *
     * @param channelId 短信渠道编号
     * @return 模板数量
     */
    Long getSmsTemplateCountByChannelId(Long channelId);

    /**
     * 格式化短信内容。
     *
     * @param content 短信模板内容
     * @param params  模板参数
     * @return 格式化后的内容
     */
    String formatSmsTemplateContent(String content, Map<String, Object> params);

}
