-- 一次性作废现存机器主体会话（user_id = 0 的访问与刷新令牌）。
--
-- 适用：已应用全部版本迁移的 MySQL 8.x 库。执行前必须完成[备份与恢复](数据库初始化与迁移.md#备份与恢复)演练。
-- 背景：client_credentials 机器令牌以 user_id=0、user_type=ADMIN 落库，checkAccessToken 的
--        真实用户校验要求 user_id>0，因此占位主体不受账号禁用约束；本脚本用于收回历史已签发的此类凭据。
-- 方式：按框架逻辑删除约定置 deleted=b'1'，与应用内 removeAccessToken 的删除语义一致；
--        保留行记录以便可核对与回滚，不做物理 DELETE。
-- 前置：核对 SELECT DATABASE()、@@hostname、@@port 与目标一致；先执行下方“前检”查询并记录数量。
-- 后置：执行“后检”查询，两个计数都应为 0；并按部署文档同步清理 Redis 中的 oauth2_access_token 缓存键。
-- 恢复：如需回滚，按执行前导出的主键清单将 deleted 置回 b'0'；已被业务复用的记录需人工确认后再恢复。

-- 前检：记录将被作废的会话数量与主键，供后检和回滚核对。
SELECT 'access_token' AS token_table, COUNT(*) AS pending_count
FROM `system_oauth2_access_token`
WHERE `user_id` = 0 AND `deleted` = b'0'
UNION ALL
SELECT 'refresh_token', COUNT(*)
FROM `system_oauth2_refresh_token`
WHERE `user_id` = 0 AND `deleted` = b'0';

SELECT `id`, `user_id`, `user_type`, `client_id`, `access_token`, `expires_time`
FROM `system_oauth2_access_token`
WHERE `user_id` = 0 AND `deleted` = b'0'
ORDER BY `id`;

SELECT `id`, `user_id`, `user_type`, `client_id`, `expires_time`
FROM `system_oauth2_refresh_token`
WHERE `user_id` = 0 AND `deleted` = b'0'
ORDER BY `id`;

-- 作废：先刷新会话再访问会话，避免中途失败留下可续期的孤立刷新令牌。
UPDATE `system_oauth2_refresh_token`
SET `deleted` = b'1'
WHERE `user_id` = 0 AND `deleted` = b'0';

UPDATE `system_oauth2_access_token`
SET `deleted` = b'1'
WHERE `user_id` = 0 AND `deleted` = b'0';

-- 后检：两个计数都应为 0；非 0 说明仍有机器主体会话可用，必须调查后再恢复服务。
SELECT 'access_token' AS token_table, COUNT(*) AS remaining_count
FROM `system_oauth2_access_token`
WHERE `user_id` = 0 AND `deleted` = b'0'
UNION ALL
SELECT 'refresh_token', COUNT(*)
FROM `system_oauth2_refresh_token`
WHERE `user_id` = 0 AND `deleted` = b'0';
