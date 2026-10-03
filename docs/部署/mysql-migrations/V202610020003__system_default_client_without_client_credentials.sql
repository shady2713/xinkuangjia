-- 目的：收回 default 客户端的 client_credentials 授权类型，消除机器主体越权读取后台数据的入口。
-- 适用：已登记 202610010000 基线、存在 system_oauth2_client 的 MySQL 8.x 库。
-- 顺序：备份恢复演练成功、停止写入后，由独立 Flyway 运维入口执行。
-- 重放：Flyway 记录版本与校验和，已完成版本不重放；禁止改写已应用脚本。
-- 前检：确认目标数据库、当前 schema history；记录 default 客户端当前授权类型与现存 user_id<=0 令牌数量。
-- 后检：default 客户端不再包含 client_credentials，其余授权类型与其他客户端配置不变。
-- 恢复：UPDATE 已提交，可用前置记录的原授权类型按 client_id 还原；不使用 clean 或 repair 掩盖差异。

-- 只收回 default 客户端的机器主体授权；其他客户端的 client_credentials 不受影响。
-- JSON_SEARCH 按值定位下标，不依赖元素顺序；JSON_CONTAINS 限定只在确实包含该授权时执行，
-- 数组中不存在该元素时保持原值，便于重复执行或人工核对后重放。
UPDATE `system_oauth2_client`
SET `authorized_grant_types` = JSON_REMOVE(`authorized_grant_types`,
        JSON_UNQUOTE(JSON_SEARCH(`authorized_grant_types`, 'one', 'client_credentials')))
WHERE `client_id` = 'default'
  AND `deleted` = b'0'
  AND JSON_CONTAINS(`authorized_grant_types`, '"client_credentials"');
