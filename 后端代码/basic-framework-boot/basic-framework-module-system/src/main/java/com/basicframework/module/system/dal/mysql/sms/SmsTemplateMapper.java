package com.basicframework.module.system.dal.mysql.sms;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.system.controller.admin.sms.vo.template.SmsTemplatePageReqVO;
import com.basicframework.module.system.dal.dataobject.sms.SmsTemplateDO;
import org.apache.ibatis.annotations.Mapper;

/**
 * SmsTemplateMapper 数据访问接口，负责持久化查询与写入。
 *
 * @author 李杰
 * 署名验收：尚未验收
 */
@Mapper
public interface SmsTemplateMapper extends BaseMapperX<SmsTemplateDO> {

    /**
     * 查询By编码。
     *
     * @param code 编码
     * @return 查询结果
     */
    default SmsTemplateDO selectByCode(String code) {
        return selectOne(SmsTemplateDO::getCode, code);
    }

    /**
     * 查询分页数据。
     *
     * @param reqVO 请求参数
     * @return 查询结果
     */
    default PageResult<SmsTemplateDO> selectPage(SmsTemplatePageReqVO reqVO) {
        return selectPage(reqVO, new LambdaQueryWrapperX<SmsTemplateDO>()
                .eqIfPresent(SmsTemplateDO::getType, reqVO.getType())
                .eqIfPresent(SmsTemplateDO::getStatus, reqVO.getStatus())
                .likeIfPresent(SmsTemplateDO::getCode, reqVO.getCode())
                .likeIfPresent(SmsTemplateDO::getContent, reqVO.getContent())
                .likeIfPresent(SmsTemplateDO::getApiTemplateId, reqVO.getApiTemplateId())
                .eqIfPresent(SmsTemplateDO::getChannelId, reqVO.getChannelId())
                .betweenIfPresent(SmsTemplateDO::getCreateTime, reqVO.getCreateTime())
                .orderByDesc(SmsTemplateDO::getId));
    }

    /**
     * 查询数量By渠道编号。
     *
     * @param channelId 渠道编号
     * @return 统计数量
     */
    default Long selectCountByChannelId(Long channelId) {
        return selectCount(SmsTemplateDO::getChannelId, channelId);
    }

}
