package com.basicframework.module.system.dal.mysql.sms;

import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.system.dal.dataobject.sms.SmsLogDO;
import com.basicframework.module.system.enums.sms.SmsReceiveStatusEnum;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.apache.ibatis.annotations.Mapper;

/**
 * 短信日志数据访问接口。
 *
 * @author 李杰
 */
@Mapper
public interface SmsLogMapper extends BaseMapperX<SmsLogDO> {

    /**
     * 根据供应商回执标识查找短信日志。
     *
     * <p>渠道、供应商流水号和手机号都必须存在，防止不同供应商相同流水号发生串写；
     * 阿里云提供内部日志编号时会一并交叉校验，编号不能替代关联条件。</p>
     *
     * @param channelCode 回调入口对应的供应商渠道编码
     * @param id 内部短信日志编号，可为空
     * @param apiSerialNo 供应商流水号
     * @param mobile 手机号
     * @return 匹配的短信日志，标识不完整或未匹配时返回 {@code null}
     */
    default SmsLogDO selectByReceiveCallback(String channelCode, Long id, String apiSerialNo, String mobile) {
        if (StrUtil.isBlank(channelCode) || StrUtil.isBlank(apiSerialNo) || StrUtil.isBlank(mobile)) {
            return null;
        }
        return selectPage(new Page<SmsLogDO>(1, 1, false),
                new LambdaQueryWrapperX<SmsLogDO>()
                        .eqIfPresent(SmsLogDO::getId, id)
                        .eq(SmsLogDO::getChannelCode, channelCode)
                        .eq(SmsLogDO::getApiSerialNo, apiSerialNo)
                        .eq(SmsLogDO::getMobile, mobile)
                        .orderByDesc(SmsLogDO::getId)).getRecords().stream().findFirst().orElse(null);
    }

    /**
     * 只对仍处于初始接收状态的匹配日志原子写入回执终态。
     *
     * <p>关联条件与状态条件由数据库一起检查，先前查询即使与另一条回执竞争也不会覆盖终态。
     * 使用实体更新保留 MyBatis Plus 的逻辑删除和审计字段填充规则。</p>
     *
     * @param id 已按回执标识匹配的内部日志编号
     * @param channelCode 回调入口对应的供应商渠道编码
     * @param apiSerialNo 发送时保存的供应商流水号
     * @param mobile 发送日志的手机号
     * @param updateObj 接收状态、时间与供应商结果，不能用于修改关联标识
     * @return 写入的行数；终态已确认、标识变化或日志已删除时为零
     */
    default int updateReceiveResultIfInitial(Long id, String channelCode, String apiSerialNo,
                                             String mobile, SmsLogDO updateObj) {
        if (id == null || StrUtil.isBlank(channelCode) || StrUtil.isBlank(apiSerialNo) || StrUtil.isBlank(mobile)) {
            return 0;
        }
        return update(updateObj, new LambdaUpdateWrapper<SmsLogDO>()
                .eq(SmsLogDO::getId, id)
                .eq(SmsLogDO::getChannelCode, channelCode)
                .eq(SmsLogDO::getApiSerialNo, apiSerialNo)
                .eq(SmsLogDO::getMobile, mobile)
                .eq(SmsLogDO::getReceiveStatus, SmsReceiveStatusEnum.INIT.getStatus()));
    }

}
