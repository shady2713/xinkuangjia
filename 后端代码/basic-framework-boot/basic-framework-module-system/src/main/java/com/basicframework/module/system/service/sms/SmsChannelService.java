package com.basicframework.module.system.service.sms;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.module.system.controller.admin.sms.vo.channel.SmsChannelPageReqVO;
import com.basicframework.module.system.controller.admin.sms.vo.channel.SmsChannelSaveReqVO;
import com.basicframework.module.system.dal.dataobject.sms.SmsChannelDO;
import com.basicframework.module.system.framework.sms.core.client.SmsClient;
import jakarta.validation.Valid;

import java.util.List;

/**
 * 短信渠道服务接口。
 * <p>
 * 提供短信渠道维护、查询和短信客户端获取能力。
 *
 * @author zzf
 *
 * 来源 YunaiV/ruoyi-vue-pro@ac022b15a094cf9cf82903d429b9729e72309da5；本地修改：basic-framework 命名空间与模块名适配及本地改动
 */
public interface SmsChannelService {

    /**
     * 创建短信渠道。
     *
     * @param createReqVO 渠道创建参数
     * @return 渠道编号
     */
    Long createSmsChannel(@Valid SmsChannelSaveReqVO createReqVO);

    /**
     * 更新短信渠道。
     *
     * @param updateReqVO 渠道更新参数
     */
    void updateSmsChannel(@Valid SmsChannelSaveReqVO updateReqVO);

    /**
     * 删除短信渠道。
     *
     * @param id 渠道编号
     */
    void deleteSmsChannel(Long id);

    /**
     * 批量删除短信渠道。
     *
     * @param ids 渠道编号列表
     */
    void deleteSmsChannelList(List<Long> ids);

    /**
     * 获取短信渠道。
     *
     * @param id 渠道编号
     * @return 短信渠道信息
     */
    SmsChannelDO getSmsChannel(Long id);

    /**
     * 查询全部短信渠道。
     *
     * @return 短信渠道列表
     */
    List<SmsChannelDO> getSmsChannelList();

    /**
     * 分页查询短信渠道。
     *
     * @param pageReqVO 分页查询参数
     * @return 短信渠道分页结果
     */
    PageResult<SmsChannelDO> getSmsChannelPage(SmsChannelPageReqVO pageReqVO);

    /**
     * 根据渠道编号获取短信客户端。
     *
     * @param id 渠道编号
     * @return 短信客户端
     */
    SmsClient getSmsClient(Long id);

    /**
     * 根据渠道编码获取短信客户端。
     *
     * @param code 渠道编码
     * @return 短信客户端
     */
    SmsClient getSmsClient(String code);

}
