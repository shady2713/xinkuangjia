package com.basicframework.module.system.dal.mysql.logger;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.system.controller.admin.logger.vo.operatelog.OperateLogPageReqVO;
import com.basicframework.module.system.dal.dataobject.logger.OperateLogDO;
import lombok.Data;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.time.LocalDate;
import java.time.LocalDateTime;
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
     * 按日聚合指定平台用户在起始时间之后的操作日志统计（数据库侧 GROUP BY，避免全量加载明细）。
     *
     * @param platformType 目标平台类型
     * @param businessPlatform 是否为业务管理平台（兼容历史空平台用户）
     * @param startTime 起始创建时间（含）
     * @return 按日聚合统计列表
     */
    @Select("""
            <script>
            SELECT CAST(l.create_time AS DATE) AS stat_date,
                   COUNT(1) AS total_count
            FROM system_operate_log l
            INNER JOIN system_users u ON u.id = l.user_id AND u.deleted = 0
            WHERE l.deleted = 0
              AND l.create_time &gt;= #{startTime}
              <choose>
                <when test="businessPlatform">
                  AND (u.user_type = #{platformType} OR u.user_type IS NULL OR u.user_type = '')
                </when>
                <otherwise>
                  AND u.user_type = #{platformType}
                </otherwise>
              </choose>
            GROUP BY CAST(l.create_time AS DATE)
            </script>
            """)
    List<DailyOperateStat> selectDailyStatsByPlatform(@Param("platformType") String platformType,
                                                      @Param("businessPlatform") boolean businessPlatform,
                                                      @Param("startTime") LocalDateTime startTime);

    /**
     * 查询指定平台用户在起始时间之后的最近操作明细（限制条数）。
     *
     * @param platformType 目标平台类型
     * @param businessPlatform 是否为业务管理平台（兼容历史空平台用户）
     * @param startTime 起始创建时间（含）
     * @param limit 最大返回条数
     * @return 最近操作日志列表
     */
    @Select("""
            <script>
            SELECT l.id, l.type, l.sub_type, l.action, l.create_time
            FROM system_operate_log l
            INNER JOIN system_users u ON u.id = l.user_id AND u.deleted = 0
            WHERE l.deleted = 0
              AND l.create_time &gt;= #{startTime}
              <choose>
                <when test="businessPlatform">
                  AND (u.user_type = #{platformType} OR u.user_type IS NULL OR u.user_type = '')
                </when>
                <otherwise>
                  AND u.user_type = #{platformType}
                </otherwise>
              </choose>
            ORDER BY l.id DESC
            LIMIT #{limit}
            </script>
            """)
    List<OperateLogDO> selectRecentByPlatform(@Param("platformType") String platformType,
                                              @Param("businessPlatform") boolean businessPlatform,
                                              @Param("startTime") LocalDateTime startTime,
                                              @Param("limit") int limit);

    /**
     * 操作日志按日聚合统计投影。
     */
    @Data
    class DailyOperateStat {
        private LocalDate statDate;
        private Long totalCount;
    }

}
