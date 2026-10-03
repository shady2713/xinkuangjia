package com.basicframework.module.infra.dal.mysql.file;

import com.basicframework.framework.mybatis.core.mapper.BaseMapperX;
import com.basicframework.module.infra.dal.dataobject.file.FileUploadDO;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

/**
 * 上传预约的行锁、原子日预算和有界补偿扫描。
 *
 * @author shady2713
 */
@Mapper
public interface FileUploadMapper extends BaseMapperX<FileUploadDO> {

    /** 当前读并锁定单个对象预约；必须在事务中使用，缺失返回 null。 */
    @Select("SELECT * FROM infra_file_upload WHERE path = #{path} FOR UPDATE")
    FileUploadDO lockByPath(@Param("path") String path);

    /** 当前读并锁定清理项，与完成事务争用同一行，缺失返回 null。 */
    @Select("SELECT * FROM infra_file_upload WHERE id = #{id} FOR UPDATE")
    FileUploadDO lockById(@Param("id") Long id);

    /** 用数据库 UTC 时钟判断预约过期，避免实例间时钟偏差改变完成条件。 */
    @Select("SELECT COUNT(*) FROM infra_file_upload WHERE id = #{id} AND expires_at <= UTC_TIMESTAMP()")
    int countExpired(@Param("id") Long id);

    /** 初始化身份当日预算；唯一键串行化同一身份的并发预约。 */
    @Insert("INSERT INTO infra_file_upload_quota (owner_key, quota_date, reserved_bytes, requests) "
            + "VALUES (#{owner}, UTC_DATE(), 0, 0) ON DUPLICATE KEY UPDATE owner_key = owner_key")
    void initializeQuota(@Param("owner") String owner);

    /** 原子消耗预约预算，超过次数或字节上限返回 0，失败预约不退还额度。 */
    @Update("UPDATE infra_file_upload_quota SET reserved_bytes = reserved_bytes + #{size}, requests = requests + 1 "
            + "WHERE owner_key = #{owner} AND quota_date = UTC_DATE() "
            + "AND requests < #{requests} AND reserved_bytes <= #{dailyBytes} - #{size}")
    int consumeQuota(@Param("owner") String owner, @Param("size") long size,
                     @Param("dailyBytes") long dailyBytes, @Param("requests") int requests);

    /** 建立五分钟预约及十五分钟后清理时间，时间由数据库生成。 */
    @Update("UPDATE infra_file_upload SET expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE), "
            + "next_cleanup_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE) WHERE id = #{id}")
    void initializeExpiry(@Param("id") Long id);

    /** 返回最先到期的有限清理项；多个实例通过每项行锁和二次到期判断协调。 */
    @Select("SELECT id FROM infra_file_upload WHERE next_cleanup_at <= UTC_TIMESTAMP() "
            + "ORDER BY next_cleanup_at, id LIMIT 50")
    List<Long> selectCleanupIds();

    /** 判断被锁定记录是否仍到期，避免另一实例重复执行刚完成的清理。 */
    @Select("SELECT COUNT(*) FROM infra_file_upload WHERE id = #{id} AND next_cleanup_at <= UTC_TIMESTAMP()")
    int countCleanupDue(@Param("id") Long id);

    /** 完成与文件元数据同事务提交；后端上传不再安排对象清理。 */
    @Update("UPDATE infra_file_upload SET status = 'COMPLETE', file_id = #{fileId}, "
            + "next_cleanup_at = CASE WHEN staging_path IS NULL THEN NULL ELSE next_cleanup_at END "
            + "WHERE id = #{id}")
    void complete(@Param("id") Long id, @Param("fileId") Long fileId);

    /** 取消状态持久化后永久拒绝完成，保留记录以清理由超时或中断请求迟到写入的对象。 */
    @Update("UPDATE infra_file_upload SET status = 'CANCELLED' WHERE id = #{id}")
    void cancel(@Param("id") Long id);

    /** 清理尝试后延至下一日；终态记录继续定期核对迟到的对象写入。 */
    @Update("UPDATE infra_file_upload SET next_cleanup_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 DAY) "
            + "WHERE id = #{id}")
    void scheduleNextCleanup(@Param("id") Long id);

    /** 存储清理失败时五分钟后重试，避免最早的失败记录长期挤占扫描批次。 */
    @Update("UPDATE infra_file_upload SET next_cleanup_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE) "
            + "WHERE id = #{id}")
    void scheduleRetry(@Param("id") Long id);
}
