package com.basicframework.module.system.dal.mysql.logger;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.system.api.logger.dto.OperateLogPageReqDTO;
import com.basicframework.module.system.controller.admin.logger.vo.operatelog.OperateLogPageReqVO;
import com.basicframework.module.system.dal.dataobject.logger.OperateLogDO;
import org.apache.ibatis.annotations.Mapper;

/**
 * OperateLogMapper 数据访问接口，负责持久化查询与写入。
 *
 * @author 李杰
 */
@Mapper
public interface OperateLogMapper extends BaseMapperX<OperateLogDO> {

    /**
     * 查询分页数据。
     *
     * @param pageReqDTO 分页数据ReqDTO参数
     * @return 查询结果
     */
    default PageResult<OperateLogDO> selectPage(OperateLogPageReqVO pageReqDTO) {
        return selectPage(pageReqDTO, new LambdaQueryWrapperX<OperateLogDO>()
                .eqIfPresent(OperateLogDO::getUserId, pageReqDTO.getUserId())
                .eqIfPresent(OperateLogDO::getBizId, pageReqDTO.getBizId())
                .likeIfPresent(OperateLogDO::getType, pageReqDTO.getType())
                .likeIfPresent(OperateLogDO::getSubType, pageReqDTO.getSubType())
                .likeIfPresent(OperateLogDO::getAction, pageReqDTO.getAction())
                .betweenIfPresent(OperateLogDO::getCreateTime, pageReqDTO.getCreateTime())
                .orderByDesc(OperateLogDO::getId));
    }

    /**
     * 查询分页数据。
     *
     * @param pageReqDTO 分页数据ReqDTO参数
     * @return 查询结果
     */
    default PageResult<OperateLogDO> selectPage(OperateLogPageReqDTO pageReqDTO) {
        return selectPage(pageReqDTO, new LambdaQueryWrapperX<OperateLogDO>()
                .eqIfPresent(OperateLogDO::getType, pageReqDTO.getType())
                .eqIfPresent(OperateLogDO::getBizId, pageReqDTO.getBizId())
                .eqIfPresent(OperateLogDO::getUserId, pageReqDTO.getUserId())
                .orderByDesc(OperateLogDO::getId));
    }

}
