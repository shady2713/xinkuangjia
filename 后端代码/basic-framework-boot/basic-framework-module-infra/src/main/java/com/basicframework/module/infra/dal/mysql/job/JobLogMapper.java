package com.basicframework.module.infra.dal.mysql.job;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.infra.controller.admin.job.vo.log.JobLogPageReqVO;
import com.basicframework.module.infra.dal.dataobject.job.JobLogDO;
import org.apache.ibatis.annotations.Mapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 任务日志 Mapper
 *
 * @author 李杰
 */
@Mapper
public interface JobLogMapper extends BaseMapperX<JobLogDO> {

    /**
     * 分页查询任务日志。
     *
     * @param reqVO 分页查询条件
     * @return 任务日志分页结果
     */
    default PageResult<JobLogDO> selectPage(JobLogPageReqVO reqVO) {
        return selectPage(reqVO, new LambdaQueryWrapperX<JobLogDO>()
                .eqIfPresent(JobLogDO::getJobId, reqVO.getJobId())
                .likeIfPresent(JobLogDO::getHandlerName, reqVO.getHandlerName())
                .geIfPresent(JobLogDO::getBeginTime, reqVO.getBeginTime())
                .leIfPresent(JobLogDO::getEndTime, reqVO.getEndTime())
                .eqIfPresent(JobLogDO::getStatus, reqVO.getStatus())
                .orderByDesc(JobLogDO::getId) // ID 倒序
        );
    }

    /**
     * 分批逻辑删除指定时间之前的日志。
     *
     * @param createTime 最大时间
     * @param limit      删除条数，防止一次删除太多
     * @return 删除条数
     */
    default Integer deleteByCreateTimeLt(LocalDateTime createTime, Integer limit) {
        List<Long> ids = selectPage(new Page<JobLogDO>(1, limit, false),
                new LambdaQueryWrapper<JobLogDO>()
                        .select(JobLogDO::getId)
                        .lt(JobLogDO::getCreateTime, createTime)
                        .orderByAsc(JobLogDO::getId))
                .getRecords().stream().map(JobLogDO::getId).toList();
        return ids.isEmpty() ? 0 : deleteByIds(ids);
    }

}
