package com.basicframework.module.system.dal.mysql.logger;

import cn.hutool.core.collection.CollUtil;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.system.controller.admin.logger.vo.operatelog.OperateLogPageReqVO;
import com.basicframework.module.system.dal.dataobject.logger.OperateLogDO;
import org.apache.ibatis.annotations.Mapper;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;

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
     * 按日志归属用户查询指定时间之后的操作日志，按编号降序。
     *
     * <p>归属用户集合为空时直接返回空列表（fail-closed），避免退化为无归属过滤的全表查询。</p>
     *
     * @param userIds 允许查看的日志归属用户编号集合
     * @param startTime 起始创建时间（含）
     * @param includeDetails 是否允许读取日志明细
     * @return 查询结果
     */
    default List<OperateLogDO> selectListByUserIdsAndCreateTimeGe(Collection<Long> userIds, LocalDateTime startTime,
                                                         boolean includeDetails) {
        if (CollUtil.isEmpty(userIds)) {
            return List.of();
        }
        LambdaQueryWrapperX<OperateLogDO> query = new LambdaQueryWrapperX<OperateLogDO>()
                .in(OperateLogDO::getUserId, userIds)
                .ge(OperateLogDO::getCreateTime, startTime);
        if (includeDetails) {
            query.orderByDesc(OperateLogDO::getId);
        } else {
            query.select(OperateLogDO::getCreateTime);
        }
        return selectList(query);
    }

}
