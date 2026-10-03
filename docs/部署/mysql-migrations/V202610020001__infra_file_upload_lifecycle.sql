-- 目的：增加上传预约、持久化补偿及并发安全的每日预算。
-- 适用：已有 infra_file，尚无 infra_file_upload 与 infra_file_upload_quota 的 MySQL 8.x 库。
-- 顺序：先备份并停止旧上传写入口，再执行本迁移，最后启动支持预约协议的服务与前端。
-- 重放：不可重复执行；已存在目标表时必须核对迁移记录和 SHOW CREATE TABLE，不得覆盖。
-- 前检：确认目标数据库、完整备份可恢复；两个目标表不存在。
-- 后检：SHOW CREATE TABLE 两表；验证预约、完成、过期清理及日预算限制。
-- 恢复：升级窗口内从已验证备份恢复应用与库；出现新上传后不可直接删除补偿记录。
-- 本文件为显式运维迁移，不由应用启动自动执行。

CREATE TABLE `infra_file_upload` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '上传预约编号',
  `owner_key` varchar(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '可信身份域与用户编号',
  `path` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT '唯一且永不复用的最终对象键',
  `staging_path` varchar(128) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL COMMENT '浏览器直传暂存对象键',
  `name` varchar(256) NOT NULL COMMENT '规范化原文件名',
  `size` bigint NOT NULL COMMENT '预约精确字节数',
  `status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'PENDING待完成 COMPLETE已登记 CANCELLED已取消',
  `file_id` bigint DEFAULT NULL COMMENT '完成登记的文件编号',
  `expires_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '预约截止时间UTC',
  `next_cleanup_at` datetime DEFAULT NULL COMMENT '下一次补偿核对时间UTC，空表示无需清理',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_path` (`path`),
  KEY `idx_cleanup` (`next_cleanup_at`, `id`),
  CONSTRAINT `ck_upload_size` CHECK (`size` > 0),
  CONSTRAINT `ck_upload_status` CHECK (`status` IN ('PENDING', 'COMPLETE', 'CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='上传预约及持久化补偿记录';

CREATE TABLE `infra_file_upload_quota` (
  `owner_key` varchar(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '可信身份域与用户编号',
  `quota_date` date NOT NULL COMMENT '预算UTC日期',
  `reserved_bytes` bigint NOT NULL DEFAULT 0 COMMENT '累计预约字节数，失败不退款',
  `requests` int NOT NULL DEFAULT 0 COMMENT '累计预约次数，失败不退款',
  PRIMARY KEY (`owner_key`, `quota_date`),
  CONSTRAINT `ck_upload_quota` CHECK (`reserved_bytes` >= 0 AND `requests` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='每身份每日上传预约预算';
