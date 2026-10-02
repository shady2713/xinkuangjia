package com.basicframework.module.infra.dal.mysql.logger;

import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.module.infra.dal.dataobject.logger.ApiAccessLogDO;
import org.apache.ibatis.annotations.Mapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;

import java.time.LocalDateTime;
import java.util.List;

/**
 * API 访问日志 Mapper（仅保留基础写入和清理方法）
 *
 * @author 李杰
 */
@Mapper
public interface ApiAccessLogMapper extends BaseMapperX<ApiAccessLogDO> {

    /**
     * 分批逻辑删除指定时间之前的日志。
     *
     * @param createTime 创建时间上限
     * @param limit 单批删除数量
     * @return 删除条数
     */
    default Integer deleteByCreateTimeLt(LocalDateTime createTime, Integer limit) {
        List<Long> ids = selectPage(new Page<ApiAccessLogDO>(1, limit, false),
                new LambdaQueryWrapper<ApiAccessLogDO>()
                        .select(ApiAccessLogDO::getId)
                        .lt(ApiAccessLogDO::getCreateTime, createTime)
                        .orderByAsc(ApiAccessLogDO::getId))
                .getRecords().stream().map(ApiAccessLogDO::getId).toList();
        return ids.isEmpty() ? 0 : deleteByIds(ids);
    }

}
