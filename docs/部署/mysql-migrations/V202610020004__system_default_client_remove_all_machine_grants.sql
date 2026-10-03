-- 目的：补救 202610020003 的单项删除与 LIKE 通配符匹配，精确收回 default 的全部机器授权。
-- 适用：已执行 202610020003、存在 system_oauth2_client 的 MySQL 8.x 库；不改写历史校验和。
-- 顺序：核对目标和 schema history，完成备份恢复演练并停写后，由独立 Flyway 运维入口执行。
-- 重放：只更新未删除 default 客户端的有效 JSON 数组；目标清空后重复执行不改变数据。
-- 前检：记录 default 原授权数组；NULL、空串、非法 JSON 及非数组保持原值，另行人工核对配置。
-- 后检：有效数组的 JSON_CONTAINS(..., '"client_credentials"') 必须为 0，否则 CHECK 让迁移失败。
-- 恢复：DML 可能已经提交；按前置备份的主键和原授权类型恢复，不使用 clean 或 repair。

-- CASE 先将不能解析的字段映射为检查用空数组，不依赖 WHERE 条件的求值顺序保护 JSON 函数。
-- JSON_TABLE 只展开有效数组，JSON 值等值比较保证大小写、下划线及完整字面值精确匹配。
-- 按原下标保留其他元素并紧凑拼接，避免 JSON_REMOVE 自动加空格导致 varchar(255) 越界。
-- 不调用 JSON_REMOVE，标量也不会触发删除根路径 $；空数组无需改写。
-- 拼接上限只在当前迁移连接提高并于末尾恢复，防止低 session 设置截断授权配置。
SET @bf_previous_group_concat_max_len = @@SESSION.group_concat_max_len;
SET SESSION group_concat_max_len = CAST(GREATEST(@bf_previous_group_concat_max_len, 4096) AS UNSIGNED);
UPDATE `system_oauth2_client` AS `client`
SET `authorized_grant_types` = (
    SELECT CONCAT('[', COALESCE(GROUP_CONCAT(
               JSON_EXTRACT(`client`.`authorized_grant_types`, CONCAT('$[', `items`.`ordinal` - 1, ']'))
               ORDER BY `items`.`ordinal` SEPARATOR ','), ''), ']')
    FROM JSON_TABLE(
        CASE WHEN JSON_TYPE(CASE WHEN JSON_VALID(`client`.`authorized_grant_types`)
                                 THEN `client`.`authorized_grant_types` ELSE '[]' END) = 'ARRAY'
             THEN `client`.`authorized_grant_types` ELSE '[]' END,
        '$[*]' COLUMNS (`ordinal` FOR ORDINALITY)
    ) AS `items`
    WHERE JSON_EXTRACT(`client`.`authorized_grant_types`, CONCAT('$[', `items`.`ordinal` - 1, ']'))
              <> CAST('"client_credentials"' AS JSON)
)
WHERE `client_id` = 'default'
  AND `deleted` = b'0'
  AND JSON_TYPE(CASE WHEN JSON_VALID(`authorized_grant_types`)
                     THEN `authorized_grant_types` ELSE '[]' END) = 'ARRAY'
  AND JSON_CONTAINS(CASE WHEN JSON_VALID(`authorized_grant_types`)
                         THEN `authorized_grant_types` ELSE '[]' END, '"client_credentials"') = 1;

-- 后检以真实 CHECK 约束断言数组无目标值；SELECT 结果不能让 Flyway 识别失败，故必须写入约束表。
-- 检查表只在当前连接可见，成功即删除；异常由迁移连接关闭回收，不留下永久对象。
CREATE TEMPORARY TABLE `bf_default_grant_assertion` (
    `contains_machine_grant` TINYINT NOT NULL,
    CHECK (`contains_machine_grant` = 0)
);
INSERT INTO `bf_default_grant_assertion` (`contains_machine_grant`)
SELECT COALESCE(MAX(JSON_CONTAINS(
           CASE WHEN JSON_VALID(`authorized_grant_types`)
                THEN `authorized_grant_types` ELSE '[]' END, '"client_credentials"')), 0)
FROM `system_oauth2_client`
WHERE `client_id` = 'default'
  AND `deleted` = b'0'
  AND JSON_TYPE(CASE WHEN JSON_VALID(`authorized_grant_types`)
                     THEN `authorized_grant_types` ELSE '[]' END) = 'ARRAY';
DROP TEMPORARY TABLE `bf_default_grant_assertion`;
SET SESSION group_concat_max_len = CAST(@bf_previous_group_concat_max_len AS UNSIGNED);
