package com.basicframework.module.system.dal.mysql.sms;

import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.system.dal.dataobject.sms.SmsCodeDO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;
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
     * <p>同时检查更新挑战、有效期和使用状态；即使校验后又签发新码，也不能消费旧码。</p>
     *
     * @param id 验证码记录编号
     * @param usedTime 使用时间
     * @param usedIp 使用 IP
     * @param validAfter 验证码创建时间必须晚于此界限，防止排队期间过期仍被消费
     * @return 受影响行数，返回 0 表示已消费、已过期或已有更新挑战
     */
    @Update("""
            UPDATE system_sms_code AS candidate
            LEFT JOIN system_sms_code AS newer
              ON newer.mobile = candidate.mobile AND newer.scene = candidate.scene
              AND newer.id > candidate.id AND newer.deleted = 0
            SET candidate.used = 1, candidate.used_time = #{usedTime},
                candidate.used_ip = #{usedIp}, candidate.update_time = #{usedTime}
            WHERE candidate.id = #{id} AND candidate.deleted = 0 AND candidate.used = 0
              AND candidate.create_time > #{validAfter} AND newer.id IS NULL
            """)
    int updateUsedIfUnused(@Param("id") Long id, @Param("usedTime") LocalDateTime usedTime,
                          @Param("usedIp") String usedIp, @Param("validAfter") LocalDateTime validAfter);

}
