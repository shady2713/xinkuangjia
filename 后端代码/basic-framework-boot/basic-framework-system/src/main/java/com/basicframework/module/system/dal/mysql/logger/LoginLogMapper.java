package com.basicframework.module.system.dal.mysql.logger;

import com.basicframework.framework.common.pojo.PageResult;
import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.framework.mybatis.core.query.LambdaQueryWrapperX;
import com.basicframework.module.system.controller.admin.logger.vo.loginlog.LoginLogPageReqVO;
import com.basicframework.module.system.dal.dataobject.logger.LoginLogDO;
import com.basicframework.module.system.enums.logger.LoginResultEnum;
import lombok.Data;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * LoginLogMapper 数据访问接口，负责持久化查询与写入。
 *
 * @author shady
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
     * 按日聚合指定平台用户在起始时间之后的登录统计（数据库侧 GROUP BY，避免全量加载明细）。
     *
     * @param platformType 目标平台类型
     * @param businessPlatform 是否为业务管理平台（兼容历史空平台用户）
     * @param startTime 起始创建时间（含）
     * @param successResult 登录成功结果码
     * @return 按日聚合统计列表
     */
    @Select("""
            <script>
            SELECT CAST(l.create_time AS DATE) AS stat_date,
                   COUNT(1) AS total_count,
                   SUM(CASE WHEN l.result = #{successResult} THEN 1 ELSE 0 END) AS success_count,
                   SUM(CASE WHEN l.result = #{successResult} THEN 0 ELSE 1 END) AS fail_count
            FROM system_login_log l
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
    List<DailyLoginStat> selectDailyStatsByPlatform(@Param("platformType") String platformType,
                                                    @Param("businessPlatform") boolean businessPlatform,
                                                    @Param("startTime") LocalDateTime startTime,
                                                    @Param("successResult") Integer successResult);

    /**
     * 查询指定平台用户在起始时间之后的最近登录明细（限制条数）。
     *
     * @param platformType 目标平台类型
     * @param businessPlatform 是否为业务管理平台（兼容历史空平台用户）
     * @param startTime 起始创建时间（含）
     * @param limit 最大返回条数
     * @return 最近登录日志列表
     */
    @Select("""
            <script>
            SELECT l.id, l.username, l.user_ip, l.result, l.create_time
            FROM system_login_log l
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
    List<LoginLogDO> selectRecentByPlatform(@Param("platformType") String platformType,
                                            @Param("businessPlatform") boolean businessPlatform,
                                            @Param("startTime") LocalDateTime startTime,
                                            @Param("limit") int limit);

    /**
     * 登录日志按日聚合统计投影。
     */
    @Data
    class DailyLoginStat {
        private LocalDate statDate;
        private Long totalCount;
        private Long successCount;
        private Long failCount;
    }

}
