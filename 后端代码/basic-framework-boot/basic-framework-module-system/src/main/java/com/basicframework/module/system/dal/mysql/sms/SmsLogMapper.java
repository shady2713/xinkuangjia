package com.basicframework.module.system.dal.mysql.sms;

import cn.hutool.core.util.StrUtil;
import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.system.dal.dataobject.sms.SmsLogDO;
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
     * <p>供应商流水号和手机号都必须存在；阿里云提供内部日志编号时会一并交叉校验。</p>
     *
     * @param id 内部短信日志编号，可为空
     * @param apiSerialNo 供应商流水号
     * @param mobile 手机号
     * @return 匹配的短信日志，标识不完整或未匹配时返回 {@code null}
     */
    default SmsLogDO selectByReceiveCallback(Long id, String apiSerialNo, String mobile) {
        if (StrUtil.isEmpty(apiSerialNo) || StrUtil.isEmpty(mobile)) {
            return null;
        }
        return selectPage(new Page<SmsLogDO>(1, 1, false),
                new LambdaQueryWrapperX<SmsLogDO>()
                        .eqIfPresent(SmsLogDO::getId, id)
                        .eq(SmsLogDO::getApiSerialNo, apiSerialNo)
                        .eq(SmsLogDO::getMobile, mobile)
                        .orderByDesc(SmsLogDO::getId)).getRecords().stream().findFirst().orElse(null);
    }

}
