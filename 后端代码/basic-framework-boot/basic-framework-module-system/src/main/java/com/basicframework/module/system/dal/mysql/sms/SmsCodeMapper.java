package com.basicframework.module.system.dal.mysql.sms;

import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.system.dal.dataobject.sms.SmsCodeDO;
import org.apache.ibatis.annotations.Mapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;

import java.time.LocalDateTime;

/**
 * 短信验证码数据访问接口。
 *
 * @author 李杰
 */
@Mapper
public interface SmsCodeMapper extends BaseMapperX<SmsCodeDO> {

    /**
     * 获得手机号的最后一个手机验证码
     *
     * @param mobile 手机号
     * @param scene 发送场景，选填
     * @param code 验证码 选填
     * @return 手机验证码
     */
    default SmsCodeDO selectLastByMobile(String mobile, String code, Integer scene) {
        return selectPage(new Page<SmsCodeDO>(1, 1, false),
                new LambdaQueryWrapperX<SmsCodeDO>()
                        .eq(SmsCodeDO::getMobile, mobile)
                        .eqIfPresent(SmsCodeDO::getScene, scene)
                        .eqIfPresent(SmsCodeDO::getCode, code)
                        .orderByDesc(SmsCodeDO::getId)).getRecords().stream().findFirst().orElse(null);
    }

    /**
     * 原子消费尚未使用的验证码。
     *
     * <p>条件更新保证同一验证码在并发请求中最多只有一个请求消费成功。</p>
     *
     * @param id 验证码记录编号
     * @param usedTime 使用时间
     * @param usedIp 使用 IP
     * @return 受影响行数，返回 0 表示验证码已被其他请求消费
     */
    default int updateUsedIfUnused(Long id, LocalDateTime usedTime, String usedIp) {
        SmsCodeDO update = SmsCodeDO.builder().used(true).usedTime(usedTime).usedIp(usedIp).build();
        return update(update, new LambdaQueryWrapperX<SmsCodeDO>()
                .eq(SmsCodeDO::getId, id)
                .eq(SmsCodeDO::getUsed, false));
    }

}
