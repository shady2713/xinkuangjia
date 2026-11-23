package com.basicframework.module.system.dal.mysql.logger;

import cn.hutool.core.collection.CollUtil;
import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.system.controller.admin.logger.vo.loginlog.LoginLogPageReqVO;
import com.basicframework.module.system.dal.dataobject.logger.LoginLogDO;
import com.basicframework.module.system.enums.logger.LoginResultEnum;
import org.apache.ibatis.annotations.Mapper;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;

/**
 * LoginLogMapper 数据访问接口，负责持久化查询与写入。
 *
 * @author 李杰
 */
@Mapper
public interface LoginLogMapper extends BaseMapperX<LoginLogDO> {

    /**
     * 查询分页数据。
     *
     * @param reqVO 请求参数
     * @return 查询结果
     */
    default PageResult<LoginLogDO> selectPage(LoginLogPageReqVO reqVO) {
        var query = new LambdaQueryWrapperX<LoginLogDO>()
                .likeIfPresent(LoginLogDO::getUserIp, reqVO.getUserIp())
                .likeIfPresent(LoginLogDO::getUsername, reqVO.getUsername())
                .betweenIfPresent(LoginLogDO::getCreateTime, reqVO.getCreateTime());
        if (Boolean.TRUE.equals(reqVO.getStatus())) {
            query.eq(LoginLogDO::getResult, LoginResultEnum.SUCCESS.getResult());
        } else if (Boolean.FALSE.equals(reqVO.getStatus())) {
            query.gt(LoginLogDO::getResult, LoginResultEnum.SUCCESS.getResult());
        }
        query.orderByDesc(LoginLogDO::getId); // 降序
        return selectPage(reqVO, query);
    }

    /**
     * 按日志归属用户查询指定时间之后的登录日志，明细按编号降序。
     *
     * <p>归属用户集合为空时直接返回空列表（fail-closed），避免退化为无归属过滤的全表查询。</p>
     *
     * @param userIds 允许查看的日志归属用户编号集合
     * @param startTime 起始创建时间（含）
     * @param includeDetails 是否允许读取日志明细
     * @return 查询结果
     */
    default List<LoginLogDO> selectListByUserIdsAndCreateTimeGe(Collection<Long> userIds, LocalDateTime startTime,
                                                         boolean includeDetails) {
        if (CollUtil.isEmpty(userIds)) {
            return List.of();
        }
        var query = new LambdaQueryWrapperX<LoginLogDO>()
                .in(LoginLogDO::getUserId, userIds)
                .ge(LoginLogDO::getCreateTime, startTime);
        if (includeDetails) {
            query.orderByDesc(LoginLogDO::getId);
        } else {
            query.select(LoginLogDO::getCreateTime, LoginLogDO::getResult);
        }
        return selectList(query);
    }

}
