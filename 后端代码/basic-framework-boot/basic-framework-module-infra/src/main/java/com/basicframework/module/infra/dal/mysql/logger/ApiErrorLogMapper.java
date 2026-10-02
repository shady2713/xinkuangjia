package com.basicframework.module.infra.dal.mysql.logger;

import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.module.infra.dal.dataobject.logger.ApiErrorLogDO;
import org.apache.ibatis.annotations.Mapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;

import java.time.LocalDateTime;
import java.util.List;

/**
 * API 错误日志 Mapper（仅保留基础写入和清理方法）
 *
 * @author 李杰
 */
@Mapper
public interface ApiErrorLogMapper extends BaseMapperX<ApiErrorLogDO> {

    /**
     * 分批逻辑删除指定时间之前的日志。
     *
     * @param createTime 创建时间上限
     * @param limit 单批删除数量
     * @return 删除条数
     */
    default Integer deleteByCreateTimeLt(LocalDateTime createTime, Integer limit) {
        List<Long> ids = selectPage(new Page<ApiErrorLogDO>(1, limit, false),
                new LambdaQueryWrapper<ApiErrorLogDO>()
                        .select(ApiErrorLogDO::getId)
                        .lt(ApiErrorLogDO::getCreateTime, createTime)
                        .orderByAsc(ApiErrorLogDO::getId))
                .getRecords().stream().map(ApiErrorLogDO::getId).toList();
        return ids.isEmpty() ? 0 : deleteByIds(ids);
    }

}
