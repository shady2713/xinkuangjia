package com.basicframework.module.system.dal.mysql.auth;

import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.module.system.dal.dataobject.auth.AutoLoginTicketDO;
import org.apache.ibatis.annotations.Mapper;

/**
 * AutoLoginTicketMapper 数据访问接口，负责持久化查询与写入。
 *
 * @author 李杰
 */
@Mapper
public interface AutoLoginTicketMapper extends BaseMapperX<AutoLoginTicketDO> {

    /**
     * 查询ByTicket。
     *
     * @param ticket ticket参数
     * @return 查询结果
     */
    default AutoLoginTicketDO selectByTicket(String ticket) {
        return selectOne(AutoLoginTicketDO::getTicket, ticket);
    }

}
